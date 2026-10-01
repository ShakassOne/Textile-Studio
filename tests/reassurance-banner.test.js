'use strict';

/**
 * Bandeau de réassurance (studio) — routes/shop-settings.js, textilelab-studio.html,
 * textilelab-admin.html.
 * ──────────────────────────────────────────────────────────────────────────
 * Le flag traverse 3 fichiers indépendants (backend + 2 pages statiques) sous
 * la même clé `reassurance_banner_enabled`. Un typo dans l'un des trois casse
 * le toggle silencieusement (le studio ne verrait jamais le changement admin,
 * ou l'admin écrirait une clé que le studio ne lit jamais). Ce test vérifie
 * la cohérence du câblage plutôt que le rendu (pas de DOM dans ces tests).
 *
 * routes/shop-settings.js n'est pas require()'é : le charger ouvrirait la
 * base de données (même raison que tests/customer-token.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const settingsSrc = fs.readFileSync(path.join(__dirname, '../routes/shop-settings.js'), 'utf8');
const studioSrc    = fs.readFileSync(path.join(__dirname, '../public/textilelab-studio.html'), 'utf8');
const adminSrc     = fs.readFileSync(path.join(__dirname, '../public/textilelab-admin.html'), 'utf8');

const KEY = 'reassurance_banner_enabled';

test('routes/shop-settings.js : défaut activé (true)', () => {
  assert.match(settingsSrc, /REASSURANCE_BANNER_DEFAULT\s*=\s*true/);
});

test('routes/shop-settings.js : GET /style renvoie le flag avec son défaut', () => {
  assert.match(
    settingsSrc,
    new RegExp(`${KEY}:\\s*readBoolSetting\\(req\\.shopId, '${KEY}', REASSURANCE_BANNER_DEFAULT\\)`),
  );
});

test('routes/shop-settings.js : POST /style écrit le flag (mise à jour partielle)', () => {
  assert.match(settingsSrc, new RegExp(`if \\('${KEY}' in body\\)`));
  assert.match(settingsSrc, new RegExp(`setSetting\\(req\\.shopId, '${KEY}'`));
});

test('routes/shop-settings.js : la route publique /style/public expose le flag, y compris en fallback (pas de shop / shop inconnu)', () => {
  // 3 occurrences attendues : fallback sans shop, fallback shop inconnu, cas nominal.
  const matches = settingsSrc.match(new RegExp(`${KEY}:\\s*(REASSURANCE_BANNER_DEFAULT|readBoolSetting\\(shopId, '${KEY}', REASSURANCE_BANNER_DEFAULT\\))`, 'g')) || [];
  assert.equal(matches.length, 3, `attendu 3 occurrences (2 fallback + 1 nominal), trouvé ${matches.length}`);
});

test('textilelab-studio.html : le bandeau existe, masqué par défaut dans le markup', () => {
  assert.match(studioSrc, /id="tl-reassurance-banner"[^>]*style="display:none/);
});

test('textilelab-studio.html : le bandeau n\'est révélé que si le flag public est actif', () => {
  assert.match(
    studioSrc,
    /cfg && cfg\.reassurance_banner_enabled\)\s*_banner\.style\.display\s*=\s*'block'/,
  );
});

test('textilelab-admin.html : le toggle admin poste exactement la clé lue par le studio', () => {
  assert.match(adminSrc, /id="reassurance-banner-toggle"/);
  assert.match(adminSrc, new RegExp(`body:\\s*JSON\\.stringify\\(\\{ ${KEY}: enabled \\}\\)`));
});

test('textilelab-admin.html : le toggle se charge depuis /api/shop-settings/style au démarrage', () => {
  assert.match(adminSrc, /loadReassuranceBanner\(\);/);
  assert.match(adminSrc, new RegExp(`_applyReassuranceBannerToggle\\(data \\? data\\.${KEY} !== false : true\\)`));
});
