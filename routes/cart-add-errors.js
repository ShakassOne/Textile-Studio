'use strict';
/**
 * routes/cart-add-errors.js — Tracking des refus silencieux de /cart/add (scopé shop)
 * ─────────────────────────────────────────────────────────────────────────
 * Backlog item 31 (docs/ROADMAP-DEV.md §2) : copie conforme du pattern déjà
 * posé pour le tracking upsell (routes/upsell-candidates.js, `/track` +
 * `/stats`) — mesurer un événement client public sans session admin.
 * Flag `cart_error_tracking_enabled` (pattern readBoolSetting/setSetting
 * dans routes/shop-settings.js, défaut activé : mesure diagnostique pure,
 * zéro impact visuel/fonctionnel pour le client).
 * Logique pure dans utils/cart-add-errors.js (voir ce fichier pour les tests).
 *
 *  POST /api/cart-add-errors/track        → refus détecté par le client (public)
 *  GET  /api/cart-add-errors/stats?days=  → total + top raisons (admin)
 */
const express = require('express');
const router  = express.Router();
const { getDB }        = require('../db/database');
const { requireAuth }  = require('./auth');
const { attachShopId } = require('./_shop-context');
const { getSetting }   = require('../db/settings');
const cartAddErrors = require('../utils/cart-add-errors');

// Activé par défaut (backlog item 31) : c'est une mesure diagnostique pure,
// couper la mesure par défaut annulerait l'intérêt de la livrer le jour même
// où le bug qu'elle doit vérifier vient d'être corrigé.
function trackingEnabled(shopId) {
  const v = getSetting(shopId, 'cart_error_tracking_enabled');
  return v === '' || v == null ? true : (v === '1' || v === 'true');
}

// ── POST /track — refus détecté par le client, loggé via sendBeacon ──────
// PUBLIC + CORS large, comme /api/upsell-candidates/track : appelé par
// tl-modal.js juste avant l'alert() qui informe déjà le client. Body JSON
// {variantId, reason}. Pas d'auth : un visiteur anonyme n'a pas de session
// admin, et le compteur n'a de sens qu'agrégé, pas par identité.
router.options('/track', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});
router.post('/track', attachShopId, express.json(), (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  // Coupable en un clic par l'admin (Paramètres) sans toucher au code : on
  // répond 204 sans écrire, comme si l'appel n'avait jamais eu lieu.
  if (!trackingEnabled(req.shopId)) return res.sendStatus(204);
  cartAddErrors.logError(getDB(), req.shopId, req.body);
  res.sendStatus(204);
});

// ── GET /stats — total + top raisons, pour comparer avant/après un fix ──
router.get('/stats', requireAuth, attachShopId, (req, res) => {
  res.json(cartAddErrors.stats(getDB(), req.shopId, req.query.days));
});

module.exports = router;
