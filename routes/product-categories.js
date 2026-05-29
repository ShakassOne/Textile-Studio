/**
 * /api/product-categories
 * CRUD pour les catégories de produits TextileLab (scopé multi-tenant)
 */
const express      = require('express');
const router       = express.Router();
const multer       = require('multer');
const path         = require('path');
const fs           = require('fs');
const { getDB }    = require('../db/database');
const { requireAuth } = require('./auth');
const { attachShopId } = require('./_shop-context');

// ── Multer storage pour les images de catégories ──────────────────────────
const CATEGORIES_DIR = path.join(__dirname, '..', 'uploads', 'categories');
fs.mkdirSync(CATEGORIES_DIR, { recursive: true });

const catStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CATEGORIES_DIR),
  filename:    (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `cat_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});
const catUpload = multer({
  storage: catStorage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'];
    const ok = allowed.includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Format non supporté (png/jpg/webp/svg/gif uniquement)'), ok);
  },
});

// ── GET / — liste les catégories du shop courant ──────────────────────────
router.get('/', attachShopId, (req, res) => {
  const db   = getDB();
  const cats = db.prepare('SELECT * FROM product_categories WHERE shop_id=? ORDER BY sort_order, id').all(req.shopId);
  res.json(cats);
});

// ── POST / — créer une nouvelle catégorie (auth, scopé shop) ──────────────
router.post('/', requireAuth, attachShopId, (req, res) => {
  const { name, emoji = '📦', image_url = '' } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Le champ "name" est requis' });

  // Générer une clé slug depuis le nom
  const key = name.trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // accents
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 40);

  if (!key) return res.status(400).json({ error: 'Nom invalide (impossible de générer une clé)' });

  const db       = getDB();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM product_categories WHERE shop_id=?').get(req.shopId)?.m ?? -1;

  // Vérifier conflit de clé pour CE shop (la contrainte UNIQUE existante est globale ;
  // tant qu'on n'a pas migré la table en UNIQUE(shop_id,key), on fait le check applicatif).
  const dup = db.prepare('SELECT id FROM product_categories WHERE shop_id=? AND key=?').get(req.shopId, key);
  if (dup) return res.status(409).json({ error: `La clé "${key}" existe déjà — choisissez un nom différent` });

  try {
    const info = db.prepare(
      'INSERT INTO product_categories (shop_id, key, name, emoji, image_url, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.shopId, key, name.trim(), (emoji || '📦').trim(), (image_url || '').trim(), maxOrder + 1);

    const cat = db.prepare('SELECT * FROM product_categories WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(cat);
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `La clé "${key}" existe déjà — choisissez un nom différent` });
    }
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /:id — modifier nom, emoji et/ou image_url (auth, scopé shop) ─────
router.put('/:id', requireAuth, attachShopId, (req, res) => {
  const db  = getDB();
  const cat = db.prepare('SELECT * FROM product_categories WHERE id = ? AND shop_id=?').get(req.params.id, req.shopId);
  if (!cat) return res.status(404).json({ error: 'Catégorie introuvable' });

  const newName  = (req.body?.name  || '').trim() || cat.name;
  const newEmoji = (req.body?.emoji || '').trim() || cat.emoji;
  // image_url : on accepte la chaîne vide pour effacer explicitement
  const newImage = (typeof req.body?.image_url === 'string') ? req.body.image_url.trim() : cat.image_url;

  db.prepare('UPDATE product_categories SET name = ?, emoji = ?, image_url = ? WHERE id = ? AND shop_id=?')
    .run(newName, newEmoji, newImage, cat.id, req.shopId);

  res.json({ ...cat, name: newName, emoji: newEmoji, image_url: newImage });
});

// ── POST /:id/upload-image — upload d'une image pour la catégorie ─────────
router.post('/:id/upload-image', requireAuth, attachShopId, catUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  const db  = getDB();
  const cat = db.prepare('SELECT * FROM product_categories WHERE id=? AND shop_id=?').get(req.params.id, req.shopId);
  if (!cat) {
    // Nettoyer le fichier uploadé orphelin
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(404).json({ error: 'Catégorie introuvable' });
  }

  // Supprimer l'ancienne image si elle existe et est interne (uploads/)
  if (cat.image_url && cat.image_url.startsWith('/uploads/categories/')) {
    const old = path.join(__dirname, '..', cat.image_url);
    try { fs.unlinkSync(old); } catch {}
  }

  const url = `/uploads/categories/${req.file.filename}`;
  db.prepare('UPDATE product_categories SET image_url=? WHERE id=? AND shop_id=?').run(url, cat.id, req.shopId);

  const updated = db.prepare('SELECT * FROM product_categories WHERE id=?').get(cat.id);
  res.json(updated);
});

// ── DELETE /:id/image — retirer l'image d'une catégorie ───────────────────
router.delete('/:id/image', requireAuth, attachShopId, (req, res) => {
  const db  = getDB();
  const cat = db.prepare('SELECT * FROM product_categories WHERE id=? AND shop_id=?').get(req.params.id, req.shopId);
  if (!cat) return res.status(404).json({ error: 'Catégorie introuvable' });

  if (cat.image_url && cat.image_url.startsWith('/uploads/categories/')) {
    const old = path.join(__dirname, '..', cat.image_url);
    try { fs.unlinkSync(old); } catch {}
  }
  db.prepare("UPDATE product_categories SET image_url='' WHERE id=? AND shop_id=?").run(cat.id, req.shopId);
  res.json({ ok: true });
});

// ── PATCH /reorder — réordonner (auth, scopé shop) ────────────────────────
router.patch('/reorder', requireAuth, attachShopId, (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: '"order" doit être un tableau d\'IDs' });

  const db     = getDB();
  const update = db.prepare('UPDATE product_categories SET sort_order = ? WHERE id = ? AND shop_id=?');
  const tx     = db.transaction(() => { order.forEach((id, i) => update.run(i, id, req.shopId)); });
  tx();
  res.json({ ok: true });
});

// ── DELETE /:id — supprimer (auth, scopé shop) ────────────────────────────
router.delete('/:id', requireAuth, attachShopId, (req, res) => {
  const db  = getDB();
  const cat = db.prepare('SELECT * FROM product_categories WHERE id = ? AND shop_id=?').get(req.params.id, req.shopId);
  if (!cat) return res.status(404).json({ error: 'Catégorie introuvable' });

  // Vérifier si des mockups utilisent encore cette catégorie (dans le même shop)
  const { n } = db.prepare('SELECT COUNT(*) as n FROM mockups WHERE shop_id=? AND product = ?').get(req.shopId, cat.key);
  if (n > 0) {
    return res.status(409).json({
      error: `Impossible de supprimer : ${n} mockup(s) utilisent encore cette catégorie. Réassignez-les d'abord.`
    });
  }

  // Nettoyer l'image si elle existe
  if (cat.image_url && cat.image_url.startsWith('/uploads/categories/')) {
    const old = path.join(__dirname, '..', cat.image_url);
    try { fs.unlinkSync(old); } catch {}
  }

  db.prepare('DELETE FROM product_categories WHERE id = ? AND shop_id=?').run(cat.id, req.shopId);
  res.json({ ok: true });
});

module.exports = router;
