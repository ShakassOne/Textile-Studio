'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('./auth');
const { getDB } = require('../db/database');
const { getProductPrice, getFormatExtra, getProductKeys, getFormatKeys } = require('./pricing');
const { attachShopId } = require('./_shop-context');

// GET /api/orders/meta/pricing — legacy pricing grid (doit être avant /:id)
router.get('/meta/pricing', (_req, res) => {
  res.json({
    base:    { tshirt: getProductPrice('tshirt'), hoodie: getProductPrice('hoodie'), cap: getProductPrice('cap'), totebag: getProductPrice('totebag') },
    formats: { A3: getFormatExtra('A3'), A4: getFormatExtra('A4'), A5: getFormatExtra('A5'), A6: getFormatExtra('A6') },
  });
});

// GET /api/orders (admin — données clients, scopé shop)
router.get('/', requireAuth, attachShopId, (req, res) => {
  const db = getDB();
  const { status } = req.query;

  // LEFT JOIN designs pour récupérer views_preview_json et thumbnail
  let rows;
  try {
    const q = status
      ? `SELECT o.*, d.views_preview_json, d.thumbnail AS design_thumb
         FROM orders o LEFT JOIN designs d ON d.id = o.design_id AND d.shop_id = o.shop_id
         WHERE o.status=? AND o.shop_id=? ORDER BY o.created_at DESC`
      : `SELECT o.*, d.views_preview_json, d.thumbnail AS design_thumb
         FROM orders o LEFT JOIN designs d ON d.id = o.design_id AND d.shop_id = o.shop_id
         WHERE o.shop_id=? ORDER BY o.created_at DESC`;
    rows = status ? db.prepare(q).all(status, req.shopId) : db.prepare(q).all(req.shopId);
  } catch {
    // Fallback sans join (colonne views_preview_json peut ne pas exister encore)
    rows = status
      ? db.prepare('SELECT * FROM orders WHERE status=? AND shop_id=? ORDER BY created_at DESC').all(status, req.shopId)
      : db.prepare('SELECT * FROM orders WHERE shop_id=? ORDER BY created_at DESC').all(req.shopId);
  }
  res.json(rows);
});

// GET /api/orders/:id (admin, scopé shop)
router.get('/:id', requireAuth, attachShopId, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT * FROM orders WHERE id=? AND shop_id=?').get(req.params.id, req.shopId);
  if (!row) return res.status(404).json({ error: 'Order not found' });
  res.json(row);
});

// POST /api/orders — create (public — studio customers, shop_id requis)
// Audit N3 — route publique : validation et bornage strict des entrées pour
// éviter les commandes invalides (produit inconnu → prix 0), l'abus (quantité
// énorme, chaînes géantes) et les fuites inter-shop (design_id d'un autre shop).
router.post('/', attachShopId, (req, res) => {
  const db = getDB();
  const b  = req.body || {};

  // Helper : forcer une chaîne bornée et trimée.
  const str = (v, max) => (typeof v === 'string' ? v : (v == null ? '' : String(v))).slice(0, max).trim();

  // design_id : optionnel, entier positif, et doit appartenir au shop si fourni.
  let design_id = null;
  if (b.design_id !== undefined && b.design_id !== null && b.design_id !== '') {
    design_id = Number(b.design_id);
    if (!Number.isInteger(design_id) || design_id <= 0) {
      return res.status(400).json({ error: 'design_id invalide' });
    }
    const owns = db.prepare('SELECT id FROM designs WHERE id=? AND shop_id=?').get(design_id, req.shopId);
    if (!owns) return res.status(400).json({ error: 'design_id introuvable pour ce shop' });
  }

  // product : obligatoire et doit être une clé connue (built-in OU catégorie du shop).
  const product = str(b.product, 40);
  if (!product) return res.status(400).json({ error: 'product requis' });
  let validProducts = getProductKeys();
  try {
    const cats = db.prepare('SELECT key FROM product_categories WHERE shop_id=?').all(req.shopId).map(c => c.key);
    validProducts = validProducts.concat(cats);
  } catch { /* table absente : on garde les clés built-in */ }
  if (!validProducts.includes(product)) {
    return res.status(400).json({ error: 'product inconnu' });
  }

  // format : doit être une clé connue (défaut A4).
  const format = str(b.format, 8) || 'A4';
  if (!getFormatKeys().includes(format)) {
    return res.status(400).json({ error: 'format inconnu' });
  }

  // quantity : entier 1..1000.
  const quantity = Number(b.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
    return res.status(400).json({ error: 'quantity doit être un entier entre 1 et 1000' });
  }

  // Champs texte : bornés en longueur ; email validé si présent.
  const color          = str(b.color, 32) || '#FFFFFF';
  const customer_name  = str(b.customer_name, 120);
  const customer_email = str(b.customer_email, 200);
  const notes          = str(b.notes, 2000);
  if (customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
    return res.status(400).json({ error: 'customer_email invalide' });
  }

  // ticket_from / ticket_to : entiers ou null.
  const toIntOrNull = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  };
  const ticket_from = toIntOrNull(b.ticket_from);
  const ticket_to   = toIntOrNull(b.ticket_to);

  // Prix : calcul avec garde-fou (jamais NaN), arrondi 2 décimales.
  const unit_price   = Number(getProductPrice(product)) || 0;
  const format_price = Number(getFormatExtra(format))   || 0;
  const total_price  = Number(((unit_price + format_price) * quantity).toFixed(2));

  const info = db.prepare(`
    INSERT INTO orders
      (shop_id, design_id, product, color, format, quantity,
       unit_price, format_price, total_price,
       customer_name, customer_email,
       ticket_from, ticket_to, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(req.shopId, design_id, product, color, format, quantity,
         unit_price, format_price, total_price,
         customer_name, customer_email,
         ticket_from, ticket_to, notes);

  res.status(201).json(db.prepare('SELECT * FROM orders WHERE id=?').get(info.lastInsertRowid));
});

// PATCH /api/orders/:id — update status or notes (admin, scopé shop)
router.patch('/:id', requireAuth, attachShopId, (req, res) => {
  const db  = getDB();
  const row = db.prepare('SELECT id FROM orders WHERE id=? AND shop_id=?').get(req.params.id, req.shopId);
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
  values.push(req.params.id, req.shopId);

  db.prepare(`UPDATE orders SET ${updates.join(',')} WHERE id=? AND shop_id=?`).run(...values);
  res.json(db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id));
});

module.exports = router;
