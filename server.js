'use strict';
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const { initDB } = require('./db/database');
const logger     = require('./utils/logger'); // logger structuré (audit N6)

// ── Répertoire de données (Railway : /data, local : dossier projet) ──────────
// Railway → configurer un Volume avec Mount path = /data dans le dashboard
const DATA_DIR    = process.env.DATA_DIR || __dirname;
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Créer les sous-dossiers uploads si absents (volume vide au premier démarrage)
['', 'library', 'renders', 'models3d', 'generated'].forEach(sub => {
  fs.mkdirSync(path.join(UPLOADS_DIR, sub), { recursive: true });
});
// Dossier dédié aux mockups composés par /api/render/cart-set
fs.mkdirSync(path.join(DATA_DIR, 'renders'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'mockup-templates'), { recursive: true });

// ── Vérification des variables d'env critiques ────────────────────────
if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️  OPENAI_API_KEY non définie dans .env — les fonctions IA seront désactivées.');
}

// ── Sécurité prod : sans SHOPIFY_API_SECRET, toutes les vérifs HMAC/JWT
// (OAuth, App Proxy, session token, webhooks) basculent en bypass "dev".
// On refuse donc de démarrer en production. En dev local, on laisse passer.
if (process.env.NODE_ENV === 'production' && !process.env.SHOPIFY_API_SECRET) {
  console.error('❌ SECURITY: SHOPIFY_API_SECRET manquant en production — arrêt immédiat (auth HMAC/JWT désactivée sinon).');
  process.exit(1);
}

const app  = express();
// Railway est derrière un proxy : nécessaire pour que req.ip = vraie IP client
// (sinon tous les rate-limit par IP partagent l'IP du proxy).
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// ── CORS — Origines autorisées (configurer ALLOWED_ORIGIN dans .env) ──
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Headers Shopify Embedded App
// Permet a Shopify Admin de charger l'app dans une iframe
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com https://*.shopify.com"
  );
  res.removeHeader('X-Frame-Options');
  next();
});

