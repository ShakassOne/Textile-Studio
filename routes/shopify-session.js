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
const https   = require('https');
const { getDB, getShop } = require('../db/database');

const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET: SHOPIFY_SECRET_FOR_EXCHANGE } = process.env;

// ── Fallback Shopify Managed Installation : token exchange ──────────────────
/**
 * Quand l'app est installée via le flow managé de Shopify (pas de
 * legacy_install_flow dans shopify.app.toml), /oauth/callback n'est jamais
 * appelé pour les nouveaux installs et la table `shops` reste vide pour ce
 * store. On échange alors le session token (déjà vérifié) contre un access
 * token offline via le endpoint token exchange officiel :
 * https://shopify.dev/docs/apps/auth/get-access-tokens/token-exchange
 */
function _tokenExchange(shop, sessionToken) {
  return new Promise((resolve, reject) => {
    if (!SHOPIFY_API_KEY || !SHOPIFY_SECRET_FOR_EXCHANGE) {
      return reject(new Error('SHOPIFY_API_KEY ou SHOPIFY_API_SECRET non défini'));
    }

    const body = JSON.stringify({
      client_id:            SHOPIFY_API_KEY,
      client_secret:        SHOPIFY_SECRET_FOR_EXCHANGE,
      grant_type:           'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token:        sessionToken,
      subject_token_type:   'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    });

    const options = {
      hostname: shop,
      path:     '/admin/oauth/access_token',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            resolve(parsed);
          } else {
            reject(new Error(
              parsed.error_description || parsed.error || 'Pas d\'access_token (token exchange)'
            ));
          }
        } catch {
          reject(new Error('Réponse JSON invalide de Shopify (token exchange)'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Auto-provisioning : upsert shops après token exchange réussi ────────────
function _provisionShop(shop, accessToken, scope) {
  const db = getDB();
  db.prepare(`
    INSERT INTO shops (shop_domain, access_token, scope, is_active, uninstalled_at, installed_at)
    VALUES (?, ?, ?, 1, NULL, datetime('now'))
    ON CONFLICT(shop_domain) DO UPDATE SET
      access_token   = excluded.access_token,
      scope          = excluded.scope,
      is_active      = 1,
      uninstalled_at = NULL,
      installed_at   = datetime('now')
  `).run(shop, accessToken, scope || '');
}

/**
 * Si le shop n'est pas (encore) en DB, tente l'auto-provisioning via token
 * exchange. Retourne le record shop (nouveau ou existant) ou null en cas
 * d'échec.
 */
async function _ensureShopProvisioned(shop, sessionToken) {
  const existing = getShop(shop);
  if (existing) return existing;

  try {
    const tokenData = await _tokenExchange(shop, sessionToken);
    _provisionShop(shop, tokenData.access_token, tokenData.scope);
    console.log(`🔄  Shop auto-provisionné via token exchange — shop: ${shop}`);
    return getShop(shop);
  } catch (err) {
    console.warn(`⚠️  Token exchange échoué — shop: ${shop}:`, err.message);
    return null;
  }
}

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

// ── M3 : Headers de réauthentification Shopify ──────────────────────────────
/**
 * Pose les headers que App Bridge 4 reconnaît pour déclencher un refresh
 * automatique du session token côté client.
 *
 * Doc Shopify : quand le serveur répond 401 avec ces headers, le client
 * App Bridge invalide le token cached et en redemande un nouveau via
 * `shopify.idToken()`. Combiné avec un wrapper fetch qui retry une fois sur 401,
 * la session token expirée devient transparente côté UX.
 *
 * @param {express.Response} res
 * @param {string} [shopDomain] domaine du shop (pour reconstruire l'URL d'auth)
 */
function setReauthHeaders(res, shopDomain) {
  res.setHeader('X-Shopify-API-Request-Failure-Reauthorize', '1');
  // URL de réauth — App Bridge ouvrira cette URL dans une popup pour relancer OAuth
  // si le token a expiré ET que le shop n'est plus authentifié. Pour un simple
  // refresh de session token, le client appelle shopify.idToken() et retry.
  // M7 (audit) : SHOPIFY_API_KEY n'est pas requis ici — /oauth/start le lit lui-même.
  if (shopDomain) {
    const reauthUrl = `/oauth/start?shop=${encodeURIComponent(shopDomain)}`;
    res.setHeader('X-Shopify-API-Request-Failure-Reauthorize-Url', reauthUrl);
  }
}

// ── POST /api/shopify-session/verify ────────────────────────────────────────
router.post('/verify', async (req, res) => {
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

  // Vérifier que le shop est bien installé en DB — sinon, fallback
  // Shopify Managed Installation : auto-provisioning via token exchange.
  const installed = await _ensureShopProvisioned(shop, token);
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
async function requireShopifySession(req, res, next) {
  const token  = _extractBearer(req);
  const secret = process.env.SHOPIFY_API_SECRET || '';

  if (!token) {
    setReauthHeaders(res, req.query.shop || req.headers['x-shopify-shop-domain']);
    return res.status(401).json({ error: 'Session token Shopify requis' });
  }

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
    // M3 : signaler à App Bridge qu'il doit forcer un refresh du token
    setReauthHeaders(res, req.query.shop || req.headers['x-shopify-shop-domain']);
    return res.status(401).json({ error: 'Session token invalide : ' + err.message });
  }

  const shop = (payload.dest || '').replace('https://', '').toLowerCase();

  // Fallback Shopify Managed Installation : auto-provisioning via token exchange
  // (cas où une route protégée est appelée avant /verify, ou si /verify
  // n'a pas pu provisionner pour une autre raison).
  const record = await _ensureShopProvisioned(shop, token);
  if (!record) {
    return res.status(403).json({ error: 'Shop non installé' });
  }

  req.shopDomain = shop;
  req.shopRecord = record; // { id, shop_domain, access_token, scope, ... }
  req.shopId     = record.id; // Audit B1 : injection multi-tenant
  next();
}

module.exports = router;
module.exports.requireShopifySession = requireShopifySession;
module.exports.verifyJWT = verifyJWT;
module.exports.setReauthHeaders = setReauthHeaders;
// Exporté pour l'auth duale du back-office (routes/auth.js → requireAuth)
module.exports.ensureShopProvisioned = _ensureShopProvisioned;
