'use strict';
const express = require('express');
const router  = express.Router();
const https   = require('https');
const { requireAuth } = require('./auth');

const STORE_DOMAIN      = process.env.SHOPIFY_STORE_DOMAIN      || '';
const STOREFRONT_TOKEN  = process.env.SHOPIFY_STOREFRONT_TOKEN  || '';
const PRODUCT_VARIANT_MAP = {};  // populated from /api/shopify/sync-products

// ── GraphQL helper ────────────────────────────────────────────────────
function storefrontQuery(query, variables = {}) {
  return new Promise((resolve, reject) => {
    if (!STORE_DOMAIN || !STOREFRONT_TOKEN) {
      return reject(new Error('Shopify Storefront not configured — set SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_TOKEN in .env'));
    }

    const body = JSON.stringify({ query, variables });
    const req  = https.request({
      hostname: STORE_DOMAIN.replace('https://', '').replace('http://', ''),
      path: '/api/2024-01/graphql.json',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.errors) reject(new Error(json.errors.map(e => e.message).join(', ')));
          else resolve(json.data);
        } catch (e) {
          reject(new Error(`Shopify parse error: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── GET /api/shopify/products — liste les produits Shopify ────────────
// Priorité : Storefront API (si configurée) → Admin REST API (token OAuth en DB)
router.get('/products', async (req, res) => {
  // 1. Essai Storefront API
  if (STORE_DOMAIN && STOREFRONT_TOKEN) {
    try {
      const data = await storefrontQuery(`
        query {
          products(first: 250) {
            edges {
              node {
                id handle title
                priceRange { minVariantPrice { amount currencyCode } }
                variants(first: 50) {
                  edges {
                    node {
                      id title availableForSale
                      selectedOptions { name value }
                      price { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }
      `);
      return res.json(data.products.edges.map(e => e.node));
    } catch (err) {
      console.warn('Storefront API failed, falling back to Admin API:', err.message);
    }
  }

  // 2. Fallback : Admin REST API via token OAuth stocké en DB
  try {
    const { getDB } = require('../db/database');
    const db        = getDB();
    const shopRecord = db.prepare(
      'SELECT shop_domain, access_token FROM shops WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
    ).get();

    if (!shopRecord || !shopRecord.access_token) {
      return res.status(503).json({ error: 'Shopify non configuré — installez l\'app via OAuth', configured: false });
    }

    const apiRes = await fetch(
      `https://${shopRecord.shop_domain}/admin/api/2024-01/products.json?limit=250&fields=id,title,handle,images`,
      { headers: { 'X-Shopify-Access-Token': shopRecord.access_token } }
    );

    if (!apiRes.ok) {
      const txt = await apiRes.text();
      return res.status(apiRes.status).json({ error: txt, configured: false });
    }

    const { products } = await apiRes.json();
    // Normaliser au format attendu par le front (id = GID, title, handle, image)
    const normalized = (products || []).map(p => ({
      id:     `gid://shopify/Product/${p.id}`,
      handle: p.handle,
      title:  p.title,
      image:  p.images?.[0] ? { url: p.images[0].src, altText: p.images[0].alt || p.title } : null,
    }));
    return res.json(normalized);
  } catch (err) {
    console.error('Admin API fallback error:', err.message);
    res.status(500).json({ error: err.message, configured: false });
  }
});

// ── POST /api/shopify/cart/create — crée un cart et y ajoute un item ──
router.post('/cart/create', async (req, res) => {
  const { variantId, quantity = 1, attributes = [] } = req.body;
  if (!variantId) return res.status(400).json({ error: 'variantId required' });

  try {
    const data = await storefrontQuery(`
      mutation cartCreate($input: CartInput!) {
        cartCreate(input: $input) {
          cart {
            id checkoutUrl
            lines(first: 10) {
              edges { node { id quantity merchandise { ... on ProductVariant { id title } } } }
            }
            cost {
              totalAmount { amount currencyCode }
            }
          }
          userErrors { field message }
        }
      }
    `, {
      input: {
        lines: [{ merchandiseId: variantId, quantity }],
        attributes,
      },
    });

    const { cart, userErrors } = data.cartCreate;
    if (userErrors?.length) return res.status(400).json({ errors: userErrors });
    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/shopify/cart/add — ajoute une ligne à un cart existant ──
router.post('/cart/add', async (req, res) => {
  const { cartId, variantId, quantity = 1, attributes = [] } = req.body;
  if (!cartId || !variantId) return res.status(400).json({ error: 'cartId and variantId required' });

  try {
    const data = await storefrontQuery(`
      mutation cartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
        cartLinesAdd(cartId: $cartId, lines: $lines) {
          cart {
            id checkoutUrl
            lines(first: 20) {
              edges {
                node {
                  id quantity
                  merchandise { ... on ProductVariant { id title price { amount } } }
                  attributes { key value }
                }
              }
            }
            cost { totalAmount { amount currencyCode } }
          }
          userErrors { field message }
        }
      }
    `, {
      cartId,
      lines: [{ merchandiseId: variantId, quantity, attributes }],
    });

    const { cart, userErrors } = data.cartLinesAdd;
    if (userErrors?.length) return res.status(400).json({ errors: userErrors });
    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/shopify/cart/:cartId — récupère le cart ──────────────────
router.get('/cart/:cartId', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.cartId);
    const data = await storefrontQuery(`
      query getCart($cartId: ID!) {
        cart(id: $cartId) {
          id checkoutUrl
          lines(first: 20) {
            edges {
              node {
                id quantity
                merchandise { ... on ProductVariant { id title price { amount currencyCode } } }
                attributes { key value }
              }
            }
          }
          cost { totalAmount { amount currencyCode } subtotalAmount { amount currencyCode } }
        }
      }
    `, { cartId: id });
    res.json(data.cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/shopify/checkout — crée checkout avec design attaché ────
// Appelé depuis le front : reçoit le design + infos produit, crée la commande
router.post('/checkout', async (req, res) => {
  const {
    product, format, color,
    quantity    = 1,
    design_id,
    thumbnail,
    views_count = 1,   // nombre de vues/faces avec contenu (facturation par face)
    cart_items  = [],  // articles complets du panier multi-vues
  } = req.body;

  const { getDB } = require('../db/database');
  const db = getDB();
  let savedDesignId = design_id;

  const EXTRA_PRICE  = { A3: 8, A4: 5, A5: 3, A6: 2 };
  const BASE_PRICE   = { tshirt: 19.90, hoodie: 39.90, cap: 24.90, totebag: 14.90 };

  // Prix unitaire total = base + (extra × vues_avec_contenu)
  const basePrice  = BASE_PRICE[product]  || 0;
  const extraTotal = (EXTRA_PRICE[format] || 0) * Math.max(1, views_count);
  const unitPrice  = basePrice + extraTotal;

  try {
    // Construire les attributs Shopify (line item properties visibles dans l'admin)
    const attributes = [
      { key: '_design_id',    value: String(savedDesignId || '') },
      { key: '_product',      value: product },
      { key: '_format',       value: format },
      { key: '_color',        value: color || '#FFFFFF' },
      { key: '_views_count',  value: String(views_count) },
      { key: '_unit_price',   value: String(unitPrice.toFixed(2)) },
      // Détail des faces (JSON compact pour l'admin)
      ...(cart_items.length > 1 ? [{ key: '_faces', value: cart_items.map(i => i.viewLabel || i.format).join(', ') }] : []),
    ];

    const variantId = getVariantId(product, format);

    if (!variantId) {
      // Mode dégradé sans config Shopify
      const total = unitPrice * quantity;
      return res.json({
        configured:  false,
        message:     'Shopify Storefront non configuré — voir .env',
        order: { product, format, color, quantity, views_count, unit_price: unitPrice, total, design_id: savedDesignId },
      });
    }

    // Créer le cart Shopify avec les propriétés du design + prix multi-vues
    const cartData = await storefrontQuery(`
      mutation cartCreate($input: CartInput!) {
        cartCreate(input: $input) {
          cart { id checkoutUrl cost { totalAmount { amount currencyCode } } }
          userErrors { field message }
        }
      }
    `, {
      input: {
        lines: [{ merchandiseId: variantId, quantity, attributes }],
        note: `Design #${savedDesignId} — ${product} ${format} ${color}${views_count > 1 ? ` (${views_count} faces)` : ''}`,
      },
    });

    const { cart, userErrors } = cartData.cartCreate;
    if (userErrors?.length) return res.status(400).json({ errors: userErrors });

    res.json({
      configured:  true,
      checkoutUrl: cart.checkoutUrl,
      cartId:      cart.id,
      unitPrice,
      views_count,
    });

  } catch (err) {
    res.status(500).json({ error: err.message, configured: !!(STORE_DOMAIN && STOREFRONT_TOKEN) });
  }
});

// ── GET /api/shopify/status — vérifie la configuration ───────────────
router.get('/status', (req, res) => {
  res.json({
    configured: !!(STORE_DOMAIN && STOREFRONT_TOKEN),
    store: STORE_DOMAIN || null,
    storefront_token_set: !!STOREFRONT_TOKEN,
  });
});

// ── Mapping produit → variant Shopify ────────────────────────────────
// À configurer dans .env ou via /api/shopify/variants (admin)
function getVariantId(product, format) {
  const key = `${product}_${format}`;
  // Env vars : SHOPIFY_VARIANT_TSHIRT_A4=gid://shopify/ProductVariant/xxx
  const envKey = `SHOPIFY_VARIANT_${product.toUpperCase()}_${format}`;
  return process.env[envKey] || PRODUCT_VARIANT_MAP[key] || null;
}

// ── POST /api/shopify/variants — admin : définir les variant IDs ──────
router.post('/variants', requireAuth, (req, res) => {
  const { mappings } = req.body; // { tshirt_A4: 'gid://...', ... }
  if (!mappings) return res.status(400).json({ error: 'mappings required' });
  Object.assign(PRODUCT_VARIANT_MAP, mappings);
  res.json({ ok: true, mappings: PRODUCT_VARIANT_MAP });
});

router.get('/variants', (req, res) => {
  res.json({ mappings: PRODUCT_VARIANT_MAP });
});

module.exports = router;
module.exports.getVariantId = getVariantId;
