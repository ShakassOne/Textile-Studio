'use strict';
const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const { requireAuth } = require('./auth');
const { getDB } = require('../db/database');
const { uploadToFtpAsync, isFtpConfigured } = require('../utils/ftp-upload');

// Utilise DATA_DIR si défini (prod Railway) sinon dossier projet
const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, '..');
const RENDERS_DIR = path.join(DATA_DIR, 'uploads', 'renders');
fs.mkdirSync(RENDERS_DIR, { recursive: true });

// ── GET /api/render ── liste tous les designs ayant un render HD (admin)
router.get('/', requireAuth, (req, res) => {
  const db = getDB();
  let rows;
  try {
    rows = db.prepare(`
      SELECT id, name, product, format, render_url, render_size_kb, updated_at
      FROM designs
      WHERE render_url IS NOT NULL AND render_url != ''
      ORDER BY updated_at DESC
    `).all();
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
router.post('/save-views', (req, res) => {
  const { design_id, views } = req.body;
  if (!design_id || !Array.isArray(views) || !views.length) {
    return res.status(400).json({ error: 'design_id et views[] requis' });
  }

  const db      = getDB();
  const APP_URL = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
  const result  = {};

  for (const view of views) {
    try {
      const base64Data = (view.png_base64 || '').replace(/^data:image\/\w+;base64,/, '');
      if (!base64Data) continue;
      const buffer   = Buffer.from(base64Data, 'base64');
      const filename = `preview_d${design_id}_v${view.idx}_${Date.now()}.jpg`;
      const filepath = path.join(RENDERS_DIR, filename);
      fs.writeFileSync(filepath, buffer);
      const absUrl = `${APP_URL}/uploads/renders/${filename}`;
      result[view.idx] = { url: absUrl, name: view.name || `Vue ${view.idx}` };
    } catch(e) {
      console.error(`[render] save-views view ${view.idx}:`, e.message);
    }
  }

  // Ajouter colonne si elle n'existe pas encore
  try { db.prepare('ALTER TABLE designs ADD COLUMN views_preview_json TEXT').run(); } catch { /* ok */ }

  try {
    db.prepare('UPDATE designs SET views_preview_json=?, updated_at=datetime(\'now\') WHERE id=?')
      .run(JSON.stringify(result), design_id);
    console.log(`[render] ${Object.keys(result).length} thumbnail(s) sauvegardé(s) pour design #${design_id}`);
    res.json({ ok: true, views: result });
  } catch(e) {
    console.error('[render] save-views DB:', e.message);
    res.status(500).json({ error: 'Erreur DB' });
  }
});

// ── POST /api/render/save ── reçoit base64, sauvegarde le fichier PNG (public — appelé par le studio)
router.post('/save', (req, res) => {
  const { design_id, png_base64 } = req.body;
  if (!design_id || !png_base64) {
    return res.status(400).json({ error: 'design_id et png_base64 requis' });
  }

  try {
    const base64Data = png_base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer     = Buffer.from(base64Data, 'base64');

    const filename = `render_design_${design_id}_${Date.now()}.png`;
    const filepath = path.join(RENDERS_DIR, filename);
    fs.writeFileSync(filepath, buffer);

    const url    = `/uploads/renders/${filename}`;
    const sizeKb = Math.round(buffer.length / 1024);

    // Mettre à jour le design avec l'URL du render HD
    const db = getDB();
    try {
      db.prepare('UPDATE designs SET render_url=?, render_size_kb=? WHERE id=?')
        .run(url, sizeKb, design_id);
    } catch(e) {
      try {
        db.prepare('ALTER TABLE designs ADD COLUMN render_url TEXT').run();
        db.prepare('ALTER TABLE designs ADD COLUMN render_size_kb INTEGER').run();
        db.prepare('UPDATE designs SET render_url=?, render_size_kb=? WHERE id=?')
          .run(url, sizeKb, design_id);
      } catch(e2) { /* déjà ajoutées */ }
    }

    console.log(`[render] PNG HD sauvegardé: ${filename} (${sizeKb} Ko)`);

    // ── Upload FTP asynchrone (fire-and-forget, ne bloque pas la réponse) ──
    // Déclenché si FTP_HOST + FTP_USER + FTP_PASSWORD sont définis dans .env
    if (isFtpConfigured()) {
      uploadToFtpAsync(filepath, filename, 3);
      console.log(`[render] FTP upload planifié → ${filename}`);
    }

    res.json({
      url,
      filename,
      size_kb:     sizeKb,
      ftp_queued:  isFtpConfigured(),
    });

  } catch(err) {
    console.error('[render] Erreur sauvegarde:', err);
    res.status(500).json({ error: 'Erreur sauvegarde PNG' });
  }
});

// ── POST /api/render/ftp-retry/:design_id ── relancer l'upload FTP manuellement
router.post('/ftp-retry/:design_id', requireAuth, (req, res) => {
  if (!isFtpConfigured()) {
    return res.status(400).json({ error: 'FTP non configuré dans .env' });
  }
  const db     = getDB();
  let design;
  try {
    design = db.prepare('SELECT render_url FROM designs WHERE id=?').get(req.params.design_id);
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

// ── GET /api/render/download/:design_id ── téléchargement direct (doit être avant /:design_id)
router.get('/download/:design_id', (req, res) => {
  const db = getDB();
  let design;
  try {
    design = db.prepare('SELECT render_url FROM designs WHERE id=?').get(req.params.design_id);
  } catch(e) {
    return res.status(404).json({ error: 'Design introuvable' });
  }
  if (!design?.render_url) {
    return res.status(404).json({ error: 'Aucun render HD disponible pour ce design' });
  }
  const filepath = path.join(__dirname, '..', design.render_url);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Fichier introuvable sur le disque' });
  }
  res.download(filepath, path.basename(filepath));
});

// ── GET /api/render/:design_id ──
// • Sans ?json=1  → redirection 302 vers l'image PNG absolue (cliquable depuis email/admin)
// • Avec  ?json=1 → réponse JSON avec URL absolue (rétro-compat API)
router.get('/:design_id', (req, res) => {
  const db  = getDB();
  let design;
  try {
    design = db.prepare('SELECT id, render_url, render_size_kb FROM designs WHERE id=?')
               .get(req.params.design_id);
  } catch(e) {
    return res.json({ render_url: null });
  }
  if (!design) return res.status(404).json({ error: 'Design introuvable' });

  // Construire l'URL absolue (render_url est un chemin relatif type /uploads/renders/...)
  const APP_URL = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
  const relativeUrl = design.render_url || null;
  const absoluteUrl = relativeUrl
    ? (relativeUrl.startsWith('http') ? relativeUrl : `${APP_URL}${relativeUrl}`)
    : null;

  // Mode JSON explicite (?json=1) ou pas de render disponible → JSON
  if (req.query.json === '1' || !absoluteUrl) {
    return res.json({
      design_id:      design.id,
      render_url:     absoluteUrl,
      render_size_kb: design.render_size_kb || null,
    });
  }

  // Défaut : redirection 302 → le navigateur/email ouvre directement l'image PNG
  res.redirect(302, absoluteUrl);
});

module.exports = router;
