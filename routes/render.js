'use strict';
const express   = require('express');
const router    = express.Router();
const path      = require('path');
const fs        = require('fs');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('./auth');
const { requireShopifySession } = require('./shopify-session');
const { getDB } = require('../db/database');
const { attachShopId, attachShopIdSoft } = require('./_shop-context');
const { uploadToFtpAsync, isFtpConfigured } = require('../utils/ftp-upload');
const { uploadToShopifyFiles } = require('../utils/shopify-files');

// ── Rate-limit render : 200 saves/heure/shop (audit B5) ──────────────────────
const renderRateLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             200,
  keyGenerator:    (req) => String(req.shopId || req.ip),
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Quota render dépassé (200/h) — réessayez dans une heure' },
});

// ── Vérification taille body PNG base64 (max 10 Mo) ─────────────────────────
const PNG_B64_MAX = 10 * 1024 * 1024; // 10 Mo
function checkBodySize(field) {
  return (req, res, next) => {
    const val = req.body?.[field];
    if (val && Buffer.byteLength(val, 'utf8') > PNG_B64_MAX) {
      return res.status(413).json({ error: `Payload trop grand — max 10 Mo pour ${field}` });
    }
    next();
  };
}

// Utilise DATA_DIR si défini (prod Railway) sinon dossier projet
const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, '..');
const RENDERS_DIR = path.join(DATA_DIR, 'uploads', 'renders');
fs.mkdirSync(RENDERS_DIR, { recursive: true });

// ── Migration colonnes render (N4 fix) : exécutée une seule fois au démarrage ──
// Évite les ALTER TABLE dans chaque handler (source de lenteur serveur)
(function _migrateRenderColumns() {
  try {
    const db = getDB();
    const cols = ['views_preview_json TEXT', 'render_url TEXT', 'render_size_kb INTEGER', 'preview_cdn_url TEXT'];
    for (const col of cols) {
      try { db.prepare(`ALTER TABLE designs ADD COLUMN ${col}`).run(); } catch { /* colonne déjà présente */ }
    }
  } catch(e) { console.warn('[render] migration colonnes:', e.message); }
})();

// ── GET /api/render ── liste tous les designs ayant un render HD (admin, scopé shop)
router.get('/', requireAuth, attachShopId, (req, res) => {
  const db = getDB();
  let rows;
  try {
    rows = db.prepare(`
      SELECT id, name, product, format, render_url, render_size_kb, updated_at
      FROM designs
      WHERE shop_id = ? AND render_url IS NOT NULL AND render_url != ''
      ORDER BY updated_at DESC
    `).all(req.shopId);
  } catch(e) {
    rows = [];
  }
  res.json(rows.map(r => ({
    id:         r.id,
    design_id:  r.id,
    name:       r.name,
    product:    r.product,
    format:     r.format,
    url:        r.render_url,
    size_kb:    r.render_size_kb,
    status:     'done',
    created_at: r.updated_at,
  })));
});

