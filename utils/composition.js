'use strict';
/**
 * utils/composition.js — Format d'une personnalisation, partagé par tous.
 * ──────────────────────────────────────────────────────────────────────────
 * C'est le CONTRAT entre le bloc de la fiche produit, le configurateur plein
 * écran, le panier et la génération du fichier d'impression. Une composition
 * écrite par l'un doit être relue à l'identique par les autres — sinon le
 * client voit une chose et reçoit l'autre.
 *
 * Deux partis pris expliquent toute la forme du format.
 *
 * ── 1. Les faces sont nommées, pas numérotées ──
 * Le format des templates (v1 à v3) indexait les calques par
 * `<mockupId>_<indexDeVue>`. Changer de mockup perdait donc la composition,
 * et rien ne disait si « vue 1 » était le dos ou une manche. Ici les faces
 * s'appellent `front`, `back`, et le vocabulaire est stable d'un produit à
 * l'autre.
 *
 * ── 2. Les positions sont RELATIVES à la zone d'impression ──
 * Les templates stockaient des pixels de canevas absolus, or la largeur du
 * canevas dépend de l'écran : ~340 px sur mobile, jusqu'à 1000 px sur
 * desktop. Un design composé sur desktop arrivait décalé et surdimensionné
 * sur mobile, d'où la gymnastique de recalage (`_tplRemapToFrame` et sa
 * cascade de tentatives).
 *
 * Ici, un calque se place en fractions de la zone : `x` et `y` donnent le
 * CENTRE, `w` la largeur, tous entre 0 et 1. La même composition rend donc
 * identiquement à n'importe quelle taille de canevas, sans recalage.
 *
 * Les propriétés Fabric (police, ombre, filtres…) restent stockées telles
 * quelles dans `fabric` : les redéclarer dans un schéma parallèle reviendrait
 * à réécrire Fabric, et à perdre toute propriété qu'on aurait oubliée.
 *
 * Module PUR : aucun accès DB, réseau, DOM ni Fabric. Testable tel quel.
 */

const VERSION = 1;
const FACES = ['front', 'back'];

/** Composition vide, prête à recevoir des calques. */
function creer() {
  return { v: VERSION, faces: {}, meta: {} };
}

/** Face vide. */
function creerFace() {
  return { layers: [], format: null, zone: null };
}

