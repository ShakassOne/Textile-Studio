'use strict';
// Régression introduite par le fix GID/id numérique du 14/10
// (routes/product-links.js::normalizeProductId appliqué aussi aux réponses
// GET /, /public, /by-mockup) : l'écran admin indexe _plLinks par p.id, qui
// vient de GET /api/admin/products (GraphQL Admin API, GID complet). Une
// fois le serveur normalisé, _plLinks[GID] ne correspondait plus jamais à
// une clé numérique — un produit tout juste lié réapparaissait "Non lié"
// au rechargement de l'écran, alors qu'il l'était bien en base.
const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'textilelab-admin.html'), 'utf8');

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

test('_normPid existe et extrait l\'id numérique d\'un GID produit', () => {
  const fn = extractFunction(SRC, '_normPid');
  assert.ok(fn.includes('gid:') && fn.includes('shopify'),
    'la détection du GID Shopify doit rester explicite dans la regex');
});

test('loadProductLinks normalise p.id juste après avoir reçu les produits Shopify', () => {
  const fn = extractFunction(SRC, 'loadProductLinks');
  assert.match(fn, /_plProducts\s*=\s*\(shopifyResult\.products \|\| \[\]\)\.map\(p => \(\{ \.\.\.p, id: _normPid\(p\.id\) \}\)\)/,
    '_plProducts.id doit être normalisé dès le chargement, sinon _plLinks[p.id] (clé numérique côté serveur) ne correspond jamais à un GID');
});
