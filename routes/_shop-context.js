'use strict';
/**
 * routes/_shop-context.js — Middleware de résolution du shop courant
 * ──────────────────────────────────────────────────────────────────────
 * Audit B1 (2026-04-19) : toutes les routes scopées multi-tenant doivent
 * connaître le `shop_id` du marchand courant pour filtrer leurs requêtes.
 *
 * Le middleware `attachShopId` essaie dans l'ordre :
 *
 *   1. req.shopRecord    — déjà résolu par requireShopifySession (admin embed)
 *   2. req.query.shop    — App Proxy (signé HMAC dans app-proxy.js en amont)
 *   3. header X-Shop-Domain — back-office TextileLab (admin global)
 *   4. SHOPIFY_BOOTSTRAP_SHOP env — fallback dev / mono-shop
 *
 * → Pose `req.shopId` (number) et `req.shopDomain` (string) sur la requête.
 * → Si aucun shop ne peut être résolu, renvoie 400 (sauf en mode soft, voir
 *   `attachShopIdSoft` qui laisse req.shopId à null).
 *
 * Usage :
 *   const { attachShopId } = require('./_shop-context');
 *   router.get('/foo', attachShopId, (req, res) => {
 *     db.prepare('SELECT * FROM designs WHERE shop_id = ?').all(req.shopId);
 *   });
 */

const { getShopIdByDomain, getBootstrapShopId } = require('../db/database');

function _resolveShopId(req) {
  // 1. requireShopifySession a déjà fait le boulot
  if (req.shopRecord?.id) {
    return { shopId: req.shopRecord.id, shopDomain: req.shopRecord.shop_domain };
  }

  // 2. App Proxy : ?shop=xxx.myshopify.com (HMAC déjà vérifié par requireProxyHMAC en amont)
  const queryShop = (req.query?.shop || '').toLowerCase().trim();
  if (queryShop) {
    const id = getShopIdByDomain(queryShop);
    if (id) return { shopId: id, shopDomain: queryShop };
  }

  // 3. Header explicite (back-office TextileLab admin)
  const headerShop = (req.headers['x-shop-domain'] || '').toLowerCase().trim();
  if (headerShop) {
    const id = getShopIdByDomain(headerShop);
    if (id) return { shopId: id, shopDomain: headerShop };
  }

  // 3bis. Session token Shopify dans Authorization (admin embed multi-marchand)
  // → garantit que les routes SANS requireAuth (ex: GET /api/designs) résolvent
  //   le MÊME shop que les routes AVEC requireAuth (ex: DELETE /api/designs/:id),
  //   sinon la liste et la suppression peuvent pointer sur deux shops différents.
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const tok = authHeader.slice(7);
    if (tok.split('.').length === 3) {
      try {
        const { verifyJWT } = require('./shopify-session'); // lazy : pas de cycle au boot
        const secret = process.env.SHOPIFY_API_SECRET || '';
        if (secret) {
          const payload = verifyJWT(tok, secret);
          const jwtShop = (payload.dest || '').replace('https://', '').toLowerCase().trim();
          if (jwtShop) {
            const id = getShopIdByDomain(jwtShop);
            if (id) return { shopId: id, shopDomain: jwtShop };
          }
        }
      } catch (_) { /* JWT invalide/expiré → on continue vers le fallback */ }
    }
  }

  // 4. Fallback bootstrap (dev, mono-shop, données legacy)
  const bootstrapId = getBootstrapShopId();
  if (bootstrapId) {
    return {
      shopId: bootstrapId,
      shopDomain: (process.env.SHOPIFY_BOOTSTRAP_SHOP || '').toLowerCase().trim(),
    };
  }

  return { shopId: null, shopDomain: null };
}

/**
 * Middleware strict : exige un shop résolvable, sinon 400.
 */
function attachShopId(req, res, next) {
  const { shopId, shopDomain } = _resolveShopId(req);
  if (!shopId) {
    return res.status(400).json({
      error: 'Shop context manquant — fournissez header X-Shop-Domain ou ?shop=xxx.myshopify.com',
    });
  }
  req.shopId = shopId;
  if (!req.shopDomain) req.shopDomain = shopDomain;
  next();
}

/**
 * Middleware soft : ne bloque pas si pas de shop, mais pose req.shopId à null.
 * À utiliser sur les routes publiques (sans auth) qui doivent quand même
 * filtrer leurs résultats si un shop est disponible.
 */
function attachShopIdSoft(req, res, next) {
  const { shopId, shopDomain } = _resolveShopId(req);
  req.shopId = shopId || null;
  if (!req.shopDomain) req.shopDomain = shopDomain || null;
  next();
}

module.exports = { attachShopId, attachShopIdSoft };
