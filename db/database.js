'use strict';
const Database = require('better-sqlite3');
const path     = require('path');

let db;

function initDB() {
  // En prod Railway : DATA_DIR=/data → DB dans /data/textilelab.db (volume persistant)
  // En local        : DATA_DIR non défini → DB dans le dossier projet (ou bind mount)
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..');
  db = new Database(path.join(dataDir, 'textilelab.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ── Table: designs ────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS designs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT    NOT NULL DEFAULT 'Sans titre',
      product        TEXT    NOT NULL DEFAULT 'tshirt',
      color          TEXT    NOT NULL DEFAULT '#FFFFFF',
      format         TEXT    NOT NULL DEFAULT 'A4',
      frame_x        REAL    DEFAULT 0,
      frame_y        REAL    DEFAULT 0,
      frame_w        REAL    DEFAULT 200,
      frame_h        REAL    DEFAULT 260,
      layers_json    TEXT    NOT NULL DEFAULT '[]',
      ticket_on      INTEGER DEFAULT 0,
      ticket_start   INTEGER DEFAULT 1,
      ticket_prefix  TEXT    DEFAULT '',
      ticket_suffix  TEXT    DEFAULT '',
      thumbnail      TEXT    DEFAULT '',
      created_at     TEXT    DEFAULT (datetime('now')),
      updated_at     TEXT    DEFAULT (datetime('now'))
    )
  `);

  // ── Table: orders ────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      shopify_id     TEXT    DEFAULT '',
      design_id      INTEGER REFERENCES designs(id),
      product        TEXT    NOT NULL,
      color          TEXT    DEFAULT '#FFFFFF',
      format         TEXT    NOT NULL DEFAULT 'A4',
      quantity       INTEGER NOT NULL DEFAULT 1,
      unit_price     REAL    NOT NULL DEFAULT 0,
      format_price   REAL    NOT NULL DEFAULT 0,
      total_price    REAL    NOT NULL DEFAULT 0,
      customer_name  TEXT    DEFAULT '',
      customer_email TEXT    DEFAULT '',
      status         TEXT    NOT NULL DEFAULT 'pending',
      ticket_from    INTEGER DEFAULT NULL,
      ticket_to      INTEGER DEFAULT NULL,
      render_url     TEXT    DEFAULT '',
      notes          TEXT    DEFAULT '',
      created_at     TEXT    DEFAULT (datetime('now')),
      updated_at     TEXT    DEFAULT (datetime('now'))
    )
  `);

  // ── Table: render_jobs ───────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS render_jobs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      design_id   INTEGER REFERENCES designs(id),
      order_id    INTEGER REFERENCES orders(id),
      format      TEXT    NOT NULL DEFAULT 'A4',
      dpi         INTEGER NOT NULL DEFAULT 300,
      status      TEXT    NOT NULL DEFAULT 'queued',
      output_path TEXT    DEFAULT '',
      cloud_url   TEXT    DEFAULT '',
      error       TEXT    DEFAULT '',
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now'))
    )
  `);
  // Migration: add cloud_url if not present
  try { db.exec("ALTER TABLE render_jobs ADD COLUMN cloud_url TEXT DEFAULT ''"); } catch {}


  // ── Table: library ───────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS library (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      filename    TEXT    NOT NULL,
      url         TEXT    NOT NULL,
      category    TEXT    NOT NULL DEFAULT 'divers',
      mimetype    TEXT    DEFAULT '',
      size        INTEGER DEFAULT 0,
      created_at  TEXT    DEFAULT (datetime('now'))
    )
  `);

  // ── Table: mockups ───────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS mockups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      product     TEXT    NOT NULL,
      views_json  TEXT    NOT NULL DEFAULT '[]',
      file3d_name TEXT    DEFAULT '',
      file3d_url  TEXT    DEFAULT '',
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now'))
    )
  `);

  // ── Table: shops (Shopify OAuth) ─────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS shops (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_domain     TEXT    NOT NULL UNIQUE,
      access_token    TEXT    NOT NULL DEFAULT '',
      scope           TEXT    NOT NULL DEFAULT '',
      installed_at    TEXT    DEFAULT (datetime('now')),
      uninstalled_at  TEXT    DEFAULT NULL,
      is_active       INTEGER DEFAULT 1
    )
  `);
  // Migrations pour shops (si la table existait déjà sans certaines colonnes)
  try { db.exec("ALTER TABLE shops ADD COLUMN uninstalled_at TEXT DEFAULT NULL"); } catch {}
  // Migration mockups — couleur produit pour variantes futures
  try { db.exec("ALTER TABLE mockups ADD COLUMN product_color TEXT DEFAULT 'white'"); } catch {}
  // Migration mockups — nuancier par mockup : [{name,hex},…] ('[]' = palette par défaut)
  try { db.exec("ALTER TABLE mockups ADD COLUMN colors_json TEXT DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE shops ADD COLUMN is_active INTEGER DEFAULT 1"); } catch {}
  try { db.exec("ALTER TABLE library ADD COLUMN thumb_url TEXT DEFAULT NULL"); } catch {}

  // ── Table: categories (catégories de bibliothèque sans placeholder SVG) ────
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // Migrer les catégories existantes issues des placeholders (legacy, exécuté une fois)
  // Désormais scopé via le shop bootstrap pour cohérence avec la migration 001.
  try {
    const existing = db.prepare("SELECT DISTINCT category, shop_id FROM library WHERE filename LIKE '__cat_placeholder_%'").all();
    const insertCat = db.prepare("INSERT OR IGNORE INTO categories (shop_id, name) VALUES (?, ?)");
    for (const row of existing) { try { if (row.shop_id && row.category) insertCat.run(row.shop_id, row.category); } catch {} }
    // Nettoyer tous les placeholders existants (fichiers + DB)
    const placeholders = db.prepare("SELECT * FROM library WHERE filename LIKE '__cat_placeholder_%'").all();
    const fs2 = require('fs');
    const path2 = require('path');
    for (const p of placeholders) {
      try { fs2.unlinkSync(path2.join(__dirname, '..', p.url)); } catch {}
      try { db.prepare("DELETE FROM library WHERE id=?").run(p.id); } catch {}
    }
    if (placeholders.length) console.log(`🧹 ${placeholders.length} cat_placeholder(s) supprimé(s) définitivement`);
  } catch {}
  // Migrer les catégories venant des images réelles (scopé shop)
  try {
    const realCats = db.prepare("SELECT DISTINCT category, shop_id FROM library WHERE shop_id IS NOT NULL").all();
    const insertCat = db.prepare("INSERT OR IGNORE INTO categories (shop_id, name) VALUES (?, ?)");
    for (const row of realCats) { try { if (row.category) insertCat.run(row.shop_id, row.category); } catch {} }
  } catch {}

  // ── Table: settings (clés/valeurs scopées par shop) ──────────────────
  // Audit B1 : multi-tenant scoping. La migration 001 recrée cette table avec
  // PRIMARY KEY (shop_id, key) si elle a encore l'ancienne PK(key).
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Table: admin_settings (config GLOBALE non scopée par shop) ───────
  // Stocke le hash du mot de passe admin TextileLab (super-admin),
  // et autres clés non multi-tenant. Audit B1 : settings devient scopé par shop,
  // donc il faut une table dédiée pour les clés globales.
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Table: product_categories (catégories de produits gérables via l'admin) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      key        TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      emoji      TEXT NOT NULL DEFAULT '📦',
      image_url  TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // Migration idempotente : ajouter image_url si la table existait déjà sans
  try { db.exec("ALTER TABLE product_categories ADD COLUMN image_url TEXT NOT NULL DEFAULT ''"); } catch {}
  // Seeder pour le shop bootstrap si la table est vide (audit B1 : multi-tenant scoping).
  // Ce seed est appliqué uniquement quand le shop bootstrap existe en DB ; les autres
  // marchands déclencheront leur propre seed lors de l'installation OAuth (à implémenter
  // dans routes/oauth.js si besoin — pour l'instant ils héritent à la 1ère création via API).
  const catCount = db.prepare('SELECT COUNT(*) as n FROM product_categories').get();
  if (catCount.n === 0) {
    const bootstrapDomain = (process.env.SHOPIFY_BOOTSTRAP_SHOP || '').toLowerCase().trim();
    const bootstrapRow = bootstrapDomain
      ? db.prepare('SELECT id FROM shops WHERE shop_domain=?').get(bootstrapDomain)
      : db.prepare('SELECT id FROM shops WHERE is_active=1 ORDER BY id ASC LIMIT 1').get();
    if (bootstrapRow?.id) {
      const insertCat = db.prepare('INSERT OR IGNORE INTO product_categories (shop_id, key, name, emoji, sort_order) VALUES (?, ?, ?, ?, ?)');
      [
        ['tshirt',  'T-Shirt',   '👕', 0],
        ['hoodie',  'Hoodie',    '🧥', 1],
        ['cap',     'Casquette', '🧢', 2],
        ['totebag', 'Tote Bag',  '👜', 3],
      ].forEach(([k, n, e, s]) => { try { insertCat.run(bootstrapRow.id, k, n, e, s); } catch {} });
      console.log('🏷  product_categories seeded with 4 defaults (shop bootstrap)');
    } else {
      console.log('🏷  product_categories seed skipped — no bootstrap shop yet (will seed at OAuth install)');
    }
  }

  // ── Table: product_mockup_links (liaisons Produit Shopify ↔ Mockup) ──────
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_mockup_links (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      shopify_product_id     TEXT NOT NULL UNIQUE,
      shopify_product_handle TEXT NOT NULL DEFAULT '',
      shopify_product_title  TEXT NOT NULL DEFAULT '',
      mockup_id              INTEGER REFERENCES mockups(id) ON DELETE SET NULL,
      updated_at             TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Table: ai_styles (styles visuels appliqués aux photos clients via OpenAI) ──
  // Scopée par shop. Les styles "built-in" sont créés au démarrage pour chaque
  // shop existant ; l'admin peut ajouter ses propres styles custom.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_styles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id     INTEGER NOT NULL REFERENCES shops(id),
      code        TEXT    NOT NULL,
      label       TEXT    NOT NULL,
      prompt      TEXT    NOT NULL DEFAULT '',
      image_url   TEXT    NOT NULL DEFAULT '',
      is_builtin  INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now')),
      UNIQUE (shop_id, code)
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_ai_styles_shop_id ON ai_styles(shop_id)"); } catch {}

  // ── Table: ai_creations (galerie "Vos créations IA" partagée, modérée) ──────
  // Chaque image générée par un client (texte ou photo) est enregistrée en
  // 'pending'. L'admin valide → 'approved' → visible par tous dans le studio.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_creations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id     INTEGER NOT NULL REFERENCES shops(id),
      image_url   TEXT    NOT NULL,
      prompt      TEXT    DEFAULT '',
      status      TEXT    NOT NULL DEFAULT 'pending',
      created_at  TEXT    DEFAULT (datetime('now'))
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_ai_creations_shop_status ON ai_creations(shop_id, status)"); } catch {}

  // ── Table: qr_frames (habillages QR code — cadres réseaux sociaux, etc.) ─────
  db.exec(`
    CREATE TABLE IF NOT EXISTS qr_frames (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id     INTEGER NOT NULL REFERENCES shops(id),
      name        TEXT    NOT NULL,
      category    TEXT    NOT NULL DEFAULT 'custom',
      image_url   TEXT    NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now'))
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_qr_frames_shop_id ON qr_frames(shop_id)"); } catch {}

  // Seed des styles built-in pour tout shop actif qui n'en a pas encore.
  // Idempotent : INSERT OR IGNORE sur (shop_id, code).
  try {
    const BUILTIN_STYLES = [
      { code: 'disney',     label: 'Pixar',      image_url: '/assets/styles/style-disney.png',     prompt: 'Transform this photo into a Pixar 3D animated movie character, soft lighting, big expressive eyes, polished render, transparent background, DTF print ready', sort_order: 0 },
      { code: 'manga',      label: 'Manga',      image_url: '/assets/styles/style-manga.png',      prompt: 'Transform this photo into a Japanese manga/anime illustration, clean line art, cel shading, black and white with selective color accents, transparent background', sort_order: 1 },
      { code: 'sticker',    label: 'Sticker',    image_url: '/assets/styles/style-sticker.png',    prompt: 'Transform this photo into a cute kawaii sticker design, thick white outline, vibrant colors, glossy finish, transparent background, DTF print ready', sort_order: 2 },
      { code: 'caricature', label: 'Caricature', image_url: '/assets/styles/style-caricature.png', prompt: 'Transform this photo into an exaggerated caricature, emphasize distinctive features humorously, expressive cartoon style, transparent background, DTF print ready', sort_order: 3 },
      { code: 'lego',       label: 'Lego',       image_url: '/assets/styles/style-lego.png',       prompt: 'Transform this photo into a LEGO minifigure style character, blocky proportions, simple iconic face, plastic toy aesthetic, transparent background, DTF print ready', sort_order: 4 },
      { code: 'cartoon',    label: 'Cartoon',    image_url: '/assets/styles/style-cartoon.png',    prompt: 'Transform this photo into a vibrant cartoon illustration, bold outlines, flat bright colors, expressive, transparent background, DTF print ready, no background', sort_order: 5 },
      { code: 'sketch',     label: 'Sketch',     image_url: '/assets/styles/style-sketch.png',     prompt: 'Transform this photo into a detailed pencil sketch drawing, fine line work, cross-hatching, artistic black and white illustration, transparent background', sort_order: 6 },
      { code: 'graffiti',   label: 'Graffiti',   image_url: '/assets/styles/style-graffiti.png',   prompt: 'Transform this photo into a bold street art graffiti illustration, spray paint texture, urban colors, thick outlines, stencil art, transparent background, DTF print ready', sort_order: 7 },
      { code: 'simple',     label: 'Simple',     image_url: '/assets/styles/style-simple.png',     prompt: 'Transform this photo into a simple flat cartoon, minimal details, 4 colors max, clean bold shapes and outlines, transparent background, DTF print ready', sort_order: 8 },
      { code: 'avatar',     label: 'Avatar',     image_url: '/assets/styles/style-avatar.png',     prompt: 'Transform this photo into a stylized avatar portrait, modern digital art, geometric simplification, vibrant gradient colors, transparent background, apparel print ready', sort_order: 9 },
      { code: 'funny-running', label: '🏃 Running', image_url: '/assets/styles/style-funny-running.png', prompt: 'Transform the people into a fun premium cartoon caricature mascot in a dynamic running pose, with sporty accessories (race bib, sweatband, water bottle, sweat drops), polished digital rendering, smooth shading, crisp medium outlines, bright clean colors, expressive smile, premium custom T-shirt sticker aesthetic, transparent background, DTF print ready', sort_order: 10 },
    ];
    const allShops = db.prepare('SELECT id FROM shops WHERE is_active=1').all();
    const countStyles = db.prepare('SELECT COUNT(*) AS n FROM ai_styles WHERE shop_id=?');
    const insertStyle = db.prepare(
      'INSERT OR IGNORE INTO ai_styles (shop_id, code, label, prompt, image_url, is_builtin, sort_order) VALUES (?, ?, ?, ?, ?, 1, ?)'
    );
    let seeded = 0;
    for (const s of allShops) {
      // Seed UNE seule fois : si la boutique a déjà des styles, on ne réinjecte
      // pas les built-in (sinon une suppression admin réapparaîtrait au redémarrage).
      if (countStyles.get(s.id).n > 0) continue;
      for (const st of BUILTIN_STYLES) {
        const info = insertStyle.run(s.id, st.code, st.label, st.prompt, st.image_url, st.sort_order);
        if (info.changes) seeded++;
      }
    }
    if (seeded) console.log(`🎨  ai_styles : ${seeded} style(s) built-in seedé(s)`);
  } catch (e) {
    console.warn('⚠️  Seed ai_styles built-in échoué :', e.message);
  }

  // Ajout du style built-in "funny-running" aux shops déjà existants.
  // Le seed ci-dessus ne s'exécute que si le shop n'a ENCORE AUCUN style ;
  // pour les shops déjà seedés, on ajoute ce nouveau style ponctuellement.
  // Idempotent : INSERT OR IGNORE sur (shop_id, code).
  try {
    const insertFunnyRunning = db.prepare(
      'INSERT OR IGNORE INTO ai_styles (shop_id, code, label, prompt, image_url, is_builtin, sort_order) VALUES (?, ?, ?, ?, ?, 1, ?)'
    );
    const allShops = db.prepare('SELECT id FROM shops WHERE is_active=1').all();
    let added = 0;
    for (const s of allShops) {
      const info = insertFunnyRunning.run(
        s.id,
        'funny-running',
        '🏃 Running',
        'Transform the people into a fun premium cartoon caricature mascot in a dynamic running pose, with sporty accessories (race bib, sweatband, water bottle, sweat drops), polished digital rendering, smooth shading, crisp medium outlines, bright clean colors, expressive smile, premium custom T-shirt sticker aesthetic, transparent background, DTF print ready',
        '/assets/styles/style-funny-running.png',
        10
      );
      if (info.changes) added++;
    }
    if (added) console.log(`🎨  ai_styles : style "funny-running" ajouté pour ${added} shop(s)`);
  } catch (e) {
    console.warn('⚠️  Ajout style funny-running échoué :', e.message);
  }

  // ── Migration 001 : multi-tenant scoping (shop_id) ──────────────────────
  // Audit B1 (2026-04-19) : voir db/migrations/001_multi_tenant.js
  try {
    const migration001 = require('./migrations/001_multi_tenant');
    migration001.run(db);
  } catch (e) {
    console.error('❌  Migration 001 (multi-tenant) failed:', e.message);
  }

  console.log('✅  DB initialised — 10 tables ready');
  return db;
}

/**
 * Récupère le shop enregistré par domain, ou null.
 * @param {string} shopDomain  ex: "ma-boutique.myshopify.com"
 */
function getShop(shopDomain) {
  const db = getDB();
  return db.prepare('SELECT * FROM shops WHERE shop_domain = ? AND is_active = 1').get(shopDomain) || null;
}

/**
 * Retourne l'ID du shop bootstrap (SHOPIFY_BOOTSTRAP_SHOP), ou null.
 * Utilisé en fallback pour les routes publiques sans contexte Shopify.
 */
function getBootstrapShopId() {
  const domain = (process.env.SHOPIFY_BOOTSTRAP_SHOP || '').toLowerCase().trim();
  if (!domain) return null;
  const row = getDB()
    .prepare('SELECT id FROM shops WHERE shop_domain = ? AND is_active = 1')
    .get(domain);
  return row?.id || null;
}

/**
 * Résout shop_id depuis un domain. Retourne null si introuvable.
 */
function getShopIdByDomain(shopDomain) {
  if (!shopDomain) return null;
  const row = getDB()
    .prepare('SELECT id FROM shops WHERE shop_domain = ? AND is_active = 1')
    .get(String(shopDomain).toLowerCase().trim());
  return row?.id || null;
}

function getDB() {
  if (!db) initDB();
  return db;
}

module.exports = { initDB, getDB, getShop, getBootstrapShopId, getShopIdByDomain };
