'use strict';
const express   = require('express');
const router    = express.Router();
const crypto    = require('crypto');
const argon2    = require('argon2');
const rateLimit = require('express-rate-limit');
const { getDB } = require('../db/database');

// ─── Admin settings helpers — table admin_settings (NON scopée par shop)
//     Audit B1 : la table `settings` est désormais scopée par shop_id ; les credentials
//     admin TextileLab (super-admin global) vivent dans `admin_settings`.
function getSetting(key) {
  try { return getDB().prepare('SELECT value FROM admin_settings WHERE key=?').get(key)?.value || ''; }
  catch { return ''; }
}
function setSetting(key, value) {
  getDB().prepare(
    "INSERT INTO admin_settings(key,value,updated_at) VALUES(?,?,datetime('now')) " +
    "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
  ).run(key, String(value));
}

// ─── Rate limiting — max 10 tentatives de login par IP toutes les 15 min
const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              10,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
  skipSuccessfulRequests: true,
});

// ─── Secret de session (doit être défini en env en prod) ────────────────
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.TOKEN_SECRET) {
  console.warn('⚠️  TOKEN_SECRET not set — using ephemeral secret (sessions perdues au redémarrage).');
}

// ─── Bootstrap credentials
// Au 1er boot, hash ADMIN_PASSWORD (env) avec argon2 et stocke en DB.
// Ensuite, ADMIN_PASSWORD env est IGNORÉ — la DB fait foi.
// Absolument aucun fallback de type 'admin1234'. Si ADMIN_PASSWORD manque au 1er boot,
// l'app refuse de démarrer avec un admin valide.
let _bootstrapped = false;
async function ensureCredentialsBootstrapped() {
  if (_bootstrapped) return;
  const existingHash = getSetting('admin_password_hash');
  if (existingHash) {
    _bootstrapped = true;
    return;
  }
  const envPassword = process.env.ADMIN_PASSWORD;
  if (!envPassword || envPassword.length < 8) {
    throw new Error(
      'SECURITY: No admin password configured. Set ADMIN_PASSWORD (≥8 chars) in environment ' +
      'for first-boot hashing, OR set admin_password_hash directly in the settings table.'
    );
  }
  console.log('🔐 First boot: hashing ADMIN_PASSWORD with argon2id...');
  const hash = await argon2.hash(envPassword, {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB (OWASP 2024)
    timeCost:   2,
    parallelism: 1,
  });
  setSetting('admin_password_hash', hash);
  if (!getSetting('admin_username')) {
    setSetting('admin_username', process.env.ADMIN_USER || 'admin');
  }
  _bootstrapped = true;
  console.log('✅ Admin credentials bootstrapped in DB. You can now remove ADMIN_PASSWORD from env.');
}

// Déclenche le bootstrap au démarrage (async, l'app tournera dès que la DB est prête)
setImmediate(() => {
  Promise.resolve(ensureCredentialsBootstrapped())
    .catch(err => {
      console.error('❌ Admin credentials bootstrap failed:', err.message);
      console.error('    The /login endpoint will reject all attempts until fixed.');
    });
});

// ─── Helpers ────────────────────────────────────────────────────────────
function getAdminUsername() {
  return getSetting('admin_username') || process.env.ADMIN_USER || 'admin';
}

