'use strict';
/**
 * routes/app-proxy.js — Shopify App Proxy
 * ─────────────────────────────────────────
 * Permet d'intégrer l'éditeur TextileLab directement dans les pages produit
 * de la boutique Shopify via une URL proxifiée.
 *
 * Configuration dans Partners Dashboard :
 *   App setup → App Proxy
 *   Subpath prefix : apps
 *   Subpath        : textilelab
 *   Proxy URL      : https://textilelab.up.railway.app/proxy
 *
 * Résultat : https://ma-boutique.myshopify.com/apps/textilelab
 *   → proxifié vers → https://textilelab.up.railway.app/proxy
 *
 * Toutes les requêtes App Proxy sont signées par Shopify (query HMAC).
 * Shopify injecte : shop, path_prefix, timestamp, signature dans le query string.
 *
 * Endpoints :
 *   GET  /proxy                    — Page d'accueil de l'éditeur embed
 *   GET  /proxy/editor             — iFrame éditeur pour un produit spécifique
 *   GET  /proxy/designs/:id        — API : design public (lecture seule)
 *   POST /proxy/cart-attributes    — API : sauvegarde les attributs cart JSON
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const path    = require('path');
const { getDB, getShopIdByDomain } = require('../db/database');

// ── Vérification HMAC des requêtes App Proxy ─────────────────────────────────
// Shopify signe le query string avec SHOPIFY_API_SECRET
function verifyProxyHMAC(query) {
  const secret = process.env.SHOPIFY_API_SECRET || '';
  if (!secret) return true; // dev sans secret

  const { signature, ...rest } = query;
  if (!signature) return false;

  // Message = paramètres triés alphabétiquement, séparés par &, format key=value
  const message = Object.keys(rest)
    .sort()
    .map(k => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`)
    .join('&');

  const hash = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
}

// Middleware HMAC pour toutes les routes /proxy
function requireProxyHMAC(req, res, next) {
  if (!verifyProxyHMAC(req.query)) {
    console.warn(`⚠️  App Proxy HMAC invalide — ${req.path}`);
    return res.status(403).send('Accès non autorisé.');
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /proxy — Page d'accueil embed (HTML renvoyé à Shopify)
// Shopify injecte ce contenu dans le thème de la boutique
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', requireProxyHMAC, (req, res) => {
  const shop      = req.query.shop || '';
  const appUrl    = process.env.SHOPIFY_APP_URL || '';
  const productId = req.query.product_id || '';

  // Shopify attend du HTML ou du JSON — on renvoie du HTML avec Content-Type text/html
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TextileLab Studio — Personnalisation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #f6f6f7; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    .tl-embed-wrapper {
      width: 100%;
      max-width: 1200px;
      margin: 0 auto;
      padding: 16px;
    }
    .tl-embed-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }
    .tl-embed-header .logo {
      width: 36px; height: 36px;
      background: #5c6ac4;
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 800; font-size: 16px;
    }
    .tl-embed-header h2 { font-size: 18px; font-weight: 700; color: #202223; }
    .tl-embed-header p  { font-size: 13px; color: #6d7175; }
    .tl-iframe-container {
      width: 100%;
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,.06);
    }
    iframe {
      width: 100%;
      height: 700px;
      border: none;
      display: block;
    }
    @media (max-width: 600px) { iframe { height: 92vh; } }
  </style>
</head>
<body>
  <div class="tl-embed-wrapper">
    <div class="tl-embed-header">
      <div class="logo">T</div>
      <div>
        <h2>Personnalisez votre article</h2>
        <p>Créez un design unique avec l'éditeur TextileLab</p>
      </div>
    </div>
    <div class="tl-iframe-container">
      <iframe
        id="tl-editor"
        src="${appUrl}/textilelab-studio.html?shop=${encodeURIComponent(shop)}&product_id=${encodeURIComponent(productId)}&embed=1"
        title="Éditeur TextileLab Studio"
        allow="clipboard-write"
        loading="lazy"
      ></iframe>
    </div>
  </div>

  <script>
    // Redimensionnement dynamique de l'iFrame selon le contenu
    window.addEventListener('message', function(e) {
      if (!e.data || e.data.type !== 'tl:resize') return;
      const iframe = document.getElementById('tl-editor');
      if (iframe && e.data.height) {
        iframe.style.height = Math.max(600, e.data.height) + 'px';
      }
      // Réception du design finalisé pour injection dans le cart
      if (e.data.type === 'tl:add-to-cart') {
        handleAddToCart(e.data.payload);
      }
    });

    function handleAddToCart(payload) {
      // Ajouter les propriétés du design aux line items Shopify
      fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:         payload.variantId,
          quantity:   payload.quantity || 1,
          properties: {
            _design_id:    payload.design_id,
            _product:      payload.product,
            _format:       payload.format,
            _color:        payload.color,
            _thumbnail:    payload.thumbnail || '',
            _views_count:  String(payload.views_count || 1),
          }
        })
      })
      .then(r => r.json())
      .then(() => { window.location.href = '/cart'; })
      .catch(err => console.error('[TextileLab] Cart add error:', err));
    }
  </script>
</body>
</html>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /proxy/editor — Redirect direct vers le studio (utilisé en lien direct)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/editor', requireProxyHMAC, (req, res) => {
  const appUrl = process.env.SHOPIFY_APP_URL || '';
  const params = new URLSearchParams({
    shop:       req.query.shop || '',
    product_id: req.query.product_id || '',
    embed:      '1',
  });
  res.redirect(`${appUrl}/textilelab-studio.html?${params}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /proxy/designs/:id — API publique : récupère un design (lecture seule, scopé shop)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/designs/:id', requireProxyHMAC, (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID invalide' });

  // Le shop est fourni par Shopify dans la query string signée HMAC
  const shopDomain = (req.query.shop || '').toLowerCase().trim();
  const shopId     = getShopIdByDomain(shopDomain);
  if (!shopId) return res.status(403).json({ error: 'Shop non installé ou introuvable' });

  const db = getDB();
  const design = db.prepare(`
    SELECT id, name, product, color, format, thumbnail, created_at
    FROM designs WHERE id = ? AND shop_id = ?
  `).get(id, shopId);

  if (!design) return res.status(404).json({ error: 'Design introuvable' });

  // Ne pas exposer layers_json (données internes) via l'App Proxy public
  res.json(design);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /proxy/health — Vérification que le proxy est actif (Shopify vérifie)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'textilelab-proxy' });
});

module.exports = router;
