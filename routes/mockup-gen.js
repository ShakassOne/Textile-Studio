'use strict';
/**
 * /api/mockup-gen — Générateur de visuels produit HD
 *
 * POST /api/mockup-gen/generate-all
 *   Body : { design_png: "data:image/png;base64,...", format: "A4", view_name?: "Recto" }
 *   Retourne : { ok, results:[{ mockup_name, view_name, product, url }], errors }
 *   Si view_name est fourni, seule la vue correspondant à ce nom est générée.
 *
 * Traitement par vue de mockup :
 *  1. Zone backoffice (440×340) → coords natives image → coords output 2000×2000
 *  2. Displacement map = crop zone du mockup, niveaux de gris, contraste boosté
 *  3. Filtre déplacement 20px appliqué au design (même algo que Photoshop)
 *  4. Design sur fond blanc → composite Multiply sur mockup → PNG 2000×2000
 */

const express   = require('express');
const router    = express.Router();
const path      = require('path');
const fs        = require('fs');
const sharp     = require('sharp');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('./auth');
const { requireShopifySession } = require('./shopify-session');
const { getDB } = require('../db/database');
const { attachShopId } = require('./_shop-context');

// ── Rate-limit mockup-gen : 100 générations/heure/shop (audit B5) ────────────
const mockupRateLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             100,
  keyGenerator:    (req) => String(req.shopId || req.ip),
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Quota mockup dépassé (100/h) — réessayez dans une heure' },
});

// ── Vérification taille body PNG base64 (max 10 Mo) ─────────────────────────
const PNG_B64_MAX = 10 * 1024 * 1024;
function checkDesignSize(req, res, next) {
  const val = req.body?.design_png;
  if (val && Buffer.byteLength(val, 'utf8') > PNG_B64_MAX) {
    return res.status(413).json({ error: 'Payload trop grand — max 10 Mo pour design_png' });
  }
  next();
}

const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, '..');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const GEN_DIR    = path.join(UPLOADS_DIR, 'generated');
const APP_URL    = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
const OUTPUT_SIZE = 2000;
const DISP_INTENSITY = 12; // 20 → 12 : moins de déformation, résultat plus naturel
// Backoffice canvas dimensions (ne pas changer)
const BACK_W = 440, BACK_H = 340;

// Créer le dossier generated au démarrage
if (!fs.existsSync(GEN_DIR)) fs.mkdirSync(GEN_DIR, { recursive: true });

// ── POST /api/mockup-gen/generate-all (scopé shop, audit B5) ──────────────
// Auth Shopify session token + rate-limit + body size check
router.post('/generate-all', requireShopifySession, attachShopId, mockupRateLimiter, checkDesignSize, async (req, res) => {
  const { design_png, format = 'A4', view_name = null } = req.body;
  if (!design_png) return res.status(400).json({ error: 'design_png required' });

  const db = getDB();
  const mockups = db.prepare('SELECT * FROM mockups WHERE shop_id=?').all(req.shopId);
  if (!mockups.length) return res.status(404).json({ error: 'Aucun mockup disponible' });

  const designBuffer = b64ToBuffer(design_png);
  const results = [];
  const errors  = [];

  for (const mockup of mockups) {
    const views = JSON.parse(mockup.views_json || '[]');

    for (const view of views) {
      if (!view.imageData) continue;

      // ── Filtre par vue active (si view_name fourni, ignorer les autres) ──
      if (view_name && view.name !== view_name) continue;

      // Zone pour le format demandé (fallback sur la zone par défaut)
      const zoneData = view.zones?.[format] || view.zone;
      if (!zoneData || !zoneData.w) continue;

      try {
        const mockupBuffer = b64ToBuffer(view.imageData);
        const meta = await sharp(mockupBuffer).metadata();
        const naturalW = meta.width;
        const naturalH = meta.height;

        // ── Conversion zone backoffice → sortie 2000×2000 ─────────────────
        // 1. Scale "contain" du backoffice (440×340)
        const adminScale   = Math.min(BACK_W / naturalW, BACK_H / naturalH);
        const adminImgW    = naturalW * adminScale;
        const adminImgH    = naturalH * adminScale;
        const adminImgLeft = (BACK_W - adminImgW) / 2;
        const adminImgTop  = (BACK_H - adminImgH) / 2;

        // 2. Zone relative à l'image dans le backoffice
        const zoneRelX = zoneData.x - adminImgLeft;
        const zoneRelY = zoneData.y - adminImgTop;

        // 3. Zone en coords natives (pixels de l'image originale)
        const nativeX = zoneRelX / adminScale;
        const nativeY = zoneRelY / adminScale;
        const nativeW = zoneData.w / adminScale;
        const nativeH = zoneData.h / adminScale;

        // 4. Zone en coords output (2000×2000, fond carré)
        const outScale = OUTPUT_SIZE / Math.max(naturalW, naturalH);
        const outX = Math.max(0, Math.round(nativeX * outScale));
        const outY = Math.max(0, Math.round(nativeY * outScale));
        const outW = Math.max(1, Math.round(nativeW * outScale));
        const outH = Math.max(1, Math.round(nativeH * outScale));

        // ── Génération ──────────────────────────────────────────────────────
        const outputBuffer = await generateMockup({
          designBuffer,
          mockupBuffer,
          naturalW, naturalH,
          zone: { x: outX, y: outY, w: outW, h: outH },
          dispIntensity: DISP_INTENSITY,
        });

        // ── Sauvegarde ──────────────────────────────────────────────────────
        const viewSlug    = (view.name || 'vue').toLowerCase().replace(/\s+/g, '-');
        const filename    = `gen_${mockup.id}_${viewSlug}_${Date.now()}.png`;
        const filepath    = path.join(GEN_DIR, filename);
        fs.writeFileSync(filepath, outputBuffer);

        results.push({
          mockup_id   : mockup.id,
          mockup_name : mockup.name,
          view_name   : view.name || 'Vue',
          product     : mockup.product,
          color       : mockup.product_color || 'white',
          url         : `${APP_URL}/uploads/generated/${filename}`,
        });

        console.log(`✅  Mockup généré : ${mockup.name} / ${view.name}`);
      } catch (err) {
        console.error(`❌  Erreur mockup ${mockup.name}/${view.name} :`, err.message);
        errors.push({ mockup_name: mockup.name, view_name: view.name || '', error: err.message });
      }
    }
  }

  res.json({ ok: true, results, errors });
});

