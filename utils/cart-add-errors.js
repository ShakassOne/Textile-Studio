'use strict';
/**
 * utils/cart-add-errors.js — Logique pure de routes/cart-add-errors.js
 * ─────────────────────────────────────────────────────────────────────────
 * Backlog item 31 (docs/ROADMAP-DEV.md §2) : tracker les refus silencieux de
 * `/cart/add` déjà détectés côté client (tl-modal.js, `err.panierRefuse`)
 * pour objectiver le point P0 (trou paiement commencé → commande) sans
 * dépendre d'un accès live à Shopify Analytics.
 *
 * Même structure que utils/upsell-candidates.js (logEvent/eventStats) :
 * extrait de la route pour rester testable sans requérir routes/auth.js
 * (setInterval de nettoyage de sessions au require, incompatible avec
 * `node --test`). `db` est injecté plutôt que résolu via getDB().
 */

/**
 * Enregistre un refus d'ajout au panier détecté par le client.
 *
 * Appelé sans authentification (sendBeacon depuis tl-modal.js) : jamais
 * d'erreur bloquante côté appelant, juste un statut utilisé par la route
 * pour le code HTTP.
 */
function logError(db, shopId, body) {
  const variant_id = String(body?.variantId || '').trim();
  const reason = String(body?.reason || '').trim().slice(0, 200);

  db.prepare(`
    INSERT INTO cart_add_errors (shop_id, variant_id, reason)
    VALUES (?, ?, ?)
  `).run(shopId, variant_id, reason);

  return { ok: true };
}

/**
 * Agrégat des `days` derniers jours : nombre total de refus + les raisons
 * les plus fréquentes (top 5). Volontairement minimal — juste assez pour
 * comparer le volume de refus avant/après un correctif donné.
 */
function stats(db, shopId, days) {
  const since = Number.isFinite(Number(days)) && Number(days) > 0 ? Number(days) : 30;

  const { total } = db.prepare(`
    SELECT COUNT(*) AS total
    FROM cart_add_errors
    WHERE shop_id = ?
      AND created_at >= datetime('now', '-' || ? || ' days')
  `).get(shopId, since);

  const topReasons = db.prepare(`
    SELECT reason, COUNT(*) AS n
    FROM cart_add_errors
    WHERE shop_id = ?
      AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY reason
    ORDER BY n DESC, reason ASC
    LIMIT 5
  `).all(shopId, since);

  return { total, topReasons };
}

module.exports = { logError, stats };
