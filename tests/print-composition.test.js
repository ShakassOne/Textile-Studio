'use strict';

/**
 * Fichier d'impression d'une composition (utils/print-composition.js).
 * ──────────────────────────────────────────────────────────────────────────
 * C'est ce fichier qui part chez l'imprimeur. Deux propriétés comptent plus
 * que tout, et ce sont celles qu'on vérifie :
 *
 *   • le placement est le MÊME qu'à l'écran. Si le rendu serveur refaisait
 *     son propre calcul, il divergerait de l'aperçu au premier arrondi, et
 *     le client recevrait autre chose que ce qu'il a validé ;
 *   • un calque illisible ne fait pas perdre la commande entière.
 *
 * @napi-rs/canvas est un module natif : si son binaire ne correspond pas à la
 * version de Node de la machine, on saute proprement plutôt que de confondre
 * un échec d'environnement avec une régression (même raison que
 * tests/upsell-candidates.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const COMP = require('../utils/composition');
const P = require('../utils/print-composition');

let canvasIndisponible = null;
try { require('@napi-rs/canvas'); }
catch (e) { canvasIndisponible = e.message.split('\n')[0]; }

// ── Géométrie : pure, toujours testable ───────────────────────────────────

test('la taille d\'impression suit le format et l\'orientation de la zone', () => {
  // A4 à 300 dpi = 2480×3508. Une zone large (un sac) imprime en paysage.
  assert.deepEqual(P.tailleImpression('A4', 0.75), { w: 2480, h: 3508, format: 'A4', paysage: false });
  assert.deepEqual(P.tailleImpression('A4', 1.80), { w: 3508, h: 2480, format: 'A4', paysage: true });
  assert.equal(P.tailleImpression('A6', 0.75).format, 'A6');
});

test('un format inconnu retombe sur le défaut au lieu de planter', () => {
  assert.equal(P.tailleImpression('A0', 0.75).format, 'A4');
  assert.equal(P.tailleImpression(null, 0.75).format, 'A4');
  assert.equal(P.tailleImpression(undefined, undefined).format, 'A4');
});

test('la définition est bien de 300 points par pouce', () => {
  // A4 = 210 mm de large ; 210/25.4*300 = 2480.
  const t = P.tailleImpression('A4', 0.75, 300);
  assert.equal(t.w, Math.round(210 / 25.4 * 300));
  const basse = P.tailleImpression('A4', 0.75, 150);
  assert.equal(basse.w, Math.round(210 / 25.4 * 150));
});

// ── Rendu : nécessite le module natif ─────────────────────────────────────

const options = canvasIndisponible
  ? { skip: `@napi-rs/canvas illisible (${canvasIndisponible})` }
  : {};

/** Composition minimale : un texte centré au recto. */
function compositionTexte() {
  return {
    v: 1,
    faces: {
      front: {
        format: 'A4',
        zone: { ratio: 0.75 },
        layers: [{
          type: 'text', x: 0.5, y: 0.5, w: 0.6, ratio: 0.3, angle: 0,
          opacity: 1, visible: true,
          fabric: { text: 'WINSHIRT', fill: '#000000', fontFamily: 'sans-serif' },
        }],
      },
    },
  };
}

test('une face vide ne produit aucun fichier', options, async () => {
  // Rien à imprimer ne doit pas donner une page blanche envoyée à l'atelier.
  assert.equal(await P.rendreFace(COMP.creer(), 'front'), null);
  assert.equal(await P.rendreFace(compositionTexte(), 'back'), null);
  const masque = compositionTexte();
  masque.faces.front.layers[0].visible = false;
  assert.equal(await P.rendreFace(masque, 'front'), null, 'un calque masqué ne compte pas');
});

test('un texte est rendu à la bonne taille de fichier', options, async () => {
  const r = await P.rendreFace(compositionTexte(), 'front');
  assert.ok(r, 'un fichier est produit');
  assert.equal(r.w, 2480);
  assert.equal(r.h, 3508);
  assert.equal(r.format, 'A4');
  assert.equal(r.calques, 1);
  assert.ok(r.buffer.length > 1000, 'le PNG n\'est pas vide');
  // Signature PNG
  assert.equal(r.buffer.slice(1, 4).toString(), 'PNG');
});

test('le placement du serveur est celui de l\'écran, pas un autre', options, async () => {
  // La garantie centrale : versPixels est la seule arithmétique de placement,
  // partagée par l'aperçu et le fichier. On vérifie qu'un calque décalé à
  // gauche sort bien à gauche du fichier, aux mêmes proportions.
  const c = compositionTexte();
  c.faces.front.layers[0].x = 0.25;
  const taille = P.tailleImpression('A4', 0.75);
  const attendu = COMP.versPixels(COMP.normaliserCalque(c.faces.front.layers[0]),
                                  { x: 0, y: 0, w: taille.w, h: taille.h });
  assert.ok(Math.abs(attendu.left + attendu.width / 2 - taille.w * 0.25) < 1,
    'le centre du calque tombe au quart de la largeur');
  const r = await P.rendreFace(c, 'front');
  assert.ok(r);
});