// ── POST /api/render/save-views ── sauvegarde les thumbnails de TOUTES les vues d'un design
// Body: { design_id, views: [{ idx, name, png_base64 }] }
// Stocke chaque image dans uploads/renders et met à jour views_preview_json dans la table designs
// Scopé shop : on vérifie que design_id appartient bien au shop courant.
// Auth : attachShopId (X-Shop-Domain depuis l'éditeur storefront) + rate-limit + ownership check (audit B5)
// requireShopifySession retiré : l'éditeur tourne dans un iframe storefront sans App Bridge.
router.post('/save-views', attachShopId, renderRateLimiter, (req, res) => {
  const { design_id, views } = req.body;
  if (!design_id || !Array.isArray(views) || !views.length) {
    return res.status(400).json({ error: 'design_id et views[] requis' });
  }

  const db = getDB();
  // Vérifier ownership avant tout traitement (sinon DoS possible : on accepte des PNG pour rien)
  const owner = db.prepare('SELECT id FROM designs WHERE id=? AND shop_id=?').get(design_id, req.shopId);
  if (!owner) return res.status(404).json({ error: 'Design introuvable pour ce shop' });
  const APP_URL = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
  const result  = {};

  for (const view of views) {
    try {
      const base64Data = (view.png_base64 || '').replace(/^data:image\/\w+;base64,/, '');
      if (!base64Data) continue;
      const buffer   = Buffer.from(base64Data, 'base64');
      const filename = `preview_d${design_id}_v${view.idx}_${Date.now()}.png`;
      const filepath = path.join(RENDERS_DIR, filename);
      fs.writeFileSync(filepath, buffer);
      const absUrl = `${APP_URL}/uploads/renders/${filename}`;
      result[view.idx] = { url: absUrl, name: view.name || `Vue ${view.idx}` };
    } catch(e) {
      console.error(`[render] save-views view ${view.idx}:`, e.message);
    }
  }

  try {
    db.prepare('UPDATE designs SET views_preview_json=?, updated_at=datetime(\'now\') WHERE id=? AND shop_id=?')
      .run(JSON.stringify(result), design_id, req.shopId);
    console.log(`[render] ${Object.keys(result).length} thumbnail(s) sauvegardé(s) pour design #${design_id}`);
    res.json({ ok: true, views: result });
  } catch(e) {
    console.error('[render] save-views DB:', e.message);
    res.status(500).json({ error: 'Erreur DB' });
  }
});

