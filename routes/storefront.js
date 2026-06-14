'use strict';
const express = require('express');
const router  = express.Router();
const https   = require('https');
const { requireAuth } = require('./auth');
const { attachShopId, attachShopIdSoft } = require('./_shop-context');

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
  // MULTI-BOUTIQUE : on liste TOUJOURS les produits de la boutique courante via
  // l'API Admin avec son token OAuth (résolu par shop param / header / session).
  // On n'utilise PLUS la Storefront API en variable d'env (SHOPIFY_STORE_DOMAIN/
  // STOREFRONT_TOKEN) : c'était single-tenant — ça renvoyait les produits d'UNE
  // boutique fixe à tous les marchands. (Conservée uniquement pour panier/checkout,
  // à migrer aussi — voir cart/* et /checkout.)
  try {
    const { getDB, getShopIdByDomain, getBootstrapShopId } = require('../db/database');
    const db        = getDB();

    // Résoudre le shop courant : header > query > bootstrap (PLUS de LIMIT 1 sur shops)
    const headerShop = (req.headers['x-shop-domain'] || '').toLowerCase().trim();
    const queryShop  = (req.query?.shop || '').toLowerCase().trim();
    let shopId = null;
    if (req.shopRecord?.id) shopId = req.shopRecord.id;
    else if (queryShop)     shopId = getShopIdByDomain(queryShop);
    else if (headerShop)    shopId = getShopIdByDomain(headerShop);
    else                    shopId = getBootstrapShopId();

    if (!shopId) {
      return res.status(503).json({ error: 'Aucun shop installé — installez l\'app via OAuth', configured: false });
    }

    const shopRecord = db.prepare(
      'SELECT shop_domain, access_token FROM shops WHERE id = ? AND is_active = 1'
    ).get(shopId);

    if (!shopRecord || !shopRecord.access_token) {
      return res.status(503).json({ error: 'Shopify non configuré — installez l\'app via OAuth', configured: false });
    }

    const apiRes = await fetch(
      `https://${shopRecord.shop_domain}/admin/api/2024-01/products.json?limit=250&fields=id,title,handle,images,image,options,variants`,
      { headers: { 'X-Shopify-Access-Token': shopRecord.access_token } }
    );

    if (!apiRes.ok) {
      const txt = await apiRes.text();
      return res.status(apiRes.status).json({ error: txt, configured: false });
    }

    const { products } = await apiRes.json();
    // Normaliser au format attendu par le front : image avec url+src,
    // variants/options conservés pour extraction des tailles & prix.
    const normalized = (products || []).map(p => {
      const firstImg = p.images?.[0]?.src || p.image?.src || '';
      return {
        id:     `gid://shopify/Product/${p.id}`,
        handle: p.handle,
        title:  p.title,
        image:  firstImg ? { url: firstImg, src: firstImg, altText: p.images?.[0]?.alt || p.image?.alt || p.title } : null,
        images: firstImg ? [{ src: firstImg, url: firstImg }] : [],
        options: p.options || [],
        variants: (p.variants || []).map(v => ({
          id: `gid://shopify/ProductVariant/${v.id}`,
          title: v.title,
          option1: v.option1,
          option2: v.option2,
          option3: v.option3,
          price: v.price, // string "19.90" en REST
          available: v.inventory_quantity == null ? true : v.inventory_quantity > 0,
        })),
      };
    });
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

// ── GET /api/shopify/product-variant?handle=xxx
// Récupère le premier variantId Shopify d'un produit via Admin REST API
// Utilisé par le studio pour construire l'URL /cart/{variantId}:1
// (évite les problèmes CORS depuis le navigateur vers la boutique protégée)
router.get('/product-variant', async (req, res) => {
  const { handle, product_id } = req.query;
  if (!handle && !product_id) return res.status(400).json({ error: 'handle ou product_id requis' });

  try {
    const { getDB, getShopIdByDomain, getBootstrapShopId } = require('../db/database');
    const db = getDB();

    // Résoudre le shop courant (audit B1 : plus de LIMIT 1)
    const headerShop = (req.headers['x-shop-domain'] || '').toLowerCase().trim();
    const queryShop  = (req.query?.shop || '').toLowerCase().trim();
    let shopId = null;
    if (req.shopRecord?.id) shopId = req.shopRecord.id;
    else if (queryShop)     shopId = getShopIdByDomain(queryShop);
    else if (headerShop)    shopId = getShopIdByDomain(headerShop);
    else                    shopId = getBootstrapShopId();

    if (!shopId) {
      return res.status(503).json({ error: 'Aucun shop installé — installez l\'app via OAuth' });
    }

    const shopRecord = db.prepare(
      'SELECT shop_domain, access_token FROM shops WHERE id = ? AND is_active = 1'
    ).get(shopId);

    if (!shopRecord?.access_token) {
      return res.status(503).json({ error: 'Shopify non configuré — OAuth requis' });
    }

    const query = product_id
      ? `ids=${encodeURIComponent(product_id)}`
      : `handle=${encodeURIComponent(handle)}`;
    const apiRes = await fetch(
      `https://${shopRecord.shop_domain}/admin/api/2024-01/products.json?${query}&fields=id,handle,variants`,
      { headers: { 'X-Shopify-Access-Token': shopRecord.access_token } }
    );

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: `Shopify API error ${apiRes.status}` });
    }

    const data = await apiRes.json();
    const product = data.products?.[0];
    if (!product) return res.status(404).json({ error: `Produit introuvable (${handle || product_id})` });

    const variant = product.variants?.[0];
    if (!variant) return res.status(404).json({ error: 'Aucune variante trouvée' });

    res.json({
      product_id: product.id,
      handle:     product.handle,
      variant_id: variant.id,
      variant_price: Number(variant.price || 0),
      variant_gid: `gid://shopify/ProductVariant/${variant.id}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/shopify/fee-variant — variante "Frais d'impression" de la boutique
// ─────────────────────────────────────────────────────────────────────────────
// Le panier Shopify facture le prix de la variante : pour ajouter la surcharge
// de format (A3/A4/...) au total réel sans Shopify Plus, on ajoute une 2e ligne
// "Frais d'impression" (variante à 0,50 €, quantité = surcharge/0,50).
//
// Cet endpoint renvoie l'ID de variante de frais de la boutique courante :
//   1. s'il est déjà configuré (settings.fee_variant_id) → on le renvoie ;
//   2. sinon on tente de créer un produit caché (nécessite le scope write_products) ;
//   3. si la création échoue (scope manquant) → 409 avec needs_setup:true.
const FEE_UNIT = 0.50; // granularité (0,50 € → gère 1,50 / 2 / 3 / 4 et leurs sommes)

router.get('/fee-variant', attachShopId, async (req, res) => {
  try {
    const { getDB } = require('../db/database');
    const { getSetting, setSetting } = require('../db/settings');
    const db = getDB();
    const shopId = req.shopId;
    if (!shopId) return res.status(400).json({ error: 'Boutique introuvable' });

    // 1. Déjà configuré ?
    const existing = getSetting(shopId, 'fee_variant_id');
    if (existing) return res.json({ variant_id: String(existing), unit: FEE_UNIT });

    // 2. Tenter la création (write_products requis)
    const shopRecord = db.prepare(
      'SELECT shop_domain, access_token FROM shops WHERE id = ? AND is_active = 1'
    ).get(shopId);
    if (!shopRecord?.access_token) {
      return res.status(503).json({ error: 'Boutique non installée', needs_setup: true });
    }

    const payload = { product: {
      title:      "Frais d'impression",
      body_html:  "Frais de personnalisation (surcharge d'impression selon le format du visuel). Ajouté automatiquement par TextileLab Studio.",
      vendor:     'TextileLab',
      product_type: 'Service',
      status:     'active',
      tags:       'textilelab, frais-impression',
      variants: [{
        price: FEE_UNIT.toFixed(2),
        requires_shipping: false,
        taxable: true,
        inventory_management: null,
        inventory_policy: 'continue',
        title: 'Frais',
      }],
    }};

    const cRes = await fetch(`https://${shopRecord.shop_domain}/admin/api/2024-01/products.json`, {
      method:  'POST',
      headers: { 'X-Shopify-Access-Token': shopRecord.access_token, 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!cRes.ok) {
      const txt = await cRes.text();
      // 403 = scope write_products manquant → setup manuel requis
      const needs_setup = cRes.status === 401 || cRes.status === 403;
      console.warn('fee-variant create failed:', cRes.status, txt.slice(0, 200));
      return res.status(needs_setup ? 409 : cRes.status).json({ error: txt, needs_setup });
    }

    const { product } = await cRes.json();
    const variantId = product?.variants?.[0]?.id;
    if (!variantId) return res.status(500).json({ error: 'Variante de frais non créée' });

    setSetting(shopId, 'fee_product_id', String(product.id));
    setSetting(shopId, 'fee_variant_id', String(variantId));
    return res.json({ variant_id: String(variantId), unit: FEE_UNIT, created: true });
  } catch (err) {
    console.error('fee-variant error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shopify/fee-variant — configuration manuelle (admin) du variant_id
// Body: { variant_id: "1234567890" }  (l'admin colle l'ID de la variante du
// produit "Frais d'impression" qu'il a créé à la main, à 0,50 €).
router.post('/fee-variant', requireAuth, attachShopId, (req, res) => {
  try {
    const { setSetting } = require('../db/settings');
    const shopId = req.shopId;
    if (!shopId) return res.status(400).json({ error: 'Boutique introuvable' });
    const raw = String(req.body?.variant_id || '').trim();
    const vid = raw.replace(/^gid:\/\/shopify\/ProductVariant\//, '');
    if (!/^\d+$/.test(vid)) return res.status(400).json({ error: 'variant_id invalide (ID numérique attendu)' });
    setSetting(shopId, 'fee_variant_id', vid);
    return res.json({ variant_id: vid, unit: FEE_UNIT, saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getVariantId = getVariantId;
