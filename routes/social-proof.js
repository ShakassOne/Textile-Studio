'use strict';
/**
 * routes/social-proof.js — Preuve sociale visuelle "Ils l'ont fait" (scopé shop)
 * ─────────────────────────────────────────────────────────────────────────
 * Backlog item 18 (docs/ROADMAP-DEV.md §2) : bloc de confiance statique dans
 * le studio, 3-4 vignettes de vraies réalisations clients curées à la main
 * par l'admin (URL d'image + légende). Affichage client gated par le flag
 * social_proof_enabled (routes/shop-settings.js). Logique pure dans
 * utils/social-proof.js (voir ce fichier pour les tests).
 *
 *  GET    /api/social-proof               → liste admin (toutes les vignettes du shop)
 *  POST   /api/social-proof                → crée une vignette (scopé shop)
 *  DELETE /api/social-proof/:id            → supprime (scopé shop)
 *  GET    /api/social-proof/public?shop=…  → PUBLIC, jusqu'à 4 vignettes (sans auth)
 */
const express = require('express');
const router  = express.Router();
const { getDB, getShopIdByDomain } = require('../db/database');
const { getSetting } = require('../db/settings');
const { requireAuth }  = require('./auth');
const { attachShopId } = require('./_shop-context');
const socialProof = require('../utils/social-proof');

// ── GET /public — PUBLIC, consommé par le studio côté boutique ─────────────
// Cors large : appelé depuis n'importe quel storefront Shopify, comme
// /api/shop-settings/style/public. Gated serveur par social_proof_enabled
// (désactivé par défaut) — pas seulement côté client, pour ne jamais exposer
// les vignettes curées avant que l'admin n'active le flag.
router.get('/public', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Cache-Control', 'public, max-age=60');
  const shopDomain = String(req.query.shop || '').toLowerCase().trim();
  const shopId = shopDomain ? getShopIdByDomain(shopDomain) : null;
  if (!shopId) return res.json([]);
  const enabledVal = getSetting(shopId, 'social_proof_enabled');
  const enabled = enabledVal === '1' || enabledVal === 'true';
  if (!enabled) return res.json([]);
  res.json(socialProof.listPublicForShop(getDB(), shopId));
});

router.options('/public', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

// ── GET / — liste admin (gestion complète) ──────────────────────────────
router.get('/', requireAuth, attachShopId, (req, res) => {
  res.json(socialProof.listForShop(getDB(), req.shopId));
});

// ── POST / — crée une vignette ──────────────────────────────────────────
router.post('/', requireAuth, attachShopId, (req, res) => {
  const result = socialProof.createItem(getDB(), req.shopId, req.body);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// ── DELETE /:id — supprime (scopé shop) ─────────────────────────────────
router.delete('/:id', requireAuth, attachShopId, (req, res) => {
  res.json(socialProof.deleteItem(getDB(), req.shopId, req.params.id));
});

module.exports = router;