// ── POST /api/render/save ── reçoit base64, sauvegarde PNG, upload Shopify Files CDN
// Retourne previewUrl = URL CDN Shopify (cdn.shopify.com) ou Railway en fallback
// Scopé shop : on vérifie l'ownership du design avant d'accepter le payload.
// Auth : attachShopId (X-Shop-Domain depuis l'éditeur storefront) + rate-limit + body size check + ownership check (audit B5)
// requireShopifySession retiré : l'éditeur tourne dans un iframe storefront sans App Bridge.
router.post('/save', attachShopId, renderRateLimiter, checkBodySize('png_base64'), async (req, res) => {
  const { design_id, png_base64 } = req.body;
  // kind=print  → PNG transparent sans mockup (admin download, impression).
  //               Met à jour designs.render_url. NE TOUCHE PAS preview_cdn_url.
  // kind=preview→ PNG avec mockup (email/drawer/_preview_img).
  //               Met à jour designs.preview_cdn_url uniquement (Shopify Files).
  // Compat : si kind absent → 'print' (rétrocompat appels existants).
  const kind = (req.body.kind || 'print').toString().toLowerCase();
  if (!design_id || !png_base64) {
    return res.status(400).json({ error: 'design_id et png_base64 requis' });
  }
  if (kind !== 'print' && kind !== 'preview') {
    return res.status(400).json({ error: 'kind doit être "print" ou "preview"' });
  }

  // ── Vérification ownership avant écriture disque (anti-DoS B5) ────────
  const dbCheck = getDB();
  const ownerCheck = dbCheck.prepare('SELECT id FROM designs WHERE id=? AND shop_id=?').get(design_id, req.shopId);
  if (!ownerCheck) return res.status(404).json({ error: 'Design introuvable pour ce shop' });

  try {
    const base64Data = png_base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer     = Buffer.from(base64Data, 'base64');

    const filename = `render_${kind}_design_${design_id}_${Date.now()}.png`;
    const filepath = path.join(RENDERS_DIR, filename);
    fs.writeFileSync(filepath, buffer);

    const relUrl  = `/uploads/renders/${filename}`;
    const APP_URL = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
    const sizeKb  = Math.round(buffer.length / 1024);
    const db = getDB();

    if (kind === 'print') {
      // PNG impression : on enregistre uniquement render_url. Le download admin
      // tirera ce fichier (et appliquera sharp.trim côté /download/:id).
      // Nettoyage volume (Railway ~78% le 2026-05-21) : récupérer l'ancien render
      // de ce design AVANT l'update pour pouvoir supprimer le fichier orphelin
      // ensuite — sinon chaque render laisse un PNG horodaté qui ne sert plus.
      let _oldRenderUrl = null;
      try {
        _oldRenderUrl = db.prepare('SELECT render_url FROM designs WHERE id=? AND shop_id=?')
          .get(design_id, req.shopId)?.render_url || null;
      } catch { /* non bloquant */ }

      db.prepare('UPDATE designs SET render_url=?, render_size_kb=? WHERE id=? AND shop_id=?')
        .run(relUrl, sizeKb, design_id, req.shopId);
      console.log(`[render][print] ${filename} (${sizeKb} Ko)`);

      // Supprimer l'ancien fichier de render (remplacé) — uniquement s'il s'agit
      // bien d'un fichier local /uploads/renders/ différent du nouveau.
      if (_oldRenderUrl && _oldRenderUrl !== relUrl && _oldRenderUrl.startsWith('/uploads/renders/')) {
        try { fs.unlinkSync(path.join(DATA_DIR, _oldRenderUrl)); }
        catch { /* déjà absent ou non supprimable — non bloquant */ }
      }

      // FTP fallback secondaire pour archive externe si configuré
      if (isFtpConfigured()) uploadToFtpAsync(filepath, filename, 3);

      return res.json({
        kind:       'print',
        url:        relUrl,
        previewUrl: `${APP_URL}${relUrl}`,
        filename,
        size_kb:    sizeKb,
      });
    }

    // kind === 'preview' : upload Shopify Files CDN obligatoire pour _preview_img
    // (Shopify natif, email transactionnel). Fallback Railway si CDN KO.
    const shop  = process.env.SHOPIFY_BOOTSTRAP_SHOP;
    const token = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_BOOTSTRAP_TOKEN;

    let previewUrl = `${APP_URL}${relUrl}`;
    if (shop && token) {
      try {
        const cdnUrl = await uploadToShopifyFiles(filepath, shop, token);
        db.prepare('UPDATE designs SET preview_cdn_url=? WHERE id=? AND shop_id=?').run(cdnUrl, design_id, req.shopId);
        try { fs.unlinkSync(filepath); } catch { /* pas bloquant */ }
        previewUrl = cdnUrl;
        console.log(`[render][preview] CDN Shopify ${cdnUrl}`);
      } catch (cdnErr) {
        console.error(`[render][preview] CDN Shopify ERREUR : ${cdnErr.message}`);
        if (cdnErr.graphqlErrors) console.error('[render] GraphQL errors :', JSON.stringify(cdnErr.graphqlErrors));
        // Fallback : on persiste l'URL Railway dans preview_cdn_url
        db.prepare('UPDATE designs SET preview_cdn_url=? WHERE id=? AND shop_id=?').run(previewUrl, design_id, req.shopId);
        if (isFtpConfigured()) uploadToFtpAsync(filepath, filename, 3);
      }
    } else {
      // Pas de creds Shopify Files → on stocke quand même l'URL Railway.
      db.prepare('UPDATE designs SET preview_cdn_url=? WHERE id=? AND shop_id=?').run(previewUrl, design_id, req.shopId);
      if (isFtpConfigured()) uploadToFtpAsync(filepath, filename, 3);
    }

    return res.json({
      kind:       'preview',
      url:        relUrl,
      previewUrl,
      filename,
      size_kb:    sizeKb,
    });

  } catch(err) {
    console.error('[render] Erreur sauvegarde:', err);
    res.status(500).json({ error: 'Erreur sauvegarde PNG' });
  }
});

// ── POST /api/render/ftp-retry/:design_id ── relancer l'upload FTP manuellement
router.post('/ftp-retry/:design_id', requireAuth, attachShopId, (req, res) => {
  if (!isFtpConfigured()) {
    return res.status(400).json({ error: 'FTP non configuré dans .env' });
  }
  const db     = getDB();
  let design;
  try {
    design = db.prepare('SELECT render_url FROM designs WHERE id=? AND shop_id=?').get(req.params.design_id, req.shopId);
  } catch { return res.status(404).json({ error: 'Design introuvable' }); }

  if (!design?.render_url) {
    return res.status(404).json({ error: 'Aucun render HD à envoyer' });
  }

  const filepath = path.join(DATA_DIR, design.render_url);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Fichier PNG introuvable sur le disque' });
  }

  uploadToFtpAsync(filepath, path.basename(filepath), 3);
  res.json({ ok: true, message: 'FTP upload relancé en arrière-plan' });
});

