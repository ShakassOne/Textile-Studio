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

/**
 * Les écritures d'un même produit, telles qu'on peut les croiser.
 *
 * L'admin enregistre les paires avec l'identifiant global de Shopify
 * (`gid://shopify/Product/123`), la vitrine ne connaît que le nombre que
 * rend `{{ product.id }}`. Sans ce rapprochement, une suggestion curée en
 * admin ne ressortirait jamais côté client — et le silence serait total.
 */
function formesId(id) {
  const brut = String(id == null ? '' : id).trim();
  if (!brut) return [];
  const num = (brut.match(/(\d+)\s*$/) || [])[1];
  const formes = [brut];
  if (num) {
    if (formes.indexOf(num) < 0) formes.push(num);
    const gid = 'gid://shopify/Product/' + num;
    if (formes.indexOf(gid) < 0) formes.push(gid);
  }
  return formes;
}

/**
 * Suggestions affichables par la vitrine, pour un produit source.
 *
 * Deux différences avec la vue admin : on accepte les deux écritures de
 * l'identifiant source, et on écarte les cibles qui ne sont PLUS liées à un
 * mockup — proposer un produit qu'on ne sait plus personnaliser mènerait le
 * client sur une fiche sans bouton.
 */
function listPublicForSource(db, shopId, sourceId, max) {
  const formes = formesId(sourceId);
  if (!formes.length) return [];
  const trous = formes.map(() => '?').join(', ');
  const rows = db.prepare(`
    ${SELECT_WITH_TARGET}
    WHERE uc.shop_id = ?
      AND uc.source_shopify_product_id IN (${trous})
      AND pl.shopify_product_handle IS NOT NULL
      AND pl.shopify_product_handle <> ''
    ORDER BY uc.sort_order ASC, uc.id ASC
  `).all(shopId, ...formes);
  const plafond = Number.isFinite(Number(max)) && Number(max) > 0 ? Number(max) : 4;
  return rows.slice(0, plafond).map((r) => ({
    product_id: r.target_shopify_product_id,
    handle:     r.target_handle,
    title:      r.target_title || '',
  }));
}

/** Suppression scopée shop : vérifie shop_id dans le WHERE, pas seulement l'id. */
function deleteCandidate(db, shopId, id) {
  const info = db.prepare('DELETE FROM upsell_candidates WHERE id = ? AND shop_id = ?').run(id, shopId);
  return { ok: true, deleted: info.changes > 0 };
}

module.exports = {
  listForSource, listGrouped, listPublicForSource, formesId,
  upsertCandidate, deleteCandidate,
};
