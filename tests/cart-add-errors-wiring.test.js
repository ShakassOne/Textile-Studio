'use strict';

/**
 * Câblage source du tracking des refus /cart/add (backlog item 31) —
 * server.js (montage de la route + exemption checkSubscription),
 * routes/shop-settings.js (flag `cart_error_tracking_enabled`) et
 * public/tl-modal.js (appel au point de refus déjà détecté).
 * ──────────────────────────────────────────────────────────────────────────
 * Pas de DOM dans ces tests (pas de navigateur) : on vérifie la cohérence du
 * câblage source (regex sur le texte des fichiers), comme
 * tests/cart-edit-design.test.js / tests/panel-mode-studio.test.js.
 *
 * Ni routes/shop-settings.js ni server.js ne sont require()'és : les charger
 * ouvrirait la base de données / démarrerait le serveur (même raison que
 * tests/customer-token.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSrc   = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const settingsSrc = fs.readFileSync(path.join(__dirname, '../routes/shop-settings.js'), 'utf8');
const modalSrc     = fs.readFileSync(path.join(__dirname, '../public/tl-modal.js'), 'utf8');

const KEY = 'cart_error_tracking_enabled';

test('server.js : la route est montée sur /api/cart-add-errors', () => {
  assert.match(serverSrc, /app\.use\('\/api\/cart-add-errors',\s*require\('\.\/routes\/cart-add-errors'\)\)/);
});

test('server.js : /api/cart-add-errors/track est exemptée de checkSubscription', () => {
  assert.match(serverSrc, /'\/api\/cart-add-errors\/track'/);
});

test('routes/shop-settings.js : défaut activé (true)', () => {
  assert.match(settingsSrc, /CART_ERROR_TRACKING_DEFAULT\s*=\s*true/);
});

test('routes/shop-settings.js : GET /style renvoie le flag avec son défaut', () => {
  assert.match(
    settingsSrc,
    new RegExp(`${KEY}:\\s*readBoolSetting\\(req\\.shopId, '${KEY}', CART_ERROR_TRACKING_DEFAULT\\)`),
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
    new RegExp(`${KEY}:\\s*readBoolSetting\\(req\\.shopId, '${KEY}', CART_ERROR_TRACKING_DEFAULT\\)`),
  );
});

test('routes/shop-settings.js : pas exposé sur la route publique /style/public (comportement 100% serveur)', () => {
  const publicSection = settingsSrc.slice(settingsSrc.indexOf("router.get('/style/public'"));
  assert.doesNotMatch(publicSection, new RegExp(KEY));
});

test('tl-modal.js : _tlTrackCartError existe et utilise sendBeacon', () => {
  assert.match(modalSrc, /function _tlTrackCartError\(shop, variantId, reason\)/);
  assert.match(modalSrc, /\/api\/cart-add-errors\/track\?shop=/);
});

test('tl-modal.js : le refus panier appelle _tlTrackCartError avant l\'alert existante', () => {
  const idx = modalSrc.indexOf('err && err.panierRefuse');
  assert.ok(idx > -1, 'bloc panierRefuse introuvable');
  const section = modalSrc.slice(idx, idx + 600);
  assert.match(section, /_tlTrackCartError\(_errShop, _vid, err\.message\)/);
  assert.match(section, /alert\(/);
  assert.ok(section.indexOf('_tlTrackCartError') < section.indexOf('alert('),
    'le tracking doit être appelé avant l\'alert existante');
});

test('tl-modal.js : ne touche à aucun fichier gelé par le chantier "Bibliothèque de designs"', () => {
  const studioPath = path.join(__dirname, '../public/textilelab-studio.html');
  const editorPath = path.join(__dirname, '../public/tl-editor.js');
  const enginePath = path.join(__dirname, '../public/tsl-engine.js');
  for (const p of [studioPath, editorPath, enginePath]) {
    const src = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(src, /cart_error_tracking_enabled|_tlTrackCartError|cart-add-errors/);
  }
});
