'use strict';
// Vérification par câblage source (même approche que tests/panel-mode-studio.test.js) :
// _setPaletteForMockup() doit préférer le blanc quand la couleur courante
// n'est pas vendue par le produit résolu, plutôt que la 1re couleur du
// nuancier au hasard de l'ordre des variantes Shopify (bug signalé par Alan
// le 14/10 : un sac vendant bien du blanc s'ouvrait en beige, simplement
// parce que Beige était la 1re variante listée par Shopify).
const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'textilelab-studio.html'),
  'utf8'
);

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > -1, `function ${name} introuvable`);
  let depth = 0, i = src.indexOf('{', start), end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > -1, `accolade fermante de ${name} introuvable`);
  return src.slice(start, end);
}

test('_setPaletteForMockup préfère le blanc avant de retomber sur la 1re couleur du nuancier', () => {
  const fn = extractFunction(SRC, '_setPaletteForMockup');
  assert.match(fn, /find\(c\s*=>\s*c\.hex\.toLowerCase\(\)\s*===\s*'#ffffff'\)/,
    'recherche explicite du blanc dans le nuancier restreint absente');
  assert.match(fn, /selectPaletteColor\(\(blanc \|\| _activePalette\[0\]\)\.hex\)/,
    'repli sur la 1re couleur uniquement si le blanc est absent');
});

test('_setPaletteForMockup ne touche pas au cas "palette non restreinte" (générique, déjà blanche en premier)', () => {
  const fn = extractFunction(SRC, '_setPaletteForMockup');
  // La condition déclenchante (if restricted && couleur courante absente du
  // nuancier) doit rester inchangée — seule l'action prise à l'intérieur change.
  assert.match(fn, /if \(restricted && !_activePalette\.some/);
});
