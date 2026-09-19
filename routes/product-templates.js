'use strict';
/**
 * routes/product-templates.js — Templates produit (metafield custom.tsl_template)
 * ──────────────────────────────────────────────────────────────────────────────
 * L'admin prépare un t-shirt complet dans le studio (?admin=1), puis l'attache à
 * un produit Shopify. Le client final qui ouvre le studio depuis cette fiche
 * produit récupère le design et le personnalise.
 *
 * Endpoints :
 *   POST /api/admin/products/:productId/template — écrit le metafield (admin)
 *   GET  /api/products/:productId/template       — lit le metafield (public)
 *
 * Le POST exige un session token Shopify (studio ouvert en iframe admin).
 * Le GET est public : le studio storefront n'a ni App Bridge ni token — il
 * résout le shop via X-Shop-Domain / ?shop, comme routes/storefront.js.
 */

const express = require('express');
const router  = express.Router();
const { requireAuth }           = require('./auth');
const { requireShopifySession } = require('./shopify-session');
const { attachShopId }          = require('./_shop-context');
const { getDB }                 = require('../db/database');
const { adminGraphQL }          = require('./admin-graphql');
const PRINT                     = require('../utils/print-tiers');

const NAMESPACE = 'custom';
const KEY       = 'tsl_template';

// Shopify limite les metafields JSON à 128 KB (API 2026-04+). On refuse au-delà
// avec un message explicite plutôt que de laisser remonter une erreur opaque.
// Cause n°1 de dépassement : des visuels en dataURL base64 au lieu d'URLs de la
// bibliothèque Shopify Files.
const MAX_BYTES = 120 * 1024;

// Accepte un id numérique ("123") ou un GID complet ("gid://shopify/Product/123")
function _toProductGid(raw) {
  const s = String(raw || '').trim();
  if (/^gid:\/\/shopify\/Product\/\d+$/.test(s)) return s;
  const digits = s.replace(/\D/g, '');
  return digits ? `gid://shopify/Product/${digits}` : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/products/:productId/template — enregistre le template
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/admin/products/:productId/template',
  express.json({ limit: '2mb' }),
  requireAuth,
  requireShopifySession,
  async (req, res) => {
    const gid = _toProductGid(req.params.productId);
    if (!gid) return res.status(400).json({ error: 'productId invalide' });

    const shop  = req.shopDomain;
    const token = req.shopRecord?.access_token;
    if (!shop || !token) {
      return res.status(403).json({ error: 'Contexte shop manquant — token OAuth introuvable' });
    }

    const template = req.body?.template;
    if (!template || typeof template !== 'object') {
      return res.status(400).json({ error: 'Corps attendu : { template: { … } }' });
    }

    const value = JSON.stringify(template);
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes > MAX_BYTES) {
      return res.status(413).json({
        error: `Template trop lourd (${Math.round(bytes / 1024)} Ko, maximum ${MAX_BYTES / 1024} Ko). `
             + 'Cause la plus fréquente : des visuels importés depuis le disque au lieu de la bibliothèque Shopify.',
        bytes,
      });
    }

    const mutation = `
      mutation TslSetTemplate($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id namespace key updatedAt }
          userErrors { field message }
        }
      }`;

    try {
      const out = await adminGraphQL(shop, token, mutation, {
        metafields: [{
          ownerId:   gid,
          namespace: NAMESPACE,
          key:       KEY,
          type:      'json',
          value,
        }],
      });
      const errs = out?.data?.metafieldsSet?.userErrors || [];
      if (errs.length) {
        return res.status(400).json({ error: errs.map(e => e.message).join(' | ') });
      }
      // ── Préparation automatique du produit ────────────────────────────
      // Enregistrer un template suffit à rendre le produit utilisable : on
      // garantit ici l'option « Impression » (idempotent, variantes et prix
      // conservés). Non bloquant — le template est déjà sauvé, on remonte
      // seulement le statut pour que l'admin sache s'il reste une action.
      let prepared = null;
      try {
        // require paresseux : storefront.js require déjà ce module au boot.
        const { ensurePrintOption } = require('./storefront');
        prepared = await ensurePrintOption(req.shopRecord, gid);
      } catch (e) {
        console.warn('template save — ensurePrintOption:', e.message);
        prepared = { ok: false, error: e.message };
      }

      res.status(201).json({
        saved:     true,
        productId: gid,
        bytes,
        referenceAmount: PRINT.computeTemplatePrintAmount(template),
        prepared,
        metafield: out?.data?.metafieldsSet?.metafields?.[0] || null,
      });
    } catch (err) {
      console.error('❌  template save:', err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products/:productId/template — lit le template (public)
// ─────────────────────────────────────────────────────────────────────────────
// Toujours 200 quand la requête est valide : `exists: false` signifie « ce
// produit n'a pas de template », ce qui n'est pas une erreur pour le studio.
router.get('/products/:productId/template', attachShopId, async (req, res) => {
  const gid = _toProductGid(req.params.productId);
  if (!gid) return res.status(400).json({ error: 'productId invalide' });

  const shopRecord = getDB()
    .prepare('SELECT shop_domain, access_token FROM shops WHERE id = ? AND is_active = 1')
    .get(req.shopId);

  if (!shopRecord?.access_token) {
    return res.status(503).json({ error: 'Shopify non configuré', configured: false });
  }

  const query = `
    query TslGetTemplate($id: ID!) {
      product(id: $id) {
        id
        handle
        title
        metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value updatedAt }
      }
    }`;

  try {
    const out  = await adminGraphQL(shopRecord.shop_domain, shopRecord.access_token, query, { id: gid });
    const prod = out?.data?.product;
    if (!prod) return res.status(404).json({ error: 'Produit introuvable', exists: false });

    const raw = prod.metafield?.value;
    if (!raw) return res.json({ exists: false, productId: gid, handle: prod.handle });

    let template;
    try { template = JSON.parse(raw); }
    catch { return res.status(422).json({ error: 'Template illisible (JSON invalide)', exists: false }); }

    res.json({
      exists:    true,
      productId: gid,
      handle:    prod.handle,
      title:     prod.title,
      updatedAt: prod.metafield.updatedAt,
      // Coût d'impression DÉJÀ inclus dans le prix Shopify du produit : le
      // studio ne facturera que ce que le client ajoute au-delà.
      referenceAmount: PRINT.computeTemplatePrintAmount(template),
      template,
    });
  } catch (err) {
    console.error('❌  template read:', err.message);
    res.status(500).json({ error: err.message, exists: false });
  }
});

module.exports = router;
