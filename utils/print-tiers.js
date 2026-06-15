'use strict';
/**
 * utils/print-tiers.js — Source de vérité PARTAGÉE des paliers d'impression.
 * ──────────────────────────────────────────────────────────────────────────
 * Objectif (CDC juin 2026) : abandonner la 2e ligne panier « Frais d'impression ».
 * Le coût d'impression est désormais porté par une VARIANTE Shopify pré-tarifée.
 * TSL doit donc traduire un design (format détecté + côté) en un « palier »
 * canonique, puis retrouver la variante correspondante :
 *   1. via une OPTION de variante « Impression » sur le produit, si elle existe ;
 *   2. sinon via une TABLE DE MAPPING admin (baseVariantId + palier → variantId).
 *
 * Ce module ne dépend de rien (CommonJS pur) afin d'être require() côté serveur.
 * Le studio (HTML) embarque une mini-copie de PRINT_TIERS / tierFromDesign() —
 * garder les deux cohérents si on touche aux libellés.
 *
 * Paliers CDC :
 *   NONE   « Sans impression »   (aucune face avec contenu)
 *   LOGO   « Petit logo »        (A6 = petit logo / cœur)
 *   A5     « A5 recto »
 *   A4     « A4 recto »
 *   A3     « A3 recto »
 *   DUPLEX « Recto + verso »     (≥ 2 faces avec contenu, prix forfaitaire)
 */

// Ordre = du plus petit au plus grand (sert au classement / au « max »).
const PRINT_TIERS = [
  { key: 'NONE',   label: 'Sans impression', sides: 'none',        rank: 0,
    aliases: ['sans impression', 'sans', 'aucune', 'no print', 'none'] },
  { key: 'LOGO',   label: 'Petit logo',      sides: 'recto',       rank: 1,
    aliases: ['petit logo', 'logo', 'petit logo / coeur', 'petit logo / cœur', 'coeur', 'cœur', 'a6 recto', 'a6'] },
  { key: 'A5',     label: 'A5 recto',        sides: 'recto',       rank: 2,
    aliases: ['a5 recto', 'a5', 'impression a5', 'a5 r'] },
  { key: 'A4',     label: 'A4 recto',        sides: 'recto',       rank: 3,
    aliases: ['a4 recto', 'a4', 'impression a4', 'a4 r'] },
  { key: 'A3',     label: 'A3 recto',        sides: 'recto',       rank: 4,
    aliases: ['a3 recto', 'a3', 'impression a3', 'a3 r'] },
  { key: 'DUPLEX', label: 'Recto + verso',   sides: 'recto-verso', rank: 5,
    aliases: ['recto + verso', 'recto verso', 'recto-verso', 'rectoverso', 'duplex', 'r+v', 'recto/verso'] },
];

const TIER_BY_KEY = Object.fromEntries(PRINT_TIERS.map(t => [t.key, t]));

// Le format A-papier (détecté côté studio) → palier canonique recto.
const FORMAT_TO_TIER = { A6: 'LOGO', A5: 'A5', A4: 'A4', A3: 'A3' };

/** Normalise une chaîne pour comparaison robuste (accents, casse, espaces). */
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire accents
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Détermine le palier d'impression à partir du design.
 * @param {Object} d
 * @param {string[]} d.formats — formats A-papier des faces AVEC contenu, ex ['A4'] ou ['A6','A3'].
 * @param {number}   [d.faces] — nb de faces avec contenu (déduit de formats.length si absent).
 * @returns {{ key, label, sides, format, faces }} palier canonique.
 */
function tierFromDesign(d = {}) {
  const formats = (d.formats || []).filter(Boolean);
  const faces   = Number.isFinite(d.faces) ? d.faces : formats.length;

  if (faces <= 0 || formats.length === 0) {
    const t = TIER_BY_KEY.NONE;
    return { key: t.key, label: t.label, sides: t.sides, format: null, faces: 0 };
  }

  // ≥ 2 faces imprimées → palier forfaitaire « Recto + verso ».
  if (faces >= 2) {
    const t = TIER_BY_KEY.DUPLEX;
    // format = le plus grand des deux (info production / mapping fin éventuel).
    const biggest = formats
      .map(f => TIER_BY_KEY[FORMAT_TO_TIER[f]] || TIER_BY_KEY.LOGO)
      .sort((a, b) => b.rank - a.rank)[0];
    return { key: t.key, label: t.label, sides: t.sides, format: biggest ? biggest.key : null, faces };
  }

  // 1 face → palier = format de cette face.
  const tierKey = FORMAT_TO_TIER[formats[0]] || 'LOGO';
  const t = TIER_BY_KEY[tierKey];
  return { key: t.key, label: t.label, sides: t.sides, format: t.key, faces: 1 };
}

/** Clé de mapping admin stable : `${baseVariantId}::${tierKey}`. */
function mappingKey(baseVariantId, tierKey) {
  return `${String(baseVariantId || '').trim()}::${String(tierKey || 'NONE').trim()}`;
}

/**
 * Tente d'apparier une valeur d'option Shopify (ex « A4 recto », « Impression A4 »)
 * à un palier canonique. Retourne la clé palier ou null.
 */
function tierKeyFromOptionValue(value) {
  const v = norm(value);
  if (!v) return null;
  for (const t of PRINT_TIERS) {
    if (norm(t.label) === v) return t.key;
    if (t.aliases.some(a => norm(a) === v)) return t.key;
  }
  return null;
}

/** Heuristique : un nom d'option Shopify désigne-t-il l'impression ? */
function isPrintOptionName(name) {
  return /impr|print|perso|finition/i.test(String(name || ''));
}

module.exports = {
  PRINT_TIERS,
  TIER_BY_KEY,
  FORMAT_TO_TIER,
  norm,
  tierFromDesign,
  mappingKey,
  tierKeyFromOptionValue,
  isPrintOptionName,
};
