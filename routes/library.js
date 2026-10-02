'use strict';
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { requireAuth } = require('./auth');
const { getDB } = require('../db/database');
const { attachShopId } = require('./_shop-context');
const DL = require('../utils/design-library');

/**
 * Dimensions en pixels d'une image sur disque.
 * ──────────────────────────────────────────────────────────────────────────
 * Elles servent à décider si un visuel tient correctement dans la zone
 * d'impression d'un support. sharp est déjà une dépendance du projet
 * (utils/compositeMockup.js) et sait lire les en-têtes sans décoder l'image.
 *
 * @returns {Promise<{width:number,height:number}|null>} null si illisible —
 *          un visuel sans dimensions connues reste proposé partout.
 */
async function _lireDimensions(cheminAbsolu) {
  try {
    const sharp = require('sharp');
    const m = await sharp(cheminAbsolu).metadata();
    return (m.width > 0 && m.height > 0) ? { width: m.width, height: m.height } : null;
  } catch { return null; }
}

const DEFAULT_CATEGORIES = ['logos', 'illustrations', 'patterns', 'textes', 'divers', 'Dall-E'];

// Multer storage — fichier original HD
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'library');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB pour les HD
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

// ── Copier l'original comme thumbnail ──────────────────────────────────────
function generateThumb(srcPath, thumbPath) {
  fs.copyFileSync(srcPath, thumbPath);
}

// GET /api/library/categories — scopé shop
router.get('/categories', attachShopId, (req, res) => {
  const db = getDB();
  // Union: table categories + catégories distinctes des images du shop
  const fromTable = db
    .prepare("SELECT name FROM categories WHERE shop_id=? ORDER BY name")
    .all(req.shopId)
    .map(r => r.name);
  const fromItems = db
    .prepare("SELECT DISTINCT category FROM library WHERE shop_id=? AND filename NOT LIKE '__cat_placeholder_%' ORDER BY category")
    .all(req.shopId)
    .map(r => r.category)
    .filter(Boolean);
  const merged = [...new Set([...fromTable, ...fromItems])].sort();
  res.json(merged);
});

// POST /api/library/categories — crée une catégorie (admin, scopé shop)
// Audit N2 : requireAuth ajouté (création réservée à l'admin, comme les routes
// soeurs POST/PATCH/DELETE ci-dessous). Le studio storefront ne fait que des GET.
router.post('/categories', requireAuth, attachShopId, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const db = getDB();
  const existing = db.prepare('SELECT id FROM categories WHERE name=? AND shop_id=?').get(name, req.shopId);
  if (existing) return res.status(409).json({ error: 'Catégorie déjà existante', category: name });
  const info = db.prepare('INSERT INTO categories (shop_id, name) VALUES (?, ?)').run(req.shopId, name);
  res.status(201).json({ id: info.lastInsertRowid, category: name });
});

