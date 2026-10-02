'use strict';
/**
 * routes/product-designs.js — Quels visuels proposer sur une fiche produit.
 * ──────────────────────────────────────────────────────────────────────────
 * Le client final choisit son design depuis la page produit, sans que le
 * marchand ait eu à décliner 50 produits × 200 visuels dans Shopify. Cette
 * route répond à la seule question que pose la vitrine : « pour CE produit,
 * quels visuels de la bibliothèque ont du sens ? »
 *
 * Le filtrage se fait en trois temps, du moins coûteux au plus coûteux :
 *   1. le visuel est-il proposé à la vente (`is_active`) ;
 *   2. le marchand a-t-il exclu ce support à la main (`excluded_mockups`) ;
 *   3. la règle automatique tient-elle (résolution et proportions dans la
 *      zone d'impression du mockup) — cf. utils/design-library.js.
 *
 * Principe directeur : on n'écarte jamais un visuel faute de données. Produit
 * non lié à un mockup, mockup sans zone calibrée, visuel sans dimensions
 * connues → tout passe. Un catalogue trop large est un inconvénient ; un
 * catalogue amputé sans explication est un bug invisible.
 *
 * Route PUBLIQUE : appelée depuis le thème via l'App Proxy, donc sans session
 * admin. Le shop est résolu comme dans routes/storefront.js (X-Shop-Domain
 * ou ?shop), par `attachShopId`.
 */

const express = require('express');
const router  = express.Router();
const { attachShopId } = require('./_shop-context');
const { getDB }        = require('../db/database');
const DL               = require('../utils/design-library');

// Le catalogue bouge rarement et la fiche produit est une page chaude : un
// cache court évite de refaire le calcul à chaque visiteur. Clé par
// (shop, produit, vue).
const CACHE_MS = 2 * 60 * 1000;
const _cache = new Map();

function _cacheLire(cle) {
  const e = _cache.get(cle);
  if (!e) return null;
  if (Date.now() - e.t > CACHE_MS) { _cache.delete(cle); return null; }
  return e.v;
}
function _cacheEcrire(cle, v) {
  // Garde-fou mémoire : au-delà de 200 entrées on repart de zéro plutôt que
  // de laisser la map grossir indéfiniment sur une boutique à gros catalogue.
  if (_cache.size > 200) _cache.clear();
  _cache.set(cle, { t: Date.now(), v });
}

