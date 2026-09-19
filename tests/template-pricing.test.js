'use strict';

/**
 * Tarification des produits à template (custom.tsl_template).
 * ───────────────────────────────────────────────────────────
 * Règle : le coût d'impression du design de référence est DÉJÀ inclus dans le
 * prix Shopify du produit. Le client ne paie que ce qu'il ajoute au-delà :
 *
 *     extraDue = max(0, coût_final - coût_référence)
 *
 * Pour un produit sans template, la référence vaut 0 → extraDue === coût final,
 * c'est-à-dire le comportement historique, inchangé.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PRINT = require('../utils/print-tiers');

const S = PRINT.FACE_SURCHARGES; // { A6: 1.5, A5: 2, A4: 3, A3: 4 }

// Template v2 : le studio fige le coût de référence au moment du save.
const templateV2 = (amount, faces = 1) => ({
  v: 2,
  product: 'tshirt',
  format: 'A3',
  mockupId: 7,
  viewFormats: {},
  viewLayers: { '7_0': [{ type: 'image' }] },
  pricingReference: { amount, faces },
});

// ── Cas 1 — Produit vierge (aucun template) ────────────────────────────────
test('cas 1 — produit sans template : le client paie la totalité de l\'impression', () => {
  const reference = PRINT.computeTemplatePrintAmount(null);
  const final = S.A3; // A3 recto
  assert.equal(reference, 0);
  assert.equal(PRINT.extraDue(final, reference), 4);
  assert.equal(PRINT.amountLabel(PRINT.extraDue(final, reference)), '+4,00 €');
  // Base 19 € → 23 €
  assert.equal(19 + PRINT.extraDue(final, reference), 23);
});

// ── Cas 2 — Template A3 recto, design client identique ─────────────────────
test('cas 2 — design identique au template : aucun surcoût, prix de base', () => {
  const reference = PRINT.computeTemplatePrintAmount(templateV2(S.A3));
  const final = S.A3;
  assert.equal(reference, 4);
  assert.equal(PRINT.extraDue(final, reference), 0);
  // extraDue nul → variante de base, libellé « Sans impression »
  assert.equal(PRINT.amountLabel(PRINT.extraDue(final, reference)), 'Sans impression');
  assert.equal(19 + PRINT.extraDue(final, reference), 19);
});

// ── Cas 3 — Template A3 recto + le client ajoute un A6 verso ───────────────
test('cas 3 — ajout d\'un A6 au verso : surcoût de 1,50 € seulement', () => {
  const reference = PRINT.computeTemplatePrintAmount(templateV2(S.A3));
  const final = S.A3 + S.A6; // 5,50 €
  assert.equal(final, 5.5);
  assert.equal(PRINT.extraDue(final, reference), 1.5);
  assert.equal(PRINT.amountLabel(PRINT.extraDue(final, reference)), '+1,50 €');
  assert.equal(19 + PRINT.extraDue(final, reference), 20.5);
});

// ── Cas 4 — Template A3 recto + le client ajoute un A3 verso ───────────────
test('cas 4 — ajout d\'un A3 au verso : surcoût de 4 €', () => {
  const reference = PRINT.computeTemplatePrintAmount(templateV2(S.A3));
  const final = S.A3 + S.A3; // 8 € — plafond de fait
  assert.equal(PRINT.extraDue(final, reference), 4);
  assert.equal(PRINT.amountLabel(PRINT.extraDue(final, reference)), '+4,00 €');
  assert.equal(19 + PRINT.extraDue(final, reference), 23);
});

// ── Cas 5 — Résolution de variante : clé stable, pas de doublon ────────────
test('cas 5 — la clé de mapping est stable par (variante, surcoût) et distincte entre paliers', () => {
  const baseVariant = '51234567890';
  const extra = PRINT.extraDue(S.A3 + S.A3, S.A3); // 4 €

  // Deux appels successifs pour le même besoin → même clé, donc réutilisation
  // de la variante créée, jamais un doublon.
  assert.equal(
    PRINT.mappingKey(baseVariant, extra),
    PRINT.mappingKey(baseVariant, extra),
  );
  assert.equal(PRINT.mappingKey(baseVariant, extra), `${baseVariant}::4.00`);

  // Un autre palier sur la même taille donne une clé différente.
  assert.notEqual(
    PRINT.mappingKey(baseVariant, extra),
    PRINT.mappingKey(baseVariant, PRINT.extraDue(S.A3 + S.A6, S.A3)),
  );

  // La valeur d'option créée est lisible dans les deux sens.
  assert.equal(PRINT.amountFromOptionValue(PRINT.amountLabel(extra)), extra);
});

// ── Cas 6 — Préparation automatique à l'enregistrement du template ─────────
test('cas 6 — l\'option « Impression » est reconnue quel que soit son libellé', () => {
  // ensurePrintOption() s'appuie sur cette heuristique pour rester idempotent :
  // si une option d'impression existe déjà, il ne recrée rien.
  for (const name of ['Impression', 'impression', 'Print', 'Personnalisation', 'Finition']) {
    assert.equal(PRINT.isPrintOptionName(name), true, name);
  }
  for (const name of ['Taille', 'Couleur', 'Matière', '']) {
    assert.equal(PRINT.isPrintOptionName(name), false, name);
  }
  // La valeur posée sur les variantes existantes vaut bien 0 €.
  assert.equal(PRINT.amountFromOptionValue('Sans impression'), 0);
  assert.equal(PRINT.amountLabel(0), 'Sans impression');
});

// ── Cas 7 — Rétrocompatibilité des templates v1 ────────────────────────────
test('cas 7 — un template v1 (sans pricingReference) reste exploitable', () => {
  const v1 = {
    v: 1,
    product: 'tshirt',
    format: 'A3',
    mockupId: 7,
    viewFormats: { '7_1': 'A6' },
    viewLayers: {
      '7_0': [{ type: 'image' }],   // recto → format du template : A3
      '7_1': [{ type: 'i-text' }],  // verso → format propre : A6
    },
  };
  assert.equal(PRINT.computeTemplatePrintAmount(v1), S.A3 + S.A6);

  // Une face sans contenu n'est jamais facturée.
  const v1VideAuVerso = { ...v1, viewLayers: { '7_0': [{ type: 'image' }], '7_1': [] } };
  assert.equal(PRINT.computeTemplatePrintAmount(v1VideAuVerso), S.A3);

  // v2 prime sur le recalcul : la référence figée par le studio fait autorité.
  const v2Divergent = { ...v1, v: 2, pricingReference: { amount: 2, faces: 1 } };
  assert.equal(PRINT.computeTemplatePrintAmount(v2Divergent), 2);
});

// ── Garde-fous ─────────────────────────────────────────────────────────────
test('le prix du produit Shopify n\'est jamais réduit', () => {
  // Design plus léger que le template → surcoût nul, pas de remise.
  assert.equal(PRINT.extraDue(S.A6, S.A3), 0);
  assert.equal(PRINT.extraDue(0, S.A3), 0);
  // Entrées absurdes → 0, jamais NaN ni négatif.
  for (const bad of [null, undefined, {}, { viewLayers: null }, { pricingReference: { amount: -5 } }]) {
    const r = PRINT.computeTemplatePrintAmount(bad);
    assert.equal(Number.isFinite(r), true);
    assert.equal(r >= 0, true);
  }
  assert.equal(PRINT.extraDue(NaN, NaN), 0);
});

// ── Synchronisation front/back ─────────────────────────────────────────────
test('le studio et utils/print-tiers appliquent la même règle de surcoût', () => {
  const studio = fs.readFileSync(path.join(__dirname, '../public/textilelab-studio.html'), 'utf8');

  // Le studio expose sa référence et son miroir de extraDue.
  assert.match(studio, /let TPL_REFERENCE_AMOUNT = 0;/);
  assert.match(studio, /function _tplExtraDue\(finalAmount\)/);
  assert.match(studio, /Math\.max\(0, Math\.round\(\(f - r\) \* 100\) \/ 100\)/);

  // Le checkout résout la variante sur le SURCOÛT, jamais sur le coût total.
  assert.match(studio, /if \(_extraDue > 0\) \{/);
  assert.match(studio, /amount: _extraDue\.toFixed\(2\)/);

  // Les templates écrits par le studio portent la référence de prix (v2).
  assert.match(studio, /const TPL_VERSION = 2;/);
  assert.match(studio, /pricingReference: \{/);
});

// ── Reproduction du miroir studio sur toute la grille des paliers ──────────
test('miroir studio/back : extraDue identique sur tous les paliers', () => {
  const paliers = PRINT.paliers().map(p => p.amount);
  // Réimplémentation littérale du _tplExtraDue du studio.
  const studioExtraDue = (final, ref) => {
    const f = Math.round(Number(final || 0) * 100) / 100;
    const r = Math.round(Number(ref || 0) * 100) / 100;
    return Math.max(0, Math.round((f - r) * 100) / 100);
  };
  for (const final of paliers) {
    for (const ref of paliers) {
      assert.equal(PRINT.extraDue(final, ref), studioExtraDue(final, ref), `final=${final} ref=${ref}`);
    }
  }
});
