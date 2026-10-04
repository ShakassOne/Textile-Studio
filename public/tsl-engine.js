/**
 * tsl-engine.js — Moteur de composition, partagé par le bloc et le studio.
 * ═══════════════════════════════════════════════════════════════════════════
 * UN SEUL moteur, c'est la règle posée par Alan. Le bloc de la fiche produit
 * et le configurateur plein écran doivent produire exactement le même rendu,
 * sans quoi le client voit une chose et reçoit l'autre.
 *
 * Ce module est donc le propriétaire unique de deux responsabilités :
 *
 *   • la conversion composition ⇄ canevas. Les calques sont stockés en
 *     fractions de la zone d'impression (cf. utils/composition.js) ; c'est
 *     ici, et uniquement ici, qu'on repasse en pixels ;
 *   • l'export. Le fichier d'impression et la vignette sortent du même
 *     canevas, avec les mêmes objets masqués.
 *
 * Ce qu'il ne fait PAS : l'interface. Pas de panneaux, pas de boutons, pas de
 * styles. Le bloc et le studio ont des habillages différents et doivent
 * pouvoir diverger là-dessus sans toucher au moteur.
 *
 * Conventions reprises telles quelles du configurateur, pour que les deux
 * restent interchangeables sur un même canevas :
 *   __isMockupBg     le visuel du vêtement
 *   __isFrame        le cadre pointillé de la zone
 *   __isPrintMask    le masque hors zone
 *   __isColorOverlay la teinte textile
 * Ces objets sont « système » : jamais listés dans les calques, toujours
 * masqués à l'export.
 */
