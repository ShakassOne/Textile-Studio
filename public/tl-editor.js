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

  // Même littéral que tl-modal.js et tl-designs.js : l'App Proxy le remplace
  // par l'origin du backend réellement installé sur la boutique.
  var BACKEND = 'https://textile-studio-production.up.railway.app';

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
    + '.tsle-close{position:relative;z-index:2;flex:0 0 auto;width:40px;height:40px;border-radius:50%;border:0;'
    +   'background:transparent;color:inherit;font-size:24px;line-height:1;cursor:pointer;opacity:.7;'
    +   'pointer-events:auto;display:flex;align-items:center;justify-content:center}'
    + '.tsle-close:hover{opacity:1;background:rgba(128,128,128,.14)}'
    + '.tsle-body{padding:4px 18px 18px}'
    + '.tsle-panel{display:none}'
    + '.tsle-panel.on{display:block}'
    + '.tsle-vide{padding:26px 0;text-align:center;font-size:.85rem;opacity:.5}'
    + '.tsle-chargement{padding:26px 0;text-align:center;font-size:.85rem;opacity:.6}'

    // Calque d'édition posé SUR la photo produit. `pointer-events:none` tant
    // qu'aucun outil n'est ouvert : sans ça, Fabric capte les gestes tactiles
    // et bloque le défilement de la page — on ne peut plus lire la fiche.
    + '.tsle-scene{position:absolute;inset:0;z-index:5;pointer-events:none}'
    + '.tsle-scene.actif{pointer-events:auto}'
    + '.tsle-scene canvas{position:absolute;top:0;left:0}'
    + '.tsle-cadre{position:absolute;border:1px dashed rgba(0,0,0,.45);pointer-events:none;'
    +   'box-shadow:0 0 0 9999px rgba(255,255,255,.08)}'
    + '.tsle-scene:not(.actif) .tsle-cadre{display:none}'

    // Beaucoup de thèmes agrandissent la photo au SURVOL. Sur un canevas
    // d'édition c'est intenable : l'image bouge sous le curseur pendant
    // qu'on place un texte. On neutralise le survol, pas le clic — le zoom
    // en plein écran reste accessible.
    + '.tsle-sanszoom img:hover,.tsle-sanszoom:hover img,.tsle-sanszoom *:hover > img{'
    +   'transform:none!important;scale:none!important}'
    + '.tsle-sanszoom [style*="background-image"]:hover{transform:none!important}'

    // Panneau Textes
    + '.tsle-champ{display:block;margin-bottom:12px}'
    + '.tsle-champ > span{display:block;font-size:.76rem;opacity:.65;margin-bottom:5px}'
    + '.tsle-input,.tsle-select{width:100%;box-sizing:border-box;padding:11px 13px;font:inherit;font-size:.9rem;'
    +   'border:1px solid rgba(128,128,128,.4);border-radius:11px;background:transparent;color:inherit}'
    + '.tsle-rangee{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}'
    + '.tsle-rangee > *{flex:1 1 120px;min-width:0}'
    + '.tsle-groupe{display:flex;gap:4px}'
    + '.tsle-mini{flex:0 0 auto;min-width:40px;padding:10px 12px;border:1px solid rgba(128,128,128,.4);'
    +   'border-radius:11px;background:transparent;color:inherit;font:inherit;font-size:.9rem;cursor:pointer}'
    + '.tsle-mini[aria-pressed="true"]{background:var(--tsle-accent,#111114);color:var(--tsle-on-accent,#fff);'
    +   'border-color:var(--tsle-accent,#111114)}'
    + '.tsle-couleur{width:38px;height:38px;padding:2px;border:1px solid rgba(128,128,128,.4);border-radius:9px;'
    +   'background:transparent;cursor:pointer}'
    + '.tsle-compteur{font-size:.72rem;opacity:.5;text-align:right;margin-top:-8px;margin-bottom:10px}'
    + '.tsle-ajouter{width:100%;padding:13px;border:0;border-radius:12px;font:inherit;font-weight:600;'
    +   'background:var(--tsle-accent,#111114);color:var(--tsle-on-accent,#fff);cursor:pointer}'

    // Grille du formulaire. `auto-fit` plutôt qu'un nombre fixe de colonnes :
    // le tiroir va du bord gauche de la page au bord droit de la colonne, sa
    // largeur varie du simple au triple selon le thème et l'écran. À deux
    // colonnes figées, les champs s'étireraient en barres de 800 px.
    + '.tsle-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:15px 18px;align-items:end}'
    // Hauteur unique : la grille aligne le BAS des champs, et des contrôles
    // de hauteurs différentes font grimper les étiquettes en escalier.
    + '.tsle-grid .tsle-input,.tsle-grid .tsle-select,.tsle-grid .tsle-val,'
    +   '.tsle-grid .tsle-mini,.tsle-grid .tsle-chip,.tsle-grid .tsle-duo,'
    +   '.tsle-grid .tsle-seg,.tsle-grid .tsle-chips{height:42px}'
    + '.tsle-grid .tsle-pastille{width:42px;height:42px;flex:0 0 42px}'
    + '.tsle-grid .tsle-val{padding:0}'
    + '.tsle-grid .tsle-pastille,.tsle-grid .tsle-mini,.tsle-grid .tsle-chip{box-sizing:border-box}'
    + '.tsle-grid .tsle-mini,.tsle-grid .tsle-chip{display:inline-flex;align-items:center;justify-content:center;padding:0 14px}'
    + '.tsle-f{min-width:0}'
    + '.tsle-f.large{grid-column:1/-1}'
    + '.tsle-lab{display:block;font-size:.8rem;opacity:.7;margin-bottom:7px}'
    + '.tsle-wrap{position:relative}'
    + '.tsle-cpt{position:absolute;right:13px;top:50%;transform:translateY(-50%);'
    +   'font-size:.72rem;opacity:.45;pointer-events:none}'
    + '.tsle-seg{display:flex;gap:6px}'
    + '.tsle-seg > *{flex:1 1 0}'
    + '.tsle-duo{display:flex;gap:10px;align-items:center}'
    + '.tsle-rg{flex:1;min-width:60px;height:38px;accent-color:var(--tsle-accent,#111114);background:transparent}'
    + '.tsle-val{flex:0 0 76px;text-align:center;padding:10px 0;font:inherit;font-size:.85rem;'
    +   'border:1px solid rgba(128,128,128,.4);border-radius:11px;background:transparent;color:inherit}'
    // Pastille ronde : Chrome dessine une bordure interne au swatch qu'il
    // faut retirer, sinon le coin carré dépasse du cercle.
    + '.tsle-pastille{width:40px;height:40px;flex:0 0 40px;padding:0;border-radius:50%;cursor:pointer;'
    +   'border:1px solid rgba(128,128,128,.4);background:transparent;overflow:hidden}'
    + '.tsle-pastille::-webkit-color-swatch-wrapper{padding:0}'
    + '.tsle-pastille::-webkit-color-swatch{border:0;border-radius:50%}'
    + '.tsle-pastille::-moz-color-swatch{border:0;border-radius:50%}'
    + '.tsle-mini svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;'
    +   'stroke-linecap:round;display:block;margin:0 auto}'
    + '.tsle-chips{display:flex;gap:8px;flex-wrap:wrap}'
    + '.tsle-chip{padding:10px 15px;border-radius:11px;border:1px solid rgba(128,128,128,.4);'
    +   'background:transparent;color:inherit;font:inherit;font-size:.85rem;cursor:pointer;line-height:1.2}'
    + '.tsle-chip[aria-pressed="true"]{background:var(--tsle-accent,#111114);color:var(--tsle-on-accent,#fff);'
    +   'border-color:var(--tsle-accent,#111114)}'
    + '.tsle-sousbloc{display:none;grid-column:1/-1}'
    + '.tsle-sousbloc.on{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:15px 18px;align-items:end}'

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

  function boutique() {
    return (window.Shopify && window.Shopify.shop) || window._TL_SHOP || window.location.hostname;
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

    // La croix est branchée une seconde fois, sur le DOCUMENT et en phase de
    // CAPTURE : c'est le tout premier point où l'évènement passe. La
    // délégation ci-dessus suppose qu'il remonte jusqu'à nous, ce qu'un thème
    // qui arrête la propagation en chemin empêche. On écoute aussi
    // `pointerdown`, parce qu'un `preventDefault` posé là supprime le clic
    // qui aurait dû suivre.
    var fermerSi = function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (!self.racine.contains(t) || !t.closest('.tsle-close')) return;
      e.preventDefault(); e.stopPropagation();
      self.fermer();
    };
    document.addEventListener('pointerdown', fermerSi, true);
    document.addEventListener('click', fermerSi, true);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && self.outil) self.fermer();
    });

    // En positionnement fixe, le tiroir ne suit pas la page tout seul.
    var attendu = false;
    var suivre = function () {
      if (!self.outil || attendu) return;
      attendu = true;
      requestAnimationFrame(function () { attendu = false; if (self.outil) self.elargir(); });
    };
    window.addEventListener('scroll', suivre, { passive: true });
    window.addEventListener('resize', suivre);

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
      // Même mesure que le placement réel : inutile d'avertir quand le
      // tiroir trouve sa place.
      var section = self.sectionProduit();
      if (section) {
        var plafond = Math.max(self.bandeauHaut() + 8, MARGE,
                               Math.round(section.getBoundingClientRect().top));
        if (Math.round(self.barre.getBoundingClientRect().top) - 8 - plafond < HAUT_MIN) {
          console.info('[TSL] Pas assez de place au-dessus de la barre d\'outils : le '
            + 'tiroir s\'ouvrira vers le BAS et recouvrira les couleurs tant qu\'il est '
            + 'ouvert. Pour qu\'il monte et s\'arrête juste avant elles, descendez le '
            + 'bloc dans la colonne, entre le prix et le sélecteur de variante.');
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
      self.remplirPanneau(cle);
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
    // Le canevas redevient inerte : laissé actif, Fabric capte les gestes
    // tactiles et le client ne peut plus faire défiler la fiche produit.
    if (this.scene) this.scene.classList.remove('actif');
    if (this.moteur) this.moteur.canvas.discardActiveObject().requestRenderAll();
    // Rendre le tiroir à son ancrage CSS : laissé en fixe, il resterait
    // affiché par-dessus la page pendant l'animation de fermeture.
    var d = this.drawer;
    ['position', 'left', 'right', 'top', 'bottom', 'width', 'maxHeight', 'overflowY', 'zIndex']
      .forEach(function (p) { d.style[p] = ''; });
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
  /**
   * Section produit : le plus proche ancêtre qui contient AUSSI la photo.
   * C'est elle qui donne les marges de la page, donc le cadre dans lequel le
   * tiroir doit s'inscrire.
   */
  Editeur.prototype.sectionProduit = function () {
    var img = imageProduit();
    var n = this.racine.parentElement;
    while (n && n !== document.body) {
      if (!img || n.contains(img)) return n;
      n = n.parentElement;
    }
    return this.racine.parentElement;
  };

  var MARGE = 16;
  var HAUT_MIN = 300;

  /**
   * Bas du bandeau collé en haut de la fenêtre (en-tête du thème).
   *
   * Sans cette mesure, le tiroir se plaçait dans la bande occupée par
   * l'en-tête : à moitié recouvert, et surtout **la croix de fermeture
   * devenait incliquable** — les clics atterrissaient sur le logo du site,
   * qui est au-dessus dans l'ordre d'empilement. C'était la vraie cause du
   * « le bouton fermer ne marche pas ».
   */
  Editeur.prototype.bandeauHaut = function () {
    if (!document.elementsFromPoint) return 0;
    var self = this, bas = 0;
    [60, Math.round(window.innerWidth / 2), Math.max(60, window.innerWidth - 60)].forEach(function (x) {
      var els = document.elementsFromPoint(x, 2) || [];
      for (var k = 0; k < els.length; k++) {
        var e = els[k];
        if (!e || e === document.body || e === document.documentElement) continue;
        if (self.racine.contains(e)) continue;   // notre propre tiroir
        var p = getComputedStyle(e).position;
        if (p !== 'fixed' && p !== 'sticky') continue;
        var r = e.getBoundingClientRect();
        // Un bandeau, pas un calque plein écran : on ignore ce qui descend
        // au-delà du premier tiers de la fenêtre.
        if (r.top <= 2 && r.bottom > bas && r.bottom < window.innerHeight * 0.4) bas = r.bottom;
      }
    });
    return Math.round(bas);
  };

  /**
   * Haut du premier « séparateur » sous la barre : sélecteur de variante,
   * de couleur, ou à défaut le formulaire panier. C'est la limite basse
   * demandée — le tiroir ne doit pas recouvrir les couleurs.
   */
  var ARRETS = '[data-tsl-stop],variant-selects,variant-radios,.product-form__input,'
             + '.product-variant-picker,.product-form,form[action*="/cart/add"]';

  Editeur.prototype.arretBas = function (depuis) {
    var self = this, haut = 0;
    var cands = document.querySelectorAll(ARRETS);
    for (var k = 0; k < cands.length; k++) {
      var e = cands[k];
      if (self.racine.contains(e) || e.contains(self.racine)) continue;
      var r = e.getBoundingClientRect();
      if (r.height < 10) continue;
      if (r.top > depuis + 40 && (!haut || r.top < haut)) haut = r.top;
    }
    return Math.round(haut);
  };

  /**
   * Place le tiroir : jusqu'au bord gauche de la section, et dans le sens
   * où il y a la place.
   *
   * La maquette montre le tiroir qui MONTE depuis la barre d'outils : il
   * recouvre le titre et le prix, jamais les couleurs ni le panier. Ça ne
   * tient que si la barre est posée bas dans la colonne. Posée tout en
   * haut — le cas aujourd'hui sur le thème — il ne restait au-dessus que
   * la bande de l'en-tête : le tiroir s'y écrasait en bandeau inutilisable.
   * On choisit donc le sens selon la place réellement disponible.
   */
  Editeur.prototype.elargir = function () {
    var d = this.drawer;
    if (window.innerWidth < 768) {
      // Mobile : feuille pleine largeur pilotée par la CSS.
      ['position', 'left', 'right', 'top', 'bottom', 'width', 'maxHeight', 'overflowY', 'zIndex']
        .forEach(function (p) { d.style[p] = ''; });
      return;
    }
    var section = this.sectionProduit();
    if (!section) return;
    var rs = section.getBoundingClientRect();
    var rb = this.barre.getBoundingClientRect();

    // Positionnement FIXE et explicite plutôt qu'un décalage négatif depuis
    // le bloc : le tiroir déborde volontairement de la colonne d'infos, et
    // un ancêtre en overflow:hidden le rognerait sans prévenir.
    var gauche = Math.round(Math.max(MARGE, rs.left + MARGE));
    var droite = Math.round(Math.min(window.innerWidth - MARGE, rb.right));
    // Le tiroir s'étale vers la gauche, mais il s'arrête à la photo : c'est
    // elle qui montre le texte en place sur le vêtement, la recouvrir
    // reviendrait à personnaliser à l'aveugle. On ne déborde dessus que si
    // la colonne restante est trop étroite pour loger les réglages.
    var photo = imageProduit();
    if (photo) {
      var rp = photo.getBoundingClientRect();
      if (rp.right > rs.left && droite - rp.right >= 380) gauche = Math.round(rp.right) + MARGE;
    }
    d.style.position = 'fixed';
    // Au-dessus de l'en-tête du thème : c'est lui qui rendait la croix
    // incliquable.
    d.style.zIndex = '2147483000';
    d.style.left = gauche + 'px';
    d.style.right = 'auto';
    d.style.width = Math.max(300, droite - gauche) + 'px';
    d.style.overflowY = 'auto';

    var plafond = Math.max(this.bandeauHaut() + 8, MARGE, Math.round(rs.top));
    var placeDessus = Math.round(rb.top) - 8 - plafond;

    if (placeDessus >= HAUT_MIN) {
      // Le tiroir monte, comme sur la maquette.
      d.style.top = 'auto';
      d.style.bottom = Math.round(window.innerHeight - rb.top + 8) + 'px';
      d.style.maxHeight = placeDessus + 'px';
      return;
    }

    // Pas la place au-dessus : il descend. On s'arrête juste avant les
    // couleurs tant que ça laisse une hauteur exploitable — sinon un
    // tiroir de 150 px, correct sur le papier et inutilisable en vrai.
    var y = Math.round(rb.bottom + 8);
    var fond = window.innerHeight - MARGE;
    // On ne s'arrête avant les couleurs QUE si le panneau y tient en
    // entier. Sinon on préfère le recouvrir : un tiroir de 180 px où il
    // faut faire défiler pour atteindre un bouton n'est pas utilisable,
    // et il se referme d'un clic.
    var arret = this.arretBas(rb.bottom);
    var besoin = Math.max(HAUT_MIN, d.scrollHeight);
    if (arret && arret - 8 - y >= besoin) fond = arret - 8;
    d.style.bottom = 'auto';
    d.style.top = y + 'px';
    d.style.maxHeight = Math.max(HAUT_MIN, fond - y) + 'px';
  };

  /**
   * Place le tiroir. Le nom reste `ajuster` parce qu'il est appelé de
   * plusieurs endroits ; le travail, lui, est entièrement dans elargir().
   *
   * La version précédente poussait le bloc vers le bas pour faire de la
   * place au-dessus. Devenu inutile : le tiroir est maintenant positionné en
   * fixe et borné en hauteur, il ne déplace plus rien dans la page.
   */
  Editeur.prototype.ajuster = function () {
    this.racine.style.paddingTop = '';
    this.elargir();
  };

  /**
   * Remplit un panneau à sa première ouverture, et réveille la scène.
   *
   * Le contenu n'est construit qu'une fois : le reconstruire à chaque
   * ouverture perdrait la saisie en cours et ferait clignoter le tiroir.
   */
  Editeur.prototype.remplirPanneau = function (cle) {
    var self = this;
    var hote = this.drawer.querySelector('.tsle-panel[data-panneau="' + cle + '"]');
    if (!hote) return;

    if (cle === 'text') {
      if (!hote.__rempli) {
        hote.__rempli = true;
        hote.innerHTML = '<div class="tsle-chargement">Préparation de l\'éditeur…</div>';
        this.prepareScene().then(function () {
          self.panneauTexte(hote);
          self.ajuster();
          if (self.outil === 'text' && self.scene) self.scene.classList.add('actif');
        }).catch(function () {
          hote.innerHTML = '<div class="tsle-vide">Éditeur indisponible — rechargez la page.</div>';
        });
      } else if (this.scene) {
        this.scene.classList.add('actif');
      }
      return;
    }

    // Les autres outils restent à construire ; la scène se met en retrait
    // pour ne pas bloquer le défilement.
    if (this.scene) this.scene.classList.remove('actif');
  };

  // ── Panneau Textes ────────────────────────────────────────────────────────

  var POLICES = ['Montserrat', 'Bebas Neue', 'Oswald', 'Pacifico', 'Anton',
                 'Playfair Display', 'Poppins', 'Permanent Marker'];
  var MAX_CARACTERES = 60;

  var ALIGNES = {
    left:   'M4 6h16M4 10h10M4 14h16M4 18h10',
    center: 'M4 6h16M7 10h10M4 14h16M7 18h10',
    right:  'M4 6h16M10 10h10M4 14h16M10 18h10',
  };

  /** Petit bloc étiqueté de la grille. */
  function champ(label, contenu, large) {
    return '<div class="tsle-f' + (large ? ' large' : '') + '">'
         +   '<span class="tsle-lab">' + esc(label) + '</span>' + contenu + '</div>';
  }

  /** Curseur + case chiffrée, les deux synchronisés. */
  function curseur(r, min, max, val, pas) {
    return '<div class="tsle-duo">'
         +   '<input class="tsle-rg" data-r="' + r + '" type="range" min="' + min + '" max="' + max
         +     '" step="' + (pas || 1) + '" value="' + val + '">'
         +   '<input class="tsle-val" data-r="' + r + 'Val" type="number" min="' + min + '" max="' + max
         +     '" step="' + (pas || 1) + '" value="' + val + '">'
         + '</div>';
  }

  Editeur.prototype.panneauTexte = function (hote) {
    var self = this;
    hote.innerHTML =
        '<div class="tsle-grid">'
      + champ('Votre texte',
          '<div class="tsle-wrap">'
        +   '<input class="tsle-input" data-r="texte" maxlength="' + MAX_CARACTERES + '" '
        +     'placeholder="Winshirt" style="padding-right:58px">'
        +   '<span class="tsle-cpt" data-r="compteur">0/' + MAX_CARACTERES + '</span></div>', true)

      + champ('Police d\'écriture',
          '<select class="tsle-select" data-r="police">'
        + POLICES.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('')
        + '</select>')

      + champ('Style',
          '<div class="tsle-seg">'
        +   '<button type="button" class="tsle-mini" data-r="gras" aria-pressed="false"><b>B</b></button>'
        +   '<button type="button" class="tsle-mini" data-r="italique" aria-pressed="false"><i>I</i></button>'
        +   '<button type="button" class="tsle-mini" data-r="souligne" aria-pressed="false"><u>U</u></button>'
        + '</div>')

      + champ('Taille', curseur('taille', 5, 100, 40))

      + champ('Couleur du texte',
          '<input class="tsle-pastille" data-r="couleur" type="color" value="#111114">')

      + champ('Alignement',
          '<div class="tsle-seg">'
        + ['left', 'center', 'right'].map(function (a) {
            return '<button type="button" class="tsle-mini" data-r="al" data-v="' + a + '" '
                 +   'aria-pressed="' + (a === 'center' ? 'true' : 'false') + '" aria-label="' + a + '">'
                 +   '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ALIGNES[a] + '"/></svg>'
                 + '</button>';
          }).join('')
        + '</div>')

      + champ('Espacement des lettres', curseur('espacement', -50, 600, 0, 10))
      + champ('Opacité', curseur('opacite', 10, 100, 100))

      + champ('Effets',
          '<div class="tsle-chips">'
        +   '<button type="button" class="tsle-chip" data-r="contour" aria-pressed="false">Contour</button>'
        +   '<button type="button" class="tsle-chip" data-r="ombre" aria-pressed="false">Ombre</button>'
        + '</div>')

      // Réglages du contour : cachés tant que l'effet est éteint. Affichés en
      // permanence, ils occupaient deux cases de la grille pour rien.
      + '<div class="tsle-sousbloc" data-r="blocContour">'
      +   champ('Couleur du contour',
            '<input class="tsle-pastille" data-r="contourCouleur" type="color" value="#ffffff">')
      +   champ('Épaisseur du contour', curseur('contourEpaisseur', 1, 12, 3))
      + '</div>'

      + '</div>'
      + '<button type="button" class="tsle-ajouter" data-r="ajouter">Ajouter ce texte</button>';

    var q = function (r) { return hote.querySelector('[data-r="' + r + '"]'); };
    this._t = {
      texte: q('texte'), police: q('police'), taille: q('taille'),
      couleur: q('couleur'), compteur: q('compteur'), gras: q('gras'), italique: q('italique'),
    };

    // Saisie : on met à jour l'objet sélectionné s'il y en a un, sinon on
    // prépare simplement le prochain ajout. Pas de création automatique à la
    // frappe — un texte vide posé sur le vêtement dérouterait.
    q('texte').addEventListener('input', function () {
      self._t.compteur.textContent = this.value.length + '/' + MAX_CARACTERES;
      self.majTexteActif();
    });
    ['police', 'couleur', 'contourCouleur'].forEach(function (r) {
      var el = q(r);
      if (el) el.addEventListener('input', function () { self.majTexteActif(); });
    });

    // Curseur et case chiffrée : chacun recopie l'autre. C'est la case qui
    // permet une valeur exacte, et le curseur qui permet de chercher.
    ['taille', 'espacement', 'opacite', 'contourEpaisseur'].forEach(function (r) {
      var rg = q(r), va = q(r + 'Val');
      if (!rg || !va) return;
      rg.addEventListener('input', function () { va.value = rg.value; self.majTexteActif(); });
      va.addEventListener('input', function () {
        var n = Number(va.value);
        if (!isFinite(n)) return;
        n = Math.min(Number(rg.max), Math.max(Number(rg.min), n));
        rg.value = n;
        self.majTexteActif();
      });
    });

    hote.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.tsle-mini,.tsle-chip') : null;
      if (b) {
        if (b.getAttribute('data-r') === 'al') {
          hote.querySelectorAll('[data-r="al"]').forEach(function (x) {
            x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
          });
        } else {
          b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        }
        if (b.getAttribute('data-r') === 'contour') {
          var bloc = q('blocContour');
          if (bloc) bloc.classList.toggle('on', b.getAttribute('aria-pressed') === 'true');
          self.ajuster();
        }
        self.majTexteActif();
        return;
      }
      if (e.target.closest && e.target.closest('[data-r="ajouter"]')) self.ajouterTexte();
    });
  };

  /** Réglages courants du panneau. */
  Editeur.prototype._reglagesTexte = function () {
    var h = this.drawer;
    var al = h.querySelector('[data-r="al"][aria-pressed="true"]');
    var v = function (r, d) { var e = h.querySelector('[data-r="' + r + '"]'); return e ? e.value : d; };
    var p = function (r) {
      var e = h.querySelector('[data-r="' + r + '"]');
      return !!e && e.getAttribute('aria-pressed') === 'true';
    };
    return {
      texte:   this._t.texte.value || '',
      police:  this._t.police.value,
      taille:  Number(this._t.taille.value) || 40,
      couleur: this._t.couleur.value,
      gras:    this._t.gras.getAttribute('aria-pressed') === 'true',
      souligne: p('souligne'),
      italique: this._t.italique.getAttribute('aria-pressed') === 'true',
      align:   al ? al.getAttribute('data-v') : 'center',
      espacement: Number(v('espacement', 0)) || 0,
      opacite: (Number(v('opacite', 100)) || 100) / 100,
      contour: p('contour'),
      contourCouleur: v('contourCouleur', '#ffffff'),
      contourEpaisseur: Number(v('contourEpaisseur', 3)) || 3,
      ombre: p('ombre'),
    };
  };

  Editeur.prototype.ajouterTexte = function () {
    var self = this;
    var r = this._reglagesTexte();
    if (!r.texte.trim()) { this._t.texte.focus(); return; }
    this.prepareScene().then(function () {
      if (!self.moteur) return;
      self.scene.classList.add('actif');
      var obj = self.moteur.ajouterTexte(r.texte, {
        fontFamily: r.police, fill: r.couleur,
        fontSize: Math.max(8, Math.round(self.moteur.zone.h * (r.taille / 100))),
      });
        self._appliquerStyle(obj, r);
      self.moteur._centrer(obj);
      self.moteur.canvas.requestRenderAll();
      self.chargerPolice(r.police);
    });
  };

  /**
   * Applique tous les réglages de style à un objet texte.
   *
   * Factorisé parce que l'ajout et la modification doivent produire
   * EXACTEMENT le même résultat : deux chemins séparés finiraient par
   * diverger, et le client verrait son texte changer en le retouchant.
   */
  Editeur.prototype._appliquerStyle = function (o, r) {
    o.set({
      fontFamily: r.police,
      fill: r.couleur,
      fontWeight: r.gras ? 'bold' : 'normal',
      fontStyle: r.italique ? 'italic' : 'normal',
      underline: !!r.souligne,
      textAlign: r.align,
      charSpacing: r.espacement,
      opacity: r.opacite,
      stroke: r.contour ? r.contourCouleur : null,
      strokeWidth: r.contour ? r.contourEpaisseur : 0,
      // Le contour se dessine SOUS le remplissage : dessiné par-dessus, il
      // ronge l'intérieur des lettres et les rend illisibles en petit corps.
      paintFirst: 'stroke',
      shadow: r.ombre ? new window.fabric.Shadow({
        color: 'rgba(0,0,0,.45)', blur: Math.max(2, r.taille / 6),
        offsetX: Math.max(1, r.taille / 14), offsetY: Math.max(1, r.taille / 14),
      }) : null,
    });
  };

  /** Met à jour le texte sélectionné, s'il y en a un. */
  Editeur.prototype.majTexteActif = function () {
    if (!this.moteur) return;
    var o = this.moteur.canvas.getActiveObject();
    if (!o || o.__tslType !== 'text') return;
    var r = this._reglagesTexte();
    o.set({ text: r.texte || o.text });
    this._appliquerStyle(o, r);
    var cible = Math.max(8, Math.round(this.moteur.zone.h * (r.taille / 100)));
    o.set({ scaleX: 1, scaleY: 1, fontSize: cible });
    this.moteur.canvas.requestRenderAll();
    this.chargerPolice(r.police);
  };

  /**
   * Charge une police Google pour le rendu à l'écran.
   * Le serveur a la sienne pour le fichier d'impression ; ici il s'agit
   * seulement que le client voie ce qu'il choisit.
   */
  Editeur.prototype.chargerPolice = function (nom) {
    if (!nom) return;
    this._polices = this._polices || {};
    if (this._polices[nom]) return;
    this._polices[nom] = true;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family='
           + encodeURIComponent(nom).replace(/%20/g, '+') + ':wght@400;700&display=swap';
    document.head.appendChild(l);
    var self = this;
    // Fabric mesure le texte avant que la police soit prête : on redessine
    // une fois chargée, sinon la première frappe s'affiche dans une autre
    // police et saute.
    if (document.fonts && document.fonts.load) {
      document.fonts.load('16px "' + nom + '"').then(function () {
        if (self.moteur) self.moteur.canvas.requestRenderAll();
      }).catch(function () {});
    }
  };

  // ── Scène d'édition ───────────────────────────────────────────────────────
  //
  // Le canevas se pose SUR la photo du produit, à l'endroit exact où le
  // design s'imprimera. La zone vient de la calibration faite en admin
  // (product_display_zone) : on en prend le rectangle englobant, parce qu'un
  // canevas ne sait pas s'éditer en perspective. Le léger biais de la photo
  // est rétabli au rendu serveur, qui lui projette dans le quadrilatère.
  //
  // Fabric n'est chargé qu'au premier clic sur un outil : l'embarquer sur
  // chaque fiche produit coûterait 300 Ko à tous les visiteurs, y compris
  // ceux qui ne personnalisent rien.

  var FABRIC = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js';

  function charger(src) {
    return new Promise(function (ok, ko) {
      if ([].slice.call(document.scripts).some(function (s) { return s.src === src; })) return ok();
      var e = document.createElement('script');
      e.src = src; e.onload = ok; e.onerror = function () { ko(new Error('chargement : ' + src)); };
      document.head.appendChild(e);
    });
  }

  /** Image principale du produit — la plus grande de la page, hors nos vignettes. */
  function imageProduit() {
    var imgs = document.querySelectorAll('img');
    var meilleure = null, aire = 0;
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].closest('.tsle') || imgs[i].closest('.tsld')) continue;
      var r = imgs[i].getBoundingClientRect();
      var a = r.width * r.height;
      if (a > 40000 && a > aire) { aire = a; meilleure = imgs[i]; }
    }
    return meilleure;
  }

  Editeur.prototype.prepareScene = function () {
    var self = this;
    if (this._scenePrete) return this._scenePrete;

    this._scenePrete = Promise.all([
      charger(FABRIC).then(function () { return charger(BACKEND + '/tsl-engine.js'); }),
      fetch(BACKEND + '/api/products/' + this.produit + '/display-zone?shop='
            + encodeURIComponent(boutique()), { credentials: 'omit', mode: 'cors' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }),
    ]).then(function (res) {
      self.zoneCalibree = res[1] && res[1].exists ? res[1] : null;
      return self._monterCanvas();
    });
    return this._scenePrete;
  };

  Editeur.prototype._monterCanvas = function () {
    var img = imageProduit();
    if (!img || !window.fabric || !window.TSLEngine) return null;

    var hote = img.parentElement;
    if (getComputedStyle(hote).position === 'static') hote.style.position = 'relative';

    var scene = document.createElement('div');
    scene.className = 'tsle-scene';
    var cnv = document.createElement('canvas');
    scene.appendChild(cnv);
    var cadre = document.createElement('div');
    cadre.className = 'tsle-cadre';
    scene.appendChild(cadre);
    hote.appendChild(scene);

    this.scene = scene;
    this.cadre = cadre;
    this.imageProduit = img;
    hote.classList.add('tsle-sanszoom');

    var dims = this._dimensions();
    cnv.width = dims.largeur; cnv.height = dims.hauteur;
    this.moteur = new window.TSLEngine.Moteur(cnv, { zone: dims.zone });
    this._placerCadre(dims.zone);

    // La photo change de taille (chargement, redimensionnement, variante) :
    // le canevas et la zone doivent suivre, sinon le design dérive.
    var self = this;
    var suivre = function () {
      var d = self._dimensions();
      self.moteur.canvas.setDimensions({ width: d.largeur, height: d.hauteur });
      self.moteur.definirZone(d.zone);
      self._placerCadre(d.zone);
    };
    window.addEventListener('resize', suivre);
    if (window.ResizeObserver) new ResizeObserver(suivre).observe(img);
    return this.moteur;
  };

  /** Taille du canevas et zone d'édition, en pixels de la photo affichée. */
  Editeur.prototype._dimensions = function () {
    var r = this.imageProduit.getBoundingClientRect();
    var largeur = Math.max(1, Math.round(r.width));
    var hauteur = Math.max(1, Math.round(r.height));

    var coins = this.zoneCalibree && this.zoneCalibree.corners;
    if (!coins || coins.length !== 4) {
      // Produit non calibré : zone par défaut au centre, pour que l'outil
      // reste utilisable plutôt que de refuser de s'ouvrir.
      return { largeur: largeur, hauteur: hauteur,
               zone: { x: largeur * 0.3, y: hauteur * 0.25, w: largeur * 0.4, h: hauteur * 0.4 } };
    }
    // Rectangle englobant du quadrilatère calibré : un canevas ne s'édite
    // pas en perspective, la projection exacte est faite au rendu serveur.
    var xs = coins.map(function (c) { return c.x / 100 * largeur; });
    var ys = coins.map(function (c) { return c.y / 100 * hauteur; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    return { largeur: largeur, hauteur: hauteur,
             zone: { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) } };
  };

  Editeur.prototype._placerCadre = function (z) {
    if (!this.cadre) return;
    this.cadre.style.left = z.x + 'px';
    this.cadre.style.top = z.y + 'px';
    this.cadre.style.width = z.w + 'px';
    this.cadre.style.height = z.h + 'px';
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
