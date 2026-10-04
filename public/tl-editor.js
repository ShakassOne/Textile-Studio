/**
 * tl-editor.js — Éditeur de personnalisation sur la page produit.
 * ═══════════════════════════════════════════════════════════════════════════
 * SQUELETTE (étape 1) : la barre d'outils, le tiroir et toute la mécanique
 * d'ouverture. Les panneaux sont volontairement vides — ils seront remplis
 * outil par outil, en commençant par Textes.
 *
 * Le parti pris d'implantation, qui explique l'essentiel du code :
 *
 *   • Le tiroir s'ouvre VERS LE HAUT depuis le bloc et recouvre le titre, le
 *     prix, la description et les tailles. Tout ce qui est SOUS le bloc —
 *     couleurs, quantité, bouton panier — reste visible et cliquable. D'où la
 *     règle de pose : le bloc va juste avant les couleurs.
 *
 *   • Quand le panneau est plus haut que la zone disponible au-dessus, c'est
 *     le BLOC qui grandit (min-height animé) et pousse les couleurs vers le
 *     bas. Jamais de défilement interne : sur une fiche produit, un panneau
 *     qui défile dans un panneau est illisible.
 *
 *   • Sur mobile, une barre fixe en bas porte les pastilles de couleur et un
 *     bouton panier compact ; le tiroir s'ouvre au-dessus d'elle, à mi-hauteur,
 *     pour que l'aperçu reste visible.
 *
 * Les variantes viennent d'un <script type="application/json"> rendu par
 * Liquid, pas du DOM : le balisage d'un sélecteur de variantes change d'un
 * thème à l'autre, `product.variants` non.
 *
 * Style ES5 et aucune dépendance, comme tl-modal.js et tl-designs.js : ce
 * script tourne sur des thèmes qu'on ne choisit pas.
 */