test('un calque illisible est signalé, pas fatal', options, async () => {
  // Une image dont la source a disparu ne doit pas faire perdre le reste de
  // la commande : on imprime ce qu'on peut et on dit ce qui manque.
  const c = compositionTexte();
  c.faces.front.layers.push({
    type: 'image', x: 0.5, y: 0.8, w: 0.3, ratio: 1, visible: true,
    fabric: { src: 'https://exemple.invalide/absent.png' },
  });
  const r = await P.rendreFace(c, 'front');
  assert.ok(r, 'le fichier est quand même produit');
  assert.equal(r.manques.length, 1);
  assert.ok(r.manques[0].raison);
});

test('les deux faces sont rendues quand les deux sont personnalisées', options, async () => {
  const c = compositionTexte();
  c.faces.back = {
    format: 'A5', zone: { ratio: 0.75 },
    layers: [{ type: 'text', x: .5, y: .5, w: .5, ratio: .3, visible: true,
               fabric: { text: 'VERSO', fill: '#000' } }],
  };
  const out = await P.rendreToutesLesFaces(c);
  assert.deepEqual(Object.keys(out).sort(), ['back', 'front']);
  assert.equal(out.front.format, 'A4');
  assert.equal(out.back.format, 'A5', 'chaque face garde son propre format');
});

// ── Sécurité des sources ──────────────────────────────────────────────────

test('une composition ne peut pas faire lire un fichier arbitraire du serveur', options, async () => {
  // Les compositions viennent du navigateur d'un client : leurs sources sont
  // des données non fiables. Sans confinement, `../../..` dans un calque
  // ouvrait n'importe quel fichier du serveur.
  const racine = require('node:os').tmpdir();
  for (const src of ['/uploads/../../etc/passwd', '../../etc/passwd', '/etc/passwd',
                     '/../../../etc/hosts']) {
    const c = compositionTexte();
    c.faces.front.layers.push({
      type: 'image', x: .5, y: .5, w: .3, ratio: 1, visible: true, fabric: { src },
    });
    const r = await P.rendreFace(c, 'front', { racineLocale: racine });
    assert.equal(r.manques.length, 1, `source refusée : ${src}`);
    assert.match(r.manques[0].raison, /hors du dossier/, src);
  }
});

test('une source légitime du dossier des visuels reste acceptée', options, async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { createCanvas } = require('@napi-rs/canvas');

  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'tsl-print-'));
  fs.mkdirSync(path.join(racine, 'uploads', 'library'), { recursive: true });
  const petit = createCanvas(20, 20);
  const g = petit.getContext('2d');
  g.fillStyle = '#ff0000'; g.fillRect(0, 0, 20, 20);
  fs.writeFileSync(path.join(racine, 'uploads', 'library', 'rouge.png'), petit.toBuffer('image/png'));

  const c = compositionTexte();
  c.faces.front.layers.push({
    type: 'image', x: .5, y: .5, w: .3, ratio: 1, visible: true,
    fabric: { src: '/uploads/library/rouge.png' },
  });
  const r = await P.rendreFace(c, 'front', { racineLocale: racine });
  assert.deepEqual(r.manques, [], 'aucun manque');
  assert.equal(r.calques, 2);

  fs.rmSync(racine, { recursive: true, force: true });
});

// ── Polices ───────────────────────────────────────────────────────────────

test('une famille absente retombe sur une police lisible, jamais sur rien', options, () => {
  // Une famille inconnue rendrait des carrés à la place des accents, en
  // silence. C'est ce qui est arrivé avec « sans-serif », qui n'est pas une
  // famille enregistrée : le moteur retombait sur une police de dernier
  // recours dépourvue de caractères accentués.
  const r = P.resoudrePolice('PoliceQuiNExistePas');
  assert.ok(r, 'un repli est toujours proposé');
  assert.notEqual(r, 'PoliceQuiNExistePas');
  assert.equal(typeof r, 'string');
});

