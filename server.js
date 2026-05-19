'use strict';
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const { initDB } = require('./db/database');

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

const app  = express();
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
// Les routes qui ont besoin de plus (PNG base64 render/mockup-gen) ont leur
// propre middleware express.json({ limit: '10mb' }) monté en amont du router.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
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
// M7 (audit) : le client_id Shopify est déjà hardcodé dans la meta tag
// de public/shopify-embed.html (valeur publique, non-secret). L'ancien
// fs.readFile + replace('{{SHOPIFY_API_KEY}}', …) était devenu code mort.
app.get('/', (req, res) => {
  // Si pas de paramètres Shopify → rediriger vers l'admin standalone
  if (!req.query.shop && !req.query.host) {
    return res.redirect('/textilelab-admin.html');
  }
  res.setHeader('Cache-Control', 'no-store'); // pas de cache — host/shop dans l'URL
  res.sendFile(path.join(__dirname, 'public', 'shopify-embed.html'));
});

// ── Init DB ────────────────────────────────────────────────────────────
initDB();

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
  const shop   = req.query.shop || process.env.SHOPIFY_BOOTSTRAP_SHOP;
  const token  = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_BOOTSTRAP_TOKEN;
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');

  if (!shop || !token) {
    return res.status(400).json({ error: 'shop ou token manquant' });
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
  const shop     = req.query.shop || process.env.SHOPIFY_BOOTSTRAP_SHOP;
  const chargeId = req.query.charge_id;
  const token    = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_BOOTSTRAP_TOKEN;
  const appUrl   = (process.env.APP_URL || '').replace(/\/$/, '');

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
      "SELECT id FROM subscriptions WHERE shop = ? AND status IN ('active','trialing','pending') ORDER BY id DESC LIMIT 1"
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
app.use('/api/designs',    require('./routes/designs'));
app.use('/api/orders',     require('./routes/orders'));
// Audit M4 — override 10 Mo scopé aux routes qui acceptent du PNG base64.
// Monté AVANT le router pour court-circuiter le express.json({limit:'1mb'}) global.
app.use('/api/render',     express.json({ limit: '10mb' }), require('./routes/render'));
app.use('/api/library',    require('./routes/library'));
app.use('/api/pricing',    require('./routes/pricing'));
app.use('/api/mockups',             require('./routes/mockups'));
app.use('/api/mockup-gen', express.json({ limit: '10mb' }), require('./routes/mockup-gen'));
app.use('/api/product-categories', require('./routes/product-categories'));
app.use('/api/product-links',      require('./routes/product-links'));
app.use('/api/email',              require('./routes/email'));
app.use('/api/shopify',    require('./routes/storefront'));
app.use('/api/ai',         require('./routes/ai'));
app.use('/api/models3d',   require('./routes/models3d'));
app.use('/shopify',              require('./routes/shopify'));
app.use('/oauth',               require('./routes/oauth'));
app.use('/api/shopify-session', require('./routes/shopify-session'));
app.use('/api/admin',          require('./routes/admin-graphql'));
app.use('/proxy',             require('./routes/app-proxy'));

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
app.listen(PORT, () => {
  console.log(`\n✅  TextileLab Backend running on http://localhost:${PORT}`);
  console.log(`📦  Database : textilelab.db`);
  console.log(`📁  Uploads  : ./uploads\n`);
});
