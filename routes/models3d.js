'use strict';
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { requireAuth } = require('./auth');
const { getDB } = require('../db/database');

// Dossier de stockage des modèles 3D
const MODELS_DIR = path.join(__dirname, '..', 'uploads', 'models3d');
fs.mkdirSync(MODELS_DIR, { recursive: true });

// Créer la table dès le chargement du module
function ensureTable() {
  const db = getDB();
  db.prepare(`CREATE TABLE IF NOT EXISTS models3d (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    filename      TEXT NOT NULL,
    original_name TEXT,
    label         TEXT,
    url           TEXT NOT NULL,
    product_type  TEXT NOT NULL DEFAULT 'tshirt',
    is_active     INTEGER NOT NULL DEFAULT 1,
    size          INTEGER,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run();
}
ensureTable();

// Multer — accepte GLB et GLTF uniquement
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MODELS_DIR),
  filename:    (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok  = ['.glb', '.gltf'].includes(ext);
    cb(ok ? null : new Error('Seuls les fichiers .glb et .gltf sont acceptés'), ok);
  },
});

// ── GET /api/models3d ── liste tous les modèles
router.get('/', (req, res) => {
  const db   = getDB();
  const rows = db.prepare('SELECT * FROM models3d ORDER BY created_at DESC').all();
  res.json(rows);
});

// ── GET /api/models3d/active ── modèle actif par type de produit
router.get('/active', (req, res) => {
  const db      = getDB();
  const product = req.query.product || 'tshirt';
  const row     = db.prepare(
    'SELECT * FROM models3d WHERE product_type=? AND is_active=1 ORDER BY created_at DESC LIMIT 1'
  ).get(product);
  res.json(row || null);
});

// ── POST /api/models3d ── upload (admin)
router.post('/', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

  const db          = getDB();
  const productType = req.body.product_type || 'tshirt';
  const label       = req.body.label || req.file.originalname.replace(/\.[^.]+$/, '');
  const url         = `/uploads/models3d/${req.file.filename}`;

  // Désactiver les anciens modèles du même type
  db.prepare('UPDATE models3d SET is_active=0 WHERE product_type=?').run(productType);

  const info = db.prepare(`
    INSERT INTO models3d (filename, original_name, label, url, product_type, is_active, size)
    VALUES (?,?,?,?,?,1,?)
  `).run(req.file.filename, req.file.originalname, label, url, productType, req.file.size);

  const row = db.prepare('SELECT * FROM models3d WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

// ── PATCH /api/models3d/:id/activate ── changer le modèle actif (admin)
router.patch('/:id/activate', requireAuth, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT * FROM models3d WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Modèle introuvable' });
  db.prepare('UPDATE models3d SET is_active=0 WHERE product_type=?').run(row.product_type);
  db.prepare('UPDATE models3d SET is_active=1 WHERE id=?').run(row.id);
  res.json({ activated: true, id: row.id });
});

// ── DELETE /api/models3d/:id ── supprimer (admin)
router.delete('/:id', requireAuth, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT * FROM models3d WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Introuvable' });
  const filePath = path.join(__dirname, '..', row.url);
  try { fs.unlinkSync(filePath); } catch {}
  db.prepare('DELETE FROM models3d WHERE id=?').run(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;
