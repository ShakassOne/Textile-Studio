'use strict';
const express   = require('express');
const router    = express.Router();
const rateLimit = require('express-rate-limit');
const fs        = require('fs');
const path      = require('path');
const { requireAuth } = require('./auth');
const { requireShopifySession, verifyJWT, setReauthHeaders } = require('./shopify-session');
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
      // M3 : déclencher le refresh App Bridge — le client ré-essaiera avec un nouveau token
      setReauthHeaders(res, shopDomain || '');
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

  // Pas de Bearer ET pas de X-Shop-Domain : on ne sait pas qui appelle.
  // Pose les headers de réauth au cas où le client est App Bridge.
  setReauthHeaders(res, '');
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

// Fallback hardcodé conservé pour compatibilité descendante :
// si pour une raison X la table ai_styles est vide / non seedée, on retombe
// sur ces prompts pour ne pas casser /api/ai/transform.
const STYLE_PROMPTS_FALLBACK = {
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

// ── Helpers : résolution du prompt pour un style donné ──────────────────
// Priorité DB (scopé shop) → fallback hardcodé → cartoon.
function resolveStylePrompt(shopId, code) {
  try {
    const row = getDB()
      .prepare('SELECT prompt FROM ai_styles WHERE shop_id=? AND code=?')
      .get(shopId, code);
    if (row?.prompt) return row.prompt;
  } catch {}
  return STYLE_PROMPTS_FALLBACK[code] || STYLE_PROMPTS_FALLBACK.cartoon;
}

// ── Stockage des images de vignettes (upload base64) ────────────────────
const STYLE_UPLOADS_DIR = path.join(
  process.env.DATA_DIR || path.join(__dirname, '..'),
  'uploads',
  'ai-styles'
);
fs.mkdirSync(STYLE_UPLOADS_DIR, { recursive: true });

function saveStyleImageFromBase64(b64DataUrl) {
  if (!b64DataUrl || typeof b64DataUrl !== 'string') return null;
  const match = b64DataUrl.match(/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,(.+)$/i);
  if (!match) return null;
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > 5 * 1024 * 1024) throw new Error('Image trop volumineuse (max 5 MB)');
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(STYLE_UPLOADS_DIR, filename), buf);
  return `/uploads/ai-styles/${filename}`;
}

function isValidCode(code) {
  return typeof code === 'string' && /^[a-z0-9][a-z0-9_-]{0,40}$/i.test(code);
}

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

  const prompt = resolveStylePrompt(req.shopId, style);

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

// ═══════════════════════════════════════════════════════════════════════
// AI STYLES — CRUD pour la gestion des styles visuels (admin scopé shop)
// ═══════════════════════════════════════════════════════════════════════

// GET /api/ai/styles — Lister les styles du shop (admin)
router.get('/styles', requireAuth, attachShopId, (req, res) => {
  try {
    const rows = getDB().prepare(
      'SELECT id, code, label, prompt, image_url, is_builtin, sort_order, created_at, updated_at FROM ai_styles WHERE shop_id=? ORDER BY is_builtin DESC, sort_order ASC, id ASC'
    ).all(req.shopId);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ai/styles/public — Lister pour le studio (storefront/embed)
// Pas d'auth admin ; on accepte JWT App Bridge ou X-Shop-Domain comme /transform.
router.get('/styles/public', requireAIContext, attachShopId, (req, res) => {
  try {
    const rows = getDB().prepare(
      'SELECT code, label, image_url, is_builtin, sort_order FROM ai_styles WHERE shop_id=? ORDER BY is_builtin DESC, sort_order ASC, id ASC'
    ).all(req.shopId);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai/styles — Créer un nouveau style custom (admin)
router.post('/styles', requireAuth, attachShopId, (req, res) => {
  try {
    const { code, label, prompt, image_base64 } = req.body || {};
    if (!label || !label.trim()) return res.status(400).json({ error: 'Nom requis' });
    if (!isValidCode(code))      return res.status(400).json({ error: 'Identifiant invalide' });
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt requis' });

    const db = getDB();
    const exists = db.prepare('SELECT id FROM ai_styles WHERE shop_id=? AND code=?').get(req.shopId, code);
    if (exists) return res.status(409).json({ error: 'Identifiant déjà utilisé pour ce shop' });

    let image_url = '';
    if (image_base64) {
      try { image_url = saveStyleImageFromBase64(image_base64) || ''; }
      catch (e) { return res.status(400).json({ error: e.message }); }
    }

    // sort_order : à la fin des custom
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM ai_styles WHERE shop_id=?').get(req.shopId).m;

    const info = db.prepare(
      'INSERT INTO ai_styles (shop_id, code, label, prompt, image_url, is_builtin, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?)'
    ).run(req.shopId, code.trim(), label.trim(), prompt.trim(), image_url, maxOrder + 1);

    res.status(201).json({ id: info.lastInsertRowid, ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/ai/styles/:id — Modifier un style (admin)
// Pour les built-in : seul prompt + image + label modifiables, code figé.
router.put('/styles/:id', requireAuth, attachShopId, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide' });

    const db = getDB();
    const row = db.prepare('SELECT * FROM ai_styles WHERE id=? AND shop_id=?').get(id, req.shopId);
    if (!row) return res.status(404).json({ error: 'Style introuvable' });

    const { code, label, prompt, image_base64 } = req.body || {};
    const updates = [];
    const params  = [];

    if (label && label.trim()) { updates.push('label=?'); params.push(label.trim()); }

    if (!row.is_builtin && code && isValidCode(code) && code !== row.code) {
      const dup = db.prepare('SELECT id FROM ai_styles WHERE shop_id=? AND code=? AND id<>?').get(req.shopId, code, id);
      if (dup) return res.status(409).json({ error: 'Identifiant déjà utilisé' });
      updates.push('code=?'); params.push(code.trim());
    }

    if (prompt && prompt.trim()) { updates.push('prompt=?'); params.push(prompt.trim()); }

    if (image_base64) {
      let image_url;
      try { image_url = saveStyleImageFromBase64(image_base64); }
      catch (e) { return res.status(400).json({ error: e.message }); }
      if (image_url) { updates.push('image_url=?'); params.push(image_url); }
    }

    if (!updates.length) return res.json({ ok: true, unchanged: true });

    updates.push("updated_at=datetime('now')");
    params.push(id, req.shopId);
    db.prepare(`UPDATE ai_styles SET ${updates.join(', ')} WHERE id=? AND shop_id=?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/ai/styles/:id — Supprimer un style custom (admin)
// Les styles built-in ne sont pas supprimables.
router.delete('/styles/:id', requireAuth, attachShopId, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide' });
    const db = getDB();
    const row = db.prepare('SELECT is_builtin, image_url FROM ai_styles WHERE id=? AND shop_id=?').get(id, req.shopId);
    if (!row) return res.status(404).json({ error: 'Style introuvable' });
    if (row.is_builtin) return res.status(403).json({ error: 'Les styles intégrés ne peuvent pas être supprimés' });

    db.prepare('DELETE FROM ai_styles WHERE id=? AND shop_id=?').run(id, req.shopId);

    // Nettoyer le fichier image s'il existe et nous appartient
    if (row.image_url && row.image_url.startsWith('/uploads/ai-styles/')) {
      try { fs.unlinkSync(path.join(STYLE_UPLOADS_DIR, path.basename(row.image_url))); } catch {}
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
