'use strict';

/**
 * Fuite de variante entre produits sur une page qui en affiche plusieurs
 * (bug signalé par Alan le 13/10 : un produit différent se retrouve dans le
 * panier après personnalisation — "T-Shirt dans le panier alors que c'est
 * marqué sac shopping").
 * ──────────────────────────────────────────────────────────────────────────
 * public/tl-modal.js, _tlCurrentVariantId() : lisait la variante sélectionnée
 * en DOM pour suivre un changement de taille après le chargement de la page,
 * mais retombait sur `document.querySelector(...)` (tout le document) si le
 * bouton n'était pas retrouvé dans une section scopée à son produit — sur une
 * page affichant plusieurs formulaires /cart/add (recommandations, upsell,
 * "vu récemment"), ce filet de secours pouvait retourner la variante d'un
 * AUTRE produit que celui réellement personnalisé, alors que le product_id
 * dans l'URL (posé par Liquid, toujours correct) restait, lui, le bon.
 *
 * Fix : ne plus jamais chercher hors de `scope` ; si aucune section scopée
 * n'est trouvée, retourner '' plutôt que de deviner — l'appelant
 * (_tlEditorRequest) retombe alors sur `variant_id` déjà posé dans l'URL par
 * personalise-button.liquid pour CE produit precis.
 *
 * Pas de DOM dans ce test (pas de navigateur) : câblage source par regex,
 * même approche que tests/panel-mode-studio.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modalSrc = fs.readFileSync(path.join(__dirname, '../public/tl-modal.js'), 'utf8');

function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} introuvable`);
  // Bornée à la prochaine déclaration de fonction top-level, large marge suffisante.
  const next = src.indexOf('\n  function ', start + 10);
  return src.slice(start, next > -1 ? next : start + 1500);
}

test('_tlCurrentVariantId : ne retombe jamais sur document.querySelector (fuite cross-produit)', () => {
  const body = fnBody(modalSrc, '_tlCurrentVariantId');
  assert.doesNotMatch(body, /\|\|\s*document\.querySelector/);
});

test('_tlCurrentVariantId : scope = uniquement la section la plus proche, jamais document en repli', () => {
  const body = fnBody(modalSrc, '_tlCurrentVariantId');
  assert.match(body, /var scope = link && link\.closest\s*\n\s*\? link\.closest\('\.shopify-section, product-info, main'\)\s*\n\s*: null;/);
  assert.match(body, /if \(!scope\) return '';/);
});

test('_tlCurrentVariantId : les 3 tentatives de lecture DOM restent toutes scopées à `scope`', () => {
  const body = fnBody(modalSrc, '_tlCurrentVariantId');
  const scoped = body.match(/scope\.querySelector/g) || [];
  assert.equal(scoped.length, 3, `attendu 3 lectures scopées, trouvé ${scoped.length}`);
});

test('_tlEditorRequest : une variante DOM non trouvée (scope absent) retombe sur variant_id de l\'URL, déjà correct pour ce produit', () => {
  const body = fnBody(modalSrc, '_tlEditorRequest');
  assert.match(body, /var variantId = _tlCurrentVariantId\(link\) \|\| url\.searchParams\.get\('variant_id'\);/);
});