// DELETE /api/library/categories/:name — supprime une catégorie VIDE (admin)
// Refuse (409) si des images l'utilisent encore : les déplacer/supprimer
// d'abord — aucune perte de données silencieuse. Nettoie aussi les
// placeholders internes (__cat_placeholder_%) de cette catégorie.
router.delete('/categories/:name', requireAuth, attachShopId, (req, res) => {
  const name = String(req.params.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const db = getDB();
  const count = db.prepare(
    "SELECT COUNT(*) AS n FROM library WHERE shop_id=? AND category=? AND filename NOT LIKE '__cat_placeholder_%'"
  ).get(req.shopId, name).n;
  if (count > 0) {
    return res.status(409).json({
      error: `La catégorie contient encore ${count} image(s) — déplacez-les ou supprimez-les d'abord.`,
      count,
    });
  }
  db.prepare("DELETE FROM library WHERE shop_id=? AND category=? AND filename LIKE '__cat_placeholder_%'")
    .run(req.shopId, name);
  db.prepare('DELETE FROM categories WHERE shop_id=? AND name=?').run(req.shopId, name);
  res.json({ deleted: true, category: name });
});

// GET /api/library — exclut les cat_placeholder côté serveur (scopé shop)
// GET /api/library — visuels du shop.
//   ?category=…  filtre sur une catégorie
//   ?all=1       inclut les visuels désactivés (back-office uniquement)
//
// Par DÉFAUT les visuels désactivés sont masqués : cette route alimente aussi
// le studio côté client, et « désactivé » doit y signifier « plus proposé à la
// vente » sans qu'il faille supprimer le fichier.
//
// Tri : sort_order croissant d'abord (l'admin met ses meilleurs visuels en
// tête), puis le plus récent — ce qui préserve l'ordre historique tant que
// personne n'a réordonné quoi que ce soit (sort_order vaut 0 partout).
router.get('/', attachShopId, (req, res) => {
  const db = getDB();
  const { category, limit = 200 } = req.query;
  const tous = String(req.query.all || '') === '1';

  const where = ["shop_id=?", "filename NOT LIKE '__cat_placeholder_%'"];
  const args  = [req.shopId];
  if (category) { where.push('category=?'); args.push(category); }
  if (!tous)    { where.push('is_active=1'); }
  args.push(Number(limit));

  const rows = db.prepare(
    `SELECT * FROM library WHERE ${where.join(' AND ')}
     ORDER BY sort_order ASC, created_at DESC LIMIT ?`
  ).all(...args);

  res.json(rows.map(_exposeRow));
});

/** Ligne SQL → objet d'API : les colonnes JSON sortent en tableaux. */
function _exposeRow(row) {
  return {
    ...row,
    is_active: row.is_active == null ? 1 : Number(row.is_active),
    tags: DL.parseJsonArray(row.tags),
    excluded_mockups: DL.parseJsonArray(row.excluded_mockups),
  };
}

/**
 * Le catalogue proposé sur les fiches produit est mis en cache deux minutes.
 * Toute écriture sur la bibliothèque doit le purger, sinon un visuel masqué
 * resterait en vente le temps que le cache expire.
 * require() paresseux : évite un cycle entre les deux routeurs.
 */
function _purgerCatalogue() {
  try { require('./product-designs').viderCacheDesigns(); } catch {}
}

/** Slugs déjà utilisés dans cette boutique (pour garantir l'unicité). */
function _slugsPris(db, shopId) {
  return new Set(
    db.prepare("SELECT slug FROM library WHERE shop_id=? AND slug <> ''").all(shopId).map(r => r.slug)
  );
}

// GET /api/library/by-ref/:ref — résout un visuel par son id ou son slug.
// ──────────────────────────────────────────────────────────────────────────
// PUBLIQUE : c'est par là que le studio récupère le visuel choisi sur la fiche
// produit, quand il est ouvert avec ?visual=<slug>. Le slug est l'adresse
// publique figée du visuel (cf. utils/design-library.js), l'id numérique reste
// accepté pour les appels internes.
//
// Un visuel retiré de la vente n'est pas résolu : un lien partagé vers un
// design que le marchand a dépublié doit se comporter comme un lien mort,
// pas ressusciter le design.
router.get('/by-ref/:ref', attachShopId, (req, res) => {
  const ref = String(req.params.ref || '').trim();
  if (!ref) return res.status(400).json({ error: 'Référence manquante' });

  const db = getDB();
  const row = /^\d+$/.test(ref)
    ? db.prepare('SELECT * FROM library WHERE shop_id=? AND id=? AND is_active=1').get(req.shopId, Number(ref))
    : db.prepare('SELECT * FROM library WHERE shop_id=? AND slug=? AND is_active=1').get(req.shopId, ref);

  if (!row) return res.status(404).json({ error: 'Visuel introuvable', exists: false });
  const v = _exposeRow(row);
  res.json({
    exists: true,
    id: v.id, slug: v.slug, nom: v.display_name,
    url: v.url, thumb: v.thumb_url || v.url,
    categorie: v.category, width: v.width, height: v.height,
  });
});

// POST /api/library — upload (admin + shop scopé)
const handleUpload = upload.single('file');

async function processUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const db  = getDB();
    const cat = (req.body.category || '').trim() || 'divers';
    const url = `/uploads/library/${req.file.filename}`;

    // Générer le thumbnail (copie de l'original — compression faite côté client)
    let thumbUrl = null;
    try {
      const thumbDir  = path.join(__dirname, '..', 'uploads', 'library', 'thumbs');
      fs.mkdirSync(thumbDir, { recursive: true });
      const origExt   = path.extname(req.file.filename);
      const thumbName = path.basename(req.file.filename, origExt) + '_thumb' + origExt;
      const thumbPath = path.join(thumbDir, thumbName);
      generateThumb(req.file.path, thumbPath);
      thumbUrl = `/uploads/library/thumbs/${thumbName}`;
    } catch(e) {
      console.warn('Thumb copy failed (non-bloquant):', e.message);
    }

    // S'assurer que la catégorie est enregistrée dans la table categories (scopée shop)
    try { db.prepare('INSERT OR IGNORE INTO categories (shop_id, name) VALUES (?, ?)').run(req.shopId, cat); } catch {}

    // Le nom stocké par multer est horodaté ; c'est le nom d'origine choisi
    // par l'admin qui fait un libellé lisible côté boutique.
    const nom  = DL.displayNameFromFilename(req.file.originalname) || 'Nouveau visuel';
    const slug = DL.uniqueSlug(nom, _slugsPris(db, req.shopId));
    const dim  = await _lireDimensions(req.file.path);

    const info = db.prepare(
      `INSERT INTO library (shop_id, filename, url, thumb_url, category, mimetype, size, slug, display_name, width, height)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(req.shopId, req.file.filename, url, thumbUrl, cat, req.file.mimetype, req.file.size, slug, nom,
          dim?.width ?? null, dim?.height ?? null);

    _purgerCatalogue();
    res.status(201).json({
      ..._exposeRow(db.prepare('SELECT * FROM library WHERE id=?').get(info.lastInsertRowid)),
      original_name: req.file.originalname,
    });
  } catch(e) {
    console.error('processUpload error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

// POST /api/library/external — enregistre un visuel déjà hébergé ailleurs
// (Shopify Files / CDN). Aucun octet ne transite ni n'est stocké côté Railway :
// on ne persiste que l'URL absolue renvoyée par Shopify. Utilisé par la modale
// « Fichiers Shopify » du back-office (cf. public/textilelab-admin.html).
router.post('/external', requireAuth, attachShopId, (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!/^https:\/\/[^\s]+$/i.test(url)) {
    return res.status(400).json({ error: 'URL https absolue requise' });
  }
  const filename = String(req.body?.filename || '').trim() || url.split('/').pop().split('?')[0];
  const cat      = String(req.body?.category || '').trim() || 'divers';
  const thumbUrl = String(req.body?.thumb_url || '').trim() || url;
  const mimetype = String(req.body?.mimetype || '').trim() || 'image/*';
  const size     = Number(req.body?.size) || 0;

  try {
    const db = getDB();
    // Idempotence : une même URL Shopify ne doit pas créer de doublon si
    // l'admin la resélectionne dans la grille.
    const existing = db.prepare('SELECT * FROM library WHERE shop_id=? AND url=?').get(req.shopId, url);
    if (existing) return res.status(200).json({ ..._exposeRow(existing), duplicate: true });

    try { db.prepare('INSERT OR IGNORE INTO categories (shop_id, name) VALUES (?, ?)').run(req.shopId, cat); } catch {}

    const nom  = String(req.body?.display_name || '').trim()
              || DL.displayNameFromFilename(filename)
              || 'Nouveau visuel';
    const slug = DL.uniqueSlug(nom, _slugsPris(db, req.shopId));
    // Shopify connaît les dimensions de ses MediaImage : la modale les joint.
    const w = Number.parseInt(req.body?.width, 10);
    const h = Number.parseInt(req.body?.height, 10);

    const info = db.prepare(
      `INSERT INTO library (shop_id, filename, url, thumb_url, category, mimetype, size, slug, display_name, width, height)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(req.shopId, filename, url, thumbUrl, cat, mimetype, size, slug, nom,
          w > 0 ? w : null, h > 0 ? h : null);

    _purgerCatalogue();
    res.status(201).json(_exposeRow(db.prepare('SELECT * FROM library WHERE id=?').get(info.lastInsertRowid)));
  } catch (e) {
    console.error('library/external error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const _upload = (req, res) => handleUpload(req, res, err => {
  if (err) return res.status(400).json({ error: err.message });
  // processUpload est asynchrone depuis la lecture des dimensions : on capte
  // son rejet ici, sinon une erreur partirait en unhandledRejection.
  processUpload(req, res).catch(e => {
    console.error('processUpload error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  });
});
router.post('/',       requireAuth, attachShopId, _upload);
router.post('/upload', requireAuth, attachShopId, _upload);

// PATCH /api/library/:id (admin, scopé shop)
// Champs acceptés : category, display_name, sort_order, is_active, tags,
// excluded_mockups. Tout champ absent du corps reste inchangé.
//
// Le `slug` n'est JAMAIS modifiable directement : il sert d'adresse publique
// (?design=money-control) et le casser casserait les liens partagés. Seule
// exception, un slug encore provisoire (cf. isPlaceholderSlug) se recalcule au
// premier vrai renommage — à ce stade il n'a pu être partagé par personne.
router.patch('/:id', requireAuth, attachShopId, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT * FROM library WHERE id=? AND shop_id=?').get(req.params.id, req.shopId);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const b = req.body || {};
  const maj = {};

  if (typeof b.category === 'string' && b.category.trim()) {
    maj.category = b.category.trim();
    try { db.prepare('INSERT OR IGNORE INTO categories (shop_id, name) VALUES (?, ?)').run(req.shopId, maj.category); } catch {}
  }
  if (typeof b.display_name === 'string') {
    const nom = b.display_name.trim();
    if (!nom) return res.status(400).json({ error: 'Le nom affiché ne peut pas être vide' });
    maj.display_name = nom.slice(0, 120);
    if (!row.slug || DL.isPlaceholderSlug(row.slug)) {
      const pris = _slugsPris(db, req.shopId);
      pris.delete(row.slug);
      maj.slug = DL.uniqueSlug(maj.display_name, pris, `visuel-${row.id}`);
    }
  }
  if (b.sort_order !== undefined) {
    const n = Number.parseInt(b.sort_order, 10);
    if (!Number.isInteger(n)) return res.status(400).json({ error: 'sort_order invalide' });
    maj.sort_order = n;
  }
  if (b.is_active !== undefined) {
    maj.is_active = (b.is_active === true || b.is_active === 1 || b.is_active === '1') ? 1 : 0;
  }
  if (b.tags !== undefined) {
    maj.tags = JSON.stringify(DL.normalizeTags(b.tags));
  }
  if (b.excluded_mockups !== undefined) {
    maj.excluded_mockups = JSON.stringify(DL.normalizeExclusions(b.excluded_mockups));
  }

  const champs = Object.keys(maj);
  if (!champs.length) return res.json(_exposeRow(row));

  db.prepare(`UPDATE library SET ${champs.map(c => `${c}=?`).join(', ')} WHERE id=? AND shop_id=?`)
    .run(...champs.map(c => maj[c]), req.params.id, req.shopId);

  _purgerCatalogue();
  res.json(_exposeRow(db.prepare('SELECT * FROM library WHERE id=? AND shop_id=?').get(req.params.id, req.shopId)));
});

// POST /api/library/reorder — ordre d'affichage en une seule requête (admin).
// Corps : { ids: [12, 7, 30, …] } — la position dans le tableau devient
// sort_order. Les visuels absents du tableau ne sont pas touchés.
router.post('/reorder', requireAuth, attachShopId, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!ids) return res.status(400).json({ error: 'ids (tableau) requis' });
  if (ids.length > 2000) return res.status(400).json({ error: 'Trop d\'éléments' });

  const db  = getDB();
  const maj = db.prepare('UPDATE library SET sort_order=? WHERE id=? AND shop_id=?');
  let n = 0;
  const tout = db.transaction(() => {
    ids.forEach((raw, i) => {
      const id = Number.parseInt(raw, 10);
      if (!Number.isInteger(id)) return;
      n += maj.run(i, id, req.shopId).changes;
    });
  });
  tout();
  _purgerCatalogue();
  res.json({ reordered: n });
});

// DELETE /api/library/:id (admin, scopé shop)
router.delete('/:id', requireAuth, attachShopId, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT * FROM library WHERE id=? AND shop_id=?').get(req.params.id, req.shopId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  // Visuel hébergé sur un CDN externe (Shopify Files) : rien à supprimer sur
  // le disque. Le fichier reste dans Shopify → Contenu → Fichiers, où le
  // marchand le gère lui-même (il peut être réutilisé ailleurs dans la boutique).
  const isExternal = /^https?:\/\//i.test(row.url || '');
  if (!isExternal) {
    try { fs.unlinkSync(path.join(__dirname, '..', row.url)); } catch {}
    if (row.thumb_url) {
      try { fs.unlinkSync(path.join(__dirname, '..', row.thumb_url)); } catch {}
    }
  }
  db.prepare('DELETE FROM library WHERE id=? AND shop_id=?').run(req.params.id, req.shopId);
  _purgerCatalogue();
  res.json({ deleted: true });
});

