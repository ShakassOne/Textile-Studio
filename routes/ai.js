'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('./auth');
const { getDB } = require('../db/database');
const { attachShopId } = require('./_shop-context');

// Helpers : lire/écrire une clé dans la table settings, scopée par shop_id (audit B1).
function getSetting(shopId, key) {
  try {
    return getDB()
      .prepare('SELECT value FROM settings WHERE shop_id=? AND key=?')
      .get(shopId, key)?.value || '';
  } catch {
    return '';
  }
}
function setSetting(shopId, key, value) {
  getDB().prepare(
    "INSERT INTO settings (shop_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now')) " +
    "ON CONFLICT(shop_id, key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
  ).run(shopId, key, value);
}

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
  try {
    getDB().prepare("DELETE FROM settings WHERE shop_id=? AND key='openai_api_key'").run(req.shopId);
  } catch {}
  res.json({ ok: true });
});

// ── POST /api/ai/dalle — Génération IA depuis texte (scopé shop) ────────
// NOTE B3 (audit) : auth complémentaire (requireShopifySession ou App Proxy HMAC) +
// rate-limit par shop à ajouter dans le prochain bloquant.
router.post('/dalle', attachShopId, async (req, res) => {
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
router.post('/transform', attachShopId, async (req, res) => {
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
