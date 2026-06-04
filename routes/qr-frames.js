'use strict';
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { getDB, getShop } = require('../db/database');
const { requireAuth } = require('./auth');
const { attachShopId, attachShopIdSoft } = require('./_shop-context');

// ── GET /api/qr-frames/public — pour le studio storefront (pas d'auth admin) ──
// Utilise attachShopIdSoft : résout via x-shop-domain, ?shop=, ou bootstrap env
router.get('/public', attachShopIdSoft, (req, res) => {
  if (!req.shopId) return res.status(400).json({ error: 'shop non résolu', frames: [] });
  try {
    const db = getDB();
    const rows = db.prepare(
      'SELECT id, name, category, image_url, sort_order FROM qr_frames WHERE shop_id=? AND active=1 ORDER BY sort_order ASC, id ASC'
    ).all(req.shopId);
    res.json({ frames: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Stockage des images de frames QR ──────────────────────────────────────────
const uploadDir = path.join(__dirname, '..', 'uploads', 'qr-frames');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase() || '.png';
    const name = `frame-${Date.now()}-${Math.random().toString(36).slice(2,8)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Fichier image requis'));
  },
});

// ── Middleware auth ────────────────────────────────────────────────────────────
router.use(requireAuth, attachShopId);

// ── GET /api/qr-frames — liste des frames actives (public storefront + admin) ─
router.get('/', (req, res) => {
  try {
    const db = getDB();
    const adminMode = req.query.all === '1';
    const rows = adminMode
      ? db.prepare('SELECT * FROM qr_frames WHERE shop_id=? ORDER BY sort_order ASC, id ASC').all(req.shopId)
      : db.prepare('SELECT id, name, category, image_url, sort_order FROM qr_frames WHERE shop_id=? AND active=1 ORDER BY sort_order ASC, id ASC').all(req.shopId);
    res.json({ frames: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/qr-frames — créer une frame (admin) ─────────────────────────────
router.post('/', upload.single('image'), (req, res) => {
  try {
    const { name, category = 'custom' } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' });
    if (!req.file)     return res.status(400).json({ error: 'Image PNG requise' });

    const db = getDB();
    const imageUrl = `/uploads/qr-frames/${req.file.filename}`;
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM qr_frames WHERE shop_id=?').get(req.shopId).m;

    const info = db.prepare(
      'INSERT INTO qr_frames (shop_id, name, category, image_url, sort_order, active) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(req.shopId, name.trim(), category.trim(), imageUrl, maxOrder + 1);

    const row = db.prepare('SELECT * FROM qr_frames WHERE id=?').get(info.lastInsertRowid);
    res.json({ frame: row });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/qr-frames/:id — modifier (nom, catégorie, active, sort_order) ──
router.patch('/:id', express.json(), (req, res) => {
  try {
    const db = getDB();
    const row = db.prepare('SELECT * FROM qr_frames WHERE id=? AND shop_id=?').get(req.params.id, req.shopId);
    if (!row) return res.status(404).json({ error: 'Frame introuvable' });

    const fields = [];
    const vals   = [];
    const { name, category, active, sort_order } = req.body;
    if (name       !== undefined) { fields.push('name=?');       vals.push(name.trim()); }
    if (category   !== undefined) { fields.push('category=?');   vals.push(category.trim()); }
    if (active     !== undefined) { fields.push('active=?');     vals.push(active ? 1 : 0); }
    if (sort_order !== undefined) { fields.push('sort_order=?'); vals.push(Number(sort_order)); }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });

    vals.push(req.params.id, req.shopId);
    db.prepare(`UPDATE qr_frames SET ${fields.join(',')} WHERE id=? AND shop_id=?`).run(...vals);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/qr-frames/:id — supprimer une frame ───────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const db = getDB();
    const row = db.prepare('SELECT image_url FROM qr_frames WHERE id=? AND shop_id=?').get(req.params.id, req.shopId);
    if (!row) return res.status(404).json({ error: 'Frame introuvable' });

    db.prepare('DELETE FROM qr_frames WHERE id=? AND shop_id=?').run(req.params.id, req.shopId);

    // Supprimer le fichier
    if (row.image_url?.startsWith('/uploads/qr-frames/')) {
      try { fs.unlinkSync(path.join(__dirname, '..', row.image_url)); } catch {}
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
