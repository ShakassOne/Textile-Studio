'use strict';
/**
 * routes/product-display-zones.js — Zone d'affichage sur la photo produit.
 * ──────────────────────────────────────────────────────────────────────────
 * Le client choisit un design sur la fiche produit et le voit apparaître sur
 * LA PHOTO du produit — la vraie, celle où le vêtement est porté. Pour ça il
 * faut savoir où, sur cette photo, se trouve la surface imprimable.
 *
 * ⚠ À NE PAS CONFONDRE avec la zone d'impression des mockups :
 *
 *   studio_print_zone    — mockups.views_json[i].zone. Un RECTANGLE dans le
 *                          repère du back-office (440×340), sur le packshot à
 *                          plat. Produit le FICHIER D'IMPRESSION.
 *   product_display_zone — ici. Un QUADRILATÈRE en pourcentage de la photo
 *                          commerciale. Sert UNIQUEMENT à l'affichage.
 *
 * Deux tables, aucun champ partagé, aucun chemin de code commun : c'est une
 * règle posée par Alan, pas un détail d'implémentation.
 *
 * Quatre coins et non un rectangle parce que le vêtement est porté de biais :
 * un rectangle y collerait le design comme un autocollant.
 *
 * Pourcentages et non pixels parce que le CDN Shopify sert la même photo en
 * plusieurs définitions — une zone en pixels ne vaudrait que pour l'une.
 */

const express = require('express');
const router  = express.Router();
const { requireAuth }           = require('./auth');
const { requireShopifySession } = require('./shopify-session');
const { attachShopId }          = require('./_shop-context');
const { getDB }                 = require('../db/database');
const { adminGraphQL }          = require('./admin-graphql');
const PERSP                     = require('../utils/perspective');

const ZONE_TYPE = 'product_display_zone';

/** Identifiant numérique → GID Shopify, et inversement, sans rien supposer. */
function _chiffres(raw) {
  return String(raw || '').replace(/\D/g, '');
}

/**
 * Valide les quatre coins reçus de l'admin.
 * @returns {{coins:Array}|{erreur:string}}
 */
function _validerCoins(brut) {
  if (!Array.isArray(brut) || brut.length !== 4) {
    return { erreur: 'Quatre coins exactement sont attendus' };
  }
  const coins = brut.map(c => ({ x: Number(c && c.x), y: Number(c && c.y) }));
  if (coins.some(c => !Number.isFinite(c.x) || !Number.isFinite(c.y))) {
    return { erreur: 'Coordonnées non numériques' };
  }
  // En pourcentage de l'image. On tolère un léger débordement (un design peut
  // mordre sur le bord d'un sac) mais pas n'importe quoi.
  if (coins.some(c => c.x < -20 || c.x > 120 || c.y < -20 || c.y > 120)) {
    return { erreur: 'Coins hors de l\'image (pourcentages attendus)' };
  }
  // Un quadrilatère plat ne rendrait rien, en silence. Mieux vaut refuser.
  if (!PERSP.homographieDepuisCarre(coins)) {
    return { erreur: 'Zone dégénérée — les quatre coins doivent former une surface' };
  }
  return { coins };
}

