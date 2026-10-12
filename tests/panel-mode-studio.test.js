'use strict';

/**
 * Panneau partiel desktop pour le studio, au lieu du plein écran opaque
 * (backlog item 23) — routes/shop-settings.js (flag `panel_mode_studio_enabled`)
 * + public/tl-modal.js.
 * ──────────────────────────────────────────────────────────────────────────
 * V1 lean : pur CSS/dimensionnement dans tl-modal.js (fichier non gelé), ne
 * touche ni textilelab-studio.html ni tl-editor.js ni tsl-engine.js (fichiers
 * gelés par le chantier parallèle "Bibliothèque de designs"). Desktop
 * uniquement (media query min-width: 769px) — mobile toujours en plein écran
 * par construction, aucune condition JS supplémentaire nécessaire côté mobile.
 *
 * Pas de DOM dans ces tests (pas de navigateur) : on vérifie la cohérence du
 * câblage source (regex sur le texte des fichiers), comme
 * tests/cart-edit-design.test.js / tests/mobile-price-bar.test.js.
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

const KEY = 'panel_mode_studio_enabled';

test('routes/shop-settings.js : défaut désactivé (false)', () => {
  assert.match(settingsSrc, /PANEL_MODE_STUDIO_DEFAULT\s*=\s*false/);
});

test('routes/shop-settings.js : GET /style renvoie le flag avec son défaut', () => {
  assert.match(
    settingsSrc,
    new RegExp(`${KEY}:\\s*readBoolSetting\\(req\\.shopId, '${KEY}', PANEL_MODE_STUDIO_DEFAULT\\)`),
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
    new RegExp(`${KEY}:\\s*readBoolSetting\\(req\\.shopId, '${KEY}', PANEL_MODE_STUDIO_DEFAULT\\)`),
  );
});

test('routes/shop-settings.js : la route publique /style/public expose le flag, y compris en fallback (pas de shop / shop inconnu)', () => {
  // 3 occurrences attendues : fallback sans shop, fallback shop inconnu, cas nominal.
  const matches = settingsSrc.match(
    new RegExp(`${KEY}:\\s*(PANEL_MODE_STUDIO_DEFAULT|readBoolSetting\\(shopId, '${KEY}', PANEL_MODE_STUDIO_DEFAULT\\))`, 'g'),
  ) || [];
  assert.equal(matches.length, 3, `attendu 3 occurrences (2 fallback + 1 nominal), trouvé ${matches.length}`);
});

test('tl-modal.js : le flag est lu depuis /style/public dans _tlLoadStyleSettings', () => {
  assert.match(modalSrc, /_TL_PANEL_MODE_STUDIO_ENABLED = !!data\.panel_mode_studio_enabled;/);
});

test('tl-modal.js : la media query desktop cible bien #tl-modal-overlay.tl-panel-mode et son iframe', () => {
  assert.match(modalSrc, /@media \(min-width: 769px\) \{/);
  assert.match(modalSrc, /#tl-modal-overlay\.tl-panel-mode \{/);
  assert.match(modalSrc, /#tl-modal-overlay\.tl-panel-mode #tl-modal-iframe \{/);
  assert.match(modalSrc, /backdrop-filter: blur\(4px\);/);
  assert.match(modalSrc, /width: 90vw;/);
  assert.match(modalSrc, /height: 90vh;/);
});

test('tl-modal.js : openModal() n\'active le mode panneau que si le flag est actif ET window.innerWidth > 768', () => {
  const start = modalSrc.indexOf('function openModal(editorUrl)');
  const end   = modalSrc.indexOf('// ── Fermeture du modal');
  assert.ok(start > -1 && end > start, 'bornes de fonction introuvables');
  const openSection = modalSrc.slice(start, end);
  assert.match(
    openSection,
    /if \(_TL_PANEL_MODE_STUDIO_ENABLED && window\.innerWidth > 768\) \{\s*\n\s*overlay\.classList\.add\('tl-panel-mode'\);/,
  );
});

test('tl-modal.js : closeModal() retire systématiquement la classe tl-panel-mode', () => {
  const start = modalSrc.indexOf('function closeModal()');
  const end   = modalSrc.indexOf('// ── Mise à jour des sections Shopify');
  assert.ok(start > -1 && end > start, 'bornes de fonction introuvables');
  const closeSection = modalSrc.slice(start, end);
  assert.match(closeSection, /overlay\.classList\.remove\('tl-panel-mode'\);/);
});

test('tl-modal.js : ne touche à aucun fichier gelé par le chantier "Bibliothèque de designs"', () => {
  const studioPath = path.join(__dirname, '../public/textilelab-studio.html');
  const editorPath = path.join(__dirname, '../public/tl-editor.js');
  const enginePath = path.join(__dirname, '../public/tsl-engine.js');
  for (const p of [studioPath, editorPath, enginePath]) {
    const src = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(src, /panel_mode_studio_enabled|tl-panel-mode|_TL_PANEL_MODE_STUDIO_ENABLED/);
  }
});
