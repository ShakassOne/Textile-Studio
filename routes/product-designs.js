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

    // 2. Zone d'impression de la vue demandée.
    let zoneMm = null;
    if (mockupId) {
      const m = db.prepare('SELECT views_json FROM mockups WHERE id=? AND shop_id=?')
                  .get(mockupId, req.shopId);
      let vues = [];
      try { vues = JSON.parse(m?.views_json || '[]'); } catch { vues = []; }
      zoneMm = DL.zoneEnMm(vues[viewIndex]);
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
      const verdict = DL.evaluerCompatibilite(v, zoneMm);
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

module.exports = router;
module.exports.viderCacheDesigns = viderCacheDesigns;
