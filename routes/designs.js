'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('./auth');
const { getDB } = require('../db/database');
const { attachShopIdSoft, attachShopId } = require('./_shop-context');

// Toutes les routes /api/designs sont scopées par shop_id (audit B1).
// La route GET /:id reste accessible sans shop strict (lecture publique
// d'un design via App Proxy/checkout) mais filtre sur shop si disponible.

// GET /api/designs — list (scopé shop)
router.get('/', attachShopId, (req, res) => {
  const db = getDB();
  const rows = db
    .prepare('SELECT * FROM designs WHERE shop_id = ? ORDER BY updated_at DESC')
    .all(req.shopId);
  res.json(rows);
});

// GET /api/designs/:id — soft scoping (le design ne doit pas appartenir à un autre shop)
router.get('/:id', attachShopIdSoft, (req, res) => {
  const db  = getDB();
  let row;
  if (req.shopId) {
    row = db.prepare('SELECT * FROM designs WHERE id = ? AND shop_id = ?').get(req.params.id, req.shopId);
  } else {
    row = db.prepare('SELECT * FROM designs WHERE id = ?').get(req.params.id);
  }
  if (!row) return res.status(404).json({ error: 'Design not found' });
  row.layers_json = JSON.parse(row.layers_json || '[]');
  res.json(row);
});

// POST /api/designs — create (public — studio auto-saves designs avant checkout)
// shop_id obligatoire (résolu via header/query/bootstrap)
router.post('/', attachShopId, (req, res) => {
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
      (shop_id, name, product, color, format, frame_x, frame_y, frame_w, frame_h,
       layers_json, ticket_on, ticket_start, ticket_prefix, ticket_suffix, thumbnail)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(req.shopId, name, product, color, format, frame_x, frame_y, frame_w, frame_h,
         layers, ticket_on, ticket_start, ticket_prefix, ticket_suffix, thumbnail);

  const row = db.prepare('SELECT * FROM designs WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

// PUT /api/designs/:id — update (admin, scopé shop)
router.put('/:id', requireAuth, attachShopId, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT id FROM designs WHERE id = ? AND shop_id = ?').get(req.params.id, req.shopId);
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
    WHERE id=? AND shop_id=?
  `).run(name, product, color, format,
         frame_x, frame_y, frame_w, frame_h,
         layers, ticket_on, ticket_start,
         ticket_prefix, ticket_suffix, thumbnail,
         req.params.id, req.shopId);

  res.json(db.prepare('SELECT * FROM designs WHERE id = ?').get(req.params.id));
});

// DELETE /api/designs/:id (admin, scopé shop)
router.delete('/:id', requireAuth, attachShopId, (req, res) => {
  const db = getDB();
  const info = db.prepare('DELETE FROM designs WHERE id = ? AND shop_id = ?').run(req.params.id, req.shopId);
  if (info.changes === 0) return res.status(404).json({ error: 'Design not found' });
  res.json({ deleted: true });
});

module.exports = router;
