'use strict';
/**
 * db/settings.js — Helper centralisé pour la table `settings` multi-tenant.
 *
 * Particularité : les clés listées dans SECRET_KEYS sont AUTOMATIQUEMENT
 * chiffrées en écriture (AES-256-GCM via utils/crypto.js) et déchiffrées
 * en lecture. La table SQLite stocke alors la valeur sous la forme
 * "enc.v1:iv:tag:ct" (chaîne base64 — voir utils/crypto.js).
 *
 * Utilisation :
 *   const { getSetting, setSetting } = require('../db/settings');
 *   setSetting(shopId, 'openai_api_key', 'sk-xxxxx');   // chiffré en DB
 *   const k = getSetting(shopId, 'openai_api_key');     // déchiffré en mémoire
 *
 *   setSetting(shopId, 'theme_color', '#F59E0B');       // non chiffré (clé non sensible)
 *
 * Audit : la migration `migrateEncryptSecrets()` (appelée au démarrage du serveur)
 * détecte les valeurs en clair existantes pour les clés sensibles et les chiffre
 * en place. Idempotente — peut être ré-exécutée sans risque.
 */

const { getDB } = require('./database');
const { encrypt, decrypt, isEncrypted } = require('../utils/crypto');

// ── Liste des clés dont la valeur est sensible et doit être chiffrée en DB ──
// Ajouter ici toute nouvelle clé secrète stockée par shop dans la table settings.
// Note : les secrets globaux (SHOPIFY_API_SECRET, SMTP_PASS, RESEND_API_KEY) sont
// en variables d'env Railway et ne passent PAS par cette table — donc rien à
// faire pour eux ici.
const SECRET_KEYS = new Set([
  'openai_api_key',
  // 'stripe_secret_key',  // exemple futur
  // 'sendgrid_api_key',   // si un jour stocké par shop
]);

function isSecretKey(key) {
  return SECRET_KEYS.has(String(key));
}

/**
 * Lit la valeur d'une clé pour un shop donné. Retourne '' si absente.
 * Si la clé est sensible et la valeur stockée chiffrée, déchiffre automatiquement.
 *
 * @param {number} shopId
 * @param {string} key
 * @returns {string} valeur en clair ('' si absente ou erreur de déchiffrement)
 */
function getSetting(shopId, key) {
  try {
    const row = getDB()
      .prepare('SELECT value FROM settings WHERE shop_id=? AND key=?')
      .get(shopId, key);

    if (!row || row.value == null) return '';
    const stored = row.value;
    if (!stored) return '';

    if (isSecretKey(key) && isEncrypted(stored)) {
      try {
        return decrypt(stored);
      } catch (e) {
        // Erreur de déchiffrement (clé rotée, valeur corrompue) → log et retour vide
        // Important : ne PAS retourner la valeur chiffrée brute, sinon on l'enverrait
        // à OpenAI/Shopify et ça fuiterait le ciphertext vers le réseau.
        console.warn(`⚠️  decrypt(shopId=${shopId}, key=${key}) failed: ${e.message}`);
        return '';
      }
    }
    return stored;
  } catch (e) {
    console.warn(`⚠️  getSetting(shopId=${shopId}, key=${key}) failed: ${e.message}`);
    return '';
  }
}

/**
 * Écrit la valeur d'une clé pour un shop donné (UPSERT).
 * Si la clé est sensible, chiffre la valeur avant stockage.
 *
 * @param {number} shopId
 * @param {string} key
 * @param {string} value valeur en clair
 */
function setSetting(shopId, key, value) {
  const stored = (isSecretKey(key) && value) ? encrypt(value) : (value ?? '');
  getDB()
    .prepare(
      "INSERT INTO settings (shop_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now')) " +
      "ON CONFLICT(shop_id, key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
    )
    .run(shopId, key, stored);
}

/**
 * Supprime une clé pour un shop donné.
 * @param {number} shopId
 * @param {string} key
 */
function deleteSetting(shopId, key) {
  getDB()
    .prepare('DELETE FROM settings WHERE shop_id=? AND key=?')
    .run(shopId, key);
}

/**
 * Lit toutes les clés non sensibles d'un shop (utile pour exposer à l'admin sans fuite).
 * Les clés sensibles sont OMISES — utiliser getSetting() explicitement pour y accéder.
 * @param {number} shopId
 * @returns {Object<string,string>}
 */
function getAllNonSecretSettings(shopId) {
  const rows = getDB()
    .prepare('SELECT key, value FROM settings WHERE shop_id=?')
    .all(shopId);
  const out = {};
  for (const r of rows) {
    if (!isSecretKey(r.key)) out[r.key] = r.value;
  }
  return out;
}

/**
 * Migration au démarrage : pour chaque clé sensible, parcourt la table settings
 * et chiffre les valeurs encore en clair (legacy avant M5). Idempotente.
 *
 * À appeler une fois après initDB(), depuis server.js.
 */
function migrateEncryptSecrets() {
  let migrated = 0;
  let alreadyEncrypted = 0;
  let errors = 0;

  try {
    const db = getDB();
    for (const key of SECRET_KEYS) {
      const rows = db
        .prepare('SELECT shop_id, value FROM settings WHERE key=?')
        .all(key);
      for (const row of rows) {
        if (!row.value) continue;
        if (isEncrypted(row.value)) {
          alreadyEncrypted++;
          continue;
        }
        try {
          const enc = encrypt(row.value);
          db.prepare(
            "UPDATE settings SET value=?, updated_at=datetime('now') WHERE shop_id=? AND key=?"
          ).run(enc, row.shop_id, key);
          migrated++;
        } catch (e) {
          errors++;
          console.error(`❌  migrateEncryptSecrets(${key}, shop_id=${row.shop_id}) failed:`, e.message);
        }
      }
    }
    if (migrated > 0 || errors > 0) {
      console.log(
        `🔐  Migration M5 (chiffrement secrets DB) : ${migrated} chiffré(s), ` +
        `${alreadyEncrypted} déjà chiffré(s), ${errors} erreur(s)`
      );
    } else {
      console.log(`🔐  Migration M5 — rien à migrer (${alreadyEncrypted} secret(s) déjà chiffré(s))`);
    }
  } catch (e) {
    console.warn('⚠️  migrateEncryptSecrets — erreur globale :', e.message);
  }

  return { migrated, alreadyEncrypted, errors };
}

module.exports = {
  getSetting,
  setSetting,
  deleteSetting,
  getAllNonSecretSettings,
  isSecretKey,
  migrateEncryptSecrets,
  SECRET_KEYS,
};
