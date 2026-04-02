'use strict';
/**
 * routes/shopify-session.js — Vérification Session Token Shopify (App Bridge 4)
 * ──────────────────────────────────────────────────────────────────────────────
 *  POST /api/shopify-session/verify
 *    Body : { shop: "xxx.myshopify.com" }
 *    Header : Authorization: Bearer <session_token>
 *
 *    → Vérifie que le JWT est signé par Shopify avec SHOPIFY_API_SECRET
 *    → Vérifie que le shop dans le token correspond à celui de la DB (installé)
 *    → Retourne { ok: true, shop, dest } ou { error: "..." }
 *
 *  Middleware exporté : requireShopifySession(req, res, next)
 *    → Utilisable sur n'importe quelle route API nécessitant une auth Shopify
 * ──────────────────────────────────────────────────────────────────────────────
 *  Specs session token Shopify :
 *    - Algorithme : HS256
 *    - Secret     : SHOPIFY_API_SECRET (Client Secret de l'app)
 *    - Claims     : iss (shop), dest (shop URL), sub (user ID), jti (nonce)
 *    - Expiry     : ~1 minute (le frontend doit en obtenir un nouveau avant chaque appel)
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { getShop } = require('../db/database');

// ── Décodage / vérification JWT HS256 (sans lib externe) ────────────────────
function _base64UrlDecode(str) {
  const padded = str + '='.repeat((4 - str.length % 4) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Vérifie un JWT HS256 signé avec secret.
 * Retourne le payload décodé ou lève une Error.
 */
function verifyJWT(token, secret) {
  if (!token || typeof token !== 'string') throw new Error('Token manquant');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Format JWT invalide');

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Vérifier l'algorithme
  let header;
  try { header = JSON.parse(_base64UrlDecode(headerB64).toString()); }
  catch { throw new Error('Header JWT invalide'); }
  if (header.alg !== 'HS256') throw new Error(`Algorithme JWT non supporté: ${header.alg}`);

  // 2. Vérifier la signature
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  const valid = (() => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedSig),
        Buffer.from(signatureB64)
      );
    } catch { return false; }
  })();
  if (!valid) throw new Error('Signature JWT invalide');

  // 3. Décoder et retourner le payload
  let payload;
  try { payload = JSON.parse(_base64UrlDecode(payloadB64).toString()); }
  catch { throw new Error('Payload JWT invalide'); }

  // 4. Vérifier l'expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error('Session token expiré');

  return payload;
}

// ── Extraction du Bearer token ───────────────────────────────────────────────
function _extractBearer(req) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

// ── POST /api/shopify-session/verify ────────────────────────────────────────
router.post('/verify', (req, res) => {
  const token  = _extractBearer(req);
  const shop   = (req.body?.shop || '').toLowerCase().trim();
  const secret = process.env.SHOPIFY_API_SECRET || '';

  if (!token) return res.status(401).json({ error: 'Bearer token manquant' });
  if (!shop)  return res.status(400).json({ error: 'Paramètre shop manquant' });

  // En dev sans secret configuré, on passe directement
  if (!secret) {
    const installed = getShop(shop);
    if (!installed) return res.status(403).json({ error: 'Shop non installé' });
    return res.json({ ok: true, shop, dev: true });
  }

  let payload;
  try {
    payload = verifyJWT(token, secret);
  } catch (err) {
    console.warn(`⚠️  Session token invalide — shop: ${shop}:`, err.message);
    return res.status(401).json({ error: err.message });
  }

  // Vérifier que le dest du token correspond au shop demandé
  const tokenShop = (payload.dest || '').replace('https://', '').toLowerCase();
  if (tokenShop !== shop) {
    return res.status(403).json({ error: 'Shop ne correspond pas au token' });
  }

  // Vérifier que le shop est bien installé en DB
  const installed = getShop(shop);
  if (!installed) {
    return res.status(403).json({ error: 'Shop non installé ou désactivé' });
  }

  console.log(`✅  Session token valide — shop: ${shop}, sub: ${payload.sub}`);
  res.json({ ok: true, shop, dest: payload.dest, sub: payload.sub });
});

// ── Middleware : requireShopifySession ───────────────────────────────────────
/**
 * Middleware Express : vérifie le session token Shopify sur les routes protégées.
 * Injecte req.shopDomain et req.shopRecord si valide.
 *
 * Usage :
 *   const { requireShopifySession } = require('./shopify-session');
 *   router.get('/ma-route', requireShopifySession, (req, res) => { ... });
 */
function requireShopifySession(req, res, next) {
  const token  = _extractBearer(req);
  const secret = process.env.SHOPIFY_API_SECRET || '';

  if (!token) return res.status(401).json({ error: 'Session token Shopify requis' });

  // En dev sans secret : passer avec le shop du header ou query
  if (!secret) {
    req.shopDomain = req.headers['x-shopify-shop-domain']
      || req.query.shop
      || '';
    return next();
  }

  let payload;
  try {
    payload = verifyJWT(token, secret);
  } catch (err) {
    return res.status(401).json({ error: 'Session token invalide : ' + err.message });
  }

  const shop = (payload.dest || '').replace('https://', '').toLowerCase();
  const record = getShop(shop);
  if (!record) {
    return res.status(403).json({ error: 'Shop non installé' });
  }

  req.shopDomain = shop;
  req.shopRecord = record; // { id, shop_domain, access_token, scope, ... }
  next();
}

module.exports = router;
module.exports.requireShopifySession = requireShopifySession;
module.exports.verifyJWT = verifyJWT;
