'use strict';

/**
 * Upsell V2 étape 1 — table + CRUD `upsell_candidates`
 * (logique pure dans utils/upsell-candidates.js, routée par routes/upsell-candidates.js).
 * ──────────────────────────────────────────────────────────────────────────
 * Backend-only, pas d'écran admin ni de flag à ce stade (voir docs/ROADMAP-DEV.md §2).
 * Curation manuelle : pas d'algorithme, juste une table scopée shop avec contrainte
 * d'unicité (shop_id, source, target) et un rejet explicite si source === target.
 *
 * DATA_DIR pointe vers un dossier temporaire créé pour ce test, avant tout
 * require() de db/database.js : la DB réelle du projet n'est jamais ouverte.
 *
 * On teste utils/upsell-candidates.js directement plutôt que routes/upsell-candidates.js :
 * requérir la route chargerait routes/auth.js, qui pose un setInterval de nettoyage
 * de sessions au require() — incompatible avec `node --test`, qui attend que la
 * boucle d'événements se vide (même raison que tests/customer-token.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsl-upsell-test-'));
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

// Celui-là ne touche pas la base : il doit tourner même quand le binaire
// natif manque, car c'est lui qui rapproche l'identifiant global enregistré
// en admin du nombre que connaît la vitrine.
const { formesId } = require('../utils/upsell-candidates');

test('formesId rapproche l\'identifiant global et le nombre de la vitrine', () => {
  assert.deepEqual(formesId('gid://shopify/Product/123'), ['gid://shopify/Product/123', '123']);
  assert.deepEqual(formesId('123'), ['123', 'gid://shopify/Product/123']);
  assert.deepEqual(formesId(123), ['123', 'gid://shopify/Product/123']);
  assert.deepEqual(formesId(''), []);
  assert.deepEqual(formesId(null), []);
  assert.deepEqual(formesId(undefined), []);
  assert.deepEqual(formesId('   '), []);
  // Pas de nombre en fin de chaîne : on ne fabrique pas de gid farfelu.
  assert.deepEqual(formesId('handle-sans-chiffre'), ['handle-sans-chiffre']);
});

if (sqliteIndisponible) {
  test('upsell_candidates — ignoré : better-sqlite3 indisponible sur cette machine',
    { skip: `binaire natif illisible (${sqliteIndisponible}) — lancez \`npm rebuild better-sqlite3\`` },
    () => {});
  return;
}

const {
  listPublicForSource: listPublicForSourceRaw,
  listForSource: listForSourceRaw,
  listGrouped: listGroupedRaw,
  upsertCandidate: upsertCandidateRaw,
  deleteCandidate: deleteCandidateRaw,
} = require('../utils/upsell-candidates');

// db est fixe pour tout le fichier : on allège les appels en le pré-liant.
const listForSource   = (shopId, sourceId) => listForSourceRaw(db, shopId, sourceId);
const listPublic      = (shopId, sourceId, max) => listPublicForSourceRaw(db, shopId, sourceId, max);
const listGrouped     = (shopId) => listGroupedRaw(db, shopId);
const upsertCandidate = (shopId, body) => upsertCandidateRaw(db, shopId, body);
const deleteCandidate = (shopId, id) => deleteCandidateRaw(db, shopId, id);

function makeShop(domain) {
  return db.prepare('INSERT INTO shops (shop_domain) VALUES (?)').run(domain).lastInsertRowid;
}

function linkProduct(shopId, productId, title) {
  db.prepare(`
    INSERT INTO product_mockup_links (shop_id, shopify_product_id, shopify_product_title, shopify_product_handle)
    VALUES (?, ?, ?, ?)
  `).run(shopId, productId, title, title.toLowerCase());
}

test.after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('création réussie : un candidat est bien enregistré et relu', () => {
  const shopId = makeShop('shop-a.myshopify.com');
  linkProduct(shopId, 'target-1', 'Hoodie');

  const result = upsertCandidate(shopId, {
    source_shopify_product_id: 'source-1',
    target_shopify_product_id: 'target-1',
    sort_order: 0,
  });
  assert.deepEqual(result, { ok: true });

  const rows = listForSource(shopId, 'source-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target_shopify_product_id, 'target-1');
  assert.equal(rows[0].target_title, 'Hoodie');
});

test('rejet si source === target', () => {
  const shopId = makeShop('shop-b.myshopify.com');
  const result = upsertCandidate(shopId, {
    source_shopify_product_id: 'same-id',
    target_shopify_product_id: 'same-id',
  });
  assert.equal(result.status, 400);
  assert.match(result.error, /lui-même/);
  assert.equal(listForSource(shopId, 'same-id').length, 0);
});

test('rejet si source ou target manquant', () => {
  const shopId = makeShop('shop-c.myshopify.com');
  assert.equal(upsertCandidate(shopId, { target_shopify_product_id: 'x' }).status, 400);
  assert.equal(upsertCandidate(shopId, { source_shopify_product_id: 'x' }).status, 400);
});

test('scoping strict par shop_id : un shop ne voit jamais les candidats d\'un autre', () => {
  const shopA = makeShop('shop-d.myshopify.com');
  const shopE = makeShop('shop-e.myshopify.com');

  upsertCandidate(shopA, { source_shopify_product_id: 'src', target_shopify_product_id: 'tgt-a' });
  upsertCandidate(shopE, { source_shopify_product_id: 'src', target_shopify_product_id: 'tgt-e' });

  const forA = listForSource(shopA, 'src');
  const forE = listForSource(shopE, 'src');
  assert.equal(forA.length, 1);
  assert.equal(forA[0].target_shopify_product_id, 'tgt-a');
  assert.equal(forE.length, 1);
  assert.equal(forE[0].target_shopify_product_id, 'tgt-e');
});

test('un shop ne peut pas supprimer les candidats d\'un autre shop par id deviné', () => {
  const shopA = makeShop('shop-f.myshopify.com');
  const shopB = makeShop('shop-g.myshopify.com');
  upsertCandidate(shopA, { source_shopify_product_id: 'src', target_shopify_product_id: 'tgt' });
  const [row] = listForSource(shopA, 'src');

  const resultFromOtherShop = deleteCandidate(shopB, row.id);
  assert.equal(resultFromOtherShop.deleted, false, 'la suppression ne doit rien supprimer');
  assert.equal(listForSource(shopA, 'src').length, 1, 'le candidat du shop A doit survivre');

  const resultFromOwner = deleteCandidate(shopA, row.id);
  assert.equal(resultFromOwner.deleted, true);
  assert.equal(listForSource(shopA, 'src').length, 0);
});

test('contrainte UNIQUE respectée : un re-POST du même couple modifie sort_order au lieu de dupliquer', () => {
  const shopId = makeShop('shop-h.myshopify.com');
  upsertCandidate(shopId, { source_shopify_product_id: 'src', target_shopify_product_id: 'tgt', sort_order: 0 });
  upsertCandidate(shopId, { source_shopify_product_id: 'src', target_shopify_product_id: 'tgt', sort_order: 5 });

  const rows = listForSource(shopId, 'src');
  assert.equal(rows.length, 1, 'pas de doublon');
  assert.equal(rows[0].sort_order, 5, 'sort_order mis à jour par le 2e POST');
});

test('tri par sort_order croissant', () => {
  const shopId = makeShop('shop-i.myshopify.com');
  upsertCandidate(shopId, { source_shopify_product_id: 'src', target_shopify_product_id: 'tgt-c', sort_order: 2 });
  upsertCandidate(shopId, { source_shopify_product_id: 'src', target_shopify_product_id: 'tgt-a', sort_order: 0 });
  upsertCandidate(shopId, { source_shopify_product_id: 'src', target_shopify_product_id: 'tgt-b', sort_order: 1 });

  const rows = listForSource(shopId, 'src');
  assert.deepEqual(rows.map(r => r.target_shopify_product_id), ['tgt-a', 'tgt-b', 'tgt-c']);
});

test('listGrouped regroupe bien par produit source', () => {
  const shopId = makeShop('shop-j.myshopify.com');
  upsertCandidate(shopId, { source_shopify_product_id: 'src-1', target_shopify_product_id: 'tgt-1' });
  upsertCandidate(shopId, { source_shopify_product_id: 'src-1', target_shopify_product_id: 'tgt-2' });
  upsertCandidate(shopId, { source_shopify_product_id: 'src-2', target_shopify_product_id: 'tgt-3' });

  const grouped = listGrouped(shopId);
  assert.deepEqual(Object.keys(grouped).sort(), ['src-1', 'src-2']);
  assert.equal(grouped['src-1'].length, 2);
  assert.equal(grouped['src-2'].length, 1);
});

// ── Vue vitrine ───────────────────────────────────────────────────────────

test('listPublicForSource trouve la curation faite avec l\'identifiant global', () => {
  const shopId = makeShop('shop-k.myshopify.com');
  linkProduct(shopId, 'gid://shopify/Product/222', 'Sweat');
  upsertCandidate(shopId, {
    source_shopify_product_id: 'gid://shopify/Product/111',
    target_shopify_product_id: 'gid://shopify/Product/222',
  });

  // La vitrine n'envoie que le nombre : sans rapprochement, zéro suggestion.
  const vus = listPublic(shopId, '111');
  assert.equal(vus.length, 1);
  assert.equal(vus[0].handle, 'sweat');
  assert.equal(vus[0].title, 'Sweat');
});

test('une cible qui n\'est plus liée à un mockup disparaît des suggestions', () => {
  const shopId = makeShop('shop-l.myshopify.com');
  linkProduct(shopId, 'tgt-lie', 'Toujours là');
  upsertCandidate(shopId, { source_shopify_product_id: 'src', target_shopify_product_id: 'tgt-lie' });
  upsertCandidate(shopId, { source_shopify_product_id: 'src', target_shopify_product_id: 'tgt-delie' });

  // L'admin voit les deux paires, la vitrine une seule : proposer un produit
  // qu'on ne sait plus personnaliser mène à une fiche sans bouton.
  assert.equal(listForSource(shopId, 'src').length, 2);
  const vus = listPublic(shopId, 'src');
  assert.deepEqual(vus.map(v => v.title), ['Toujours là']);
});

test('listPublicForSource plafonne à quatre suggestions', () => {
  const shopId = makeShop('shop-m.myshopify.com');
  for (let i = 0; i < 6; i++) {
    linkProduct(shopId, 'tgt-' + i, 'Produit ' + i);
    upsertCandidate(shopId, {
      source_shopify_product_id: 'src', target_shopify_product_id: 'tgt-' + i, sort_order: i,
    });
  }
  assert.equal(listPublic(shopId, 'src').length, 4);
  assert.deepEqual(listPublic(shopId, 'src').map(v => v.title),
    ['Produit 0', 'Produit 1', 'Produit 2', 'Produit 3']);
  assert.equal(listPublic(shopId, 'src', 2).length, 2);
});

test('les suggestions ne traversent pas les boutiques', () => {
  const a = makeShop('shop-n.myshopify.com');
  const b = makeShop('shop-o.myshopify.com');
  linkProduct(a, 'tgt', 'Chez A');
  upsertCandidate(a, { source_shopify_product_id: 'src', target_shopify_product_id: 'tgt' });

  assert.equal(listPublic(a, 'src').length, 1);
  assert.equal(listPublic(b, 'src').length, 0);
});

test('source vide ou inconnue : aucune suggestion, aucune erreur', () => {
  const shopId = makeShop('shop-p.myshopify.com');
  assert.deepEqual(listPublic(shopId, ''), []);
  assert.deepEqual(listPublic(shopId, null), []);
  assert.deepEqual(listPublic(shopId, 'produit-jamais-vu'), []);
});