// ── Migration auto : copier les thumbs manquants au démarrage ────────────
// (Indépendant du shop : balaye toutes les lignes quel que soit shop_id)
setTimeout(() => {
  try {
    const db      = getDB();
    const missing = db.prepare(
      "SELECT * FROM library WHERE (thumb_url IS NULL OR thumb_url='') AND filename NOT LIKE '__cat_placeholder%'"
    ).all();
    if (!missing.length) return;
    console.log(`📸 Thumbs manquants : ${missing.length} image(s)…`);
    const thumbDir = path.join(__dirname, '..', 'uploads', 'library', 'thumbs');
    fs.mkdirSync(thumbDir, { recursive: true });
    let ok = 0;
    for (const item of missing) {
      if (/^https?:\/\//i.test(item.url || '')) continue; // visuel CDN externe
      const srcPath = path.join(__dirname, '..', item.url);
      if (!fs.existsSync(srcPath)) continue;
      const origExt   = path.extname(item.filename);
      const thumbName = path.basename(item.filename, origExt) + '_thumb' + origExt;
      const thumbPath = path.join(thumbDir, thumbName);
      const thumbUrl  = `/uploads/library/thumbs/${thumbName}`;
      try {
        fs.copyFileSync(srcPath, thumbPath);
        db.prepare("UPDATE library SET thumb_url=? WHERE id=?").run(thumbUrl, item.id);
        ok++;
      } catch(e) { /* silencieux */ }
    }
    if (ok) console.log(`✅ ${ok} thumb(s) copiés`);
  } catch(e) { /* silencieux */ }
}, 2000);

// ── Migration auto : dimensions manquantes au démarrage ──────────────────
// Ne concerne que les visuels stockés localement : pour un visuel hébergé sur
// un CDN externe, les dimensions arrivent de Shopify au moment de l'ajout.
// Lecture d'en-tête seulement (sharp ne décode pas l'image), par petits
// paquets pour ne pas monopoliser le démarrage.
setTimeout(async () => {
  try {
    const db = getDB();
    const aFaire = db.prepare(
      "SELECT id, url FROM library WHERE width IS NULL AND filename NOT LIKE '__cat_placeholder%'"
    ).all().filter(r => !/^https?:\/\//i.test(r.url || ''));
    if (!aFaire.length) return;
    console.log(`📐 Dimensions manquantes : ${aFaire.length} visuel(s)…`);
    const maj = db.prepare('UPDATE library SET width=?, height=? WHERE id=?');
    let ok = 0;
    for (const r of aFaire) {
      const dim = await _lireDimensions(path.join(__dirname, '..', r.url));
      if (dim) { maj.run(dim.width, dim.height, r.id); ok++; }
    }
    if (ok) console.log(`✅ ${ok} visuel(s) mesuré(s)`);
  } catch (e) {
    console.warn('Mesure des visuels ignorée :', e.message);
  }
}, 4000);

module.exports = router;