(function () {
  'use strict';
  if (window.__TSL_EDITOR_LOADED) return;
  window.__TSL_EDITOR_LOADED = true;

  var DUREE = 280;
  var COURBE = 'cubic-bezier(.32,.72,0,1)';
  var SOBRE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var OUTILS = {
    text:   { titre: 'Textes',  sous: 'Ajoutez et personnalisez votre texte',
              icone: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>' },
    image:  { titre: 'Images',  sous: 'Importez votre visuel ou choisissez un design',
              icone: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 20"/>' },
    ai:     { titre: 'IA',      sous: 'Créez un visuel à partir d\'une description',
              icone: '<path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z"/><path d="M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z"/>' },
    qr:     { titre: 'QR code', sous: 'Un lien, une vidéo, un contact',
              icone: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3h-3z"/>' },
    layers: { titre: 'Calques', sous: 'Réorganisez les éléments de votre design',
              icone: '<path d="M12 2l9 5-9 5-9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/>' },
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  // Peu de règles, toutes préfixées, et on hérite de la police du thème : ce
  // bloc doit se fondre dans des habillages qu'on ne maîtrise pas.
  var CSS = ''
    // `width:100%` et `flex-basis:100%` : posé dans un groupe de blocs que le
    // thème dispose en rangée, le conteneur était écrasé à zéro de large et
    // la barre devenait invisible — présente dans le DOM, mais sans surface.
    + '.tsle{position:relative;margin:16px 0;width:100%;flex:1 1 100%;min-width:0;box-sizing:border-box}'
    + '.tsle-bar{display:flex;gap:6px;overflow-x:auto;padding:4px 0;min-width:0;scrollbar-width:none}'
    + '.tsle-bar::-webkit-scrollbar{display:none}'
    + '.tsle-tool{flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border-radius:999px;'
    +   'border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font:inherit;font-size:.85rem;'
    +   'cursor:pointer;line-height:1;white-space:nowrap;transition:background .18s,color .18s,border-color .18s}'
    + '.tsle-tool svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}'
    + '.tsle-tool[aria-expanded="true"]{background:var(--tsle-accent,#111114);color:var(--tsle-on-accent,#fff);border-color:var(--tsle-accent,#111114)}'

    // Le tiroir est ancré au BAS du bloc et se déploie vers le haut : c'est ce
    // qui lui fait recouvrir le titre, le prix et les tailles sans jamais
    // masquer les couleurs ni le bouton panier, qui sont dessous.
    // Le tiroir est ancré sur la BARRE et non sur le bloc : `bottom:100%` de
    // l'ancre le place pile au-dessus des icônes, qui restent donc visibles —
    // l'icône active doit se voir tant que son panneau est ouvert.
    + '.tsle-anchor{position:relative}'
    + '.tsle-drawer{position:absolute;left:0;right:0;bottom:calc(100% + 8px);z-index:30;'
    +   'background:var(--tsle-surface,#fff);color:inherit;border:1px solid rgba(128,128,128,.25);'
    +   'border-radius:16px;box-shadow:0 -6px 40px rgba(0,0,0,.14);overflow:hidden;'
    +   'opacity:0;transform:translateY(10px) scale(.985);pointer-events:none;visibility:hidden}'
    + '.tsle-drawer.open{opacity:1;transform:none;pointer-events:auto;visibility:visible}'
    + '.tsle-head{display:flex;align-items:center;gap:12px;padding:16px 18px 10px}'
    + '.tsle-head-icon{flex:0 0 auto;width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;'
    +   'background:rgba(128,128,128,.14)}'
    + '.tsle-head-icon svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}'
    + '.tsle-head-txt{flex:1;min-width:0}'
    + '.tsle-head-txt b{display:block;font-size:1.05rem;line-height:1.25}'
    + '.tsle-head-txt span{display:block;font-size:.78rem;opacity:.6;margin-top:2px}'
    + '.tsle-close{flex:0 0 auto;width:34px;height:34px;border-radius:50%;border:0;background:transparent;color:inherit;'
    +   'font-size:20px;line-height:1;cursor:pointer;opacity:.6}'
    + '.tsle-close:hover{opacity:1;background:rgba(128,128,128,.14)}'
    + '.tsle-body{padding:4px 18px 18px}'
    + '.tsle-panel{display:none}'
    + '.tsle-panel.on{display:block}'
    + '.tsle-vide{padding:26px 0;text-align:center;font-size:.85rem;opacity:.5}'

    // Barre fixe mobile : couleurs + panier, toujours atteignables.
    + '.tsle-mbar{position:fixed;left:0;right:0;bottom:0;z-index:40;display:none;align-items:center;gap:10px;'
    +   'padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));'
    +   'background:var(--tsle-surface,#fff);border-top:1px solid rgba(128,128,128,.25);'
    +   'box-shadow:0 -4px 20px rgba(0,0,0,.10)}'
    + '.tsle-swatches{flex:1;min-width:0;display:flex;gap:7px;overflow-x:auto;scrollbar-width:none}'
    + '.tsle-swatches::-webkit-scrollbar{display:none}'
    + '.tsle-sw{flex:0 0 auto;width:28px;height:28px;border-radius:50%;border:2px solid rgba(128,128,128,.4);'
    +   'padding:0;cursor:pointer;background-clip:padding-box}'
    + '.tsle-sw[aria-pressed="true"]{outline:2px solid var(--tsle-accent,#111114);outline-offset:2px}'
    + '.tsle-mcart{flex:0 0 auto;border:0;border-radius:999px;padding:11px 18px;font:inherit;font-size:.9rem;font-weight:600;'
    +   'background:var(--tsle-accent,#111114);color:var(--tsle-on-accent,#fff);cursor:pointer;white-space:nowrap}'

    + '.tsle-alerte{animation:tsle-pulse 1.1s ease 2}'
    + '@keyframes tsle-pulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,0)}50%{box-shadow:0 0 0 4px rgba(220,38,38,.35)}}'

    + '@media (max-width:767px){'
    +   '.tsle-mbar{display:flex}'
    +   '.tsle-drawer{position:fixed;left:0;right:0;bottom:0;top:auto;border-radius:18px 18px 0 0;'
    +     'max-height:58vh;overflow-y:auto;transform:translateY(100%);box-shadow:0 -10px 40px rgba(0,0,0,.25)}'
    +   '.tsle-drawer.open{transform:translateY(calc(-1 * var(--tsle-mbar-h,64px)))}'
    + '}'
    + '@media (prefers-reduced-motion:reduce){.tsle-drawer,.tsle-panel{transition:none!important}}';

  function styles() {
    if (document.getElementById('tsle-css')) return;
    var s = document.createElement('style');
    s.id = 'tsle-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Format monétaire de la boutique — jamais de « € » codé en dur. */
  function prix(centimes, format) {
    var v = (Number(centimes || 0) / 100);
    var f = String(format || '{{amount}} €');
    var avecVirgule = /amount_with_comma_separator|amount_no_decimals_with_comma_separator/.test(f);
    var sansDec = /no_decimals/.test(f);
    var n = sansDec ? String(Math.round(v)) : v.toFixed(2);
    if (avecVirgule) n = n.replace('.', ',');
    // Séparateur de milliers, dans le style attendu par le format.
    n = n.replace(/\B(?=(\d{3})+(?!\d))/g, avecVirgule ? ' ' : ',');
    return f.replace(/\{\{\s*\w+\s*\}\}/, n).replace(/<[^>]+>/g, '').trim();
  }

  // ── État d'une instance ───────────────────────────────────────────────────

  function Editeur(racine) {
    this.racine = racine;
    this.produit = String(racine.getAttribute('data-tsl-editor') || '');
    this.outil = null;
    this.donnees = this.lireDonnees();
    this.outils = String(racine.getAttribute('data-tsl-tools') || '')
      .split(',').map(function (s) { return s.trim(); }).filter(function (s) { return OUTILS[s]; });
    if (!this.outils.length || !this.donnees) return;
    this.construire();
  }

  Editeur.prototype.lireDonnees = function () {
    var el = document.querySelector('[data-tsl-editor-data="' + this.produit + '"]');
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  };

  Editeur.prototype.construire = function () {
    var self = this;
    var accent = this.racine.getAttribute('data-tsl-accent');
    if (accent === 'light') {
      this.racine.style.setProperty('--tsle-accent', '#ffffff');
      this.racine.style.setProperty('--tsle-on-accent', '#111114');
    } else if (accent === 'dark') {
      this.racine.style.setProperty('--tsle-accent', '#111114');
      this.racine.style.setProperty('--tsle-on-accent', '#ffffff');
    } // 'theme' : on laisse les valeurs par défaut du CSS

    var html = '<div class="tsle-anchor"><div class="tsle-bar" role="tablist">';
    this.outils.forEach(function (cle) {
      var o = OUTILS[cle];
      html += '<button type="button" class="tsle-tool" data-outil="' + cle + '" aria-expanded="false">'
            +   '<svg viewBox="0 0 24 24" aria-hidden="true">' + o.icone + '</svg>'
            +   '<span>' + esc(o.titre) + '</span>'
            + '</button>';
    });
    html += '</div>';

    html += '<div class="tsle-drawer" role="dialog" aria-modal="false" aria-label="Personnalisation">'
          +   '<div class="tsle-head">'
          +     '<span class="tsle-head-icon"><svg viewBox="0 0 24 24" aria-hidden="true"></svg></span>'
          +     '<span class="tsle-head-txt"><b></b><span></span></span>'
          +     '<button type="button" class="tsle-close" aria-label="Fermer">×</button>'
          +   '</div>'
          +   '<div class="tsle-body">';
    this.outils.forEach(function (cle) {
      html += '<div class="tsle-panel" data-panneau="' + cle + '">'
            +   '<div class="tsle-vide">Panneau « ' + esc(OUTILS[cle].titre) + ' » — à venir</div>'
            + '</div>';
    });
    html += '</div></div></div>'; // body + drawer + anchor

    this.racine.innerHTML = html;
    this.drawer = this.racine.querySelector('.tsle-drawer');
    this.barre = this.racine.querySelector('.tsle-bar');

    this.racine.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('.tsle-tool') : null;
      if (t) { self.basculer(t.getAttribute('data-outil')); return; }
      if (e.target.closest && e.target.closest('.tsle-close')) self.fermer();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && self.outil) self.fermer();
    });

    // Hauteur réelle de la barre : le tiroir s'arrête juste au-dessus d'elle.
    var mesurerBarre = function () {
      self.racine.style.setProperty('--tsle-bar-h', self.barre.offsetHeight + 'px');
    };
    mesurerBarre();
    window.addEventListener('resize', function () { mesurerBarre(); if (self.outil) self.ajuster(); });

    this.barreMobile();
    this.brancherPrix();

    this.verifierPlacement();

    var parDefaut = this.racine.getAttribute('data-tsl-default-tool');
    if (parDefaut && OUTILS[parDefaut] && this.outils.indexOf(parDefaut) >= 0) {
      this.ouvrir(parDefaut, true);
    }
  };

  /**
   * Signale un placement qui ne peut pas fonctionner.
   *
   * Le tiroir s'ouvre vers le haut : posé tout en haut de la colonne d'infos,
   * il n'a rien à recouvrir et s'affiche dans le vide. Posé dans un groupe
   * disposé en rangée, le bloc n'a pas de largeur du tout. Dans les deux cas
   * l'intégrateur ne voit rien et ne sait pas pourquoi — d'où cet
   * avertissement en console plutôt qu'un échec muet.
   */
  Editeur.prototype.verifierPlacement = function () {
    var self = this;
    setTimeout(function () {
      var r = self.racine.getBoundingClientRect();
      if (r.width < 80) {
        console.warn('[TSL] Le bloc éditeur n\'a presque pas de largeur (' + Math.round(r.width)
          + 'px). Il est probablement posé dans un groupe de blocs disposé en rangée : '
          + 'déplacez-le au niveau de la colonne produit.');
      }
      var conteneur = self.racine.parentElement;
      if (conteneur) {
        var dispo = r.top - conteneur.getBoundingClientRect().top;
        if (dispo < 120) {
          console.warn('[TSL] Le bloc éditeur est tout en haut de la colonne : le tiroir '
            + 's\'ouvre vers le haut et n\'aura presque rien à recouvrir. Placez-le juste '
            + 'avant le sélecteur de couleurs.');
        }
      }
    }, 300);
  };

  // ── Ouverture, fermeture, changement d'outil ──────────────────────────────

  Editeur.prototype.basculer = function (cle) {
    if (this.outil === cle) this.fermer();
    else this.ouvrir(cle);
  };

  Editeur.prototype.ouvrir = function (cle, sansAnim) {
    var self = this;
    var changement = !!this.outil && this.outil !== cle;
    this.outil = cle;

    var o = OUTILS[cle];
    this.drawer.querySelector('.tsle-head-icon svg').innerHTML = o.icone;
    this.drawer.querySelector('.tsle-head-txt b').textContent = o.titre;
    this.drawer.querySelector('.tsle-head-txt span').textContent = o.sous;

    // Changement d'outil tiroir ouvert : on fond le contenu, on ne referme pas.
    var corps = this.drawer.querySelector('.tsle-body');
    var montrer = function () {
      self.drawer.querySelectorAll('.tsle-panel').forEach(function (p) {
        p.classList.toggle('on', p.getAttribute('data-panneau') === cle);
      });
      self.ajuster();
    };
    if (changement && !SOBRE && !sansAnim) {
      corps.style.transition = 'opacity 120ms linear';
      corps.style.opacity = '0';
      setTimeout(function () { montrer(); corps.style.opacity = '1'; }, 120);
    } else {
      montrer();
    }

    this.barre.querySelectorAll('.tsle-tool').forEach(function (b) {
      b.setAttribute('aria-expanded', b.getAttribute('data-outil') === cle ? 'true' : 'false');
    });

    if (!this.drawer.classList.contains('open')) {
      if (this.mesurerBarreMobile) this.mesurerBarreMobile();
      this.drawer.style.transition = (SOBRE || sansAnim) ? 'none'
        : 'opacity ' + DUREE + 'ms ' + COURBE + ', transform ' + DUREE + 'ms ' + COURBE;
      // Laisser le navigateur enregistrer l'état fermé avant d'animer.
      void this.drawer.offsetWidth;
      this.drawer.classList.add('open');
    }
  };

  Editeur.prototype.fermer = function () {
    if (!this.outil) return;
    this.outil = null;
    this.drawer.classList.remove('open');
    this.barre.querySelectorAll('.tsle-tool').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    this.racine.style.paddingTop = '';
  };

  /**
   * Fait de la place au tiroir sans jamais recouvrir ce qui est sous le bloc.
   *
   * Le tiroir est ancré au bas du bloc et monte. S'il est plus haut que
   * l'espace disponible au-dessus, c'est le bloc qui grandit : les couleurs
   * et le bouton panier descendent doucement au lieu d'être masqués.
   */
  Editeur.prototype.ajuster = function () {
    if (window.innerWidth < 768) { this.racine.style.paddingTop = ''; return; }
    var conteneur = this.racine.parentElement;
    if (!conteneur) return;
    // Espace libre entre le haut de la colonne et le haut de la barre d'outils.
    var hautDispo = this.barre.getBoundingClientRect().top - conteneur.getBoundingClientRect().top - 8;
    var hPanneau = this.drawer.scrollHeight;
    var manque = Math.max(0, Math.ceil(hPanneau - hautDispo));
    // On pousse le bloc vers le BAS plutôt que de l'étirer : la barre, les
    // couleurs et le bouton descendent ensemble, et la place ainsi libérée
    // au-dessus accueille le tiroir. L'étirer par le bas n'aurait rien donné,
    // le tiroir étant ancré sur la barre.
    this.racine.style.transition = SOBRE ? 'none' : 'padding-top ' + DUREE + 'ms ' + COURBE;
    this.racine.style.paddingTop = manque ? manque + 'px' : '';
  };

  // ── Barre fixe mobile : couleurs + panier ─────────────────────────────────

  Editeur.prototype.barreMobile = function () {
    var self = this;
    var d = this.donnees;
    var iCouleur = -1;
    (d.optionNames || []).forEach(function (n, i) {
      if (/couleur|colou?r/i.test(n)) iCouleur = i;
    });

    var bar = document.createElement('div');
    bar.className = 'tsle-mbar';
    bar.setAttribute('data-tsl-mbar', this.produit);

    var pastilles = '';
    if (iCouleur >= 0) {
      var vues = {};
      d.variants.forEach(function (v) {
        var val = v.options[iCouleur];
        if (!val || vues[val]) return;
        vues[val] = 1;
        pastilles += '<button type="button" class="tsle-sw" data-couleur="' + esc(val) + '"'
                   + ' title="' + esc(val) + '" aria-label="' + esc(val) + '" aria-pressed="false"></button>';
      });
    }
    bar.innerHTML = '<div class="tsle-swatches">' + pastilles + '</div>'
                  + '<button type="button" class="tsle-mcart"></button>';
    document.body.appendChild(bar);
    this.mbar = bar;

    // Hauteur réelle de la barre : le tiroir mobile s'ouvre juste au-dessus.
    // On la remesure à chaque ouverture et à chaque redimensionnement — la
    // mesurer une seule fois à la construction donnait une valeur trop faible,
    // les pastilles n'ayant pas encore leur taille définitive, et le tiroir
    // mordait sur la barre de quelques pixels.
    this.mesurerBarreMobile = function () {
      var h = bar.getBoundingClientRect().height || bar.offsetHeight;
      document.documentElement.style.setProperty('--tsle-mbar-h', Math.ceil(h) + 'px');
    };
    this.mesurerBarreMobile();
    window.addEventListener('resize', this.mesurerBarreMobile);
    if (window.ResizeObserver) new ResizeObserver(this.mesurerBarreMobile).observe(bar);

    bar.addEventListener('click', function (e) {
      var sw = e.target.closest ? e.target.closest('.tsle-sw') : null;
      if (sw) { self.choisirCouleur(sw.getAttribute('data-couleur'), iCouleur); return; }
      if (e.target.closest && e.target.closest('.tsle-mcart')) self.ajouterAuPanier();
    });

    this.iCouleur = iCouleur;
    this.teinterPastilles();
  };

  /**
   * Teinte les pastilles avec les coloris réels du produit.
   * Le backend les déduit de la photo de chaque variante quand Shopify ne
   * les renseigne pas (cf. GET /api/products/:id/colors).
   */
  Editeur.prototype.teinterPastilles = function () {
    var self = this;
    if (this.iCouleur < 0) return;
    var shop = (window.Shopify && window.Shopify.shop) || window.location.hostname;
    fetch('https://textile-studio-production.up.railway.app/api/products/' + this.produit
          + '/colors?shop=' + encodeURIComponent(shop), { credentials: 'omit', mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.colors) return;
        var parNom = {};
        d.colors.forEach(function (c) { parNom[c.name] = c.hex; });
        self.mbar.querySelectorAll('.tsle-sw').forEach(function (sw) {
          var hex = parNom[sw.getAttribute('data-couleur')];
          if (hex) sw.style.background = hex;
        });
      })
      .catch(function () { /* pastilles sans teinte : le libellé reste en infobulle */ });
  };

  /**
   * Sélectionne un coloris. On passe par le sélecteur du thème quand on le
   * trouve, pour que le thème mette à jour SA galerie et SON prix ; l'URL
   * sert de repli et rend la sélection partageable.
   */
  Editeur.prototype.choisirCouleur = function (valeur, iCouleur) {
    var d = this.donnees;
    var actuel = this.variantCourant();
    var cible = null;
    d.variants.forEach(function (v) {
      if (cible || v.options[iCouleur] !== valeur) return;
      // Garder les autres options identiques si possible.
      var memeReste = !actuel || v.options.every(function (o, i) {
        return i === iCouleur || o === actuel.options[i];
      });
      if (memeReste) cible = v;
    });
    if (!cible) {
      d.variants.forEach(function (v) { if (!cible && v.options[iCouleur] === valeur) cible = v; });
    }
    if (!cible) return;

    var entree = document.querySelector('input[type="radio"][value="' + CSS_echap(valeur) + '"]');
    if (entree) { entree.click(); }
    else {
      var u = new URL(window.location.href);
      u.searchParams.set('variant', cible.id);
      window.history.replaceState(null, '', u.toString());
    }
    this.donnees.selected = cible.id;
    this.majPrix();
  };

  function CSS_echap(v) { return String(v).replace(/"/g, '\\"'); }

  // ── Prix dynamique ────────────────────────────────────────────────────────

  /**
   * Valeur sélectionnée pour une option, lue dans le sélecteur du thème.
   * On cherche par nom d'option plutôt que par une classe de thème : le nom
   * vient de Shopify et ne change pas, le balisage si.
   */
  function valeurOption(nom) {
    var motif = new RegExp('(^|[^a-z])' + nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)', 'i');
    var radios = document.querySelectorAll('input[type="radio"]:checked');
    for (var i = 0; i < radios.length; i++) {
      var n = (radios[i].name || '') + ' ' + (radios[i].getAttribute('data-option-name') || '');
      if (motif.test(n)) return radios[i].value;
    }
    var selects = document.querySelectorAll('select');
    for (var j = 0; j < selects.length; j++) {
      var m = (selects[j].name || '') + ' ' + (selects[j].getAttribute('data-option-name') || '');
      if (motif.test(m) && selects[j].value) return selects[j].value;
    }
    return null;
  }

  /**
   * Variante affichée.
   *
   * On interroge d'abord les options COCHÉES, et seulement ensuite l'URL.
   * S'appuyer sur `?variant=` paraissait plus simple, mais tous les thèmes
   * ne le mettent pas à jour — et quand il ne bouge pas, le prix reste figé
   * sur l'ancienne variante sans que rien ne le signale.
   */
  Editeur.prototype.variantCourant = function () {
    var d = this.donnees;
    var noms = d.optionNames || [];
    if (noms.length) {
      var choisies = noms.map(function (n) { return valeurOption(n); });
      if (choisies.every(function (v) { return v != null; })) {
        var parOptions = null;
        d.variants.forEach(function (v) {
          if (parOptions) return;
          var ok = choisies.every(function (val, i) { return String(v.options[i]) === String(val); });
          if (ok) parOptions = v;
        });
        if (parOptions) return parOptions;
      }
    }
    var id = null;
    try { id = new URL(window.location.href).searchParams.get('variant'); } catch (e) {}
    id = id || d.selected;
    var trouve = null;
    d.variants.forEach(function (v) { if (String(v.id) === String(id)) trouve = v; });
    return trouve || d.variants[0] || null;
  };

  Editeur.prototype.brancherPrix = function () {
    var self = this;
    this.boutonTheme = document.querySelector('form[action*="/cart/add"] [name="add"]')
                    || document.querySelector('form[action*="/cart/add"] button[type="submit"]');
    if (this.boutonTheme && !this.boutonTheme.__tsleLibelle) {
      this.boutonTheme.__tsleLibelle = (this.boutonTheme.textContent || '').trim();
    }
    this.majPrix();

    // Le thème change de variante de mille façons ; on surveille plutôt le
    // résultat (l'URL et les boutons cochés) que chaque mécanisme.
    ['change', 'click'].forEach(function (ev) {
      document.addEventListener(ev, function () { setTimeout(function () { self.majPrix(); }, 60); }, true);
    });
    window.addEventListener('popstate', function () { self.majPrix(); });
  };

  Editeur.prototype.majPrix = function () {
    var v = this.variantCourant();
    if (!v) return;
    var qte = 1;
    var champ = document.querySelector('form[action*="/cart/add"] [name="quantity"]');
    if (champ && Number(champ.value) > 0) qte = Number(champ.value);

    var montant = prix(v.price * qte, this.donnees.moneyFormat);
    var base = this.racine.getAttribute('data-tsl-cart-label') || 'Ajouter au panier';
    var libelle = base + ' — ' + montant;

    if (this.mbar) {
      var mc = this.mbar.querySelector('.tsle-mcart');
      if (mc && mc.textContent !== montant) { mc.textContent = montant; fondu(mc); }
    }
    if (this.boutonTheme) {
      var el = this.boutonTheme.querySelector('span') || this.boutonTheme;
      if (el.textContent.trim() !== libelle) { el.textContent = libelle; fondu(el); }
    }
    if (this.iCouleur >= 0 && this.mbar) {
      var actuelle = v.options[this.iCouleur];
      this.mbar.querySelectorAll('.tsle-sw').forEach(function (sw) {
        sw.setAttribute('aria-pressed', sw.getAttribute('data-couleur') === actuelle ? 'true' : 'false');
      });
    }
  };

  function fondu(el) {
    if (SOBRE) return;
    el.style.transition = 'opacity 140ms linear';
    el.style.opacity = '.35';
    setTimeout(function () { el.style.opacity = '1'; }, 140);
  }

  // ── Garde-fou taille ──────────────────────────────────────────────────────

  /**
   * Repère le bloc de tailles du thème, pour pouvoir le signaler quand le
   * client tente d'ajouter au panier sans avoir choisi.
   */
  Editeur.prototype.blocTaille = function () {
    var champs = document.querySelectorAll('input[type="radio"], select');
    for (var i = 0; i < champs.length; i++) {
      var n = (champs[i].name || '') + ' ' + (champs[i].getAttribute('data-option-name') || '');
      if (/taille|size/i.test(n)) {
        return champs[i].closest('fieldset, .product-form__input, .product-options, div') || champs[i];
      }
    }
    return null;
  };

  Editeur.prototype.tailleChoisie = function () {
    var d = this.donnees;
    var iTaille = -1;
    (d.optionNames || []).forEach(function (n, i) { if (/taille|size/i.test(n)) iTaille = i; });
    if (iTaille < 0) return true; // pas de dimension taille : rien à garder
    var radios = document.querySelectorAll('input[type="radio"]');
    var vus = 0, coches = 0;
    for (var i = 0; i < radios.length; i++) {
      if (!/taille|size/i.test(radios[i].name || '')) continue;
      vus++;
      if (radios[i].checked) coches++;
    }
    // Thème sans boutons radio identifiables : on ne bloque pas.
    return vus === 0 ? true : coches > 0;
  };

  Editeur.prototype.ajouterAuPanier = function () {
    if (!this.tailleChoisie()) {
      this.fermer();
      var bloc = this.blocTaille();
      if (bloc) {
        bloc.classList.add('tsle-alerte');
        bloc.scrollIntoView({ behavior: SOBRE ? 'auto' : 'smooth', block: 'center' });
        setTimeout(function () { bloc.classList.remove('tsle-alerte'); }, 2400);
      }
      return;
    }
    // Étape 1 : on délègue au formulaire du thème. Le circuit de commande
    // complet (composition, PNG HD, propriétés de ligne) viendra avec l'outil
    // Textes, qui est le premier à produire une composition.
    var form = document.querySelector('form[action*="/cart/add"]');
    if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
  };

  // ── Démarrage ─────────────────────────────────────────────────────────────

  function demarrer() {
    var blocs = document.querySelectorAll('[data-tsl-editor]');
    for (var i = 0; i < blocs.length; i++) {
      if (blocs[i].__tsleInit) continue;
      blocs[i].__tsleInit = true;
      styles();
      new Editeur(blocs[i]);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();
  document.addEventListener('shopify:section:load', demarrer);

  window.TSL_EDITOR = { refresh: demarrer };
})();
