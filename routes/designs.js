'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('./auth');
const { getDB } = require('../db/database');

// GET /api/designs — list all (public : le studio en a besoin)
router.get('/', (req, res) => {
  const db = getDB();
  const rows = db.prepare('SELECT * FROM designs ORDER BY updated_at DESC').all();
  res.json(rows);
});

// GET /api/designs/:id
router.get('/:id', (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT * FROM designs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Design not found' });
  row.layers_json = JSON.parse(row.layers_json || '[]');
  res.json(row);
});

// POST /api/designs — create (public — studio auto-saves designs before checkout)
router.post('/', (req, res) => {
  const db = getDB();
  const {
    name = 'Sans titre', product = 'tshirt', color = '#FFFFFF', format = 'A4',
    frame_x = 0, frame_y = 0, frame_w = 200, frame_h = 260,
    layers_json = '[]', ticket_on = 0, ticket_start = 1,
    ticket_prefix = '', ticket_suffix = '', thumbnail = ''
  } = req.body;

  const layers = typeof layers_json === 'string' ? layers_json : JSON.stringify(layers_json);

  const info = db.prepare(`
    INSERT INTO designs
      (name, product, color, format, frame_x, frame_y, frame_w, frame_h,
       layers_json, ticket_on, ticket_start, ticket_prefix, ticket_suffix, thumbnail)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(name, product, color, format, frame_x, frame_y, frame_w, frame_h,
         layers, ticket_on, ticket_start, ticket_prefix, ticket_suffix, thumbnail);

  const row = db.prepare('SELECT * FROM designs WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

// PUT /api/designs/:id — update (admin)
router.put('/:id', requireAuth, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT id FROM designs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Design not found' });

  const {
    name, product, color, format,
    frame_x, frame_y, frame_w, frame_h,
    layers_json, ticket_on, ticket_start,
    ticket_prefix, ticket_suffix, thumbnail
  } = req.body;

  const layers = typeof layers_json === 'string' ? layers_json : JSON.stringify(layers_json);

  db.prepare(`
    UPDATE designs SET
      name=?, product=?, color=?, format=?,
      frame_x=?, frame_y=?, frame_w=?, frame_h=?,
      layers_json=?, ticket_on=?, ticket_start=?,
      ticket_prefix=?, ticket_suffix=?, thumbnail=?,
      updated_at=datetime('now')
    WHERE id=?
  `).run(name, product, color, format,
         frame_x, frame_y, frame_w, frame_h,
         layers, ticket_on, ticket_start,
         ticket_prefix, ticket_suffix, thumbnail,
         req.params.id);

  res.json(db.prepare('SELECT * FROM designs WHERE id = ?').get(req.params.id));
});

// DELETE /api/designs/:id (admin)
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM designs WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;