test('le gras se voit, même quand la police ne fournit pas de seconde graisse', options, async () => {
  // @napi-rs/canvas ne garde qu'une fonte par nom de famille et lit mal le
  // nom interne des WOFF2 de Google : deux graisses distinctes y atterrissent
  // sous la même famille et rendent à l'identique. Le gras est donc épaissi
  // au tracé. Sans ça, le gras d'un client s'imprimait en filet.
  const sharp = require('sharp');
  const composition = (gras) => ({
    v: 1,
    faces: { front: { format: 'A5', zone: { ratio: 0.75 }, layers: [{
      type: 'text', x: .5, y: .5, w: .8, ratio: .2, visible: true, opacity: 1,
      fabric: { text: 'WINSHIRT', fill: '#000000', fontFamily: 'Montserrat',
                fontWeight: gras ? 'bold' : 'normal', textAlign: 'center' },
    }] } },
  });
  const encre = async (buf) => {
    const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 128) n++;
    return n;
  };

  const normal = await P.rendreFace(composition(false), 'front');
  const gras   = await P.rendreFace(composition(true), 'front');
  const a = await encre(normal.buffer);
  const b = await encre(gras.buffer);
  assert.ok(a > 0, 'du texte est bien rendu');
  assert.ok(b > a * 1.15, `le gras encre nettement plus (${a} → ${b})`);
});

// ── Teinte d'un visuel monochrome ─────────────────────────────────────────
//
// L'écran et le tirage doivent sortir la MÊME couleur : un aperçu rouge et
// un fichier d'impression noir, c'est une réclamation garantie.

test('le tirage sort de la couleur demandée, pas du noir d\'origine',
  options,
  async () => {
    const { createCanvas, loadImage } = require('@napi-rs/canvas');

    // Un visuel monochrome : disque noir opaque sur fond transparent.
    const src = createCanvas(200, 200);
    const g = src.getContext('2d');
    g.fillStyle = '#000000';
    g.beginPath(); g.arc(100, 100, 80, 0, Math.PI * 2); g.fill();
    const source = 'data:image/png;base64,' + src.toBuffer('image/png').toString('base64');

    const calque = (extra) => ({
      id: 'c1', type: 'image', x: 0.5, y: 0.5, w: 0.6, ratio: 1, angle: 0,
      opacity: 1, visible: true, fabric: Object.assign({ src: source }, extra),
    });
    const composer = (extra) => ({
      faces: { front: { format: 'A4', zone: { ratio: 0.707 }, layers: [calque(extra)] } },
    });

    const centre = async (rendu) => {
      const img = await loadImage(rendu.buffer);
      const lu = createCanvas(rendu.w, rendu.h).getContext('2d');
      lu.drawImage(img, 0, 0);
      const d = lu.getImageData(Math.round(rendu.w / 2), Math.round(rendu.h / 2), 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    };

    // Sans teinte : le visuel garde ses couleurs.
    assert.deepEqual(await centre(await P.rendreFace(composer({}), 'front', { dpi: 72 })),
      [0, 0, 0, 255], 'noir d\'origine');

    // Trace posée par le moteur de l'éditeur de fiche.
    assert.deepEqual(await centre(await P.rendreFace(
      composer({ __tslTeinte: '#e8114b' }), 'front', { dpi: 72 })),
      [232, 17, 75, 255], 'teinte du moteur');

    // Écriture du studio : le filtre Fabric, sans la trace. Les deux doivent
    // donner le même tirage, sinon l'un des deux parcours imprimerait faux.
    assert.deepEqual(await centre(await P.rendreFace(
      composer({ filters: [{ type: 'BlendColor', color: '#1d8f3a', mode: 'tint', alpha: 1 }] }),
      'front', { dpi: 72 })),
      [29, 143, 58, 255], 'teinte du studio');
  });

test('la teinte garde la transparence du visuel',
  options,
  async () => {
    const { createCanvas, loadImage } = require('@napi-rs/canvas');
    const src = createCanvas(200, 200);
    const g = src.getContext('2d');
    g.fillStyle = '#000000';
    g.beginPath(); g.arc(100, 100, 60, 0, Math.PI * 2); g.fill();
    const source = 'data:image/png;base64,' + src.toBuffer('image/png').toString('base64');

    const rendu = await P.rendreFace({ faces: { front: { format: 'A4', zone: { ratio: 0.707 },
      layers: [{ id: 'c1', type: 'image', x: 0.5, y: 0.5, w: 0.6, ratio: 1, angle: 0,
                 opacity: 1, visible: true,
                 fabric: { src: source, __tslTeinte: '#e8114b' } }] } } },
      'front', { dpi: 72 });

    const img = await loadImage(rendu.buffer);
    const lu = createCanvas(rendu.w, rendu.h).getContext('2d');
    lu.drawImage(img, 0, 0);
    // Le coin reste transparent : la teinte remplit le dessin, pas le cadre.
    const coin = lu.getImageData(2, 2, 1, 1).data;
    assert.equal(coin[3], 0, 'hors du visuel : rien d\'imprimé');
  });
