'use strict';

/**
 * Variante qui survit à un changement de produit à l'intérieur du studio
 * (bug signalé par Alan le 13/10 : "T-Shirt dans le panier alors que c'est
 * marqué sac shopping", reproduit en entrant par un produit puis en changeant
 * de produit en cours de route dans TSL).
 * ──────────────────────────────────────────────────────────────────────────
 * public/textilelab-studio.html : `window._TL_VARIANT_ID` (posé une seule
 * fois, à l'ouverture du studio, depuis l'URL ?variant_id=) est relu tel quel
 * par le mode "Shopify direct" d'« Ajouter au panier » (~l.8251), sans jamais
 * être revérifié contre le produit RÉELLEMENT affiché au moment du clic.
 *
 * `chooseShopifyProductHandle()` (choix explicite dans le panel "Produits
 * disponibles") l'efface déjà quand le handle change — mais `selectProduct()`
 * (changer de catégorie de produit, ex. sac → t-shirt) passe par
 * `applyMockup()` → `_syncResolvedProductHandle()`, qui mettait à jour
 * `_resolvedProductHandle` SANS jamais effacer `window._TL_VARIANT_ID` : la
 * variante du PREMIER produit survivait silencieusement à un changement de
 * produit, et se retrouvait ajoutée au panier à la place de celle du produit
 * réellement visible à l'écran.
 *
 * Fix : _syncResolvedProductHandle() efface désormais window._TL_VARIANT_ID
 * dans le même cas que chooseShopifyProductHandle() (le handle résolu change
 * réellement) — même garde, posée au même endroit où le bug existait.
 *
 * Pas de DOM dans ce test (pas de navigateur, Fabric.js a besoin d'un
 * contexte canvas) : câblage source par regex, même approche que
 * tests/panel-mode-studio.test.js / tests/variant-id-scoping.test.js.
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
  return studioSrc.slice(start, next > -1 ? next : start + 1200);
}

test('_syncResolvedProductHandle() efface window._TL_VARIANT_ID quand le handle résolu change réellement', () => {
  const body = fnBody('_syncResolvedProductHandle');
  assert.match(body, /const previousRef = _resolvedProductHandle \|\| window\._TL_PRODUCT_HANDLE \|\| '';/);
  assert.match(body, /if \(previousRef && previousRef !== _resolvedProductHandle\) window\._TL_VARIANT_ID = '';/);
});

test('_syncResolvedProductHandle() ne touche pas window._TL_VARIANT_ID quand aucune option liée n\'existe (chemin inchangé)', () => {
  const body = fnBody('_syncResolvedProductHandle');
  const noOptionsBranch = body.slice(0, body.indexOf('const stillValid'));
  assert.doesNotMatch(noOptionsBranch, /window\._TL_VARIANT_ID/);
});

test('applyMockup() appelle bien _syncResolvedProductHandle() à chaque changement de mockup/produit', () => {
  const body = fnBody('applyMockup');
  assert.match(body, /_syncResolvedProductHandle\(\);/);
});

test('chooseShopifyProductHandle() garde son propre effacement explicite (comportement existant, non régressé)', () => {
  const body = fnBody('chooseShopifyProductHandle');
  assert.match(body, /if \(previousRef && _resolvedProductHandle && previousRef !== _resolvedProductHandle\) \{\s*\n\s*window\._TL_VARIANT_ID = '';/);
});
