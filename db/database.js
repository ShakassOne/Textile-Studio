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
  // Migrer les catégories existantes issues des placeholders
  try {
    const existing = db.prepare("SELECT DISTINCT category FROM library WHERE filename LIKE '__cat_placeholder_%'").all();
    const insertCat = db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
    for (const row of existing) { try { insertCat.run(row.category); } catch {} }
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
  // Également migrer les catégories venant des images réelles
  try {
    const realCats = db.prepare("SELECT DISTINCT category FROM library").all();
    const insertCat = db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
    for (const row of realCats) { try { if(row.category) insertCat.run(row.category); } catch {} }
  } catch {}

  // ── Table: settings (clés/valeurs de configuration) ──────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
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
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // Seeder avec les 4 catégories par défaut si la table est vide
  const catCount = db.prepare('SELECT COUNT(*) as n FROM product_categories').get();
  if (catCount.n === 0) {
    const insertCat = db.prepare('INSERT OR IGNORE INTO product_categories (key, name, emoji, sort_order) VALUES (?, ?, ?, ?)');
    [
      ['tshirt',  'T-Shirt',   '👕', 0],
      ['hoodie',  'Hoodie',    '🧥', 1],
      ['cap',     'Casquette', '🧢', 2],
      ['totebag', 'Tote Bag',  '👜', 3],
    ].forEach(([k, n, e, s]) => { try { insertCat.run(k, n, e, s); } catch {} });
    console.log('🏷  product_categories seeded with 4 defaults');
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

function getDB() {
  if (!db) initDB();
  return db;
}

module.exports = { initDB, getDB, getShop };
