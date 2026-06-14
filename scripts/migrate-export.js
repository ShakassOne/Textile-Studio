'use strict';
/**
 * scripts/migrate-export.js — Export du contenu d'une boutique (LECTURE SEULE).
 *
 * À lancer sur le service PROD (Textile-Studio), via Railway → Console :
 *     node scripts/migrate-export.js textile-studio-lab.myshopify.com
 *
 * Produit un fichier JSON dans /data/uploads/_migrate_export.json, servi
 * publiquement à https://<domaine-prod>/uploads/_migrate_export.json
 * que le script d'import (côté WinShirt) ira récupérer.
 *
 * ⚠️ Ne modifie AUCUNE donnée métier : il ne fait que LIRE la base et écrire
 *    le fichier d'export. Sans risque pour la prod.
 */
const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');

const SRC_DOMAIN = (process.argv[2] || 'textile-studio-lab.myshopify.com').toLowerCase().trim();
const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, '..');
const DB_PATH    = path.join(DATA_DIR, 'textilelab.db');
const OUT_PATH   = path.join(DATA_DIR, 'uploads', '_migrate_export.json');

const db = new Database(DB_PATH, { readonly: true });

function shopId(domain) {
  const row = db.prepare('SELECT id, shop_domain FROM shops WHERE shop_domain = ?').get(domain)
    || db.prepare("SELECT id, shop_domain FROM shops WHERE shop_domain LIKE ?").get(domain.split('.')[0] + '%');
  return row ? row.id : null;
}
function safeAll(sql, ...args) { try { return db.prepare(sql).all(...args); } catch (e) { console.warn('  (skip)', e.message); return []; } }

const sid = shopId(SRC_DOMAIN);
if (!sid) {
  console.error(`❌ Boutique introuvable pour "${SRC_DOMAIN}". Boutiques connues :`);
  db.prepare('SELECT id, shop_domain FROM shops').all().forEach(r => console.error('   -', r.id, r.shop_domain));
  process.exit(1);
}
console.log(`Boutique source : ${SRC_DOMAIN} (shop_id=${sid})`);

const data = {
  source_domain: SRC_DOMAIN,
  exported_at:   new Date().toISOString(),
  library:            safeAll('SELECT filename, url, category, mimetype, size, thumb_url FROM library WHERE shop_id = ?', sid),
  mockups:            safeAll('SELECT name, product, views_json, file3d_name, file3d_url, product_color FROM mockups WHERE shop_id = ?', sid),
  categories:         safeAll('SELECT name FROM categories WHERE shop_id = ?', sid),
  product_categories: safeAll('SELECT key, name, emoji, sort_order FROM product_categories WHERE shop_id = ?', sid),
  ai_styles:          safeAll('SELECT code, label, prompt, image_url, sort_order FROM ai_styles WHERE shop_id = ? AND is_builtin = 0', sid),
  qr_frames:          safeAll('SELECT name, category, image_url, sort_order, active FROM qr_frames WHERE shop_id = ?', sid),
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(data));
db.close();

const sz = (fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(2);
console.log('Export écrit :', OUT_PATH, `(${sz} Mo)`);
console.log('  library            :', data.library.length);
console.log('  mockups            :', data.mockups.length);
console.log('  categories         :', data.categories.length);
console.log('  product_categories :', data.product_categories.length);
console.log('  ai_styles (custom) :', data.ai_styles.length);
console.log('  qr_frames          :', data.qr_frames.length);
console.log('\n✅ Récupérable sur : https://<domaine-prod>/uploads/_migrate_export.json');
