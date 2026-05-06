'use strict';
const express   = require('express');
const router    = express.Router();
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('./auth');
const { requireShopifySession, verifyJWT } = require('./shopify-session');
const { getDB, getShop } = require('../db/database');
const { attachShopId } = require('./_shop-context');
const { getSetting, setSetting, deleteSetting } = require('../db/settings');

// ── Middleware hybride : Bearer JWT (App Bridge) OU X-Shop-Domain (storefront iframe) ──
// Permet aux requêtes frontend sans App Bridge (standalone Railway) de fonctionner.
function requireAIContext(req, res, next) {
  const secret = process.env.SHOPIFY_API_SECRET || '';
  const token  = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  const shopDomain = (req.headers['x-shop-domain'] || req.query.shop || '').toLowerCase().trim();

  // Dev local sans secret → passer directement
  if (!secret) {
    req.shopDomain = shopDomain;
    return next();
  }

  // Bearer JWT présent → vérifier (App Bridge / admin)
  if (token) {
    try {
      const payload = verifyJWT(token, secret);
      const shop = (payload.dest || '').replace('https://', '').toLowerCase();
      const record = getShop(shop);
      if (!record) return res.status(403).json({ error: 'Shop non installé' });
      req.shopDomain = shop;
      req.shopRecord = record;
      req.shopId = record.id;
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Session token invalide : ' + err.message });
    }
  }

  // Pas de Bearer → accepter X-Shop-Domain (storefront iframe sans App Bridge)
  if (shopDomain) {
    const record = getShop(shopDomain);
    if (!record) return res.status(403).json({ error: 'Shop non installé' });
    req.shopDomain = shopDomain;
    req.shopRecord = record;
    req.shopId = record.id;
    return next();
  }

  return res.status(401).json({ error: 'Auth requise : Bearer token ou X-Shop-Domain' });
}

// ── Rate-limit IA : 50 générations/heure/shop (audit B3) ─────────────────────
const aiRateLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,        // 1 heure
  max:             50,                     // 50 requêtes/heure/shop
  keyGenerator:    (req) => String(req.shopId || req.ip),
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Quota IA dépassé (50 générations/h) — réessayez dans une heure' },
  skip:            (req) => !req.shopId,   // si shopId pas encore posé, IP prend le relais
});

// Helpers getSetting/setSetting : importés depuis db/settings.js (audit B1 + M5).
// La clé 'openai_api_key' est automatiquement chiffrée AES-256-GCM en DB.

// Résoudre la clé OpenAI : DB du shop courant en priorité, sinon .env (développement).
// Attention sécurité : la clé .env est partagée — en prod chaque shop devrait avoir
// sa propre clé en DB pour éviter qu'un marchand consomme la facturation d'un autre.
function resolveOpenAIKey(shopId) {
  return getSetting(shopId, 'openai_api_key') || process.env.OPENAI_API_KEY || '';
}

const STYLE_PROMPTS = {
  cartoon:    'Transform this photo into a vibrant cartoon illustration, bold outlines, flat bright colors, expressive, transparent background, DTF print ready, no background',
  disney:     'Transform this photo into a Pixar 3D animated movie character, soft lighting, big expressive eyes, polished render, transparent background, DTF print ready',
  manga:      'Transform this photo into a Japanese manga/anime illustration, clean line art, cel shading, black and white with selective color accents, transparent background',
  sticker:    'Transform this photo into a cute kawaii sticker design, thick white outline, vibrant colors, glossy finish, transparent background, DTF print ready',
  sketch:     'Transform this photo into a detailed pencil sketch drawing, fine line work, cross-hatching, artistic black and white illustration, transparent background',
  graffiti:   'Transform this photo into a bold street art graffiti illustration, spray paint texture, urban colors, thick outlines, stencil art, transparent background, DTF print ready',
  simple:     'Transform this photo into a simple flat cartoon, minimal details, 4 colors max, clean bold shapes and outlines, transparent background, DTF print ready',
  caricature: 'Transform this photo into an exaggerated caricature, emphasize distinctive features humorously, expressive cartoon style, transparent background, DTF print ready',
  avatar:     'Transform this photo into a stylized avatar portrait, modern digital art, geometric simplification, vibrant gradient colors, transparent background, apparel print ready',
  lego:       'Transform this photo into a LEGO minifigure style character, blocky proportions, simple iconic face, plastic toy aesthetic, transparent background, DTF print ready',
};

