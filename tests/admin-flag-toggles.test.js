'use strict';

/**
 * Interrupteurs Admin pour les flags déjà livrés mais encore invisibles de
 * l'écran Paramètres (backlog items 29 et 34) — public/textilelab-admin.html
 * uniquement.
 * ──────────────────────────────────────────────────────────────────────────
 * resume_design_enabled / email_resume_enabled / cart_edit_design_enabled /
 * panel_mode_studio_enabled (item 29) puis same_design_other_size_enabled /
 * same_design_second_unit_enabled (item 34, 17/10) étaient pilotables
 * uniquement via POST /api/shop-settings/style en direct : 0 occurrence de
 * ces noms de flag dans ce fichier avant ces lots. V1 lean : reproduit à
 * l'identique le triplet HTML/JS déjà posé pour reassurance_banner_enabled/
 * mobile_price_bar_enabled/social_proof_enabled/ai_generic_identity_prompt_enabled
 * — pas de nouvelle route, pas de nouvelle colonne, ces flags sont déjà
 * lus/écrits par routes/shop-settings.js (voir panel-mode-studio.test.js,
 * cart-edit-design.test.js, email-resume.test.js, design-resume.test.js,
 * same-design-other-size.test.js, same-design-second-unit.test.js pour la
 * couverture backend de chacun).
 *
 * Pas de DOM dans ces tests (pas de navigateur) : on vérifie la cohérence du
 * câblage source (regex sur le texte du fichier), même approche que
 * tests/panel-mode-studio.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminSrc = fs.readFileSync(path.join(__dirname, '../public/textilelab-admin.html'), 'utf8');

const FLAGS = [
  { key: 'resume_design_enabled', id: 'resume-design', fn: 'ResumeDesign' },
  { key: 'email_resume_enabled', id: 'email-resume', fn: 'EmailResume' },
  { key: 'cart_edit_design_enabled', id: 'cart-edit-design', fn: 'CartEditDesign' },
  { key: 'panel_mode_studio_enabled', id: 'panel-mode-studio', fn: 'PanelModeStudio' },
  { key: 'same_design_other_size_enabled', id: 'same-design-other-size', fn: 'SameDesignOtherSize' },
  { key: 'same_design_second_unit_enabled', id: 'same-design-second-unit', fn: 'SameDesignSecondUnit' },
];

for (const { key, id, fn } of FLAGS) {
  test(`textilelab-admin.html : case à cocher ${id}-toggle présente et câblée`, () => {
    assert.match(adminSrc, new RegExp(`<input type="checkbox" id="${id}-toggle" onchange="_apply${fn}Toggle\\(this\\.checked\\)">`));
  });

  test(`textilelab-admin.html : bouton Enregistrer et span résultat/état pour ${id}`, () => {
    assert.match(adminSrc, new RegExp(`id="${id}-state"`));
    assert.match(adminSrc, new RegExp(`onclick="save${fn}\\(\\)"`));
    assert.match(adminSrc, new RegExp(`id="${id}-result"`));
  });

  test(`textilelab-admin.html : triplet JS _apply${fn}Toggle/load${fn}/save${fn} présent`, () => {
    assert.match(adminSrc, new RegExp(`function _apply${fn}Toggle\\(enabled\\)`));
    assert.match(adminSrc, new RegExp(`async function load${fn}\\(\\)`));
    assert.match(adminSrc, new RegExp(`async function save${fn}\\(\\)`));
  });

  test(`textilelab-admin.html : save${fn} envoie bien le flag ${key} à POST /api/shop-settings/style`, () => {
    const start = adminSrc.indexOf(`async function save${fn}()`);
    assert.ok(start > -1, `save${fn} introuvable`);
    const section = adminSrc.slice(start, start + 800);
    assert.match(section, new RegExp(`body:\\s*JSON\\.stringify\\(\\{ ${key}: enabled \\}\\)`));
  });

  test(`textilelab-admin.html : load${fn}() est appelé à l'initialisation des réglages`, () => {
    const initStart = adminSrc.indexOf('async function loadSettingsInfo()');
    const initEnd = adminSrc.indexOf('const [aiStatus, shopStatus]');
    assert.ok(initStart > -1 && initEnd > initStart, 'bornes de loadSettingsInfo introuvables');
    const initSection = adminSrc.slice(initStart, initEnd);
    assert.match(initSection, new RegExp(`load${fn}\\(\\);`));
  });
}

test('textilelab-admin.html : zéro nouvelle route, les 4 flags passent par /api/shop-settings/style existant', () => {
  const matches = adminSrc.match(/\/api\/shop-settings\/style/g) || [];
  assert.ok(matches.length >= FLAGS.length, 'les 4 saveXxx doivent réutiliser la route existante');
});

test('ne touche à aucun fichier gelé par le chantier "Bibliothèque de designs"', () => {
  const studioPath = path.join(__dirname, '../public/textilelab-studio.html');
  const editorPath = path.join(__dirname, '../public/tl-editor.js');
  const enginePath = path.join(__dirname, '../public/tsl-engine.js');
  for (const p of [studioPath, editorPath, enginePath]) {
    const src = fs.readFileSync(p, 'utf8');
    for (const { id, fn } of FLAGS) {
      assert.doesNotMatch(src, new RegExp(`${id}-toggle|_apply${fn}Toggle`));
    }
  }
});