// ── POST /api/render/cart-set/:design_id ─────────────────────────────────────
// Génère le set complet de mockups (print-front, print-back, mockup-cart, email-hero,
// email-thumb) à partir de PNG transparents recto/verso fournis par le studio.
// Phase 1 : t-shirt homme blanc uniquement. Si le produit/couleur n'est pas dans
// le manifest, la route répond 200 + skipped: true (le studio retombe alors sur le
// flux historique sans rien casser).
//
// Body : { design_front_b64: "data:image/png;base64,...", design_back_b64?: "..." }
// Retour : { ok, urls: {...}, errors }
router.post('/cart-set/:design_id', attachShopId, renderRateLimiter,
  checkBodySize('design_front_b64'), checkBodySize('design_back_b64'),
  async (req, res) => {
    const designId = Number(req.params.design_id);
    const { design_front_b64, design_back_b64 } = req.body;
    if (!designId || !design_front_b64) {
      return res.status(400).json({ error: 'design_id et design_front_b64 requis' });
    }

    const db = getDB();
    const design = db.prepare(
      'SELECT id, product, color FROM designs WHERE id = ? AND shop_id = ?'
    ).get(designId, req.shopId);
    if (!design) return res.status(404).json({ error: 'Design introuvable pour ce shop' });

    // Mapping product TSL → clé manifest mockup
    // Phase 1 : on ne gère que tshirt-homme blanc
    const productKey = ({
      'tshirt':       'tshirt-homme',
      'tshirt-homme': 'tshirt-homme',
    })[design.product] || null;
    const colorKey = (design.color || '').toLowerCase().includes('white') ||
                     (design.color || '').toLowerCase().includes('blanc') ||
                     (design.color || '') === '#FFFFFF' ||
                     (design.color || '') === '#ffffff'
      ? 'white' : null;

    if (!productKey || !colorKey) {
      return res.json({
        ok: true, skipped: true,
        reason: `Produit/couleur hors manifest mockup (phase 1 : tshirt-homme/white). Got product=${design.product} color=${design.color}`,
      });
    }

    let compositeMockupMod;
    try {
      compositeMockupMod = require('../utils/compositeMockup');
    } catch (e) {
      return res.status(500).json({ error: 'Module compositeMockup absent : ' + e.message });
    }

    // Décodage base64 → Buffer
    const toBuf = (b64) => {
      const data = (b64 || '').replace(/^data:image\/\w+;base64,/, '');
      return data ? Buffer.from(data, 'base64') : null;
    };
    const designFront = toBuf(design_front_b64);
    const designBack  = toBuf(design_back_b64);

    try {
      const { paths, errors } = await compositeMockupMod.generateAllMockups({
        designId,
        designFront, designBack,
        product: productKey, color: colorKey,
      });

      const APP_URL = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
      // Les fichiers sont écrits dans /data/renders/<design_id>/<key>.png mais
      // express.static('/uploads') ne couvre pas /data/renders. On expose donc via
      // /api/render/file/:design_id/:filename (route ajoutée plus bas).
      const urls = {};
      Object.keys(paths).forEach((k) => {
        urls[k] = `${APP_URL}/api/render/file/${designId}/${k}.png`;
      });

      // Persister mockup-cart en preview_cdn_url-friendly (pour l'admin)
      if (urls['mockup-cart']) {
        try {
          db.prepare('UPDATE designs SET render_url = ? WHERE id = ? AND shop_id = ?')
            .run(`/api/render/file/${designId}/mockup-cart.png`, designId, req.shopId);
        } catch (e) { /* tolérant */ }
      }

      res.json({ ok: true, urls, errors });
    } catch (err) {
      console.error('[render/cart-set]', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── GET /api/render/file/:design_id/:filename ─ servir les fichiers de /data/renders
// Sécurisé : pas de traversée (filename limité à [a-z0-9_.-]+).
router.get('/file/:design_id/:filename', (req, res) => {
  const { design_id, filename } = req.params;
  if (!/^[\w.-]+$/.test(filename) || !/^\d+$/.test(design_id)) {
    return res.status(400).end();
  }
  const filepath = path.join(DATA_DIR, 'renders', design_id, filename);
  if (!fs.existsSync(filepath)) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filepath);
});

// ── GET /api/render/download/:design_id ── téléchargement direct (scopé shop, doit être avant /:design_id)
// Par défaut, le PNG est croppé sur la bounding box du contenu non-transparent (sharp.trim)
// pour livrer un fichier "bord à bord" prêt pour l'impression. Pass ?raw=1 pour récupérer
// l'original sans crop (utile debug ou si le trim coupe trop).
router.get('/download/:design_id', attachShopId, async (req, res) => {
  const db = getDB();
  let design;
  try {
    design = db.prepare('SELECT id, name, render_url FROM designs WHERE id=? AND shop_id=?').get(req.params.design_id, req.shopId);
  } catch(e) {
    return res.status(404).json({ error: 'Design introuvable' });
  }
  if (!design?.render_url) {
    return res.status(404).json({ error: 'Aucun render HD disponible pour ce design' });
  }
  const filepath = path.join(DATA_DIR, design.render_url);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Fichier introuvable sur le disque' });
  }

  // ── Mode raw : on renvoie le fichier brut (sans crop) ──────────────────
  if (req.query.raw === '1') {
    return res.download(filepath, path.basename(filepath));
  }

  // ── Mode défaut : crop bord à bord du visuel (impression) ──────────────
  try {
    const sharp = require('sharp');
    // trim() : enlève les bords uniformes/transparents.
    // threshold:0 = découpe au plus serré ; on garde 0 pour le PNG transparent.
    // background : couleur de référence (transparent ici, défaut OK pour PNG RGBA).
    const buffer = await sharp(filepath)
      .trim({ threshold: 0 })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const safeName = (design.name || `design_${design.id}`).replace(/[^\w.-]+/g, '_');
    const outName  = `${safeName}_print.png`;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  } catch (err) {
    console.error('[render/download] sharp.trim failed, fallback raw:', err.message);
    // Fallback : si le trim échoue (image vide, format non supporté…), on sert l'original.
    return res.download(filepath, path.basename(filepath));
  }
});

// ── GET /api/render/:design_id ──
// • Sans ?json=1  → redirection 302 vers l'image PNG absolue (cliquable depuis email/admin)
// • Avec  ?json=1 → réponse JSON avec URL absolue (rétro-compat API)
// Scoping soft : si un shop est résolvable, on filtre ; sinon on autorise (ex : email transactionnel
// qui pointe vers /api/render/:id sans contexte shop).
router.get('/:design_id', attachShopIdSoft, (req, res) => {
  const db  = getDB();
  let design;
  try {
    if (req.shopId) {
      design = db.prepare('SELECT id, render_url, render_size_kb, preview_cdn_url FROM designs WHERE id=? AND shop_id=?')
                 .get(req.params.design_id, req.shopId);
    } else {
      design = db.prepare('SELECT id, render_url, render_size_kb, preview_cdn_url FROM designs WHERE id=?')
                 .get(req.params.design_id);
    }
  } catch(e) {
    return res.json({ render_url: null });
  }
  if (!design) return res.status(404).json({ error: 'Design introuvable' });

  const APP_URL     = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
  const relativeUrl = design.render_url || null;
  const absoluteUrl = relativeUrl
    ? (relativeUrl.startsWith('http') ? relativeUrl : `${APP_URL}${relativeUrl}`)
    : null;
  // Préférer l'URL CDN Shopify si disponible
  const previewUrl = design.preview_cdn_url || absoluteUrl;

  if (req.query.json === '1' || !absoluteUrl) {
    return res.json({
      design_id:      design.id,
      render_url:     absoluteUrl,
      preview_url:    previewUrl,
      render_size_kb: design.render_size_kb || null,
    });
  }

  res.redirect(302, previewUrl || absoluteUrl);
});

module.exports = router;
