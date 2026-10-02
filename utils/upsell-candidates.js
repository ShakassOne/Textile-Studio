'use strict';
/**
 * utils/upsell-candidates.js — Logique pure de routes/upsell-candidates.js
 * ─────────────────────────────────────────────────────────────────────────
 * Extrait de la route pour rester testable sans requérir routes/auth.js
 * (setInterval de nettoyage de sessions au require, incompatible avec
 * `node --test` qui attend la fin de la boucle d'événements).
 * `db` est injecté plutôt que résolu via getDB() pour permettre les tests
 * contre une base SQLite isolée.
 */

const SELECT_WITH_TARGET = `
  SELECT
    uc.id, uc.source_shopify_product_id, uc.target_shopify_product_id,
    uc.sort_order, uc.created_at,
    pl.shopify_product_title  AS target_title,
    pl.shopify_product_handle AS target_handle,
    pl.mockup_id              AS target_mockup_id
  FROM upsell_candidates uc
  LEFT JOIN product_mockup_links pl
    ON pl.shopify_product_id = uc.target_shopify_product_id AND pl.shop_id = uc.shop_id
`;

/** Candidats pour un produit source donné, triés par sort_order. */
function listForSource(db, shopId, sourceId) {
  return db.prepare(`
    ${SELECT_WITH_TARGET}
    WHERE uc.shop_id = ? AND uc.source_shopify_product_id = ?
    ORDER BY uc.sort_order ASC, uc.id ASC
  `).all(shopId, sourceId);
}

/** Tous les candidats du shop, groupés par produit source (vue d'ensemble admin). */
function listGrouped(db, shopId) {
  const rows = db.prepare(`
    ${SELECT_WITH_TARGET}
    WHERE uc.shop_id = ?
    ORDER BY uc.source_shopify_product_id ASC, uc.sort_order ASC, uc.id ASC
  `).all(shopId);
  const grouped = {};
  for (const row of rows) {
    (grouped[row.source_shopify_product_id] ||= []).push(row);
  }
  return grouped;
}

/**
 * Upsert d'un candidat. Retourne { ok: true } ou { error, status }.
 * Rejette source === target (400) : un produit ne se suggère pas lui-même.
 */
function upsertCandidate(db, shopId, body) {
  const source_shopify_product_id = String(body?.source_shopify_product_id || '').trim();
  const target_shopify_product_id = String(body?.target_shopify_product_id || '').trim();
  const sort_order = Number.isFinite(Number(body?.sort_order)) ? Number(body.sort_order) : 0;

  if (!source_shopify_product_id || !target_shopify_product_id) {
    return { error: 'source_shopify_product_id et target_shopify_product_id sont requis', status: 400 };
  }
  if (source_shopify_product_id === target_shopify_product_id) {
    return { error: 'Un produit ne peut pas se suggérer lui-même', status: 400 };
  }

  db.prepare(`
    INSERT INTO upsell_candidates
      (shop_id, source_shopify_product_id, target_shopify_product_id, sort_order)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(shop_id, source_shopify_product_id, target_shopify_product_id) DO UPDATE SET
      sort_order = excluded.sort_order
  `).run(shopId, source_shopify_product_id, target_shopify_product_id, sort_order);

  return { ok: true };
}

/** Suppression scopée shop : vérifie shop_id dans le WHERE, pas seulement l'id. */
function deleteCandidate(db, shopId, id) {
  const info = db.prepare('DELETE FROM upsell_candidates WHERE id = ? AND shop_id = ?').run(id, shopId);
  return { ok: true, deleted: info.changes > 0 };
}

module.exports = { listForSource, listGrouped, upsertCandidate, deleteCandidate };
