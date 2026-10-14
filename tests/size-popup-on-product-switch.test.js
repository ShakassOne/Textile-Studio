'use strict';

/**
 * Popup de choix de taille quand le client change de produit DANS le studio
 * (signalé par Alan le 13/10, captures d'écran à l'appui) : après un
 * changement de produit (ex. sac → t-shirt via le panel "Produits"), la
 * création était conservée à l'écran mais `window._TL_VARIANT_ID` est
 * effacé par construction (voir tests/resolved-product-handle-variant.test.js,
 * fix du même jour contre la vente d'un mauvais produit). Jusqu'ici,
 * `addToCart()` réagissait à l'absence de variante par un simple toast
 * « Choisissez d'abord votre taille sur la fiche produit » suivi d'une
 * REDIRECTION vers la fiche produit — un aller-retour qui perd la création
 * en cours (applyMockup() réinitialise STATE.viewLayers à chaque changement
 * de produit).
 * ──────────────────────────────────────────────────────────────────────────
 * Fix : un popup de taille directement dans le studio (_tlAfficherPopupTaille),
 * alimenté par les variantes réelles du produit résolu (_tlDemanderTailleEtContinuer,
 * fetch public /products/<handle>.json, même filtre "variantes de base" sans
 * l'option Impression que tl-modal.js::_tlVariantesDeBase()) — un clic suffit,
 * la création n'est jamais perdue. Le repli vers la fiche produit (ancien
 * comportement) ne reste que pour le cas où aucun handle n'est même résolu.
 *
 * Pas de DOM dans ce test (pas de navigateur, Fabric.js a besoin d'un contexte
 * canvas) : câblage source par regex, même approche que
 * tests/resolved-product-handle-variant.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const studioSrc = fs.readFileSync(path.join(__dirname, '../public/textilelab-studio.html'), 'utf8');

function fnBody(name) {
  const start = studioSrc.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} introuvable`);
  const next = studioSrc.indexOf('\nfunction ', start + 10);
  return studioSrc.slice(start, next > -1 ? next : start + 2000);
}

test('addToCart() : variante manquante en mode Shopify délègue au popup de taille, ne redirige plus directement', () => {
  const body = fnBody('addToCart');
  const shopifyBranch = body.slice(body.indexOf('if (window._TL_SHOP)'), body.indexOf('return _checkoutShopifyDirect();'));
  assert.match(shopifyBranch, /if \(!ref \|\| !window\._TL_VARIANT_ID\) \{\s*\n\s*return _tlDemanderTailleEtContinuer\(ref\);/);
  assert.doesNotMatch(shopifyBranch, /_returnToShopifyProductPage/);
});

test('_tlDemanderTailleEtContinuer() : repli sur l\'ancien comportement (toast + retour fiche produit) si aucun handle n\'est résolu', () => {
  const body = fnBody('_tlDemanderTailleEtContinuer');
  assert.match(body, /if \(!handle\) \{/);
  assert.match(body, /showToast\('⚠️ Choisissez d’abord votre taille sur la fiche produit\.'\);/);
  assert.match(body, /_returnToShopifyProductPage\(ref\)/);
});

test('_tlDemanderTailleEtContinuer() : interroge le JSON public du produit résolu (pas une route interne)', () => {
  const body = fnBody('_tlDemanderTailleEtContinuer');
  assert.match(body, /\/products\/\$\{encodeURIComponent\(handle\)\}\.json/);
});

test('_tlVariantesDeBaseStudio() : écarte l\'option Impression comme tl-modal.js::_tlVariantesDeBase()', () => {
  const body = fnBody('_tlVariantesDeBaseStudio');
  assert.match(body, /impr\|print\|perso\|finition/i);
  assert.match(body, /val\.indexOf\('sans'\) === 0 \|\| !val/);
});

test('_tlAfficherPopupTaille() : un clic sur une taille disponible pose la variante ET relance le checkout direct, sans navigation', () => {
  const body = fnBody('_tlAfficherPopupTaille');
  assert.match(body, /window\._TL_VARIANT_ID = String\(v\.id\);/);
  assert.match(body, /_checkoutShopifyDirect\(\);/);
  assert.doesNotMatch(body, /window\.location\.assign|postMessage\(\{ type: 'tl-open-product-page'/);
});

test('_tlAfficherPopupTaille() : une taille épuisée reste désactivée, non cliquable', () => {
  const body = fnBody('_tlAfficherPopupTaille');
  assert.match(body, /b\.disabled = !v\.dispo;/);
});
