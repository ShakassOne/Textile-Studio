'use strict';
/**
 * utils/crypto.js — Chiffrement symétrique des secrets stockés en DB (M5)
 *
 * Algorithme : AES-256-GCM
 *   - 32 bytes de clé (256 bits)
 *   - 12 bytes d'IV aléatoire par chiffrement (recommandation NIST pour GCM)
 *   - 16 bytes de tag d'authentification (GCM intégré)
 *
 * Format de sortie (encodé en base64) :
 *   "enc.v1:<iv_b64>:<tag_b64>:<ciphertext_b64>"
 *
 * Le préfixe permet de :
 *   1. Détecter à la lecture si la valeur est chiffrée (vs. legacy en clair)
 *   2. Versionner le format pour de futures évolutions (enc.v2:..., enc.v3:...)
 *
 * Source de la clé :
 *   1. process.env.ENCRYPTION_KEY (32 bytes en base64, recommandé)
 *      → générer avec : node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *   2. Fallback : dérivation SHA-256 depuis SHOPIFY_API_SECRET (suffisant en dev,
 *      à rotater en prod en migrant explicitement vers ENCRYPTION_KEY)
 *   3. Sans aucune des deux : throw → on refuse de chiffrer (ne pas masquer un secret avec une clé "vide")
 */

const crypto = require('crypto');

const ALGO       = 'aes-256-gcm';
const PREFIX     = 'enc.v1:';
const IV_LENGTH  = 12; // 96 bits — recommandation NIST pour GCM
const KEY_LENGTH = 32; // 256 bits

let _cachedKey = null;
let _cachedKeySource = null; // pour log/debug

function _resolveKey() {
  if (_cachedKey) return _cachedKey;

  const raw = process.env.ENCRYPTION_KEY || '';
  if (raw) {
    let key;
    // Tenter base64 (longueur 44 caractères pour 32 bytes)
    if (/^[A-Za-z0-9+/=]+$/.test(raw) && raw.length >= 43) {
      try {
        const decoded = Buffer.from(raw, 'base64');
        if (decoded.length === KEY_LENGTH) key = decoded;
      } catch { /* ignore */ }
    }
    // Sinon dériver via SHA-256 pour garantir 32 bytes
    if (!key) {
      key = crypto.createHash('sha256').update(raw).digest();
    }
    _cachedKey = key;
    _cachedKeySource = 'ENCRYPTION_KEY';
    return _cachedKey;
  }

  // Fallback dev : dériver depuis SHOPIFY_API_SECRET
  const fallback = process.env.SHOPIFY_API_SECRET || '';
  if (fallback) {
    _cachedKey = crypto
      .createHash('sha256')
      .update(fallback + '|tsl-encryption-fallback-v1')
      .digest();
    _cachedKeySource = 'SHOPIFY_API_SECRET (fallback)';
    return _cachedKey;
  }

  throw new Error(
    "Chiffrement impossible : ni ENCRYPTION_KEY ni SHOPIFY_API_SECRET ne sont définis. " +
    "Générer une clé avec : node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
  );
}

/**
 * Indique si une valeur est déjà chiffrée par ce module.
 * @param {string} value
 * @returns {boolean}
 */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Chiffre un texte UTF-8. Idempotent : si déjà chiffré, retourne tel quel.
 * Une chaîne vide est retournée vide (rien à protéger).
 * @param {string} plaintext
 * @returns {string} format "enc.v1:iv:tag:ct" ou '' si vide
 */
function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return '';
  if (isEncrypted(plaintext)) return plaintext;

  const key    = _resolveKey();
  const iv     = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc    = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return PREFIX +
    iv.toString('base64')  + ':' +
    tag.toString('base64') + ':' +
    enc.toString('base64');
}

/**
 * Déchiffre une valeur. Si elle n'est pas au format chiffré (legacy clear text),
 * elle est retournée telle quelle — utile pendant la migration progressive.
 * @param {string} value
 * @returns {string} texte clair
 */
function decrypt(value) {
  if (value == null || value === '') return '';
  if (!isEncrypted(value)) return value; // legacy clear text — compat ascendante

  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Format chiffré invalide (attendu enc.v1:iv:tag:ct)');
  }

  const iv   = Buffer.from(parts[0], 'base64');
  const tag  = Buffer.from(parts[1], 'base64');
  const data = Buffer.from(parts[2], 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`IV de taille incorrecte (${iv.length} bytes, attendu ${IV_LENGTH})`);
  }

  const decipher = crypto.createDecipheriv(ALGO, _resolveKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

/**
 * Génère une nouvelle clé de chiffrement (32 bytes, base64) pour ENCRYPTION_KEY.
 * À utiliser depuis un script de provisionnement.
 */
function generateKey() {
  return crypto.randomBytes(KEY_LENGTH).toString('base64');
}

/**
 * Indique d'où vient la clé courante (pour logs au démarrage).
 * @returns {string}
 */
function keySource() {
  // Forcer la résolution si pas encore fait
  try { _resolveKey(); } catch { return 'NONE'; }
  return _cachedKeySource || 'NONE';
}

module.exports = {
  encrypt,
  decrypt,
  isEncrypted,
  generateKey,
  keySource,
  // Export pour tests uniquement
  _PREFIX: PREFIX,
};
