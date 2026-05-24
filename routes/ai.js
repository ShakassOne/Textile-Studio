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

// ── Rate-limit IA additionnel PAR IP — empêche un seul visiteur de consommer
// tout le quota/h de la boutique (et donc la facture OpenAI du marchand).
const aiIpRateLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,        // 1 heure
  max:             12,                     // 12 générations/heure/IP
  keyGenerator:    (req) => req.ip,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Trop de générations IA depuis cet appareil — réessayez dans une heure' },
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

// ── Galerie "Vos créations IA" : stockage des images générées par les clients ──
const AI_CREATIONS_DIR = path.join(
  process.env.DATA_DIR || path.join(__dirname, '..'),
  'uploads',
  'ai-creations'
);
fs.mkdirSync(AI_CREATIONS_DIR, { recursive: true });

// Plafond des créations EN ATTENTE par shop (anti-saturation du volume Railway).
// Au-delà, les plus anciennes 'pending' sont élaguées (fichier + ligne). Les
// créations 'approved' (choisies par l'admin) ne sont jamais élaguées ici.
const AI_PENDING_CAP = 200;

function saveAiCreationFromBase64(shopId, b64DataUrl, prompt) {
  if (!shopId || !b64DataUrl || typeof b64DataUrl !== 'string') return null;
  const match = b64DataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!match) return null;
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) return null; // garde-fou taille (8 Mo)
  const filename = `c_${shopId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(AI_CREATIONS_DIR, filename), buf);
  const url = `/uploads/ai-creations/${filename}`;
  const db = getDB();
  db.prepare("INSERT INTO ai_creations (shop_id, image_url, prompt, status) VALUES (?, ?, ?, 'pending')")
    .run(shopId, url, (prompt || '').slice(0, 300));

  // Élaguer les 'pending' au-delà du plafond (les plus anciennes).
  try {
    const olds = db.prepare(
      "SELECT id, image_url FROM ai_creations WHERE shop_id=? AND status='pending' ORDER BY id DESC LIMIT -1 OFFSET ?"
    ).all(shopId, AI_PENDING_CAP);
    for (const o of olds) {
      try { fs.unlinkSync(path.join(AI_CREATIONS_DIR, path.basename(o.image_url))); } catch {}
      db.prepare('DELETE FROM ai_creations WHERE id=?').run(o.id);
    }
  } catch {}
  return url;
}

function isValidCode(code) {
  return typeof code === 'string' && /^[a-z0-9][a-z0-9_-]{0,40}$/i.test(code);
}

// ── Résolution complète d'un style : prompt + cover (image de référence) ──
// Contrairement à resolveStylePrompt(), renvoie aussi image_url pour pouvoir
// injecter la cover comme "style reference image" dans le pipeline IA.
function resolveStyle(shopId, code) {
  try {
    const row = getDB()
      .prepare('SELECT prompt, image_url FROM ai_styles WHERE shop_id=? AND code=?')
      .get(shopId, code);
    if (row) {
      return {
        prompt:    row.prompt || STYLE_PROMPTS_FALLBACK[code] || STYLE_PROMPTS_FALLBACK.cartoon,
        image_url: row.image_url || null,
      };
    }
  } catch {}
  return { prompt: STYLE_PROMPTS_FALLBACK[code] || STYLE_PROMPTS_FALLBACK.cartoon, image_url: null };
}

// ── Charger la cover du style comme entrée image exploitable par OpenAI ──
// Accepte un chemin local (/uploads/ai-styles/...) OU une URL absolue http(s)
// (point 7 : la cover doit être accessible côté serveur au moment de la génération).
// Renvoie { buffer, filename, mime } ou null si introuvable / format inexploitable.
async function loadStyleCoverInput(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
  try {
    // Cas 1 : URL absolue → on télécharge.
    if (/^https?:\/\//i.test(imageUrl)) {
      const r = await fetch(imageUrl);
      if (!r.ok) return null;
      const buffer = Buffer.from(await r.arrayBuffer());
      let ext = (r.headers.get('content-type') || '').split('/')[1] || 'png';
      ext = ext.split(';')[0].toLowerCase().replace('jpeg', 'jpg');
      if (!MIME[ext]) return null; // gpt-image-1 edits : png/jpg/webp uniquement
      return { buffer, filename: `style_reference.${ext}`, mime: MIME[ext] };
    }
    // Cas 2 : chemin local stocké en DB (/uploads/ai-styles/<fichier>).
    const safeName = path.basename(imageUrl);
    const filepath = path.join(STYLE_UPLOADS_DIR, safeName);
    if (!fs.existsSync(filepath)) return null;
    let ext = (path.extname(safeName).slice(1) || 'png').toLowerCase().replace('jpeg', 'jpg');
    if (!MIME[ext]) return null; // SVG/GIF non exploitables comme image d'édition
    return { buffer: fs.readFileSync(filepath), filename: `style_reference.${ext}`, mime: MIME[ext] };
  } catch {
    return null;
  }
}

// ── Construction du prompt de transformation ──
// hasStyleReference=true → prompt structuré Image A (identité) / Image B (style),
// sinon fallback texte seul (point 5). Le prompt custom du style est conservé
// puis enrichi (point 9) avec les contraintes d'identité et de rendu.
function buildTransformPrompt(customPrompt, hasStyleReference) {
  const base = (customPrompt || STYLE_PROMPTS_FALLBACK.cartoon).trim();
  const commonRules = [
    'Keep the EXACT number of people present in the source photo.',
    "Preserve each person's likeness: face, glasses, beard, hairstyle and hair length, and smile/expression.",
    'Clean illustration: avoid any greasy, oily, waxy or pasty over-rendered look — keep crisp, clean edges.',
    'Fully transparent background (PNG alpha): no background scene, no backdrop, no canvas, no drop shadow.',
    'Frame the whole subject with comfortable margins: do NOT crop the hair at the top, do NOT crop the feet or the bottom of the artwork; leave headroom and footroom.',
    'Deliver a print-ready DTF transfer: high contrast, clean separated colors, no semi-transparent halo around the edges.',
  ];
  if (hasStyleReference) {
    return [
      'You are given TWO reference images.',
      'IMAGE A (the FIRST image) = SOURCE IDENTITY. The people, their count and their likeness must come EXCLUSIVELY from IMAGE A.',
      'IMAGE B (the SECOND image) = STYLE REFERENCE. Use IMAGE B ONLY as a strict graphic-style reference (line work, shading, color treatment, finish). Do NOT copy the people, faces, objects, composition or background of IMAGE B.',
      '',
      'Redraw the subject of IMAGE A in this style: ' + base,
      '',
      'Strict requirements:',
      '- Use IMAGE B as a STRICT style reference only; identity and number of people come solely from IMAGE A.',
      ...commonRules.map((r) => '- ' + r),
    ].join('\n');
  }
  return [
    base,
    '',
    'Strict requirements:',
    ...commonRules.map((r) => '- ' + r),
  ].join('\n');
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
router.post('/dalle', requireAIContext, attachShopId, aiIpRateLimiter, aiRateLimiter, async (req, res) => {
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
router.post('/transform', requireAIContext, attachShopId, aiIpRateLimiter, aiRateLimiter, async (req, res) => {
  const { imageBase64, style = 'cartoon' } = req.body;
  // Point 6 — comportement par défaut : la cover du style sert de référence de
  // style. Désactivable explicitement par requête (useCoverAsStyleReference:false).
  const useCoverAsStyleReference = req.body.useCoverAsStyleReference !== false;
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 requis' });

  const apiKey = resolveOpenAIKey(req.shopId);
  if (!apiKey) return res.status(500).json({ error: 'Clé OpenAI non configurée — rendez-vous dans Paramètres → IA' });

  // Résoudre prompt custom + cover du style (image de référence).
  const { prompt: customPrompt, image_url: coverUrl } = resolveStyle(req.shopId, style);

  try {
    // ── Image A : photo source de l'utilisateur (identité) ──
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const imgBuffer  = Buffer.from(base64Data, 'base64');
    const mimeType   = imageBase64.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/png';

    // ── Image B : cover du style comme référence visuelle stricte ──
    // Points 1, 2, 7, 8 : la vignette n'est pas que pour l'affichage front, elle
    // est injectée dans le vrai pipeline IA si elle est disponible côté serveur.
    let cover = null;
    if (useCoverAsStyleReference && coverUrl) {
      cover = await loadStyleCoverInput(coverUrl);
    }
    const styleReferenceUsed = !!cover;

    // Point 3, 4, 5, 9 : prompt structuré (Image A/Image B) si cover, sinon texte seul.
    const prompt = buildTransformPrompt(customPrompt, styleReferenceUsed);

    // FormData natif (Node 22) + Blob.
    const form = new FormData();
    if (styleReferenceUsed) {
      // gpt-image-1 accepte plusieurs images via le champ répété image[].
      // ORDRE IMPORTANT : Image A (identité) puis Image B (style).
      form.append('image[]', new Blob([imgBuffer],     { type: mimeType }),  'source_identity.png');
      form.append('image[]', new Blob([cover.buffer],  { type: cover.mime }), cover.filename);
    } else {
      // Fallback (point 5) : une seule image, prompt texte seul.
      form.append('image', new Blob([imgBuffer], { type: mimeType }), 'photo.png');
    }
    form.append('prompt', prompt);
    form.append('model', 'gpt-image-1');
    form.append('n', '1');
    form.append('size', '1024x1024');
    form.append('quality', 'high');
    form.append('output_format', 'png');
    form.append('background', 'transparent'); // fond transparent (point 4)

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body:    form,
    });

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return res.status(500).json({ error: "Pas d'image retournée" });

    res.json({
      base64:               `data:image/png;base64,${b64}`,
      style,
      model:                'gpt-image-1',
      style_reference_used: styleReferenceUsed,
    });

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
// Built-in ET custom supprimables (la suppression persiste car le seed ne
// re-crée les built-in que pour une boutique qui n'a encore AUCUN style).
router.delete('/styles/:id', requireAuth, attachShopId, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide' });
    const db = getDB();
    const row = db.prepare('SELECT is_builtin, image_url FROM ai_styles WHERE id=? AND shop_id=?').get(id, req.shopId);
    if (!row) return res.status(404).json({ error: 'Style introuvable' });

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

// ═══════════════════════════════════════════════════════════════════════
// AI CREATIONS — galerie "Vos créations IA" partagée + modération admin
// ═══════════════════════════════════════════════════════════════════════

// POST /api/ai/creations — un client soumet une création IA (storefront) → 'pending'
router.post('/creations', requireAIContext, attachShopId, aiIpRateLimiter, aiRateLimiter, (req, res) => {
  try {
    const { image_base64, prompt } = req.body || {};
    if (!image_base64) return res.status(400).json({ error: 'image_base64 requis' });
    const url = saveAiCreationFromBase64(req.shopId, image_base64, prompt);
    if (!url) return res.status(400).json({ error: 'Image invalide' });
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ai/creations/public — créations VALIDÉES pour le studio (storefront)
// Lecture PUBLIQUE de créations déjà approuvées (rien de sensible). On résout le
// shop comme /api/library via attachShopId (qui a un fallback bootstrap), et NON
// via requireAIContext : ce dernier exige un Bearer JWT ou un X-Shop-Domain et
// renvoie 401 sans fallback → la galerie « Vos créations IA » restait vide en
// front alors que la bibliothèque (attachShopId) s'affichait. Asymétrie corrigée.
router.get('/creations/public', attachShopId, (req, res) => {
  try {
    const rows = getDB().prepare(
      "SELECT id, image_url, prompt FROM ai_creations WHERE shop_id=? AND status='approved' ORDER BY id DESC LIMIT 200"
    ).all(req.shopId);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ai/creations — liste admin (filtre ?status=pending|approved, défaut pending)
router.get('/creations', requireAuth, attachShopId, (req, res) => {
  try {
    const status = (req.query.status || 'pending').toString();
    const st = ['pending', 'approved'].includes(status) ? status : 'pending';
    const rows = getDB().prepare(
      'SELECT id, image_url, prompt, status, created_at FROM ai_creations WHERE shop_id=? AND status=? ORDER BY id DESC LIMIT 500'
    ).all(req.shopId, st);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai/creations/:id/approve — valider (admin) → visible par tous
router.post('/creations/:id/approve', requireAuth, attachShopId, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide' });
    const db = getDB();
    const row = db.prepare('SELECT id FROM ai_creations WHERE id=? AND shop_id=?').get(id, req.shopId);
    if (!row) return res.status(404).json({ error: 'Création introuvable' });
    db.prepare("UPDATE ai_creations SET status='approved' WHERE id=? AND shop_id=?").run(id, req.shopId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/ai/creations/:id — rejeter/supprimer (admin) : ligne + fichier
router.delete('/creations/:id', requireAuth, attachShopId, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide' });
    const db = getDB();
    const row = db.prepare('SELECT image_url FROM ai_creations WHERE id=? AND shop_id=?').get(id, req.shopId);
    if (!row) return res.status(404).json({ error: 'Création introuvable' });
    db.prepare('DELETE FROM ai_creations WHERE id=? AND shop_id=?').run(id, req.shopId);
    if (row.image_url && row.image_url.startsWith('/uploads/ai-creations/')) {
      try { fs.unlinkSync(path.join(AI_CREATIONS_DIR, path.basename(row.image_url))); } catch {}
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
