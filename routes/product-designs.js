'use strict';
/**
 * routes/product-designs.js — Quels visuels proposer sur une fiche produit.
 * ──────────────────────────────────────────────────────────────────────────
 * Le client final choisit son design depuis la page produit, sans que le
 * marchand ait eu à décliner 50 produits × 200 visuels dans Shopify. Cette
 * route répond à la seule question que pose la vitrine : « pour CE produit,
 * quels visuels de la bibliothèque ont du sens ? »
 *
 * Le filtrage se fait en trois temps, du moins coûteux au plus coûteux :
 *   1. le visuel est-il proposé à la vente (`is_active`) ;
 *   2. le marchand a-t-il exclu ce support à la main (`excluded_mockups`) ;
 *   3. la règle automatique tient-elle (résolution et proportions dans la
 *      zone d'impression du mockup) — cf. utils/design-library.js.
 *
 * Principe directeur : on n'écarte jamais un visuel faute de données. Produit
 * non lié à un mockup, mockup sans zone calibrée, visuel sans dimensions
 * connues → tout passe. Un catalogue trop large est un inconvénient ; un
 * catalogue amputé sans explication est un bug invisible.
 *
 * Route PUBLIQUE : appelée depuis le thème via l'App Proxy, donc sans session
 * admin. Le shop est résolu comme dans routes/storefront.js (X-Shop-Domain
 * ou ?shop), par `attachShopId`.
 */

const express = require('express');
const router  = express.Router();
const { attachShopId } = require('./_shop-context');
const { getDB }        = require('../db/database');
const DL               = require('../utils/design-library');

// Le catalogue bouge rarement et la fiche produit est une page chaude : un
// cache court évite de refaire le calcul à chaque visiteur. Clé par
// (shop, produit, vue).
const CACHE_MS = 2 * 60 * 1000;
const _cache = new Map();

function _cacheLire(cle) {
  const e = _cache.get(cle);
  if (!e) return null;
  if (Date.now() - e.t > CACHE_MS) { _cache.delete(cle); return null; }
  return e.v;
}
function _cacheEcrire(cle, v) {
  // Garde-fou mémoire : au-delà de 200 entrées on repart de zéro plutôt que
  // de laisser la map grossir indéfiniment sur une boutique à gros catalogue.
  if (_cache.size > 200) _cache.clear();
  _cache.set(cle, { t: Date.now(), v });
}

/** Vide le cache (appelé quand la bibliothèque change). */
function viderCacheDesigns() { _cache.clear(); }

/**
 * Efface les rendus déjà composés pour un produit.
 * Appelé quand sa zone d'affichage change : le cache est un fichier sur
 * disque, il n'expire jamais tout seul, et sans cette purge un coin déplacé
 * resterait invisible.
 */
