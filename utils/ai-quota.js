'use strict';
/**
 * utils/ai-quota.js — Règles du quota de générations IA.
 * ──────────────────────────────────────────────────────────────────────────
 * Chaque génération gpt-image-1 en qualité haute coûte de l'argent au
 * marchand : le quota protège sa facture tout en laissant essayer l'outil.
 *
 * Règles (septembre 2026) :
 *   • Visiteur non connecté : 1 génération par mois. Au-delà, on lui demande
 *     de se connecter — c'est le moment de conversion.
 *   • Client connecté       : 3 générations par mois.
 *   • Un achat remet le compteur à zéro, dans les deux cas.
 *
 * L'identité vient, par ordre de fiabilité :
 *   1. customer  — logged_in_customer_id transmis et signé par l'App Proxy
 *                  Shopify. Infalsifiable.
 *   2. email     — e-mail d'une commande. Sert au renouvellement sur achat
 *                  d'un visiteur qui n'avait pas de compte au moment du design.
 *   3. visitor   — identifiant tiré au sort et gardé dans le navigateur.
 *                  Contournable (navigation privée, effacement) : c'est une
 *                  barrière douce, le rate-limit par IP reste le garde-fou
 *                  contre l'abus massif.
 *
 * Module PUR : aucun accès DB, réseau ou DOM. Testable tel quel.
 */

const LIMITS = {
  anonymous: 1, // visiteur non connecté
  customer:  3, // client connecté à son compte Shopify
};

/** Type d'identité → limite mensuelle. Toute valeur inconnue est traitée en anonyme. */
function limitFor(identityType) {
  return identityType === 'customer' ? LIMITS.customer : LIMITS.anonymous;
}

/**
 * Clé de période : le quota est mensuel et glisse au calendrier.
 * "2026-09" pour septembre 2026 (UTC, pour ne pas dépendre du fuseau serveur).
 */
function periodKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return periodKey(new Date());
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Normalise une identité en clé de stockage stable.
 * @param {'customer'|'email'|'visitor'} type
 * @param {string} value
 * @returns {string|null} ex. "customer:7712345", ou null si inexploitable
 */
function identityKey(type, value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  if (type === 'customer') {
    const digits = v.replace(/\D/g, ''); // accepte un GID comme un id numérique
    return digits ? `customer:${digits}` : null;
  }
  if (type === 'email')   return v.includes('@') ? `email:${v}` : null;
  if (type === 'visitor') return /^[a-z0-9-]{8,64}$/.test(v) ? `visitor:${v}` : null;
  return null;
}

/**
 * Décide si une génération est permise, à partir de l'état stocké.
 *
 * @param {object|null} record  { used, period } ou null
 * @param {'customer'|'anonymous'} identityType
 * @param {Date} [now]
 * @returns {{allowed:boolean, used:number, limit:number, remaining:number,
 *            period:string, reason:'ok'|'quota_exhausted', needsLogin:boolean}}
 */
function evaluate(record, identityType, now = new Date()) {
  const period = periodKey(now);
  const limit  = limitFor(identityType);

  // Compteur d'un mois révolu → on repart de zéro. Un achat, lui, remet le
  // compteur à zéro au moment où il survient (cf. le rechargement côté
  // serveur) : ici il n'y a donc rien de plus à interpréter, ce qui garantit
  // que l'achat rend le quota PLEIN et non une seule génération.
  const samePeriod = record && record.period === period;
  const used = samePeriod ? Number(record.used || 0) : 0;

  const remaining = Math.max(0, limit - used);
  const allowed   = remaining > 0;

  return {
    allowed,
    used,
    limit,
    remaining,
    period,
    reason: allowed ? 'ok' : 'quota_exhausted',
    // Un anonyme à court de quota a une porte de sortie immédiate : se
    // connecter lui ouvre le quota client. Un client, lui, doit acheter ou
    // attendre le mois suivant.
    needsLogin: !allowed && identityType !== 'customer',
  };
}

/** Message affiché au client quand la génération est refusée. */
function refusalMessage(state) {
  if (state.needsLogin) {
    return 'Vous avez utilisé votre essai gratuit. Connectez-vous pour en obtenir 3 de plus ce mois-ci.';
  }
  return `Quota atteint (${state.limit} ce mois-ci). Il se recharge après un achat, ou le mois prochain.`;
}

module.exports = { LIMITS, limitFor, periodKey, identityKey, evaluate, refusalMessage };
