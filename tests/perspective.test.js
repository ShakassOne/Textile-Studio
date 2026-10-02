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
