'use strict';
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { requireAuth } = require('./auth');
const { getDB } = require('../db/database');
const { attachShopId } = require('./_shop-context');

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

// POST /api/library/categories — crée une catégorie (scopé shop)
router.post('/categories', attachShopId, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const db = getDB();
  const existing = db.prepare('SELECT id FROM categories WHERE name=? AND shop_id=?').get(name, req.shopId);
  if (existing) return res.status(409).json({ error: 'Catégorie déjà existante', category: name });
  const info = db.prepare('INSERT INTO categories (shop_id, name) VALUES (?, ?)').run(req.shopId, name);
  res.status(201).json({ id: info.lastInsertRowid, category: name });
});

// GET /api/library — exclut les cat_placeholder côté serveur (scopé shop)
router.get('/', attachShopId, (req, res) => {
  const db = getDB();
  const { category, limit = 200 } = req.query;
  const rows = category
    ? db.prepare("SELECT * FROM library WHERE shop_id=? AND category=? AND filename NOT LIKE '__cat_placeholder_%' ORDER BY created_at DESC LIMIT ?").all(req.shopId, category, Number(limit))
    : db.prepare("SELECT * FROM library WHERE shop_id=? AND filename NOT LIKE '__cat_placeholder_%' ORDER BY created_at DESC LIMIT ?").all(req.shopId, Number(limit));
  res.json(rows);
});

// POST /api/library — upload (admin + shop scopé)
const handleUpload = upload.single('file');

function processUpload(req, res) {
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

    const info = db.prepare(
      'INSERT INTO library (shop_id, filename, url, thumb_url, category, mimetype, size) VALUES (?,?,?,?,?,?,?)'
    ).run(req.shopId, req.file.filename, url, thumbUrl, cat, req.file.mimetype, req.file.size);

    res.status(201).json({
      ...db.prepare('SELECT * FROM library WHERE id=?').get(info.lastInsertRowid),
      original_name: req.file.originalname,
    });
  } catch(e) {
    console.error('processUpload error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

router.post('/',       requireAuth, attachShopId, (req, res) => handleUpload(req, res, err => { if(err) return res.status(400).json({error:err.message}); processUpload(req, res); }));
router.post('/upload', requireAuth, attachShopId, (req, res) => handleUpload(req, res, err => { if(err) return res.status(400).json({error:err.message}); processUpload(req, res); }));

// PATCH /api/library/:id (admin, scopé shop)
router.patch('/:id', requireAuth, attachShopId, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT * FROM library WHERE id=? AND shop_id=?').get(req.params.id, req.shopId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const cat = (req.body.category || '').trim() || row.category;
  db.prepare('UPDATE library SET category=? WHERE id=? AND shop_id=?').run(cat, req.params.id, req.shopId);
  res.json({ ...row, category: cat });
});

// DELETE /api/library/:id (admin, scopé shop)
router.delete('/:id', requireAuth, attachShopId, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT * FROM library WHERE id=? AND shop_id=?').get(req.params.id, req.shopId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(path.join(__dirname, '..', row.url)); } catch {}
  if (row.thumb_url) {
    try { fs.unlinkSync(path.join(__dirname, '..', row.thumb_url)); } catch {}
  }
  db.prepare('DELETE FROM library WHERE id=? AND shop_id=?').run(req.params.id, req.shopId);
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

module.exports = router;
