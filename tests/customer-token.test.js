'use strict';

/**
 * Jeton d'identité client (routes/app-proxy.js).
 * ──────────────────────────────────────────────────────────────────────────
 * Le studio tourne dans une iframe Railway et ne voit pas la session Shopify.
 * L'App Proxy, lui, reçoit logged_in_customer_id dans un query string signé
 * par Shopify ; on le convertit en jeton signé de notre côté, que le studio
 * joint à ses appels IA pour obtenir le quota réservé aux clients.
 *
 * Ce jeton est la SEULE preuve d'identité acceptée : s'il devenait falsifiable,
 * n'importe qui s'attribuerait le quota d'un autre client. D'où ce test.
 *
 * La fonction est extraite du fichier plutôt que require()'ée : charger
 * routes/app-proxy.js ouvrirait la base de données.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SECRET = 'secret-de-test-pour-la-signature';
const SHOP   = 'winshirt-2.myshopify.com';
const TTL    = 2 * 60 * 60 * 1000;

process.env.SHOPIFY_API_SECRET = SECRET;

// Extraction de verifyCustomerToken depuis la source.
const src = fs.readFileSync(path.join(__dirname, '../routes/app-proxy.js'), 'utf8');
const match = src.match(/function verifyCustomerToken[\s\S]*?\n}/);
assert.ok(match, 'verifyCustomerToken introuvable dans routes/app-proxy.js');
// eslint-disable-next-line no-eval
const verifyCustomerToken = eval(`(${match[0]})`);

/** Reproduit _signCustomerToken. */
function sign(customerId, shop, ttl = TTL) {
  const exp = Date.now() + ttl;
  const sig = crypto.createHmac('sha256', SECRET)
    .update(`${customerId}.${exp}.${shop}`).digest('hex').slice(0, 32);
  return `${customerId}.${exp}.${sig}`;
}

test('un jeton légitime rend l\'identifiant du client', () => {
  assert.equal(verifyCustomerToken(sign('7712345', SHOP), SHOP), '7712345');
});

test('un jeton d\'une autre boutique est rejeté', () => {
  const jeton = sign('7712345', SHOP);
  assert.equal(verifyCustomerToken(jeton, 'autre-boutique.myshopify.com'), null);
});

test('on ne peut pas se faire passer pour un autre client', () => {
  const jeton = sign('7712345', SHOP);
  // Remplacer l'identifiant invalide la signature, qui le couvre.
  const usurpe = '9999999' + jeton.slice(jeton.indexOf('.'));
  assert.equal(verifyCustomerToken(usurpe, SHOP), null);
});

test('une signature falsifiée est rejetée', () => {
  const jeton = sign('7712345', SHOP);
  assert.equal(verifyCustomerToken(jeton.replace(/\.[a-f0-9]{32}$/, '.' + '0'.repeat(32)), SHOP), null);
  // Signature de la bonne longueur mais tirée d'un autre secret.
  const exp = jeton.split('.')[1];
  const faux = crypto.createHmac('sha256', 'mauvais-secret')
    .update(`7712345.${exp}.${SHOP}`).digest('hex').slice(0, 32);
  assert.equal(verifyCustomerToken(`7712345.${exp}.${faux}`, SHOP), null);
});

test('un jeton expiré est rejeté', () => {
  assert.equal(verifyCustomerToken(sign('7712345', SHOP, -1000), SHOP), null);
});

test('les jetons malformés sont rejetés sans lever d\'exception', () => {
  for (const bad of ['', 'nimportequoi', 'a.b.c', '7712345.abc.def',
                     '7712345.' + (Date.now() + TTL), null, undefined, 42, {}]) {
    assert.equal(verifyCustomerToken(bad, SHOP), null, JSON.stringify(bad));
  }
});

test('sans secret configuré, aucun jeton n\'est accepté', () => {
  const sauvegarde = process.env.SHOPIFY_API_SECRET;
  const jeton = sign('7712345', SHOP);
  process.env.SHOPIFY_API_SECRET = '';
  try {
    assert.equal(verifyCustomerToken(jeton, SHOP), null);
  } finally {
    process.env.SHOPIFY_API_SECRET = sauvegarde;
  }
});
