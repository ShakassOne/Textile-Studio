'use strict';

/**
 * Fichier d'impression généré sans studio (utils/print-file.js, lot E).
 * ──────────────────────────────────────────────────────────────────────────
 * Ce que ce fichier vérifie : le canevas a la bonne taille physique réelle
 * (300 DPI, mêmes pixels que les libellés dpi300 de routes/pricing.js), le
 * visuel y est contenu sans jamais être étiré, et le résultat garde sa
 * transparence — un futur fichier de production doit arriver sans fond
 * blanc parasite.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const PF = require('../utils/print-file');

test('le canevas A4 fait 2480×3508 px à 300 DPI — mêmes pixels que la grille tarifaire', () => {
  assert.deepEqual(PF.canvasImpressionPx('A4', false), { w: 2480, h: 3508 });
  assert.deepEqual(PF.canvasImpressionPx('A3', false), { w: 3508, h: 4961 });
  assert.deepEqual(PF.canvasImpressionPx('A5', false), { w: 1748, h: 2480 });
  assert.deepEqual(PF.canvasImpressionPx('A6', false), { w: 1240, h: 1748 });
});

test('un visuel paysage retourne le format — mêmes pixels, largeur et hauteur inversées', () => {
  const portrait = PF.canvasImpressionPx('A4', false);
  const paysage  = PF.canvasImpressionPx('A4', true);
  assert.equal(paysage.w, portrait.h);
  assert.equal(paysage.h, portrait.w);
});

test('un format inconnu retombe sur le format par défaut, jamais une erreur', () => {
  assert.deepEqual(PF.canvasImpressionPx('XXL', false), PF.canvasImpressionPx('A4', false));
  assert.deepEqual(PF.canvasImpressionPx(undefined, false), PF.canvasImpressionPx('A4', false));
});

test('un visuel du même rapport que le cadre le remplit entièrement, sans marge', () => {
  const r = PF.placerContenu({ width: 2480, height: 3508 }, { w: 2480, h: 3508 });
  assert.deepEqual(r, { x: 0, y: 0, w: 2480, h: 3508 });
});

test('un visuel plus étroit que le cadre est centré horizontalement, jamais étiré', () => {
  // Carré dans un cadre deux fois plus haut que large → pleine largeur, centré en hauteur.
  const r = PF.placerContenu({ width: 1000, height: 1000 }, { w: 1000, h: 2000 });
  assert.equal(r.w, 1000);
  assert.equal(r.h, 1000);
  assert.equal(r.x, 0);
  assert.equal(r.y, 500);
});

test('un visuel plus large que le cadre est centré verticalement', () => {
  const r = PF.placerContenu({ width: 2000, height: 1000 }, { w: 1000, h: 1000 });
  assert.equal(r.w, 1000);
  assert.equal(r.h, 500);
  assert.equal(r.x, 0);
  assert.equal(r.y, 250);
});

// ── genererFichierImpression (sharp réel) ─────────────────────────────────

async function pngUni(w, h, rgba) {
  return sharp({ create: { width: w, height: h, channels: 4, background: rgba } }).png().toBuffer();
}

test('le fichier généré a la taille physique du format, visuel centré et transparence conservée', async () => {
  // Visuel portrait 100×200 (même rapport qu'A4 : 2480/3508 ≈ 100/142, donc pas pile
  // le même ratio — volontaire, pour vérifier le letterboxing).
  const visuel = await pngUni(100, 200, { r: 255, g: 0, b: 0, alpha: 255 });
  const { buffer, width, height, placement } = await PF.genererFichierImpression({ visuelBuffer: visuel, format: 'A4' });

  assert.deepEqual({ w: width, h: height }, PF.canvasImpressionPx('A4', false));

  const meta = await sharp(buffer).metadata();
  assert.equal(meta.width, width);
  assert.equal(meta.height, height);
  assert.equal(meta.channels, 4);

  // Le visuel ne touche pas les bords gauche/droit (letterboxé en largeur) : un
  // pixel du coin est transparent, un pixel au centre du placement est rouge opaque.
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const pixelAt = (x, y) => {
    const i = (y * info.width + x) * info.channels;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  };
  assert.equal(pixelAt(0, 0).a, 0, 'coin hors placement : transparent');
  const centre = pixelAt(
    placement.x + Math.floor(placement.w / 2),
    placement.y + Math.floor(placement.h / 2),
  );
  assert.equal(centre.a, 255);
  assert.equal(centre.r, 255);
  assert.equal(centre.g, 0);
});

test('un visuel paysage produit un canevas paysage', async () => {
  const visuel = await pngUni(400, 100, { r: 0, g: 255, b: 0, alpha: 255 });
  const { width, height } = await PF.genererFichierImpression({ visuelBuffer: visuel, format: 'A4' });
  assert.ok(width > height, `attendu paysage, obtenu ${width}×${height}`);
});

test('sans visuelBuffer, erreur explicite plutôt qu\'un plantage sharp', async () => {
  await assert.rejects(() => PF.genererFichierImpression({}), /visuelBuffer requis/);
});
