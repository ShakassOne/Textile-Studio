'use strict';

/**
 * Catalogue de visuels d'une fiche produit (routes/product-designs.js).
 * ──────────────────────────────────────────────────────────────────────────
 * C'est la route qui permet de vendre 50 produits × 200 visuels sans créer
 * 10 000 déclinaisons : la fiche produit demande « quels designs pour moi ? »
 * et le serveur filtre. Trois propriétés comptent, et c'est ce qu'on vérifie :
 *
 *   • un visuel retiré de la vente ne doit JAMAIS ressortir ;
 *   • un visuel exclu à la main du support ne doit pas ressortir ;
 *   • on n'écarte jamais un visuel faute de données — produit sans mockup,
 *     zone non calibrée ou dimensions inconnues laissent tout passer.
 *
 * La base n'est pas ouverte : db/database.js et _shop-context.js sont
 * remplacés dans le cache de modules avant le require() de la route, parce
 * que better-sqlite3 est un binaire natif absent de certaines machines (même
 * raison que tests/upsell-candidates.test.js) et qu'on veut tester la LOGIQUE
 * de filtrage, pas SQLite.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

// ── Fausse base ────────────────────────────────────────────────────────────
const DONNEES = {
  lien:    { mockup_id: 7 },
  mockup:  { views_json: JSON.stringify([{ zone: { w: 300, h: 400 }, printWidthMm: 420 }]) },
  visuels: [],
};

// Mémorise les paramètres passés à la dernière recherche de liaison produit,
// pour vérifier qu'on interroge bien les deux écritures d'identifiant.
let DERNIERE_RECHERCHE_LIEN = null;

const faussebase = {
  prepare(sql) {
    if (/FROM product_mockup_links/.test(sql)) return {
      get: (...args) => { DERNIERE_RECHERCHE_LIEN = args; return DONNEES.lien; },
    };
    if (/FROM mockups/.test(sql))              return { get: () => DONNEES.mockup };
    if (/FROM library/.test(sql))              return { all: () => DONNEES.visuels };
    throw new Error('Requête inattendue : ' + sql);
  },
};

function stub(nomModule, exports) {
  const resolu = require.resolve(nomModule);
  require.cache[resolu] = { id: resolu, filename: resolu, loaded: true, exports };
}
stub('../db/database', { getDB: () => faussebase });
stub('../routes/_shop-context', {
  attachShopId: (req, _res, next) => { req.shopId = 1; next(); },
  attachShopIdSoft: (req, _res, next) => { req.shopId = 1; next(); },
});

const router = require('../routes/product-designs');
const express = require('express');
const app = express();
app.use('/api', router);

let serveur, base;
test.before(async () => {
  serveur = http.createServer(app);
  await new Promise(r => serveur.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${serveur.address().port}`;
});
test.after(() => serveur.close());

/** Un visuel de bibliothèque, avec des valeurs par défaut raisonnables. */
function visuel(over = {}) {
  return {
    id: 1, slug: 'x', display_name: 'X', filename: 'x.png', url: '/u/x.png',
    thumb_url: null, category: 'divers', tags: '[]', excluded_mockups: '[]',
    width: 2480, height: 3508, sort_order: 0, ...over,
  };
}

/** Appelle la route en vidant d'abord le cache (2 min sinon). */
async function catalogue(produit = '12345', qs = '') {
  router.viderCacheDesigns();
  const r = await fetch(`${base}/api/products/${produit}/designs${qs}`);
  return { status: r.status, corps: await r.json() };
}

test('un visuel bien proportionné est proposé', async () => {
  DONNEES.visuels = [visuel({ id: 1, display_name: 'Octobre Rose' })];
  const { status, corps } = await catalogue();
  assert.equal(status, 200);
  assert.equal(corps.total, 1);
  assert.equal(corps.designs[0].nom, 'Octobre Rose');
  assert.equal(corps.mockupId, 7);
  assert.deepEqual(corps.ecartes, []);
});

test('un visuel exclu à la main du support ne ressort pas', async () => {
  DONNEES.visuels = [
    visuel({ id: 1, display_name: 'Partout' }),
    visuel({ id: 2, display_name: 'Pas ici', excluded_mockups: '[7]' }),
  ];
  const { corps } = await catalogue();
  assert.deepEqual(corps.designs.map(d => d.nom), ['Partout']);
  assert.equal(corps.ecartes[0].raison, 'exclu-manuellement');
});

test('une exclusion visant un AUTRE support ne change rien', async () => {
  DONNEES.visuels = [visuel({ id: 1, display_name: 'Pas la casquette', excluded_mockups: '[3,9]' })];
  const { corps } = await catalogue();
  assert.equal(corps.total, 1);
});

