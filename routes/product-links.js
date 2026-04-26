'use strict';
/**
 * routes/product-links.js — Liaisons Produit Shopify ↔ Mockup (scopé shop)
 * ─────────────────────────────────────────────────────────────────────────
 *  GET  /api/product-links              → liste les liaisons du shop courant
 *  PUT  /api/product-links/:productId   → upsert (scopé shop)
 *  DELETE /api/product-links/:productId → supprime (scopé shop)
 *  GET  /api/product-links/by-product/:productId → utilisé par studio/storefront
 */
const express = require('express');
const router  = express.Router();
const { getDB }       = require('../db/database');
const { requireAuth } = require('./auth');
const { attachShopId } = require('./_shop-context');

// ── GET / — liste les liaisons du shop courant ─────────────────────────
router.get('/', requireAuth, attachShopId, (req, res) => {
  const db = getDB();
  const links = db.prepare(`
    SELECT
      pl.id, pl.shopify_product_id, pl.shopify_product_handle,
      pl.shopify_product_title, pl.mockup_id, pl.updated_at,
      m.name  AS mockup_name,
      m.product AS mockup_product
    FROM product_mockup_links pl
    LEFT JOIN mockups m ON pl.mockup_id = m.id AND m.shop_id = pl.shop_id
    WHERE pl.shop_id = ?
    ORDER BY pl.shopify_product_title COLLATE NOCASE
  `).all(req.shopId);
  res.json(links);
});

// ── GET /by-product/:productId — utilisé par studio/storefront (scopé shop) ───
router.get('/by-product/:productId', attachShopId, (req, res) => {
  const db = getDB();
  const link = db.prepare(`
    SELECT
      pl.*, m.name AS mockup_name, m.product AS mockup_product, m.views_json
    FROM product_mockup_links pl
    LEFT JOIN mockups m ON pl.mockup_id = m.id AND m.shop_id = pl.shop_id
    WHERE pl.shop_id = ? AND (pl.shopify_product_id = ? OR pl.shopify_product_handle = ?)
  `).get(req.shopId, req.params.productId, req.params.productId);
  if (!link) return res.status(404).json({ error: 'Aucune liaison trouvée' });
  if (link.views_json) link.views = JSON.parse(link.views_json);
  res.json(link);
});

// ── PUT /:productId — upsert (créer ou mettre à jour, scopé shop) ───────
router.put('/:productId', requireAuth, attachShopId, (req, res) => {
  const { productId } = req.params;
  const { mockup_id, shopify_product_handle = '', shopify_product_title = '' } = req.body;
  const db = getDB();

  // Si mockup_id est null/vide → supprimer la liaison
  if (mockup_id === null || mockup_id === undefined || mockup_id === '') {
    db.prepare('DELETE FROM product_mockup_links WHERE shopify_product_id = ? AND shop_id = ?').run(productId, req.shopId);
    return res.json({ ok: true, unlinked: true });
  }

  // Note : la contrainte UNIQUE actuelle est sur shopify_product_id seul (globale).
  // Pour un même Shopify product_id, on autorise un seul shop l'utilisant — c'est cohérent
  // car le product_id est unique par boutique.
  db.prepare(`
    INSERT INTO product_mockup_links
      (shop_id, shopify_product_id, shopify_product_handle, shopify_product_title, mockup_id, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(shopify_product_id) DO UPDATE SET
      shop_id                = excluded.shop_id,
      mockup_id              = excluded.mockup_id,
      shopify_product_title  = excluded.shopify_product_title,
      shopify_product_handle = excluded.shopify_product_handle,
      updated_at             = datetime('now')
  `).run(req.shopId, productId, shopify_product_handle, shopify_product_title, mockup_id);

  res.json({ ok: true });
});

// ── DELETE /:productId — supprime une liaison (scopé shop) ─────────────
router.delete('/:productId', requireAuth, attachShopId, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM product_mockup_links WHERE shopify_product_id = ? AND shop_id = ?')
    .run(req.params.productId, req.shopId);
  res.json({ ok: true });
});

module.exports = router;