// ── DELETE /api/mockup-gen/cleanup — nettoyer les vieux fichiers générés ──────
// Auth admin requise (audit B5 : sans auth, un attaquant peut effacer tous les renders)
router.delete('/cleanup', requireAuth, async (req, res) => {
  try {
    const maxAgeMs = 24 * 60 * 60 * 1000; // 24h
    const now = Date.now();
    const files = fs.readdirSync(GEN_DIR);
    let deleted = 0;
    for (const f of files) {
      const fp = path.join(GEN_DIR, f);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > maxAgeMs) { fs.unlinkSync(fp); deleted++; }
    }
    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// TRAITEMENT IMAGE
// ════════════════════════════════════════════════════════════════════════════

async function generateMockup({ designBuffer, mockupBuffer, naturalW, naturalH, zone, dispIntensity }) {
  // ── 1. Mockup → 2000×2000 ────────────────────────────────────────────────
  const mockupResized = await sharp(mockupBuffer)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'fill' })
    .png()
    .toBuffer();

  // ── 2. Design → taille de la zone, AVEC alpha (transparent = pas d'encre) ─
  const designResized = await sharp(designBuffer)
    .resize(zone.w, zone.h, { fit: 'fill' })
    .ensureAlpha()
    .png()
    .toBuffer();

  // ── 3. Displacement map — contraste modéré (pas de normalise agressif) ────
  const cropX = Math.min(zone.x, OUTPUT_SIZE - 1);
  const cropY = Math.min(zone.y, OUTPUT_SIZE - 1);
  const cropW = Math.min(zone.w, OUTPUT_SIZE - cropX);
  const cropH = Math.min(zone.h, OUTPUT_SIZE - cropY);

  const dispMap = await sharp(mockupResized)
    .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
    .resize(zone.w, zone.h, { fit: 'fill' })
    .grayscale()
    .linear(1.8, -40)   // contraste modéré — plis visibles sans déformation excessive
    .blur(2)             // lissage pour des transitions douces
    .toBuffer();

  // ── 4. Filtre déplacement appliqué au design ──────────────────────────────
  const displacedDesign = await applyDisplacement(designResized, dispMap, zone.w, zone.h, dispIntensity);

  // ── 5. Design déplacé sur fond blanc ─────────────────────────────────────
  //    Fond blanc = neutre en Multiply sur tissu blanc (blanc × blanc = blanc)
  //    Le design transparent exporté depuis le canvas → fond blanc ici seulement
  const designOnWhite = await sharp({
    create: { width: zone.w, height: zone.h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 255 } },
  })
    .composite([{ input: displacedDesign, blend: 'over' }])
    .png()
    .toBuffer();

  // ── 6. Composite Multiply sur le mockup ───────────────────────────────────
  //    Multiply : design × tissu / 255
  //    Blanc (255) × tissu → tissu visible (zones sans encre = tissu natif)
  //    Couleurs design × tissu blanc → couleurs fidèles + plis du tissu intégrés
  const result = await sharp(mockupResized)
    .composite([{
      input : designOnWhite,
      blend : 'multiply',
      left  : zone.x,
      top   : zone.y,
    }])
    .png()
    .toBuffer();

  return result;
}

/**
 * applyDisplacement — déplace chaque pixel du design selon la displacement map
 * @param {Buffer} designBuf  PNG RGBA, taille w×h
 * @param {Buffer} dispBuf    PNG niveaux de gris, taille w×h
 * @param {number} w
 * @param {number} h
 * @param {number} intensity  max déplacement en pixels (défaut 20)
 */
async function applyDisplacement(designBuf, dispBuf, w, h, intensity) {
  // Récupérer les pixels bruts
  const { data: designRaw } = await sharp(designBuf)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data: dispRaw } = await sharp(dispBuf)
    .grayscale()
    .resize(w, h, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = 4; // RGBA
  const result   = Buffer.alloc(w * h * channels);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i      = y * w + x;
      const dVal   = dispRaw[i];                            // 0–255
      const offset = Math.round((dVal / 255 - 0.5) * 2 * intensity);

      const srcX = Math.max(0, Math.min(w - 1, x + offset));
      const srcY = Math.max(0, Math.min(h - 1, y + offset));

      const srcIdx = (srcY * w + srcX) * channels;
      const dstIdx = i * channels;

      result[dstIdx]     = designRaw[srcIdx];
      result[dstIdx + 1] = designRaw[srcIdx + 1];
      result[dstIdx + 2] = designRaw[srcIdx + 2];
      result[dstIdx + 3] = designRaw[srcIdx + 3];
    }
  }

  return sharp(result, { raw: { width: w, height: h, channels } }).png().toBuffer();
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function b64ToBuffer(dataUrl) {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return Buffer.from(base64, 'base64');
}

module.exports = router;
