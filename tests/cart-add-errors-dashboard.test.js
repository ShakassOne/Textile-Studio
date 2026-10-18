'use strict';

/**
 * Écran admin affichant les stats `cart_add_errors` (backlog item 36,
 * public/textilelab-admin.html uniquement).
 * ──────────────────────────────────────────────────────────────────────────
 * Spec du 17/10 18h (docs/ROADMAP-DEV.md §2) : `GET /api/cart-add-errors/stats`
 * existe déjà (backlog item 31, 14/10) mais rien ne l'affichait dans le
 * Dashboard admin — la seule façon de lire ce chiffre était un appel `curl`
 * manuel. V1 lean, copie conforme du pattern déjà posé pour les 4 tuiles
 * `.stat-card` existantes (`s-designs`/`s-library`/`s-mockups`/`s-categories`) :
 * 5ᵉ tuile `s-cart-errors` + 5ᵉ appel dans loadDashboard(). Lecture seule,
 * aucune nouvelle route serveur, pas de flag nécessaire (écran admin interne,
 * aucun changement de comportement client).
 *
 * Pas de DOM dans ces tests (pas de navigateur) : on vérifie la cohérence du
 * câblage source (regex sur le texte du fichier), même approche que
 * tests/admin-flag-toggles.test.js / tests/panel-mode-studio.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminSrc = fs.readFileSync(path.join(__dirname, '../public/textilelab-admin.html'), 'utf8');

test('textilelab-admin.html : 5e tuile stat-card "Refus panier silencieux" présente', () => {
  assert.match(adminSrc, /<div class="stat-value" id="s-cart-errors">—<\/div>/);
  assert.match(adminSrc, /<div class="stat-delta neutral" id="s-cart-errors-delta">—<\/div>/);
});

test('textilelab-admin.html : loadDashboard() appelle GET /api/cart-add-errors/stats?days=30', () => {
  const start = adminSrc.indexOf('async function loadDashboard()');
  assert.ok(start > -1, 'loadDashboard introuvable');
  const section = adminSrc.slice(start, start + 1500);
  assert.match(section, /api\('\/api\/cart-add-errors\/stats\?days=30'\)/);
});

test('textilelab-admin.html : loadDashboard() remplit s-cart-errors et s-cart-errors-delta depuis la réponse', () => {
  const start = adminSrc.indexOf('async function loadDashboard()');
  const section = adminSrc.slice(start, start + 1500);
  assert.match(section, /getElementById\('s-cart-errors'\)\.textContent\s*=\s*cartErrorsStats\?\.total/);
  assert.match(section, /getElementById\('s-cart-errors-delta'\)\.textContent/);
  assert.match(section, /topReasons\?\.\[0\]|topReasons\[0\]/);
});

test('ne touche à aucun fichier gelé par le chantier "Bibliothèque de designs"', () => {
  const studioPath = path.join(__dirname, '../public/textilelab-studio.html');
  const editorPath = path.join(__dirname, '../public/tl-editor.js');
  const enginePath = path.join(__dirname, '../public/tsl-engine.js');
  for (const p of [studioPath, editorPath, enginePath]) {
    const src = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(src, /s-cart-errors/);
  }
});
