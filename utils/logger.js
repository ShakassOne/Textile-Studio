'use strict';

/**
 * logger.js — Logger structuré minimal, zéro dépendance (audit N6).
 *
 * Émet des logs en JSON ligne-par-ligne en production (filtrables : jq, Railway,
 * Datadog, etc.) et en format lisible en développement. Remplace progressivement
 * les console.log dispersés ; l'adoption peut se faire fichier par fichier.
 *
 * Configuration via variables d'environnement :
 *   - LOG_LEVEL  = debug | info | warn | error   (défaut : info)
 *   - LOG_PRETTY = 1                              (force le format lisible)
 *
 * Usage :
 *   const logger = require('./utils/logger');
 *   logger.info('serveur démarré', { port: 3001 });
 *   logger.error('échec upload', { err: e.message, design_id });
 *   app.use(logger.httpMiddleware());   // log structuré de chaque requête
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const THRESHOLD = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;
const PRETTY = process.env.LOG_PRETTY === '1' || process.env.NODE_ENV !== 'production';

// Chemins à ne pas logger en HTTP (bruit : assets statiques, health-checks).
const HTTP_SKIP_PREFIX = ['/uploads', '/assets', '/favicon', '/sw.js', '/manifest.json', '/health'];
const HTTP_SKIP_EXT = /\.(png|jpe?g|webp|gif|svg|ico|css|js|map|woff2?|ttf)$/i;

function emit(level, msg, fields) {
  if (LEVELS[level] < THRESHOLD) return;
  const hasFields = fields && typeof fields === 'object' && Object.keys(fields).length > 0;
  const time = new Date().toISOString();
  let line;
  if (PRETTY) {
    line = `${time} ${level.toUpperCase().padEnd(5)} ${msg}` + (hasFields ? ' ' + safeJson(fields) : '');
  } else {
    line = safeJson({ level, time, msg: String(msg), ...(hasFields ? fields : {}) });
  }
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
}

// JSON.stringify robuste (jamais throw, gère les références circulaires).
function safeJson(obj) {
  try { return JSON.stringify(obj); }
  catch { try { return JSON.stringify(obj, circularReplacer()); } catch { return '"[unserializable]"'; } }
}
function circularReplacer() {
  const seen = new WeakSet();
  return (k, v) => {
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[circular]';
      seen.add(v);
    }
    return v;
  };
}

const logger = {
  debug: (msg, fields) => emit('debug', msg, fields),
  info:  (msg, fields) => emit('info',  msg, fields),
  warn:  (msg, fields) => emit('warn',  msg, fields),
  error: (msg, fields) => emit('error', msg, fields),

  /**
   * Middleware Express : log structuré de chaque requête API (méthode, path,
   * statut, durée ms, shop). N'altère jamais la réponse. Ignore les assets
   * statiques et les health-checks pour limiter le bruit.
   */
  httpMiddleware() {
    return (req, res, next) => {
      const p = req.path || req.url || '';
      if (HTTP_SKIP_PREFIX.some((pre) => p.startsWith(pre)) || HTTP_SKIP_EXT.test(p)) {
        return next();
      }
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        emit(level, 'http_request', {
          method: req.method,
          path:   p,
          status: res.statusCode,
          ms:     Math.round(ms),
          shop:   req.shopDomain || undefined,
        });
      });
      next();
    };
  },
};

module.exports = logger;