/** Timing-safe username comparison (pads to equal length to avoid length leak) */
function usernameMatches(supplied, expected) {
  const a = Buffer.from(String(supplied || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (a.length !== b.length) {
    // Même en cas de mismatch, on dépense un compare pour ne pas leaker la longueur.
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// ─── Sessions persistées en DB (survivent aux redéploiements Railway) ───
// Fix suppression designs 2026-06-12 : les sessions vivaient en RAM →
// chaque redeploy/restart Railway invalidait les tokens admin → 401
// silencieux dans le back-office (suppressions « fantômes » : toast OK
// mais rien de supprimé). On persiste désormais la map dans admin_settings,
// clé = sha256(token) — jamais le token en clair en DB.
const activeSessions = new Map(); // clé: sha256(token) → { username, expires, loginAt }
const SESSIONS_KEY = 'admin_sessions_json';

function _sessKey(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}
function _persistSessions() {
  try {
    const obj = {};
    for (const [k, s] of activeSessions) obj[k] = s;
    setSetting(SESSIONS_KEY, JSON.stringify(obj));
  } catch (e) { console.warn('⚠️  persist admin sessions failed:', e.message); }
}
function _restoreSessions() {
  try {
    const raw = getSetting(SESSIONS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    const now = Date.now();
    for (const [k, s] of Object.entries(obj)) {
      if (s && s.expires > now) activeSessions.set(k, s);
    }
    if (activeSessions.size) {
      console.log(`🔑  ${activeSessions.size} session(s) admin restaurée(s) depuis la DB`);
    }
  } catch (e) { console.warn('⚠️  restore admin sessions failed:', e.message); }
}
setImmediate(_restoreSessions); // après init DB (même pattern que le bootstrap credentials)

function sessGet(token)    { return token ? activeSessions.get(_sessKey(token)) : null; }
function sessSet(token, s) { activeSessions.set(_sessKey(token), s); _persistSessions(); }
function sessDelete(token) { if (token && activeSessions.delete(_sessKey(token))) _persistSessions(); }

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [k, s] of activeSessions) {
    if (s.expires < now) { activeSessions.delete(k); changed = true; }
  }
  if (changed) _persistSessions();
}, 30 * 60 * 1000);

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── POST /api/auth/login ───────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  try {
    await ensureCredentialsBootstrapped();
  } catch (e) {
    console.error('Login blocked — credentials not bootstrapped:', e.message);
    return res.status(503).json({ error: 'Service unavailable — admin not configured' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  const storedHash = getSetting('admin_password_hash');
  const expectedUser = getAdminUsername();

  if (!storedHash) {
    // Ne devrait jamais arriver après bootstrap, mais on se protège.
    // On dépense quand même un argon2.verify pour ne pas leaker via timing.
    try { await argon2.verify('$argon2id$v=19$m=19456,t=2,p=1$decoy$decoy', password); } catch {}
    return setTimeout(() => res.status(401).json({ error: 'Invalid credentials' }), 500);
  }

  let passwordOk = false;
  try {
    passwordOk = await argon2.verify(storedHash, password);
  } catch (e) {
    console.error('argon2.verify error:', e.message);
    passwordOk = false;
  }

  const userOk = usernameMatches(username, expectedUser);
  if (!userOk || !passwordOk) {
    return setTimeout(() => res.status(401).json({ error: 'Invalid credentials' }), 500);
  }

  // Rehash si les paramètres argon2 ont changé (opportunistic upgrade)
  try {
    if (argon2.needsRehash(storedHash, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })) {
      const newHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
      setSetting('admin_password_hash', newHash);
      console.log('🔐 admin hash rehashed with current params');
    }
  } catch {}

  const token   = generateToken();
  const expires = Date.now() + 8 * 60 * 60 * 1000; // 8h
  sessSet(token, { username: expectedUser, expires, loginAt: new Date().toISOString() });
  console.log(`🔑  Admin login: ${expectedUser} (${activeSessions.size} active sessions)`);
  res.json({ token, username: expectedUser, expires });
});

// ─── POST /api/auth/logout ──────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) sessDelete(token);
  res.json({ ok: true });
});

// ─── GET /api/auth/me — vérification token ──────────────────────────────
router.get('/me', (req, res) => {
  const token   = req.headers.authorization?.replace('Bearer ', '');
  const session = sessGet(token);
  if (!session || session.expires < Date.now()) {
    if (session) sessDelete(token);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ username: session.username, expires: session.expires, loginAt: session.loginAt });
});

