'use strict';
/**
 * utils/print-file.js — Fichier d'impression à partir d'un visuel de bibliothèque.
 * ──────────────────────────────────────────────────────────────────────────
 * Lot E (panier sans passer par le studio) : quand le client ajoute un visuel
 * au panier directement depuis la fiche produit, sans ouvrir le studio, il n'y
 * a pas de canvas Fabric côté navigateur pour produire le fichier d'impression.
 * Ce module le fait côté serveur.
 *
 * Ce n'est PAS le moteur de mockup (routes/mockup-gen.js) : celui-ci compose le
 * visuel sur la PHOTO du vêtement (displacement map, plis, multiply) pour
 * montrer un aperçu — le fichier ici est le FICHIER D'IMPRESSION lui-même, nu,
 * sans mise en scène, à la taille physique réelle du format retenu.
 *
 * Taille du canevas = `FORMATS_MM` (utils/design-library.js), la même source
 * que la règle de compatibilité du lot B, orientée comme le visuel — un
 * visuel paysage s'imprime dans un A4 paysage. Placement = le visuel contenu
 * et centré dans ce canevas, proportions conservées (jamais étiré) : c'est la
 * même méthode que `evaluerCompatibilite` pour juger l'occupation, utilisée
 * ici pour RENDRE au lieu de MESURER.
 *
 * Module pur pour la géométrie (`canvasImpressionPx`, `placerContenu`) ; seule
 * `genererFichierImpression` touche au disque/CPU via sharp.
 */

const { FORMATS_MM, FORMAT_PAR_DEFAUT } = require('./design-library');

// 300 DPI — même valeur que les libellés dpi300 de routes/pricing.js
// (ex. A4 → 2480×3508px). Ne pas changer sans mettre à jour ces libellés.
const DPI_IMPRESSION = 300;

/**
 * Dimensions en pixels du canevas d'impression pour un format donné.
 *
 * @param {string} format     clé de FORMATS_MM (A6/A5/A4/A3) ; repli sur
 *                             FORMAT_PAR_DEFAUT si inconnue
 * @param {boolean} paysage   oriente le format comme un visuel plus large que
 *                             haut (même convention que evaluerCompatibilite)
 * @param {number} [dpi]
 * @returns {{w:number, h:number}}
 */
function canvasImpressionPx(format, paysage, dpi = DPI_IMPRESSION) {
  const f = FORMATS_MM[format] ? format : FORMAT_PAR_DEFAUT;
  const { w: mmW, h: mmH } = FORMATS_MM[f];
  const largeurMm  = paysage ? mmH : mmW;
  const hauteurMm  = paysage ? mmW : mmH;
  return {
    w: Math.round((largeurMm / 25.4) * dpi),
    h: Math.round((hauteurMm / 25.4) * dpi),
  };
}

/**
 * Place un visuel contenu et centré dans un cadre, proportions conservées.
 * Même formule que l'échelle de `evaluerCompatibilite` (design-library.js),
 * utilisée ici pour calculer où écrire les pixels plutôt que pour juger la
 * résolution.
 *
 * @param {{width:number, height:number}} visuel  dimensions naturelles
 * @param {{w:number, h:number}} cadre             canevas d'impression
 * @returns {{x:number, y:number, w:number, h:number}}
 */
function placerContenu(visuel, cadre) {
  const vw = Number(visuel && visuel.width);
  const vh = Number(visuel && visuel.height);
  const echelle = Math.min(cadre.w / vw, cadre.h / vh);
  const w = Math.max(1, Math.round(vw * echelle));
  const h = Math.max(1, Math.round(vh * echelle));
  return {
    x: Math.round((cadre.w - w) / 2),
    y: Math.round((cadre.h - h) / 2),
    w, h,
  };
}

/**
 * Compose le fichier d'impression : le visuel, contenu et centré, sur un
 * canevas transparent à la taille physique réelle du format.
 *
 * @param {object} options
 * @param {Buffer} options.visuelBuffer  PNG/JPEG source (tel qu'uploadé dans la bibliothèque)
 * @param {string} [options.format]      clé FORMATS_MM ; défaut FORMAT_PAR_DEFAUT
 * @param {number} [options.dpi]         défaut DPI_IMPRESSION
 * @returns {Promise<{buffer:Buffer, width:number, height:number, placement:object}>}
 */
async function genererFichierImpression({ visuelBuffer, format, dpi = DPI_IMPRESSION } = {}) {
  if (!visuelBuffer) throw new Error('visuelBuffer requis');
  const sharp = require('sharp');

  const meta = await sharp(visuelBuffer).metadata();
  const vw = meta.width, vh = meta.height;
  if (!(vw > 0) || !(vh > 0)) throw new Error('visuel illisible (dimensions introuvables)');

  const paysage = vw > vh;
  const canvas  = canvasImpressionPx(format, paysage, dpi);
  const rect    = placerContenu({ width: vw, height: vh }, canvas);

  const visuelRedimensionne = await sharp(visuelBuffer)
    .resize(rect.w, rect.h, { fit: 'fill' })
    .ensureAlpha()
    .png()
    .toBuffer();

  const buffer = await sharp({
    create: { width: canvas.w, height: canvas.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: visuelRedimensionne, left: rect.x, top: rect.y }])
    .png()
    .toBuffer();

  return { buffer, width: canvas.w, height: canvas.h, placement: rect };
}

module.exports = {
  DPI_IMPRESSION,
  canvasImpressionPx,
  placerContenu,
  genererFichierImpression,
};
