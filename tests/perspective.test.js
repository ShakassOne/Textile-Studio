'use strict';

/**
 * Projection d'un design dans un quadrilatère (utils/perspective.js).
 * ──────────────────────────────────────────────────────────────────────────
 * C'est le cœur du rendu d'un design sur la photo réelle d'un produit : le
 * vêtement est porté de biais, sa zone imprimable n'est pas un rectangle.
 *
 * Trois propriétés comptent et sont vérifiées ici :
 *   • les quatre coins du carré unité atterrissent EXACTEMENT sur les quatre
 *     coins saisis par l'admin — sinon le design déborde du vêtement ;
 *   • la projection inverse ramène au point de départ, puisque c'est elle qui
 *     sert au rendu pixel par pixel ;
 *   • une zone dégénérée (coins alignés ou confondus) est refusée plutôt que
 *     de produire une division par zéro au milieu d'un rendu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../utils/perspective');

/** Quadrilatère quelconque, non parallélogramme : le cas réel. */
const QUAD = [{ x: 10, y: 20 }, { x: 110, y: 30 }, { x: 120, y: 140 }, { x: 5, y: 130 }];
const COINS_UNITE = [[0, 0], [1, 0], [1, 1], [0, 1]];

test('les quatre coins du design tombent sur les quatre coins de la zone', () => {
  const m = P.homographieDepuisCarre(QUAD);
  assert.ok(m, 'homographie calculable');
  COINS_UNITE.forEach(([u, v], i) => {
    const p = P.projeter(m, u, v);
    assert.ok(Math.abs(p.x - QUAD[i].x) < 1e-6, `coin ${i} en x`);
    assert.ok(Math.abs(p.y - QUAD[i].y) < 1e-6, `coin ${i} en y`);
  });
});

test('un parallélogramme passe par le cas affine, sans fuite', () => {
  const para = [{ x: 0, y: 0 }, { x: 100, y: 10 }, { x: 110, y: 60 }, { x: 10, y: 50 }];
  const m = P.homographieDepuisCarre(para);
  assert.equal(m[6], 0, 'pas de composante de fuite en x');
  assert.equal(m[7], 0, 'pas de composante de fuite en y');
  COINS_UNITE.forEach(([u, v], i) => {
    const p = P.projeter(m, u, v);
    assert.ok(Math.abs(p.x - para[i].x) < 1e-9 && Math.abs(p.y - para[i].y) < 1e-9, `coin ${i}`);
  });
});

test('la projection inverse ramène au point de départ', () => {
  // C'est le sens réellement utilisé au rendu : pour chaque pixel de la photo,
  // on cherche d'où il vient dans le design.
  const m = P.homographieDepuisCarre(QUAD);
  const inv = P.inverse3x3(m);
  assert.ok(inv);
  for (const [u, v] of [[0.5, 0.5], [0.1, 0.9], [0.25, 0.75], [0, 0], [1, 1]]) {
    const sur = P.projeter(m, u, v);
    const retour = P.projeter(inv, sur.x, sur.y);
    assert.ok(Math.abs(retour.x - u) < 1e-6 && Math.abs(retour.y - v) < 1e-6, `(${u},${v})`);
  }
});

test('une zone dégénérée est refusée, pas tolérée', () => {
  assert.equal(P.homographieDepuisCarre([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]), null,
    'coins alignés');
  assert.equal(P.homographieDepuisCarre([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }]), null,
    'coins confondus');
  assert.equal(P.homographieDepuisCarre([{ x: 0, y: 0 }, { x: 1, y: 0 }]), null, 'trois coins manquants');
  assert.equal(P.homographieDepuisCarre(null), null);
  assert.equal(P.homographieDepuisCarre([{ x: 'a', y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]), null,
    'coordonnée non numérique');
});

test('une matrice non inversible ne fait pas planter le rendu', () => {
  assert.equal(P.inverse3x3([0, 0, 0, 0, 0, 0, 0, 0, 0]), null);
  assert.equal(P.inverse3x3([1, 2, 3]), null);
  assert.equal(P.inverse3x3(null), null);
});

test('le cadre englobant reste dans les limites de la photo', () => {
  // Une zone qui dépasse l'image ne doit pas faire lire des pixels hors tampon.
  const debordant = [{ x: -50, y: -50 }, { x: 900, y: 10 }, { x: 900, y: 900 }, { x: -20, y: 880 }];
  const c = P.cadreEnglobant(debordant, 800, 600);
  assert.deepEqual(c, { x: 0, y: 0, w: 800, h: 600 });

  const dedans = P.cadreEnglobant(QUAD, 800, 600);
  assert.deepEqual(dedans, { x: 5, y: 20, w: 115, h: 120 });
});