function estObjet(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

/**
 * Borne une valeur, en tolérant un léger débordement de la zone.
 *
 * On refuse explicitement tout ce qui n'est pas un nombre ou une chaîne
 * numérique : `Number(null)`, `Number('')` et `Number([])` valent tous 0, si
 * bien qu'une valeur ABSENTE se serait silencieusement transformée en
 * position 0 — c'est-à-dire le coin supérieur gauche de la zone — au lieu de
 * retomber sur le défaut.
 */
function borne(n, min, max, defaut) {
  let v;
  if (typeof n === 'number') v = n;
  else if (typeof n === 'string' && n.trim() !== '') v = Number(n);
  else return defaut;
  if (!Number.isFinite(v)) return defaut;
  return Math.min(max, Math.max(min, v));
}

/**
 * Nettoie un calque reçu de l'extérieur.
 * Tout ce qui n'est pas exploitable est remplacé par une valeur sûre plutôt
 * que rejeté : une composition à moitié lisible vaut mieux qu'un panier vide.
 */
function normaliserCalque(brut) {
  if (!estObjet(brut)) return null;
  const type = String(brut.type || '').toLowerCase();
  if (['text', 'image', 'qr'].indexOf(type) < 0) return null;

  return {
    id:      String(brut.id || '') || ('c' + Math.random().toString(36).slice(2, 9)),
    type,
    // Position du CENTRE et largeur, en fractions de la zone d'impression.
    // On tolère -0.5 à 1.5 : un visuel peut déborder volontairement du cadre.
    x:       borne(brut.x, -0.5, 1.5, 0.5),
    y:       borne(brut.y, -0.5, 1.5, 0.5),
    w:       borne(brut.w, 0.01, 3, 0.5),
    ratio:   borne(brut.ratio, 0.01, 100, 1),   // hauteur / largeur
    angle:   borne(brut.angle, -360, 360, 0),
    opacity: borne(brut.opacity, 0, 1, 1),
    visible: brut.visible !== false,
    locked:  brut.locked === true,
    // Propriétés propres au moteur de rendu, conservées telles quelles.
    fabric:  estObjet(brut.fabric) ? brut.fabric : null,
  };
}

/** Nettoie une face. */
function normaliserFace(brut) {
  const f = creerFace();
  if (!estObjet(brut)) return f;
  f.layers = (Array.isArray(brut.layers) ? brut.layers : [])
    .map(normaliserCalque)
    .filter(Boolean);
  f.format = typeof brut.format === 'string' ? brut.format : null;
  // Rapport largeur/hauteur de la zone au moment de la composition : permet
  // de détecter qu'une zone a été recalibrée depuis.
  f.zone = estObjet(brut.zone) && Number(brut.zone.ratio) > 0
    ? { ratio: Number(brut.zone.ratio) }
    : null;
  return f;
}

/**
 * Lecture tolérante d'une composition, quelle que soit sa provenance.
 * @returns {{v:number, faces:object, meta:object}} toujours exploitable
 */
function normaliser(brut) {
  const c = creer();
  if (!estObjet(brut)) return c;
  if (estObjet(brut.meta)) c.meta = brut.meta;

  const faces = estObjet(brut.faces) ? brut.faces : {};
  FACES.forEach((nom) => {
    if (estObjet(faces[nom])) c.faces[nom] = normaliserFace(faces[nom]);
  });
  return c;
}

/** Faces qui portent au moins un calque visible. */
function facesUtilisees(comp) {
  const c = normaliser(comp);
  return FACES.filter((nom) => {
    const f = c.faces[nom];
    return f && f.layers.some((l) => l.visible);
  });
}

/** Une composition sans aucun calque visible ne doit pas partir en production. */
function estVide(comp) {
  return facesUtilisees(comp).length === 0;
}

/**
 * Placement relatif → pixels, pour une zone donnée.
 * C'est l'unique endroit où l'on repasse en absolu : tout le reste du
 * système raisonne en fractions.
 *
 * @param {object} calque  calque normalisé
 * @param {{x:number,y:number,w:number,h:number}} zone  en pixels
 * @returns {{left:number,top:number,width:number,height:number,angle:number}}
 *          left/top = coin supérieur gauche, prêt pour un moteur de rendu
 */
function versPixels(calque, zone) {
  const largeur = calque.w * zone.w;
  const hauteur = largeur * calque.ratio;
  const cx = zone.x + calque.x * zone.w;
  const cy = zone.y + calque.y * zone.h;
  return {
    left:   cx - largeur / 2,
    top:    cy - hauteur / 2,
    width:  largeur,
    height: hauteur,
    angle:  calque.angle,
  };
}

/**
 * Pixels → placement relatif. Réciproque exacte de versPixels.
 *
 * @param {{left:number,top:number,width:number,height:number,angle?:number}} boite
 * @param {{x:number,y:number,w:number,h:number}} zone
 */
function depuisPixels(boite, zone) {
  const largeur = Number(boite.width) || 0;
  const hauteur = Number(boite.height) || 0;
  return {
    x:     ((Number(boite.left) || 0) + largeur / 2 - zone.x) / zone.w,
    y:     ((Number(boite.top) || 0) + hauteur / 2 - zone.y) / zone.h,
    w:     largeur / zone.w,
    ratio: largeur > 0 ? hauteur / largeur : 1,
    angle: Number(boite.angle) || 0,
  };
}

/**
 * Convertit un template produit (v1 à v3) vers ce format.
 * ──────────────────────────────────────────────────────────────────────────
 * Les templates en production restent lisibles : ils indexaient les calques
 * par `<mockupId>_<indexDeVue>` en pixels de canevas absolus, avec la zone
 * d'impression du moment stockée dans `frame`. C'est ce `frame` qui permet de
 * repasser en relatif — sans lui, on ne peut rien conclure et la face est
 * laissée vide plutôt que décalée au hasard.
 *
 * @param {object} tpl  le JSON du metafield custom.tsl_template
 * @returns {object} composition normalisée
 */
function depuisTemplate(tpl) {
  const c = creer();
  if (!estObjet(tpl)) return c;
  c.meta = {
    origine:  'template',
    version:  tpl.v || null,
    product:  tpl.product || null,
    color:    tpl.color || null,
    mockupId: tpl.mockupId != null ? tpl.mockupId : null,
  };

  const frame = estObjet(tpl.frame) && Number(tpl.frame.w) > 0 ? tpl.frame : null;
  const couches = estObjet(tpl.viewLayers) ? tpl.viewLayers : {};
  const formats = estObjet(tpl.viewFormats) ? tpl.viewFormats : {};

  // Les clés sont « <mockupId>_<index> » : l'index donne la face.
  Object.keys(couches).forEach((cle) => {
    const objets = couches[cle];
    if (!Array.isArray(objets) || !objets.length) return;
    const m = /_(\d+)$/.exec(cle);
    const idx = m ? Number(m[1]) : 0;
    const nom = FACES[idx];
    if (!nom) return; // au-delà de deux faces : rien à migrer

    const face = creerFace();
    face.format = formats[cle] || tpl.format || null;
    if (frame) face.zone = { ratio: frame.w / frame.h };

    face.layers = objets.map((o) => {
      if (!estObjet(o)) return null;
      const base = { type: _typeFabric(o), fabric: o, visible: o.visible !== false };
      if (!frame) return normaliserCalque(base);
      const largeur = (Number(o.width) || 0) * (Number(o.scaleX) || 1);
      const hauteur = (Number(o.height) || 0) * (Number(o.scaleY) || 1);
      return normaliserCalque(Object.assign(base, depuisPixels({
        left: o.left, top: o.top, width: largeur, height: hauteur, angle: o.angle,
      }, frame)));
    }).filter(Boolean);

    if (face.layers.length) c.faces[nom] = face;
  });

  return c;
}

/** Type Fabric → type de calque. */
function _typeFabric(o) {
  const t = String(o.type || '').toLowerCase();
  if (t.indexOf('text') >= 0) return 'text';
  if (o.__isQR || t === 'group' && o.__qr) return 'qr';
  return 'image';
}

module.exports = {
  VERSION,
  FACES,
  creer,
  creerFace,
  normaliser,
  normaliserCalque,
  normaliserFace,
  facesUtilisees,
  estVide,
  versPixels,
  depuisPixels,
  depuisTemplate,
};
