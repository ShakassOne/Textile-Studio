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
['', 'library', 'renders', 'models3d'].forEach(sub => {
  fs.mkdirSync(path.join(UPLOADS_DIR, sub), { recursive: true });
});

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

app.use(cors({
  origin: (origin, cb) => {
    // Autoriser les requêtes sans origin (curl, Postman, server-to-server)
    if (!origin) return cb(null, true);
    // En développement, autoriser localhost
    if (process.env.NODE_ENV !== 'production') return cb(null, true);
    // Toujours autoriser les boutiques Shopify (storefront → notre API)
    if (origin.endsWith('.myshopify.com') || origin.includes('.shopify.com')) return cb(null, true);
    // Whitelist configurée dans ALLOWED_ORIGIN
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origine non autorisée — ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
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
  },
}));
// manifest.json à la racine ; sw.js servi depuis public/ avec en-têtes PWA corrects
app.get('/manifest.json', (_req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
app.get('/sw.js', (_req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
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
// La page injecte SHOPIFY_API_KEY et initialise App Bridge 4
app.get('/', (req, res) => {
  // Si pas de paramètres Shopify → rediriger vers l'admin standalone
  if (!req.query.shop && !req.query.host) {
    return res.redirect('/textilelab-admin.html');
  }
  // Injecter la clé API dans le HTML (côté serveur, pas besoin de .env côté client)
  const htmlPath = path.join(__dirname, 'public', 'shopify-embed.html');
  fs.readFile(htmlPath, 'utf8', (err, html) => {
    if (err) return res.status(500).send('Erreur de lecture du fichier embed.');
    const apiKey = process.env.SHOPIFY_API_KEY || '';
    const injected = html.replace("'{{SHOPIFY_API_KEY}}'", JSON.stringify(apiKey));
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store'); // pas de cache — token dans l'URL
    res.send(injected);
  });
});

// ── Init DB ────────────────────────────────────────────────────────────
initDB();

// ── Bootstrap shop OAuth (survie aux redémarrages Railway sans volume) ──
// Définir SHOPIFY_BOOTSTRAP_SHOP + SHOPIFY_BOOTSTRAP_TOKEN dans Railway env vars
// → le shop est réinséré dans la DB à chaque démarrage sans refaire OAuth
(function bootstrapShop() {
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

// ── Bootstrap webhooks (fire-and-forget au démarrage) ──────────────────
// Enregistre orders/paid + app/uninstalled si SHOPIFY_BOOTSTRAP_SHOP est défini.
// 422 = webhook déjà existant → ignoré silencieusement.
(function bootstrapWebhooks() {
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

// ── Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/designs',    require('./routes/designs'));
app.use('/api/orders',     require('./routes/orders'));
app.use('/api/render',     require('./routes/render'));
app.use('/api/library',    require('./routes/library'));
app.use('/api/pricing',    require('./routes/pricing'));
app.use('/api/mockups',             require('./routes/mockups'));
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

// ── Stats (admin) ──────────────────────────────────────────────────────
const { requireAuth } = require('./routes/auth');
app.get('/api/stats', requireAuth, (req, res) => {
  const db = require('./db/database').getDB();
  const orders   = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(total_price),0) as revenue FROM orders').get();
  const designs  = db.prepare('SELECT COUNT(*) as count FROM designs').get();
  const byProduct = db.prepare(`
    SELECT product, COUNT(*) as count, COALESCE(SUM(total_price),0) as revenue
    FROM orders GROUP BY product
  `).all();
  const pending  = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status='pending'").get();
  const recent   = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5').all();
  res.json({ orders, designs, byProduct, pending, recent });
});

// ── Health ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, version: '1.0.0', ts: new Date().toISOString() }));

// ── Start ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  TextileLab Backend running on http://localhost:${PORT}`);
  console.log(`📦  Database : textilelab.db`);
  console.log(`📁  Uploads  : ./uploads\n`);
});