test('un visuel trop petit pour la zone est écarté, avec son DPI', async () => {
  DONNEES.visuels = [visuel({ id: 1, display_name: 'Minuscule', width: 300, height: 300 })];
  const { corps } = await catalogue();
  assert.equal(corps.total, 0);
  assert.equal(corps.ecartes[0].raison, 'resolution-insuffisante');
  assert.ok(corps.ecartes[0].dpi < 100, 'le DPI mesuré doit accompagner le refus');
});

test('un grand visuel vertical est écarté d\'une casquette sans rien cocher', async () => {
  // Zone large et basse : 140 mm de large pour ~61 mm de haut.
  DONNEES.mockup = { views_json: JSON.stringify([{ zone: { w: 300, h: 130 }, printWidthMm: 140 }]) };
  DONNEES.visuels = [
    visuel({ id: 1, display_name: 'Grand vertical', width: 2480, height: 3508 }),
    visuel({ id: 2, display_name: 'Bandeau large',  width: 1600, height: 700 }),
  ];
  const { corps } = await catalogue();
  assert.deepEqual(corps.designs.map(d => d.nom), ['Bandeau large']);
  assert.equal(corps.ecartes[0].raison, 'proportions-inadaptees');
  // Remise en état pour les tests suivants.
  DONNEES.mockup = { views_json: JSON.stringify([{ zone: { w: 300, h: 400 }, printWidthMm: 420 }]) };
});

test('dimensions inconnues : le visuel passe quand même', async () => {
  DONNEES.visuels = [visuel({ id: 1, display_name: 'Sans mesure', width: null, height: null })];
  const { corps } = await catalogue();
  assert.equal(corps.total, 1, 'on n\'ampute jamais le catalogue faute de données');
});

test('produit non lié à un mockup : tout le catalogue est proposé', async () => {
  DONNEES.lien = undefined;
  DONNEES.visuels = [
    visuel({ id: 1, display_name: 'A', width: 300, height: 300 }),       // serait écarté avec une zone
    visuel({ id: 2, display_name: 'B', excluded_mockups: '[7]' }),       // exclusion sans objet
  ];
  const { corps } = await catalogue();
  assert.equal(corps.mockupId, null);
  assert.equal(corps.total, 2);
  DONNEES.lien = { mockup_id: 7 };
});

test('mockup sans zone calibrée : tout passe aussi', async () => {
  DONNEES.mockup = { views_json: JSON.stringify([{ printWidthMm: 420 }]) };
  DONNEES.visuels = [visuel({ id: 1, display_name: 'Minuscule', width: 300, height: 300 })];
  const { corps } = await catalogue();
  assert.equal(corps.zone, null);
  assert.equal(corps.total, 1);
  DONNEES.mockup = { views_json: JSON.stringify([{ zone: { w: 300, h: 400 }, printWidthMm: 420 }]) };
});

test('les catégories renvoyées sont celles des visuels retenus', async () => {
  DONNEES.visuels = [
    visuel({ id: 1, category: 'Moto' }),
    visuel({ id: 2, category: 'Femme' }),
    visuel({ id: 3, category: 'Moto' }),
    visuel({ id: 4, category: 'Casquette only', width: 300, height: 300 }), // écarté
  ];
  const { corps } = await catalogue();
  assert.deepEqual(corps.categories, ['Moto', 'Femme'],
    'une catégorie dont aucun visuel ne passe ne doit pas apparaître dans les filtres');
});

test('un identifiant produit non numérique est refusé', async () => {
  const r = await fetch(`${base}/api/products/abc/designs`);
  assert.equal(r.status, 400);
});

test('le cache resservi est signalé comme tel', async () => {
  DONNEES.visuels = [visuel({ id: 1 })];
  await catalogue('999');
  const r = await fetch(`${base}/api/products/999/designs`);
  const corps = await r.json();
  assert.equal(corps.cached, true);
});

test('une écriture dans la bibliothèque purge le cache', async () => {
  DONNEES.visuels = [visuel({ id: 1, display_name: 'Avant' })];
  await catalogue('555');
  DONNEES.visuels = [visuel({ id: 1, display_name: 'Après' })];
  router.viderCacheDesigns();
  const r = await fetch(`${base}/api/products/555/designs`);
  const corps = await r.json();
  assert.equal(corps.designs[0].nom, 'Après');
  assert.notEqual(corps.cached, true);
});

test('la liaison produit est cherchée sous ses deux écritures', async () => {
  // La table mélange des identifiants numériques et des GID complets selon
  // l'époque de la liaison, alors que le thème ne connaît que {{ product.id }}.
  // Chercher une seule forme revenait à ne jamais trouver le mockup.
  DONNEES.visuels = [visuel({ id: 1 })];
  await catalogue('10743954145607');
  assert.deepEqual(DERNIERE_RECHERCHE_LIEN,
    [1, '10743954145607', 'gid://shopify/Product/10743954145607']);
});
