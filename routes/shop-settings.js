'use strict';
/**
 * routes/shop-settings.js — Préférences visuelles boutique exposables au storefront
 * ──────────────────────────────────────────────────────────────────────────────
 *  Routes admin (auth TextileLab + shop résolu) :
 *    GET  /api/shop-settings/style   — Lit les préférences visuelles
 *    POST /api/shop-settings/style   — Met à jour les préférences visuelles
 *
 *  Route publique (sans auth, scopée shop via ?shop=xxx.myshopify.com) :
 *    GET  /api/shop-settings/style/public
 *      → consommée par tl-modal.js (storefront) pour appliquer
 *        la couleur de fond de la preview drawer panier sur tous les thèmes.
 *
 *  Clés actuellement stockées (non sensibles, table `settings`) :
 *    cart_drawer_bg_color    string — hex "#000000" / "transparent" / ""
 *
 *  Cors public : Cross-origin (shop_domain.myshopify.com → textile-studio-production)
 *    → le storefront fait fetch direct, on autorise tout origin sur le GET public.
 * ──────────────────────────────────────────────────────────────────────────────
 */

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('./auth');
const { attachShopId } = require('./_shop-context');
const { getShopIdByDomain } = require('../db/database');
const { getSetting, setSetting } = require('../db/settings');

// ── Validation des couleurs ─────────────────────────────────────────────────
// Autorise : "" (vide), "transparent", "#rgb", "#rgba", "#rrggbb", "#rrggbbaa"
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
function isValidColor(v) {
  if (v == null) return true;
  const s = String(v).trim();
  if (s === '' || s === 'transparent') return true;
  return HEX_COLOR_RE.test(s);
}
function normalizeColor(v) {
  if (v == null) return '';
  const s = String(v).trim().toLowerCase();
  if (s === '' || s === 'transparent') return s;
  return s; // hex déjà validé en amont
}

// ── GET /api/shop-settings/style — lecture admin ────────────────────────────
router.get('/style', requireAuth, attachShopId, (req, res) => {
  const bg = getSetting(req.shopId, 'cart_drawer_bg_color') || '';
  res.json({
    cart_drawer_bg_color: bg,
  });
});

// ── POST /api/shop-settings/style — écriture admin ──────────────────────────
router.post('/style', requireAuth, attachShopId, express.json(), (req, res) => {
  const { cart_drawer_bg_color } = req.body || {};
  if (!isValidColor(cart_drawer_bg_color)) {
    return res.status(400).json({
      error: 'Couleur invalide — doit être vide, "transparent" ou un hex (#000, #000000, #00000000)',
    });
  }
  const normalized = normalizeColor(cart_drawer_bg_color);
  setSetting(req.shopId, 'cart_drawer_bg_color', normalized);
  res.json({ ok: true, cart_drawer_bg_color: normalized });
});

// ── GET /api/shop-settings/style/public — consommé par tl-modal.js ──────────
// PUBLIC (pas d'auth) — uniquement les préférences non sensibles + scopé au shop
// passé en query. CORS large : appelé depuis n'importe quel storefront Shopify.
router.get('/style/public', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Cache-Control', 'public, max-age=60'); // 1 min de cache CDN/browser
  const shopDomain = String(req.query.shop || '').toLowerCase().trim();
  if (!shopDomain) {
    return res.json({ cart_drawer_bg_color: '' });
  }
  const shopId = getShopIdByDomain(shopDomain);
  if (!shopId) {
    return res.json({ cart_drawer_bg_color: '' });
  }
  const bg = getSetting(shopId, 'cart_drawer_bg_color') || '';
  res.json({ cart_drawer_bg_color: bg });
});

// Pré-vol CORS
router.options('/style/public', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

module.exports = router;
