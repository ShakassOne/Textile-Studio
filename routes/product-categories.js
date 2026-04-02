/**
 * /api/product-categories
 * CRUD pour les catégories de produits TextileLab
 */
const express      = require('express');
const router       = express.Router();
const { getDB }    = require('../db/database');
const { requireAuth } = require('./auth');

// ── GET / — liste toutes les catégories (public) ──────────────────────────
router.get('/', (req, res) => {
  const db   = getDB();
  const cats = db.prepare('SELECT * FROM product_categories ORDER BY sort_order, id').all();
  res.json(cats);
});

// ── POST / — créer une nouvelle catégorie (auth) ──────────────────────────
router.post('/', requireAuth, (req, res) => {
  const { name, emoji = '📦' } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Le champ "name" est requis' });

  // Générer une clé slug depuis le nom
  const key = name.trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // accents
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 40);

  if (!key) return res.status(400).json({ error: 'Nom invalide (impossible de générer une clé)' });

  const db       = getDB();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM product_categories').get()?.m ?? -1;

  try {
    const info = db.prepare(
      'INSERT INTO product_categories (key, name, emoji, sort_order) VALUES (?, ?, ?, ?)'
    ).run(key, name.trim(), (emoji || '📦').trim(), maxOrder + 1);

    const cat = db.prepare('SELECT * FROM product_categories WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(cat);
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `La clé "${key}" existe déjà — choisissez un nom différent` });
    }
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /:id — modifier nom et/ou emoji (auth) ────────────────────────────
router.put('/:id', requireAuth, (req, res) => {
  const db  = getDB();
  const cat = db.prepare('SELECT * FROM product_categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Catégorie introuvable' });

  const newName  = (req.body?.name  || '').trim() || cat.name;
  const newEmoji = (req.body?.emoji || '').trim() || cat.emoji;

  db.prepare('UPDATE product_categories SET name = ?, emoji = ? WHERE id = ?')
    .run(newName, newEmoji, cat.id);

  res.json({ ...cat, name: newName, emoji: newEmoji });
});

// ── PATCH /reorder — réordonner (auth) ────────────────────────────────────
router.patch('/reorder', requireAuth, (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: '"order" doit être un tableau d\'IDs' });

  const db     = getDB();
  const update = db.prepare('UPDATE product_categories SET sort_order = ? WHERE id = ?');
  const tx     = db.transaction(() => { order.forEach((id, i) => update.run(i, id)); });
  tx();
  res.json({ ok: true });
});

// ── DELETE /:id — supprimer (auth, vérifie qu'elle n'est pas utilisée) ────
router.delete('/:id', requireAuth, (req, res) => {
  const db  = getDB();
  const cat = db.prepare('SELECT * FROM product_categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Catégorie introuvable' });

  // Vérifier si des mockups utilisent encore cette catégorie
  const { n } = db.prepare('SELECT COUNT(*) as n FROM mockups WHERE product = ?').get(cat.key);
  if (n > 0) {
    return res.status(409).json({
      error: `Impossible de supprimer : ${n} mockup(s) utilisent encore cette catégorie. Réassignez-les d'abord.`
    });
  }

  db.prepare('DELETE FROM product_categories WHERE id = ?').run(cat.id);
  res.json({ ok: true });
});

module.exports = router;
