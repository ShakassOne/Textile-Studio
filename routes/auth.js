'use strict';
const express   = require('express');
const router    = express.Router();
const crypto    = require('crypto');
const fs        = require('fs');
const path      = require('path');
const rateLimit = require('express-rate-limit');

// ── Rate limiting — max 10 tentatives de login par IP toutes les 15 min
const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              10,              // 10 tentatives max
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
  skipSuccessfulRequests: true,      // Ne compte pas les connexions réussies
});

const ENV_PATH = path.join(__dirname, '../.env');

// Credentials live — modifiables à chaud via l'API
let ADMIN_USER = process.env.ADMIN_USER     || 'admin';
let ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin1234';
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

// Sessions actives (en mémoire — suffit pour un seul admin)
const activeSessions = new Map();

// Purge sessions expirées toutes les 30 min
setInterval(() => {
  const now = Date.now();
  for (const [tok, s] of activeSessions) {
    if (s.expires < now) activeSessions.delete(tok);
  }
}, 30 * 60 * 1000);

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// POST /api/auth/login (rate-limited)
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    setTimeout(() => res.status(401).json({ error: 'Invalid credentials' }), 500);
    return;
  }
  const token   = generateToken();
  const expires = Date.now() + 8 * 60 * 60 * 1000; // 8h
  activeSessions.set(token, { username, expires, loginAt: new Date().toISOString() });
  console.log(`🔑  Admin login: ${username} (${activeSessions.size} active sessions)`);
  res.json({ token, username, expires });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) activeSessions.delete(token);
  res.json({ ok: true });
});

// GET /api/auth/me — verify token
router.get('/me', (req, res) => {
  const token   = req.headers.authorization?.replace('Bearer ', '');
  const session = token ? activeSessions.get(token) : null;
  if (!session || session.expires < Date.now()) {
    if (session) activeSessions.delete(token);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ username: session.username, expires: session.expires, loginAt: session.loginAt });
});

// POST /api/auth/change-password — modifie les credentials à chaud
router.post('/change-password', requireAuth, (req, res) => {
  // Accepter 'oldPassword' (admin UI) ou 'currentPassword' (compat legacy)
  const { oldPassword, currentPassword, newPassword, newUsername } = req.body || {};
  const supplied = oldPassword || currentPassword;
  if (!supplied) return res.status(400).json({ error: 'oldPassword required' });
  if (supplied !== ADMIN_PASS) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  }
  if (newPassword && newPassword.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères' });
  }

  // Mettre à jour en mémoire
  if (newPassword)  ADMIN_PASS = newPassword;
  if (newUsername && newUsername.trim()) ADMIN_USER = newUsername.trim();

  // Persister dans .env si le fichier existe
  try {
    if (fs.existsSync(ENV_PATH)) {
      let envContent = fs.readFileSync(ENV_PATH, 'utf8');
      if (newPassword) {
        envContent = envContent.replace(/^ADMIN_PASSWORD=.*/m, `ADMIN_PASSWORD=${newPassword}`);
        if (!envContent.includes('ADMIN_PASSWORD=')) envContent += `\nADMIN_PASSWORD=${newPassword}`;
      }
      if (newUsername) {
        envContent = envContent.replace(/^ADMIN_USER=.*/m, `ADMIN_USER=${newUsername.trim()}`);
        if (!envContent.includes('ADMIN_USER=')) envContent += `\nADMIN_USER=${newUsername.trim()}`;
      }
      fs.writeFileSync(ENV_PATH, envContent, 'utf8');
    }
  } catch (e) {
    console.warn('Could not persist .env changes:', e.message);
  }

  // Invalider toutes les autres sessions (sécurité)
  const currentToken = req.headers.authorization?.replace('Bearer ', '');
  for (const [tok] of activeSessions) {
    if (tok !== currentToken) activeSessions.delete(tok);
  }

  console.log(`🔑  Password changed for ${ADMIN_USER}`);
  res.json({ ok: true, username: ADMIN_USER, message: 'Credentials mis à jour. Les autres sessions ont été déconnectées.' });
});

// GET /api/auth/sessions — liste les sessions actives (admin info)
router.get('/sessions', requireAuth, (req, res) => {
  const now  = Date.now();
  const list = [];
  for (const [tok, s] of activeSessions) {
    if (s.expires > now) {
      list.push({
        token: tok.slice(0, 8) + '…', // masqué
        username: s.username,
        loginAt: s.loginAt,
        expiresIn: Math.round((s.expires - now) / 60000) + ' min',
      });
    }
  }
  res.json({ sessions: list, count: list.length });
});

// Middleware export
function requireAuth(req, res, next) {
  const token   = req.headers.authorization?.replace('Bearer ', '');
  const session = token ? activeSessions.get(token) : null;
  if (!session || session.expires < Date.now()) {
    if (session) activeSessions.delete(token);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.admin = { username: session.username };
  next();
}

module.exports = router;
module.exports.requireAuth = requireAuth;
