'use strict';

/**
 * Même création, dans une autre taille, sans repasser par le studio
 * (backlog item 32) — routes/shop-settings.js (flag
 * `same_design_other_size_enabled`) + public/tl-modal.js.
 * ──────────────────────────────────────────────────────────────────────────
 * V1 lean (spec affinée le 14/10, prête à coder sans nouvelle décision) :
 * réutilise 3 briques déjà existantes et non gelées dans tl-modal.js
 * (_tlBtnProduct, _tlVariantesDeBase, le fetch /products/<handle>.js déjà
 * posé pour l'upsell) + le pipeline /cart/add.json déjà en place dans le
 * handler 'tl-add-to-cart'. Aucune nouvelle route serveur, aucun fichier
 * gelé (textilelab-studio.html/tl-editor.js/tsl-engine.js).
 *
 * Pas de DOM dans ces tests (pas de navigateur) : on vérifie la cohérence du
 * câblage source (regex sur le texte des fichiers), comme
 * tests/panel-mode-studio.test.js / tests/cart-edit-design.test.js.
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

const KEY = 'same_design_other_size_enabled';

test('routes/shop-settings.js : défaut désactivé (false)', () => {
  assert.match(settingsSrc, /SAME_DESIGN_OTHER_SIZE_DEFAULT\s*=\s*false/);
});

test('routes/shop-settings.js : GET /style renvoie le flag avec son défaut', () => {
  assert.match(
    settingsSrc,
    new RegExp(`${KEY}:\\s*readBoolSetting\\(req\\.shopId, '${KEY}', SAME_DESIGN_OTHER_SIZE_DEFAULT\\)`),
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
    new RegExp(`${KEY}:\\s*readBoolSetting\\(req\\.shopId, '${KEY}', SAME_DESIGN_OTHER_SIZE_DEFAULT\\)`),
  );
});

test('routes/shop-settings.js : la route publique /style/public expose le flag, y compris en fallback (pas de shop / shop inconnu)', () => {
  // 3 occurrences attendues : fallback sans shop, fallback shop inconnu, cas nominal.
  const matches = settingsSrc.match(
    new RegExp(`${KEY}:\\s*(SAME_DESIGN_OTHER_SIZE_DEFAULT|readBoolSetting\\(shopId, '${KEY}', SAME_DESIGN_OTHER_SIZE_DEFAULT\\))`, 'g'),
  ) || [];
  assert.equal(matches.length, 3, `attendu 3 occurrences (2 fallback + 1 nominal), trouvé ${matches.length}`);
});

test('tl-modal.js : le flag est lu depuis /style/public dans _tlLoadStyleSettings', () => {
  assert.match(modalSrc, /_TL_SAME_DESIGN_OTHER_SIZE_ENABLED = !!data\.same_design_other_size_enabled;/);
});

test('tl-modal.js : _tlOfferOtherSize() est appelée après un ajout au panier réussi (handler tl-add-to-cart)', () => {
  const start = modalSrc.indexOf("case 'tl-add-to-cart': {");
  const end   = modalSrc.indexOf("} else if (e.data.cartUrl)");
  assert.ok(start > -1 && end > start, 'bornes du handler introuvables');
  const handlerSection = modalSrc.slice(start, end);
  assert.match(handlerSection, /_tlProposerUpsell\(e\.data\);/);
  assert.match(handlerSection, /_tlOfferOtherSize\(_vid, _props, _previewUrl\);/);
  // L'appel doit suivre _tlProposerUpsell, pas le précéder (ordre des étapes).
  assert.ok(
    handlerSection.indexOf('_tlProposerUpsell(e.data);') < handlerSection.indexOf('_tlOfferOtherSize(_vid, _props, _previewUrl);'),
    'l\'offre autre taille doit être proposée après les suggestions upsell',
  );
});

test('tl-modal.js : _tlOfferOtherSize() ne fait rien si le flag est désactivé ou sans variantId', () => {
  const start = modalSrc.indexOf('function _tlOfferOtherSize(');
  assert.ok(start > -1, 'fonction introuvable');
  const section = modalSrc.slice(start, start + 600);
  assert.match(section, /if \(!_TL_SAME_DESIGN_OTHER_SIZE_ENABLED \|\| !vid\) return;/);
});

test('tl-modal.js : les autres tailles proposées excluent la variante déjà ajoutée et les variantes épuisées', () => {
  const start = modalSrc.indexOf('function _tlOfferOtherSize(');
  const end   = modalSrc.indexOf('function _tlInjectOtherSizeOffer(');
  assert.ok(start > -1 && end > start, 'bornes de fonction introuvables');
  const section = modalSrc.slice(start, end);
  assert.match(section, /_tlVariantesDeBase\(d\)\.filter\(function \(v\) \{/);
  assert.match(section, /v\.id !== vidNum && v\.dispo !== false/);
  assert.match(section, /\.slice\(0, 2\)/);
});

test('tl-modal.js : le clic sur une taille pose une 2e ligne panier avec les mêmes properties (même _design_id/_preview_img)', () => {
  const start = modalSrc.indexOf('function _tlInjectOtherSizeOffer(');
  assert.ok(start > -1, 'fonction introuvable');
  const section = modalSrc.slice(start, start + 2500);
  assert.match(section, /fetch\('\/cart\/add\.json', \{/);
  assert.match(section, /body: JSON\.stringify\(\{ items: \[\{ id: v\.id, quantity: 1, properties: props \}\] \}\),/);
});

test('tl-modal.js : CSS de la famille .tl-other-size injecté (même famille visuelle que .tl-resume/.tl-email-resume)', () => {
  assert.match(modalSrc, /\.tl-other-size \{/);
  assert.match(modalSrc, /TL_OTHER_SIZE_CSS/);
  assert.match(modalSrc, /\+ TL_OTHER_SIZE_CSS \+/);
});

test('tl-modal.js : ne touche à aucun fichier gelé par le chantier "Bibliothèque de designs"', () => {
  const studioPath = path.join(__dirname, '../public/textilelab-studio.html');
  const editorPath = path.join(__dirname, '../public/tl-editor.js');
  const enginePath = path.join(__dirname, '../public/tsl-engine.js');
  for (const p of [studioPath, editorPath, enginePath]) {
    const src = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(src, /same_design_other_size_enabled|tl-other-size|_TL_SAME_DESIGN_OTHER_SIZE_ENABLED/);
  }
});