test('les coins sont stockés en pourcentage pour survivre au redimensionnement', () => {
  // Le CDN Shopify sert la même photo en plusieurs définitions : une zone en
  // pixels ne vaudrait que pour l'une d'elles.
  const pct = [{ x: 25, y: 10 }, { x: 75, y: 10 }, { x: 75, y: 60 }, { x: 25, y: 60 }];
  assert.deepEqual(P.coinsEnPixels(pct, 1000, 1000),
    [{ x: 250, y: 100 }, { x: 750, y: 100 }, { x: 750, y: 600 }, { x: 250, y: 600 }]);
  assert.deepEqual(P.coinsEnPixels(pct, 500, 500),
    [{ x: 125, y: 50 }, { x: 375, y: 50 }, { x: 375, y: 300 }, { x: 125, y: 300 }]);
  assert.equal(P.coinsEnPixels([{ x: 1, y: 2 }], 100, 100), null);
  assert.equal(P.coinsEnPixels(null, 100, 100), null);
});

test('l\'aire permet de rejeter une zone invisible', () => {
  assert.equal(P.aire([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), 100);
  assert.equal(P.aire([{ x: 3, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 3 }]), 0);
});

// ── Projection pixel par pixel ─────────────────────────────────────────────

/** Design 2×2 opaque : rouge, vert / bleu, blanc. */
function design2x2() {
  return new Uint8Array([
    255, 0, 0, 255,   0, 255, 0, 255,
    0, 0, 255, 255,   255, 255, 255, 255,
  ]);
}
const px = (buf, largeur, x, y) => {
  const o = (y * largeur + x) * 4;
  return [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]];
};

test('chaque coin du design arrive au bon coin de la zone', () => {
  const out = P.projeterDansQuadrilatere(design2x2(), 2, 2,
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    { x: 0, y: 0, w: 10, h: 10 });
  assert.ok(out);
  // Chaque coin doit être dominé par sa couleur d'origine. L'interpolation
  // bilinéaire mélange légèrement avec les voisins, d'où le seuil.
  const dominante = (p) => p.indexOf(Math.max(p[0], p[1], p[2]));
  assert.equal(dominante(px(out, 10, 0, 0)), 0, 'haut-gauche rouge');
  assert.equal(dominante(px(out, 10, 9, 0)), 1, 'haut-droit vert');
  assert.equal(dominante(px(out, 10, 0, 9)), 2, 'bas-gauche bleu');
  const bd = px(out, 10, 9, 9);
  assert.ok(bd[0] > 200 && bd[1] > 200 && bd[2] > 200, 'bas-droit blanc');
});

test('hors du quadrilatère, rien n\'est peint', () => {
  // Sans ça, le design déborderait du vêtement sur le fond de la photo.
  const out = P.projeterDansQuadrilatere(design2x2(), 2, 2,
    [{ x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 }],
    { x: 0, y: 0, w: 10, h: 10 });
  assert.equal(px(out, 10, 0, 0)[3], 0, 'coin de la sortie transparent');
  assert.equal(px(out, 10, 9, 9)[3], 0, 'autre coin transparent');
  assert.equal(px(out, 10, 5, 5)[3], 255, 'centre peint');
});

test('la transparence du design est conservée', () => {
  // Un design PNG détouré ne doit pas se retrouver sur fond opaque : les
  // pixels transparents laissent voir le tissu.
  //
  // On ne teste PAS un alpha nul au sommet : avec une source de deux pixels
  // de haut, le premier pixel de sortie est déjà à 6 % de la seconde ligne et
  // l'interpolation bilinéaire l'y mélange — c'est précisément son rôle, et
  // sur un design réel de plusieurs centaines de pixels ce mélange est
  // inférieur au pixel. Ce qui compte, c'est que le dégradé aille bien du
  // transparent vers l'opaque.
  const d = new Uint8Array([
    255, 0, 0, 0,     255, 0, 0, 0,
    255, 0, 0, 255,   255, 0, 0, 255,
  ]);
  const out = P.projeterDansQuadrilatere(d, 2, 2,
    [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }],
    { x: 0, y: 0, w: 8, h: 8 });
  const haut = px(out, 8, 4, 0)[3], milieu = px(out, 8, 4, 4)[3], bas = px(out, 8, 4, 7)[3];
  assert.ok(haut < 30, `sommet quasi transparent (${haut})`);
  assert.ok(bas > 230, `base opaque (${bas})`);
  assert.ok(haut < milieu && milieu < bas, 'dégradé monotone');
});