/** Colonne JSON → tableau de coins, jamais une exception. */
function _lireCoins(brut) {
  try { const v = JSON.parse(brut || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

/** Ligne SQL → objet d'API. */
function _exposer(row) {
  if (!row) return null;
  return {
    productId:        row.shopify_product_id,
    zoneType:         row.zone_type,
    referenceMediaId: row.reference_media_id || null,
    referenceWidth:   row.reference_width,
    referenceHeight:  row.reference_height,
    corners:          _lireCoins(row.corners_json),
    isMaster:         row.is_master === 1 || row.is_master === undefined,
    updatedAt:        row.updated_at,
  };
}

/** Toutes les zones d'un produit : le master d'abord, puis les remplacements. */
function _lireZones(db, shopId, productId) {
  return db.prepare(
    `SELECT * FROM product_display_zones
     WHERE shop_id=? AND shopify_product_id=? AND zone_type=?
     ORDER BY is_master DESC, updated_at DESC`
  ).all(shopId, productId, ZONE_TYPE);
}

/** La zone master d'un produit : celle qui vaut par défaut pour toutes ses photos. */
function _lireMaster(db, shopId, productId) {
  return db.prepare(
    `SELECT * FROM product_display_zones
     WHERE shop_id=? AND shopify_product_id=? AND zone_type=? AND is_master=1`
  ).get(shopId, productId, ZONE_TYPE);
}

/**
 * Zone à appliquer à une photo donnée.
 * Un remplacement calibré sur cette photo précise l'emporte ; à défaut, le
 * master. C'est ce qui permet de corriger un coloris dont la prise de vue
 * cadre le produit plus haut, sans toucher aux treize autres.
 */
function _zonePourPhoto(db, shopId, productId, mediaId) {
  if (mediaId) {
    const propre = db.prepare(
      `SELECT * FROM product_display_zones
       WHERE shop_id=? AND shopify_product_id=? AND zone_type=? AND reference_media_id=? AND is_master=0`
    ).get(shopId, productId, ZONE_TYPE, mediaId);
    if (propre) return propre;
  }
  return _lireMaster(db, shopId, productId);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/products/:productId/display-zone
// ─────────────────────────────────────────────────────────────────────────────
// Renvoie la zone enregistrée ET les photos du produit, pour que l'écran de
// calibration puisse afficher l'image et poser les coins dessus.
router.get('/admin/products/:productId/display-zone', requireAuth, requireShopifySession, async (req, res) => {
  const productId = _chiffres(req.params.productId);
  if (!productId) return res.status(400).json({ error: 'productId invalide' });

  const shop  = req.shopDomain;
  const token = req.shopRecord?.access_token;
  if (!shop || !token) return res.status(403).json({ error: 'Contexte shop manquant' });

  const query = `
    query TslProductMedia($id: ID!) {
      product(id: $id) {
        id title handle
        featuredImage { id url width height }
        images(first: 20) { edges { node { id url width height altText } } }
      }
    }`;

  try {
    const out  = await adminGraphQL(shop, token, query, { id: `gid://shopify/Product/${productId}` });
    const prod = out?.data?.product;
    if (!prod) return res.status(404).json({ error: 'Produit introuvable' });

    const images = (prod.images?.edges || []).map(e => ({
      id: e.node.id, url: e.node.url, width: e.node.width, height: e.node.height, alt: e.node.altText || '',
    }));

    res.json({
      productId,
      title:    prod.title,
      handle:   prod.handle,
      featured: prod.featuredImage?.id || null,
      images,
      // `master` vaut par défaut pour toutes les photos ; `overrides` ne
      // concernent qu'une photo chacun.
      master:    _exposer(_lireMaster(getDB(), req.shopId, productId)),
      overrides: _lireZones(getDB(), req.shopId, productId)
                   .filter(z => z.is_master !== 1)
                   .map(_exposer),
    });
  } catch (e) {
    console.error('GET display-zone (admin) :', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/products/:productId/display-zone — enregistre la calibration
// ─────────────────────────────────────────────────────────────────────────────
router.put('/admin/products/:productId/display-zone', requireAuth, requireShopifySession, (req, res) => {
  const productId = _chiffres(req.params.productId);
  if (!productId) return res.status(400).json({ error: 'productId invalide' });

  const v = _validerCoins(req.body?.corners);
  if (v.erreur) return res.status(400).json({ error: v.erreur });

  const mediaId = String(req.body?.referenceMediaId || '').trim();
  if (!mediaId) return res.status(400).json({ error: 'Image de référence manquante' });
  const w = Number.parseInt(req.body?.referenceWidth, 10)  || null;
  const h = Number.parseInt(req.body?.referenceHeight, 10) || null;

  try {
    const db = getDB();
    const master = _lireMaster(db, req.shopId, productId);

    // Qui est qui :
    //   • pas encore de master  → cette zone le devient, elle vaudra pour
    //     toutes les photos du produit ;
    //   • on réenregistre la photo du master → on met le master à jour ;
    //   • une autre photo → remplacement propre à celle-ci, les autres ne
    //     bougent pas. C'est exactement le besoin du sac Kimood, dont
    //     certains coloris cadrent le produit plus haut.
    const estMaster = !master || master.reference_media_id === mediaId ? 1 : 0;

    db.prepare(`
      INSERT INTO product_display_zones
        (shop_id, shopify_product_id, zone_type, reference_media_id,
         reference_width, reference_height, corners_json, is_master, updated_at)
      VALUES (?,?,?,?,?,?,?,?, datetime('now'))
      ON CONFLICT(shop_id, shopify_product_id, zone_type, reference_media_id) DO UPDATE SET
        reference_width    = excluded.reference_width,
        reference_height   = excluded.reference_height,
        corners_json       = excluded.corners_json,
        updated_at         = datetime('now')
    `).run(req.shopId, productId, ZONE_TYPE, mediaId, w, h, JSON.stringify(v.coins), estMaster);

    _purgerRendus(productId);
    res.json({
      ok: true,
      estMaster: estMaster === 1,
      zone: _exposer(_zonePourPhoto(db, req.shopId, productId, mediaId)),
    });
  } catch (e) {
    console.error('PUT display-zone :', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/products/:productId/display-zone
// ─────────────────────────────────────────────────────────────────────────────
// Sans `?media=`, tout le produit est remis à zéro. Avec, seul le
// remplacement de cette photo disparaît et elle repasse sous le master.
router.delete('/admin/products/:productId/display-zone', requireAuth, requireShopifySession, (req, res) => {
  const productId = _chiffres(req.params.productId);
  if (!productId) return res.status(400).json({ error: 'productId invalide' });
  const media = String(req.query.media || '').trim();

  const db = getDB();
  const info = media
    ? db.prepare(
        `DELETE FROM product_display_zones
         WHERE shop_id=? AND shopify_product_id=? AND zone_type=? AND reference_media_id=? AND is_master=0`
      ).run(req.shopId, productId, ZONE_TYPE, media)
    : db.prepare(
        'DELETE FROM product_display_zones WHERE shop_id=? AND shopify_product_id=? AND zone_type=?'
      ).run(req.shopId, productId, ZONE_TYPE);

  _purgerRendus(productId);
  res.json({ deleted: info.changes > 0, portee: media ? 'photo' : 'produit' });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/product-display-zones — vue d'ensemble pour le back-office
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/product-display-zones', requireAuth, requireShopifySession, (req, res) => {
  const rows = getDB().prepare(
    'SELECT * FROM product_display_zones WHERE shop_id=? AND zone_type=? ORDER BY updated_at DESC'
  ).all(req.shopId, ZONE_TYPE);
  res.json(rows.map(_exposer));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products/:productId/display-zone — lecture publique
// ─────────────────────────────────────────────────────────────────────────────
// Appelée par la vitrine pour savoir si ce produit sait afficher un design sur
// sa photo. Toujours 200 : `exists: false` veut dire « pas calibré », ce qui
// n'est pas une erreur.
router.get('/products/:productId/display-zone', attachShopId, async (req, res) => {
  const productId = _chiffres(req.params.productId);
  if (!productId) return res.status(400).json({ error: 'productId invalide' });
  const db = getDB();
  const media = String(req.query.media || '').trim();
  const zone  = _exposer(_zonePourPhoto(db, req.shopId, productId, media));
  if (!zone) return res.json({ exists: false, productId });

  // ── Les faces personnalisables ────────────────────────────────────────
  //
  // Une zone calibrée sur une seconde photo, c'est une seconde face à
  // imprimer : le marchand a désigné où poser un visuel sur le dos du
  // vêtement. La vitrine a besoin de l'URL de chaque photo pour pouvoir
  // basculer de l'une à l'autre, d'où la résolution des médias ici.
  //
  // Jamais bloquant : sans jeton Shopify ou sans réponse de l'Admin API,
  // on rend la zone seule et la fiche reste mono-face, comme avant.
  let faces = [];
  try {
    const boutique = db.prepare(
      'SELECT shop_domain, access_token FROM shops WHERE id=? AND is_active=1'
    ).get(req.shopId);
    const zones = _lireZones(db, req.shopId, productId);
    if (boutique?.access_token && zones.length) {
      const { photosDuProduit } = require('./product-designs');
      const photos = await photosDuProduit(boutique.shop_domain, boutique.access_token, productId);
      const parId = {};
      photos.forEach((ph) => { parId[ph.id] = ph; });

      // Le master d'abord — c'est le recto par convention — puis les zones
      // propres à une photo, dans l'ordre où le produit les présente.
      const rang = (z) => {
        if (z.is_master === 1) return -1;
        const i = photos.findIndex((ph) => ph.id === z.reference_media_id);
        return i < 0 ? 999 : i;
      };
      faces = zones
        .slice()
        .sort((a2, b2) => rang(a2) - rang(b2))
        .map((z) => {
          const ph = parId[z.reference_media_id] || photos[0] || null;
          return {
            mediaId: z.reference_media_id || null,
            url:     ph ? ph.url : null,
            largeur: ph ? ph.width : null,
            hauteur: ph ? ph.height : null,
            corners: _lireCoins(z.corners_json),
            isMaster: z.is_master === 1,
          };
        })
        .filter((f) => f.url && f.corners.length === 4)
        // Le format de composition ne connaît que deux faces : au-delà, on
        // ne saurait pas où ranger la troisième ni quoi en imprimer.
        .slice(0, 2)
        .map((f, i) => ({ face: i === 0 ? 'front' : 'back', ...f }));
    }
  } catch (e) {
    console.warn('display-zone faces :', e.message);
  }

  res.json({ exists: true, ...zone, faces });
});

/**
 * Invalide les rendus déjà composés pour ce produit.
 * Sans ça, déplacer un coin ne changerait rien à l'écran tant que le cache
 * n'a pas expiré — et le cache, ici, est un fichier sur disque qui n'expire
 * jamais. require() paresseux : évite un cycle entre les deux routeurs.
 */
function _purgerRendus(productId) {
  try { require('./product-designs').purgerRendusProduit(productId); } catch {}
}

module.exports = router;
module.exports.ZONE_TYPE = ZONE_TYPE;
