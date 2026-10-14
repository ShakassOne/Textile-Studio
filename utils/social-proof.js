'use strict';
/**
 * utils/social-proof.js — Logique pure de routes/social-proof.js
 * ─────────────────────────────────────────────────────────────────────────
 * Extrait de la route pour rester testable sans requérir routes/auth.js
 * (même raison qu'utils/upsell-candidates.js : setInterval de nettoyage de
 * sessions au require, incompatible avec `node --test`).
 * `db` est injecté plutôt que résolu via getDB() pour permettre les tests
 * contre une base SQLite isolée.
 */

// Nombre max de vignettes affichées côté client — curation volontairement
// restreinte (backlog item 18 : "3-4 vignettes choisies à la main").
const MAX_PUBLIC_ITEMS = 4;

/** Toutes les vignettes du shop, triées — vue admin (gestion complète). */
function listForShop(db, shopId) {
  return db.prepare(`
    SELECT id, image_url, caption, sort_order, created_at
    FROM social_proof_items
    WHERE shop_id = ?
    ORDER BY sort_order ASC, id ASC
  `).all(shopId);
}

/** Vue publique : limitée à MAX_PUBLIC_ITEMS, sans id interne de gestion. */
function listPublicForShop(db, shopId) {
  return listForShop(db, shopId)
    .slice(0, MAX_PUBLIC_ITEMS)
    .map(({ image_url, caption }) => ({ image_url, caption }));
}

/** Crée une vignette. Retourne { ok: true, id } ou { error, status }. */
function createItem(db, shopId, body) {
  const image_url = String(body?.image_url || '').trim();
  const caption = String(body?.caption || '').trim();
  const sort_order = Number.isFinite(Number(body?.sort_order)) ? Number(body.sort_order) : 0;

  if (!image_url) {
    return { error: 'image_url est requis', status: 400 };
  }
  if (!/^https?:\/\//i.test(image_url)) {
    return { error: 'image_url doit être une URL http(s)', status: 400 };
  }

  const info = db.prepare(`
    INSERT INTO social_proof_items (shop_id, image_url, caption, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(shopId, image_url, caption, sort_order);

  return { ok: true, id: info.lastInsertRowid };
}

/** Suppression scopée shop : vérifie shop_id dans le WHERE, pas seulement l'id. */
function deleteItem(db, shopId, id) {
  const info = db.prepare('DELETE FROM social_proof_items WHERE id = ? AND shop_id = ?').run(id, shopId);
  return { ok: true, deleted: info.changes > 0 };
}

module.exports = { listForShop, listPublicForShop, createItem, deleteItem, MAX_PUBLIC_ITEMS };
