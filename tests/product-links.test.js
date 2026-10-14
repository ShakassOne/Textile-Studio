'use strict';
const test   = require('node:test');
const assert = require('node:assert');
const { normalizeProductId } = require('../utils/product-links');

test('normalizeProductId — extrait l\'id numérique d\'un GID Shopify complet', () => {
  assert.strictEqual(normalizeProductId('gid://shopify/Product/11256937873735'), '11256937873735');
});

test('normalizeProductId — un id numérique brut reste inchangé', () => {
  assert.strictEqual(normalizeProductId('11256937873735'), '11256937873735');
});

test('normalizeProductId — un nombre JS (pas une chaîne) est accepté', () => {
  assert.strictEqual(normalizeProductId(11256937873735), '11256937873735');
});

test('normalizeProductId — GID d\'un autre type de ressource (variant) fonctionne pareil', () => {
  assert.strictEqual(normalizeProductId('gid://shopify/ProductVariant/987654'), '987654');
});

test('normalizeProductId — espaces superflus retirés', () => {
  assert.strictEqual(normalizeProductId('  123456  '), '123456');
});

test('normalizeProductId — valeur vide/null/undefined renvoie une chaîne vide', () => {
  assert.strictEqual(normalizeProductId(''), '');
  assert.strictEqual(normalizeProductId(null), '');
  assert.strictEqual(normalizeProductId(undefined), '');
});

test('normalizeProductId — une valeur sans aucun chiffre est renvoyée telle quelle (jamais de perte silencieuse)', () => {
  assert.strictEqual(normalizeProductId('toptex-ib311'), 'toptex-ib311');
});

test('normalizeProductId — deux formats du même produit convergent vers la même valeur (le vrai bug corrigé)', () => {
  const viaAdminGraphQL = normalizeProductId('gid://shopify/Product/11256937873735');
  const viaLiquidProductId = normalizeProductId('11256937873735');
  assert.strictEqual(viaAdminGraphQL, viaLiquidProductId);
});
