'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('./auth');
const { getDB } = require('../db/database');
const { getProductPrice, getFormatExtra } = require('./pricing');

// GET /api/orders/meta/pricing — legacy pricing grid (doit être avant /:id)
router.get('/meta/pricing', (_req, res) => {
  res.json({
    base:    { tshirt: getProductPrice('tshirt'), hoodie: getProductPrice('hoodie'), cap: getProductPrice('cap'), totebag: getProductPrice('totebag') },
    formats: { A3: getFormatExtra('A3'), A4: getFormatExtra('A4'), A5: getFormatExtra('A5'), A6: getFormatExtra('A6') },
  });
});

// GET /api/orders (admin — contient des données clients)
router.get('/', requireAuth, (req, res) => {
  const db = getDB();
  const { status } = req.query;

  // LEFT JOIN designs pour récupérer views_preview_json et thumbnail
  let rows;
  try {
    const q = status
      ? `SELECT o.*, d.views_preview_json, d.thumbnail AS design_thumb
         FROM orders o LEFT JOIN designs d ON d.id = o.design_id
         WHERE o.status=? ORDER BY o.created_at DESC`
      : `SELECT o.*, d.views_preview_json, d.thumbnail AS design_thumb
         FROM orders o LEFT JOIN designs d ON d.id = o.design_id
         ORDER BY o.created_at DESC`;
    rows = status ? db.prepare(q).all(status) : db.prepare(q).all();
  } catch {
    // Fallback sans join (colonne views_preview_json peut ne pas exister encore)
    rows = status
      ? db.prepare('SELECT * FROM orders WHERE status=? ORDER BY created_at DESC').all(status)
      : db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  }
  res.json(rows);
});

// GET /api/orders/:id (admin)
router.get('/:id', requireAuth, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Order not found' });
  res.json(row);
});

// POST /api/orders — create (public — studio customers can submit orders without admin auth)
router.post('/', (req, res) => {
  const db = getDB();
  const {
    design_id, product, color = '#FFFFFF', format = 'A4',
    quantity = 1, customer_name = '', customer_email = '',
    ticket_from = null, ticket_to = null, notes = ''
  } = req.body;

  const unit_price   = getProductPrice(product);
  const format_price = getFormatExtra(format);
  const total_price  = (unit_price + format_price) * quantity;

  const info = db.prepare(`
    INSERT INTO orders
      (design_id, product, color, format, quantity,
       unit_price, format_price, total_price,
       customer_name, customer_email,
       ticket_from, ticket_to, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(design_id, product, color, format, quantity,
         unit_price, format_price, total_price,
         customer_name, customer_email,
         ticket_from, ticket_to, notes);

  res.status(201).json(db.prepare('SELECT * FROM orders WHERE id=?').get(info.lastInsertRowid));
});

// PATCH /api/orders/:id — update status or notes (admin)
router.patch('/:id', requireAuth, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT id FROM orders WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Order not found' });

  const allowed = ['status', 'notes', 'render_url', 'shopify_id'];
  const updates = [];
  const values  = [];

  allowed.forEach(k => {
    if (req.body[k] !== undefined) {
      updates.push(`${k}=?`);
      values.push(req.body[k]);
    }
  });

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  updates.push("updated_at=datetime('now')");
  values.push(req.params.id);

  db.prepare(`UPDATE orders SET ${updates.join(',')} WHERE id=?`).run(...values);
  res.json(db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id));
});

module.exports = router;