// ─── POST /api/auth/change-password ─────────────────────────────────────
// Mise à jour du hash en DB (plus de réécriture de .env).
router.post('/change-password', requireAuth, async (req, res) => {
  const { oldPassword, currentPassword, newPassword, newUsername } = req.body || {};
  const supplied = oldPassword || currentPassword;
  if (!supplied) return res.status(400).json({ error: 'oldPassword required' });

  const storedHash = getSetting('admin_password_hash');
  if (!storedHash) return res.status(503).json({ error: 'Service unavailable — admin not configured' });

  let oldOk = false;
  try { oldOk = await argon2.verify(storedHash, supplied); }
  catch (e) { console.error('argon2.verify error:', e.message); }
  if (!oldOk) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

  if (newPassword !== undefined && newPassword !== null && newPassword !== '') {
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères' });
    }
    const newHash = await argon2.hash(newPassword, {
      type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
    });
    setSetting('admin_password_hash', newHash);
  }

  if (newUsername && newUsername.trim()) {
    setSetting('admin_username', newUsername.trim());
  }

  // Invalider toutes les autres sessions (sécurité)
  const currentKey = _sessKey(req.headers.authorization?.replace('Bearer ', '') || '');
  for (const [k] of activeSessions) {
    if (k !== currentKey) activeSessions.delete(k);
  }
  _persistSessions();

  const username = getAdminUsername();
  console.log(`🔑  Password changed for ${username}`);
  res.json({ ok: true, username, message: 'Credentials mis à jour. Les autres sessions ont été déconnectées.' });
});

// ─── GET /api/auth/sessions — liste des sessions actives ────────────────
router.get('/sessions', requireAuth, (req, res) => {
  const now  = Date.now();
  const list = [];
  for (const [tok, s] of activeSessions) {
    if (s.expires > now) {
      list.push({
        token: tok.slice(0, 8) + '…',
        username: s.username,
        loginAt: s.loginAt,
        expiresIn: Math.round((s.expires - now) / 60000) + ' min',
      });
    }
  }
  res.json({ sessions: list, count: list.length });
});

// ─── Middleware exporté ─────────────────────────────────────────────────
// Auth duale (fix review Shopify 4.5.4) :
//   1. Token de session TextileLab (admin global Alan — login classique)
//   2. Session token Shopify (JWT App Bridge) — permet aux marchands ET au
//      reviewer Shopify d'utiliser le back-office dans l'iframe admin
//      Shopify SANS credentials TextileLab dédiés. Le shop est résolu depuis
//      le claim `dest` du JWT (+ auto-provisioning Managed Installation),
//      et req.shopRecord/shopId sont posés pour le scoping multi-tenant
//      (repris en priorité 1 par attachShopId — cf. routes/_shop-context.js).
async function requireAuth(req, res, next) {
  const token   = req.headers.authorization?.replace('Bearer ', '');
  const session = sessGet(token);

  // 1. Session TextileLab classique
  if (session && session.expires >= Date.now()) {
    req.admin = { username: session.username };
    return next();
  }
  if (session) sessDelete(token);

  // 2. Fallback : session token Shopify (JWT = 3 segments base64)
  if (token && token.split('.').length === 3) {
    try {
      // require lazy pour éviter tout cycle de dépendances au boot
      const shopifySession = require('./shopify-session');
      const secret = process.env.SHOPIFY_API_SECRET || '';
      if (secret && typeof shopifySession.verifyJWT === 'function') {
        const payload = shopifySession.verifyJWT(token, secret);
        const shop = (payload.dest || '').replace('https://', '').toLowerCase();
        const record = typeof shopifySession.ensureShopProvisioned === 'function'
          ? await shopifySession.ensureShopProvisioned(shop, token)
          : null;
        if (record) {
          req.admin      = { username: shop, viaShopify: true };
          req.shopDomain = shop;
          req.shopRecord = record;
          req.shopId     = record.id;
          return next();
        }
      }
    } catch (e) {
      // JWT invalide/expiré → 401 ci-dessous (App Bridge redemande un token frais)
    }
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

module.exports = router;
module.exports.requireAuth = requireAuth;
