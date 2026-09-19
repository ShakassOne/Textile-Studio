'use strict';
/**
 * utils/print-tiers.js — Source de vérité PARTAGÉE de la tarification d'impression.
 * ──────────────────────────────────────────────────────────────────────────
 * Modèle (juin 2026, règle Alan) : le coût d'impression est porté par une
 * VARIANTE Shopify pré-tarifée → UNE seule ligne panier. Le « palier » est
 * désormais identifié par le MONTANT TOTAL de surcharge (en €), pas par un
 * format unique, car le recto/verso CUMULE les deux faces.
 *
 * Règle de calcul (faite côté studio, voir _computeSurcharge) :
 *   • par face : cumul des visuels → format équivalent (bounding box), plafonné A3 ;
 *   • surcharge d'une face = barème ci-dessous ;
 *   • total = somme des faces (recto + verso) ;
 *   • plafond de fait = A3 + A3 = 4 + 4 = 8 €.
 *
 * La variante finale est choisie en cherchant l'option « Impression » du produit
 * dont la valeur == amountLabel(total) (ex « +7,00 € »), sinon via le mapping admin.
 *
 * NB barème : ce sont les surcharges de format de la boutique (admin → Surcharges
 * d'impression). Gardé ici comme défaut pour générer la liste des paliers et
 * pour le mapping ; le studio, lui, calcule le total à partir de ses FORMATS.extra
 * (qui reçoivent ces mêmes valeurs admin au runtime).
 */

// Barème par face (défaut WinShirt). A6 = « petit logo ».
const FACE_SURCHARGES = { A6: 1.5, A5: 2, A4: 3, A3: 4 };

/** Normalise une chaîne pour comparaison robuste (accents, casse, espaces). */
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "7" → "7,00" ; "1.5" → "1,50" (format FR). */
function fmtAmount(n) {
  return Number(n || 0).toFixed(2).replace('.', ',');
}

/** Montant → libellé de valeur d'option Shopify. 0 → "Sans impression". */
function amountLabel(n) {
  const v = Math.round(Number(n || 0) * 100) / 100;
  return v <= 0 ? 'Sans impression' : `+${fmtAmount(v)} €`;
}

/** Montant → clé stable pour le mapping ("7.00"). */
function amountKey(n) {
  return (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
}

/** Clé de mapping admin : `${baseVariantId}::${amountKey}`. */
function mappingKey(baseVariantId, amount) {
  return `${String(baseVariantId || '').trim()}::${amountKey(amount)}`;
}

/**
 * Liste des paliers possibles à partir du barème par face (1 ou 2 faces).
 * Avec le défaut : 0 / 1,50 / 2 / 3 / 3,50 / 4 / 4,50 / 5 / 5,50 / 6 / 7 / 8.
 * @returns {{amount:number, key:string, label:string}[]}
 */
function paliers(faceSurcharges = FACE_SURCHARGES) {
  const vals = Object.values(faceSurcharges);
  const set = new Set([0]);
  vals.forEach(a => set.add(a));                 // une face
  vals.forEach(a => vals.forEach(b => set.add(a + b))); // deux faces (cumul)
  return [...set]
    .map(n => Math.round(n * 100) / 100)
    .sort((a, b) => a - b)
    .map(n => ({ amount: n, key: amountKey(n), label: amountLabel(n) }));
}

/** Heuristique : un nom d'option Shopify désigne-t-il l'impression ? */
function isPrintOptionName(name) {
  return /impr|print|perso|finition/i.test(String(name || ''));
}

/**
 * Coût d'impression de RÉFÉRENCE d'un template produit (custom.tsl_template).
 * ──────────────────────────────────────────────────────────────────────────
 * Ce montant est déjà inclus dans le prix Shopify du produit : le client ne
 * paie que ce qu'il ajoute AU-DELÀ (cf. extraDue ci-dessous).
 *
 * Deux sources, dans cet ordre :
 *
 *  1. template.pricingReference.amount (templates v2) — calculé par le studio
 *     au moment du save avec _computeSurcharge(), c'est-à-dire EXACTEMENT la
 *     fonction qui produira le coût final côté client. Cohérence garantie.
 *
 *  2. Recalcul depuis viewLayers + viewFormats (templates v1, sans
 *     pricingReference). Best-effort : le studio affine le format de la face
 *     courante par bounding box des objets Fabric (_faceCumulFormat), ce qui
 *     n'est pas reproductible hors canvas. On retombe donc sur le format
 *     propre de chaque face — le même repli que le studio applique aux faces
 *     non courantes. Un v1 dont une face cumulait plusieurs visuels peut donc
 *     être sous-évalué ; le client paiera alors une petite différence, jamais
 *     un prix inférieur au prix Shopify (extraDue est borné à 0).
 *
 * Fonction PURE : aucun accès DB, réseau ou DOM.
 *
 * @param {object} template  le JSON du metafield
 * @param {object} [faceSurcharges]  barème par face (défaut : FACE_SURCHARGES)
 * @returns {number} montant en € (0 si indéterminable)
 */
function computeTemplatePrintAmount(template, faceSurcharges = FACE_SURCHARGES) {
  if (!template || typeof template !== 'object') return 0;

  // ── 1. Référence figée par le studio (v2) ────────────────────────────────
  const ref = template.pricingReference;
  if (ref && typeof ref === 'object') {
    const n = Number(ref.amount);
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100;
  }

  // ── 2. Repli v1 : somme des faces AYANT du contenu ───────────────────────
  const layers = template.viewLayers;
  if (!layers || typeof layers !== 'object') return 0;
  const formats = (template.viewFormats && typeof template.viewFormats === 'object')
    ? template.viewFormats : {};
  const fallbackFormat = template.format;

  let total = 0;
  for (const key of Object.keys(layers)) {
    const objs = layers[key];
    if (!Array.isArray(objs) || objs.length === 0) continue; // face vide → non facturée
    const fmt = formats[key] || fallbackFormat;
    const extra = faceSurcharges[fmt];
    if (Number.isFinite(extra)) total += extra;
  }
  return Math.round(total * 100) / 100;
}

/**
 * Surcoût réellement dû par le client :  max(0, final - référence).
 * Le prix Shopify du produit n'est JAMAIS réduit — un design plus léger que
 * le template d'origine reste au prix de base.
 */
function extraDue(finalAmount, referenceAmount) {
  const f = Math.round(Number(finalAmount || 0) * 100) / 100;
  const r = Math.round(Number(referenceAmount || 0) * 100) / 100;
  return Math.max(0, Math.round((f - r) * 100) / 100);
}

/** Une valeur d'option Shopify ("+7,00 €") → montant numérique, ou null. */
function amountFromOptionValue(value) {
  const v = norm(value);
  if (!v) return null;
  if (v === 'sans impression' || v === 'sans') return 0;
  const m = v.replace(/€|eur|euros?/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Math.round(parseFloat(m[0]) * 100) / 100 : null;
}

module.exports = {
  FACE_SURCHARGES,
  computeTemplatePrintAmount,
  extraDue,
  norm,
  fmtAmount,
  amountLabel,
  amountKey,
  mappingKey,
  paliers,
  isPrintOptionName,
  amountFromOptionValue,
};
