'use strict';
/**
 * utils/product-links.js — normalisation de l'identifiant produit Shopify
 * ─────────────────────────────────────────────────────────────────────────
 * Deux sources écrivent/lisent `shopify_product_id`, dans deux formats
 * différents : l'admin (`GET /api/admin/products`, GraphQL Admin API) qui
 * renvoie un GID complet (`gid://shopify/Product/123456`), et la fiche
 * produit Shopify (Liquid `product.id`) qui ne connaît que l'id numérique
 * brut (`123456`). Sans normalisation, une liaison enregistrée depuis
 * l'admin (GID) ne correspond jamais à un produit résolu côté studio
 * uniquement par son id numérique (quand l'URL n'a pas de `product=<handle>`,
 * par ex. un bouton qui ne transmet que `product_id`) — la liaison existe
 * bien en base, mais la recherche échoue silencieusement.
 */

// Extrait l'id numérique final d'un GID Shopify ("gid://shopify/Product/123"
// → "123"), ou renvoie la valeur telle quelle si ce n'est PAS un GID (déjà un
// id numérique brut, un handle comme "toptex-ib311", ou une valeur vide).
// Le préfixe "gid://shopify/.../" est exigé explicitement — une simple
// recherche de chiffres en fin de chaîne tronquerait à tort un handle qui se
// termine par un nombre (ex. "toptex-ib311" → "311").
function normalizeProductId(id) {
  const s = String(id == null ? '' : id).trim();
  if (!s) return s;
  const m = s.match(/^gid:\/\/shopify\/\w+\/(\d+)$/);
  return m ? m[1] : s;
}

module.exports = { normalizeProductId };
