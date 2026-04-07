'use strict';
/**
 * routes/oauth.js — Shopify OAuth 2.0
 * ------------------------------------
 *  GET /oauth/install?shop=xxx.myshopify.com
 *    → Redirige vers la page d'autorisation Shopify
 *
 *  GET /oauth/callback?code=&shop=&state=&hmac=
 *    → Vérifie HMAC + nonce, échange code → access_token, persiste en DB
 *    → Redirige vers /admin/apps/<handle>
 *
 * Variables d'environnement requises :
 *   SHOPIFY_API_KEY       — Client ID de l'app Shopify
 *   SHOPIFY_API_SECRET    — Client Secret de l'app Shopify
 *   SHOPIFY_APP_URL       — URL publique du backend (ex: https://textilelab.up.railway.app)
 *   SHOPIFY_SCOPES        — Scopes OAuth (défaut ci-dessous)
 *   SHOPIFY_APP_HANDLE    — Handle de l'app dans l'admin Shopify (ex: textilelab)
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const https   = require('https');
const { getDB } = require('../db/database');

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SHOPIFY_APP_URL,
} = process.env;

const DEFAULT_SCOPES = [
  'read_products',
  'write_products',
  'read_orders',
  'write_orders',
  'read_customers',
].join(',');

// ── Anti-CSRF nonce store (in-memory, TTL 10 min) ────────────────────────────
// Production: remplacer par Redis si plusieurs instances
const _nonces  = new Map(); // nonce → { shop, expiresAt }
const NONCE_TTL = 10 * 60 * 1000; // 10 minutes

function _createNonce(shop) {
  const nonce = crypto.randomBytes(16).toString('hex');
  _nonces.set(nonce, { shop, expiresAt: Date.now() + NONCE_TTL });
  // Nettoyage des nonces expirés
  for (const [k, v] of _nonces) {
    if (v.expiresAt < Date.now()) _nonces.delete(k);
  }
  return nonce;
}

function _verifyNonce(nonce, shop) {
  const entry = _nonces.get(nonce);
  if (!entry) return false;
  _nonces.delete(nonce); // usage unique
  if (entry.expiresAt < Date.now()) return false;
  if (entry.shop !== shop) return false;
  return true;
}

// ── Vérification HMAC du callback OAuth ──────────────────────────────────────
function _verifyCallbackHMAC(query) {
  if (!SHOPIFY_API_SECRET) return true; // passer en dev sans secret
  const { hmac, signature, ...rest } = query; // eslint-disable-line no-unused-vars
  // Message = clés triées alphabétiquement, séparées par &
  const message = Object.keys(rest)
    .sort()
    .map(k => `${k}=${rest[k]}`)
    .join('&');
  const hash = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmac || ''));
  } catch {
    return false;
  }
}

// ── Validation du domaine shop ────────────────────────────────────────────────
function _isValidShopDomain(shop) {
  return /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop);
}

// ── Échange code → access_token (Promise) ────────────────────────────────────
function _exchangeToken(shop, code) {
  return new Promise((resolve, reject) => {
    if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
      return reject(new Error('SHOPIFY_API_KEY ou SHOPIFY_API_SECRET non défini'));
    }

    const body = JSON.stringify({
      client_id:     SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
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
              parsed.error_description || parsed.error || 'Pas d\'access_token dans la réponse Shopify'
            ));
          }
        } catch {
          reject(new Error('Réponse JSON invalide de Shopify'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /oauth/install?shop=xxx.myshopify.com
// ─────────────────────────────────────────────────────────────────────────────
router.get('/install', (req, res) => {
  const shop = (req.query.shop || '').toLowerCase().trim();

  if (!shop || !_isValidShopDomain(shop)) {
    return res.status(400).send('Paramètre shop invalide ou manquant.');
  }

  if (!SHOPIFY_API_KEY) {
    return res.status(500).send('Configuration manquante : SHOPIFY_API_KEY non défini.');
  }

  if (!SHOPIFY_APP_URL) {
    return res.status(500).send('Configuration manquante : SHOPIFY_APP_URL non défini.');
  }

  const scopes      = process.env.SHOPIFY_SCOPES || DEFAULT_SCOPES;
  const nonce       = _createNonce(shop);
  const redirectUri = `${SHOPIFY_APP_URL}/oauth/callback`;

  const installUrl = 'https://' + shop + '/admin/oauth/authorize'
    + '?client_id='    + encodeURIComponent(SHOPIFY_API_KEY)
    + '&scope='        + encodeURIComponent(scopes)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&state='        + nonce;
    // token offline (permanent) — retirer la ligne per-user

  console.log(`🔐  OAuth install — shop: ${shop}`);
  return res.redirect(installUrl);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /oauth/callback?code=&shop=&state=&hmac=&timestamp=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/callback', async (req, res) => {
  const { shop, code, state, hmac } = req.query;

  // 1. Valider le domaine
  if (!shop || !_isValidShopDomain(shop)) {
    return res.status(400).send('Paramètre shop invalide.');
  }

  // 2. Vérifier le HMAC Shopify
  if (!_verifyCallbackHMAC(req.query)) {
    console.warn(`⚠️  OAuth callback — HMAC invalide pour shop: ${shop}`);
    return res.status(403).send('Signature invalide.');
  }

  // 3. Vérifier le nonce anti-CSRF
  if (!_verifyNonce(state, shop)) {
    console.warn(`⚠️  OAuth callback — nonce invalide/expiré pour shop: ${shop}`);
    return res.status(403).send('State/nonce invalide ou expiré. Recommencez l\'installation.');
  }

  // 4. Échanger le code contre un access_token
  let tokenData;
  try {
    tokenData = await _exchangeToken(shop, code);
  } catch (err) {
    console.error(`❌  OAuth token exchange — shop ${shop}:`, err.message);
    return res.status(500).send('Erreur lors de l\'obtention du token Shopify.');
  }

  const { access_token, scope, associated_user } = tokenData;

  // 5. Persister le shop en base
  try {
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
    `).run(shop, access_token, scope || '');

    const user = associated_user ? `${associated_user.first_name} ${associated_user.last_name}`.trim() : 'owner';
    console.log(`✅  OAuth — shop ${shop} installé (user: ${user}), token stocké.`);
  } catch (err) {
    console.error(`❌  DB shops insert — shop ${shop}:`, err.message);
    return res.status(500).send('Erreur de sauvegarde en base de données.');
  }

  // 6. Enregistrer le webhook app/uninstalled (fire-and-forget)
  _registerWebhook(shop, access_token, 'app/uninstalled', `${SHOPIFY_APP_URL}/shopify/webhook`)
    .then(() => console.log(`🪝  Webhook app/uninstalled enregistré pour ${shop}`))
    .catch(err => console.warn(`⚠️  Webhook app/uninstalled non enregistré pour ${shop}:`, err.message));

  // 7. Rediriger vers l'app embedded dans l'admin Shopify après installation
  // Pattern standard Embedded App : Shopify ouvre l'App URL avec ?shop=&host=
  const shopName = shop.replace('.myshopify.com', '');
  const embeddedUrl = `https://admin.shopify.com/store/${shopName}/apps/${SHOPIFY_API_KEY}`;
  console.log(`OAuth callback - redirection embedded : ${embeddedUrl}`);
  return res.redirect(embeddedUrl);
});

// ── Enregistrement d'un webhook Shopify via REST Admin API ───────────────────
function _registerWebhook(shop, accessToken, topic, address) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      webhook: { topic, address, format: 'json' },
    });

    const options = {
      hostname: shop,
      path:     '/admin/api/2024-01/webhooks.json',
      method:   'POST',
      headers: {
        'Content-Type':          'application/json',
        'Content-Length':        Buffer.byteLength(body),
        'X-Shopify-Access-Token': accessToken,
      },
    };

    const req = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        // 201 = créé, 422 = déjà existant → les deux sont OK
        if (response.statusCode === 201 || response.statusCode === 422) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${response.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = router;