function purgerRendusProduit(productId) {
  const fs = require('fs'), path = require('path');
  const dir = path.join(process.env.DATA_DIR || path.join(__dirname, '..'),
                        'uploads', 'generated', 'photos');
  try {
    const prefixe = `p${String(productId).replace(/\D/g, '')}_`;
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(prefixe)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
    }
  } catch { /* dossier absent : rien à purger */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products/:productId/designs
// ─────────────────────────────────────────────────────────────────────────────
// Réponse :
//   { productId, mockupId, viewIndex, zone, total, designs: [...],
//     ecartes: [{ id, nom, raison, dpi, remplissage }] }
//
// `ecartes` n'est pas du débogage de luxe : c'est ce qui permet de régler les
// seuils de la règle sur de vrais mockups plutôt qu'au jugé.
router.get('/products/:productId/designs', attachShopId, (req, res) => {
  const productId = String(req.params.productId || '').replace(/\D/g, '');
  if (!productId) return res.status(400).json({ error: 'productId invalide' });

  const viewIndex = Math.max(0, Number.parseInt(req.query.view, 10) || 0);
  const cle = `${req.shopId}:${productId}:${viewIndex}`;
  const cached = _cacheLire(cle);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const db = getDB();

    // 1. Produit → mockup lié. Pas de liaison : aucun support à vérifier, on
    //    renvoie tout le catalogue actif.
    //
    //    La colonne mélange deux écritures selon l'époque de la liaison : des
    //    identifiants numériques et des GID complets
    //    ("gid://shopify/Product/10743954145607"). Le thème, lui, ne connaîtra
    //    que {{ product.id }}, numérique. On interroge donc les deux formes.
    const lien = db.prepare(
      `SELECT mockup_id FROM product_mockup_links
       WHERE shop_id=? AND (shopify_product_id=? OR shopify_product_id=?)`
    ).get(req.shopId, productId, `gid://shopify/Product/${productId}`);
    const mockupId = lien?.mockup_id || null;

    // 2. Zone d'impression de la vue demandée, et format retenu pour ce
    //    support. `defaultFormat` n'existe pas encore dans l'admin : tant
    //    qu'il n'est pas posé, A4 s'applique — le choix d'Alan pour le
    //    sélecteur de la fiche produit.
    let zoneMm = null, format = DL.FORMAT_PAR_DEFAUT;
    if (mockupId) {
      const m = db.prepare('SELECT views_json FROM mockups WHERE id=? AND shop_id=?')
                  .get(mockupId, req.shopId);
      let vues = [];
      try { vues = JSON.parse(m?.views_json || '[]'); } catch { vues = []; }
      const vue = vues[viewIndex];
      zoneMm = DL.zoneEnMm(vue);
      if (vue && DL.FORMATS_MM[vue.defaultFormat]) format = vue.defaultFormat;
    }

    // 3. Visuels proposés à la vente, dans l'ordre choisi par le marchand.
    const visuels = db.prepare(`
      SELECT id, slug, display_name, filename, url, thumb_url, category, tags,
             excluded_mockups, width, height, sort_order
      FROM library
      WHERE shop_id=? AND is_active=1 AND filename NOT LIKE '__cat_placeholder_%'
      ORDER BY sort_order ASC, created_at DESC
    `).all(req.shopId);

    const designs = [];
    const ecartes = [];

    for (const v of visuels) {
      if (mockupId && DL.parseJsonArray(v.excluded_mockups).map(Number).includes(Number(mockupId))) {
        ecartes.push({ id: v.id, nom: v.display_name, raison: 'exclu-manuellement', dpi: null, remplissage: null });
        continue;
      }
      const verdict = DL.evaluerCompatibilite(v, zoneMm, { format });
      if (!verdict.compatible) {
        ecartes.push({ id: v.id, nom: v.display_name, raison: verdict.raison, dpi: verdict.dpi, remplissage: verdict.remplissage });
        continue;
      }
      designs.push({
        id:        v.id,
        slug:      v.slug,
        nom:       v.display_name,
        url:       v.url,
        thumb:     v.thumb_url || v.url,
        categorie: v.category,
        tags:      DL.parseJsonArray(v.tags),
        width:     v.width,
        height:    v.height,
      });
    }

    const corps = {
      productId,
      mockupId,
      viewIndex,
      zone:  zoneMm,
      format,
      total: designs.length,
      categories: [...new Set(designs.map(d => d.categorie).filter(Boolean))],
      designs,
      ecartes,
    };
    _cacheEcrire(cle, corps);
    res.json(corps);
  } catch (e) {
    console.error('GET /products/:id/designs :', e.message);
    // Jamais de liste vide silencieuse : le thème doit pouvoir distinguer
    // « aucun design ne convient » de « le serveur n'a pas pu répondre ».
    res.status(500).json({ error: 'Lecture du catalogue impossible', designs: null });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products/:productId/preview?design=<slug|id>&media=<gid>
// ─────────────────────────────────────────────────────────────────────────────
// La PHOTO du produit avec le design dessus. Pas un packshot à côté : l'image
// que le client regarde déjà, avec son tissu, sa couleur et ses plis.
//
// Trois étapes :
//   1. le design est projeté dans le quadrilatère calibré en admin
//      (product_display_zone), donc en perspective et pas à plat ;
//   2. les ombres de la photo sont reportées dessus, sinon le design flotte
//      au-dessus du vêtement au lieu de reposer sur le tissu ;
//   3. le tout est composé sur la photo et mis en cache sur disque.
//
// Le paramètre `media` permet de demander une AUTRE photo du même produit —
// c'est ce qui fait fonctionner les quatorze coloris du sac Kimood avec une
// seule calibration : même cadrage, donc mêmes coins.
const fs   = require('fs');
const path = require('path');
const PERSP = require('../utils/perspective');

const PHOTO_LARGEUR_MAX = 1000; // la fiche produit n'affiche jamais plus
const OMBRE_MIN = 0.55;         // jusqu'où un pli peut assombrir le design
const OMBRE_MAX = 1.35;         // jusqu'où un reflet peut l'éclaircir
const PHOTOS_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..'),
                             'uploads', 'generated', 'photos');

// Deux visiteurs peuvent demander le même rendu en même temps : sans ce
// registre, on paierait la composition deux fois.
const _enCours = new Map();

// Les photos d'un produit changent rarement ; un appel Admin API par rendu
// serait du gaspillage.
const MEDIA_TTL = 5 * 60 * 1000;
const _mediaCache = new Map();

/**
 * Nom de fichier d'une URL d'image, sans les paramètres de transformation du
 * CDN Shopify (?v=…&width=…). C'est la seule partie stable entre la vignette
 * servie à la vitrine et l'URL renvoyée par l'Admin API.
 */
function _nomDeFichier(u) {
  const s = String(u || '').split('?')[0];
  if (!s.includes('/')) return '';
  return s.slice(s.lastIndexOf('/') + 1).toLowerCase()
    // Anciens thèmes : « sac_600x800.jpg », « sac_600x.jpg » désignent le même
    // fichier que « sac.jpg » à une taille près.
    .replace(/_\d+x\d*(?=\.[a-z0-9]+$)/, '');
}

/** Identifiant Shopify → fragment de nom de fichier sûr. */
function _cleFichier(v) {
  return String(v || '').replace(/[^a-zA-Z0-9]/g, '').slice(-16) || 'x';
}

async function _photosDuProduit(shop, token, productId) {
  const cle = `${shop}:${productId}`;
  const e = _mediaCache.get(cle);
  if (e && Date.now() - e.t < MEDIA_TTL) return e.v;

  const { adminGraphQL } = require('./admin-graphql');
  const out = await adminGraphQL(shop, token, `
    query TslPhotos($id: ID!) {
      product(id: $id) { images(first: 30) { edges { node { id url width height } } } }
    }`, { id: `gid://shopify/Product/${productId}` });

  const v = (out?.data?.product?.images?.edges || []).map(x => x.node);
  _mediaCache.set(cle, { t: Date.now(), v });
  return v;
}

/** Octets d'un visuel, qu'il soit sur le disque local ou sur un CDN. */
async function _octetsDuVisuel(url) {
  if (/^https?:\/\//i.test(url)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`visuel distant HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  const base = process.env.DATA_DIR || path.join(__dirname, '..');
  return fs.promises.readFile(path.join(base, url));
}

/**
 * Reporte les ombres de la photo sur le design projeté.
 *
 * Sans ça, le design est un rectangle de couleur posé par-dessus : l'œil voit
 * immédiatement un collage. En multipliant chaque pixel par la luminance
 * locale du tissu rapportée à sa moyenne, les plis et les ombres traversent
 * le design — c'est le même principe que le mode Produit de Photoshop, en
 * plus simple.
 *
 * Les bornes évitent qu'une ombre très marquée n'avale le design, ou qu'un
 * reflet ne le délave.
 */
function _appliquerOmbres(calque, photoGris, w, h) {
  let somme = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    if (calque[i * 4 + 3] > 8) { somme += photoGris[i]; n++; }
  }
  if (!n) return calque;
  const moyenne = somme / n;
  if (moyenne < 1) return calque;

  for (let i = 0; i < w * h; i++) {
    if (calque[i * 4 + 3] <= 8) continue;
    let f = photoGris[i] / moyenne;
    if (f < OMBRE_MIN) f = OMBRE_MIN;
    if (f > OMBRE_MAX) f = OMBRE_MAX;
    const o = i * 4;
    calque[o]     = Math.min(255, Math.round(calque[o]     * f));
    calque[o + 1] = Math.min(255, Math.round(calque[o + 1] * f));
    calque[o + 2] = Math.min(255, Math.round(calque[o + 2] * f));
  }
  return calque;
}

router.get('/products/:productId/preview', attachShopId, async (req, res) => {
  const productId = String(req.params.productId || '').replace(/\D/g, '');
  const ref       = String(req.query.design || '').trim();
  if (!productId || !ref) return res.status(400).json({ error: 'productId et design requis' });

  try {
    const db = getDB();

    const visuel = /^\d+$/.test(ref)
      ? db.prepare('SELECT * FROM library WHERE shop_id=? AND id=? AND is_active=1').get(req.shopId, Number(ref))
      : db.prepare('SELECT * FROM library WHERE shop_id=? AND slug=? AND is_active=1').get(req.shopId, ref);
    if (!visuel) return res.status(404).json({ error: 'Visuel introuvable' });

    const zones = db.prepare(
      `SELECT * FROM product_display_zones
       WHERE shop_id=? AND shopify_product_id=? AND zone_type='product_display_zone'`
    ).all(req.shopId, productId);
    const master = zones.find(z => z.is_master === 1);
    if (!master) return res.status(404).json({ error: 'Produit sans zone d\'affichage calibrée' });

    const boutique = db.prepare('SELECT shop_domain, access_token FROM shops WHERE id=? AND is_active=1')
                       .get(req.shopId);
    if (!boutique?.access_token) return res.status(503).json({ error: 'Shopify non configuré' });

    const photos = await _photosDuProduit(boutique.shop_domain, boutique.access_token, productId);
    if (!photos.length) return res.status(404).json({ error: 'Produit sans photo' });

    // ── Quelle photo, et avec quelle zone ────────────────────────────────
    //
    // `media` peut être un GID Shopify ou l'URL que la vitrine affiche déjà —
    // c'est cette seconde forme que le thème sait fournir, le DOM n'exposant
    // pas les identifiants de média. On compare alors les noms de fichier.
    const demandee = String(req.query.media || '').trim();
    let photo = photos.find(p => p.id === master.reference_media_id) || photos[0];
    let zone  = master;

    if (demandee) {
      const cle = _nomDeFichier(demandee);
      const candidate = photos.find(p =>
        p.id === demandee ||
        _cleFichier(p.id) === _cleFichier(demandee) ||
        (cle && _nomDeFichier(p.url) === cle));

      if (candidate) {
        // Une zone calibrée SUR cette photo l'emporte, et sans contrôle de
        // dimensions : elle y a été posée, elle est juste par construction.
        const propre = zones.find(z => z.is_master !== 1 && z.reference_media_id === candidate.id);
        if (propre) {
          photo = candidate; zone = propre;
        } else if ((!master.reference_width  || candidate.width  === master.reference_width) &&
                   (!master.reference_height || candidate.height === master.reference_height)) {
          // Même cadrage que la photo de référence : le master s'applique.
          photo = candidate;
        } else {
          // Cadrage différent et aucune zone propre : on ne devine pas. Mieux
          // vaut laisser la photo intacte qu'y poser un design de travers.
          return res.status(404).json({ error: 'Photo non calibrée pour ce produit' });
        }
      }
    }

    let coinsPct = [];
    try { coinsPct = JSON.parse(zone.corners_json || '[]'); } catch { coinsPct = []; }
    if (coinsPct.length !== 4) return res.status(409).json({ error: 'Zone illisible' });

    const fichier  = `p${productId}_m${_cleFichier(photo.id)}_d${visuel.id}.png`;
    const chemin   = path.join(PHOTOS_DIR, fichier);
    const publique = `/uploads/generated/photos/${fichier}`;

    if (fs.existsSync(chemin)) return res.redirect(302, publique);
    if (_enCours.has(fichier)) { await _enCours.get(fichier); return res.redirect(302, publique); }

    const travail = (async () => {
      const sharp = require('sharp');

      // ── 1. La photo, ramenée à une taille d'affichage ────────────────────
      const photoBrute = Buffer.from(await (await fetch(photo.url)).arrayBuffer());
      const fond = sharp(photoBrute).resize({ width: PHOTO_LARGEUR_MAX, withoutEnlargement: true });
      const { data: fondPix, info } = await fond.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const W = info.width, H = info.height;

      // ── 2. Les coins, en pixels de cette image ───────────────────────────
      const coins = PERSP.coinsEnPixels(coinsPct, W, H);
      if (!coins) throw new Error('Coins inexploitables');
      const cadre = PERSP.cadreEnglobant(coins, W, H);
      if (!cadre.w || !cadre.h) throw new Error('Zone hors de la photo');

      // ── 3. Le design, à une définition adaptée à la zone ─────────────────
      //    Inutile d'échantillonner une image de 4000 px pour une zone de 300.
      const cote = Math.max(cadre.w, cadre.h);
      const { data: dPix, info: dInfo } = await sharp(await _octetsDuVisuel(visuel.url))
        .resize({ width: cote, height: cote, fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      // ── 4. Projection dans le quadrilatère ───────────────────────────────
      const calque = PERSP.projeterDansQuadrilatere(dPix, dInfo.width, dInfo.height, coins, cadre);
      if (!calque) throw new Error('Projection impossible');

      // ── 5. Ombres du tissu reportées sur le design ───────────────────────
      const gris = await sharp(fondPix, { raw: { width: W, height: H, channels: 4 } })
        .extract({ left: cadre.x, top: cadre.y, width: cadre.w, height: cadre.h })
        .grayscale()
        .raw()
        .toBuffer();
      _appliquerOmbres(calque, gris, cadre.w, cadre.h);

      // ── 6. Composition ───────────────────────────────────────────────────
      const png = await sharp(fondPix, { raw: { width: W, height: H, channels: 4 } })
        .composite([{
          input: Buffer.from(calque),
          raw:   { width: cadre.w, height: cadre.h, channels: 4 },
          left:  cadre.x,
          top:   cadre.y,
        }])
        .png()
        .toBuffer();

      await fs.promises.mkdir(PHOTOS_DIR, { recursive: true });
      await fs.promises.writeFile(chemin, png);
    })();

    _enCours.set(fichier, travail);
    try { await travail; } finally { _enCours.delete(fichier); }
    res.redirect(302, publique);
  } catch (e) {
    console.error('GET /products/:id/preview :', e.message);
    res.status(500).json({ error: 'Aperçu indisponible' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products/:productId/colors — coloris réellement vendus
// ─────────────────────────────────────────────────────────────────────────────
// Le studio affichait sa palette générique de 36 couleurs textile, y compris
// sur un produit qui n'en vend que quatorze. Le client pouvait donc composer
// un sac dans un coloris inexistant.
//
// On lit les pastilles natives de Shopify (`optionValues.swatch`), celles-là
// mêmes qui s'affichent sur la fiche produit. Elles n'existent qu'à partir de
// l'API 2024-07, d'où la version forcée sur cet appel précis.
const COULEURS_TTL = 10 * 60 * 1000;
const _couleursCache = new Map();

/**
 * Teinte dominante d'une photo de produit.
 * ──────────────────────────────────────────────────────────────────────────
 * Les packshots Toptex sont sur fond blanc : en écartant les pixels quasi
 * blancs, il ne reste que le tissu. On prend la MÉDIANE par canal et non la
 * moyenne — une ombre portée ou un reflet tirerait la moyenne, la médiane
 * les ignore.
 *
 * @returns {Promise<string|null>} "#rrggbb", ou null si rien d'exploitable
 */
async function _teinteDominante(url) {
  try {
    const sharp = require('sharp');
    const r = await fetch(url.split('?')[0] + '?width=120');
    if (!r.ok) return null;
    const { data, info } = await sharp(Buffer.from(await r.arrayBuffer()))
      .resize(100, 100, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rs = [], gs = [], bs = [];
    for (let i = 0; i < info.width * info.height; i++) {
      const o = i * info.channels;
      const a = data[o + 3];
      if (a < 128) continue;                                   // transparent
      const R = data[o], G = data[o + 1], B = data[o + 2];
      if (Math.min(R, G, B) > 245) continue;                   // fond blanc
      if (Math.max(R, G, B) < 18) continue;                    // ombre noire
      rs.push(R); gs.push(G); bs.push(B);
    }
    if (rs.length < 200) return null; // trop peu de matière pour conclure

    const med = (t) => { t.sort((a, b) => a - b); return t[Math.floor(t.length / 2)]; };
    const hex = (n) => n.toString(16).padStart(2, '0');
    return `#${hex(med(rs))}${hex(med(gs))}${hex(med(bs))}`;
  } catch { return null; }
}

/**
 * Un coloris par valeur de l'option couleur, déduit de la photo de la
 * première variante qui la porte.
 */
async function _couleursDepuisLesPhotos(boutique, productId, nomOption) {
  const { adminGraphQL } = require('./admin-graphql');
  const out = await adminGraphQL(boutique.shop_domain, boutique.access_token, `
    query TslVariantes($id: ID!) {
      product(id: $id) {
        variants(first: 100) {
          edges { node { selectedOptions { name value } image { url } } }
        }
      }
    }`, { id: `gid://shopify/Product/${productId}` });

  // Une photo par valeur de couleur : la première rencontrée fait foi.
  const parValeur = new Map();
  for (const e of out?.data?.product?.variants?.edges || []) {
    const v = e.node;
    const opt = (v.selectedOptions || []).find(o => o.name === nomOption);
    const url = v.image?.url;
    if (!opt?.value || !url || parValeur.has(opt.value)) continue;
    parValeur.set(opt.value, url);
  }

  const entrees = [...parValeur.entries()];
  const teintes = await Promise.all(entrees.map(([, url]) => _teinteDominante(url)));
  return entrees
    .map(([name], i) => ({ name, hex: teintes[i], source: 'photo' }))
    .filter(c => c.hex);
}

router.get('/products/:productId/colors', attachShopId, async (req, res) => {
  const productId = String(req.params.productId || '').replace(/\D/g, '');
  if (!productId) return res.status(400).json({ error: 'productId invalide' });

  const cle = `${req.shopId}:${productId}`;
  const e = _couleursCache.get(cle);
  if (e && Date.now() - e.t < COULEURS_TTL) return res.json({ ...e.v, cached: true });

  try {
    const db = getDB();
    const boutique = db.prepare('SELECT shop_domain, access_token FROM shops WHERE id=? AND is_active=1')
                       .get(req.shopId);
    if (!boutique?.access_token) return res.json({ exists: false, colors: [] });

    const { adminGraphQL } = require('./admin-graphql');
    // Trois sources possibles pour une pastille, selon la façon dont le
    // marchand a renseigné ses coloris :
    //   • swatch.color              — pastille native Shopify
    //   • linkedMetafield           — option reliée à la taxonomie Shopify
    //   • métachamp couleur du produit
    const out = await adminGraphQL(boutique.shop_domain, boutique.access_token, `
      query TslCouleurs($id: ID!) {
        product(id: $id) {
          options {
            name
            linkedMetafield { namespace key }
            optionValues { name linkedMetafieldValue swatch { color image { id } } }
          }
        }
      }`, { id: `gid://shopify/Product/${productId}` }, '2025-01');

    if (String(req.query.debug || '') === '1') {
      return res.json({ brut: out?.data?.product?.options || null, erreurs: out?.errors || null });
    }

    const options = out?.data?.product?.options || [];
    const optCouleur = options.find(o => /couleur|colou?r|teinte/i.test(o.name || ''));
    if (!optCouleur) {
      const vide = { exists: false, optionName: null, total: 0, colors: [] };
      _couleursCache.set(cle, { t: Date.now(), v: vide });
      return res.json(vide);
    }

    let colors = (optCouleur.optionValues || [])
      .map(v => ({ name: v.name, hex: (v.swatch?.color || '').trim(), source: 'pastille' }))
      .filter(c => /^#[0-9a-fA-F]{6}$/.test(c.hex));

    // Repli : déduire la teinte de la photo de chaque variante.
    //
    // Les pastilles natives de Shopify ne sont pas toujours renseignées — sur
    // le catalogue Toptex de WinShirt, aucune ne l'est, alors que le thème
    // affiche pourtant des pastilles justes (il les tient de ses propres
    // réglages, auxquels l'app n'a pas accès faute du scope read_themes).
    // Plutôt que d'imposer une saisie manuelle sur cinquante références, on
    // lit la couleur là où elle est de toute façon : sur la photo du produit
    // dans ce coloris.
    if (!colors.length) {
      colors = await _couleursDepuisLesPhotos(boutique, productId, optCouleur.name);
    }

    const corps = {
      exists: colors.length > 0,
      optionName: optCouleur.name,
      total: (optCouleur.optionValues || []).length,
      colors,
    };
    _couleursCache.set(cle, { t: Date.now(), v: corps });
    res.json(corps);
  } catch (err) {
    // Jamais bloquant : sans coloris, le studio garde sa palette générique.
    console.warn('GET /products/:id/colors :', err.message);
    res.json({ exists: false, colors: [], error: err.message });
  }
});

module.exports = router;
module.exports.viderCacheDesigns = viderCacheDesigns;
module.exports.purgerRendusProduit = purgerRendusProduit;
