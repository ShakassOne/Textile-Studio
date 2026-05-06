#!/usr/bin/env node
'use strict';
/**
 * scripts/test-crypto.js — Tests unitaires manuels pour utils/crypto.js
 *
 * Usage : node scripts/test-crypto.js
 *
 * NB : ce script DÉFINIT process.env.ENCRYPTION_KEY avant d'importer le module
 * de chiffrement, pour tester de bout en bout sans dépendre de l'environnement
 * réel. Il ne touche pas la DB.
 */

// ── Setup env de test (avant require du module crypto !) ─────────────────────
process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');

const assert = require('node:assert');
const { encrypt, decrypt, isEncrypted, generateKey, keySource, _PREFIX } = require('../utils/crypto');

let tests = 0;
let pass  = 0;

function test(name, fn) {
  tests++;
  try {
    fn();
    pass++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.error(`  ❌ ${name}\n     → ${err.message}`);
  }
}

console.log(`\n🧪  utils/crypto.js — tests`);
console.log(`   Source clé : ${keySource()}\n`);

test('round-trip simple', () => {
  const plain = 'sk-proj-1234567890abcdef';
  const enc   = encrypt(plain);
  assert.notStrictEqual(enc, plain, 'le chiffré ne doit pas être égal au clair');
  assert.ok(enc.startsWith(_PREFIX), 'le chiffré doit avoir le préfixe enc.v1:');
  const dec = decrypt(enc);
  assert.strictEqual(dec, plain, 'le déchiffré doit être égal au clair original');
});

test('chiffrement non-déterministe (IV aléatoire)', () => {
  const plain = 'sk-test';
  const e1 = encrypt(plain);
  const e2 = encrypt(plain);
  assert.notStrictEqual(e1, e2, 'deux chiffrements du même clair doivent donner des sorties différentes');
  assert.strictEqual(decrypt(e1), plain);
  assert.strictEqual(decrypt(e2), plain);
});

test('chaîne vide → chaîne vide', () => {
  assert.strictEqual(encrypt(''), '');
  assert.strictEqual(encrypt(null), '');
  assert.strictEqual(encrypt(undefined), '');
  assert.strictEqual(decrypt(''), '');
});

test('idempotence : chiffrer un déjà-chiffré ne re-chiffre pas', () => {
  const plain = 'hello';
  const e1 = encrypt(plain);
  const e2 = encrypt(e1);
  assert.strictEqual(e1, e2, 'encrypt(encrypt(x)) doit retourner encrypt(x) tel quel');
});

test('decrypt sur clear text legacy retourne tel quel', () => {
  const legacy = 'sk-clear-text-legacy';
  assert.strictEqual(decrypt(legacy), legacy, 'pas de PREFIX → retour tel quel (compat ascendante)');
});

test('isEncrypted détecte correctement', () => {
  assert.strictEqual(isEncrypted('enc.v1:aaa:bbb:ccc'), true);
  assert.strictEqual(isEncrypted('sk-clear'), false);
  assert.strictEqual(isEncrypted(''), false);
  assert.strictEqual(isEncrypted(null), false);
});

test('format malformé → throw', () => {
  assert.throws(() => decrypt('enc.v1:notvalid'), /invalide/i);
});

test('UTF-8 multi-octets (emoji, accents)', () => {
  const plain = 'Mot de passe : café ☕ avec un €uro 🎨';
  const enc = encrypt(plain);
  assert.strictEqual(decrypt(enc), plain);
});

test('grand payload (8 KB)', () => {
  const big = 'x'.repeat(8192);
  const enc = encrypt(big);
  assert.strictEqual(decrypt(enc), big);
});

test('tampering : mauvais tag → throw', () => {
  const plain = 'sk-secret';
  const enc = encrypt(plain);
  // Corrompre le tag (3e segment)
  const parts = enc.slice(_PREFIX.length).split(':');
  const corruptedTag = Buffer.from(parts[1], 'base64');
  corruptedTag[0] ^= 0xff;
  const tampered = _PREFIX + parts[0] + ':' + corruptedTag.toString('base64') + ':' + parts[2];
  assert.throws(() => decrypt(tampered), /unsupported|auth|tag|gcm/i);
});

test('generateKey produit 32 bytes en base64', () => {
  const k = generateKey();
  const buf = Buffer.from(k, 'base64');
  assert.strictEqual(buf.length, 32);
});

console.log(`\n📊  ${pass}/${tests} tests réussis\n`);
process.exit(pass === tests ? 0 : 1);
