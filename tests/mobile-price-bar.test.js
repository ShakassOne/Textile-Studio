'use strict';

/**
 * Barre de prix sticky mobile (studio) — routes/shop-settings.js,
 * textilelab-studio.html, textilelab-admin.html.
 * ──────────────────────────────────────────────────────────────────────────
 * Sur mobile le prix total (.stat-pill du topbar) est masqué en CSS
 * (`.stat-pill { display: none !important; }`) et aucun équivalent n'est
 * visible pendant la personnalisation hors ouverture d'un drawer — cette
 * barre comble ce trou, sous flag `mobile_price_bar_enabled` (désactivé par
 * défaut, changement de mise en page à valider sur un vrai mobile).
 *
 * Le flag traverse 3 fichiers indépendants (backend + 2 pages statiques)
 * sous la même clé. Ce test vérifie la cohérence du câblage plutôt que le
 * rendu (pas de DOM dans ces tests).
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

const KEY = 'mobile_price_bar_enabled';

test('routes/shop-settings.js : défaut désactivé (false)', () => {
  assert.match(settingsSrc, /MOBILE_PRICE_BAR_DEFAULT\s*=\s*false/);
});

test('routes/shop-settings.js : GET /style renvoie le flag avec son défaut', () => {
  assert.match(
    settingsSrc,
    new RegExp(`${KEY}:\\s*readBoolSetting\\(req\\.shopId, '${KEY}', MOBILE_PRICE_BAR_DEFAULT\\)`),
  );
});

test('routes/shop-settings.js : POST /style écrit le flag (mise à jour partielle)', () => {
  assert.match(settingsSrc, new RegExp(`if \\('${KEY}' in body\\)`));
  assert.match(settingsSrc, new RegExp(`setSetting\\(req\\.shopId, '${KEY}'`));
});

test('routes/shop-settings.js : la route publique /style/public expose le flag, y compris en fallback (pas de shop / shop inconnu)', () => {
  // 3 occurrences attendues : fallback sans shop, fallback shop inconnu, cas nominal.
  const matches = settingsSrc.match(new RegExp(`${KEY}:\\s*(MOBILE_PRICE_BAR_DEFAULT|readBoolSetting\\(shopId, '${KEY}', MOBILE_PRICE_BAR_DEFAULT\\))`, 'g')) || [];
  assert.equal(matches.length, 3, `attendu 3 occurrences (2 fallback + 1 nominal), trouvé ${matches.length}`);
});

test('textilelab-studio.html : la barre existe, masquée par défaut dans le markup', () => {
  assert.match(studioSrc, /id="mobile-price-bar"[^>]*style="display:none"/);
});

test('textilelab-studio.html : le total y est synchronisé par updatePrice()', () => {
  assert.match(studioSrc, /id="stat-price-mobile"/);
  assert.match(studioSrc, /getElementById\('stat-price-mobile'\)/);
});

test('textilelab-studio.html : la barre n\'est révélée que si le flag public est actif, et uniquement sur mobile', () => {
  assert.match(
    studioSrc,
    /cfg && cfg\.mobile_price_bar_enabled && window\.innerWidth <= 768/,
  );
});

test('textilelab-admin.html : le toggle admin poste exactement la clé lue par le studio', () => {
  assert.match(adminSrc, /id="mobile-price-bar-toggle"/);
  assert.match(adminSrc, new RegExp(`body:\\s*JSON\\.stringify\\(\\{ ${KEY}: enabled \\}\\)`));
});

test('textilelab-admin.html : le toggle se charge depuis /api/shop-settings/style au démarrage', () => {
  assert.match(adminSrc, /loadMobilePriceBar\(\);/);
  assert.match(adminSrc, new RegExp(`_applyMobilePriceBarToggle\\(!!\\(data && data\\.${KEY}\\)\\)`));
});
