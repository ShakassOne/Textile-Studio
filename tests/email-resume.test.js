'use strict';

/**
 * Lien de reprise par email pour le visiteur NON connecté (backlog item 25,
 * logique pure dans utils/email-resume.js, routée par
 * POST /api/designs/:id/email-resume-link dans routes/designs.js).
 * ──────────────────────────────────────────────────────────────────────────
 * Module sans dépendance DB : pas besoin du contournement DATA_DIR/better-
 * sqlite3 déjà documenté dans tests/design-resume.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { isValidEmail, designTokenOk, buildResumeEmailHtml } = require('../utils/email-resume');

test('isValidEmail — accepte une adresse bien formée', () => {
  assert.equal(isValidEmail('client@exemple.fr'), true);
});

test('isValidEmail — rejette une adresse sans @, sans domaine ou vide', () => {
  assert.equal(isValidEmail('pas-un-email'), false);
  assert.equal(isValidEmail('client@sansdomaine'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidEmail(undefined), false);
});

test('isValidEmail — tolère les espaces autour de l\'adresse', () => {
  assert.equal(isValidEmail('  client@exemple.fr  '), true);
});

test('designTokenOk — design introuvable : toujours refusé', () => {
  assert.equal(designTokenOk(null, 'peu-importe'), false);
});

test('designTokenOk — design legacy (edit_token NULL) : toujours accepté', () => {
  assert.equal(designTokenOk({ id: 1, edit_token: null }, ''), true);
  assert.equal(designTokenOk({ id: 1, edit_token: null }, 'autre-chose'), true);
});

test('designTokenOk — jeton correct accepté, jeton manquant ou faux refusé', () => {
  const row = { id: 1, edit_token: 'secret-123' };
  assert.equal(designTokenOk(row, 'secret-123'), true);
  assert.equal(designTokenOk(row, 'mauvais-jeton'), false);
  assert.equal(designTokenOk(row, ''), false);
  assert.equal(designTokenOk(row, undefined), false);
});

test('buildResumeEmailHtml — contient le lien fourni', () => {
  const link = 'https://app.exemple.com/textilelab-studio.html?design=42&shop=x.myshopify.com';
  const html = buildResumeEmailHtml(link);
  assert.ok(html.includes(link));
  assert.ok(html.includes('href="' + link + '"'));
});
