'use strict';
/**
 * routes/upsell-candidates.js — Suggestions "vous aimeriez aussi" (scopé shop)
 * ─────────────────────────────────────────────────────────────────────────
 * Étape 1 de l'Upsell V2 (docs/ROADMAP-DEV.md §2bis) : table + CRUD admin
 * pour les candidats. Curation manuelle par l'admin (pas d'algorithme).
 * Tracking impression/clic (backlog item 17) : flag `upsell_tracking_enabled`
 * (pattern readBoolSetting/setSetting dans routes/shop-settings.js, défaut
 * activé) coupe l'écriture en DB sans rien changer côté client.
 * Logique pure dans utils/upsell-candidates.js (voir ce fichier pour les tests).
 *
 *  GET    /api/upsell-candidates/public       → suggestions pour la vitrine
 *  POST   /api/upsell-candidates/track        → impression/clic de l'encart (public)
 *  GET    /api/upsell-candidates/stats?source=<id> → compteur 30j (admin)
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
const { getSetting }   = require('../db/settings');
const upsell = require('../utils/upsell-candidates');

// Activé par défaut (backlog item 17, §1 ROADMAP) : seule mesure existante
// de l'encart "Vous aimeriez aussi", désactivable en un clic si besoin.
function trackingEnabled(shopId) {
  const v = getSetting(shopId, 'upsell_tracking_enabled');
  return v === '' || v == null ? true : (v === '1' || v === 'true');
}

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

// ── POST /track — impression/clic de l'encart, loggé par le client final ──
// PUBLIC + CORS large, comme /public : appelé par tl-modal.js via sendBeacon
// (pas d'attente de réponse côté appelant, jamais bloquant). Body JSON
// {source, target, event}. Pas d'auth : un visiteur anonyme n'a pas de
// session admin, et le compteur n'a de sens qu'agrégé, pas par identité.
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
  const result = upsell.logEvent(getDB(), req.shopId, req.body);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.sendStatus(204);
});

// ── GET /stats — compteur impressions/clics 30j, pour l'écran admin ───────
// `source` fourni → un seul produit (comportement historique, inchangé).
// `source` absent → objet groupé par produit source, pour l'écran entier
// en un seul appel (même logique que GET / vs GET /?source=).
router.get('/stats', requireAuth, attachShopId, (req, res) => {
  if (req.query.source) {
    res.json(upsell.eventStats(getDB(), req.shopId, req.query.source, req.query.days));
  } else {
    res.json(upsell.eventStatsGrouped(getDB(), req.shopId, req.query.days));
  }
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
