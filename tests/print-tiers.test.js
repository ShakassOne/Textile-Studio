'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PRINT = require('../utils/print-tiers');

test('le barème Winshirt reste aligné sur les formats TSL', () => {
  assert.deepEqual(PRINT.FACE_SURCHARGES, {
    A6: 1.5,
    A5: 2,
    A4: 3,
    A3: 4,
  });
});

test('les libellés Shopify utilisent le format français exact', () => {
  assert.equal(PRINT.amountLabel(0), 'Sans impression');
  assert.equal(PRINT.amountLabel(1.5), '+1,50 €');
  assert.equal(PRINT.amountLabel(4), '+4,00 €');
  assert.equal(PRINT.amountLabel(8), '+8,00 €');
});

test('les paliers couvrent une ou deux faces jusqu’à A3 + A3', () => {
  const amounts = PRINT.paliers().map(tier => tier.amount);
  assert.deepEqual(amounts, [0, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8]);
});

test('la clé de mapping reste stable pour une variante et un montant', () => {
  assert.equal(PRINT.mappingKey('53181819846992', 4), '53181819846992::4.00');
});

// ── Tarifer une création sur un support où elle n'a jamais été posée ──────
//
// C'est ce qui permet d'annoncer, sur une suggestion « vous aimeriez aussi »,
// le prix que le client paiera vraiment — et non celui du vêtement nu.

const { montantComposition } = require('../utils/print-tiers');

const uneFace = (w, ratio = 1, x = 0.5, y = 0.5) => ({
  layers: [{ x, y, w, ratio }], zone: { ratio: 1 },
});

test('montantComposition — la largeur physique de la zone fait le prix', () => {
  const comp = { faces: { front: uneFace(0.5) } };
  // Le même dessin, en fractions de zone, sur des supports de plus en plus
  // grands : 100 mm → A6, 600 mm → A3.
  assert.equal(montantComposition(comp, { front: 200 }), 1.5, 'A6');
  assert.equal(montantComposition(comp, { front: 300 }), 2,   'A5');
  assert.equal(montantComposition(comp, { front: 420 }), 3,   'A4');
  assert.equal(montantComposition(comp, { front: 600 }), 4,   'A3');
});

test('montantComposition — les faces s\'additionnent, les vides ne comptent pas', () => {
  const deux = { faces: { front: uneFace(0.5), back: uneFace(0.5) } };
  assert.equal(montantComposition(deux, { front: 420, back: 420 }), 6);

  const videDerriere = { faces: { front: uneFace(0.5), back: { layers: [] } } };
  assert.equal(montantComposition(videDerriere, { front: 420, back: 420 }), 3);
});

test('montantComposition — deux petits logos éloignés valent un grand format', () => {
  const colles = { faces: { front: { zone: { ratio: 1 }, layers: [
    { x: 0.50, y: 0.5, w: 0.1, ratio: 1 },
    { x: 0.55, y: 0.5, w: 0.1, ratio: 1 },
  ] } } };
  const ecartes = { faces: { front: { zone: { ratio: 1 }, layers: [
    { x: 0.05, y: 0.5, w: 0.1, ratio: 1 },
    { x: 0.95, y: 0.5, w: 0.1, ratio: 1 },
  ] } } };
  // La boîte englobante fait le format : la table d'impression doit couvrir
  // les deux, pas chacun séparément.
  assert.equal(montantComposition(colles,  { front: 420 }), 1.5);
  assert.equal(montantComposition(ecartes, { front: 420 }), 4);
});

test('montantComposition — entrées absurdes : zéro, jamais d\'exception', () => {
  assert.equal(montantComposition(null, { front: 420 }), 0);
  assert.equal(montantComposition({}, { front: 420 }), 0);
  assert.equal(montantComposition({ faces: {} }, {}), 0);
  assert.equal(montantComposition({ faces: { front: { layers: null } } }, {}), 0);
  // Sans largeur connue : le défaut de 420 mm s'applique, pas une erreur.
  assert.equal(montantComposition({ faces: { front: uneFace(0.5) } }, {}), 3);
});

test('montantComposition — le barème de la boutique prime sur le défaut', () => {
  const comp = { faces: { front: uneFace(0.5) } };
  assert.equal(montantComposition(comp, { front: 420 }, { A6: 1, A5: 2, A4: 9, A3: 12 }), 9);
});

// ── Arrondi au palier ─────────────────────────────────────────────────────
//
// Garde-fou de catalogue : chaque montant inédit fait naître une variante
// Shopify qui ne disparaît plus. Sept tailles et douze paliers frôlent déjà
// la limite de cent variantes par produit.

test('arrondirAuPalier remonte au palier configuré, jamais en dessous', () => {
  assert.equal(PRINT.arrondirAuPalier(1.2), 1.5);
  assert.equal(PRINT.arrondirAuPalier(2.5), 3);
  assert.equal(PRINT.arrondirAuPalier(3.2), 3.5);
  assert.equal(PRINT.arrondirAuPalier(7.9), 8);
});

test('arrondirAuPalier laisse un montant déjà sur un palier', () => {
  // En fonctionnement normal la surcharge est une somme de paliers : la
  // fonction ne doit alors RIEN changer, sinon elle surfacturerait.
  for (const t of PRINT.paliers()) {
    assert.equal(PRINT.arrondirAuPalier(t.amount), t.amount, 'palier ' + t.amount);
  }
});

test('arrondirAuPalier borne au plus haut palier et encaisse l\'absurde', () => {
  assert.equal(PRINT.arrondirAuPalier(9), 8, 'au-delà d\'A3 recto + A3 verso');
  assert.equal(PRINT.arrondirAuPalier(1000), 8);
  assert.equal(PRINT.arrondirAuPalier(0), 0);
  assert.equal(PRINT.arrondirAuPalier(-5), 0);
  assert.equal(PRINT.arrondirAuPalier(null), 0);
  assert.equal(PRINT.arrondirAuPalier(undefined), 0);
  assert.equal(PRINT.arrondirAuPalier(NaN), 0);
});

test('arrondirAuPalier suit le barème de la boutique, pas le défaut', () => {
  const maison = { A6: 1, A5: 2, A4: 9, A3: 12 };
  // Paliers de ce barème : 0/1/2/3/4/9/10/11/12/13/18/21/24…
  assert.equal(PRINT.arrondirAuPalier(1.5, maison), 2);
  assert.equal(PRINT.arrondirAuPalier(5, maison), 9);
  assert.equal(PRINT.arrondirAuPalier(9, maison), 9);
});
