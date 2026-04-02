'use strict';
/**
 * routes/admin-graphql.js — Shopify Admin GraphQL API
 * ─────────────────────────────────────────────────────
 * Remplace les anciens appels REST Admin (legacy depuis Oct 2024).
 * Toutes les routes requièrent un session token Shopify valide (App Bridge 4).
 *
 * Endpoints :
 *   GET  /api/admin/products          — Liste produits Shopify (Admin)
 *   POST /api/admin/products/create   — Crée un produit + variante
 *   GET  /api/admin/orders            — Liste commandes récentes
 *   POST /api/admin/graphql           — Proxy GraphQL générique (admin seulement)
 *
 * Auth : Bearer <shopify_session_token> (vérifié par requireShopifySession)
 * La route récupère l'access_token depuis la DB (table shops) via req.shopRecord.
 */

const express = require('express');
const router  = express.Router();
const https   = require('https');
const { requireShopifySession } = require('./shopify-session');
const { requireAuth }           = require('./auth');

// ── Version API Admin Shopify ────────────────────────────────────────────────
const ADMIN_API_VERSION = '2024-01';

// ── Helper : exécute une requête GraphQL Admin ───────────────────────────────
/**
 * @param {string} shopDomain  ex: "ma-boutique.myshopify.com"
 * @param {string} accessToken token OAuth du shop (table shops)
 * @param {string} query       requête ou mutation GraphQL
 * @param {object} variables   variables GraphQL (optionnel)
 */
function adminGraphQL(shopDomain, accessToken, query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });

    const options = {
      hostname: shopDomain,
      path:     `/admin/api/${ADMIN_API_VERSION}/graphql.json`,
      method:   'POST',
      headers: {
        'Content-Type':           'application/json',
        'X-Shopify-Access-Token': accessToken,
        'Content-Length':         Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.errors) {
            const msg = json.errors.map(e => e.message).join(' | ');
            reject(new Error(`GraphQL errors: ${msg}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error(`Réponse Shopify non-JSON: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Middleware : extraire shop + token depuis la session ─────────────────────
// requireShopifySession injecte req.shopDomain et req.shopRecord
// On vérifie aussi que l'access_token existe bien
function _getShopContext(req, res) {
  const shop   = req.shopDomain;
  const record = req.shopRecord;
  if (!shop || !record?.access_token) {
    res.status(403).json({ error: 'Contexte shop manquant — token OAuth introuvable' });
    return null;
  }
  return { shop, token: record.access_token };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/products — Liste des produits Admin
// ─────────────────────────────────────────────────────────────────────────────
router.get('/products', requireShopifySession, async (req, res) => {
  const ctx = _getShopContext(req, res);
  if (!ctx) return;

  const first  = Math.min(parseInt(req.query.limit) || 20, 100);
  const after  = req.query.after || null; // cursor pour la pagination

  const query = `
    query getProducts($first: Int!, $after: String) {
      products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            title
            handle
            status
            productType
            createdAt
            updatedAt
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  price
                  sku
                  inventoryQuantity
                  selectedOptions { name value }
                }
              }
            }
            images(first: 1) {
              edges { node { url altText } }
            }
          }
        }
      }
    }
  `;

  try {
    const result = await adminGraphQL(ctx.shop, ctx.token, query, { first, after });
    const { products } = result.data;
    res.json({
      products: products.edges.map(e => ({
        ...e.node,
        variants: e.node.variants.edges.map(v => v.node),
        image:    e.node.images.edges[0]?.node || null,
      })),
      pageInfo: products.pageInfo,
    });
  } catch (err) {
    console.error('❌  Admin GraphQL products:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/products/create — Crée un produit + variante
// Body: { title, productType, vendor, price, sku, description }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/products/create', requireShopifySession, async (req, res) => {
  const ctx = _getShopContext(req, res);
  if (!ctx) return;

  const { title, productType = 'Textile', vendor = 'TextileLab', price = '0.00', sku = '', description = '' } = req.body;
  if (!title) return res.status(400).json({ error: 'title requis' });

  const mutation = `
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id title handle status
          variants(first: 1) {
            edges { node { id price sku } }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    input: {
      title,
      productType,
      vendor,
      bodyHtml: description,
      status: 'DRAFT',
      variants: [{ price, sku }],
    },
  };

  try {
    const result = await adminGraphQL(ctx.shop, ctx.token, mutation, variables);
    const { product, userErrors } = result.data.productCreate;
    if (userErrors?.length) {
      return res.status(400).json({ errors: userErrors });
    }
    res.status(201).json({
      product: {
        ...product,
        variants: product.variants.edges.map(e => e.node),
      },
    });
  } catch (err) {
    console.error('❌  Admin GraphQL productCreate:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/orders — Liste des commandes récentes
// ─────────────────────────────────────────────────────────────────────────────
router.get('/orders', requireShopifySession, async (req, res) => {
  const ctx   = _getShopContext(req, res);
  if (!ctx) return;

  const first  = Math.min(parseInt(req.query.limit) || 10, 50);
  const status = req.query.status || 'any'; // open | closed | cancelled | any

  const query = `
    query getOrders($first: Int!, $query: String) {
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            name
            displayFinancialStatus
            displayFulfillmentStatus
            createdAt
            totalPriceSet { shopMoney { amount currencyCode } }
            customer { firstName lastName email }
            lineItems(first: 5) {
              edges {
                node {
                  title quantity
                  variant { id sku price }
                  customAttributes { key value }
                }
              }
            }
          }
        }
      }
    }
  `;

  const queryStr = status !== 'any' ? `status:${status}` : undefined;

  try {
    const result = await adminGraphQL(ctx.shop, ctx.token, query, { first, query: queryStr });
    const { orders } = result.data;
    res.json({
      orders: orders.edges.map(e => ({
        ...e.node,
        lineItems: e.node.lineItems.edges.map(l => l.node),
      })),
      pageInfo: orders.pageInfo,
    });
  } catch (err) {
    console.error('❌  Admin GraphQL orders:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/graphql — Proxy générique (admins TextileLab seulement)
// Permet au back-office d'exécuter des requêtes Admin GraphQL arbitraires
// Double auth : session Shopify + JWT TextileLab (requireAuth)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/graphql', requireAuth, requireShopifySession, async (req, res) => {
  const ctx = _getShopContext(req, res);
  if (!ctx) return;

  const { query, variables } = req.body;
  if (!query) return res.status(400).json({ error: 'query GraphQL requise' });

  // Blocklist de mutations dangereuses
  const forbidden = ['deleteShop', 'appUninstall', 'shopUpdate'];
  if (forbidden.some(f => query.includes(f))) {
    return res.status(403).json({ error: 'Opération non autorisée via ce proxy' });
  }

  try {
    const result = await adminGraphQL(ctx.shop, ctx.token, query, variables || {});
    res.json(result);
  } catch (err) {
    console.error('❌  Admin GraphQL proxy:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/shop — Infos de la boutique connectée
// ─────────────────────────────────────────────────────────────────────────────
router.get('/shop', requireShopifySession, async (req, res) => {
  const ctx = _getShopContext(req, res);
  if (!ctx) return;

  const query = `
    query {
      shop {
        id name email myshopifyDomain plan { displayName }
        primaryDomain { url }
        currencyCode
        ianaTimezone
        createdAt
      }
    }
  `;

  try {
    const result = await adminGraphQL(ctx.shop, ctx.token, query);
    res.json(result.data.shop);
  } catch (err) {
    console.error('❌  Admin GraphQL shop:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.adminGraphQL = adminGraphQL;
