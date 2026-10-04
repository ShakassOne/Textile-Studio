'use strict';

/**
 * Format de composition (utils/composition.js).
 * ──────────────────────────────────────────────────────────────────────────
 * C'est le contrat entre le bloc de la fiche produit, le configurateur, le
 * panier et le fichier d'impression. Trois propriétés doivent tenir, et ce
 * fichier ne teste que celles-là :
 *
 *   • une composition rend IDENTIQUEMENT quelle que soit la taille du
 *     canevas — c'est tout l'intérêt du placement relatif, et c'est ce qui
 *     faisait défaut au format des templates ;
 *   • l'aller-retour relatif ↔ pixels est exact, sinon un design dérive un
 *     peu plus à chaque enregistrement ;
 *   • les templates déjà en production restent lisibles.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../utils/composition');

const ZONE = { x: 100, y: 50, w: 300, h: 400 };

test('une composition vide est exploitable telle quelle', () => {
  const c = C.creer();
  assert.equal(c.v, C.VERSION);
  assert.deepEqual(c.faces, {});
  assert.equal(C.estVide(c), true);
  assert.deepEqual(C.facesUtilisees(c), []);
});

test('le même design rend identiquement sur mobile et sur desktop', () => {
  // La raison d'être du placement relatif : le format précédent stockait des
  // pixels de canevas absolus, et un design composé sur desktop arrivait
  // décalé et surdimensionné sur mobile.
  const calque = C.normaliserCalque({ type: 'image', x: 0.5, y: 0.4, w: 0.8, ratio: 1.5 });
  const mobile  = { x: 20,  y: 10,  w: 150, h: 200 };
  const desktop = { x: 200, y: 100, w: 600, h: 800 };

  const a = C.versPixels(calque, mobile);
  const b = C.versPixels(calque, desktop);

  // Mêmes proportions, et même position relative dans la zone.
  assert.equal(a.width / mobile.w, b.width / desktop.w);
  assert.equal((a.left - mobile.x) / mobile.w, (b.left - desktop.x) / desktop.w);
  assert.equal((a.top - mobile.y) / mobile.h, (b.top - desktop.y) / desktop.h);
});

test('l\'aller-retour relatif ↔ pixels ne dérive pas', () => {
  // Un écart ici se cumulerait à chaque enregistrement.
  for (const src of [
    { x: 0.5, y: 0.5, w: 0.8, ratio: 1.5, angle: 0 },
    { x: 0.2, y: 0.9, w: 0.15, ratio: 0.5, angle: 30 },
    { x: 1.1, y: -0.2, w: 1.4, ratio: 3, angle: -45 },
  ]) {
    const calque = C.normaliserCalque(Object.assign({ type: 'text' }, src));
    const r = C.depuisPixels(C.versPixels(calque, ZONE), ZONE);
    assert.ok(Math.abs(r.x - src.x) < 1e-9, 'x');
    assert.ok(Math.abs(r.y - src.y) < 1e-9, 'y');
    assert.ok(Math.abs(r.w - src.w) < 1e-9, 'w');
    assert.ok(Math.abs(r.ratio - src.ratio) < 1e-9, 'ratio');
  }
});

test('une donnée aberrante est ramenée à une valeur sûre, pas rejetée', () => {
  // Une composition à moitié lisible vaut mieux qu'un panier vide.
  const c = C.normaliserCalque({ type: 'image', x: 'nimportequoi', y: null, w: -5, ratio: 0, angle: 9999 });
  assert.equal(c.x, 0.5);
  assert.equal(c.y, 0.5);
  assert.ok(c.w > 0);
  assert.ok(c.ratio > 0);
  assert.ok(Math.abs(c.angle) <= 360);
  assert.equal(c.visible, true);
});

test('un calque sans type exploitable est écarté', () => {
  assert.equal(C.normaliserCalque({ type: 'video' }), null);
  assert.equal(C.normaliserCalque({}), null);
  assert.equal(C.normaliserCalque(null), null);
});

test('les faces sont nommées, et seules celles qui portent du contenu comptent', () => {
  const c = C.normaliser({
    faces: {
      front:  { layers: [{ type: 'text', x: .5, y: .5, w: .5 }] },
      back:   { layers: [{ type: 'image', x: .5, y: .5, w: .5, visible: false }] },
      sleeve: { layers: [{ type: 'text' }] }, // face inconnue : ignorée
    },
  });
  assert.deepEqual(Object.keys(c.faces).sort(), ['back', 'front']);
  assert.deepEqual(C.facesUtilisees(c), ['front'], 'un calque masqué ne rend pas la face utilisée');
  assert.equal(C.estVide(c), false);
});

test('une entrée illisible donne une composition vide, jamais une exception', () => {
  for (const mauvais of [null, undefined, 'texte', 42, [], { faces: 'non' }]) {
    const c = C.normaliser(mauvais);
    assert.equal(c.v, C.VERSION);
    assert.equal(C.estVide(c), true);
  }
});

// ── Reprise des templates en production ───────────────────────────────────

/** Template v3 tel qu'enregistré aujourd'hui dans custom.tsl_template. */
function templateV3() {
  return {
    v: 3,
    product: 'tshirt',
    color: '#FFFFFF',
    format: 'A4',
    mockupId: 3,
    frame: { x: 100, y: 50, w: 300, h: 400 },
    viewFormats: { '3_0': 'A4', '3_1': 'A5' },
    viewLayers: {
      '3_0': [{ type: 'image', left: 190, top: 150, width: 240, height: 180,
                scaleX: 0.5, scaleY: 0.5, angle: 0, src: 'https://cdn/x.png' }],
      '3_1': [{ type: 'i-text', left: 175, top: 250, width: 200, height: 40,
                scaleX: 1, scaleY: 1, text: 'Winshirt' }],
    },
  };
}

