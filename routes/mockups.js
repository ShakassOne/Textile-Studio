'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('./auth');
const { getDB } = require('../db/database');
const { attachShopId } = require('./_shop-context');

// GET /api/mockups (scopé shop)
router.get('/', attachShopId, (req, res) => {
  const db   = getDB();
  const rows = db.prepare('SELECT * FROM mockups WHERE shop_id=? ORDER BY updated_at DESC').all(req.shopId);
  res.json(rows.map(r => ({ ...r, views: JSON.parse(r.views_json || '[]') })));
});

// GET /api/mockups/product/:product — first mockup for a given product (scopé shop)
router.get('/product/:product', attachShopId, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT * FROM mockups WHERE shop_id=? AND product=? ORDER BY updated_at DESC LIMIT 1').get(req.shopId, req.params.product);
  if (!row) return res.status(404).json({ error: 'No mockup for this product' });
  res.json({ ...row, views: JSON.parse(row.views_json || '[]') });
});

// GET /api/mockups/:id (scopé shop)
router.get('/:id', attachShopId, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT * FROM mockups WHERE id=? AND shop_id=?').get(req.params.id, req.shopId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...row, views: JSON.parse(row.views_json || '[]') });
});

// POST /api/mockups — create (admin, scopé shop)
router.post('/', requireAuth, attachShopId, (req, res) => {
  const db = getDB();
  const { name, product, views = [], file3d_name = '', file3d_url = '' } = req.body;
  if (!name || !product) return res.status(400).json({ error: 'name and product required' });

  const info = db.prepare(`
    INSERT INTO mockups (shop_id, name, product, views_json, file3d_name, file3d_url)
    VALUES (?,?,?,?,?,?)
  `).run(req.shopId, name, product, JSON.stringify(views), file3d_name, file3d_url);

  const row = db.prepare('SELECT * FROM mockups WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({ ...row, views: JSON.parse(row.views_json) });
});

// PUT /api/mockups/:id (admin, scopé shop)
router.put('/:id', requireAuth, attachShopId, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT id FROM mockups WHERE id=? AND shop_id=?').get(req.params.id, req.shopId);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const { name, product, views, file3d_name, file3d_url } = req.body;
  db.prepare(`
    UPDATE mockups SET
      name=?, product=?, views_json=?,
      file3d_name=?, file3d_url=?,
      updated_at=datetime('now')
    WHERE id=? AND shop_id=?
  `).run(name, product, JSON.stringify(views || []), file3d_name || '', file3d_url || '', req.params.id, req.shopId);

  const updated = db.prepare('SELECT * FROM mockups WHERE id=?').get(req.params.id);
  res.json({ ...updated, views: JSON.parse(updated.views_json) });
});

// DELETE /api/mockups/:id (admin, scopé shop)
router.delete('/:id', requireAuth, attachShopId, (req, res) => {
  const db = getDB();
  const info = db.prepare('DELETE FROM mockups WHERE id=? AND shop_id=?').run(req.params.id, req.shopId);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});


// ── POST /api/mockups/:id/upload-glb — upload GLB file for a mockup
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const MODELS_DIR = path.join(__dirname, '..', 'uploads', 'models3d');
fs.mkdirSync(MODELS_DIR, { recursive: true });

const glbStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MODELS_DIR),
  filename:    (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `mockup_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});
const glbUpload = multer({
  storage: glbStorage,
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['.glb', '.gltf'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Seuls .glb et .gltf sont acceptés'), ok);
  },
});

router.post('/:id/upload-glb', requireAuth, attachShopId, glbUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier GLB reçu' });
  const db  = getDB();
  const row = db.prepare('SELECT * FROM mockups WHERE id=? AND shop_id=?').get(req.params.id, req.shopId);
  if (!row) return res.status(404).json({ error: 'Mockup introuvable' });

  // Supprimer l'ancien fichier GLB s'il existe
  if (row.file3d_url) {
    const old = path.join(__dirname, '..', row.file3d_url);
    try { fs.unlinkSync(old); } catch {}
  }

  const url = `/uploads/models3d/${req.file.filename}`;
  db.prepare("UPDATE mockups SET file3d_url=?, file3d_name=?, updated_at=datetime('now') WHERE id=? AND shop_id=?")
    .run(url, req.file.originalname, req.params.id, req.shopId);

  const updated = db.prepare('SELECT * FROM mockups WHERE id=?').get(req.params.id);
  res.json({ ...updated, views: JSON.parse(updated.views_json || '[]'), file3d_url: url });
});

module.exports = router;
