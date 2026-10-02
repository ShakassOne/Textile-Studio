'use strict';
/**
 * utils/perspective.js — Projection d'une image dans un quadrilatère.
 * ──────────────────────────────────────────────────────────────────────────
 * Sur la photo d'un produit, la zone imprimable n'est jamais un rectangle :
 * le t-shirt est porté de trois quarts, le sac est pris légèrement en
 * contre-plongée. Y coller un design sans le déformer donne un autocollant.
 *
 * On décrit donc la zone par ses QUATRE coins, et on y projette le design par
 * une homographie — la transformation qui envoie un carré sur un quadrilatère
 * quelconque en conservant l'alignement des droites. C'est exactement ce que
 * fait l'outil « déformation » de Photoshop.
 *
 * Le rendu se fait en projection INVERSE : pour chaque pixel de la photo, on
 * calcule d'où il vient dans le design. C'est le seul sens qui ne laisse pas
 * de trous — la projection directe laisserait des pixels non peints dès que
 * la zone est plus grande que le design.
 *
 * Module PUR : aucun accès DB, réseau, DOM ni image. Testable tel quel.
 */

/**
 * Homographie envoyant le carré unité sur un quadrilatère.
 *
 * Les coins sont donnés dans l'ordre horaire depuis le haut-gauche :
 *   p0 = (0,0)   haut-gauche
 *   p1 = (1,0)   haut-droit
 *   p2 = (1,1)   bas-droit
 *   p3 = (0,1)   bas-gauche
 *
 * @param {{x:number,y:number}[]} coins  exactement 4 points
 * @returns {number[]|null} matrice 3×3 à plat [a,b,c, d,e,f, g,h,1], ou null
 *                          si le quadrilatère est dégénéré
 */
function homographieDepuisCarre(coins) {
  if (!Array.isArray(coins) || coins.length !== 4) return null;
  const p = coins.map(c => ({ x: Number(c && c.x), y: Number(c && c.y) }));
  if (p.some(c => !Number.isFinite(c.x) || !Number.isFinite(c.y))) return null;

  // Une zone d'aire nulle (coins confondus, ou alignés) passerait sans bruit
  // par la branche affine et rendrait une matrice dégénérée : le rendu
  // n'afficherait rien, sans la moindre erreur pour l'expliquer.
  if (aire(p) < 1e-9) return null;

  const [p0, p1, p2, p3] = p;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, sx = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, sy = p0.y - p1.y + p2.y - p3.y;

  let a, b, c, d, e, f, g, h;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    // Parallélogramme : la transformation est affine, pas de fuite.
    g = 0; h = 0;
    a = p1.x - p0.x; b = p2.x - p1.x; c = p0.x;
    d = p1.y - p0.y; e = p2.y - p1.y; f = p0.y;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null; // coins alignés
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
    a = p1.x - p0.x + g * p1.x;
    b = p3.x - p0.x + h * p3.x;
    c = p0.x;
    d = p1.y - p0.y + g * p1.y;
    e = p3.y - p0.y + h * p3.y;
    f = p0.y;
  }
  return [a, b, c, d, e, f, g, h, 1];
}

/** Inverse d'une matrice 3×3 à plat, ou null si elle n'est pas inversible. */
function inverse3x3(m) {
  if (!Array.isArray(m) || m.length !== 9) return null;
  const [a, b, c, d, e, f, g, h, i] = m;
  const A =  (e * i - f * h);
  const B = -(d * i - f * g);
  const C =  (d * h - e * g);
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    A * inv,                 (c * h - b * i) * inv, (b * f - c * e) * inv,
    B * inv,                 (a * i - c * g) * inv, (c * d - a * f) * inv,
    C * inv,                 (b * g - a * h) * inv, (a * e - b * d) * inv,
  ];
}

/**
 * Applique une homographie à un point.
 * @returns {{x:number,y:number}|null} null si le point part à l'infini
 */
function projeter(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return null;
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

/** Rectangle englobant d'un quadrilatère, borné à la taille de l'image. */
function cadreEnglobant(coins, largeurMax, hauteurMax) {
  const xs = coins.map(c => c.x), ys = coins.map(c => c.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(largeurMax, Math.ceil(Math.max(...xs)));
  const y1 = Math.min(hauteurMax, Math.ceil(Math.max(...ys)));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/**
 * Coins exprimés en pourcentage de l'image → pixels.
 * On stocke en pourcentage pour qu'une zone reste valable quelle que soit la
 * définition servie par le CDN Shopify (vignette, 1024, 2048…).
 */
function coinsEnPixels(coinsPct, largeur, hauteur) {
  if (!Array.isArray(coinsPct) || coinsPct.length !== 4) return null;
  const out = coinsPct.map(c => ({
    x: Number(c && c.x) / 100 * largeur,
    y: Number(c && c.y) / 100 * hauteur,
  }));
  return out.some(c => !Number.isFinite(c.x) || !Number.isFinite(c.y)) ? null : out;
}

/**
 * Aire d'un quadrilatère (formule du lacet). Sert à refuser une zone
 * dégénérée — quatre coins confondus donneraient une division par zéro
 * plus loin, ou un rendu invisible.
 */
function aire(coins) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = coins[i], b = coins[(i + 1) % 4];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

module.exports = {
  homographieDepuisCarre,
  inverse3x3,
  projeter,
  cadreEnglobant,
  coinsEnPixels,
  aire,
};