test('la projection suit la perspective, elle ne se contente pas d\'un cadre', () => {
  // Quadrilatère en trapèze : le haut est deux fois plus étroit que le bas.
  // `etirer` isole la géométrie — sans lui, la conservation des proportions
  // réduirait le design et brouillerait ce qu'on cherche à vérifier ici.
  const out = P.projeterDansQuadrilatere(design2x2(), 2, 2,
    [{ x: 20, y: 0 }, { x: 40, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }],
    { x: 0, y: 0, w: 60, h: 40 }, { etirer: true });
  assert.ok(out);
  // En haut, la zone va de x=20 à x=40 : à x=10 il n'y a rien.
  assert.equal(px(out, 60, 10, 1)[3], 0, 'hors zone en haut');
  // En bas, elle va de 0 à 60 : à x=10 il y a de la matière.
  assert.equal(px(out, 60, 10, 38)[3], 255, 'dans la zone en bas');
});

test('une zone inexploitable rend null plutôt que des pixels faux', () => {
  const d = design2x2();
  const carre = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }];
  assert.equal(P.projeterDansQuadrilatere(d, 2, 2, [{ x: 0, y: 0 }], { x: 0, y: 0, w: 5, h: 5 }), null);
  assert.equal(P.projeterDansQuadrilatere(d, 2, 2, carre, { x: 0, y: 0, w: 0, h: 5 }), null);
  assert.equal(P.projeterDansQuadrilatere(d, 0, 0, carre, { x: 0, y: 0, w: 5, h: 5 }), null);
});

// ── Conservation des proportions ──────────────────────────────────────────

test('le design n\'est plus étiré aux dimensions de la zone', () => {
  // La zone décrit la surface imprimable disponible, pas la forme du design.
  // L'y étirer transforme un logo rond en ovale.
  const zoneHaute = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 300 }, { x: 0, y: 300 }];
  const carre = P.proportionsDansQuadrilatere(500, 500, zoneHaute);
  assert.equal(carre.ex, 1, 'un design carré occupe toute la largeur disponible');
  assert.ok(Math.abs(carre.ey - 1 / 3) < 1e-9, 'et le tiers de la hauteur');
  assert.ok(Math.abs(carre.y0 - 1 / 3) < 1e-9, 'centré verticalement');

  // Sur une zone large — le cas du sac — c'est la hauteur qui commande.
  const zoneLarge = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 }, { x: 0, y: 100 }];
  const surSac = P.proportionsDansQuadrilatere(500, 500, zoneLarge);
  assert.equal(surSac.ey, 1);
  assert.ok(Math.abs(surSac.ex - 1 / 3) < 1e-9);
  assert.ok(Math.abs(surSac.x0 - 1 / 3) < 1e-9, 'centré horizontalement');
});

test('un design au rapport de la zone la remplit entièrement', () => {
  const zone = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 300 }, { x: 0, y: 300 }];
  const r = P.proportionsDansQuadrilatere(100, 300, zone);
  assert.deepEqual(r, { x0: 0, y0: 0, ex: 1, ey: 1 });
});

test('les proportions d\'un quadrilatère en perspective sont moyennées', () => {
  // Haut à 20, bas à 60 : la largeur perçue est la moyenne, 40.
  const trapeze = [{ x: 20, y: 0 }, { x: 40, y: 0 }, { x: 60, y: 100 }, { x: 0, y: 100 }];
  const { largeur, hauteur } = P.proportionsQuadrilatere(trapeze);
  assert.equal(largeur, 40);
  assert.ok(hauteur > 100 && hauteur < 105, 'les côtés obliques sont plus longs que la verticale');
});

test('la projection respecte les proportions, et peut encore étirer sur demande', () => {
  const d = design2x2();
  // Zone trois fois plus haute que large, design carré : deux tiers de la
  // hauteur doivent rester nus.
  const zone = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 90 }, { x: 0, y: 90 }];
  const cadre = { x: 0, y: 0, w: 30, h: 90 };

  const garde = P.projeterDansQuadrilatere(d, 2, 2, zone, cadre);
  assert.equal(px(garde, 30, 15, 5)[3], 0, 'haut de la zone laissé nu');
  assert.equal(px(garde, 30, 15, 45)[3], 255, 'centre peint');
  assert.equal(px(garde, 30, 15, 85)[3], 0, 'bas de la zone laissé nu');

  const etire = P.projeterDansQuadrilatere(d, 2, 2, zone, cadre, { etirer: true });
  assert.equal(px(etire, 30, 15, 5)[3], 255, 'étiré : toute la zone est peinte');
  assert.equal(px(etire, 30, 15, 85)[3], 255);
});

test('un quadrilatère dégénéré ne fait pas dérailler le calcul de proportions', () => {
  const plat = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  assert.deepEqual(P.proportionsDansQuadrilatere(100, 100, plat), { x0: 0, y0: 0, ex: 1, ey: 1 });
  assert.deepEqual(P.proportionsDansQuadrilatere(0, 0,
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]),
    { x0: 0, y0: 0, ex: 1, ey: 1 });
});
