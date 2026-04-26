'use strict';
/**
 * Migration 001 — Multi-tenant scoping (shop_id)
 * ────────────────────────────────────────────────
 * Audit B1 (2026-04-19) : ajoute la colonne shop_id sur les 9 tables métier
 * et backfill les lignes existantes avec l'ID du shop bootstrap.
 *
 * Stratégie SQLite (qui ne permet pas ALTER COLUMN NOT NULL après coup) :
 *   1. ADD COLUMN shop_id INTEGER REFERENCES shops(id)   (nullable)
 *   2. Backfill avec l'ID du shop courant (SHOPIFY_BOOTSTRAP_SHOP)
 *   3. Index sur shop_id pour chaque table
 *
 * La contrainte NOT NULL est imposée applicativement : tous les INSERT
 * passent désormais par un helper qui exige shop_id.
 *
 * Idempotence : ALTER TABLE … ADD COLUMN dans try/catch, comme le reste de
 * database.js. La migration est ré-exécutée à chaque boot sans danger.
 */

const TABLES = [
  'designs',
  'orders',
  'render_jobs',
  'library',
  'mockups',
  'categories',
  'settings',
  'product_categories',
  'product_mockup_links',
];

function run(db) {
  // 1. Ajouter shop_id sur chaque table (nullable, FK)
  for (const t of TABLES) {
    try {
      db.exec(`ALTER TABLE ${t} ADD COLUMN shop_id INTEGER REFERENCES shops(id)`);
      console.log(`  ↳ migration 001 : ${t}.shop_id ajouté`);
    } catch (e) {
      // colonne déjà présente → on continue
    }
  }

  // 2. Résoudre le shop bootstrap (celui qui possède toutes les données existantes)
  const bootstrapDomain = (process.env.SHOPIFY_BOOTSTRAP_SHOP || '').toLowerCase().trim();
  let bootstrapShop = null;
  if (bootstrapDomain) {
    bootstrapShop = db
      .prepare('SELECT id FROM shops WHERE shop_domain = ?')
      .get(bootstrapDomain);
  }
  // Fallback : prendre le premier shop actif si pas de bootstrap explicite
  if (!bootstrapShop) {
    bootstrapShop = db
      .prepare('SELECT id FROM shops WHERE is_active = 1 ORDER BY id ASC LIMIT 1')
      .get();
  }

  // 3. Backfill : assigner les lignes orphelines au shop bootstrap
  if (bootstrapShop?.id) {
    const sid = bootstrapShop.id;
    let totalBackfilled = 0;
    for (const t of TABLES) {
      try {
        const info = db.prepare(`UPDATE ${t} SET shop_id = ? WHERE shop_id IS NULL`).run(sid);
        if (info.changes > 0) {
          totalBackfilled += info.changes;
          console.log(`  ↳ migration 001 : ${info.changes} ligne(s) ${t} backfill → shop_id=${sid}`);
        }
      } catch (e) {
        // table peut-être vide ou colonne pas créée
      }
    }
    if (totalBackfilled > 0) {
      console.log(`✅  migration 001 : ${totalBackfilled} ligne(s) backfilled au shop_id=${sid}`);
    }
  } else {
    console.warn('⚠️  migration 001 : aucun shop bootstrap trouvé — backfill ignoré');
    console.warn('   (les lignes existantes auront shop_id=NULL jusqu\'à la 1ère installation OAuth)');
  }

  // 4. Index pour performance des requêtes scopées
  for (const t of TABLES) {
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_shop_id ON ${t}(shop_id)`);
    } catch (e) {
      // table inexistante → ignore
    }
  }

  // 4b. Migrer les clés globales (admin_password_hash, admin_username) de settings
  //     vers admin_settings AVANT de recréer settings avec une PK shop_id+key.
  try {
    const GLOBAL_KEYS = ['admin_password_hash', 'admin_username'];
    const insertAdmin = db.prepare(
      "INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES (?, ?, ?)"
    );
    for (const k of GLOBAL_KEYS) {
      try {
        const row = db.prepare('SELECT value, updated_at FROM settings WHERE key = ?').get(k);
        if (row?.value) {
          insertAdmin.run(k, row.value, row.updated_at || new Date().toISOString());
          db.prepare('DELETE FROM settings WHERE key = ?').run(k);
          console.log(`  ↳ migration 001 : ${k} déplacée settings → admin_settings`);
        }
      } catch {}
    }
  } catch (e) {
    console.error('❌  migration 001 : déplacement clés globales échoué :', e.message);
  }

  // 5. settings : PK composite (shop_id, key) — la PK actuelle est PK(key) qui empêche
  //    le multi-tenant. SQLite ne permet pas ALTER PRIMARY KEY ; on recrée la table.
  //    Idempotence : on détecte la nouvelle PK via PRAGMA table_info et on saute si déjà OK.
  try {
    const cols = db.prepare("PRAGMA table_info(settings)").all();
    const hasShopIdCol = cols.some(c => c.name === 'shop_id');
    const keyIsPk      = cols.find(c => c.name === 'key')?.pk === 1;
    const shopIsPk     = cols.find(c => c.name === 'shop_id')?.pk >= 1;

    // Si key est encore PK seul (sans shop_id), on recrée
    if (hasShopIdCol && keyIsPk && !shopIsPk) {
      db.exec('BEGIN');
      db.exec(`
        CREATE TABLE settings_new (
          shop_id    INTEGER NOT NULL REFERENCES shops(id),
          key        TEXT    NOT NULL,
          value      TEXT    NOT NULL DEFAULT '',
          updated_at TEXT    DEFAULT (datetime('now')),
          PRIMARY KEY (shop_id, key)
        )
      `);
      // Copier seulement les lignes ayant un shop_id (les autres seraient orphelines)
      if (bootstrapShop?.id) {
        db.exec(`
          INSERT OR IGNORE INTO settings_new (shop_id, key, value, updated_at)
          SELECT COALESCE(shop_id, ${bootstrapShop.id}), key, value, updated_at FROM settings
        `);
      } else {
        db.exec(`
          INSERT OR IGNORE INTO settings_new (shop_id, key, value, updated_at)
          SELECT shop_id, key, value, updated_at FROM settings WHERE shop_id IS NOT NULL
        `);
      }
      db.exec('DROP TABLE settings');
      db.exec('ALTER TABLE settings_new RENAME TO settings');
      db.exec('CREATE INDEX IF NOT EXISTS idx_settings_shop_id ON settings(shop_id)');
      db.exec('COMMIT');
      console.log('  ↳ migration 001 : settings recréée avec PRIMARY KEY (shop_id, key)');
    }
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('❌  migration 001 : recréation settings échouée :', e.message);
  }

  // 5b. categories : UNIQUE(name) global empêche 2 shops d'avoir une catégorie au même nom.
  //     On migre vers UNIQUE(shop_id, name).
  try {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='categories'").get()?.sql || '';
    const inlineUniqueName = /name\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tableSql);
    if (inlineUniqueName) {
      db.exec('BEGIN');
      db.exec(`
        CREATE TABLE categories_new (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          shop_id    INTEGER NOT NULL REFERENCES shops(id),
          name       TEXT    NOT NULL,
          created_at TEXT    DEFAULT (datetime('now')),
          UNIQUE (shop_id, name)
        )
      `);
      if (bootstrapShop?.id) {
        db.exec(`
          INSERT OR IGNORE INTO categories_new (id, shop_id, name, created_at)
          SELECT id, COALESCE(shop_id, ${bootstrapShop.id}), name, created_at FROM categories
        `);
      } else {
        db.exec(`
          INSERT OR IGNORE INTO categories_new (id, shop_id, name, created_at)
          SELECT id, shop_id, name, created_at FROM categories WHERE shop_id IS NOT NULL
        `);
      }
      db.exec('DROP TABLE categories');
      db.exec('ALTER TABLE categories_new RENAME TO categories');
      db.exec('CREATE INDEX IF NOT EXISTS idx_categories_shop_id ON categories(shop_id)');
      db.exec('COMMIT');
      console.log('  ↳ migration 001 : categories recréée avec UNIQUE(shop_id, name)');
    }
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('❌  migration 001 : recréation categories échouée :', e.message);
  }

  // 6. product_categories : la contrainte UNIQUE(key) globale empêche 2 shops d'avoir
  //    une même clé. On migre vers UNIQUE(shop_id, key). Même approche : on recrée.
  try {
    const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='product_categories'").all();
    const hasOldUniqueKey = idx.some(i => /UNIQUE/i.test(i.sql || '') && /\(\s*key\s*\)/i.test(i.sql || ''));
    // On détecte aussi l'ancienne contrainte définie inline (sqlite_autoindex_product_categories_*)
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='product_categories'").get()?.sql || '';
    const inlineUniqueKey = /key\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tableSql);

    if (hasOldUniqueKey || inlineUniqueKey) {
      db.exec('BEGIN');
      db.exec(`
        CREATE TABLE product_categories_new (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          shop_id    INTEGER NOT NULL REFERENCES shops(id),
          key        TEXT    NOT NULL,
          name       TEXT    NOT NULL,
          emoji      TEXT    NOT NULL DEFAULT '📦',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT    DEFAULT (datetime('now')),
          UNIQUE (shop_id, key)
        )
      `);
      if (bootstrapShop?.id) {
        db.exec(`
          INSERT INTO product_categories_new (id, shop_id, key, name, emoji, sort_order, created_at)
          SELECT id, COALESCE(shop_id, ${bootstrapShop.id}), key, name, emoji, sort_order, created_at FROM product_categories
        `);
      } else {
        db.exec(`
          INSERT INTO product_categories_new (id, shop_id, key, name, emoji, sort_order, created_at)
          SELECT id, shop_id, key, name, emoji, sort_order, created_at FROM product_categories WHERE shop_id IS NOT NULL
        `);
      }
      db.exec('DROP TABLE product_categories');
      db.exec('ALTER TABLE product_categories_new RENAME TO product_categories');
      db.exec('CREATE INDEX IF NOT EXISTS idx_product_categories_shop_id ON product_categories(shop_id)');
      db.exec('COMMIT');
      console.log('  ↳ migration 001 : product_categories recréée avec UNIQUE(shop_id, key)');
    }
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('❌  migration 001 : recréation product_categories échouée :', e.message);
  }
}

module.exports = { run, TABLES };