// Audit M2 — match strict sur le hostname pour éviter
//   « evil.shopify.com.attacker.com » qui passait avec `.includes('.shopify.com')`.
const SHOPIFY_ORIGIN_REGEX = /\.(myshopify\.com|shopify\.com)$/;
app.use(cors({
  origin: (origin, cb) => {
    // Autoriser les requêtes sans origin (curl, Postman, server-to-server)
    if (!origin) return cb(null, true);
    // En développement, autoriser localhost
    if (process.env.NODE_ENV !== 'production') return cb(null, true);
    // Toujours autoriser les boutiques Shopify (storefront → notre API)
    try {
      const host = new URL(origin).hostname;
      if (SHOPIFY_ORIGIN_REGEX.test(host)) return cb(null, true);
    } catch (_) { /* origin malformée → on ignore et on tombe sur la whitelist */ }
    // Whitelist configurée dans ALLOWED_ORIGIN
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origine non autorisée — ${origin}`));
  },
  credentials: true,
}));
// Audit M4 — limite globale 1 Mo pour les routes JSON classiques.
// Les routes qui ont besoin de plus (PNG base64 render/mockups/mockup-gen)
// ont leur propre middleware express.json({ limit: '25mb' }) monté en aval.
// On SKIPPE le global pour ces paths, sinon il rejette en 413 AVANT que
// l'override puisse se déclencher (bug introduit avec M4, jamais détecté
// car les payloads /api/render restaient sous 1 Mo dans la majorité des cas).
// Régression M4 corrigée le 2026-05-21 : /api/designs (layers_json = canvas
// avec images base64, souvent plusieurs Mo) et /api/ai (transform + styles
// reçoivent des images base64) tombaient sous la limite globale 1 Mo → 413
// silencieux → design non sauvé (designId null) → plus de _preview_img ni de
// bouton "Voir mon design" dans le drawer, et styles/photo IA cassés.
const HIGH_LIMIT_PATHS = ['/api/render', '/api/mockups', '/api/mockup-gen', '/api/designs', '/api/ai'];
const _isHighLimitPath = (req) => HIGH_LIMIT_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'));
// Webhooks Shopify : body doit rester raw (Buffer) pour la vérification HMAC
const _isRawBodyPath  = (req) => req.path.startsWith('/shopify/webhook') || req.path.startsWith('/shopify/gdpr');
const _jsonGlobal = express.json({ limit: '1mb' });
const _urlGlobal  = express.urlencoded({ extended: true, limit: '1mb' });
app.use((req, res, next) => (_isHighLimitPath(req) || _isRawBodyPath(req)) ? next() : _jsonGlobal(req, res, next));
app.use((req, res, next) => (_isHighLimitPath(req) || _isRawBodyPath(req)) ? next() : _urlGlobal(req, res, next));
// Log structuré des requêtes (audit N6) — ignore assets statiques & health-checks.
app.use(logger.httpMiddleware());
app.use('/uploads', express.static(UPLOADS_DIR, {
  setHeaders: (res, filePath) => {
    // Anti-XSS : les SVG servis depuis /uploads ne doivent jamais exécuter de script.
    // CSP + nosniff neutralisent le SVG comme document, sans casser <img>/fabric.
    if (filePath.toLowerCase().endsWith('.svg')) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  },
}));
// ── Admin embarqué : App Bridge injecté statiquement dans le <head> ────────
// App Bridge 4 doit être chargé au plus tôt dans le <head> : l'injection
// dynamique (setupShopifyEmbed) peut laisser window.shopify indéfini dans
// l'iframe admin → idToken() null → fallback vieux token → 401 sur toutes
// les routes requireAuth (suppression designs impossible en embed).
// En contexte embed (?shop&host), on sert l'admin avec la meta api-key et
// le script CDN directement dans le head — même pattern que shopify-embed.html
// (qui obtient son idToken sans problème). En standalone : fichier statique.
app.get('/textilelab-admin.html', (req, res, next) => {
  if (!req.query.shop || !req.query.host) return next();
  fs.readFile(path.join(__dirname, 'public', 'textilelab-admin.html'), 'utf8', (err, html) => {
    if (err) return next(err);
    // Clé App Bridge = client_id de CETTE app, piloté par l'env (multi-déploiement :
    // app publique vs app Custom WinShirt). Repli sur le client_id public si l'env
    // n'est pas défini → sortie identique sur le déploiement public.
    const apiKey = process.env.SHOPIFY_API_KEY || '9f77ba5672b593f4e6a5d32d2093e460';
    const inject =
      '<meta id="shopify-api-key" name="shopify-api-key" content="' + apiKey + '">' +
      '<script data-shopify-app-bridge="1" src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>';
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(html.replace(/<head>/i, '<head>' + inject));
  });
});
// Servir les fichiers PWA et pages HTML depuis la racine du backend
// Les fichiers HTML ne sont JAMAIS mis en cache (toujours servis frais)
// Les assets statiques (JS, CSS, images) sont cachés 1h
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    // tl-modal.js chargé depuis n'importe quel domaine Shopify via <script src>
    if (filePath.endsWith('tl-modal.js')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  },
}));
// manifest.json à la racine ; sw.js servi depuis public/ avec en-têtes PWA corrects
app.get('/manifest.json', (_req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
app.get('/sw.js', (_req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// ── Aperçu design recto/verso — URL courte et propre ──────────────────────
// /design-preview/:id → sert design-preview.html avec ?id= injecté dans l'URL
// C'est cette URL qu'on met dans les properties Shopify du checkout (lien cliquable)
app.get('/design-preview/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'design-preview.html'));
});

// ── Politique de confidentialité (obligatoire App Store Shopify) ───────────
// URL à déclarer dans Partners Dashboard → App setup → Privacy policy URL
app.get('/privacy', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400'); // cache 24h
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

// ── App Bridge 4 — Point d'entrée Shopify embed ────────────────────────────
// URL à déclarer dans Partners Dashboard → App setup → App URL
// Shopify ouvrira : https://your-app.railway.app/?shop=xxx&host=<base64>
// Le client_id App Bridge est piloté par l'env SHOPIFY_API_KEY (multi-déploiement :
// app publique vs app Custom WinShirt). On lit shopify-embed.html et on remplace la
// clé publique hardcodée par celle de l'env. Repli sur la valeur publique si l'env
// n'est pas défini → sortie identique sur le déploiement public.
app.get('/', (req, res, next) => {
  // Si pas de paramètres Shopify → rediriger vers l'admin standalone
  if (!req.query.shop && !req.query.host) {
    return res.redirect('/textilelab-admin.html');
  }
  fs.readFile(path.join(__dirname, 'public', 'shopify-embed.html'), 'utf8', (err, html) => {
    if (err) return next(err);
    const apiKey = process.env.SHOPIFY_API_KEY || '9f77ba5672b593f4e6a5d32d2093e460';
    const out = html.replace(/9f77ba5672b593f4e6a5d32d2093e460/g, apiKey);
    res.setHeader('Cache-Control', 'no-store'); // pas de cache — host/shop dans l'URL
    res.type('html').send(out);
  });
});

// ── Init DB ────────────────────────────────────────────────────────────
initDB();

// ── Réenregistrement auto orders/paid pour tous les shops (chaque démarrage) ─
// Règle le problème de perte du webhook après redéploiement Railway.
// 201 = créé, 422 = déjà présent → les deux sont OK.
setImmediate(async () => {
  try {
    const db     = require('./db/database').getDB();
    const shops  = db.prepare('SELECT shop_domain, access_token FROM shops WHERE access_token IS NOT NULL AND access_token != ""').all();
    const appUrl = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
    if (!shops.length || !appUrl) {
      console.log('🪝  reRegisterWebhooks — aucun shop en DB ou APP_URL absent');
      return;
    }
    const https = require('https');
    for (const s of shops) {
      await new Promise((resolve) => {
        const body = JSON.stringify({ webhook: { topic: 'orders/paid', address: `${appUrl}/shopify/webhook`, format: 'json' } });
        const r = https.request({
          hostname: s.shop_domain, path: '/admin/api/2024-01/webhooks.json', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Shopify-Access-Token': s.access_token },
        }, (res) => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => {
            if (res.statusCode === 201) console.log(`🪝  orders/paid créé → ${s.shop_domain}`);
            else if (res.statusCode === 422) console.log(`🪝  orders/paid déjà présent → ${s.shop_domain}`);
            else console.warn(`⚠️  orders/paid HTTP ${res.statusCode} → ${s.shop_domain}: ${d.slice(0,120)}`);
            resolve();
          });
        });
        r.on('error', e => { console.warn(`⚠️  orders/paid réseau ${s.shop_domain}: ${e.message}`); resolve(); });
        r.write(body); r.end();
      });
    }
  } catch(e) { console.warn('⚠️  reRegisterWebhooks:', e.message); }
});

// ── M5 : Migration de chiffrement des secrets en DB (idempotente) ──────
// Chiffre les valeurs en clair existantes pour les clés sensibles (openai_api_key…)
// dans la table settings. Voir db/settings.js + utils/crypto.js.
try {
  const { migrateEncryptSecrets } = require('./db/settings');
  const { keySource } = require('./utils/crypto');
  migrateEncryptSecrets();
  console.log(`🔑  Source clé de chiffrement : ${keySource()}`);
} catch (err) {
  console.warn('⚠️  Migration M5 (chiffrement secrets) skip :', err.message);
}

// ── Bootstrap shop OAuth (DEV / staging uniquement) ──────────────────────
// Audit M8 — en production multi-tenant, on ne réinjecte PAS un shop "privilégié"
// hardcodé : chaque marchand passe par le flow OAuth standard. Le bootstrap
// reste utile en dev pour ne pas refaire OAuth à chaque redémarrage.
// Définir SHOPIFY_BOOTSTRAP_SHOP + SHOPIFY_BOOTSTRAP_TOKEN dans .env de dev.
(function bootstrapShop() {
  if (process.env.NODE_ENV === 'production') return;
  const bShop  = process.env.SHOPIFY_BOOTSTRAP_SHOP;
  const bToken = process.env.SHOPIFY_BOOTSTRAP_TOKEN;
  if (!bShop || !bToken) return;
  try {
    const db = require('./db/database').getDB();
    const existing = db.prepare('SELECT id FROM shops WHERE shop_domain = ?').get(bShop);
    if (existing) {
      db.prepare('UPDATE shops SET access_token = ?, is_active = 1 WHERE shop_domain = ?')
        .run(bToken, bShop);
      console.log(`🔄  Bootstrap shop mis à jour : ${bShop}`);
    } else {
      db.prepare('INSERT INTO shops (shop_domain, access_token, is_active) VALUES (?, ?, 1)')
        .run(bShop, bToken);
      console.log(`✅  Bootstrap shop créé : ${bShop}`);
    }
  } catch (err) {
    console.warn('⚠️  Bootstrap shop échoué :', err.message);
  }
})();

// ── Bootstrap webhooks (DEV / staging uniquement) ───────────────────────
// Audit M8 — en production, les webhooks sont déclarés dans shopify.app.toml
// (deploy via shopify CLI) et enregistrés via le callback OAuth. On ne touche
// pas à la boutique d'un marchand au démarrage du serveur en prod.
// 422 = webhook déjà existant → ignoré silencieusement.
(function bootstrapWebhooks() {
  if (process.env.NODE_ENV === 'production') return;
  const shop     = process.env.SHOPIFY_BOOTSTRAP_SHOP;
  const token    = process.env.SHOPIFY_BOOTSTRAP_TOKEN;
  const appUrl   = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
  if (!shop || !token || !appUrl) return;

  const https = require('https');
  function registerWebhook(topic, address) {
    const body = JSON.stringify({ webhook: { topic, address, format: 'json' } });
    const req  = https.request({
      hostname: shop,
      path:     '/admin/api/2024-01/webhooks.json',
      method:   'POST',
      headers: {
        'Content-Type':           'application/json',
        'Content-Length':         Buffer.byteLength(body),
        'X-Shopify-Access-Token': token,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode === 201) console.log(`🪝  Webhook enregistré : ${topic}`);
        else if (res.statusCode === 422) console.log(`🪝  Webhook déjà présent : ${topic}`);
        else console.warn(`⚠️  Webhook ${topic} → HTTP ${res.statusCode}: ${data.slice(0,200)}`);
      });
    });
    req.on('error', err => console.warn(`⚠️  Webhook ${topic} — réseau : ${err.message}`));
    req.write(body);
    req.end();
  }

  registerWebhook('orders/paid',     `${appUrl}/shopify/webhook`);
  registerWebhook('app/uninstalled', `${appUrl}/shopify/webhook`);
})();

// ── Billing API (Shopify App Store — Trial 15j + 19€/mois) ─────────────────

// Créer la table subscriptions au démarrage
(function initSubscriptionsTable() {
  try {
    const db = require('./db/database').getDB();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        shop       TEXT NOT NULL,
        charge_id  TEXT,
        status     TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
    console.log('💳  Table subscriptions prête.');
  } catch (err) {
    console.warn('⚠️  initSubscriptionsTable :', err.message);
  }
})();

// GET /billing/subscribe — Lance la souscription via mutation GraphQL appSubscriptionCreate
app.get('/billing/subscribe', async (req, res) => {
  const shop   = (req.query.shop || process.env.SHOPIFY_BOOTSTRAP_SHOP || '').toLowerCase().trim();
  // Multi-tenant : token OAuth de LA boutique courante (table shops), pas un token ENV global.
  const token  = shop ? (require('./db/database').getShop(shop)?.access_token || null) : null;
  const appUrl = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');

  if (!shop || !token) {
    return res.status(400).json({ error: 'Boutique non installée ou token OAuth introuvable — réinstallez l\'app' });
  }

  const mutation = `
    mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $lineItems: [AppSubscriptionLineItemInput!]!, $trialDays: Int) {
      appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems, trialDays: $trialDays) {
        appSubscription { id status }
        confirmationUrl
        userErrors { field message }
      }
    }
  `;

  const variables = {
    name:      'Textile Studio Lab — Pro',
    trialDays: 15,
    returnUrl: `${appUrl}/billing/callback?shop=${encodeURIComponent(shop)}`,
    lineItems: [{
      plan: {
        appRecurringPricingDetails: {
          price:    { amount: 19.00, currencyCode: 'EUR' },
          interval: 'EVERY_30_DAYS',
        },
      },
    }],
  };

  try {
    const response = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body:    JSON.stringify({ query: mutation, variables }),
    });
    const data   = await response.json();
    const result = data?.data?.appSubscriptionCreate;

    if (result?.userErrors?.length > 0) {
      return res.status(400).json({ error: result.userErrors });
    }
    const confirmationUrl = result?.confirmationUrl;
    if (!confirmationUrl) {
      return res.status(500).json({ error: 'confirmationUrl absent de la réponse Shopify' });
    }
    return res.redirect(confirmationUrl);
  } catch (err) {
    console.error('❌ /billing/subscribe :', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /billing/callback — Shopify redirige ici après confirmation du marchand
app.get('/billing/callback', async (req, res) => {
  const shop     = (req.query.shop || process.env.SHOPIFY_BOOTSTRAP_SHOP || '').toLowerCase().trim();
  const chargeId = req.query.charge_id;
  // Multi-tenant : token OAuth de LA boutique courante (table shops), pas un token ENV global.
  const token    = shop ? (require('./db/database').getShop(shop)?.access_token || null) : null;
  const appUrl   = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');

  if (!shop || !chargeId || !token) {
    return res.status(400).json({ error: 'Paramètres manquants : shop, charge_id ou token.' });
  }

  try {
    // Vérifier le statut réel de la charge auprès de Shopify
    const response = await fetch(
      `https://${shop}/admin/api/2024-01/recurring_application_charges/${chargeId}.json`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );
    const data   = await response.json();
    const status = data?.recurring_application_charge?.status || 'unknown';

    // Persister dans SQLite
    const db = require('./db/database').getDB();
    db.prepare(`
      INSERT INTO subscriptions (shop, charge_id, status, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(shop, String(chargeId), status);

    console.log(`💳  Subscription enregistrée : shop=${shop}  charge_id=${chargeId}  status=${status}`);
    return res.redirect(`${appUrl}/?shop=${encodeURIComponent(shop)}`);
  } catch (err) {
    console.error('❌ /billing/callback :', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Middleware checkSubscription — vérifie l'abonnement actif/trial pour la boutique
function checkSubscription(req, res, next) {
  const shop = req.query.shop || req.headers['x-shopify-shop-domain'];
  if (!shop) return next(); // pas de shop identifiable → laisser passer

  try {
    const db  = require('./db/database').getDB();
    const sub = db.prepare(
      "SELECT id FROM subscriptions WHERE shop = ? AND status IN ('active','trialing') ORDER BY id DESC LIMIT 1"
    ).get(shop);
    if (sub) return next();

    // Aucun abonnement actif → rediriger vers la page de souscription
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    return res.redirect(`${appUrl}/billing/subscribe?shop=${encodeURIComponent(shop)}`);
  } catch (err) {
    console.warn('⚠️  checkSubscription :', err.message);
    return next(); // erreur DB → ne pas bloquer
  }
}

// Appliquer le middleware sur toutes les routes qui suivent
// sauf /auth, /webhooks et /billing (enregistrées ci-dessus, donc non concernées)
app.use((req, res, next) => {
  const exempted = [
    '/api/auth',
    '/auth',
    '/webhooks',
    '/shopify/webhook',   // ← webhooks Shopify ne doivent JAMAIS passer par billing
    '/shopify/gdpr',      // ← idem pour les webhooks GDPR
    '/billing',
    '/oauth',
    '/health',
    '/privacy',
    '/manifest.json',
    '/sw.js',
    // Storefront/public paths that must never be gated by billing redirects
    '/api/product-links/public',
    '/api/product-links/by-mockup',
    '/api/shopify/product-variant',
    '/api/shopify/products',
    '/api/shop-settings/style/public',
    '/textilelab-studio.html',
    '/tl-modal.js',
    '/uploads',
    '/assets',
  ];
  if (exempted.some(p => req.path.startsWith(p))) return next();
  return checkSubscription(req, res, next);
});

// ── Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
// Audit M4 — override 10 Mo : layers_json embarque le canvas (images base64).
// Sans ça, le express.json({limit:'1mb'}) global rejette en 413 → designId null
// → drawer panier sans preview ni bouton "Voir mon design".
app.use('/api/designs',    express.json({ limit: '10mb' }), require('./routes/designs'));
app.use('/api/orders',     require('./routes/orders'));
// Audit M4 — override 10 Mo scopé aux routes qui acceptent du PNG base64.
// Monté AVANT le router pour court-circuiter le express.json({limit:'1mb'}) global.
app.use('/api/render',     express.json({ limit: '10mb' }), require('./routes/render'));
app.use('/api/library',    require('./routes/library'));
app.use('/api/pricing',    require('./routes/pricing'));
// Audit M4 — override 25 Mo : le PUT mockup envoie views[i].imageData (PNG
// base64 du mockup, typiquement 1500×1500 = 2–5 Mo par view), payload total
// 2 views ≈ 8 Mo. Sans cet override, express.json({limit:'1mb'}) global
// rejette silencieusement la requête → mockup pas sauvegardé.
app.use('/api/mockups',    express.json({ limit: '25mb' }), require('./routes/mockups'));
app.use('/api/mockup-gen', express.json({ limit: '10mb' }), require('./routes/mockup-gen'));
app.use('/api/product-categories', require('./routes/product-categories'));
app.use('/api/product-links',      require('./routes/product-links'));
app.use('/api/email',              require('./routes/email'));
app.use('/api/shopify',    require('./routes/storefront'));
// Audit M4 — override 10 Mo : /api/ai/transform (photo → style IA) et
// /api/ai/styles (vignette base64, max 5 Mo décodé) reçoivent des images.
app.use('/api/ai',         express.json({ limit: '10mb' }), require('./routes/ai'));
app.use('/api/qr-frames',  require('./routes/qr-frames'));
app.use('/api/models3d',   require('./routes/models3d'));
app.use('/shopify',              require('./routes/shopify'));
app.use('/oauth',               require('./routes/oauth'));
app.use('/api/shopify-session', require('./routes/shopify-session'));
app.use('/api/admin',          require('./routes/admin-graphql'));
app.use('/api/shop-settings',  require('./routes/shop-settings'));
app.use('/proxy',             require('./routes/app-proxy'));

// ── Fix webhooks : réenregistre orders/paid sur tous les shops actifs ─────────
// Appel unique : GET /api/internal/fix-webhooks?secret=<ADMIN_SECRET>
app.get('/api/internal/fix-webhooks', async (req, res) => {
  const secret = process.env.ADMIN_SECRET || process.env.SHOPIFY_API_SECRET || '';
  if (!secret || req.query.secret !== secret) return res.status(403).json({ error: 'Forbidden' });

  const db = require('./db/database').getDB();
  const shops = db.prepare('SELECT shop_domain, access_token FROM shops WHERE access_token IS NOT NULL').all();
  const APP_URL = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
  const https = require('https');

  const results = [];
  for (const s of shops) {
    await new Promise((resolve) => {
      const body = JSON.stringify({ webhook: { topic: 'orders/paid', address: `${APP_URL}/shopify/webhook`, format: 'json' } });
      const req2 = https.request({
        hostname: s.shop_domain, path: '/admin/api/2024-01/webhooks.json', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Shopify-Access-Token': s.access_token },
      }, (r) => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => {
          const status = r.statusCode === 201 ? 'created' : r.statusCode === 422 ? 'already_exists' : `error_${r.statusCode}`;
          results.push({ shop: s.shop_domain, status });
          console.log(`🪝  fix-webhooks orders/paid → ${s.shop_domain} : ${status}`);
          resolve();
        });
      });
      req2.on('error', (e) => { results.push({ shop: s.shop_domain, status: `network_error: ${e.message}` }); resolve(); });
      req2.write(body); req2.end();
    });
  }
  res.json({ ok: true, results });
});

// ── Stats (admin, scopé shop — audit B1) ───────────────────────────────
const { requireAuth } = require('./routes/auth');
const { attachShopId } = require('./routes/_shop-context');
app.get('/api/stats', requireAuth, attachShopId, (req, res) => {
  const db = require('./db/database').getDB();
  const orders   = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(total_price),0) as revenue FROM orders WHERE shop_id=?').get(req.shopId);
  const designs  = db.prepare('SELECT COUNT(*) as count FROM designs WHERE shop_id=?').get(req.shopId);
  const byProduct = db.prepare(`
    SELECT product, COUNT(*) as count, COALESCE(SUM(total_price),0) as revenue
    FROM orders WHERE shop_id=? GROUP BY product
  `).all(req.shopId);
  const pending  = db.prepare("SELECT COUNT(*) as count FROM orders WHERE shop_id=? AND status='pending'").get(req.shopId);
  const recent   = db.prepare('SELECT * FROM orders WHERE shop_id=? ORDER BY created_at DESC LIMIT 5').all(req.shopId);
  res.json({ orders, designs, byProduct, pending, recent });
});

// ── Health ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, version: '1.0.0', ts: new Date().toISOString() }));

// ── Webhooks GDPR ───────────────────────────────────────────────────────────
// Audit M1 — les 3 webhooks GDPR doublons ont été supprimés ici.
// Les vraies routes sont dans routes/shopify.js (/shopify/gdpr/*) avec :
//   - vérification HMAC base64 timing-safe
//   - raw body parsing
//   - traitement effectif (la table orders stocke customer_name/email, donc
//     répondre 200 aveuglément serait faux côté GDPR).
// Mettre à jour les URLs GDPR dans Partners Dashboard et shopify.app.toml
// pour qu'elles pointent sur /shopify/gdpr/* exclusivement.

// ── Start ──────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info('TextileLab backend démarré', {
    port:     PORT,
    database: 'textilelab.db',
    data_dir: DATA_DIR,
    env:      process.env.NODE_ENV || 'development',
  });
});

// ── Graceful shutdown (audit N5) ─────────────────────────────────────────
// Railway envoie SIGTERM avant de couper le conteneur (redeploy / scale).
// On arrête d'accepter de nouvelles connexions, on laisse les requêtes en
// cours se terminer, puis on ferme proprement la base SQLite avant de sortir.
let _shuttingDown = false;
function gracefulShutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  logger.warn('arrêt en cours', { signal });

  // Filet de sécurité : si une connexion reste bloquée, on force la sortie.
  const forceTimer = setTimeout(() => {
    logger.error('arrêt forcé après 10s (connexions toujours actives)');
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  server.close((err) => {
    if (err) logger.error('server.close', { err: err.message });
    try {
      require('./db/database').getDB().close();
      logger.info('base SQLite fermée proprement');
    } catch (e) {
      logger.error('fermeture DB', { err: e.message });
    }
    clearTimeout(forceTimer);
    logger.info('arrêt propre terminé');
    process.exit(err ? 1 : 0);
  });
}

['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => gracefulShutdown(sig)));
