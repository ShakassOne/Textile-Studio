'use strict';
/**
 * routes/product-links.js — Liaisons Produit Shopify ↔ Mockup
 * ─────────────────────────────────────────────────────────────
 *  GET  /api/product-links              → liste toutes les liaisons (avec info mockup)
 *  PUT  /api/product-links/:productId   → crée ou met à jour une liaison
 *  DELETE /api/product-links/:productId → supprime une liaison
 *  GET  /api/product-links/by-product/:productId → utilisé par le studio/storefront
 */
const express = require('express');
const router  = express.Router();
const { getDB }       = require('../db/database');
const { requireAuth } = require('./auth');

// ── GET / — liste toutes les liaisons ────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = getDB();
  const links = db.prepare(`
    SELECT
      pl.id, pl.shopify_product_id, pl.shopify_product_handle,
      pl.shopify_product_title, pl.mockup_id, pl.updated_at,
      m.name  AS mockup_name,
      m.product AS mockup_product
    FROM product_mockup_links pl
    LEFT JOIN mockups m ON pl.mockup_id = m.id
    ORDER BY pl.shopify_product_title COLLATE NOCASE
  `).all();
  res.json(links);
});

// ── GET /by-product/:productId — utilisé par le studio / storefront ──────────
router.get('/by-product/:productId', (req, res) => {
  const db = getDB();
  const link = db.prepare(`
    SELECT
      pl.*, m.name AS mockup_name, m.product AS mockup_product, m.views_json
    FROM product_mockup_links pl
    LEFT JOIN mockups m ON pl.mockup_id = m.id
    WHERE pl.shopify_product_id = ? OR pl.shopify_product_handle = ?
  `).get(req.params.productId, req.params.productId);
  if (!link) return res.status(404).json({ error: 'Aucune liaison trouvée' });
  if (link.views_json) link.views = JSON.parse(link.views_json);
  res.json(link);
});

// ── PUT /:productId — upsert (créer ou mettre à jour) ────────────────────────
router.put('/:productId', requireAuth, (req, res) => {
  const { productId } = req.params;
  const { mockup_id, shopify_product_handle = '', shopify_product_title = '' } = req.body;
  const db = getDB();

  // Si mockup_id est null/vide → supprimer la liaison
  if (mockup_id === null || mockup_id === undefined || mockup_id === '') {
    db.prepare('DELETE FROM product_mockup_links WHERE shopify_product_id = ?').run(productId);
    return res.json({ ok: true, unlinked: true });
  }

  db.prepare(`
    INSERT INTO product_mockup_links
      (shopify_product_id, shopify_product_handle, shopify_product_title, mockup_id, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(shopify_product_id) DO UPDATE SET
      mockup_id              = excluded.mockup_id,
      shopify_product_title  = excluded.shopify_product_title,
      shopify_product_handle = excluded.shopify_product_handle,
      updated_at             = datetime('now')
  `).run(productId, shopify_product_handle, shopify_product_title, mockup_id);

  res.json({ ok: true });
});

// ── DELETE /:productId — supprime une liaison ─────────────────────────────────
router.delete('/:productId', requireAuth, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM product_mockup_links WHERE shopify_product_id = ?').run(req.params.productId);
  res.json({ ok: true });
});

module.exports = router;
