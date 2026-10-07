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
    this.ratios = {};         // face → rapport de sa zone, pour l'export
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
        fabric:  o.toObject(['__tslId', '__tslType', '__customName', '__tslDeform',
                             '__tslDeformInt', '__tslTeinte']),
      };
    });
  };

  /** Remplace les calques de la face courante. */
  Moteur.prototype.poserCalques = function (calques, pret) {
    var self = this;
    // Jeton de pose : une image se charge de façon asynchrone, et rien
    // n'empêche de rechanger de face avant la fin. Sans ce garde-fou, le
    // visuel du recto arrivait sur le verso quelques dixièmes de seconde
    // plus tard — les faces se mélangeaient, parfois en double.
    var jeton = (this._pose = (this._pose || 0) + 1);

    this._poseEnCours = true;
    this.objets().forEach(function (o) { self.canvas.remove(o); });
    var restants = (calques || []).length;
    if (!restants) {
      this._poseEnCours = false;
      this.canvas.requestRenderAll();
      if (pret) pret();
      return;
    }

    // On pose dans l'ordre reçu pour préserver l'empilement, et on n'appelle
    // `pret` qu'une fois le dernier chargé.
    var fini = function () {
      if (jeton !== self._pose) return;   // pose périmée : une autre a pris la main
      if (--restants === 0) {
        self._poseEnCours = false;
        self.canvas.requestRenderAll();
        if (pret) pret();
      }
    };
    calques.forEach(function (c) { self._poserUn(c, fini, jeton); });
  };

  Moteur.prototype._poserUn = function (c, fini, jeton) {
    var self = this;
    var boite = versPixels(c, this.zone);

    var appliquer = function (obj) {
      // La face a changé pendant le chargement : ce calque n'a plus lieu
      // d'être posé, il appartient à ce qu'on vient de quitter.
      if (jeton !== undefined && jeton !== self._pose) { fini(); return; }
      obj.__tslType = c.type;
      if (f.__customName) obj.__customName = f.__customName;
      // La déformation AVANT la mise à l'échelle : elle change la largeur et
      // la hauteur naturelles de l'objet, et la boîte enregistrée était
      // justement celle du texte déjà courbé.
      if (f.__tslDeform && f.__tslDeform !== 'none') {
        self.deformer(obj, f.__tslDeform, f.__tslDeformInt);
      }
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
      // Avant la mise à l'échelle : `applyFilters` ne touche pas aux
      // dimensions naturelles, mais l'ordre reste celui de la déformation —
      // on rend l'objet complet, puis on le place.
      if (f.__tslTeinte) self.teinter(img, f.__tslTeinte);
      appliquer(img);
    }, { crossOrigin: 'anonymous' });
  };

  // ── Composition complète, toutes faces ───────────────────────────────────

  /** Bascule de face en mémorisant celle qu'on quitte. */
  /**
   * Bascule de face.
   *
   * `avantPose` est appelé ENTRE la sauvegarde de la face qu'on quitte et le
   * chargement de celle qu'on rejoint. C'est là, et nulle part ailleurs, que
   * la zone doit changer : les calques sont enregistrés en fractions de
   * zone, donc les relire avec la nouvelle les décalerait, et les poser avec
   * l'ancienne aussi.
   */
  Moteur.prototype.changerFace = function (face, pret, avantPose) {
    if (FACES.indexOf(face) < 0 || face === this.face) { if (pret) pret(); return; }
    // Une pose encore en cours veut dire que le canevas ne montre pas
    // encore la face qu'on quitte : l'enregistrer reviendrait à remplacer
    // ses calques par le vide. Sa version en mémoire fait toujours foi.
    if (!this._poseEnCours) {
      this.compositions[this.face] = this.lireCalques();
      this.ratios[this.face] = this.zone.w / this.zone.h;
    }
    this.face = face;
    if (avantPose) avantPose();
    this.poserCalques(this.compositions[face] || [], pret);
  };

  /** Composition complète, au format partagé. */
  Moteur.prototype.exporterComposition = function () {
    // Même précaution qu'au changement de face : on n'écrase pas une face
    // par un canevas qui n'a pas fini de la charger.
    if (!this._poseEnCours) {
      this.compositions[this.face] = this.lireCalques();
      this.ratios[this.face] = this.zone.w / this.zone.h;
    }
    var faces = {};
    var self = this;
    FACES.forEach(function (nom) {
      var calques = self.compositions[nom];
      if (calques && calques.length) {
        faces[nom] = {
          layers: calques,
          format: (self.formats || {})[nom] || null,
          // Le rapport de CETTE face : les deux photos n'ont aucune raison
          // d'avoir la même zone, et c'est lui qui donnera le format du
          // fichier d'impression.
          zone:   { ratio: self.ratios[nom] || (self.zone.w / self.zone.h) },
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
    this.ratios = {};
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
    // Centré SANS redimensionner : l'appelant a fixé le corps, l'étirer à la
    // zone rendrait le réglage de taille sans effet — et ferait facturer
    // tout texte au plus grand format.
    this.centrerSeul(t);
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

  /**
   * Teinte un visuel monochrome : le dessin prend la couleur demandée et ne
   * garde de lui-même que sa transparence.
   *
   * On passe par le filtre NATIF `BlendColor` en mode « tint » avec alpha 1 :
   * son calcul se réduit alors à « remplacer la couleur, garder l'alpha »
   * (`rgb = couleur + rgb × (1 − alpha)`), il est accéléré par le GPU quand
   * c'est possible, et Fabric sait le sérialiser. Un filtre maison aurait
   * demandé son propre nuanceur et son propre `fromObject`.
   *
   * La couleur est AUSSI mémorisée sur l'objet : au changement de face les
   * images sont rechargées depuis leur source, et `fabric.Image.fromURL` ne
   * reconstruit aucun filtre. Sans cette trace, la teinte disparaîtrait au
   * premier aller-retour recto/verso.
   *
   * Couleur vide : on rend au visuel ses couleurs d'origine.
   */
  Moteur.prototype.teinter = function (obj, couleur) {
    if (!obj || obj.__tslType === 'text' || !obj.applyFilters) return false;
    var F = global.fabric.Image.filters;
    var avant = obj.filters || [];
    obj.filters = avant.filter(function (f) { return !(f && f.type === 'BlendColor'); });
    if (couleur) {
      obj.filters.push(new F.BlendColor({ color: couleur, mode: 'tint', alpha: 1 }));
      obj.__tslTeinte = couleur;
    } else {
      delete obj.__tslTeinte;
    }
    try {
      obj.applyFilters();
    } catch (e) {
      // Visuel servi par une autre origine sans en-tête CORS : le navigateur
      // refuse d'en relire les pixels. On remet l'objet comme il était
      // plutôt que de le laisser à moitié filtré.
      console.warn('[TSL] teinte impossible sur ce visuel :', e && e.message);
      obj.filters = avant;
      delete obj.__tslTeinte;
      try { obj.applyFilters(); } catch (e2) { /* déjà signalé */ }
      return false;
    }
    // Fabric garde une version rendue de l'objet : sans ce drapeau, elle
    // peut rester affichée alors que l'image filtrée a changé dessous.
    obj.dirty = true;
    this.canvas.requestRenderAll();
    return true;
  };

  /** Couleur de teinte d'un objet, ou '' s'il garde ses couleurs d'origine. */
  Moteur.prototype.teinteDe = function (obj) {
    return (obj && obj.__tslTeinte) || '';
  };

  /** Place un objet au centre de la zone SANS toucher à sa taille. */
  Moteur.prototype.centrerSeul = function (obj) {
    var z = this.zone;
    var l = (obj.width || 1) * (obj.scaleX || 1);
    var h = (obj.height || 1) * (obj.scaleY || 1);
    obj.set({ left: z.x + (z.w - l) / 2, top: z.y + (z.h - h) / 2 });
    obj.setCoords();
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

  /**
   * Courbe ou incline un texte.
   * ──────────────────────────────────────────────────────────────────────
   * Ici et pas dans l'éditeur : c'est la seule façon qu'un texte courbé
   * rechargé depuis une composition retrouve sa forme. Les tracés sont
   * décrits dans le repère LOCAL du texte, centrés sur l'origine — c'est ce
   * qui permet de les recalculer à l'identique côté serveur au moment
   * d'imprimer, sans transporter le tracé lui-même.
   */
  Moteur.prototype.deformer = function (o, type, force) {
    if (!o) return;
    type = type || 'none';
    force = Math.max(1, Number(force) || 35);

    // Remise à plat complète : sans initDimensions(), la largeur reste celle
    // du tracé précédent et le texte se recentre de travers.
    o.set({ path: null, skewX: 0, skewY: 0 });
    if (typeof o.initDimensions === 'function') o.initDimensions();
    o.setCoords();

    o.__tslDeform = type;
    o.__tslDeformInt = force;
    if (type === 'none') { o.dirty = true; return; }

    var demi = Math.max(1, o.width / 2);
    var corps = o.fontSize || 40;
    var d = null;

    if (type === 'arc' || type === 'arcbas') {
      var fleche = Math.max(5, demi * (force / 90));
      var ctrl = type === 'arcbas' ? fleche : -fleche;
      d = 'M ' + (-demi) + ' 0 Q 0 ' + ctrl + ' ' + demi + ' 0';
    } else if (type === 'wave') {
      var amp = Math.max(5, corps * 0.6 * (force / 50));
      d = 'M ' + (-demi) + ' 0'
        + ' C ' + (-0.725 * demi) + ' ' + (-amp) + ' ' + (-0.275 * demi) + ' ' + (-amp) + ' 0 0'
        + ' S ' + (0.725 * demi) + ' ' + amp + ' ' + demi + ' 0';
    } else if (type === 'flag') {
      o.set({ skewY: (force / 80) * 22 });
    } else if (type === 'slant') {
      o.set({ skewX: -(force / 80) * 28 });
    }

    if (d) {
      var trace = new global.fabric.Path(d, { visible: false });
      o.set({
        path: trace,
        pathSide: 'left',
        pathStartOffset: Math.max(0, (longueurTrace(d) || o.width) - o.width) / 2,
      });
      // Reprendre les dimensions APRÈS avoir posé le tracé : sans ça l'objet
      // garde la largeur du texte droit, et tout ce qui s'appuie dessus —
      // le centrage dans la zone en premier — se trompe largement.
      if (typeof o.initDimensions === 'function') o.initDimensions();
      o.setCoords();
    }
    o.dirty = true;
  };

  /**
   * Longueur d'un tracé SVG, pour centrer le texte dessus. Passe par un
   * élément réellement inséré : Safari rend 0 sur un SVG détaché.
   */
  function longueurTrace(d) {
    try {
      var ns = 'http://www.w3.org/2000/svg';
      var svg = global.document.createElementNS(ns, 'svg');
      svg.style.cssText = 'position:absolute;visibility:hidden;width:0;height:0;overflow:hidden';
      var el = global.document.createElementNS(ns, 'path');
      el.setAttribute('d', d);
      svg.appendChild(el);
      global.document.body.appendChild(svg);
      var l = el.getTotalLength();
      global.document.body.removeChild(svg);
      return isFinite(l) && l > 0 ? l : null;
    } catch (e) { return null; }
  }

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
