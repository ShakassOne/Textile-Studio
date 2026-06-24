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
  // ── DÉPRÉCIÉ (juin 2026) ────────────────────────────────────────────────
  // Le modèle « 2e ligne Frais d'impression » est abandonné au profit de
  // variantes Shopify pré-tarifées (voir GET /api/shopify/resolve-variant).
  // On NE crée plus de produit caché. Le studio n'appelle plus cet endpoint.
  // 410 neutralise tout appel résiduel sans rien créer côté boutique.
  return res.status(410).json({
    deprecated: true,
    error: 'fee-variant supprimé : utilisez /api/shopify/resolve-variant (variantes pré-tarifées).',
  });
  /* eslint-disable no-unreachable */
  // eslint-disable-next-line no-unreachable
  try { // legacy (mort) — conservé pour historique, jamais atteint
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

// ═════════════════════════════════════════════════════════════════════════════
// RÉSOLUTION DE VARIANTE PRÉ-TARIFÉE (remplace « Frais d'impression »)
// ═════════════════════════════════════════════════════════════════════════════
// Objectif CDC (juin 2026) : UNE SEULE ligne panier, prix d'impression inclus
// dans la variante. Plus aucune 2e ligne, pas de Shopify Plus, pas de Cart
// Transform. TSL choisit automatiquement le bon variantId :
//   1. via une OPTION de variante « Impression » si le produit en a une ;
//   2. sinon via une TABLE DE MAPPING admin (settings.variant_mapping) ;
//   3. sinon erreur claire + log détaillé (rien n'est ajouté au panier).
const PRINT = require('../utils/print-tiers');

// Lit la table de mapping d'une boutique : { "<baseVariantId>::<TIER>": "<finalVariantId>" }
function readVariantMapping(shopId) {
  try {
    const { getSetting } = require('../db/settings');
    const raw = getSetting(shopId, 'variant_mapping');
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (_) { return {}; }
}

function writeVariantMapping(shopId, mapping) {
  const { setSetting } = require('../db/settings');
  setSetting(shopId, 'variant_mapping', JSON.stringify(mapping || {}));
}

// Récupère { shop_domain, access_token } de la boutique courante (ou null).
function getShopRecord(shopId) {
  const { getDB } = require('../db/database');
  return getDB().prepare(
    'SELECT shop_domain, access_token FROM shops WHERE id = ? AND is_active = 1'
  ).get(shopId) || null;
}

// Admin REST : produit complet (options + variants) par product_id.
async function fetchAdminProductById(shopRecord, productId) {
  const r = await fetch(
    `https://${shopRecord.shop_domain}/admin/api/2024-01/products/${encodeURIComponent(productId)}.json`,
    { headers: { 'X-Shopify-Access-Token': shopRecord.access_token } }
  );
  if (!r.ok) return null;
  const j = await r.json();
  return j.product || null;
}

// Admin REST : variante seule (pour récupérer product_id / price) par variant_id.
async function fetchAdminVariantById(shopRecord, variantId) {
  const r = await fetch(
    `https://${shopRecord.shop_domain}/admin/api/2024-01/variants/${encodeURIComponent(variantId)}.json`,
    { headers: { 'X-Shopify-Access-Token': shopRecord.access_token } }
  );
  if (!r.ok) return null;
  const j = await r.json();
  return j.variant || null;
}

// Admin GraphQL (2025-01) — utilisé pour ajouter l'option « Impression » à un
// produit (productOptionsCreate, indispo en REST 2024-01). Lance en cas d'erreur.
async function adminGraphQL(shopRecord, query, variables) {
  const r = await fetch(
    `https://${shopRecord.shop_domain}/admin/api/2025-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': shopRecord.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const j = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error('Admin GraphQL HTTP ' + r.status); e.status = r.status; throw e; }
  if (j && j.errors) throw new Error(j.errors.map(e => e.message).join(', '));
  return j ? j.data : null;
}

// Admin REST : crée une variante pré-tarifée (taille de base + palier d'impression).
// ADDITIF — ne modifie jamais les variantes existantes. La valeur d'option
// « Impression » (ex « +4,00 € ») est ajoutée automatiquement par Shopify si
// elle n'existe pas encore. Lance une erreur (.status) en cas d'échec.
async function createPricedVariant(shopRecord, product, baseVariant, printPos, wantLabel, price) {
  const variant = { price: Number(price).toFixed(2) };
  for (const i of [1, 2, 3]) {
    if (i === printPos) variant['option' + i] = wantLabel;
    else if (baseVariant['option' + i] != null) variant['option' + i] = baseVariant['option' + i];
  }
  // Hérite des propriétés logistiques de la variante de base.
  variant.taxable           = baseVariant.taxable !== false;
  variant.requires_shipping = baseVariant.requires_shipping !== false;
  if (baseVariant.weight != null) { variant.weight = baseVariant.weight; variant.weight_unit = baseVariant.weight_unit; }
  if (baseVariant.sku) variant.sku = baseVariant.sku;
  // Pas de suivi de stock sur la dimension « Impression » → toujours achetable.
  variant.inventory_management = null;
  variant.inventory_policy     = 'continue';

  const r = await fetch(
    `https://${shopRecord.shop_domain}/admin/api/2024-01/products/${encodeURIComponent(product.id)}/variants.json`,
    {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': shopRecord.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant }),
    }
  );
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = j && j.errors ? JSON.stringify(j.errors) : ('HTTP ' + r.status);
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return j.variant;
}

const _numId = (v) => String(v || '').replace(/^gid:\/\/shopify\/ProductVariant\//, '').trim();

/**
 * Fonction CENTRALE de résolution (modèle MONTANT).
 * @param {Object} p
 * @param {string} p.shopRecord     — { shop_domain, access_token }
 * @param {number} p.shopId
 * @param {string} p.baseVariantId  — variante de base (taille/couleur/genre) sélectionnée
 * @param {string} [p.productId]    — id produit Shopify (sinon déduit du baseVariant)
 * @param {number} p.amount         — surcharge totale d'impression en € (0 = sans impression)
 * @returns {Promise<{ ok, variant_id?, price?, source?, error?, needs_setup?, detail? }>}
 */
async function resolveVariantForCustomization(p) {
  const { shopRecord, shopId } = p;
  const baseVariantId = _numId(p.baseVariantId);
  const amount = Math.round(Number(p.amount || 0) * 100) / 100;

  if (!baseVariantId) return { ok: false, error: 'baseVariantId manquant' };

  // CAS « Sans impression » (montant 0) → on garde la variante de base telle quelle.
  if (amount <= 0) {
    let price = null;
    try {
      const v = await fetchAdminVariantById(shopRecord, baseVariantId);
      price = v ? Number(v.price) : null;
    } catch (_) {}
    return { ok: true, variant_id: baseVariantId, price, source: 'base', amount: 0 };
  }

  // Charger le produit (options + variants).
  let productId = p.productId ? String(p.productId).trim() : '';
  let baseVariant = null;
  let product = null;
  try {
    if (!productId) {
      const v = await fetchAdminVariantById(shopRecord, baseVariantId);
      if (v) { productId = String(v.product_id); }
    }
    if (productId) product = await fetchAdminProductById(shopRecord, productId);
  } catch (e) {
    return { ok: false, error: 'Admin API: ' + e.message };
  }
  if (product) {
    baseVariant = (product.variants || []).find(v => String(v.id) === baseVariantId) || null;
  }

  const wantLabel = PRINT.amountLabel(amount); // ex "+7,00 €"
  const detail = {
    product_id: productId || null,
    base_variant_id: baseVariantId,
    amount,
    label: wantLabel,
    base_options: baseVariant
      ? [baseVariant.option1, baseVariant.option2, baseVariant.option3]
      : null,
  };

  // Option « Impression » du produit (présente si le produit a été préparé).
  const printOpt = (product && Array.isArray(product.options))
    ? product.options.find(o => PRINT.isPrintOptionName(o.name))
    : null;
  if (printOpt) detail.print_option = printOpt.name;

  // ── STRATÉGIE A : variante existante avec la bonne valeur d'option ──────────
  if (printOpt && baseVariant) {
    const pos  = printOpt.position; // 1..3
    const want = PRINT.norm(wantLabel);
    // Mêmes valeurs sur les AUTRES positions que la variante de base,
    // et la position « Impression » dont la valeur == montant voulu.
    const match = (product.variants || []).find(v => {
      for (const i of [1, 2, 3]) {
        if (i === pos) {
          if (PRINT.norm(v['option' + i]) !== want) return false;
        } else {
          if ((v['option' + i] || null) !== (baseVariant['option' + i] || null)) return false;
        }
      }
      return true;
    });
    if (match) {
      return { ok: true, variant_id: String(match.id), price: Number(match.price),
               source: 'option', amount, option_value: wantLabel };
    }
  }

  // ── STRATÉGIE B : table de mapping admin (par montant) ─────────────────────
  const mapping = readVariantMapping(shopId);
  const key = PRINT.mappingKey(baseVariantId, amount);
  const mapped = mapping[key];
  if (mapped) {
    const finalId = _numId(mapped);
    let price = null;
    try {
      const inProd = product && (product.variants || []).find(v => String(v.id) === finalId);
      if (inProd) price = Number(inProd.price);
      else { const v = await fetchAdminVariantById(shopRecord, finalId); price = v ? Number(v.price) : null; }
    } catch (_) {}
    return { ok: true, variant_id: finalId, price, source: 'mapping', amount };
  }

  // ── STRATÉGIE C : AUTO-CRÉATION de la variante pré-tarifée (additif) ────────
  // Le produit a une option « Impression » mais la combinaison (taille + montant)
  // n'existe pas encore → on la crée (prix = base + surcharge) et on la mémorise
  // dans le mapping pour réutilisation directe. N'altère jamais l'existant.
  if (printOpt && baseVariant && shopRecord && shopRecord.access_token) {
    const base = Number(baseVariant.price);
    if (Number.isFinite(base)) {
      const finalPrice = Math.round((base + amount) * 100) / 100;
      try {
        const created = await createPricedVariant(shopRecord, product, baseVariant, printOpt.position, wantLabel, finalPrice);
        if (created && created.id) {
          const m2 = readVariantMapping(shopId);
          m2[key] = String(created.id);
          writeVariantMapping(shopId, m2);
          console.info('[resolve-variant] variante créée', { product_id: productId, base_variant_id: baseVariantId, amount, label: wantLabel, variant_id: created.id });
          return { ok: true, variant_id: String(created.id), price: Number(created.price), source: 'created', amount };
        }
      } catch (e) {
        console.warn('[resolve-variant] auto-création échouée:', e.status || '', e.message);
        if (e.status === 401 || e.status === 403) {
          return { ok: false, needs_setup: true,
            error: 'Création de variante refusée (scope write_products requis).', detail };
        }
        // autre erreur → on tombe dans le 409 générique ci-dessous
      }
    }
  }

  // ── ÉCHEC : aucune variante → erreur claire + log détaillé ─────────────────
  console.warn('[resolve-variant] AUCUNE variante pour combinaison :', JSON.stringify(detail));
  return {
    ok: false,
    needs_setup: true,
    error: printOpt
      ? 'Cette combinaison taille / impression n\'est pas encore configurée.'
      : 'Ce produit n\'est pas activé pour la personnalisation tarifée (option « Impression » absente).',
    detail,
  };
}

// GET /api/shopify/resolve-variant
//   query : base_variant_id, product_id?, amount (€ surcharge totale), shop
router.get('/resolve-variant', attachShopId, async (req, res) => {
  try {
    const shopId = req.shopId;
    if (!shopId) return res.status(400).json({ ok: false, error: 'Boutique introuvable' });
    const shopRecord = getShopRecord(shopId);
    if (!shopRecord?.access_token) {
      return res.status(503).json({ ok: false, error: 'Boutique non installée (OAuth requis)' });
    }

    const baseVariantId = req.query.base_variant_id || req.query.variant_id;
    if (!baseVariantId) return res.status(400).json({ ok: false, error: 'base_variant_id requis' });

    const amount = Number(req.query.amount || 0);

    const out = await resolveVariantForCustomization({
      shopRecord, shopId,
      baseVariantId,
      productId: req.query.product_id || '',
      amount,
    });

    if (!out.ok) {
      const code = out.needs_setup ? 409 : (out.error && /manquant|requis/.test(out.error) ? 400 : 502);
      return res.status(code).json(out);
    }
    return res.json(out);
  } catch (err) {
    console.error('resolve-variant error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Mapping admin : lecture/écriture de la table de correspondance ───────────
// GET  /api/shopify/variant-mapping            → { mapping: {...}, paliers: [...] }
// POST /api/shopify/variant-mapping
//   - { mapping: {...} }                              → remplace toute la table
//   - { base_variant_id, amount, variant_id }         → upsert d'une entrée
//   - { remove: "<baseVariantId>::<amount>" }         → supprime une entrée
router.get('/variant-mapping', requireAuth, attachShopId, (req, res) => {
  try {
    const shopId = req.shopId;
    if (!shopId) return res.status(400).json({ error: 'Boutique introuvable' });
    return res.json({
      mapping: readVariantMapping(shopId),
      paliers: PRINT.paliers(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/variant-mapping', requireAuth, attachShopId, (req, res) => {
  try {
    const shopId = req.shopId;
    if (!shopId) return res.status(400).json({ error: 'Boutique introuvable' });
    const body = req.body || {};

    if (body.mapping && typeof body.mapping === 'object') {
      writeVariantMapping(shopId, body.mapping);
      return res.json({ saved: true, mapping: readVariantMapping(shopId) });
    }

    const mapping = readVariantMapping(shopId);
    if (body.remove) {
      delete mapping[String(body.remove)];
      writeVariantMapping(shopId, mapping);
      return res.json({ saved: true, mapping });
    }

    const base   = _numId(body.base_variant_id);
    const amount = body.amount != null ? Number(body.amount) : NaN;
    const vid    = _numId(body.variant_id);
    if (!base || !Number.isFinite(amount) || amount <= 0 || !vid) {
      return res.status(400).json({ error: 'base_variant_id, amount (€ > 0) et variant_id requis' });
    }
    mapping[PRINT.mappingKey(base, amount)] = vid;
    writeVariantMapping(shopId, mapping);
    return res.json({ saved: true, mapping });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/shopify/prepare-customization (admin) ──────────────────────────
// Active la personnalisation tarifée sur un produit : ajoute l'option
// « Impression » (valeur « Sans impression ») si absente. SEULE modif
// structurelle, déclenchée explicitement par le marchand (jamais au checkout).
// Les variantes existantes sont conservées (variantStrategy LEAVE_AS_IS) et
// reçoivent la valeur « Sans impression » → prix de base inchangé.
const _MUT_ADD_PRINT_OPTION = `
  mutation tlAddPrintOption($productId: ID!, $options: [OptionCreateInput!]!) {
    productOptionsCreate(productId: $productId, options: $options, variantStrategy: LEAVE_AS_IS) {
      userErrors { field message code }
      product { id options { name } }
    }
  }`;

router.post('/prepare-customization', requireAuth, attachShopId, async (req, res) => {
  try {
    const shopId = req.shopId;
    if (!shopId) return res.status(400).json({ error: 'Boutique introuvable' });
    const shopRecord = getShopRecord(shopId);
    if (!shopRecord?.access_token) {
      return res.status(503).json({ error: 'Boutique non installée (OAuth requis)' });
    }
    const productId = String(req.body?.product_id || '')
      .replace(/^gid:\/\/shopify\/Product\//, '').trim();
    if (!/^\d+$/.test(productId)) {
      return res.status(400).json({ error: 'product_id invalide (ID numérique attendu)' });
    }

    const product = await fetchAdminProductById(shopRecord, productId);
    if (!product) return res.status(404).json({ error: 'Produit introuvable' });

    // Déjà activé ?
    const existing = (product.options || []).find(o => PRINT.isPrintOptionName(o.name));
    if (existing) return res.json({ ok: true, already: true, option: existing.name });

    // Shopify : 3 options max par produit.
    if ((product.options || []).length >= 3) {
      return res.status(409).json({
        error: 'Le produit a déjà 3 options (max Shopify) — impossible d\'ajouter « Impression ».',
      });
    }

    const data = await adminGraphQL(shopRecord, _MUT_ADD_PRINT_OPTION, {
      productId: `gid://shopify/Product/${productId}`,
      options: [{ name: 'Impression', values: [{ name: 'Sans impression' }] }],
    });
    const ue = data?.productOptionsCreate?.userErrors || [];
    if (ue.length) return res.status(422).json({ error: ue.map(e => e.message).join(', ') });

    return res.json({ ok: true, created: true });
  } catch (err) {
    console.error('prepare-customization error:', err.status || '', err.message);
    const needs_setup = err.status === 401 || err.status === 403 || /access|scope|403|401/i.test(err.message);
    return res.status(needs_setup ? 409 : 500).json({ error: err.message, needs_setup });
  }
});

module.exports = router;
module.exports.getVariantId = getVariantId;
module.exports.resolveVariantForCustomization = resolveVariantForCustomization;
