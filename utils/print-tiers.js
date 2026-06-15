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
  norm,
  fmtAmount,
  amountLabel,
  amountKey,
  mappingKey,
  paliers,
  isPrintOptionName,
  amountFromOptionValue,
};
