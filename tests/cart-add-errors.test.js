'use strict';

/**
 * Tracking des refus silencieux de /cart/add (backlog item 31)
 * (logique pure dans utils/cart-add-errors.js, routée par routes/cart-add-errors.js).
 * ──────────────────────────────────────────────────────────────────────────
 * Spec du 13/10 18h (docs/ROADMAP-DEV.md §2) : objectiver le point P0 (trou
 * paiement commencé → commande) sans dépendre d'un accès live à Shopify
 * Analytics — copie conforme du pattern déjà posé pour le tracking upsell
 * (tests/upsell-candidates.test.js).
 *
 * DATA_DIR pointe vers un dossier temporaire créé pour ce test, avant tout
 * require() de db/database.js : la DB réelle du projet n'est jamais ouverte.
 *
 * On teste utils/cart-add-errors.js directement plutôt que
 * routes/cart-add-errors.js : requérir la route chargerait routes/auth.js,
 * qui pose un setInterval de nettoyage de sessions au require() —
 * incompatible avec `node --test` (même raison que les autres suites).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsl-cart-add-errors-test-'));
process.env.DATA_DIR = tmpDir;

// better-sqlite3 est un module natif : si le binaire compilé ne correspond pas
// à la version de Node de la machine, require() lève. Un échec d'ENVIRONNEMENT
// ne doit pas se confondre avec un échec de code (voir tests/upsell-candidates.test.js).
let initDB, db, sqliteIndisponible = null;
try {
  ({ initDB } = require('../db/database'));
  db = initDB();
} catch (e) {
  sqliteIndisponible = e.message.split('\n')[0];
}

if (sqliteIndisponible) {
  test('cart_add_errors — ignoré : better-sqlite3 indisponible sur cette machine',
    { skip: `binaire natif illisible (${sqliteIndisponible}) — lancez \`npm rebuild better-sqlite3\`` },
    () => {});
} else {
  const { logError: logErrorRaw, stats: statsRaw } = require('../utils/cart-add-errors');

  const logError = (shopId, body) => logErrorRaw(db, shopId, body);
  const stats    = (shopId, days) => statsRaw(db, shopId, days);

  function makeShop(domain) {
    return db.prepare('INSERT INTO shops (shop_domain) VALUES (?)').run(domain).lastInsertRowid;
  }

  test.after(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('logError enregistre un refus et stats le compte', () => {
    const shopId = makeShop('shop-a.myshopify.com');
    assert.deepEqual(
      logError(shopId, { variantId: '123', reason: 'Variant not available' }),
      { ok: true },
    );
    const s = stats(shopId);
    assert.equal(s.total, 1);
    assert.deepEqual(s.topReasons, [{ reason: 'Variant not available', n: 1 }]);
  });

  test('logError accepte un body sans variantId/reason (jamais bloquant)', () => {
    const shopId = makeShop('shop-b.myshopify.com');
    assert.deepEqual(logError(shopId, {}), { ok: true });
    assert.equal(stats(shopId).total, 1);
  });

  test('stats ne traverse pas les boutiques', () => {
    const a = makeShop('shop-c.myshopify.com');
    const b = makeShop('shop-d.myshopify.com');
    logError(a, { variantId: '1', reason: 'x' });
    assert.equal(stats(a).total, 1);
    assert.equal(stats(b).total, 0);
  });

  test('stats sans aucun refus : total 0, aucune erreur', () => {
    const shopId = makeShop('shop-e.myshopify.com');
    assert.deepEqual(stats(shopId), { total: 0, topReasons: [] });
  });

  test('stats respecte la fenêtre de jours demandée', () => {
    const shopId = makeShop('shop-f.myshopify.com');
    logError(shopId, { variantId: '1', reason: 'x' });
    db.prepare(
      "UPDATE cart_add_errors SET created_at = datetime('now', '-40 days') WHERE shop_id = ?",
    ).run(shopId);

    assert.equal(stats(shopId, 30).total, 0);
    assert.equal(stats(shopId, 60).total, 1);
  });

  test('stats classe les raisons les plus fréquentes en tête, limité à 5', () => {
    const shopId = makeShop('shop-g.myshopify.com');
    for (let i = 0; i < 3; i++) logError(shopId, { variantId: '1', reason: 'A' });
    for (let i = 0; i < 2; i++) logError(shopId, { variantId: '1', reason: 'B' });
    logError(shopId, { variantId: '1', reason: 'C' });
    logError(shopId, { variantId: '1', reason: 'D' });
    logError(shopId, { variantId: '1', reason: 'E' });
    logError(shopId, { variantId: '1', reason: 'F' });

    const s = stats(shopId);
    assert.equal(s.total, 9);
    assert.equal(s.topReasons.length, 5);
    assert.equal(s.topReasons[0].reason, 'A');
    assert.equal(s.topReasons[0].n, 3);
    assert.equal(s.topReasons[1].reason, 'B');
    assert.equal(s.topReasons[1].n, 2);
  });

  test('logError tronque une raison trop longue (200 caractères max)', () => {
    const shopId = makeShop('shop-h.myshopify.com');
    logError(shopId, { variantId: '1', reason: 'x'.repeat(500) });
    assert.equal(stats(shopId).topReasons[0].reason.length, 200);
  });
}
