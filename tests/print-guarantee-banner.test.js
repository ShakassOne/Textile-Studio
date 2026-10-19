'use strict';

/**
 * Bandeau de confiance "défaut d'impression refait gratuitement" (backlog
 * item 37) — routes/shop-settings.js (flag `print_guarantee_banner_enabled`)
 * + public/tl-modal.js.
 * ──────────────────────────────────────────────────────────────────────────
 * Affiché juste après un ajout au panier réussi (étape 9 du handler
 * tl-add-to-cart, après _tlOfferSecondUnit — item 33). Texte placeholder
 * ("✅ Un souci avec l'impression ? On la refait gratuitement."), à relire/
 * ajuster avec Alan selon la politique réelle de WinShirt avant activation —
 * flag désactivé par défaut. Pur affichage, aucun bouton ni appel réseau
 * (contrairement aux encarts "autre taille"/"2e exemplaire"). Aucune
 * nouvelle route serveur, aucun fichier gelé (textilelab-studio.html/
 * tl-editor.js/tsl-engine.js).
 *
 * Pas de DOM dans ces tests (pas de navigateur) : on vérifie la cohérence du
 * câblage source (regex sur le texte des fichiers), comme
 * tests/same-design-second-unit.test.js.
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

const KEY = 'print_guarantee_banner_enabled';

test('routes/shop-settings.js : défaut désactivé (false)', () => {
  assert.match(settingsSrc, /PRINT_GUARANTEE_BANNER_DEFAULT\s*=\s*false/);
});

test('routes/shop-settings.js : GET /style renvoie le flag avec son défaut', () => {
  assert.match(
    settingsSrc,
    new RegExp(`${KEY}:\\s*readBoolSetting\\(req\\.shopId, '${KEY}', PRINT_GUARANTEE_BANNER_DEFAULT\\)`),
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
    new RegExp(`${KEY}:\\s*readBoolSetting\\(req\\.shopId, '${KEY}', PRINT_GUARANTEE_BANNER_DEFAULT\\)`),
  );
});

test('routes/shop-settings.js : la route publique /style/public expose le flag, y compris en fallback (pas de shop / shop inconnu)', () => {
  // 3 occurrences attendues : fallback sans shop, fallback shop inconnu, cas nominal.
  const matches = settingsSrc.match(
    new RegExp(`${KEY}:\\s*(PRINT_GUARANTEE_BANNER_DEFAULT|readBoolSetting\\(shopId, '${KEY}', PRINT_GUARANTEE_BANNER_DEFAULT\\))`, 'g'),
  ) || [];
  assert.equal(matches.length, 3, `attendu 3 occurrences (2 fallback + 1 nominal), trouvé ${matches.length}`);
});

test('tl-modal.js : le flag est lu depuis /style/public dans _tlLoadStyleSettings', () => {
  assert.match(modalSrc, /_TL_PRINT_GUARANTEE_BANNER_ENABLED = !!data\.print_guarantee_banner_enabled;/);
});

test('tl-modal.js : _tlShowPrintGuaranteeBanner() est appelée après _tlOfferSecondUnit (étape 9, handler tl-add-to-cart)', () => {
  const start = modalSrc.indexOf("case 'tl-add-to-cart': {");
  const end   = modalSrc.indexOf('} else if (e.data.cartUrl)');
  assert.ok(start > -1 && end > start, 'bornes du handler introuvables');
  const handlerSection = modalSrc.slice(start, end);
  assert.match(handlerSection, /_tlOfferSecondUnit\(_vid, _props, _previewUrl\);/);
  assert.match(handlerSection, /_tlShowPrintGuaranteeBanner\(\);/);
  assert.ok(
    handlerSection.indexOf('_tlOfferSecondUnit(_vid, _props, _previewUrl);') < handlerSection.indexOf('_tlShowPrintGuaranteeBanner();'),
    'le bandeau de garantie doit être affiché après l\'offre 2e exemplaire',
  );
});

test('tl-modal.js : _tlShowPrintGuaranteeBanner() ne fait rien si le flag est désactivé ou sans bouton ancre', () => {
  const start = modalSrc.indexOf('function _tlShowPrintGuaranteeBanner(');
  assert.ok(start > -1, 'fonction introuvable');
  const section = modalSrc.slice(start, start + 500);
  assert.match(section, /if \(!_TL_PRINT_GUARANTEE_BANNER_ENABLED\) return;/);
  assert.match(section, /document\.querySelector\('\.tl-personalise-btn'\)/);
  assert.match(section, /if \(!btn\) return;/);
});

test('tl-modal.js : le bandeau est un pur affichage, sans bouton ni appel réseau', () => {
  const start = modalSrc.indexOf('function _tlShowPrintGuaranteeBanner(');
  const end   = modalSrc.indexOf('\n  }', start) + 4;
  assert.ok(start > -1 && end > start, 'bornes de fonction introuvables');
  const section = modalSrc.slice(start, end);
  assert.doesNotMatch(section, /fetch\(/);
  assert.doesNotMatch(section, /createElement\('button'\)/);
  assert.match(section, /tl-print-guarantee/);
  assert.match(section, /Un souci avec l\\'impression \? On la refait gratuitement\./);
});

test('tl-modal.js : évite tout doublon si le client ajoute plusieurs fois (retire l\'instance précédente)', () => {
  const start = modalSrc.indexOf('function _tlShowPrintGuaranteeBanner(');
  const section = modalSrc.slice(start, start + 500);
  assert.match(section, /document\.querySelector\('\.tl-print-guarantee'\)/);
});

test('tl-modal.js : CSS .tl-print-guarantee injecté dans TL_STYLES', () => {
  assert.match(modalSrc, /\.tl-print-guarantee \{/);
  assert.match(modalSrc, /TL_PRINT_GUARANTEE_CSS/);
  assert.match(modalSrc, /\+ TL_PRINT_GUARANTEE_CSS \+/);
});

test('tl-modal.js : ne touche à aucun fichier gelé par le chantier "Bibliothèque de designs"', () => {
  const studioPath = path.join(__dirname, '../public/textilelab-studio.html');
  const editorPath = path.join(__dirname, '../public/tl-editor.js');
  const enginePath = path.join(__dirname, '../public/tsl-engine.js');
  for (const p of [studioPath, editorPath, enginePath]) {
    const src = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(src, /print_guarantee_banner_enabled|tl-print-guarantee|_TL_PRINT_GUARANTEE_BANNER_ENABLED/);
  }
});
