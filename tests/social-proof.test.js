'use strict';

/**
 * Preuve sociale visuelle "Ils l'ont fait" — table + CRUD `social_proof_items`
 * (logique pure dans utils/social-proof.js, routée par routes/social-proof.js).
 * ──────────────────────────────────────────────────────────────────────────
 * Backlog item 18 (voir docs/ROADMAP-DEV.md §2) : bloc de confiance statique,
 * curé à la main par l'admin (URL d'image + légende), affiché derrière le
 * flag `social_proof_enabled` (désactivé par défaut, routes/shop-settings.js).
 *
 * DATA_DIR pointe vers un dossier temporaire créé pour ce test, avant tout
 * require() de db/database.js : la DB réelle du projet n'est jamais ouverte.
 *
 * On teste utils/social-proof.js directement plutôt que routes/social-proof.js :
 * requérir la route chargerait routes/auth.js, qui pose un setInterval de nettoyage
 * de sessions au require() — incompatible avec `node --test` (même raison que
 * tests/upsell-candidates.test.js et tests/customer-token.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsl-social-proof-test-'));
process.env.DATA_DIR = tmpDir;

// better-sqlite3 est un module natif : si le binaire compilé ne correspond pas
// à la version de Node de la machine, require() lève. Un échec d'ENVIRONNEMENT
// ne doit pas se confondre avec un échec de code — sinon il masque les vraies
// régressions dans la sortie de `npm test`. On saute proprement dans ce cas ;
// en CI et sur Railway, où les modules sont compilés à l'installation, la suite
// s'exécute normalement.
let initDB, db, sqliteIndisponible = null;
try {
  ({ initDB } = require('../db/database'));
  db = initDB();
} catch (e) {
  sqliteIndisponible = e.message.split('\n')[0];
}

if (sqliteIndisponible) {
  test('social_proof_items — ignoré : better-sqlite3 indisponible sur cette machine',
    { skip: `binaire natif illisible (${sqliteIndisponible}) — lancez \`npm rebuild better-sqlite3\`` },
    () => {});
  return;
}

const {
  listForShop: listForShopRaw,
  listPublicForShop: listPublicForShopRaw,
  createItem: createItemRaw,
  deleteItem: deleteItemRaw,
  MAX_PUBLIC_ITEMS,
} = require('../utils/social-proof');

// db est fixe pour tout le fichier : on allège les appels en le pré-liant.
const listForShop = (shopId) => listForShopRaw(db, shopId);
const listPublicForShop = (shopId) => listPublicForShopRaw(db, shopId);
const createItem = (shopId, body) => createItemRaw(db, shopId, body);
const deleteItem = (shopId, id) => deleteItemRaw(db, shopId, id);

function makeShop(domain) {
  return db.prepare('INSERT INTO shops (shop_domain) VALUES (?)').run(domain).lastInsertRowid;
}

test.after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('création réussie : une vignette est bien enregistrée et relue', () => {
  const shopId = makeShop('shop-a.myshopify.com');
  const result = createItem(shopId, { image_url: 'https://cdn.example.com/a.jpg', caption: 'T-shirt perso' });
  assert.equal(result.ok, true);
  assert.ok(result.id);

  const rows = listForShop(shopId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].image_url, 'https://cdn.example.com/a.jpg');
  assert.equal(rows[0].caption, 'T-shirt perso');
});

test('rejet si image_url manquant', () => {
  const shopId = makeShop('shop-b.myshopify.com');
  const result = createItem(shopId, { caption: 'Sans image' });
  assert.equal(result.status, 400);
  assert.match(result.error, /image_url/);
  assert.equal(listForShop(shopId).length, 0);
});

test('rejet si image_url n\'est pas une URL http(s)', () => {
  const shopId = makeShop('shop-c.myshopify.com');
  const result = createItem(shopId, { image_url: 'javascript:alert(1)' });
  assert.equal(result.status, 400);
  assert.match(result.error, /http/);
});

test('caption optionnelle : vide par défaut si non fournie', () => {
  const shopId = makeShop('shop-d.myshopify.com');
  createItem(shopId, { image_url: 'https://cdn.example.com/b.jpg' });
  const rows = listForShop(shopId);
  assert.equal(rows[0].caption, '');
});

test('scoping strict par shop_id : un shop ne voit jamais les vignettes d\'un autre', () => {
  const shopA = makeShop('shop-e.myshopify.com');
  const shopF = makeShop('shop-f.myshopify.com');
  createItem(shopA, { image_url: 'https://cdn.example.com/a.jpg' });
  createItem(shopF, { image_url: 'https://cdn.example.com/f.jpg' });

  assert.equal(listForShop(shopA).length, 1);
  assert.equal(listForShop(shopA)[0].image_url, 'https://cdn.example.com/a.jpg');
  assert.equal(listForShop(shopF).length, 1);
  assert.equal(listForShop(shopF)[0].image_url, 'https://cdn.example.com/f.jpg');
});

test('un shop ne peut pas supprimer les vignettes d\'un autre shop par id deviné', () => {
  const shopA = makeShop('shop-g.myshopify.com');
  const shopB = makeShop('shop-h.myshopify.com');
  createItem(shopA, { image_url: 'https://cdn.example.com/a.jpg' });
  const [row] = listForShop(shopA);

  const resultFromOtherShop = deleteItem(shopB, row.id);
  assert.equal(resultFromOtherShop.deleted, false, 'la suppression ne doit rien supprimer');
  assert.equal(listForShop(shopA).length, 1, 'la vignette du shop A doit survivre');

  const resultFromOwner = deleteItem(shopA, row.id);
  assert.equal(resultFromOwner.deleted, true);
  assert.equal(listForShop(shopA).length, 0);
});

test('tri par sort_order croissant', () => {
  const shopId = makeShop('shop-i.myshopify.com');
  createItem(shopId, { image_url: 'https://cdn.example.com/c.jpg', sort_order: 2 });
  createItem(shopId, { image_url: 'https://cdn.example.com/a.jpg', sort_order: 0 });
  createItem(shopId, { image_url: 'https://cdn.example.com/b.jpg', sort_order: 1 });

  const rows = listForShop(shopId);
  assert.deepEqual(rows.map(r => r.image_url), [
    'https://cdn.example.com/a.jpg',
    'https://cdn.example.com/b.jpg',
    'https://cdn.example.com/c.jpg',
  ]);
});

test('vue publique : limitée à MAX_PUBLIC_ITEMS et sans id interne', () => {
  const shopId = makeShop('shop-j.myshopify.com');
  for (let i = 0; i < MAX_PUBLIC_ITEMS + 2; i++) {
    createItem(shopId, { image_url: `https://cdn.example.com/${i}.jpg`, caption: `c${i}`, sort_order: i });
  }

  const publicItems = listPublicForShop(shopId);
  assert.equal(publicItems.length, MAX_PUBLIC_ITEMS);
  assert.deepEqual(Object.keys(publicItems[0]).sort(), ['caption', 'image_url']);
  assert.equal(publicItems[0].image_url, 'https://cdn.example.com/0.jpg');
});

test('vue publique vide pour un shop sans vignette', () => {
  const shopId = makeShop('shop-k.myshopify.com');
  assert.deepEqual(listPublicForShop(shopId), []);
});