(function (global) {
  'use strict';

  var SYSTEME = ['__isMockupBg', '__isFrame', '__isPrintMask', '__isColorOverlay'];
  var FACES = ['front', 'back'];

  function estSysteme(o) {
    for (var i = 0; i < SYSTEME.length; i++) if (o[SYSTEME[i]]) return true;
    return false;
  }

  /** Placement relatif → pixels. Réplique exacte de utils/composition.js. */
  function versPixels(c, zone) {
    var largeur = c.w * zone.w;
    var hauteur = largeur * c.ratio;
    return {
      left:   zone.x + c.x * zone.w - largeur / 2,
      top:    zone.y + c.y * zone.h - hauteur / 2,
      width:  largeur,
      height: hauteur,
      angle:  c.angle || 0,
    };
  }

  /** Pixels → placement relatif. Réciproque exacte. */
  function depuisPixels(b, zone) {
    var l = Number(b.width) || 0, h = Number(b.height) || 0;
    return {
      x:     ((Number(b.left) || 0) + l / 2 - zone.x) / zone.w,
      y:     ((Number(b.top) || 0) + h / 2 - zone.y) / zone.h,
      w:     l / zone.w,
      ratio: l > 0 ? h / l : 1,
      angle: Number(b.angle) || 0,
    };
  }

  // ── Moteur ────────────────────────────────────────────────────────────────

  /**
   * @param {HTMLCanvasElement|string} cible  élément canvas ou son id
   * @param {object} [options]
   *        zone     {x,y,w,h} en pixels — la zone d'impression
   *        onChange appelé après toute modification de composition
   */
  function Moteur(cible, options) {
    if (!global.fabric) throw new Error('Fabric.js doit être chargé avant tsl-engine');
    options = options || {};
    this.canvas = new global.fabric.Canvas(cible, {
      preserveObjectStacking: true,
      selection: true,
    });
    this.zone = options.zone || { x: 0, y: 0, w: this.canvas.getWidth(), h: this.canvas.getHeight() };
    this.face = 'front';
    this.compositions = {};   // face → calques sérialisés des faces inactives
    this.onChange = options.onChange || function () {};
    this._brancher();
  }

  Moteur.prototype._brancher = function () {
    var self = this;
    ['object:modified', 'object:added', 'object:removed'].forEach(function (ev) {
      self.canvas.on(ev, function () { self.onChange(self.face); });
    });
  };

  /**
   * Redéfinit la zone d'impression et replace les calques en conséquence.
   *
   * C'est l'opération qui rend le moteur indépendant de la taille d'écran :
   * on relit les positions RELATIVES avant de changer de zone, puis on les
   * réapplique après. Sans ce passage par le relatif, redimensionner la
   * fenêtre déplacerait le design sur le vêtement.
   */
  Moteur.prototype.definirZone = function (zone) {
    var calques = this.lireCalques();
    this.zone = zone;
    this.poserCalques(calques);
  };

  /** Objets de composition du canevas, dans l'ordre d'empilement. */
  Moteur.prototype.objets = function () {
    return this.canvas.getObjects().filter(function (o) { return !estSysteme(o); });
  };

  /** Calques de la face courante, en format de composition. */
  Moteur.prototype.lireCalques = function () {
    var zone = this.zone;
    return this.objets().map(function (o) {
      var p = depuisPixels({
        left: o.left, top: o.top,
        width: (o.width || 0) * (o.scaleX || 1),
        height: (o.height || 0) * (o.scaleY || 1),
        angle: o.angle,
      }, zone);
      return {
        id:      o.__tslId || null,
        type:    o.__tslType || (String(o.type || '').indexOf('text') >= 0 ? 'text' : 'image'),
        x: p.x, y: p.y, w: p.w, ratio: p.ratio, angle: p.angle,
        opacity: typeof o.opacity === 'number' ? o.opacity : 1,
        visible: o.visible !== false,
        locked:  o.selectable === false,
        fabric:  o.toObject(['__tslId', '__tslType']),
      };
    });
  };

  /** Remplace les calques de la face courante. */
  Moteur.prototype.poserCalques = function (calques, pret) {
    var self = this;
    this.objets().forEach(function (o) { self.canvas.remove(o); });
    var restants = (calques || []).length;
    if (!restants) { this.canvas.requestRenderAll(); if (pret) pret(); return; }

    // On pose dans l'ordre reçu pour préserver l'empilement, et on n'appelle
    // `pret` qu'une fois le dernier chargé — les images sont asynchrones.
    var fini = function () { if (--restants === 0) { self.canvas.requestRenderAll(); if (pret) pret(); } };
    calques.forEach(function (c) { self._poserUn(c, fini); });
  };

  Moteur.prototype._poserUn = function (c, fini) {
    var self = this;
    var boite = versPixels(c, this.zone);

    var appliquer = function (obj) {
      // On impose la taille par l'échelle plutôt que par width/height : c'est
      // la seule façon de ne pas déformer un texte ni rééchantillonner une
      // image.
      var lNat = obj.width || 1, hNat = obj.height || 1;
      obj.set({
        left: boite.left, top: boite.top,
        scaleX: boite.width / lNat,
        scaleY: boite.height / hNat,
        angle: boite.angle,
        opacity: typeof c.opacity === 'number' ? c.opacity : 1,
        visible: c.visible !== false,
        selectable: !c.locked,
        evented: !c.locked,
        originX: 'left', originY: 'top',
      });
      obj.__tslId = c.id || ('c' + Math.random().toString(36).slice(2, 9));
      obj.__tslType = c.type;
      self.canvas.add(obj);
      fini();
    };

    var f = c.fabric || {};
    if (c.type === 'text') {
      var txt = new global.fabric.IText(f.text != null ? String(f.text) : 'Votre texte', {
        fontFamily: f.fontFamily || 'Montserrat',
        fontSize:   f.fontSize || 48,
        fill:       f.fill || '#000000',
        fontWeight: f.fontWeight || 'normal',
        fontStyle:  f.fontStyle || 'normal',
        textAlign:  f.textAlign || 'center',
        underline:  !!f.underline,
      });
      appliquer(txt);
      return;
    }
    if (!f.src) { fini(); return; } // image sans source : rien à poser
    global.fabric.Image.fromURL(f.src, function (img) {
      if (!img) { fini(); return; }
      appliquer(img);
    }, { crossOrigin: 'anonymous' });
  };

  // ── Composition complète, toutes faces ───────────────────────────────────

  /** Bascule de face en mémorisant celle qu'on quitte. */
  Moteur.prototype.changerFace = function (face, pret) {
    if (FACES.indexOf(face) < 0 || face === this.face) { if (pret) pret(); return; }
    this.compositions[this.face] = this.lireCalques();
    this.face = face;
    this.poserCalques(this.compositions[face] || [], pret);
  };

  /** Composition complète, au format partagé. */
  Moteur.prototype.exporterComposition = function () {
    this.compositions[this.face] = this.lireCalques();
    var faces = {};
    var self = this;
    FACES.forEach(function (nom) {
      var calques = self.compositions[nom];
      if (calques && calques.length) {
        faces[nom] = {
          layers: calques,
          format: (self.formats || {})[nom] || null,
          zone:   { ratio: self.zone.w / self.zone.h },
        };
      }
    });
    return { v: 1, faces: faces, meta: this.meta || {} };
  };

  /** Charge une composition complète et affiche la face demandée. */
  Moteur.prototype.chargerComposition = function (comp, face, pret) {
    comp = comp || {};
    var faces = comp.faces || {};
    this.compositions = {};
    this.formats = {};
    var self = this;
    FACES.forEach(function (nom) {
      if (faces[nom]) {
        self.compositions[nom] = faces[nom].layers || [];
        self.formats[nom] = faces[nom].format || null;
      }
    });
    this.meta = comp.meta || {};
    this.face = FACES.indexOf(face) >= 0 ? face : 'front';
    this.poserCalques(this.compositions[this.face] || [], pret);
  };

  // ── Manipulation des calques ─────────────────────────────────────────────

  Moteur.prototype.ajouterTexte = function (texte, opts) {
    opts = opts || {};
    var t = new global.fabric.IText(texte || 'Votre texte', {
      fontFamily: opts.fontFamily || 'Montserrat',
      fontSize:   opts.fontSize || 48,
      fill:       opts.fill || '#000000',
      originX: 'left', originY: 'top',
    });
    t.__tslType = 'text';
    t.__tslId = 'c' + Math.random().toString(36).slice(2, 9);
    this._centrer(t);
    this.canvas.add(t).setActiveObject(t);
    this.canvas.requestRenderAll();
    return t;
  };

  Moteur.prototype.ajouterImage = function (url, pret) {
    var self = this;
    global.fabric.Image.fromURL(url, function (img) {
      if (!img) { if (pret) pret(null); return; }
      img.__tslType = 'image';
      img.__tslId = 'c' + Math.random().toString(36).slice(2, 9);
      self._centrer(img);
      self.canvas.add(img).setActiveObject(img);
      self.canvas.requestRenderAll();
      if (pret) pret(img);
    }, { crossOrigin: 'anonymous' });
  };

  /** Centre un objet dans la zone, contenu à 90 % — même marge que le studio. */
  Moteur.prototype._centrer = function (obj) {
    var z = this.zone;
    var e = Math.min(z.w / (obj.width || 1), z.h / (obj.height || 1)) * 0.9;
    obj.set({
      scaleX: e, scaleY: e,
      left: z.x + (z.w - (obj.width || 1) * e) / 2,
      top:  z.y + (z.h - (obj.height || 1) * e) / 2,
    });
  };

  Moteur.prototype.supprimer = function (id) {
    var self = this;
    this.objets().forEach(function (o) { if (o.__tslId === id) self.canvas.remove(o); });
    this.canvas.requestRenderAll();
  };

  /** Réordonne : `ids` du fond vers le premier plan. */
  Moteur.prototype.reordonner = function (ids) {
    var parId = {};
    this.objets().forEach(function (o) { parId[o.__tslId] = o; });
    var self = this;
    (ids || []).forEach(function (id) {
      var o = parId[id];
      if (o) self.canvas.bringToFront(o);
    });
    this.canvas.requestRenderAll();
  };

  Moteur.prototype.basculerVisibilite = function (id) {
    this.objets().forEach(function (o) { if (o.__tslId === id) o.visible = !o.visible; });
    this.canvas.requestRenderAll();
    this.onChange(this.face);
  };

  Moteur.prototype.basculerVerrou = function (id) {
    this.objets().forEach(function (o) {
      if (o.__tslId !== id) return;
      var v = o.selectable === false;
      o.selectable = v; o.evented = v;
    });
    this.canvas.discardActiveObject().requestRenderAll();
    this.onChange(this.face);
  };

  // ── Export ────────────────────────────────────────────────────────────────

  /**
   * Image du canevas, objets système masqués.
   *
   * Reprend la logique du configurateur, y compris la neutralisation du fond :
   * sans elle, le fond sombre du studio se retrouvait dans les PNG exportés.
   *
   * @param {object} opts  avecMockup (défaut true), multiplier, format, fond
   */
  Moteur.prototype.exporterImage = function (opts) {
    opts = opts || {};
    var avecMockup = opts.avecMockup !== false;
    var masques = [];
    this.canvas.getObjects().forEach(function (o) {
      var cacher = o.__isFrame || o.__isPrintMask || o.__isColorOverlay
                || (!avecMockup && o.__isMockupBg);
      if (cacher) { masques.push([o, o.visible]); o.visible = false; }
    });

    var fondOrigine = this.canvas.backgroundColor;
    var format = opts.format || 'png';
    this.canvas.backgroundColor = (typeof opts.fond !== 'undefined') ? opts.fond
      : (format === 'jpeg' || format === 'jpg') ? '#ffffff' : null;
    this.canvas.renderAll();

    var url;
    try {
      url = this.canvas.toDataURL({
        format: format,
        multiplier: opts.multiplier || 1,
        quality: opts.quality || 1,
      });
    } finally {
      masques.forEach(function (p) { p[0].visible = p[1]; });
      this.canvas.backgroundColor = fondOrigine;
      this.canvas.renderAll();
    }
    return url;
  };

  /**
   * Fichier d'impression : la ZONE seule, sans vêtement ni repères, sur fond
   * transparent. C'est ce qui part chez l'imprimeur, d'où le rendu à la
   * définition demandée plutôt qu'à celle de l'écran.
   */
  Moteur.prototype.exporterImpression = function (largeurPx) {
    var z = this.zone;
    var mult = (largeurPx || z.w) / z.w;
    var masques = [];
    this.canvas.getObjects().forEach(function (o) {
      if (estSysteme(o)) { masques.push([o, o.visible]); o.visible = false; }
    });
    var fondOrigine = this.canvas.backgroundColor;
    this.canvas.backgroundColor = null;
    this.canvas.renderAll();
    var url;
    try {
      url = this.canvas.toDataURL({
        format: 'png', multiplier: mult,
        left: z.x, top: z.y, width: z.w, height: z.h,
      });
    } finally {
      masques.forEach(function (p) { p[0].visible = p[1]; });
      this.canvas.backgroundColor = fondOrigine;
      this.canvas.renderAll();
    }
    return url;
  };

  global.TSLEngine = {
    Moteur: Moteur,
    versPixels: versPixels,
    depuisPixels: depuisPixels,
    FACES: FACES,
    estSysteme: estSysteme,
  };
})(typeof window !== 'undefined' ? window : this);