/** Vide le cache (appelé quand la bibliothèque change). */
function viderCacheDesigns() { _cache.clear(); }

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products/:productId/designs
// ─────────────────────────────────────────────────────────────────────────────
// Réponse :
//   { productId, mockupId, viewIndex, zone, total, designs: [...],
//     ecartes: [{ id, nom, raison, dpi, remplissage }] }
//
// `ecartes` n'est pas du débogage de luxe : c'est ce qui permet de régler les
// seuils de la règle sur de vrais mockups plutôt qu'au jugé.
router.get('/products/:productId/designs', attachShopId, (req, res) => {
  const productId = String(req.params.productId || '').replace(/\D/g, '');
  if (!productId) return res.status(400).json({ error: 'productId invalide' });

  const viewIndex = Math.max(0, Number.parseInt(req.query.view, 10) || 0);
  const cle = `${req.shopId}:${productId}:${viewIndex}`;
  const cached = _cacheLire(cle);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const db = getDB();

    // 1. Produit → mockup lié. Pas de liaison : aucun support à vérifier, on
    //    renvoie tout le catalogue actif.
    //
    //    La colonne mélange deux écritures selon l'époque de la liaison : des
    //    identifiants numériques et des GID complets
    //    ("gid://shopify/Product/10743954145607"). Le thème, lui, ne connaîtra
    //    que {{ product.id }}, numérique. On interroge donc les deux formes.
    const lien = db.prepare(
      `SELECT mockup_id FROM product_mockup_links
       WHERE shop_id=? AND (shopify_product_id=? OR shopify_product_id=?)`
    ).get(req.shopId, productId, `gid://shopify/Product/${productId}`);
    const mockupId = lien?.mockup_id || null;

    // 2. Zone d'impression de la vue demandée, et format retenu pour ce
    //    support. `defaultFormat` n'existe pas encore dans l'admin : tant
    //    qu'il n'est pas posé, A4 s'applique — le choix d'Alan pour le
    //    sélecteur de la fiche produit.
    let zoneMm = null, format = DL.FORMAT_PAR_DEFAUT;
    if (mockupId) {
      const m = db.prepare('SELECT views_json FROM mockups WHERE id=? AND shop_id=?')
                  .get(mockupId, req.shopId);
      let vues = [];
      try { vues = JSON.parse(m?.views_json || '[]'); } catch { vues = []; }
      const vue = vues[viewIndex];
      zoneMm = DL.zoneEnMm(vue);
      if (vue && DL.FORMATS_MM[vue.defaultFormat]) format = vue.defaultFormat;
    }

    // 3. Visuels proposés à la vente, dans l'ordre choisi par le marchand.
    const visuels = db.prepare(`
      SELECT id, slug, display_name, filename, url, thumb_url, category, tags,
             excluded_mockups, width, height, sort_order
      FROM library
      WHERE shop_id=? AND is_active=1 AND filename NOT LIKE '__cat_placeholder_%'
      ORDER BY sort_order ASC, created_at DESC
    `).all(req.shopId);

    const designs = [];
    const ecartes = [];

    for (const v of visuels) {
      if (mockupId && DL.parseJsonArray(v.excluded_mockups).map(Number).includes(Number(mockupId))) {
        ecartes.push({ id: v.id, nom: v.display_name, raison: 'exclu-manuellement', dpi: null, remplissage: null });
        continue;
      }
      const verdict = DL.evaluerCompatibilite(v, zoneMm, { format });
      if (!verdict.compatible) {
        ecartes.push({ id: v.id, nom: v.display_name, raison: verdict.raison, dpi: verdict.dpi, remplissage: verdict.remplissage });
        continue;
      }
      designs.push({
        id:        v.id,
        slug:      v.slug,
        nom:       v.display_name,
        url:       v.url,
        thumb:     v.thumb_url || v.url,
        categorie: v.category,
        tags:      DL.parseJsonArray(v.tags),
        width:     v.width,
        height:    v.height,
      });
    }

    const corps = {
      productId,
      mockupId,
      viewIndex,
      zone:  zoneMm,
      format,
      total: designs.length,
      categories: [...new Set(designs.map(d => d.categorie).filter(Boolean))],
      designs,
      ecartes,
    };
    _cacheEcrire(cle, corps);
    res.json(corps);
  } catch (e) {
    console.error('GET /products/:id/designs :', e.message);
    // Jamais de liste vide silencieuse : le thème doit pouvoir distinguer
    // « aucun design ne convient » de « le serveur n'a pas pu répondre ».
    res.status(500).json({ error: 'Lecture du catalogue impossible', designs: null });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products/:productId/preview?design=<slug|id>&view=0
// ─────────────────────────────────────────────────────────────────────────────
// Le vêtement avec le design dessus. Sans ça, le client choisit un visuel sans
// voir ce qu'il achète.
//
// On réutilise le moteur de compositing du back-office (routes/mockup-gen.js) :
// même displacement map, mêmes plis du tissu, donc un aperçu fidèle plutôt
// qu'une image collée à plat. Il tourne en 900 px et non en 2000 : c'est une
// vignette de fiche produit, pas un fichier d'impression.
//
// Le résultat est écrit sur disque et la requête redirige vers le fichier
// statique. Les visites suivantes ne repassent plus par ce calcul, qui coûte
// une bonne seconde de CPU.
const fs   = require('fs');
const path = require('path');
const APERCU_TAILLE = 900;
const APERCU_MARGE  = 0.9; // même marge que centerObjectInPrintFrame dans le studio
const APERCU_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'uploads', 'generated', 'apercus');

// Deux visiteurs peuvent demander le même aperçu en même temps : sans ce
// registre, on paierait le compositing deux fois.
const _enCours = new Map();

function _versBuffer(dataUrl) {
  return Buffer.from(String(dataUrl || '').replace(/^data:image\/\w+;base64,/, ''), 'base64');
}

/** Octets d'un visuel, qu'il soit sur le disque local ou sur un CDN. */
async function _octetsDuVisuel(url) {
  if (/^https?:\/\//i.test(url)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`visuel distant HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  const base = process.env.DATA_DIR || path.join(__dirname, '..');
  return fs.promises.readFile(path.join(base, url));
}

/**
 * Pose le visuel au centre d'un calque transparent aux dimensions de la zone.
 *
 * generateMockup étire ce qu'on lui donne aux dimensions de la zone : lui
 * passer le visuel brut le déformerait. On le place donc « contenu », à la
 * même marge que le studio quand il dépose une image dans le cadre — l'aperçu
 * montre ainsi exactement ce que le client verra en cliquant Personnaliser.
 */
async function _calquePourZone(octets, zone) {
  const sharp = require('sharp');
  const dispoW = Math.max(1, Math.round(zone.w * APERCU_MARGE));
  const dispoH = Math.max(1, Math.round(zone.h * APERCU_MARGE));
  const visuel = await sharp(octets)
    .resize(dispoW, dispoH, { fit: 'inside', withoutEnlargement: false })
    .ensureAlpha()
    .png()
    .toBuffer();
  const m = await sharp(visuel).metadata();
  return sharp({
    create: { width: zone.w, height: zone.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{
      input: visuel,
      left:  Math.max(0, Math.round((zone.w - m.width) / 2)),
      top:   Math.max(0, Math.round((zone.h - m.height) / 2)),
    }])
    .png()
    .toBuffer();
}

router.get('/products/:productId/preview', attachShopId, async (req, res) => {
  const productId = String(req.params.productId || '').replace(/\D/g, '');
  const ref       = String(req.query.design || '').trim();
  const viewIndex = Math.max(0, Number.parseInt(req.query.view, 10) || 0);
  if (!productId || !ref) return res.status(400).json({ error: 'productId et design requis' });

  try {
    const db = getDB();

    const visuel = /^\d+$/.test(ref)
      ? db.prepare('SELECT * FROM library WHERE shop_id=? AND id=? AND is_active=1').get(req.shopId, Number(ref))
      : db.prepare('SELECT * FROM library WHERE shop_id=? AND slug=? AND is_active=1').get(req.shopId, ref);
    if (!visuel) return res.status(404).json({ error: 'Visuel introuvable' });

    const lien = db.prepare(
      `SELECT mockup_id FROM product_mockup_links
       WHERE shop_id=? AND (shopify_product_id=? OR shopify_product_id=?)`
    ).get(req.shopId, productId, `gid://shopify/Product/${productId}`);
    if (!lien?.mockup_id) return res.status(404).json({ error: 'Produit sans mockup lié' });

    const fichier = `a${req.shopId}_m${lien.mockup_id}_v${viewIndex}_d${visuel.id}.png`;
    const chemin  = path.join(APERCU_DIR, fichier);
    const publique = `/uploads/generated/apercus/${fichier}`;

    if (fs.existsSync(chemin)) return res.redirect(302, publique);
    if (_enCours.has(fichier)) { await _enCours.get(fichier); return res.redirect(302, publique); }

    const travail = (async () => {
      const MG = require('./mockup-gen');
      const sharp = require('sharp');
      const m = db.prepare('SELECT views_json FROM mockups WHERE id=? AND shop_id=?')
                  .get(lien.mockup_id, req.shopId);
      let vues = [];
      try { vues = JSON.parse(m?.views_json || '[]'); } catch { vues = []; }
      const vue = vues[viewIndex];
      if (!vue?.imageData || !vue.zone?.w) throw new Error('Vue de mockup inexploitable');

      const mockupBuffer = _versBuffer(vue.imageData);
      const meta = await sharp(mockupBuffer).metadata();
      const zone = MG.zoneVersSortie(vue.zone, meta.width, meta.height, APERCU_TAILLE);
      const calque = await _calquePourZone(await _octetsDuVisuel(visuel.url), zone);

      const png = await MG.generateMockup({
        designBuffer: calque,
        mockupBuffer,
        naturalW: meta.width,
        naturalH: meta.height,
        zone,
        dispIntensity: MG.DISP_INTENSITY,
        outputSize: APERCU_TAILLE,
      });
      await fs.promises.mkdir(APERCU_DIR, { recursive: true });
      await fs.promises.writeFile(chemin, png);
    })();

    _enCours.set(fichier, travail);
    try { await travail; } finally { _enCours.delete(fichier); }
    res.redirect(302, publique);
  } catch (e) {
    console.error('GET /products/:id/preview :', e.message);
    res.status(500).json({ error: 'Aperçu indisponible' });
  }
});

module.exports = router;
module.exports.viderCacheDesigns = viderCacheDesigns;
