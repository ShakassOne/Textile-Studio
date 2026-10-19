'use strict';
// Bug signalé par Alan le 14/10, top priorité : sur une session neuve (panier
// vide au chargement), le tout premier ajout au panier affichait un drawer
// vide — il fallait un 2e ajout ou un rechargement complet pour voir le vrai
// contenu. Cause : _tlCartDrawerSectionId()/_tlInjectSectionHTML() exigeaient
// toutes deux que le markup du drawer existe déjà dans le DOM — absent sur
// certains thèmes tant que le panier est vide ou n'a jamais été ouvert.
const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'tl-modal.js'), 'utf8');

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

test('_tlCartDrawerSectionId ne renvoie plus jamais null — repli sur "cart-drawer" même sans élément DOM trouvé', () => {
  const fn = extractFunction(SRC, '_tlCartDrawerSectionId');
  assert.doesNotMatch(fn, /return null;/,
    'un id de section non déterminé empêchait toute demande de rendu serveur au 1er ajout');
  assert.match(fn, /return 'cart-drawer';\s*\}\s*$/,
    'repli explicite sur le nom de section quasi universel des thèmes Shopify 2.0');
});

test('_tlInjectSectionHTML insère le wrapper du drawer s\'il est absent du DOM, au lieu d\'abandonner silencieusement', () => {
  const fn = extractFunction(SRC, '_tlInjectSectionHTML');
  assert.match(fn, /if \(!wrap\)\s*\{[\s\S]*document\.body\.appendChild\(fresh\)/,
    'le rendu serveur doit être inséré dans le DOM quand le wrapper n\'existe pas encore (1er ajout, panier vide au chargement)');
});

test('le flux d\'ajout au panier (tl-add-to-cart) demande toujours une section, _sectionId n\'est plus conditionnel', () => {
  const start = SRC.indexOf("case 'tl-add-to-cart'");
  assert.ok(start > -1, "handler 'tl-add-to-cart' introuvable");
  const bloc = SRC.slice(start, start + 4000);
  assert.match(bloc, /var _sectionId = _tlCartDrawerSectionId\(\);/);
  assert.match(bloc, /if \(_sectionId\) \{ _addBody\.sections = _sectionId;/,
    '_sectionId est désormais toujours une chaîne non vide ("cart-drawer" au pire) — ce if reste un garde-fou, pas un cas bloquant');
});
