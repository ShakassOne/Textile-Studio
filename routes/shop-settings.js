'use strict';
/**
 * routes/shop-settings.js — Préférences visuelles boutique exposables au storefront
 * ──────────────────────────────────────────────────────────────────────────────
 *  Routes admin (auth TextileLab + shop résolu) :
 *    GET  /api/shop-settings/style   — Lit les préférences visuelles
 *    POST /api/shop-settings/style   — Met à jour les préférences visuelles
 *
 *  Route publique (sans auth, scopée shop via ?shop=xxx.myshopify.com) :
 *    GET  /api/shop-settings/style/public
 *      → consommée par tl-modal.js (storefront) pour appliquer
 *        la couleur de fond de la preview drawer panier sur tous les thèmes.
 *
 *  Clés actuellement stockées (non sensibles, table `settings`) :
 *    cart_drawer_bg_color      string — hex "#000000" / "transparent" / ""
 *    reassurance_banner_enabled bool  — bandeau de réassurance (paiement
 *      sécurisé / fabriqué à la demande) affiché dans le studio. Activé par
 *      défaut (affichage pur, aucune logique panier/paiement touchée) ;
 *      désactivable en un clic si besoin.
 *    mobile_price_bar_enabled   bool  — barre de prix total sticky affichée
 *      en bas de l'écran studio sur mobile (le prix du topbar y est masqué
 *      aujourd'hui, aucun total n'est visible hors ouverture d'un drawer).
 *      Désactivée par défaut : c'est un changement de mise en page mobile,
 *      à valider sur un vrai téléphone avant diffusion large.
 *    social_proof_enabled       bool  — bloc "Ils l'ont fait" (vignettes de
 *      vraies réalisations clients, curées en admin via /api/social-proof)
 *      affiché au-dessus du bouton panier. Désactivé par défaut : vide tant
 *      qu'aucune vignette n'a été ajoutée par l'admin.
 *    ai_generic_identity_prompt_enabled bool — formulation d'identité générique
 *      ("preserve the subject's key identifying features") dans le prompt IA
 *      Photo → Illustration (routes/ai.js), au lieu de la formulation historique
 *      centrée visage/barbe/coiffure. Désactivé par défaut : à comparer sur un
 *      échantillon de photos (portraits ET non-portraits) avant diffusion large.
 *      Comportement 100% serveur (construction du prompt) : pas exposé sur la
 *      route publique, inutile au storefront.
 *
 *  Cors public : Cross-origin (shop_domain.myshopify.com → textile-studio-production)
 *    → le storefront fait fetch direct, on autorise tout origin sur le GET public.
 * ──────────────────────────────────────────────────────────────────────────────
 */

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('./auth');
const { attachShopId } = require('./_shop-context');
const { getShopIdByDomain } = require('../db/database');
const { getSetting, setSetting } = require('../db/settings');

// ── Validation des couleurs ─────────────────────────────────────────────────
// Autorise : "" (vide), "transparent", "#rgb", "#rgba", "#rrggbb", "#rrggbbaa"
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
function isValidColor(v) {
  if (v == null) return true;
  const s = String(v).trim();
  if (s === '' || s === 'transparent') return true;
  return HEX_COLOR_RE.test(s);
}
function normalizeColor(v) {
  if (v == null) return '';
  const s = String(v).trim().toLowerCase();
  if (s === '' || s === 'transparent') return s;
  return s; // hex déjà validé en amont
}

// ── Flags booléens (stockés '1'/'0' dans la table settings) ─────────────────
// Si la clé n'a jamais été écrite → on renvoie `defaultVal`.
function readBoolSetting(shopId, key, defaultVal) {
  const v = getSetting(shopId, key);
  if (v === '' || v == null) return defaultVal;
  return v === '1' || v === 'true';
}
function coerceBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}
// Styles IA (Photo → Illustration) activés par défaut côté storefront.
const AI_PHOTO_STYLES_DEFAULT = true;
// Bandeau de réassurance affiché par défaut (pur affichage, sans risque).
const REASSURANCE_BANNER_DEFAULT = true;
// Barre de prix mobile désactivée par défaut (changement de mise en page,
// activation manuelle une fois vérifiée sur un vrai mobile).
const MOBILE_PRICE_BAR_DEFAULT = false;
// Preuve sociale désactivée par défaut : vide tant que l'admin n'a pas curé
// au moins une vignette (pas de fallback automatique, cf. ROADMAP §2bis).
const SOCIAL_PROOF_DEFAULT = false;
// Formulation d'identité générique du prompt IA désactivée par défaut : à
// comparer sur un échantillon réel avant diffusion large (backlog item 16).
const AI_GENERIC_IDENTITY_PROMPT_DEFAULT = false;

// ── GET /api/shop-settings/style — lecture admin ────────────────────────────
router.get('/style', requireAuth, attachShopId, (req, res) => {
  res.json({
    cart_drawer_bg_color:       getSetting(req.shopId, 'cart_drawer_bg_color') || '',
    ai_photo_styles_enabled:    readBoolSetting(req.shopId, 'ai_photo_styles_enabled', AI_PHOTO_STYLES_DEFAULT),
    reassurance_banner_enabled: readBoolSetting(req.shopId, 'reassurance_banner_enabled', REASSURANCE_BANNER_DEFAULT),
    mobile_price_bar_enabled:   readBoolSetting(req.shopId, 'mobile_price_bar_enabled', MOBILE_PRICE_BAR_DEFAULT),
    social_proof_enabled:       readBoolSetting(req.shopId, 'social_proof_enabled', SOCIAL_PROOF_DEFAULT),
    ai_generic_identity_prompt_enabled: readBoolSetting(req.shopId, 'ai_generic_identity_prompt_enabled', AI_GENERIC_IDENTITY_PROMPT_DEFAULT),
  });
});

