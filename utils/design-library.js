'use strict';
/**
 * utils/design-library.js — Métadonnées vitrine de la bibliothèque de visuels.
 * ──────────────────────────────────────────────────────────────────────────
 * La table `library` était jusqu'ici un simple dépôt de fichiers : un nom de
 * fichier et une catégorie. Pour que le client final puisse PARCOURIR ces
 * visuels depuis une fiche produit (« Choisissez un design »), il faut en plus
 * de quoi les présenter : un nom commercial, un ordre d'affichage, un
 * interrupteur de mise en avant, et une adresse publique stable.
 *
 * Choix de conception (arbitrés avec Alan, octobre 2026) :
 *
 *  • `slug` est FIGÉ à la création et indépendant du nom affiché. Il part dans
 *    l'URL de la boutique (?design=money-control) : si on le régénérait à
 *    chaque renommage, tous les liens partagés casseraient.
 *
 *  • Les incompatibilités support se notent en EXCLUSIONS, jamais en
 *    autorisations. Avec une liste d'autorisations, ajouter une 51e référence
 *    Toptex obligerait à repasser sur les 200 visuels un par un — soit le
 *    problème combinatoire qu'on cherche précisément à éviter. Par défaut un
 *    visuel est donc disponible partout ; on ne saisit que ce qui ne va pas.
 *    (La règle automatique sur la taille de zone, elle, vient en amont — voir
 *    le lot B.)
 *
 * Module PUR : aucun accès DB, réseau ou DOM. Testable tel quel.
 */

const SLUG_MAX = 60;

/**
 * Texte → slug d'URL : minuscules, sans accent, tirets.
 * "Octobre Rose 01" → "octobre-rose-01"
 * @returns {string} '' si rien d'exploitable n'en sort
 */
function slugify(input) {
  return String(input == null ? '' : input)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, ''); // le slice a pu couper au milieu d'un séparateur
}

/**
 * Slug unique dans une boutique. En cas de collision on suffixe -2, -3, …
 * @param {string} base      slug souhaité (déjà passé par slugify, ou non)
 * @param {Iterable<string>} taken  slugs déjà pris
 * @param {string} [fallback]  utilisé si `base` ne donne rien (ex. nom en
 *                             cyrillique, emoji seul) — typiquement "visuel"
 */
function uniqueSlug(base, taken, fallback = 'visuel') {
  const pris = taken instanceof Set ? taken : new Set(taken || []);
  let racine = slugify(base) || slugify(fallback) || 'visuel';
  if (!pris.has(racine)) return racine;
  // La racine doit laisser la place au suffixe sans dépasser SLUG_MAX.
  for (let n = 2; n < 10000; n++) {
    const suffixe = `-${n}`;
    const coupe = racine.slice(0, SLUG_MAX - suffixe.length).replace(/-+$/, '');
    const essai = `${coupe}${suffixe}`;
    if (!pris.has(essai)) return essai;
  }
  return `${racine.slice(0, SLUG_MAX - 14)}-${Date.now().toString(36)}`;
}

/**
 * Nom de fichier → nom affichable, à défaut d'un nom saisi par l'admin.
 *
 * Deux formes de noms coexistent dans la table :
 *   • uploads locaux  : "1759400000000_k3f9a2.png"  (multer, cf. routes/library.js)
 *     → aucune information : on ne peut rien en tirer, on rend ''.
 *   • Shopify Files   : "octobre-rose-01.png"
 *     → "Octobre Rose 01"
 *
 * @returns {string} '' quand le nom de fichier ne porte aucun sens
 */
function displayNameFromFilename(filename) {
  const brut = String(filename == null ? '' : filename).trim();
  if (!brut) return '';
  const stem = brut.replace(/\.[a-z0-9]{1,5}$/i, '');
  // Nom généré par multer : horodatage_aléatoire → rien à en tirer.
  if (/^\d{10,}_[a-z0-9]+$/i.test(stem)) return '';
  const mots = stem
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!mots) return '';
  return mots.charAt(0).toUpperCase() + mots.slice(1);
}

/**
 * Normalise des étiquettes : tableau ou chaîne séparée par des virgules.
 * Dédoublonne, retire le vide, limite à 20 entrées de 40 caractères.
 * @returns {string[]}
 */
function normalizeTags(raw) {
  let liste = [];
  if (Array.isArray(raw)) liste = raw;
  else if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.startsWith('[')) { try { liste = JSON.parse(s); } catch { liste = s.split(','); } }
    else liste = s.split(',');
  }
  if (!Array.isArray(liste)) return [];
  const vus = new Set();
  const out = [];
  for (const t of liste) {
    const v = String(t == null ? '' : t).trim().slice(0, 40);
    if (!v) continue;
    const cle = v.toLowerCase();
    if (vus.has(cle)) continue;
    vus.add(cle);
    out.push(v);
    if (out.length >= 20) break;
  }
  return out;
}

/**
 * Normalise une liste d'exclusions en identifiants de mockup entiers.
 *
 * L'exclusion porte sur le MOCKUP et non sur le produit Shopify : c'est le
 * mockup qui porte la zone d'impression, et tous les produits liés au même
 * mockup (toutes les casquettes, par exemple) partagent la même contrainte.
 * Lier un nouveau produit à un mockup existant hérite donc automatiquement de
 * ses exclusions, sans ressaisie.
 *
 * @returns {number[]} entiers positifs, dédoublonnés, triés
 */
function normalizeExclusions(raw) {
  let liste = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try { liste = JSON.parse(s); } catch { liste = s.split(','); }
  }
  if (!Array.isArray(liste)) return [];
  const ids = new Set();
  for (const v of liste) {
    const n = Number.parseInt(String(v == null ? '' : v).trim(), 10);
    if (Number.isInteger(n) && n > 0) ids.add(n);
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * Le slug est-il encore un slug « par défaut », jamais choisi par l'admin ?
 *
 * À la création on n'a parfois aucun nom exploitable (upload local, dont le
 * fichier s'appelle "1759400000000_k3f9a2.png") : on pose alors un slug
 * provisoire. Tant qu'il est resté provisoire, personne n'a pu le partager —
 * on peut donc le régénérer au premier vrai renommage. Dès qu'il porte un sens,
 * il est figé définitivement : c'est une adresse publique.
 */
function isPlaceholderSlug(slug) {
  return /^(nouveau-visuel|visuel)(-\d+)*$/.test(String(slug == null ? '' : slug).trim());
}

/** Lecture tolérante d'une colonne JSON : rend toujours un tableau. */
function parseJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

module.exports = {
  SLUG_MAX,
  slugify,
  uniqueSlug,
  displayNameFromFilename,
  isPlaceholderSlug,
  normalizeTags,
  normalizeExclusions,
  parseJsonArray,
};
