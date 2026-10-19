'use strict';

/**
 * "Ajouter un 2e exemplaire identique" (backlog item 33, spec de repli du
 * 15/10) — routes/shop-settings.js (flag `same_design_second_unit_enabled`)
 * + public/tl-modal.js.
 * ──────────────────────────────────────────────────────────────────────────
 * Spec de repli (sans le point bloquant trouvé le 15/10 sur la V1 originale) :
 * aucune API panier Shopify ni aucun code de ce dépôt ne sait créer/piloter
 * une remise réelle — cette version ne calcule ni n'affiche AUCUN pourcentage,
 * seulement une 2e ligne panier avec la MÊME variante/properties que l'ajout
 * qui vient d'avoir lieu (pas une autre taille, qui reste l'item 32 séparé).
 * Réutilise tel quel le correctif de détection de refus posé le 15/10 sur
 * _tlInjectOtherSizeOffer. Aucune nouvelle route serveur, aucun fichier gelé
 * (textilelab-studio.html/tl-editor.js/tsl-engine.js).
 *
 * Pas de DOM dans ces tests (pas de navigateur) : on vérifie la cohérence du
 * câblage source (regex sur le texte des fichiers), comme
 * tests/same-design-other-size.test.js.
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

const KEY = 'same_design_second_unit_enabled';

test('routes/shop-settings.js : défaut désactivé (false)', () => {
  assert.match(settingsSrc, /SAME_DESIGN_SECOND_UNIT_DEFAULT\s*=\s*false/);
});

test('routes/shop-settings.js : GET /style renvoie le flag avec son défaut', () => {
  assert.match(
    settingsSrc,
    new RegExp(`${KEY}:\\s*readBoolSetting\\(req\\.shopId, '${KEY}', SAME_DESIGN_SECOND_UNIT_DEFAULT\\)`),
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
    new RegExp(`${KEY}:\\s*readBoolSetting\\(req\\.shopId, '${KEY}', SAME_DESIGN_SECOND_UNIT_DEFAULT\\)`),
  );
});

test('routes/shop-settings.js : la route publique /style/public expose le flag, y compris en fallback (pas de shop / shop inconnu)', () => {
  // 3 occurrences attendues : fallback sans shop, fallback shop inconnu, cas nominal.
  const matches = settingsSrc.match(
    new RegExp(`${KEY}:\\s*(SAME_DESIGN_SECOND_UNIT_DEFAULT|readBoolSetting\\(shopId, '${KEY}', SAME_DESIGN_SECOND_UNIT_DEFAULT\\))`, 'g'),
  ) || [];
  assert.equal(matches.length, 3, `attendu 3 occurrences (2 fallback + 1 nominal), trouvé ${matches.length}`);
});

test('tl-modal.js : le flag est lu depuis /style/public dans _tlLoadStyleSettings', () => {
  assert.match(modalSrc, /_TL_SAME_DESIGN_SECOND_UNIT_ENABLED = !!data\.same_design_second_unit_enabled;/);
});

test('tl-modal.js : _tlOfferSecondUnit() est appelée après _tlOfferOtherSize (handler tl-add-to-cart)', () => {
  const start = modalSrc.indexOf("case 'tl-add-to-cart': {");
  const end   = modalSrc.indexOf("} else if (e.data.cartUrl)");
  assert.ok(start > -1 && end > start, 'bornes du handler introuvables');
  const handlerSection = modalSrc.slice(start, end);
  assert.match(handlerSection, /_tlOfferOtherSize\(_vid, _props, _previewUrl\);/);
  assert.match(handlerSection, /_tlOfferSecondUnit\(_vid, _props, _previewUrl\);/);
  assert.ok(
    handlerSection.indexOf('_tlOfferOtherSize(_vid, _props, _previewUrl);') < handlerSection.indexOf('_tlOfferSecondUnit(_vid, _props, _previewUrl);'),
    "l'offre 2e exemplaire doit être proposée après l'offre autre taille",
  );
});

test('tl-modal.js : _tlOfferSecondUnit() ne fait rien si le flag est désactivé ou sans variantId', () => {
  const start = modalSrc.indexOf('function _tlOfferSecondUnit(');
  assert.ok(start > -1, 'fonction introuvable');
  const section = modalSrc.slice(start, start + 600);
  assert.match(section, /if \(!_TL_SAME_DESIGN_SECOND_UNIT_ENABLED \|\| !vid\) return;/);
});

test('tl-modal.js : le clic sur "Ajouter un 2e exemplaire" pose une 2e ligne panier sur la MÊME variante (pas une autre taille), sans aucun pourcentage de remise', () => {
  const start = modalSrc.indexOf('function _tlInjectSecondUnitOffer(');
  assert.ok(start > -1, 'fonction introuvable');
  const section = modalSrc.slice(start, start + 2600);
  assert.match(section, /fetch\('\/cart\/add\.json', \{/);
  assert.match(section, /body: JSON\.stringify\(\{ items: \[\{ id: vid, quantity: 1, properties: props \}\] \}\),/);
  assert.doesNotMatch(section, /%|discount|remise/i);
});

test('tl-modal.js : CSS de la famille .tl-second-unit injecté (même famille visuelle que .tl-other-size), classe racine distincte', () => {
  assert.match(modalSrc, /\.tl-second-unit \{/);
  assert.match(modalSrc, /TL_SECOND_UNIT_CSS/);
  assert.match(modalSrc, /\+ TL_SECOND_UNIT_CSS \+/);
});

test('tl-modal.js : le clic ne traite pas un refus Shopify (422/HTTP non-ok) comme un succès (réutilise le correctif du 15/10)', () => {
  const start = modalSrc.indexOf('function _tlInjectSecondUnitOffer(');
  const end   = modalSrc.indexOf('var fermer = document.createElement', start);
  assert.ok(start > -1 && end > start, 'bornes de fonction introuvables');
  const section = modalSrc.slice(start, end);
  assert.match(section, /!r\.ok \|\| !data \|\| data\.status >= 400/);
  assert.match(section, /err\.panierRefuse = true;/);
  assert.match(section, /b\.disabled = false;/);
  assert.match(section, /_tlTrackCartError\(shop, vid,/);
  assert.match(section, /tl-second-unit-msg/);
});

test('tl-modal.js : les 2 encarts (.tl-other-size et .tl-second-unit) utilisent des classes racines distinctes, pour pouvoir coexister sans que l\'un efface l\'autre', () => {
  const start = modalSrc.indexOf('function _tlInjectSecondUnitOffer(');
  const section = modalSrc.slice(start, start + 400);
  assert.match(section, /document\.querySelector\('\.tl-second-unit'\)/);
  assert.doesNotMatch(section, /document\.querySelector\('\.tl-other-size'\)/);
});

test('tl-modal.js : ne touche à aucun fichier gelé par le chantier "Bibliothèque de designs"', () => {
  const studioPath = path.join(__dirname, '../public/textilelab-studio.html');
  const editorPath = path.join(__dirname, '../public/tl-editor.js');
  const enginePath = path.join(__dirname, '../public/tsl-engine.js');
  for (const p of [studioPath, editorPath, enginePath]) {
    const src = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(src, /same_design_second_unit_enabled|tl-second-unit|_TL_SAME_DESIGN_SECOND_UNIT_ENABLED/);
  }
});
