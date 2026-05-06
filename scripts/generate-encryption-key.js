#!/usr/bin/env node
'use strict';
/**
 * scripts/generate-encryption-key.js
 *
 * Génère une clé AES-256 (32 bytes) en base64, prête à être collée dans
 * la variable d'environnement ENCRYPTION_KEY (Railway, .env local, etc.).
 *
 * Usage : node scripts/generate-encryption-key.js
 */
const { generateKey } = require('../utils/crypto');

const key = generateKey();
console.log('');
console.log('Clé générée (32 bytes, AES-256, base64) :');
console.log('');
console.log('  ENCRYPTION_KEY=' + key);
console.log('');
console.log('À déclarer dans Railway → Variables, ou dans .env local.');
console.log('Sans ENCRYPTION_KEY, le chiffrement utilise un fallback dérivé de');
console.log('SHOPIFY_API_SECRET (acceptable en dev, à éviter en prod).');
console.log('');
console.log('⚠️  Rotation : si tu changes cette clé, les secrets en DB seront');
console.log('   illisibles. Re-saisis-les depuis l\'admin (Paramètres → IA).');
console.log('');
