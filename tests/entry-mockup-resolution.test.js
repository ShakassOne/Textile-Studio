'use strict';

/**
 * Mauvais mockup affiché à l'OUVERTURE du studio, persistant (pas un simple
 * flash) — cause racine derrière plusieurs symptômes signalés par Alan le
 * 13/10 : "T-Shirt Homme Bio 150" affichait le mockup Femme, et même une
 * entrée par "Sac shopping" atterrissait sur le mockup T-Shirt Femme.
 * ──────────────────────────────────────────────────────────────────────────
 * init() (cas normal : entrée via ?product=/?product_id= SANS ?mockup=, ce
 * que fait tout bouton "Personnaliser") appliquait IMMÉDIATEMENT et à
 * l'aveugle `applyMockup(STATE.product, 0)` avec STATE.product encore à sa
 * valeur par défaut ('tshirt') — AVANT que loadShopifyProductLinks() (lancé
 * juste au-dessus, mais jamais attendu) n'ait eu la moindre chance de
 * résoudre le VRAI produit d'entrée.
 *
 * Deux dégâts en cascade :
 * 1. Le client voyait le mauvais mockup (le [0] du groupe "tshirt", visiblement
 *    Femme) le temps que la résolution réelle arrive.
 * 2. loadShopifyProductLinks() → _syncResolvedProductHandle() →
 *    _getLinkedProductsForActiveMockup() lit STATE_mockup.id — CE mockup
 *    par défaut déjà posé — et valide le produit d'ORIGINE (ex. "sac-shopping")
 *    contre la liste des produits liés à CE mockup, le juge invalide, et
 *    écrase _resolvedProductHandle par un produit SANS RAPPORT — persistant,
 *    pas un flash, puisque rien ne revient plus corriger après coup.
 *
 * Fix : init() n'applique plus AUCUN mockup par défaut quand un produit est
 * attendu (?product=/?product_id= + ?shop= présents) — seul
 * loadShopifyProductLinks() (son bloc "Auto-bascule") applique alors le
 * mockup, avec son propre repli (`if (!STATE_mockup) applyMockup(...)`, à la
 * fois en succès et en catch réseau) pour ne jamais laisser le studio sans
 * aucun mockup si le produit d'entrée n'a aucune liaison exploitable.
 *
 * Pas de DOM dans ce test (pas de navigateur) : câblage source par regex,
 * même approche que tests/resolved-product-handle-variant.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const studioSrc = fs.readFileSync(path.join(__dirname, '../public/textilelab-studio.html'), 'utf8');

function fnBody(name, markerAfter) {
  const start = studioSrc.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} introuvable`);
  const end = markerAfter ? studioSrc.indexOf(markerAfter, start) : studioSrc.indexOf('\nfunction ', start + 10);
  assert.ok(end > start, `borne de fin introuvable pour ${name}`);
  return studioSrc.slice(start, end);
}

test('init() : aucun mockup par défaut appliqué à l\'aveugle quand un produit est attendu (?product=/?product_id= + ?shop=)', () => {
  const body = fnBody('init', 'showMockupStatus();');
  // Le bloc _urlMockupId absent doit désormais être conditionné à l'absence
  // de produit connu OU de contexte boutique — jamais un simple `else` nu.
  assert.match(body, /\} else if \(!window\._TL_PRODUCT_HANDLE \|\| !window\._TL_SHOP\) \{\s*\n[^}]*applyMockup\(STATE\.product, 0\);\s*\n\s*\}/);
});

test('loadShopifyProductLinks() : repli "aucun mockup appliqué" avant refreshResolvedProductPrice() (chemin succès)', () => {
  const body = fnBody('loadShopifyProductLinks', '} catch(e) {');
  assert.match(body, /if \(!STATE_mockup\) applyMockup\(STATE\.product, 0\);\s*\n\s*\n\s*refreshResolvedProductPrice\(\);/);
});

test('loadShopifyProductLinks() : même repli dans le bloc catch (échec réseau)', () => {
  const start = studioSrc.indexOf('} catch(e) {', studioSrc.indexOf('async function loadShopifyProductLinks'));
  const end = studioSrc.indexOf('\nasync function loadShopifyProductThumbs', start);
  assert.ok(start > -1 && end > start, 'bloc catch introuvable');
  const catchBody = studioSrc.slice(start, end);
  assert.match(catchBody, /if \(!STATE_mockup\) applyMockup\(STATE\.product, 0\);/);
});

test('_getLinkedProductsForActiveMockup() continue de dépendre de STATE_mockup.id (non modifié) : la séquence ci-dessus est bien ce qui protège contre une validation prématurée', () => {
  const body = fnBody('_getLinkedProductsForActiveMockup');
  assert.match(body, /const mid = String\(STATE_mockup\?\.id \|\| ''\);/);
});