// ── GET  /api/ai/settings — Lire la config IA (admin, scopé shop) ───────────────
router.get('/settings', requireAuth, attachShopId, (req, res) => {
  const key = getSetting(req.shopId, 'openai_api_key');
  res.json({
    openai_configured: !!(key || process.env.OPENAI_API_KEY),
    openai_key_masked: key ? `sk-...${key.slice(-4)}` : (process.env.OPENAI_API_KEY ? `sk-...${process.env.OPENAI_API_KEY.slice(-4)}` : ''),
    source: key ? 'database' : (process.env.OPENAI_API_KEY ? 'env' : 'none'),
  });
});

// ── POST /api/ai/settings — Sauvegarder la clé OpenAI (admin, scopé shop) ────────
router.post('/settings', requireAuth, attachShopId, async (req, res) => {
  const { openai_api_key } = req.body;
  if (!openai_api_key || !openai_api_key.startsWith('sk-')) {
    return res.status(400).json({ error: 'Clé invalide — doit commencer par sk-' });
  }
  // Test rapide avant de sauvegarder
  try {
    const testRes = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${openai_api_key}` }
    });
    if (testRes.status === 401) return res.status(400).json({ error: 'Clé OpenAI refusée (401) — vérifiez la clé' });
  } catch (e) {
    return res.status(500).json({ error: 'Impossible de joindre OpenAI : ' + e.message });
  }
  setSetting(req.shopId, 'openai_api_key', openai_api_key.trim());
  res.json({ ok: true, masked: `sk-...${openai_api_key.slice(-4)}` });
});

// ── DELETE /api/ai/settings/openai — Supprimer la clé stockée (admin, scopé shop) ─
router.delete('/settings/openai', requireAuth, attachShopId, (req, res) => {
  try { deleteSetting(req.shopId, 'openai_api_key'); } catch {}
  res.json({ ok: true });
});

// ── POST /api/ai/dalle — Génération IA depuis texte (scopé shop) ────────
// Auth Shopify session token (App Bridge 4) + rate-limit par shop (audit B3)
router.post('/dalle', requireAIContext, attachShopId, aiRateLimiter, async (req, res) => {
  const { prompt, size = '1024x1024', quality = 'high', transparent = true } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt requis' });

  const apiKey = resolveOpenAIKey(req.shopId);
  if (!apiKey) return res.status(500).json({ error: 'Clé OpenAI non configurée — rendez-vous dans Paramètres → IA' });

  try {
    const body = {
      model: 'gpt-image-1', prompt, n: 1, size, quality, output_format: 'png',
    };
    if (transparent) body.background = 'transparent';

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body:    JSON.stringify(body),
    });

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return res.status(500).json({ error: "Pas d'image retournée" });

    res.json({ base64: `data:image/png;base64,${b64}`, model: 'gpt-image-1', quality, transparent });

  } catch (e) {
    console.error('GPT Image error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ai/transform — Photo → Art (scopé shop) ─────────────
// Auth Shopify session token (App Bridge 4) + rate-limit par shop (audit B3)
router.post('/transform', requireAIContext, attachShopId, aiRateLimiter, async (req, res) => {
  const { imageBase64, style = 'cartoon' } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 requis' });

  const apiKey = resolveOpenAIKey(req.shopId);
  if (!apiKey) return res.status(500).json({ error: 'Clé OpenAI non configurée — rendez-vous dans Paramètres → IA' });

  const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.cartoon;

  try {
    // Extraire le buffer depuis base64
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const imgBuffer  = Buffer.from(base64Data, 'base64');
    const mimeType   = imageBase64.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/png';

    // Utiliser FormData natif Node 22 + Blob
    const blob = new Blob([imgBuffer], { type: mimeType });
    const form = new FormData();
    form.append('image', blob, 'photo.png');
    form.append('prompt', prompt);
    form.append('model', 'gpt-image-1');
    form.append('n', '1');
    form.append('size', '1024x1024');
    form.append('quality', 'high');

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body:    form,
    });

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return res.status(500).json({ error: "Pas d'image retournée" });

    res.json({ base64: `data:image/png;base64,${b64}`, style, model: 'gpt-image-1' });

  } catch (e) {
    console.error('Transform error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/ai/status (scopé shop) ─────────────────────────────────────
router.get('/status', attachShopId, (req, res) => {
  const key = resolveOpenAIKey(req.shopId);
  res.json({ dalle: !!key, model: 'gpt-image-1', configured: !!key });
});

router.post('/generate', async (_req, res) => { res.json({ ok: true }); });

module.exports = router;
