'use strict';
/**
 * routes/upsell-candidates.js — Suggestions "vous aimeriez aussi" (scopé shop)
 * ─────────────────────────────────────────────────────────────────────────
 * Étape 1 de l'Upsell V2 (docs/ROADMAP-DEV.md §2bis) : table + CRUD admin
 * uniquement. Curation manuelle par l'admin (pas d'algorithme), pas d'écran
 * ni de flag à ce stade — zéro impact sur le flux client.
 * Logique pure dans utils/upsell-candidates.js (voir ce fichier pour les tests).
 *
 *  GET    /api/upsell-candidates?source=<id>  → candidats pour ce produit source
 *  GET    /api/upsell-candidates              → tout, groupé par source
 *  POST   /api/upsell-candidates              → upsert (scopé shop)
 *  DELETE /api/upsell-candidates/:id          → supprime (scopé shop)
 */
const express = require('express');
const router  = express.Router();
const { getDB }        = require('../db/database');
const { requireAuth }  = require('./auth');
const { attachShopId } = require('./_shop-context');
const upsell = require('../utils/upsell-candidates');

// ── GET / — ?source=<id> pour un produit, sinon tout groupé ────────────
router.get('/', requireAuth, attachShopId, (req, res) => {
  const db = getDB();
  const { source } = req.query;
  if (source) return res.json(upsell.listForSource(db, req.shopId, String(source)));
  res.json(upsell.listGrouped(db, req.shopId));
});

// ── POST / — upsert ──────────────────────────────────────────────────
router.post('/', requireAuth, attachShopId, (req, res) => {
  const result = upsell.upsertCandidate(getDB(), req.shopId, req.body);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// ── DELETE /:id — supprime (scopé shop) ─────────────────────────────
router.delete('/:id', requireAuth, attachShopId, (req, res) => {
  res.json(upsell.deleteCandidate(getDB(), req.shopId, req.params.id));
});

module.exports = router;
