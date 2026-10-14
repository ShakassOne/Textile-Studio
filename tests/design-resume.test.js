'use strict';

/**
 * Reprise de création pour le client connecté (backlog item 24, logique pure
 * dans utils/design-resume.js, routée par GET /api/designs/mine dans
 * routes/designs.js).
 * ──────────────────────────────────────────────────────────────────────────
 * `designs.product` stocke la clé du MOCKUP (ex. "tshirt"), pas l'id/handle
 * Shopify du produit — la fonction doit donc résoudre le produit demandé via
 * product_mockup_links avant de chercher un design à proposer en reprise.
 *
 * DATA_DIR pointe vers un dossier temporaire créé pour ce test, avant tout
 * require() de db/database.js : la DB réelle du projet n'est jamais ouverte.
 *
 * On teste utils/design-resume.js directement plutôt que routes/designs.js :
 * requérir la route chargerait routes/auth.js, qui pose un setInterval de
 * nettoyage de sessions au require() — incompatible avec `node --test` (même
 * raison que tests/upsell-candidates.test.js et tests/social-proof.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsl-design-resume-test-'));
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
  // Colonne posée par routes/designs.js au require() (idempotent, cf. ce
  // fichier) : on ne requiert pas la route ici (routes/auth.js, setInterval),
  // donc on la pose nous-mêmes avant de tester.
  db.prepare('ALTER TABLE designs ADD COLUMN customer_id TEXT').run();
} catch (e) {
  sqliteIndisponible = e.message.split('\n')[0];
}

if (sqliteIndisponible) {
  test('design-resume — ignoré : better-sqlite3 indisponible sur cette machine',
    { skip: `binaire natif illisible (${sqliteIndisponible}) — lancez \`npm rebuild better-sqlite3\`` },
    () => {});
  return;
}

const { findResumable: findResumableRaw } = require('../utils/design-resume');
const findResumable = (shopId, customerId, productRef, days) =>
  findResumableRaw(db, shopId, customerId, productRef, days);

function makeShop(domain) {
  return db.prepare('INSERT INTO shops (shop_domain) VALUES (?)').run(domain).lastInsertRowid;
}

// shop_id doit être posé : la résolution produit→mockup joint explicitement
// sur m.shop_id = pl.shop_id (routes/product-links.js, GET /by-product/:id).
function makeMockup(shopId, mockupKey) {
  return db.prepare('INSERT INTO mockups (shop_id, name, product) VALUES (?, ?, ?)').run(shopId, mockupKey, mockupKey).lastInsertRowid;
}

// Lie un produit Shopify (id + handle) à un mockup, comme le fait l'admin.
function linkProduct(shopId, productId, handle, mockupId) {
  db.prepare(`
    INSERT INTO product_mockup_links (shop_id, shopify_product_id, shopify_product_handle, mockup_id)
    VALUES (?, ?, ?, ?)
  `).run(shopId, productId, handle, mockupId);
}

// updated_at part de la valeur par défaut de la table (maintenant) — les tests
// qui ont besoin d'une date précise la posent ensuite par un UPDATE dédié
// (SQLite n'accepte pas une expression SQL brute comme valeur bind).
function makeDesign(shopId, customerId, mockupKey) {
  const info = db.prepare(`
    INSERT INTO designs (shop_id, customer_id, product)
    VALUES (?, ?, ?)
  `).run(shopId, customerId, mockupKey);
  return info.lastInsertRowid;
}

function markConverted(designId) {
  db.prepare('INSERT INTO orders (design_id, product) VALUES (?, ?)').run(designId, 'x');
}

test.after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('trouve la dernière création non convertie, par id Shopify', () => {
  const shopId = makeShop('shop-a.myshopify.com');
  const mockupId = makeMockup(shopId, 'tshirt');
  linkProduct(shopId, '111', 't-shirt-homme', mockupId);
  makeDesign(shopId, 'cust-1', 'tshirt');

  const found = findResumable(shopId, 'cust-1', '111');
  assert.ok(found);
});

test('trouve la dernière création non convertie, par handle Shopify', () => {
  const shopId = makeShop('shop-b.myshopify.com');
  const mockupId = makeMockup(shopId, 'hoodie');
  linkProduct(shopId, '222', 'hoodie-noir', mockupId);
  makeDesign(shopId, 'cust-2', 'hoodie');

  const found = findResumable(shopId, 'cust-2', 'hoodie-noir');
  assert.ok(found);
});

test('rien à reprendre si le produit n\'est lié à aucun mockup', () => {
  const shopId = makeShop('shop-c.myshopify.com');
  makeDesign(shopId, 'cust-3', 'tshirt');

  const found = findResumable(shopId, 'cust-3', '999-inexistant');
  assert.equal(found, null);
});

test('un design déjà converti en commande n\'est jamais proposé en reprise', () => {
  const shopId = makeShop('shop-d.myshopify.com');
  const mockupId = makeMockup(shopId, 'tshirt');
  linkProduct(shopId, '333', 't-shirt-femme', mockupId);
  const designId = makeDesign(shopId, 'cust-4', 'tshirt');
  markConverted(designId);

  const found = findResumable(shopId, 'cust-4', '333');
  assert.equal(found, null);
});

test('un design trop ancien (hors fenêtre de rétention) n\'est pas proposé', () => {
  const shopId = makeShop('shop-e.myshopify.com');
  const mockupId = makeMockup(shopId, 'tshirt');
  linkProduct(shopId, '444', 't-shirt-vieux', mockupId);
  const designId = makeDesign(shopId, 'cust-5', 'tshirt');
  db.prepare("UPDATE designs SET updated_at = datetime('now', '-45 days') WHERE id = ?").run(designId);

  const found = findResumable(shopId, 'cust-5', '444', 30);
  assert.equal(found, null);
});

test('scoping strict par shop_id : un shop ne voit jamais les créations d\'un autre', () => {
  // shopify_product_id est UNIQUE globalement (cf. routes/product-links.js) :
  // deux boutiques ne peuvent donc jamais lier le MÊME id produit, ce qui
  // isole déjà la résolution mockup par construction. On vérifie ici que la
  // requête elle-même reste bien scopée shop_id (et pas seulement grâce à
  // cette contrainte DB) : la liaison du shop A, interrogée avec l'id shop G,
  // ne doit jamais ressortir.
  const shopA = makeShop('shop-f.myshopify.com');
  const shopG = makeShop('shop-g.myshopify.com');
  const mockupA = makeMockup(shopA, 'tshirt');
  linkProduct(shopA, '555', 'shared-handle', mockupA);
  makeDesign(shopA, 'cust-6', 'tshirt');

  assert.ok(findResumable(shopA, 'cust-6', '555'));
  assert.equal(findResumable(shopG, 'cust-6', '555'), null, 'une liaison/un design du shop A ne doit jamais ressortir pour le shop G');
});

test('isolation stricte par client : le design d\'un autre client n\'est jamais proposé', () => {
  const shopId = makeShop('shop-h.myshopify.com');
  const mockupId = makeMockup(shopId, 'tshirt');
  linkProduct(shopId, '666', 't-shirt-partage', mockupId);
  makeDesign(shopId, 'cust-7', 'tshirt');

  assert.ok(findResumable(shopId, 'cust-7', '666'));
  assert.equal(findResumable(shopId, 'cust-8', '666'), null);
});

test('sans shop_id, sans customer_id ou sans productRef : jamais de requête, toujours null', () => {
  const shopId = makeShop('shop-i.myshopify.com');
  assert.equal(findResumable(null, 'cust-9', '777'), null);
  assert.equal(findResumable(shopId, '', '777'), null);
  assert.equal(findResumable(shopId, 'cust-9', ''), null);
});

test('plusieurs créations pour le même client/produit : la plus récente non convertie gagne', () => {
  const shopId = makeShop('shop-j.myshopify.com');
  const mockupId = makeMockup(shopId, 'tshirt');
  linkProduct(shopId, '888', 't-shirt-multi', mockupId);
  const ancien = makeDesign(shopId, 'cust-10', 'tshirt');
  const recent = makeDesign(shopId, 'cust-10', 'tshirt');
  db.prepare("UPDATE designs SET updated_at = datetime('now', '-2 days') WHERE id = ?").run(ancien);
  db.prepare("UPDATE designs SET updated_at = datetime('now', '-1 hours') WHERE id = ?").run(recent);

  const found = findResumable(shopId, 'cust-10', '888');
  assert.equal(found.id, recent);
});
