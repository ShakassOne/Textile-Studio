#!/usr/bin/env node
'use strict';
/**
 * scripts/test-settings.js — Tests d'intégration db/settings.js + utils/crypto.js
 *
 * Utilise un FakeDB en mémoire (pas de better-sqlite3) pour tester le pipeline
 * complet : chiffrement transparent, multi-tenant, migration legacy → chiffré.
 *
 * Usage : node scripts/test-settings.js
 */

// ── Setup env de test (avant require !) ──────────────────────────────────────
process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');

const assert = require('node:assert');
const { isEncrypted } = require('../utils/crypto');

// ── Mini FakeDB qui imite l'API better-sqlite3 utilisée par db/settings.js ──
function createFakeDB() {
  // Stockage : Map<"shop_id|key", { shop_id, key, value, updated_at }>
  const store = new Map();
  const k = (shopId, key) => `${shopId}|${key}`;

  // Patterns SQL utilisés dans db/settings.js
  const queries = {
    // SELECT par (shop_id, key)
    select_one: /^SELECT value FROM settings WHERE shop_id=\? AND key=\?$/i,
    // SELECT all par key
    select_by_key: /^SELECT shop_id, value FROM settings WHERE key=\?$/i,
    // SELECT all par shop_id
    select_by_shop: /^SELECT key, value FROM settings WHERE shop_id=\?$/i,
    // INSERT ON CONFLICT (UPSERT)
    upsert: /^INSERT INTO settings.*ON CONFLICT.*DO UPDATE/is,
    // UPDATE direct (utilisé par migrateEncryptSecrets)
    update: /^UPDATE settings SET value=.+WHERE shop_id=\? AND key=\?$/is,
    // DELETE
    delete: /^DELETE FROM settings WHERE shop_id=\? AND key=\?$/i,
  };

  function prepare(sql) {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (queries.select_one.test(norm)) {
      return {
        get: (shopId, key) => {
          const row = store.get(k(shopId, key));
          return row ? { value: row.value } : undefined;
        },
      };
    }
    if (queries.select_by_key.test(norm)) {
      return {
        all: (key) => {
          const out = [];
          for (const r of store.values()) {
            if (r.key === key) out.push({ shop_id: r.shop_id, value: r.value });
          }
          return out;
        },
      };
    }
    if (queries.select_by_shop.test(norm)) {
      return {
        all: (shopId) => {
          const out = [];
          for (const r of store.values()) {
            if (r.shop_id === shopId) out.push({ key: r.key, value: r.value });
          }
          return out;
        },
      };
    }
    if (queries.upsert.test(norm)) {
      return {
        run: (shopId, key, value) => {
          store.set(k(shopId, key), {
            shop_id: shopId, key, value,
            updated_at: new Date().toISOString(),
          });
          return { changes: 1 };
        },
      };
    }
    if (queries.update.test(norm)) {
      return {
        run: (value, shopId, key) => {
          const cur = store.get(k(shopId, key));
          if (cur) {
            cur.value = value;
            cur.updated_at = new Date().toISOString();
          }
          return { changes: cur ? 1 : 0 };
        },
      };
    }
    if (queries.delete.test(norm)) {
      return {
        run: (shopId, key) => {
          const had = store.has(k(shopId, key));
          store.delete(k(shopId, key));
          return { changes: had ? 1 : 0 };
        },
      };
    }
    throw new Error('FakeDB: requête SQL non reconnue → ' + norm);
  }

  return {
    prepare,
    // Helper interne pour les assertions du test (pas exposé par better-sqlite3)
    _store: store,
    _rawValue: (shopId, key) => store.get(k(shopId, key))?.value,
    _seed: (shopId, key, value) => store.set(k(shopId, key), {
      shop_id: shopId, key, value, updated_at: new Date().toISOString(),
    }),
  };
}

// ── Monkey-patch require cache pour db/database AVANT de charger db/settings ──
const fakeDb = createFakeDB();
require.cache[require.resolve('../db/database')] = {
  exports: {
    getDB:    () => fakeDb,
    initDB:   () => fakeDb,
    getShop:  () => null,
    getShopIdByDomain:  () => null,
    getBootstrapShopId: () => null,
  },
  id: require.resolve('../db/database'),
  filename: require.resolve('../db/database'),
  loaded: true,
};

const {
  getSetting,
  setSetting,
  deleteSetting,
  isSecretKey,
  migrateEncryptSecrets,
  SECRET_KEYS,
} = require('../db/settings');

