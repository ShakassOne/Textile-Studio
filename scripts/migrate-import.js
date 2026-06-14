'use strict';
/**
 * scripts/migrate-import.js — Import du contenu vers la boutique WinShirt.
 *
 * À lancer sur le service NEUF (valiant-benevolence / WinShirt), via
 * Railway → Console :
 *     node scripts/migrate-import.js https://textile-studio-production.up.railway.app winshirt-2.myshopify.com
 *
 *   arg1 = URL de base du service SOURCE (prod) — pour récupérer l'export JSON
 *          et télécharger les fichiers de la bibliothèque.
 *   arg2 = domaine de la boutique CIBLE (WinShirt). L'app doit déjà y être
 *          installée (la ligne shops doit exister).
 *
 * Idempotent : relançable sans créer de doublons (skip par nom/filename/code).
 * Écrit dans la base + le volume du SERVICE COURANT uniquement.
 */
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');
const Database = require('better-sqlite3');

const SRC_BASE     = (process.argv[2] || '').replace(/\/$/, '');
const DST_DOMAIN   = (process.argv[3] || 'winshirt-2.myshopify.com').toLowerCase().trim();
const DATA_DIR     = process.env.DATA_DIR || path.join(__dirname, '..');
const DB_PATH      = path.join(DATA_DIR, 'textilelab.db');

if (!SRC_BASE) { console.error('❌ Usage: node scripts/migrate-import.js <url-source> <domaine-cible>'); process.exit(1); }

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    (url.startsWith('https') ? https : http).get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchJSON(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' sur ' + url));
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    (url.startsWith('https') ? https : http).get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(); fs.unlinkSync(dest); return resolve(download(res.headers.location, dest));
      }
      if (res.statusCode !== 200) { file.close(); fs.unlinkSync(dest); return reject(new Error('HTTP ' + res.statusCode + ' sur ' + url)); }
      res.pipe(file); file.on('finish', () => file.close(resolve));
    }).on('error', (e) => { try { fs.unlinkSync(dest); } catch {} reject(e); });
  });
}
// /uploads/xxx (relatif) → fichier local DATA_DIR/uploads/xxx ; télécharge depuis SRC_BASE
async function pullRelative(relUrl) {
  if (!relUrl || !relUrl.startsWith('/uploads/')) return;
  const dest = path.join(DATA_DIR, relUrl.replace(/^\//, ''));
  if (fs.existsSync(dest)) return;
  try { await download(SRC_BASE + relUrl, dest); }
  catch (e) { console.warn('   ⚠ fichier non récupéré', relUrl, '—', e.message); }
}

(async () => {
  const exportUrl = SRC_BASE + '/uploads/_migrate_export.json';
  console.log('Lecture de l\'export :', exportUrl);
  const data = await fetchJSON(exportUrl);

  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 8000'); // le service tourne en parallèle → tolère un verrou court
  const shop = db.prepare('SELECT id, shop_domain FROM shops WHERE shop_domain = ?').get(DST_DOMAIN)
    || db.prepare("SELECT id, shop_domain FROM shops WHERE shop_domain LIKE ?").get(DST_DOMAIN.split('.')[0] + '%');
  if (!shop) {
    console.error(`❌ Boutique cible "${DST_DOMAIN}" introuvable — l'app doit d'abord être installée dessus.`);
    db.prepare('SELECT id, shop_domain FROM shops').all().forEach(r => console.error('   -', r.id, r.shop_domain));
    process.exit(1);
  }
  const sid = shop.id;
  console.log(`Boutique cible : ${shop.shop_domain} (shop_id=${sid})`);
  const count = {};

  // categories
  const catIns = db.prepare('INSERT OR IGNORE INTO categories (shop_id, name) VALUES (?, ?)');
  count.categories = 0;
  for (const r of data.categories || []) count.categories += catIns.run(sid, r.name).changes;

  // product_categories
  const pcIns = db.prepare('INSERT OR IGNORE INTO product_categories (shop_id, key, name, emoji, sort_order) VALUES (?, ?, ?, ?, ?)');
  count.product_categories = 0;
  for (const r of data.product_categories || []) count.product_categories += pcIns.run(sid, r.key, r.name, r.emoji || '', r.sort_order || 0).changes;

  // mockups (base64 autoportant ; skip si même nom déjà présent)
  const mkExists = db.prepare('SELECT 1 FROM mockups WHERE shop_id = ? AND name = ?');
  const mkIns = db.prepare('INSERT INTO mockups (shop_id, name, product, views_json, file3d_name, file3d_url, product_color) VALUES (?, ?, ?, ?, ?, ?, ?)');
  count.mockups = 0;
  for (const r of data.mockups || []) {
    if (mkExists.get(sid, r.name)) continue;
    await pullRelative(r.file3d_url);
    mkIns.run(sid, r.name, r.product, r.views_json, r.file3d_name || '', r.file3d_url || '', r.product_color || null);
    count.mockups++;
  }

  // library (+ fichiers image et thumbnails)
  const libExists = db.prepare('SELECT 1 FROM library WHERE shop_id = ? AND filename = ?');
  const libIns = db.prepare('INSERT INTO library (shop_id, filename, url, category, mimetype, size, thumb_url) VALUES (?, ?, ?, ?, ?, ?, ?)');
  count.library = 0;
  for (const r of data.library || []) {
    if (libExists.get(sid, r.filename)) continue;
    await pullRelative(r.url);
    await pullRelative(r.thumb_url);
    libIns.run(sid, r.filename, r.url, r.category || 'divers', r.mimetype || '', r.size || 0, r.thumb_url || '');
    count.library++;
  }

  // ai_styles custom (+ image)
  const styExists = db.prepare('SELECT 1 FROM ai_styles WHERE shop_id = ? AND code = ?');
  const styIns = db.prepare('INSERT INTO ai_styles (shop_id, code, label, prompt, image_url, is_builtin, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?)');
  count.ai_styles = 0;
  for (const r of data.ai_styles || []) {
    if (styExists.get(sid, r.code)) continue;
    await pullRelative(r.image_url);
    styIns.run(sid, r.code, r.label, r.prompt || '', r.image_url || '', r.sort_order || 0);
    count.ai_styles++;
  }

  // qr_frames (+ image)
  const qrExists = db.prepare('SELECT 1 FROM qr_frames WHERE shop_id = ? AND name = ?');
  const qrIns = db.prepare('INSERT INTO qr_frames (shop_id, name, category, image_url, sort_order, active) VALUES (?, ?, ?, ?, ?, ?)');
  count.qr_frames = 0;
  for (const r of data.qr_frames || []) {
    if (qrExists.get(sid, r.name)) continue;
    await pullRelative(r.image_url);
    qrIns.run(sid, r.name, r.category || 'custom', r.image_url, r.sort_order || 0, r.active != null ? r.active : 1);
    count.qr_frames++;
  }

  db.close();
  console.log('\n✅ Import terminé — lignes ajoutées :');
  for (const k of Object.keys(count)) console.log('  ' + k.padEnd(20), count[k]);
  console.log('\nRecharge l\'admin WinShirt pour voir le contenu.');
})().catch(e => { console.error('❌ Échec import :', e.message); process.exit(1); });