test('un template v3 devient une composition recto/verso exploitable', () => {
  const c = C.depuisTemplate(templateV3());
  assert.deepEqual(Object.keys(c.faces).sort(), ['back', 'front']);
  assert.equal(c.faces.front.format, 'A4');
  assert.equal(c.faces.back.format, 'A5');
  assert.equal(c.faces.front.layers[0].type, 'image');
  assert.equal(c.faces.back.layers[0].type, 'text');
  assert.equal(c.meta.origine, 'template');
  assert.equal(c.meta.mockupId, 3);
});

test('les positions d\'un template sont converties, pas recopiées', () => {
  const c = C.depuisTemplate(templateV3());
  const l = c.faces.front.layers[0];
  // Objet de 240×180 à l'échelle 0.5 → 120×90 px, posé en (190,150)
  // dans une zone (100,50,300,400). Centre : (250,195).
  assert.ok(Math.abs(l.w - 120 / 300) < 1e-9, 'largeur relative');
  assert.ok(Math.abs(l.x - (250 - 100) / 300) < 1e-9, 'centre x relatif');
  assert.ok(Math.abs(l.y - (195 - 50) / 400) < 1e-9, 'centre y relatif');
  assert.ok(Math.abs(l.ratio - 90 / 120) < 1e-9, 'rapport hauteur/largeur');
  // Les propriétés Fabric d'origine sont conservées intactes.
  assert.equal(l.fabric.src, 'https://cdn/x.png');
});

test('un template sans repère de zone ne produit pas un design décalé', () => {
  // Sans `frame`, rien ne permet de repasser en relatif. Mieux vaut des
  // valeurs par défaut au centre qu'un design posé au hasard.
  const sansFrame = templateV3();
  delete sansFrame.frame;
  const c = C.depuisTemplate(sansFrame);
  const l = c.faces.front.layers[0];
  assert.equal(l.x, 0.5);
  assert.equal(l.y, 0.5);
  assert.equal(l.fabric.src, 'https://cdn/x.png', 'le contenu reste là');
});

test('un template au-delà de deux faces ne fait pas perdre les deux premières', () => {
  const t = templateV3();
  t.viewLayers['3_2'] = [{ type: 'image', left: 0, top: 0, width: 10, height: 10 }];
  const c = C.depuisTemplate(t);
  assert.deepEqual(Object.keys(c.faces).sort(), ['back', 'front']);
});
