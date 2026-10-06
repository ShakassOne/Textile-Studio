'use strict';
/**
 * routes/upsell-candidates.js — Suggestions "vous aimeriez aussi" (scopé shop)
 * ─────────────────────────────────────────────────────────────────────────
 * Étape 1 de l'Upsell V2 (docs/ROADMAP-DEV.md §2bis) : table + CRUD admin
 * uniquement. Curation manuelle par l'admin (pas d'algorithme), pas d'écran
 * ni de flag à ce stade — zéro impact sur le flux client.
 * Logique pure dans utils/upsell-candidates.js (voir ce fichier pour les tests).
 *
 *  GET    /api/upsell-candidates/public       → suggestions pour la vitrine
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

// ── GET /public — suggestions lues par la vitrine ─────────────────────
// PUBLIC + CORS large : appelé en cross-origin depuis tl-modal.js juste
// après l'ajout au panier, comme /api/product-links/public.
// no-store : une curation changée en admin doit se voir au rechargement
// suivant, pas au bon vouloir d'un cache.
// Déclarée AVANT les routes authentifiées : elles ne se chevauchent pas,
// mais un lecteur doit voir du premier coup d'œil ce qui est ouvert.
router.options('/public', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});
router.get('/public', attachShopId, (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Cache-Control', 'no-store');
  const db = getDB();
  const liste = upsell.listPublicForSource(db, req.shopId, req.query.source);
  res.json(_avecSurcharge(db, req.shopId, liste, req.query.design, req.query.token));
});

/**
 * Prix d'impression de la création, produit suggéré par produit suggéré.
 *
 * Sans ça, la vignette annonce le prix du vêtement nu — 19,90 € — alors que
 * le client vient d'en payer 23,90 pour le même dessin : il découvrirait
 * l'écart après avoir cliqué. Et le montant ne se recopie pas d'un produit à
 * l'autre : la surcharge dépend de la taille IMPRIMÉE, donc de la largeur
 * physique de la zone, qui change d'un support à l'autre.
 *
 * Jamais bloquant : pas de design, jeton faux, produit non calibré → la
 * suggestion repart sans surcharge et la vitrine affiche le prix nu.
 */
function _avecSurcharge(db, shopId, liste, designId, jeton) {
  if (!liste.length || !designId) return liste;

  let composition = null;
  try {
    const design = db.prepare(
      'SELECT edit_token, composition_json FROM designs WHERE id=? AND shop_id=?'
    ).get(Number(designId), shopId);
    // Même contrôle que l'aperçu composé : l'identifiant est un entier, sans
    // jeton n'importe qui tarifierait les créations des autres.
    if (!design) return liste;
    if (design.edit_token && design.edit_token !== String(jeton || '')) return liste;
    composition = JSON.parse(design.composition_json || '{}');
  } catch (e) {
    console.warn('[upsell] composition illisible :', e.message);
    return liste;
  }

  let largeursDeVue, lireBaremeFormats;
  try {
    ({ largeursDeVue } = require('./product-designs'));
    ({ lireBaremeFormats } = require('./pricing'));
  } catch (e) {
    console.warn('[upsell] tarification indisponible :', e.message);
    return liste;
  }

  const { montantComposition } = require('../utils/print-tiers');
  const formats = lireBaremeFormats(shopId);
  const nbFaces = Object.keys((composition && composition.faces) || {}).length || 1;

  return liste.map((c) => {
    try {
      const pid = String(c.product_id || '').replace(/\D/g, '');
      if (!pid) return c;
      const largeurMm = largeursDeVue(db, shopId, pid, nbFaces);
      return { ...c, surcharge: montantComposition(composition, largeurMm, formats) };
    } catch (e) {
      console.warn('[upsell] surcharge impossible pour', c.handle, ':', e.message);
      return c;
    }
  });
}

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
