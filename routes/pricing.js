'use strict';
const express  = require('express');
const router   = express.Router();
const { requireAuth } = require('./auth');
const { getDB } = require('../db/database');
const { attachShopId } = require('./_shop-context');
const { getSetting, setSetting } = require('../db/settings');

// Lit les surcharges de format persistées pour un shop (clé settings 'print_surcharges').
// Retourne {} si absent/illisible. Fusion par-dessus les défauts → multi-tenant.
function readShopSurcharges(shopId) {
  try {
    if (!shopId) return {};
    const raw = getSetting(shopId, 'print_surcharges');
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch { return {}; }
}

// These could be moved to DB for admin-editable pricing
// Surcharges par défaut = ÉCHELLE CANONIQUE (alignée studio FORMATS + utils/print-tiers.js
// + variantes Shopify pré-tarifées). Le studio n'applique plus ces valeurs au calcul
// d'impression (échelle figée côté studio) ; la section admin reste un repère.
let PRICING = {
  base:    { tshirt: 19.90, hoodie: 39.90, cap: 24.90, totebag: 14.90 },
  formats: { A3: 4.00, A4: 3.00, A5: 2.00, A6: 1.50 },
  products: [
    { key: 'tshirt',  name: 'T-Shirt',   emoji: '👕', base: 19.90 },
    { key: 'hoodie',  name: 'Hoodie',     emoji: '🧥', base: 39.90 },
    { key: 'cap',     name: 'Casquette',  emoji: '🧢', base: 24.90 },
    { key: 'totebag', name: 'Tote Bag',   emoji: '👜', base: 14.90 },
  ],
  formatList: [
    { key: 'A3', label: 'A3', dims: '297×420mm', extra: 4.00,  dpi300: '3508×4961px', usage: 'Grande surface, dos' },
    { key: 'A4', label: 'A4', dims: '210×297mm', extra: 3.00,  dpi300: '2480×3508px', usage: 'Devant standard' },
    { key: 'A5', label: 'A5', dims: '148×210mm', extra: 2.00,  dpi300: '1748×2480px', usage: 'Poitrine, poche' },
    { key: 'A6', label: 'A6', dims: '105×148mm', extra: 1.50,  dpi300: '1240×1748px', usage: 'Logo, signature' },
  ],
};

/** Retourne products sous forme d'objet keyed pour le front admin */
function buildProductsObj() {
  const obj = {};
  PRICING.products.forEach(p => {
    obj[p.key] = { base: p.base, name: p.name, emoji: p.emoji };
  });
  return obj;
}

/** Retourne formats sous forme d'objet { A3: 8.00, ... } (valeurs numériques simples) */
function buildFormatsObj() {
  const obj = {};
  PRICING.formatList.forEach(f => { obj[f.key] = f.extra; });
  return obj;
}

// GET /api/pricing — scopé shop (audit B1)
// Fusionne les catégories du shop courant avec les produits en mémoire.
// → toute nouvelle catégorie admin apparaît automatiquement dans la tarification.
router.get('/', attachShopId, (req, res) => {
  try {
    const db   = getDB();
    const cats = db.prepare('SELECT * FROM product_categories WHERE shop_id=? ORDER BY sort_order, id').all(req.shopId);
    cats.forEach(c => {
      if (!PRICING.products.find(p => p.key === c.key)) {
        // Nouvelle catégorie : l'ajouter avec prix de base 0
        PRICING.products.push({ key: c.key, name: c.name, emoji: c.emoji, base: 0 });
        PRICING.base[c.key] = 0;
      } else {
        // Catégorie existante : synchroniser le nom et l'emoji depuis la DB
        const p = PRICING.products.find(p => p.key === c.key);
        p.name  = c.name;
        p.emoji = c.emoji;
      }
    });
  } catch(e) { /* DB pas encore disponible, on renvoie l'état en mémoire */ }

  // Surcharges de format scopées par boutique (override des défauts en mémoire)
  const formats = { ...buildFormatsObj(), ...readShopSurcharges(req.shopId) };

  res.json({
    ...PRICING,
    products: buildProductsObj(),
    formats,
  });
});

// PUT /api/pricing — admin update (persisté par boutique)
router.put('/', requireAuth, attachShopId, (req, res) => {
  // products: { tshirt: { base: 20 }, hoodie: { base: 40 }, ... }
  if (req.body.products) {
    Object.entries(req.body.products).forEach(([key, val]) => {
      const base = parseFloat(typeof val === 'number' ? val : (val.base ?? val)) || 0;
      PRICING.base[key] = base;
      const p = PRICING.products.find(p => p.key === key);
      if (p) p.base = base;
    });
  }
  // Legacy: base: { tshirt: 20, ... }
  if (req.body.base) {
    Object.entries(req.body.base).forEach(([key, val]) => {
      const base = parseFloat(typeof val === 'number' ? val : (val.base ?? val)) || 0;
      PRICING.base[key] = base;
      const p = PRICING.products.find(p => p.key === key);
      if (p) p.base = base;
    });
  }
  // formats: { A3: { extra: 8 }, ... } OR { A3: 8, ... }
  // → persisté par boutique dans settings.print_surcharges (multi-tenant),
  //   en plus de la maj mémoire (rétro-compat).
  if (req.body.formats) {
    const persisted = readShopSurcharges(req.shopId);
    Object.entries(req.body.formats).forEach(([key, val]) => {
      const extra = parseFloat(typeof val === 'number' ? val : (val.extra ?? val)) || 0;
      PRICING.formats[key] = extra;
      const f = PRICING.formatList.find(f => f.key === key);
      if (f) f.extra = extra;
      persisted[key] = extra;
    });
    try { if (req.shopId) setSetting(req.shopId, 'print_surcharges', JSON.stringify(persisted)); }
    catch (e) { console.warn('⚠️  persist print_surcharges:', e.message); }
  }

  // Réponse : surcharges scopées par boutique
  const formats = { ...buildFormatsObj(), ...readShopSurcharges(req.shopId) };
  res.json({
    ...PRICING,
    products: buildProductsObj(),
    formats,
  });
});

/** Expose la tarification live pour les autres modules (ex: orders.js) */
module.exports = router;
module.exports.getProductPrice  = (key)    => PRICING.products.find(p => p.key === key)?.base  || 0;
module.exports.getFormatExtra   = (key)    => PRICING.formatList.find(f => f.key === key)?.extra || 0;
// Clés connues — exposées pour la validation des entrées (audit N3).
module.exports.getProductKeys   = ()       => PRICING.products.map(p => p.key);
module.exports.getFormatKeys    = ()       => PRICING.formatList.map(f => f.key);
