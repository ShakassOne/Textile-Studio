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

  // ── Migration library — métadonnées « vitrine » de la bibliothèque ───────
  // La fiche produit affichera ces visuels au client final (« Choisissez un
  // design »), ce qu'un simple nom de fichier ne permet pas. Voir
  // utils/design-library.js pour les règles (slug figé, exclusions plutôt
  // qu'autorisations).
  try { db.exec("ALTER TABLE library ADD COLUMN slug TEXT DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE library ADD COLUMN display_name TEXT DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE library ADD COLUMN sort_order INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE library ADD COLUMN is_active INTEGER DEFAULT 1"); } catch {}
  try { db.exec("ALTER TABLE library ADD COLUMN tags TEXT DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE library ADD COLUMN excluded_mockups TEXT DEFAULT '[]'"); } catch {}
  // Dimensions en pixels : indispensables pour décider si un visuel tient
  // correctement dans la zone d'impression d'un support (lot B). NULL tant
  // qu'on ne les connaît pas — et un visuel aux dimensions inconnues est
  // toujours considéré comme compatible, jamais écarté faute de données.
  try { db.exec("ALTER TABLE library ADD COLUMN width INTEGER DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE library ADD COLUMN height INTEGER DEFAULT NULL"); } catch {}
  // Index non unique : l'unicité du slug est tenue côté route (uniqueSlug),
  // car un index UNIQUE échouerait sur les bases existantes où toutes les
  // lignes ont encore slug=''.
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_library_shop_slug ON library(shop_id, slug)"); } catch {}
  backfillLibraryMetadata(db);

  // Lot E — achat direct d'un visuel de bibliothèque, sans passer par le
  // studio. Référence séparée de `design_id` (qui pointe vers `designs`, un
  // historique de canvas Fabric) : une commande directe n'a jamais ce
  // format-là, donc jamais ce champ-là. `design_id` et `library_id` sont
  // mutuellement exclusifs sur une même commande.
  try { db.exec("ALTER TABLE orders ADD COLUMN library_id INTEGER DEFAULT NULL"); } catch {}

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

  // ── Migration designs — composition au format partagé ───────────────────
  // Le bloc de la fiche produit et le configurateur écrivent désormais la
  // même structure (cf. utils/composition.js) : faces nommées, positions
  // relatives à la zone d'impression. `layers_json` reste en place pour les
  // designs déjà enregistrés et pour le rendu du configurateur actuel ; les
  // deux cohabiteront le temps du raccordement.
  try { db.exec("ALTER TABLE designs ADD COLUMN composition_json TEXT DEFAULT NULL"); } catch {}

  // ── Table: product_display_zones (zone d'affichage sur la PHOTO produit) ──
  // ──────────────────────────────────────────────────────────────────────────
  // À NE PAS CONFONDRE avec la zone d'impression des mockups
  // (mockups.views_json[i].zone, que le code appelle « studio_print_zone ») :
  //
  //   studio_print_zone     — un RECTANGLE dans le repère du back-office
  //                           (440×340), sur le packshot à plat. Sert à
  //                           produire le FICHIER D'IMPRESSION.
  //   product_display_zone  — un QUADRILATÈRE en pourcentage de la photo
  //                           commerciale du produit, où le vêtement est porté
  //                           de biais. Sert uniquement à l'AFFICHAGE sur la
  //                           fiche produit.
  //
  // Formes différentes, repères différents, usages différents : deux tables
  // distinctes, aucun champ partagé, aucun chemin de code commun. Un produit
  // peut avoir l'une sans l'autre.
  //
  // Les coins sont en POURCENTAGE de l'image : le CDN Shopify sert la même
  // photo en plusieurs définitions, une zone en pixels ne vaudrait que pour
  // l'une d'elles.
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_display_zones (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id             INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      shopify_product_id  TEXT    NOT NULL,
      zone_type           TEXT    NOT NULL DEFAULT 'product_display_zone',
      reference_media_id  TEXT    NOT NULL DEFAULT '',
      reference_width     INTEGER DEFAULT NULL,
      reference_height    INTEGER DEFAULT NULL,
      corners_json        TEXT    NOT NULL DEFAULT '[]',
      is_master           INTEGER NOT NULL DEFAULT 1,
      updated_at          TEXT    DEFAULT (datetime('now')),
      UNIQUE(shop_id, shopify_product_id, zone_type, reference_media_id)
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_display_zones_product ON product_display_zones(shop_id, shopify_product_id)"); } catch {}

  // ── Migration : une zone par photo, avec une zone « master » ────────────
  // Première version : une seule zone par produit. Mais sur le sac Kimood,
  // certaines photos de coloris cadrent le produit un peu plus haut ou plus
  // bas — la zone du Naturel tombe alors légèrement à côté. Il faut donc
  // pouvoir corriger UNE photo sans toucher aux autres.
  //
  // Le modèle : une zone master qui vaut par défaut pour toutes les photos,
  // et des zones propres à une photo qui la remplacent pour celle-là.
  //
  // SQLite ne sait pas modifier une contrainte UNIQUE : il faut reconstruire
  // la table. On ne le fait qu'une fois, détecté par l'absence de la colonne
  // is_master.
  try {
    const cols = db.prepare('PRAGMA table_info(product_display_zones)').all();
    if (cols.length && !cols.some(c => c.name === 'is_master')) {
      db.exec('BEGIN');
      db.exec(`
        CREATE TABLE product_display_zones_v2 (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          shop_id             INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
          shopify_product_id  TEXT    NOT NULL,
          zone_type           TEXT    NOT NULL DEFAULT 'product_display_zone',
          reference_media_id  TEXT    NOT NULL DEFAULT '',
          reference_width     INTEGER DEFAULT NULL,
          reference_height    INTEGER DEFAULT NULL,
          corners_json        TEXT    NOT NULL DEFAULT '[]',
          is_master           INTEGER NOT NULL DEFAULT 1,
          updated_at          TEXT    DEFAULT (datetime('now')),
          UNIQUE(shop_id, shopify_product_id, zone_type, reference_media_id)
        )
      `);
      // Les zones existantes deviennent les master de leur produit.
      db.exec(`
        INSERT INTO product_display_zones_v2
          (shop_id, shopify_product_id, zone_type, reference_media_id,
           reference_width, reference_height, corners_json, is_master, updated_at)
        SELECT shop_id, shopify_product_id, zone_type, reference_media_id,
               reference_width, reference_height, corners_json, 1, updated_at
        FROM product_display_zones
      `);
      db.exec('DROP TABLE product_display_zones');
      db.exec('ALTER TABLE product_display_zones_v2 RENAME TO product_display_zones');
      db.exec("CREATE INDEX IF NOT EXISTS idx_display_zones_product ON product_display_zones(shop_id, shopify_product_id)");
      db.exec('COMMIT');
      console.log('[DB] Zones produit : migration vers une zone par photo');
    }
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    console.warn('[DB] Migration des zones produit ignorée :', e.message);
  }

  // ── Table: upsell_candidates (suggestions "vous aimeriez aussi" curées par shop) ──
  // Spec Upsell V2 étape 1 (docs/ROADMAP-DEV.md §2) : pas d'algorithme automatique,
  // l'admin associe à la main 2-4 produits cibles déjà liés à un mockup pour un
  // produit source donné. Backend-only à ce stade, aucun écran admin ni impact client.
  db.exec(`
    CREATE TABLE IF NOT EXISTS upsell_candidates (
      id                         INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id                    INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      source_shopify_product_id  TEXT NOT NULL,
      target_shopify_product_id  TEXT NOT NULL,
      sort_order                 INTEGER NOT NULL DEFAULT 0,
      created_at                 TEXT DEFAULT (datetime('now')),
      UNIQUE(shop_id, source_shopify_product_id, target_shopify_product_id)
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_upsell_candidates_source ON upsell_candidates(shop_id, source_shopify_product_id)"); } catch {}

  // ── Table: social_proof_items (vignettes "Ils l'ont fait" curées par shop) ──
  // Backlog item 18 (docs/ROADMAP-DEV.md §2) : preuve sociale visuelle dans le
  // studio (photos de vraies réalisations clients), en complément du bandeau
  // de réassurance textuel déjà livré. Curation manuelle par l'admin (URL
  // d'image + légende), pas d'algorithme automatique ni d'upload de fichier.
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_proof_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id     INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      image_url   TEXT NOT NULL,
      caption     TEXT NOT NULL DEFAULT '',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_social_proof_items_shop ON social_proof_items(shop_id, sort_order)"); } catch {}

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

  // ── Table: ai_quota (compteur de générations IA par identité) ───────────────
  // identity : "customer:<id>" (connecté, via App Proxy — fiable),
  //            "email:<mail>"  (reconnu par une commande),
  //            "visitor:<uuid>" (navigateur, barrière douce).
  // Le quota est mensuel (period = "AAAA-MM") ; un achat le recharge, ce que
  // tracent last_order_period et last_order_used_at. Cf. utils/ai-quota.js.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_quota (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id            INTEGER NOT NULL REFERENCES shops(id),
      identity           TEXT    NOT NULL,
      used               INTEGER NOT NULL DEFAULT 0,
      period             TEXT    NOT NULL,
      last_order_period  TEXT,
      last_order_used_at INTEGER,
      updated_at         TEXT    DEFAULT (datetime('now')),
      UNIQUE(shop_id, identity)
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_ai_quota_shop_identity ON ai_quota(shop_id, identity)"); } catch {}

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

/**
 * Remplit slug / display_name pour les visuels créés avant le lot « vitrine ».
 * ──────────────────────────────────────────────────────────────────────────
 * Idempotent : ne touche que les lignes dont le champ est encore vide, donc
 * sans effet au deuxième démarrage, et sans jamais écraser une saisie admin.
 *
 * Le slug part dans l'URL publique de la boutique : il doit être unique PAR
 * BOUTIQUE, d'où le traitement shop par shop.
 */
function backfillLibraryMetadata(database) {
  const DL = require('../utils/design-library');
  try {
    const rows = database.prepare(`
      SELECT id, shop_id, filename, slug, display_name
      FROM library
      WHERE (slug IS NULL OR slug = '') OR (display_name IS NULL OR display_name = '')
      ORDER BY id
    `).all();
    if (!rows.length) return;

    // Slugs déjà attribués, par boutique, pour ne pas en recréer un identique.
    const pris = new Map();
    for (const r of database.prepare("SELECT shop_id, slug FROM library WHERE slug <> ''").all()) {
      const cle = String(r.shop_id);
      if (!pris.has(cle)) pris.set(cle, new Set());
      pris.get(cle).add(r.slug);
    }

    const maj = database.prepare('UPDATE library SET slug=?, display_name=? WHERE id=?');
    const tout = database.transaction(() => {
      for (const r of rows) {
        // Un upload local porte un nom horodaté qui ne dit rien : on retombe
        // alors sur « Visuel 42 », que l'admin renommera.
        const nom  = r.display_name || DL.displayNameFromFilename(r.filename) || `Visuel ${r.id}`;
        const cle  = String(r.shop_id);
        if (!pris.has(cle)) pris.set(cle, new Set());
        const slug = r.slug || DL.uniqueSlug(nom, pris.get(cle), `visuel-${r.id}`);
        pris.get(cle).add(slug);
        maj.run(slug, nom, r.id);
      }
    });
    tout();
    console.log(`[DB] Bibliothèque : ${rows.length} visuel(s) complété(s) (slug + nom affiché)`);
  } catch (e) {
    // Non bloquant : l'app doit démarrer même si le rattrapage échoue.
    console.warn('[DB] backfillLibraryMetadata ignoré :', e.message);
  }
}

function getDB() {
  if (!db) initDB();
  return db;
}

module.exports = { initDB, getDB, getShop, getBootstrapShopId, getShopIdByDomain };
