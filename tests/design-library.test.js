'use strict';

/**
 * Métadonnées vitrine de la bibliothèque (utils/design-library.js).
 * ──────────────────────────────────────────────────────────────────────────
 * Ces visuels vont être parcourus par le client final sur la fiche produit, et
 * leur `slug` part dans l'URL publique (?design=money-control). Deux propriétés
 * comptent donc vraiment, et c'est ce que ce fichier vérifie :
 *   • un slug reste unique dans une boutique, sinon deux visuels se disputent
 *     la même adresse ;
 *   • un slug qui a du sens n'est jamais régénéré, sinon les liens partagés
 *     cassent.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const DL = require('../utils/design-library');

test('un nom devient une adresse lisible, accents et ponctuation compris', () => {
  assert.equal(DL.slugify('Octobre Rose 01'), 'octobre-rose-01');
  assert.equal(DL.slugify("Côte d'Azur — Été 2026"), 'cote-d-azur-ete-2026');
  assert.equal(DL.slugify('  I ♥ NY  '), 'i-ny');
  assert.equal(DL.slugify('🎨'), '', 'rien d\'exploitable → chaîne vide, pas un tiret isolé');
  assert.equal(DL.slugify(null), '');
});

test('un slug ne dépasse jamais la longueur maximale, suffixe compris', () => {
  const long = 'a'.repeat(200);
  assert.equal(DL.slugify(long).length, DL.SLUG_MAX);
  const avecSuffixe = DL.uniqueSlug(long, [DL.slugify(long)]);
  assert.ok(avecSuffixe.length <= DL.SLUG_MAX, avecSuffixe.length);
  assert.ok(avecSuffixe.endsWith('-2'));
});

test('deux visuels ne peuvent pas se partager la même adresse', () => {
  const pris = new Set(['money-control']);
  const a = DL.uniqueSlug('Money Control', pris);
  assert.equal(a, 'money-control-2');
  pris.add(a);
  assert.equal(DL.uniqueSlug('Money Control', pris), 'money-control-3');
});

test('un nom intraduisible en slug retombe sur le repli fourni', () => {
  assert.equal(DL.uniqueSlug('🎨🎨', [], 'visuel-42'), 'visuel-42');
  assert.equal(DL.uniqueSlug('', [], ''), 'visuel');
});

test('seul un slug provisoire peut encore bouger', () => {
  // Posés automatiquement faute de nom exploitable : jamais partagés.
  assert.equal(DL.isPlaceholderSlug('nouveau-visuel'), true);
  assert.equal(DL.isPlaceholderSlug('nouveau-visuel-2'), true);
  assert.equal(DL.isPlaceholderSlug('visuel-42'), true);
  // Choisis par l'admin : figés, sous peine de casser les liens partagés.
  assert.equal(DL.isPlaceholderSlug('octobre-rose-01'), false);
  assert.equal(DL.isPlaceholderSlug('visuelle'), false);
  assert.equal(DL.isPlaceholderSlug(''), false);
  assert.equal(DL.isPlaceholderSlug(null), false);
});

test('le nom de fichier ne sert de nom affiché que s\'il veut dire quelque chose', () => {
  assert.equal(DL.displayNameFromFilename('octobre-rose-01.png'), 'Octobre rose 01');
  assert.equal(DL.displayNameFromFilename('money_control.PNG'), 'Money control');
  // Nom généré par multer à l'upload : horodatage + aléatoire, aucun sens.
  assert.equal(DL.displayNameFromFilename('1759400000000_k3f9a2.png'), '');
  assert.equal(DL.displayNameFromFilename(''), '');
  assert.equal(DL.displayNameFromFilename(undefined), '');
});

test('les étiquettes sont dédoublonnées sans tenir compte de la casse', () => {
  assert.deepEqual(DL.normalizeTags(' rose , Rose ,cancer, '), ['rose', 'cancer']);
  assert.deepEqual(DL.normalizeTags(['a', 'b', 'a']), ['a', 'b']);
  assert.deepEqual(DL.normalizeTags('["x","y"]'), ['x', 'y']);
  assert.deepEqual(DL.normalizeTags(null), []);
  assert.equal(DL.normalizeTags(Array.from({ length: 50 }, (_, i) => 't' + i)).length, 20,
    'plafonné à 20 étiquettes');
});

test('les exclusions sont des identifiants de mockup propres', () => {
  assert.deepEqual(DL.normalizeExclusions('7, 3, 3, x, -2, 0'), [3, 7]);
  assert.deepEqual(DL.normalizeExclusions([3, '7', null]), [3, 7]);
  assert.deepEqual(DL.normalizeExclusions('[4,2]'), [2, 4]);
  assert.deepEqual(DL.normalizeExclusions(''), []);
  assert.deepEqual(DL.normalizeExclusions(undefined), []);
});

test('une colonne JSON illisible ne fait jamais tomber la lecture', () => {
  assert.deepEqual(DL.parseJsonArray('["a"]'), ['a']);
  assert.deepEqual(DL.parseJsonArray('{"pas":"un tableau"}'), []);
  assert.deepEqual(DL.parseJsonArray('json cassé {'), []);
  assert.deepEqual(DL.parseJsonArray(null), []);
});
