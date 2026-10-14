'use strict';

/**
 * Bouton "Modifier" sur une ligne de panier déjà personnalisée (backlog item 26)
 * — routes/shop-settings.js (flag `cart_edit_design_enabled`) + public/tl-modal.js.
 * ──────────────────────────────────────────────────────────────────────────
 * V1 lean : ne touche ni textilelab-studio.html ni textilelab-admin.html (fichiers
 * gelés par le chantier parallèle "Bibliothèque de designs"), même logique que
 * resume_design_enabled/email_resume_enabled — aucun écran admin de toggle, le
 * flag se pilote par un POST /api/shop-settings/style direct en attendant.
 *
 * Pas de DOM dans ces tests (pas de navigateur) : on vérifie la cohérence du
 * câblage source (regex sur le texte des fichiers), comme
 * tests/mobile-price-bar.test.js / tests/reassurance-banner.test.js.
 *
 * routes/shop-settings.js n'est pas require()'é : le charger ouvrirait la
 * base de données (même raison que tests/customer-token.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const settingsSrc = fs.readFileSync(path.join(__dirname, '../routes/shop-settings.js'), 'utf8');
const modalSrc     = fs.readFileSync(path.join(__dirname, '../public/tl-modal.js'), 'utf8');

const KEY = 'cart_edit_design_enabled';

test('routes/shop-settings.js : défaut désactivé (false)', () => {
  assert.match(settingsSrc, /CART_EDIT_DESIGN_DEFAULT\s*=\s*false/);
});

test('routes/shop-settings.js : GET /style renvoie le flag avec son défaut', () => {
  assert.match(
    settingsSrc,
    new RegExp(`${KEY}:\\s*readBoolSetting\\(req\\.shopId, '${KEY}', CART_EDIT_DESIGN_DEFAULT\\)`),
  );
});

test('routes/shop-settings.js : POST /style écrit le flag (mise à jour partielle)', () => {
  assert.match(settingsSrc, new RegExp(`if \\('${KEY}' in body\\)`));
  assert.match(settingsSrc, new RegExp(`setSetting\\(req\\.shopId, '${KEY}'`));
});

test('routes/shop-settings.js : POST /style renvoie le flag à jour dans sa réponse', () => {
  const postSection = settingsSrc.slice(settingsSrc.indexOf("router.post('/style'"));
  assert.match(
    postSection,
    new RegExp(`${KEY}:\\s*readBoolSetting\\(req\\.shopId, '${KEY}', CART_EDIT_DESIGN_DEFAULT\\)`),
  );
});

test('routes/shop-settings.js : la route publique /style/public expose le flag, y compris en fallback (pas de shop / shop inconnu)', () => {
  // 3 occurrences attendues : fallback sans shop, fallback shop inconnu, cas nominal.
  const matches = settingsSrc.match(
    new RegExp(`${KEY}:\\s*(CART_EDIT_DESIGN_DEFAULT|readBoolSetting\\(shopId, '${KEY}', CART_EDIT_DESIGN_DEFAULT\\))`, 'g'),
  ) || [];
  assert.equal(matches.length, 3, `attendu 3 occurrences (2 fallback + 1 nominal), trouvé ${matches.length}`);
});

test('tl-modal.js : le flag est lu depuis /style/public dans _tlLoadStyleSettings', () => {
  assert.match(modalSrc, /_TL_CART_EDIT_DESIGN_ENABLED = !!data\.cart_edit_design_enabled;/);
});

test('tl-modal.js : _tlEnsureModifierButton n\'agit que si le flag est actif ET designId/cartKey connus', () => {
  assert.match(
    modalSrc,
    /function _tlEnsureModifierButton\(row, extra\) \{\s*\n\s*if \(!_TL_CART_EDIT_DESIGN_ENABLED \|\| !row \|\| !extra \|\| !extra\.designId \|\| !extra\.cartKey\) return;/,
  );
});

test('tl-modal.js : _tlEnsureModifierButton s\'ancre sur le lien "Voir mon design" déjà rendu, pas sur le garde dataset.tlFixed', () => {
  assert.match(modalSrc, /row\.querySelector\('\.tl-voir-design-link'\)/);
  const start = modalSrc.indexOf('function _tlEnsureModifierButton');
  const end   = modalSrc.indexOf('\n  }\n\n  // ── Nettoyage des propriétés line item');
  assert.ok(start > -1 && end > start, 'bornes de fonction introuvables');
  assert.doesNotMatch(modalSrc.slice(start, end), /dataset\.tlFixed/);
});

test('tl-modal.js : le bouton "Modifier" est idempotent via data-tl-cart-key sur lui-même (pas de doublon au sync suivant)', () => {
  assert.match(modalSrc, /class="tl-cart-edit-btn" data-tl-cart-key="' \+ cartKeyAttr \+ '"/);
  assert.match(modalSrc, /if \(link\.parentNode\.querySelector\('\.tl-cart-edit-btn\[data-tl-cart-key="' \+ cartKeyAttr \+ '"\]'\)\) return;/);
});

test('tl-modal.js : _tlSyncCartImages lit _design_id depuis /cart.js sans appel réseau supplémentaire', () => {
  assert.match(modalSrc, /designId: \(item\.properties && item\.properties\['_design_id'\]\) \|\| null,/);
});

test('tl-modal.js : le clic sur "Modifier" mémorise la cartKey puis rouvre le studio sur ce design', () => {
  assert.match(modalSrc, /_tlEditingCartKey = extra\.cartKey;/);
  assert.match(modalSrc, /openModal\(_tlCartEditDesignUrl\(extra\.designId\)\);/);
});

test('tl-modal.js : _tlCartEditDesignUrl construit une URL studio avec ?design=<id>', () => {
  assert.match(modalSrc, /params = new URLSearchParams\(\{ shop: shop, embed: '1', design: String\(designId\) \}\);/);
});

test('tl-modal.js : une fermeture du studio SANS sauvegarde ("tl-close-modal") remet _tlEditingCartKey à null', () => {
  const closeCase = modalSrc.slice(
    modalSrc.indexOf("case 'tl-close-modal':"),
    modalSrc.indexOf("case 'tl-open-product-page':"),
  );
  assert.match(closeCase, /_tlEditingCartKey = null;/);
});

test('tl-modal.js : un ajout au panier confirmé retire l\'ancienne ligne modifiée via /cart/change.json (quantity 0)', () => {
  const start = modalSrc.indexOf("case 'tl-add-to-cart':");
  const end   = modalSrc.indexOf('default:', start);
  assert.ok(start > -1 && end > start, 'bornes du handler introuvables');
  const addCase = modalSrc.slice(start, end);
  assert.match(addCase, /if \(_tlEditingCartKey\) \{/);
  assert.match(addCase, /fetch\('\/cart\/change\.json', \{/);
  assert.match(addCase, /JSON\.stringify\(\{ id: _oldKey, quantity: 0 \}\)/);
  // La clé doit être consommée (remise à null) avant l'appel réseau, pas après,
  // pour qu'une fermeture concurrente ne la supprime pas deux fois.
  assert.match(addCase, /var _oldKey = _tlEditingCartKey;\s*\n\s*_tlEditingCartKey = null;/);
});
