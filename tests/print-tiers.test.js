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
