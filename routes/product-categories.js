/**
 * /api/product-categories
 * CRUD pour les catégories de produits TextileLab (scopé multi-tenant)
 */
const express      = require('express');
const router       = express.Router();
const { getDB }    = require('../db/database');
const { requireAuth } = require('./auth');
const { attachShopId } = require('./_shop-context');

// ── GET / — liste les catégories du shop courant ──────────────────────────
router.get('/', attachShopId, (req, res) => {
  const db   = getDB();
  const cats = db.prepare('SELECT * FROM product_categories WHERE shop_id=? ORDER BY sort_order, id').all(req.shopId);
  res.json(cats);
});

// ── POST / — créer une nouvelle catégorie (auth, scopé shop) ──────────────
router.post('/', requireAuth, attachShopId, (req, res) => {
  const { name, emoji = '📦' } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Le champ "name" est requis' });

  // Générer une clé slug depuis le nom
  const key = name.trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // accents
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 40);

  if (!key) return res.status(400).json({ error: 'Nom invalide (impossible de générer une clé)' });

  const db       = getDB();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM product_categories WHERE shop_id=?').get(req.shopId)?.m ?? -1;

  // Vérifier conflit de clé pour CE shop (la contrainte UNIQUE existante est globale ;
  // tant qu'on n'a pas migré la table en UNIQUE(shop_id,key), on fait le check applicatif).
  const dup = db.prepare('SELECT id FROM product_categories WHERE shop_id=? AND key=?').get(req.shopId, key);
  if (dup) return res.status(409).json({ error: `La clé "${key}" existe déjà — choisissez un nom différent` });

  try {
    const info = db.prepare(
      'INSERT INTO product_categories (shop_id, key, name, emoji, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).run(req.shopId, key, name.trim(), (emoji || '📦').trim(), maxOrder + 1);

    const cat = db.prepare('SELECT * FROM product_categories WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(cat);
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `La clé "${key}" existe déjà — choisissez un nom différent` });
    }
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /:id — modifier nom et/ou emoji (auth, scopé shop) ────────────────
router.put('/:id', requireAuth, attachShopId, (req, res) => {
  const db  = getDB();
  const cat = db.prepare('SELECT * FROM product_categories WHERE id = ? AND shop_id=?').get(req.params.id, req.shopId);
  if (!cat) return res.status(404).json({ error: 'Catégorie introuvable' });

  const newName  = (req.body?.name  || '').trim() || cat.name;
  const newEmoji = (req.body?.emoji || '').trim() || cat.emoji;

  db.prepare('UPDATE product_categories SET name = ?, emoji = ? WHERE id = ? AND shop_id=?')
    .run(newName, newEmoji, cat.id, req.shopId);

  res.json({ ...cat, name: newName, emoji: newEmoji });
});

// ── PATCH /reorder — réordonner (auth, scopé shop) ────────────────────────
router.patch('/reorder', requireAuth, attachShopId, (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: '"order" doit être un tableau d\'IDs' });

  const db     = getDB();
  const update = db.prepare('UPDATE product_categories SET sort_order = ? WHERE id = ? AND shop_id=?');
  const tx     = db.transaction(() => { order.forEach((id, i) => update.run(i, id, req.shopId)); });
  tx();
  res.json({ ok: true });
});

// ── DELETE /:id — supprimer (auth, scopé shop) ────────────────────────────
router.delete('/:id', requireAuth, attachShopId, (req, res) => {
  const db  = getDB();
  const cat = db.prepare('SELECT * FROM product_categories WHERE id = ? AND shop_id=?').get(req.params.id, req.shopId);
  if (!cat) return res.status(404).json({ error: 'Catégorie introuvable' });

  // Vérifier si des mockups utilisent encore cette catégorie (dans le même shop)
  const { n } = db.prepare('SELECT COUNT(*) as n FROM mockups WHERE shop_id=? AND product = ?').get(req.shopId, cat.key);
  if (n > 0) {
    return res.status(409).json({
      error: `Impossible de supprimer : ${n} mockup(s) utilisent encore cette catégorie. Réassignez-les d'abord.`
    });
  }

  db.prepare('DELETE FROM product_categories WHERE id = ? AND shop_id=?').run(cat.id, req.shopId);
  res.json({ ok: true });
});

module.exports = router;