// ── POST /api/shop-settings/style — écriture admin ──────────────────────────
// Ne met à jour que les champs présents dans le body (mise à jour partielle),
// pour qu'enregistrer le toggle n'écrase pas la couleur et inversement.
router.post('/style', requireAuth, attachShopId, express.json(), (req, res) => {
  const body = req.body || {};

  if ('cart_drawer_bg_color' in body) {
    if (!isValidColor(body.cart_drawer_bg_color)) {
      return res.status(400).json({
        error: 'Couleur invalide — doit être vide, "transparent" ou un hex (#000, #000000, #00000000)',
      });
    }
    setSetting(req.shopId, 'cart_drawer_bg_color', normalizeColor(body.cart_drawer_bg_color));
  }

  if ('ai_photo_styles_enabled' in body) {
    setSetting(req.shopId, 'ai_photo_styles_enabled', coerceBool(body.ai_photo_styles_enabled) ? '1' : '0');
  }

  if ('reassurance_banner_enabled' in body) {
    setSetting(req.shopId, 'reassurance_banner_enabled', coerceBool(body.reassurance_banner_enabled) ? '1' : '0');
  }

  if ('mobile_price_bar_enabled' in body) {
    setSetting(req.shopId, 'mobile_price_bar_enabled', coerceBool(body.mobile_price_bar_enabled) ? '1' : '0');
  }

  if ('social_proof_enabled' in body) {
    setSetting(req.shopId, 'social_proof_enabled', coerceBool(body.social_proof_enabled) ? '1' : '0');
  }

  if ('ai_generic_identity_prompt_enabled' in body) {
    setSetting(req.shopId, 'ai_generic_identity_prompt_enabled', coerceBool(body.ai_generic_identity_prompt_enabled) ? '1' : '0');
  }

  res.json({
    ok: true,
    cart_drawer_bg_color:       getSetting(req.shopId, 'cart_drawer_bg_color') || '',
    ai_photo_styles_enabled:    readBoolSetting(req.shopId, 'ai_photo_styles_enabled', AI_PHOTO_STYLES_DEFAULT),
    reassurance_banner_enabled: readBoolSetting(req.shopId, 'reassurance_banner_enabled', REASSURANCE_BANNER_DEFAULT),
    mobile_price_bar_enabled:   readBoolSetting(req.shopId, 'mobile_price_bar_enabled', MOBILE_PRICE_BAR_DEFAULT),
    social_proof_enabled:       readBoolSetting(req.shopId, 'social_proof_enabled', SOCIAL_PROOF_DEFAULT),
    ai_generic_identity_prompt_enabled: readBoolSetting(req.shopId, 'ai_generic_identity_prompt_enabled', AI_GENERIC_IDENTITY_PROMPT_DEFAULT),
  });
});

// ── GET /api/shop-settings/style/public — consommé par tl-modal.js ──────────
// PUBLIC (pas d'auth) — uniquement les préférences non sensibles + scopé au shop
// passé en query. CORS large : appelé depuis n'importe quel storefront Shopify.
router.get('/style/public', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Cache-Control', 'public, max-age=60'); // 1 min de cache CDN/browser
  const shopDomain = String(req.query.shop || '').toLowerCase().trim();
  if (!shopDomain) {
    return res.json({
      cart_drawer_bg_color: '',
      ai_photo_styles_enabled: AI_PHOTO_STYLES_DEFAULT,
      reassurance_banner_enabled: REASSURANCE_BANNER_DEFAULT,
      mobile_price_bar_enabled: MOBILE_PRICE_BAR_DEFAULT,
      social_proof_enabled: SOCIAL_PROOF_DEFAULT,
    });
  }
  const shopId = getShopIdByDomain(shopDomain);
  if (!shopId) {
    return res.json({
      cart_drawer_bg_color: '',
      ai_photo_styles_enabled: AI_PHOTO_STYLES_DEFAULT,
      reassurance_banner_enabled: REASSURANCE_BANNER_DEFAULT,
      mobile_price_bar_enabled: MOBILE_PRICE_BAR_DEFAULT,
      social_proof_enabled: SOCIAL_PROOF_DEFAULT,
    });
  }
  res.json({
    cart_drawer_bg_color:       getSetting(shopId, 'cart_drawer_bg_color') || '',
    ai_photo_styles_enabled:    readBoolSetting(shopId, 'ai_photo_styles_enabled', AI_PHOTO_STYLES_DEFAULT),
    reassurance_banner_enabled: readBoolSetting(shopId, 'reassurance_banner_enabled', REASSURANCE_BANNER_DEFAULT),
    mobile_price_bar_enabled:   readBoolSetting(shopId, 'mobile_price_bar_enabled', MOBILE_PRICE_BAR_DEFAULT),
    social_proof_enabled:       readBoolSetting(shopId, 'social_proof_enabled', SOCIAL_PROOF_DEFAULT),
  });
});

// Pré-vol CORS
router.options('/style/public', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

module.exports = router;