// ── Helpers ──────────────────────────────────────────────────────────────────
let tests = 0;
let pass  = 0;
function test(name, fn) {
  tests++;
  try { fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { console.error(`  ❌ ${name}\n     → ${e.message}`); }
}

console.log(`\n🧪  db/settings.js — tests d'intégration (FakeDB)\n`);

// ── Tests ────────────────────────────────────────────────────────────────────

test('SECRET_KEYS contient openai_api_key', () => {
  assert.ok(SECRET_KEYS.has('openai_api_key'));
  assert.strictEqual(isSecretKey('openai_api_key'), true);
  assert.strictEqual(isSecretKey('theme_color'), false);
});

test('setSetting(openai_api_key) → chiffre en DB', () => {
  setSetting(1, 'openai_api_key', 'sk-proj-supersecret');
  const stored = fakeDb._rawValue(1, 'openai_api_key');
  assert.ok(isEncrypted(stored), `stockage doit être chiffré, got: ${stored}`);
  assert.ok(stored.startsWith('enc.v1:'));
});

test('getSetting(openai_api_key) → déchiffre transparent', () => {
  assert.strictEqual(getSetting(1, 'openai_api_key'), 'sk-proj-supersecret');
});

test('setSetting(theme_color) → reste en clair (clé non sensible)', () => {
  setSetting(1, 'theme_color', '#F59E0B');
  assert.strictEqual(fakeDb._rawValue(1, 'theme_color'), '#F59E0B');
  assert.strictEqual(getSetting(1, 'theme_color'), '#F59E0B');
});

test('multi-tenant : isolation entre shops', () => {
  setSetting(2, 'openai_api_key', 'sk-shop2-key');
  assert.strictEqual(getSetting(1, 'openai_api_key'), 'sk-proj-supersecret');
  assert.strictEqual(getSetting(2, 'openai_api_key'), 'sk-shop2-key');
});

test('IV aléatoire : même clair sur 2 shops → ciphertext différent', () => {
  setSetting(10, 'openai_api_key', 'same-secret');
  setSetting(20, 'openai_api_key', 'same-secret');
  const v10 = fakeDb._rawValue(10, 'openai_api_key');
  const v20 = fakeDb._rawValue(20, 'openai_api_key');
  assert.notStrictEqual(v10, v20, 'ciphertexts doivent différer');
  assert.strictEqual(getSetting(10, 'openai_api_key'), 'same-secret');
  assert.strictEqual(getSetting(20, 'openai_api_key'), 'same-secret');
});

test('migrateEncryptSecrets chiffre les legacy clear text', () => {
  fakeDb._seed(99, 'openai_api_key', 'sk-legacy-clear-text');
  assert.strictEqual(fakeDb._rawValue(99, 'openai_api_key'), 'sk-legacy-clear-text');

  const r = migrateEncryptSecrets();

  const stored = fakeDb._rawValue(99, 'openai_api_key');
  assert.ok(isEncrypted(stored), 'doit être chiffré après migration');
  assert.strictEqual(getSetting(99, 'openai_api_key'), 'sk-legacy-clear-text');
  assert.ok(r.migrated >= 1, `migrated >= 1, got ${r.migrated}`);
  assert.strictEqual(r.errors, 0);
});

test('migrateEncryptSecrets idempotente (2e run = 0 migration)', () => {
  const r = migrateEncryptSecrets();
  assert.strictEqual(r.migrated, 0);
  assert.strictEqual(r.errors, 0);
});

test('deleteSetting supprime correctement', () => {
  setSetting(3, 'openai_api_key', 'temp-key');
  assert.strictEqual(getSetting(3, 'openai_api_key'), 'temp-key');
  deleteSetting(3, 'openai_api_key');
  assert.strictEqual(getSetting(3, 'openai_api_key'), '');
});

test('valeur vide → chaîne vide en DB (pas de chiffrement de vide)', () => {
  setSetting(4, 'openai_api_key', '');
  assert.strictEqual(fakeDb._rawValue(4, 'openai_api_key'), '');
  assert.strictEqual(getSetting(4, 'openai_api_key'), '');
});

test('clé absente retourne chaîne vide', () => {
  assert.strictEqual(getSetting(9999, 'openai_api_key'), '');
});

console.log(`\n📊  ${pass}/${tests} tests réussis\n`);
process.exit(pass === tests ? 0 : 1);
