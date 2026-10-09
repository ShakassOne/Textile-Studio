'use strict';
/**
 * utils/design-resume.js — Logique pure de la reprise de création (backlog item 24)
 * ─────────────────────────────────────────────────────────────────────────
 * Un client connecté qui interrompt sa personnalisation avant achat (onglet
 * fermé, coupure mobile, hésitation) repartait jusqu'ici de zéro en revenant
 * sur le produit. Extrait en module pur (même raison qu'utils/social-proof.js :
 * routes/designs.js require routes/auth.js, qui pose un setInterval de
 * nettoyage de sessions au require() — incompatible avec `node --test`).
 *
 * `designs.product` stocke la clé du MOCKUP (ex. "tshirt"), pas l'identifiant
 * Shopify du produit : il faut donc d'abord résoudre le produit demandé (id
 * ou handle, comme reçu par le storefront) vers sa clé de mockup via
 * product_mockup_links, exactement comme le fait déjà
 * GET /api/product-links/by-product/:productId (routes/product-links.js).
 */

// Fenêtre de rétention avant qu'un design non converti ne soit plus proposé
// en reprise — valeur par défaut proposée dans le backlog (item 24), alignée
// sur la fenêtre déjà utilisée pour les stats upsell (item 17, routes/
// upsell-candidates.js). À ajuster avec Alan si besoin.
const RESUME_WINDOW_DAYS = 30;

function _mockupKeyForProduct(db, shopId, productRef) {
  const row = db.prepare(`
    SELECT m.product AS mockup_product
    FROM product_mockup_links pl
    JOIN mockups m ON pl.mockup_id = m.id AND m.shop_id = pl.shop_id
    WHERE pl.shop_id = ? AND (pl.shopify_product_id = ? OR pl.shopify_product_handle = ?)
  `).get(shopId, productRef, productRef);
  return row ? row.mockup_product : null;
}

/**
 * Dernière création non convertie de ce client pour ce produit, ou null.
 * `productRef` : id Shopify ou handle, comme transmis par le storefront
 * (même repère que GET /api/product-links/by-product/:productId).
 * Jamais convertie = aucune commande (orders.design_id) ne la référence.
 */
function findResumable(db, shopId, customerId, productRef, days = RESUME_WINDOW_DAYS) {
  if (!shopId || !customerId || !productRef) return null;
  const mockupKey = _mockupKeyForProduct(db, shopId, productRef);
  if (!mockupKey) return null; // produit non lié à un mockup → rien à reprendre

  const row = db.prepare(`
    SELECT id, updated_at
    FROM designs
    WHERE shop_id = ? AND customer_id = ? AND product = ?
      AND updated_at >= datetime('now', '-' || ? || ' days')
      AND id NOT IN (SELECT design_id FROM orders WHERE design_id IS NOT NULL)
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(shopId, customerId, mockupKey, days);

  return row || null;
}

module.exports = { findResumable, RESUME_WINDOW_DAYS };
