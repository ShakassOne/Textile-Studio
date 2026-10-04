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
    + '.tsle-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:15px 18px;align-items:end}'
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

    // Panneau Images
    + '.tsle-depot{display:flex;flex-direction:column;align-items:center;gap:6px;padding:22px 16px;text-align:center;'
    +   'border:2px dashed rgba(128,128,128,.4);border-radius:14px;cursor:pointer;'
    +   'transition:border-color .18s,background .18s}'
    + '.tsle-depot:hover,.tsle-depot.survol{border-color:var(--tsle-accent,#111114);background:rgba(128,128,128,.08)}'
    + '.tsle-depot svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:1.6;'
    +   'stroke-linecap:round;stroke-linejoin:round;opacity:.7}'
    + '.tsle-depot b{font-size:.9rem}'
    + '.tsle-depot span{font-size:.76rem;opacity:.55}'
    + '.tsle-sep{display:flex;align-items:center;gap:12px;margin:16px 0 12px;font-size:.78rem;opacity:.55}'
    + '.tsle-sep::before,.tsle-sep::after{content:"";flex:1;height:1px;background:rgba(128,128,128,.3)}'
    + '.tsle-biblio{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px}'
    + '.tsle-vignette{position:relative;aspect-ratio:1;border:1px solid rgba(128,128,128,.28);border-radius:11px;'
    +   'background:rgba(128,128,128,.07);padding:6px;cursor:pointer;overflow:hidden}'
    + '.tsle-vignette img{width:100%;height:100%;object-fit:contain;display:block}'
    + '.tsle-vignette:hover{border-color:var(--tsle-accent,#111114)}'
    + '.tsle-vignette b{position:absolute;left:0;right:0;bottom:0;padding:3px 5px;font-size:.66rem;font-weight:500;'
    +   'background:rgba(0,0,0,.55);color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'

    // Panneaux IA et QR
    + '.tsle-zone{width:100%;box-sizing:border-box;min-height:74px;resize:vertical;padding:11px 13px;font:inherit;'
    +   'font-size:.9rem;border:1px solid rgba(128,128,128,.4);border-radius:11px;background:transparent;color:inherit}'
    + '.tsle-note{font-size:.8rem;margin:12px 0;padding:10px 12px;border-radius:10px;background:rgba(128,128,128,.13)}'
    + '.tsle-note.err{background:rgba(220,38,38,.15)}'
    + '.tsle-ajouter[disabled]{opacity:.5;cursor:progress}'
    + '.tsle-qr{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}'
    + '.tsle-qr-apercu{flex:0 0 150px;width:150px;height:150px;display:flex;align-items:center;'
    +   'justify-content:center;border:1px solid rgba(128,128,128,.28);border-radius:12px;background:#fff;padding:8px}'
    + '.tsle-qr-apercu canvas,.tsle-qr-apercu img{max-width:100%;max-height:100%}'
    + '.tsle-qr-reglages{flex:1 1 250px;min-width:0}'

    // Panneau Calques
    + '.tsle-deux > div{min-width:0}'
    + '.tsle-drawer.large .tsle-deux{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;align-items:start}'
    + '.tsle-drawer.large .tsle-deux > div + div:not(.tsle-pleine){padding-left:24px;'
    +   'border-left:1px solid rgba(128,128,128,.22)}'
    + '.tsle-drawer.large .tsle-pleine{grid-column:1/-1}'
    + '.tsle-entete{display:flex;flex-direction:column;gap:2px;padding:10px 13px;border-radius:11px;'
    +   'background:rgba(128,128,128,.12)}'
    + '.tsle-entete b{font-size:.88rem}'
    + '.tsle-entete span{font-size:.76rem;opacity:.6}'
    + '.tsle-aide{font-size:.76rem;opacity:.6;line-height:1.5;margin-top:7px}'
    + '.tsle-conseils{display:flex;flex-direction:column;gap:5px;font-size:.78rem;opacity:.65}'
    + '.tsle-conseils span::before{content:"\\2713";margin-right:7px;opacity:.8}'
    // Habillage retenu : le contour seul ne se voit pas sur une vignette
    // claire, d'où le fond plein.
    + '.tsle-vignette[aria-pressed="true"]{border-color:var(--tsle-accent,#111114);'
    +   'box-shadow:inset 0 0 0 2px var(--tsle-accent,#111114)}'
    + '.tsle-calques{display:flex;flex-direction:column;gap:8px}'
    + '.tsle-calque{display:flex;align-items:center;gap:10px;padding:8px 10px;'
    +   'border:1px solid rgba(128,128,128,.28);border-radius:11px}'
    + '.tsle-calque.masque{opacity:.45}'
    + '.tsle-calque-vue{flex:0 0 36px;width:36px;height:36px;border-radius:8px;background:rgba(128,128,128,.12);'
    +   'display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:.72rem}'
    + '.tsle-calque-vue img{width:100%;height:100%;object-fit:contain}'
    + '.tsle-calque{cursor:pointer}'
    + '.tsle-calque.verrouille{opacity:.6}'
    + '.tsle-calque.choisi{border-color:var(--tsle-accent,#111114);'
    +   'box-shadow:inset 0 0 0 1px var(--tsle-accent,#111114)}'
    + '.tsle-calque-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}'
    + '.tsle-calque-txt b{font-size:.85rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.tsle-calque-txt i{font-style:normal;font-size:.7rem;opacity:.5}'
    + '.tsle-lettre{width:100%;height:100%;display:flex;align-items:center;justify-content:center;'
    +   'font-size:1rem;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.5)}'
    // Barre d'actions : elles portent sur le calque sélectionné, comme au
    // studio. Grisées tant qu'aucun n'est choisi — sans ça on clique dans
    // le vide sans comprendre pourquoi rien ne se passe.
    + '.tsle-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}'
    + '.tsle-action{display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 4px;'
    +   'border:1px solid rgba(128,128,128,.35);border-radius:11px;background:transparent;color:inherit;'
    +   'font:inherit;font-size:.72rem;cursor:pointer}'
    + '.tsle-action svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;'
    +   'stroke-linecap:round;stroke-linejoin:round}'
    + '.tsle-action:hover:not([disabled]){background:rgba(128,128,128,.12)}'
    + '.tsle-action[disabled]{opacity:.35;cursor:default}'
    + '.tsle-action.danger{color:#dc2626;border-color:rgba(220,38,38,.45)}'
    + '.tsle-ico{flex:0 0 auto;width:32px;height:32px;border:0;border-radius:8px;background:transparent;'
    +   'color:inherit;cursor:pointer;opacity:.65;display:inline-flex;align-items:center;justify-content:center}'
    + '.tsle-ico:hover:not([disabled]){opacity:1;background:rgba(128,128,128,.14)}'
    + '.tsle-ico[disabled]{opacity:.2;cursor:default}'
    + '.tsle-ico svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;'
    +   'stroke-linecap:round;stroke-linejoin:round}'
    + '.tsle-sousbloc{display:none;grid-column:1/-1}'
    + '.tsle-sousbloc.on{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:15px 18px;align-items:end}'

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
    this.brancherPanier();

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
    var largeur = Math.max(300, droite - gauche);
    d.style.width = largeur + 'px';
    d.style.overflowY = 'auto';
    // Au-delà de cette largeur, les panneaux passent sur deux colonnes :
    // une mise en page verticale dans un tiroir de 700 px laisse la moitié
    // de la surface vide et oblige à faire défiler pour rien. Le seuil
    // dépend du TIROIR, pas de la fenêtre — une requête de média ne saurait
    // pas le mesurer.
    d.classList.toggle('large', largeur >= 760);

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
    // Rien à placer tant que le tiroir est fermé : le panneau Calques se
    // reconstruit au gré du canevas, y compris quand il n'est pas affiché.
    if (!this.outil) return;
    this.racine.style.paddingTop = '';
    this.elargir();
  };

  /**
   * Remplit un panneau à sa première ouverture, et réveille la scène.
   *
   * Le contenu n'est construit qu'une fois : le reconstruire à chaque
   * ouverture perdrait la saisie en cours et ferait clignoter le tiroir.
   */
  var BATISSEURS = {
    text:   'panneauTexte',
    image:  'panneauImages',
    ai:     'panneauIA',
    qr:     'panneauQR',
    layers: 'panneauCalques',
  };

  Editeur.prototype.remplirPanneau = function (cle) {
    var self = this;
    var hote = this.drawer.querySelector('.tsle-panel[data-panneau="' + cle + '"]');
    var batisseur = BATISSEURS[cle];
    if (!hote || !batisseur) {
      if (this.scene) this.scene.classList.remove('actif');
      return;
    }

    if (hote.__rempli) {
      if (this.scene) this.scene.classList.add('actif');
      // Certains panneaux reflètent l'état du canevas (les calques) : ils se
      // remettent à jour à chaque ouverture, sans être reconstruits — ça
      // perdrait la saisie en cours dans les autres.
      if (hote.__maj) hote.__maj();
      return;
    }

    hote.__rempli = true;
    hote.innerHTML = '<div class="tsle-chargement">Préparation de l\'éditeur…</div>';
    this.prepareScene().then(function () {
      self[batisseur](hote);
      self.ajuster();
      if (self.outil === cle && self.scene) self.scene.classList.add('actif');
    }).catch(function () {
      // Rouvrir doit pouvoir réessayer : une coupure réseau passagère ne
      // doit pas condamner l'outil pour le reste de la visite.
      hote.__rempli = false;
      hote.innerHTML = '<div class="tsle-vide">Éditeur indisponible — rechargez la page.</div>';
    });
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

  // ── Outils communs aux panneaux ───────────────────────────────────────────

  /** Message éphémère dans le tiroir, sous l'en-tête. */
  Editeur.prototype._message = function (txt, erreur) {
    var corps = this.drawer.querySelector('.tsle-body');
    var n = corps.querySelector('.tsle-note.volatile');
    if (!n) {
      n = document.createElement('div');
      n.className = 'tsle-note volatile';
      corps.insertBefore(n, corps.firstChild);
    }
    n.classList.toggle('err', !!erreur);
    n.textContent = txt;
    clearTimeout(this._minuteurNote);
    var self = this;
    this._minuteurNote = setTimeout(function () {
      if (n.parentNode) n.parentNode.removeChild(n);
      self.ajuster();
    }, erreur ? 6000 : 3000);
    this.ajuster();
  };

  /**
   * Identifiant de navigateur, partagé avec le studio.
   *
   * Même clé de stockage : le quota IA d'un visiteur non connecté doit être
   * le même qu'il génère depuis la fiche produit ou depuis le studio, sinon
   * il lui suffit de changer d'écran pour le remettre à zéro.
   */
  function visiteur() {
    try {
      var v = localStorage.getItem('tl_visitor_id');
      if (!v) {
        v = (window.crypto && crypto.randomUUID ? crypto.randomUUID()
             : String(Date.now()) + Math.random().toString(36).slice(2))
              .replace(/[^a-z0-9-]/gi, '').toLowerCase().slice(0, 40);
        localStorage.setItem('tl_visitor_id', v);
      }
      return v;
    } catch (e) { return 'anonyme-sans-stockage'; }
  }

  /**
   * Jeton d'identité signé du client connecté.
   *
   * L'éditeur tourne sur le domaine de la boutique : l'App Proxy est donc
   * joignable en relatif, et c'est Shopify qui signe la requête. C'est ce
   * jeton qui débloque le quota IA réservé aux clients.
   */
  var _jeton = null;
  function jetonClient() {
    if (_jeton !== null) return Promise.resolve(_jeton);
    return fetch('/apps/textilelab/whoami', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { _jeton = (d && d.loggedIn && d.token) ? d.token : ''; return _jeton; })
      .catch(function () { _jeton = ''; return _jeton; });
  }

  /** En-têtes des appels IA : boutique, identité, navigateur. */
  function enTetesIA(jeton) {
    var h = { 'Content-Type': 'application/json', 'X-Shop-Domain': boutique() };
    if (jeton) h['X-TL-Customer'] = jeton;
    h['X-TL-Visitor'] = visiteur();
    return h;
  }

  /**
   * Réduit une image trop grande avant de la poser sur le canevas.
   *
   * Une photo de téléphone fait 4000 px de large : conservée telle quelle
   * elle est recopiée en base64 dans la composition, qui part en base de
   * données. 2000 px suffisent largement pour une impression A3 à 150 dpi.
   */
  function reduire(src, max) {
    return new Promise(function (ok) {
      // Le SVG n'a pas de résolution propre : le pixelliser serait une perte.
      if (/^data:image\/svg/i.test(src)) return ok(src);
      var im = new Image();
      im.onload = function () {
        var e = Math.min(1, max / Math.max(im.width || 1, im.height || 1));
        if (e >= 1) return ok(src);
        var c = document.createElement('canvas');
        c.width = Math.round(im.width * e);
        c.height = Math.round(im.height * e);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        ok(c.toDataURL('image/png'));
      };
      im.onerror = function () { ok(src); };
      im.src = src;
    });
  }

  /** Pose une image sur le canevas, quel que soit le panneau d'origine. */
  Editeur.prototype.poserImage = function (src, nom) {
    var self = this;
    return this.prepareScene().then(function () {
      if (!self.moteur) return null;
      self.scene.classList.add('actif');
      return new Promise(function (ok) {
        self.moteur.ajouterImage(src, function (img) {
          if (!img) self._message('Image illisible.', true);
          else self._message('Ajouté au visuel : ' + (nom || 'image') + '.');
          ok(img);
        });
      });
    });
  };

  // ── Panneau Images ────────────────────────────────────────────────────────

  var MAX_FICHIER = 10 * 1024 * 1024;

  Editeur.prototype.panneauImages = function (hote) {
    var self = this;
    hote.innerHTML =
        '<div class="tsle-deux"><div>'
      + '<div class="tsle-depot" data-r="depot" tabindex="0" role="button">'
      +   '<svg viewBox="0 0 24 24" aria-hidden="true">'
      +     '<path d="M12 16V4m0 0 4 4m-4-4L8 8"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'
      +   '</svg>'
      +   '<b>Cliquez ou glissez une image</b>'
      +   '<span>PNG, JPG, SVG ou WEBP — 10 Mo maximum</span>'
      + '</div>'
      + '<input type="file" accept="image/*" data-r="fichier" style="display:none">'
      + '<div class="tsle-chips" style="margin-top:10px">'
      +   '<button type="button" class="tsle-chip" data-r="parcourir" style="flex:1">Parcourir</button>'
      +   '<button type="button" class="tsle-chip" data-r="detourer" style="flex:1">Détourer le fond</button>'
      + '</div>'

      // Réglage du détourage : affiché seulement pendant l'opération. La
      // tolérance se juge à l'œil, d'où le curseur plutôt qu'un seuil figé.
      + '<div class="tsle-sousbloc" data-r="blocFond" style="margin-top:12px">'
      +   '<div class="tsle-f" style="grid-column:1/-1">'
      +     '<span class="tsle-lab">Tolérance du détourage</span>'
      +     '<div class="tsle-duo">'
      +       '<input class="tsle-rg" data-r="fondTol" type="range" min="0" max="100" value="25">'
      +       '<input class="tsle-val" data-r="fondTolVal" type="number" min="0" max="100" value="25">'
      +       '<button type="button" class="tsle-chip" data-r="fondReset">Restaurer</button>'
      +     '</div>'
      +   '</div>'
      + '</div>'

      + '<div class="tsle-sep">conseils</div>'
      + '<div class="tsle-conseils">'
      +   '<span>PNG à fond transparent recommandé</span>'
      +   '<span>300 dpi minimum pour une impression nette</span>'
      +   '<span>Format carré pour le meilleur rendu</span>'
      + '</div>'
      + '</div><div>'
      + '<div class="tsle-sep">ou choisissez un design</div>'
      + '<div class="tsle-chips" data-r="categories" style="margin-bottom:12px;display:none"></div>'
      + '<div class="tsle-biblio" data-r="biblio">'
      +   '<div class="tsle-chargement">Chargement de la bibliothèque…</div></div>'
      + '</div></div>';

    var depot = hote.querySelector('[data-r="depot"]');
    var input = hote.querySelector('[data-r="fichier"]');

    depot.addEventListener('click', function () { input.click(); });
    depot.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    ['dragenter', 'dragover'].forEach(function (t) {
      depot.addEventListener(t, function (e) { e.preventDefault(); depot.classList.add('survol'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      depot.addEventListener(t, function (e) { e.preventDefault(); depot.classList.remove('survol'); });
    });
    depot.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) self.recevoirFichier(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', function () {
      self.recevoirFichier(input.files[0]);
      // Réinitialiser : sans ça, reprendre le MÊME fichier (le même logo au
      // recto puis au verso) ne déclenche pas l'évènement.
      input.value = '';
    });

    hote.querySelector('[data-r="parcourir"]').addEventListener('click', function () { input.click(); });
    hote.querySelector('[data-r="detourer"]').addEventListener('click', function () { self.ouvrirDetourage(hote); });
    hote.querySelector('[data-r="fondReset"]').addEventListener('click', function () { self.restaurerFond(hote); });

    var tol = hote.querySelector('[data-r="fondTol"]');
    var tolVal = hote.querySelector('[data-r="fondTolVal"]');
    var appliquer = function (v) {
      clearTimeout(self._minuteurFond);
      self._minuteurFond = setTimeout(function () { self.detourer(Number(v)); }, 150);
    };
    tol.addEventListener('input', function () { tolVal.value = tol.value; appliquer(tol.value); });
    tolVal.addEventListener('input', function () {
      var n = Math.min(100, Math.max(0, Number(tolVal.value) || 0));
      tol.value = n; appliquer(n);
    });

    this.chargerBibliotheque(hote);
  };

  Editeur.prototype.recevoirFichier = function (f) {
    var self = this;
    if (!f) return;
    if (!/^image\//.test(f.type)) return this._message('Ce fichier n\'est pas une image.', true);
    if (f.size > MAX_FICHIER) return this._message('Image trop lourde — 10 Mo maximum.', true);
    var fr = new FileReader();
    fr.onload = function () {
      reduire(fr.result, 2000).then(function (src) { self.poserImage(src, f.name); });
    };
    fr.onerror = function () { self._message('Lecture du fichier impossible.', true); };
    fr.readAsDataURL(f);
  };

  // ── Détourage du fond ─────────────────────────────────────────────────────
  //
  // Même algorithme que le studio, volontairement : un visuel détouré dans
  // l'éditeur de la fiche produit et le même visuel détouré dans le studio
  // doivent donner exactement la même découpe.

  /** Remplissage par diffusion depuis les bords, sur la couleur des coins. */
  function detourerPixels(imageData, tolerance) {
    var data = imageData.data, width = imageData.width, height = imageData.height;
    var idx = function (x, y) { return (y * width + x) * 4; };
    var vus = new Uint8Array(width * height);

    // Couleur du fond échantillonnée sur les quatre coins : c'est la seule
    // hypothèse raisonnable sans demander au client de la désigner.
    var coins = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
    var r = 0, g = 0, b = 0, n = 0;
    coins.forEach(function (c) {
      var i = idx(c[0], c[1]);
      if (data[i + 3] > 10) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    });
    if (!n) return;
    var fr = r / n, fg = g / n, fb = b / n;

    var proche = function (x, y) {
      var i = idx(x, y);
      if (data[i + 3] < 10) return true;
      return (Math.abs(data[i] - fr) + Math.abs(data[i + 1] - fg) + Math.abs(data[i + 2] - fb)) / 3 <= tolerance;
    };

    var depart = [
      [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1],
      [Math.floor(width / 2), 0], [Math.floor(width / 2), height - 1],
      [0, Math.floor(height / 2)], [width - 1, Math.floor(height / 2)],
    ];
    depart.forEach(function (d) {
      if (!proche(d[0], d[1])) return;
      var file = [d];
      while (file.length) {
        var p = file.pop(), x = p[0], y = p[1];
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        var vi = y * width + x;
        if (vus[vi] || !proche(x, y)) continue;
        vus[vi] = 1;
        data[idx(x, y) + 3] = 0;
        file.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
    });
  }

  Editeur.prototype.imageActive = function () {
    if (!this.moteur) return null;
    var o = this.moteur.canvas.getActiveObject();
    return (o && o.__tslType === 'image') ? o : null;
  };

  Editeur.prototype.ouvrirDetourage = function (hote) {
    var o = this.imageActive();
    if (!o) return this._message('Sélectionnez d\'abord une image sur le produit.', true);
    // L'original est conservé : chaque réglage repart de lui, sinon on
    // détourerait un visuel déjà détouré et le résultat se dégraderait.
    if (!o.__tslFondOrigine) {
      var el = o.getElement();
      var c = document.createElement('canvas');
      c.width = el.naturalWidth || el.width || o.width;
      c.height = el.naturalHeight || el.height || o.height;
      c.getContext('2d').drawImage(el, 0, 0);
      try { o.__tslFondOrigine = c.toDataURL('image/png'); }
      catch (e) { return this._message('Ce visuel vient d\'un autre domaine : le détourage est impossible.', true); }
    }
    hote.querySelector('[data-r="blocFond"]').classList.add('on');
    this.ajuster();
    this.detourer(Number(hote.querySelector('[data-r="fondTol"]').value) || 25);
  };

  Editeur.prototype.detourer = function (valeur) {
    var self = this;
    var o = this.imageActive();
    if (!o || !o.__tslFondOrigine) return;
    // Progression quadratique : le curseur reste utile sur toute sa course,
    // là où une échelle linéaire ne sert vraiment que dans ses dix premiers
    // pour cent.
    var tolerance = Math.round((valeur / 100) * (valeur / 100) * 55);
    var im = new Image();
    im.onload = function () {
      var c = document.createElement('canvas');
      c.width = im.width; c.height = im.height;
      var ctx = c.getContext('2d');
      ctx.drawImage(im, 0, 0);
      if (tolerance > 0) {
        var d = ctx.getImageData(0, 0, c.width, c.height);
        detourerPixels(d, tolerance);
        ctx.putImageData(d, 0, 0);
      }
      var neuf = new Image();
      neuf.onload = function () { o.setElement(neuf); self.moteur.canvas.requestRenderAll(); };
      neuf.src = c.toDataURL('image/png');
    };
    im.src = o.__tslFondOrigine;
  };

  Editeur.prototype.restaurerFond = function (hote) {
    var self = this;
    var o = this.imageActive();
    if (!o || !o.__tslFondOrigine) return;
    var neuf = new Image();
    neuf.onload = function () { o.setElement(neuf); self.moteur.canvas.requestRenderAll(); };
    neuf.src = o.__tslFondOrigine;
    hote.querySelector('[data-r="fondTol"]').value = 0;
    hote.querySelector('[data-r="fondTolVal"]').value = 0;
  };

  /**
   * Bibliothèque du produit, filtrée par catégorie.
   *
   * On passe par /products/:id/designs et non par le catalogue complet :
   * cette route a déjà écarté les visuels exclus pour ce support et ceux
   * dont la définition est insuffisante pour la zone d'impression.
   */
  Editeur.prototype.chargerBibliotheque = function (hote) {
    var self = this;
    var grille = hote.querySelector('[data-r="biblio"]');
    var cats = hote.querySelector('[data-r="categories"]');

    fetch(BACKEND + '/api/products/' + this.produit + '/designs?shop='
          + encodeURIComponent(boutique()), { credentials: 'omit', mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var liste = (d && d.designs) || [];
        if (!liste.length) {
          grille.innerHTML = '<div class="tsle-vide">Aucun design disponible pour ce produit.</div>';
          return;
        }
        self._visuels = liste;

        var categories = (d.categories || []).filter(Boolean);
        if (categories.length > 1) {
          cats.innerHTML = '<button type="button" class="tsle-chip" data-cat="" aria-pressed="true">'
                         + 'Tout</button>'
            + categories.map(function (c) {
                return '<button type="button" class="tsle-chip" data-cat="' + esc(c) + '" '
                     +   'aria-pressed="false">' + esc(c) + '</button>';
              }).join('');
          cats.style.display = '';
          cats.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('.tsle-chip') : null;
            if (!b) return;
            cats.querySelectorAll('.tsle-chip').forEach(function (x) {
              x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
            });
            self.afficherVisuels(grille, b.getAttribute('data-cat'));
          });
        }

        self.afficherVisuels(grille, '');
        grille.addEventListener('click', function (e) {
          var b = e.target.closest ? e.target.closest('.tsle-vignette') : null;
          if (b) self.poserImage(b.getAttribute('data-url'), b.getAttribute('data-nom'));
        });
      })
      .catch(function () {
        grille.innerHTML = '<div class="tsle-vide">Bibliothèque indisponible.</div>';
      });
  };

  Editeur.prototype.afficherVisuels = function (grille, categorie) {
    var liste = (this._visuels || []).filter(function (v) {
      return !categorie || v.categorie === categorie;
    });
    grille.innerHTML = liste.length
      ? liste.map(function (v) {
          return '<button type="button" class="tsle-vignette" data-url="' + esc(v.url) + '" '
               +   'data-nom="' + esc(v.nom || '') + '" title="' + esc(v.nom || '') + '">'
               +   '<img src="' + esc(v.thumb || v.url) + '" alt="' + esc(v.nom || '') + '" loading="lazy">'
               +   (v.nom ? '<b>' + esc(v.nom) + '</b>' : '')
               + '</button>';
        }).join('')
      : '<div class="tsle-vide">Aucun design dans cette catégorie.</div>';
    this.ajuster();
  };

  // ── Panneau IA ────────────────────────────────────────────────────────────
  //
  // Mêmes réglages que l'onglet IA du studio, sans ajout : en-tête, photo de
  // départ facultative, description, génération, quota, galerie. Le style
  // n'est pas une liste mais une question posée au moment de générer — et
  // seulement si la description n'en mentionne aucun, comme au studio.

  var MOTS_STYLE = /\b(style|esth[ée]tique|vibe|look|fa[çc]on|mani[èe]re|inspir[ée]|comme un[e]?|cartoon|manga|anime|chibi|disney|pixar|aquarelle|watercolor|r[ée]aliste|photoreal|minimal|minimaliste|vintage|r[ée]tro|streetwear|graffiti|sketch|crayonn[ée]|sticker|caricature|lego|3d|pixel\s?art|cyberpunk|gothique|n[ée]on|bd|bande\s?dessin[ée]e|comic|pop\s?art|surr[ée]aliste|fantasy|peinture|gravure|tatouage|tattoo|geometric|g[ée]om[ée]trique|tribal|kawaii|gothic|baroque)\b/i;

  Editeur.prototype.panneauIA = function (hote) {
    var self = this;

    hote.innerHTML =
        '<div class="tsle-deux"><div>'
      + '<div class="tsle-entete">'
      +   '<b>GPT Image</b><span>Génération d\'images par intelligence artificielle</span>'
      + '</div>'

      // Photo de départ : avec elle on passe par /transform, qui retravaille
      // l'image fournie ; sans elle par /dalle, qui crée de zéro. C'est la
      // même bascule que dans le studio.
      + '<span class="tsle-lab" style="margin-top:14px">Photo de départ'
      +   '<i style="font-style:normal;opacity:.6"> — facultatif</i></span>'
      + '<div class="tsle-depot" data-r="photoZone" tabindex="0" role="button">'
      +   '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/>'
      +     '<circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 20"/></svg>'
      +   '<b>Ajouter une photo à transformer</b>'
      +   '<span>Sans photo, l\'IA crée le design de zéro</span>'
      + '</div>'
      + '<div data-r="photoVue" style="display:none;margin-top:10px">'
      +   '<img data-r="photoApercu" alt="" style="width:100%;max-height:150px;object-fit:contain;'
      +     'border-radius:10px;display:block">'
      +   '<div class="tsle-chips" style="margin-top:8px">'
      +     '<button type="button" class="tsle-chip" data-r="photoChanger" style="flex:1">Changer</button>'
      +     '<button type="button" class="tsle-chip" data-r="photoRetirer" style="flex:1">Retirer</button>'
      +   '</div>'
      + '</div>'
      + '<input type="file" accept="image/*" data-r="photoFichier" style="display:none">'
      + '</div><div>'

      + '<span class="tsle-lab">Description</span>'
      + '<textarea class="tsle-zone" data-r="prompt" rows="3" maxlength="400" '
      +   'placeholder="Ex : dragon stylisé avec flammes, en aquarelle, fond blanc…"></textarea>'
      + '<div class="tsle-aide">Décrivez librement ce que vous voulez. Précisez le style si vous '
      +   'en avez un en tête (cartoon, vintage, minimaliste, manga…) — sinon on vous le demandera.</div>'

      // La question du style, posée seulement si la description n'en parle
      // pas. Dans le studio c'est une fenêtre par-dessus la page ; ici elle
      // reste dans le tiroir — poser un calque plein écran sur la boutique
      // d'un marchand pour une question facultative serait disproportionné.
      + '<div class="tsle-sousbloc" data-r="blocStyle" style="margin-top:12px">'
      +   '<div class="tsle-f" style="grid-column:1/-1">'
      +     '<span class="tsle-lab">Quel style visuel ?</span>'
      +     '<input class="tsle-input" data-r="style" placeholder="Style facultatif — cartoon, vintage, manga…">'
      +     '<div class="tsle-chips" style="margin-top:10px">'
      +       '<button type="button" class="tsle-chip" data-r="styleSans" style="flex:1">'
      +         'Sans style particulier</button>'
      +       '<button type="button" class="tsle-chip" data-r="styleOk" style="flex:1">Générer</button>'
      +     '</div>'
      +   '</div>'
      + '</div>'

      + '<button type="button" class="tsle-ajouter" data-r="generer" style="margin-top:12px">'
      +   'Générer le design</button>'
      + '<div class="tsle-note" data-r="quota" style="display:none"></div>'
      + '</div>'
      + '<div class="tsle-pleine">'
      +   '<div class="tsle-sep" data-r="sepRes" style="display:none">vos générations</div>'
      +   '<div class="tsle-biblio" data-r="resultats"></div>'
      + '</div></div>';

    var photoInput = hote.querySelector('[data-r="photoFichier"]');
    var zone = hote.querySelector('[data-r="photoZone"]');
    zone.addEventListener('click', function () { photoInput.click(); });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); photoInput.click(); }
    });
    ['dragenter', 'dragover'].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('survol'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.remove('survol'); });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) self.recevoirPhotoIA(hote, e.dataTransfer.files[0]);
    });
    photoInput.addEventListener('change', function () {
      self.recevoirPhotoIA(hote, photoInput.files[0]);
      photoInput.value = '';
    });
    hote.querySelector('[data-r="photoChanger"]').addEventListener('click', function () { photoInput.click(); });
    hote.querySelector('[data-r="photoRetirer"]').addEventListener('click', function () {
      self.retirerPhotoIA(hote);
    });

    hote.querySelector('[data-r="generer"]').addEventListener('click', function () {
      self.demanderStylePuisGenerer(hote);
    });
    hote.querySelector('[data-r="styleSans"]').addEventListener('click', function () {
      hote.querySelector('[data-r="style"]').value = '';
      self.genererIA(hote, '');
    });
    hote.querySelector('[data-r="styleOk"]').addEventListener('click', function () {
      self.genererIA(hote, (hote.querySelector('[data-r="style"]').value || '').trim());
    });
    hote.querySelector('[data-r="style"]').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); self.genererIA(hote, (this.value || '').trim()); }
    });

    this.majQuotaIA(hote);
  };

  /**
   * Génère — en demandant d'abord le style si la description n'en nomme pas.
   * Avec une photo de départ, la consigne du client EST le style : on ne lui
   * redemande rien.
   */
  Editeur.prototype.demanderStylePuisGenerer = function (hote) {
    var champTexte = hote.querySelector('[data-r="prompt"]');
    var demande = (champTexte.value || '').trim();
    if (!demande) { champTexte.focus(); return; }

    var bloc = hote.querySelector('[data-r="blocStyle"]');
    if (this._photoIA || MOTS_STYLE.test(demande) || bloc.classList.contains('on')) {
      return this.genererIA(hote, (hote.querySelector('[data-r="style"]').value || '').trim());
    }
    bloc.classList.add('on');
    this.ajuster();
    try { hote.querySelector('[data-r="style"]').focus(); } catch (e) {}
  };

  Editeur.prototype.recevoirPhotoIA = function (hote, f) {
    var self = this;
    if (!f) return;
    if (!/^image\//.test(f.type)) return this._message('Ce fichier n\'est pas une image.', true);
    var fr = new FileReader();
    fr.onload = function () {
      // Même réduction qu'à l'import : une photo de téléphone brute part
      // sinon en base64 dans le corps de la requête.
      reduire(fr.result, 1024).then(function (src) {
        self._photoIA = src;
        hote.querySelector('[data-r="photoApercu"]').src = src;
        hote.querySelector('[data-r="photoVue"]').style.display = '';
        hote.querySelector('[data-r="photoZone"]').style.display = 'none';
        self.ajuster();
      });
    };
    fr.readAsDataURL(f);
  };

  Editeur.prototype.retirerPhotoIA = function (hote) {
    this._photoIA = null;
    hote.querySelector('[data-r="photoVue"]').style.display = 'none';
    hote.querySelector('[data-r="photoZone"]').style.display = '';
    this.ajuster();
  };

  Editeur.prototype.majQuotaIA = function (hote, etat) {
    var n = hote.querySelector('[data-r="quota"]');
    var montrer = function (q) {
      if (!q || typeof q.limit !== 'number' || !q.limit) return;
      var reste = typeof q.remaining === 'number' ? q.remaining : Math.max(0, q.limit - (q.used || 0));
      n.style.display = '';
      n.textContent = reste > 0
        ? reste + ' génération' + (reste > 1 ? 's' : '') + ' restante' + (reste > 1 ? 's' : '')
          + ' sur ' + q.limit + '.'
        : 'Vous avez utilisé vos ' + q.limit + ' générations.'
          + (q.needsLogin ? ' Connectez-vous à votre compte pour en obtenir davantage.' : '');
    };
    if (etat) return montrer(etat);
    jetonClient().then(function (jeton) {
      return fetch(BACKEND + '/api/ai/quota?shop=' + encodeURIComponent(boutique()),
                   { headers: enTetesIA(jeton), credentials: 'omit', mode: 'cors' });
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(montrer).catch(function () {});
  };

  Editeur.prototype.genererIA = function (hote, style) {
    var self = this;
    var champTexte = hote.querySelector('[data-r="prompt"]');
    var demande = (champTexte.value || '').trim();
    if (!demande) { champTexte.focus(); return; }

    hote.querySelector('[data-r="blocStyle"]').classList.remove('on');

    var btn = hote.querySelector('[data-r="generer"]');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Génération en cours…';
    var fini = function () { btn.disabled = false; btn.textContent = 'Générer le design'; self.ajuster(); };

    var photo = this._photoIA;
    var chemin, corps;
    if (photo) {
      chemin = '/api/ai/transform';
      corps = { imageBase64: photo, prompt: demande, style: 'cartoon' };
    } else {
      chemin = '/api/ai/dalle';
      // Même enrobage que le studio : la même description doit donner le
      // même visuel, d'où qu'elle parte.
      corps = {
        prompt: 'T-shirt print design' + (style ? ', ' + style + ' style' : '') + ': ' + demande
              + '. White background, transparent-ready, bold graphic, print-ready, '
              + 'no text unless explicitly requested.',
        size: '1024x1024',
      };
    }

    jetonClient().then(function (jeton) {
      return fetch(BACKEND + chemin + '?shop=' + encodeURIComponent(boutique()), {
        method: 'POST', headers: enTetesIA(jeton), credentials: 'omit', mode: 'cors',
        body: JSON.stringify(corps),
      });
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, d: d }; });
    }).then(function (res) {
      if (!res.ok || !res.d || res.d.error) {
        self._message((res.d && res.d.error) || 'La génération a échoué.', true);
        return fini();
      }
      var src = res.d.base64 || res.d.url;
      if (!src) { self._message('Aucune image retournée.', true); return fini(); }
      self.ajouterResultatIA(hote, src, demande);
      self.poserImage(src, 'Visuel IA');
      // Le pool « Vos créations IA » du back-office : même soumission que
      // depuis le studio, sinon les générations faites ici n'y remontent pas.
      jetonClient().then(function (jeton) {
        fetch(BACKEND + '/api/ai/creations?shop=' + encodeURIComponent(boutique()), {
          method: 'POST', headers: enTetesIA(jeton), credentials: 'omit', mode: 'cors',
          body: JSON.stringify({ image_base64: src, prompt: demande + (style ? ' — ' + style : '') }),
        }).catch(function () {});
      });
      if (res.d.quota) self.majQuotaIA(hote, res.d.quota);
      else self.majQuotaIA(hote);
      fini();
    }).catch(function () {
      self._message('Service indisponible — réessayez dans un instant.', true);
      fini();
    });
  };

  /** Garde les générations de la session sous la main : elles sont payantes. */
  Editeur.prototype.ajouterResultatIA = function (hote, src, titre) {
    var self = this;
    var grille = hote.querySelector('[data-r="resultats"]');
    hote.querySelector('[data-r="sepRes"]').style.display = '';
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tsle-vignette';
    b.title = titre || '';
    b.innerHTML = '<img src="' + esc(src) + '" alt="' + esc(titre || '') + '">';
    b.addEventListener('click', function () { self.poserImage(src, 'Visuel IA'); });
    grille.insertBefore(b, grille.firstChild);
    this.ajuster();
  };

  // ── Panneau QR code ───────────────────────────────────────────────────────

  var QRLIB = 'https://cdn.jsdelivr.net/npm/qr-code-styling@1.5.0/lib/qr-code-styling.js';
  var QR_PX = 600;          // définition du QR posé sur le vêtement
  var QR_DANS_CADRE = 0.55; // part du cadre occupée par le code, comme au studio

  var RACCOURCIS_QR = [
    { t: 'Site web',  v: 'https://' },
    { t: 'WhatsApp',  v: 'https://wa.me/' },
    { t: 'Instagram', v: 'https://instagram.com/' },
    { t: 'vCard',     v: 'BEGIN:VCARD\nVERSION:3.0\nFN:' },
    { t: 'E-mail',    v: 'mailto:' },
  ];

  var SENS_DEGRADE = [
    { v: '0',      t: 'Horizontal' },
    { v: '1.5708', t: 'Vertical' },
    { v: '0.7854', t: 'Diagonale' },
    { v: '2.3562', t: 'Diagonale inverse' },
  ];

  Editeur.prototype.panneauQR = function (hote) {
    var self = this;
    hote.innerHTML =
        '<div class="tsle-deux"><div>'
      + '<span class="tsle-lab">Contenu du QR code</span>'
      + '<input class="tsle-input" data-r="contenu" value="https://" placeholder="https://winshirt.fr">'
      + '<div class="tsle-chips" data-r="raccourcis" style="margin-top:10px">'
      +   RACCOURCIS_QR.map(function (r) {
          return '<button type="button" class="tsle-chip" data-prefixe="' + esc(r.v) + '">'
               + esc(r.t) + '</button>';
        }).join('')
      + '</div>'

      + '<div class="tsle-sep">personnalisation</div>'
      + '<div class="tsle-grid">'
      +   champ('Couleur du code', '<input class="tsle-pastille" data-r="qrCouleur" type="color" value="#111114">')
      +   '<div class="tsle-f" data-r="blocCouleur2" style="display:none">'
      +     '<span class="tsle-lab">Seconde couleur</span>'
      +     '<input class="tsle-pastille" data-r="qrCouleur2" type="color" value="#777788">'
      +   '</div>'
      +   champ('Fond', '<input class="tsle-pastille" data-r="qrFond" type="color" value="#ffffff">')
      +   champ('Options', '<div class="tsle-chips">'
      +     '<button type="button" class="tsle-chip" data-r="qrTransparent" aria-pressed="true">'
      +       'Fond transparent</button>'
      +     '<button type="button" class="tsle-chip" data-r="qrDegrade" aria-pressed="false">'
      +       'Dégradé</button></div>')
      +   '<div class="tsle-f" data-r="blocSens" style="display:none">'
      +     '<span class="tsle-lab">Sens du dégradé</span>'
      +     '<select class="tsle-select" data-r="qrSens">'
      +       SENS_DEGRADE.map(function (s) {
              return '<option value="' + s.v + '">' + esc(s.t) + '</option>';
            }).join('')
      +     '</select>'
      +   '</div>'
      + '</div>'

      + '</div><div>'
      + '<div class="tsle-sep">aperçu</div>'
      + '<div class="tsle-qr-apercu" data-r="apercu"><span class="tsle-chargement">…</span></div>'
      + '<div data-r="blocCadres" style="display:none">'
      +   '<div class="tsle-sep">habillage</div>'
      +   '<div class="tsle-chips" style="margin-bottom:10px">'
      +     '<button type="button" class="tsle-chip" data-r="qrLie" aria-pressed="true">'
      +       'Lier le code et son habillage</button>'
      +   '</div>'
      +   '<div class="tsle-biblio" data-r="cadres"></div>'
      + '</div>'
      + '</div>'
      + '<div class="tsle-pleine">'
      +   '<button type="button" class="tsle-ajouter" data-r="qrAjouter" style="margin-top:14px">'
      +     'Ajouter ce QR code</button>'
      + '</div></div>';

    var apercu = hote.querySelector('[data-r="apercu"]');
    charger(QRLIB).then(function () {
      apercu.innerHTML = '';
      self._qr = new window.QRCodeStyling(self.optionsQR(hote));
      self._qr.append(apercu);
      self.majQR(hote);
    }).catch(function () {
      apercu.innerHTML = '<span class="tsle-vide">Aperçu indisponible</span>';
    });

    ['contenu', 'qrCouleur', 'qrCouleur2', 'qrFond', 'qrSens'].forEach(function (r) {
      var el = hote.querySelector('[data-r="' + r + '"]');
      if (el) el.addEventListener('input', function () { self.majQR(hote); });
      if (el && el.tagName === 'SELECT') el.addEventListener('change', function () { self.majQR(hote); });
    });

    hote.addEventListener('click', function (e) {
      var cible = e.target.closest ? e.target : null;
      if (!cible) return;

      var raccourci = cible.closest('[data-prefixe]');
      if (raccourci) {
        var champTexte = hote.querySelector('[data-r="contenu"]');
        champTexte.value = raccourci.getAttribute('data-prefixe');
        champTexte.focus();
        try { champTexte.setSelectionRange(champTexte.value.length, champTexte.value.length); } catch (x) {}
        self.majQR(hote);
        return;
      }

      var bascule = cible.closest('[data-r="qrTransparent"],[data-r="qrDegrade"],[data-r="qrLie"]');
      if (bascule) {
        var on = bascule.getAttribute('aria-pressed') !== 'true';
        bascule.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (bascule.getAttribute('data-r') === 'qrDegrade') {
          hote.querySelector('[data-r="blocCouleur2"]').style.display = on ? '' : 'none';
          hote.querySelector('[data-r="blocSens"]').style.display = on ? '' : 'none';
          self.ajuster();
        }
        self.majQR(hote);
        return;
      }

      var cadre = cible.closest('.tsle-vignette[data-cadre]');
      if (cadre) {
        var actif = cadre.getAttribute('aria-pressed') === 'true';
        hote.querySelectorAll('.tsle-vignette[data-cadre]').forEach(function (x) {
          x.setAttribute('aria-pressed', 'false');
        });
        cadre.setAttribute('aria-pressed', actif ? 'false' : 'true');
        self._cadreQR = actif ? null : cadre.getAttribute('data-cadre');
        return;
      }

      if (cible.closest('[data-r="qrAjouter"]')) self.poserQR(hote);
    });

    this.chargerCadresQR(hote);
  };

  Editeur.prototype.optionsQR = function (hote, taille) {
    var lire = function (r) { var e = hote.querySelector('[data-r="' + r + '"]'); return e ? e.value : ''; };
    var actif = function (r) {
      var e = hote.querySelector('[data-r="' + r + '"]');
      return !!e && e.getAttribute('aria-pressed') === 'true';
    };
    var contenu = (lire('contenu') || '').trim() || 'https://winshirt.fr';
    var couleur = lire('qrCouleur') || '#111114';
    // `gradient: undefined` n'est pas équivalent à l'absence de clé pour
    // qr-code-styling : on ne pose que celle qui s'applique.
    var points = { type: 'rounded' };
    if (actif('qrDegrade')) {
      points.gradient = {
        type: 'linear', rotation: Number(lire('qrSens')) || 0,
        colorStops: [{ offset: 0, color: couleur },
                     { offset: 1, color: lire('qrCouleur2') || '#777788' }],
      };
    } else {
      points.color = couleur;
    }

    return {
      width: taille || 240, height: taille || 240, type: 'canvas', data: contenu,
      dotsOptions:          points,
      cornersSquareOptions: { color: couleur, type: 'extra-rounded' },
      cornersDotOptions:    { color: couleur, type: 'dot' },
      backgroundOptions:    { color: actif('qrTransparent') ? 'rgba(0,0,0,0)' : (lire('qrFond') || '#ffffff') },
      // Correction « M » : un code imprimé sur du tissu souple se lit mal,
      // il faut de la redondance sans pour autant densifier les modules.
      qrOptions:            { errorCorrectionLevel: 'M' },
    };
  };

  Editeur.prototype.majQR = function (hote) {
    if (this._qr) this._qr.update(this.optionsQR(hote));
  };

  Editeur.prototype.chargerCadresQR = function (hote) {
    var self = this;
    fetch(BACKEND + '/api/qr-frames/public?shop=' + encodeURIComponent(boutique()),
          { credentials: 'omit', mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var liste = (d && d.frames) || [];
        if (!liste.length) return;
        hote.querySelector('[data-r="cadres"]').innerHTML = liste.map(function (c) {
          var u = /^https?:/.test(c.image_url) ? c.image_url : BACKEND + c.image_url;
          return '<button type="button" class="tsle-vignette" data-cadre="' + esc(u) + '" '
               +   'aria-pressed="false" title="' + esc(c.name || '') + '">'
               +   '<img src="' + esc(u) + '" alt="' + esc(c.name || '') + '" loading="lazy"></button>';
        }).join('');
        hote.querySelector('[data-r="blocCadres"]').style.display = '';
        self.ajuster();
      }).catch(function () {});
  };

  /**
   * Pose le QR code, seul ou avec son habillage.
   *
   * « Lié » fusionne les deux en UNE image, là où le studio en fait un
   * groupe Fabric. C'est volontaire : la composition n'enregistre que des
   * textes et des images, et c'est elle qui sert à reconstruire le fichier
   * d'impression — un groupe s'y perdrait. Délié, ce sont deux calques
   * séparés, déplaçables indépendamment, exactement comme au studio.
   */
  Editeur.prototype.poserQR = function (hote) {
    var self = this;
    if (!this._qr) return;
    var champTexte = hote.querySelector('[data-r="contenu"]');
    var contenu = (champTexte.value || '').trim();
    if (!contenu || contenu === 'https://' || contenu === 'mailto:') {
      champTexte.focus();
      return this._message('Indiquez le lien ou le texte à encoder.', true);
    }
    var lie = hote.querySelector('[data-r="qrLie"]');
    var lier = !lie || lie.getAttribute('aria-pressed') === 'true';

    // Le QR est regénéré à la définition d'impression : l'aperçu de 240 px
    // posé sur un A3 donnerait un code baveux.
    var hd = new window.QRCodeStyling(this.optionsQR(hote, QR_PX));
    hd.getRawData('png').then(function (blob) {
      return new Promise(function (ok) {
        var fr = new FileReader();
        fr.onload = function () { ok(fr.result); };
        fr.readAsDataURL(blob);
      });
    }).then(function (qrSrc) {
      if (!self._cadreQR) return self.poserImage(qrSrc, 'QR code');
      if (lier) {
        return fusionnerCadre(self._cadreQR, qrSrc)
          .catch(function () { return qrSrc; })
          .then(function (src) { return self.poserImage(src, 'QR code'); });
      }
      return self.poserImage(self._cadreQR, 'Habillage')
        .then(function () { return self.poserImage(qrSrc, 'QR code'); });
    }).catch(function () {
      self._message('Génération du QR code impossible.', true);
    });
  };

  /** Dessine le QR au centre de son habillage et renvoie une image unique. */
  function fusionnerCadre(cadreUrl, qrSrc) {
    return new Promise(function (ok, ko) {
      var cadre = new Image();
      cadre.crossOrigin = 'anonymous';
      cadre.onerror = function () { ko(new Error('habillage illisible')); };
      cadre.onload = function () {
        var qr = new Image();
        qr.onerror = function () { ko(new Error('QR illisible')); };
        qr.onload = function () {
          var c = document.createElement('canvas');
          c.width = cadre.naturalWidth || 800;
          c.height = cadre.naturalHeight || 800;
          var ctx = c.getContext('2d');
          ctx.drawImage(cadre, 0, 0, c.width, c.height);
          var t = Math.round(Math.min(c.width, c.height) * QR_DANS_CADRE);
          ctx.drawImage(qr, Math.round((c.width - t) / 2), Math.round((c.height - t) / 2), t, t);
          ok(c.toDataURL('image/png'));
        };
        qr.src = qrSrc;
      };
      cadre.src = cadreUrl;
    });
  }

  // ── Panneau Calques ───────────────────────────────────────────────────────
  //
  // Mêmes commandes que le studio : on choisit un calque dans la liste, le
  // verrou est sur sa ligne, et les quatre actions (dupliquer, renommer,
  // monter, supprimer) portent sur celui qui est sélectionné.

  var ACTIONS_CALQUE = [
    { a: 'copier',  t: 'Dupliquer', i: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>' },
    { a: 'nommer',  t: 'Renommer',  i: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>' },
    { a: 'monter',  t: 'Monter',    i: '<path d="M12 19V5m0 0-6 6m6-6 6 6"/>' },
    { a: 'jeter',   t: 'Supprimer', i: '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/>' },
  ];
  var CADENAS = {
    libre:  '<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    ferme:  '<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  };

  Editeur.prototype.panneauCalques = function (hote) {
    var self = this;
    hote.innerHTML =
        '<div class="tsle-calques" data-r="calques"></div>'
      + '<div class="tsle-actions" data-r="actions">'
      +   ACTIONS_CALQUE.map(function (x) {
          return '<button type="button" class="tsle-action' + (x.a === 'jeter' ? ' danger' : '') + '" '
               +   'data-act="' + x.a + '" disabled>'
               +   '<svg viewBox="0 0 24 24" aria-hidden="true">' + x.i + '</svg>'
               +   '<span>' + x.t + '</span></button>';
        }).join('')
      + '</div>';

    hote.addEventListener('click', function (e) {
      if (!self.moteur) return;

      var action = e.target.closest ? e.target.closest('.tsle-action') : null;
      if (action) {
        if (action.disabled) return;
        var choisi = self.moteur.canvas.getActiveObject();
        if (!choisi) return;
        var id = choisi.__tslId;
        var a = action.getAttribute('data-act');
        if (a === 'copier') self.dupliquerCalque(id);
        else if (a === 'nommer') self.renommerCalque(id);
        else if (a === 'monter') self.deplacerCalque(id, 1);
        else if (a === 'jeter') self.moteur.supprimer(id);
        self.majCalques(hote);
        return;
      }

      var ligne = e.target.closest('.tsle-calque');
      if (!ligne) return;
      var cle = ligne.getAttribute('data-id');
      if (e.target.closest('.tsle-ico')) self.moteur.basculerVerrou(cle);
      else self.selectionnerCalque(cle);
      self.majCalques(hote);
    });

    // Reconstruire la liste dès que le canevas change : un texte ajouté
    // depuis le panneau Textes doit apparaître ici sans rouvrir l'outil.
    if (this.moteur && !this._ecouteCalques) {
      this._ecouteCalques = true;
      var maj = function () { self.majCalques(hote); };
      ['object:added', 'object:removed', 'object:modified',
       'selection:created', 'selection:updated', 'selection:cleared'].forEach(function (ev) {
        self.moteur.canvas.on(ev, maj);
      });
    }

    hote.__maj = function () { self.majCalques(hote); };
    this.majCalques(hote);
  };

  Editeur.prototype.objetParId = function (id) {
    var trouve = null;
    this.moteur.objets().forEach(function (o) { if (o.__tslId === id) trouve = o; });
    return trouve;
  };

  Editeur.prototype.selectionnerCalque = function (id) {
    var o = this.objetParId(id);
    if (!o || o.selectable === false) return;
    this.moteur.canvas.setActiveObject(o).requestRenderAll();
  };

  Editeur.prototype.dupliquerCalque = function (id) {
    var self = this;
    var o = this.objetParId(id);
    if (!o) return;
    o.clone(function (copie) {
      copie.set({ left: (o.left || 0) + 12, top: (o.top || 0) + 12 });
      copie.__tslType = o.__tslType;
      copie.__customName = o.__customName;
      // Un identifiant neuf : deux calques qui partagent le même id
      // deviennent impossibles à supprimer ou réordonner séparément.
      copie.__tslId = 'c' + Math.random().toString(36).slice(2, 9);
      self.moteur.canvas.add(copie).setActiveObject(copie);
      self.moteur.canvas.requestRenderAll();
    }, ['__tslId', '__tslType', '__customName']);
  };

  Editeur.prototype.renommerCalque = function (id) {
    var o = this.objetParId(id);
    if (!o) return;
    var nom = window.prompt('Nom du calque :', o.__customName || '');
    if (nom === null) return;
    o.__customName = nom.trim();
  };

  Editeur.prototype.majCalques = function (hote) {
    var liste = hote.querySelector('[data-r="calques"]');
    if (!liste || !this.moteur) return;
    var actif = this.moteur.canvas.getActiveObject();
    // lireCalques() rend l'ordre du canevas, de l'arrière vers l'avant. La
    // liste se lit dans l'autre sens : le premier plan en haut, comme dans
    // tous les logiciels de dessin.
    var calques = this.moteur.lireCalques().slice().reverse();

    hote.querySelectorAll('.tsle-action').forEach(function (b) { b.disabled = !actif; });

    if (!calques.length) {
      liste.innerHTML = '<div class="tsle-vide">Aucun élément pour l\'instant — '
                      + 'ajoutez un texte ou une image.</div>';
      return this.ajuster();
    }

    liste.innerHTML = calques.map(function (c, rang) {
      var fab = c.fabric || {};
      var texte = c.type === 'text';
      var vue = texte
        ? '<span class="tsle-lettre" style="background:' + esc(fab.fill || '#555') + '">'
          + esc(((fab.text || 'T').charAt(0) || 'T').toUpperCase()) + '</span>'
        : (fab.src ? '<img src="' + esc(fab.src) + '" alt="">' : '<span>?</span>');
      var nom = fab.__customName
             || (texte ? (fab.text || 'Texte').slice(0, 24) : 'Image ' + (calques.length - rang));
      var choisi = actif && actif.__tslId === c.id;
      return '<div class="tsle-calque' + (choisi ? ' choisi' : '') + (c.locked ? ' verrouille' : '') + '" '
           +   'data-id="' + esc(c.id) + '">'
           +   '<span class="tsle-calque-vue">' + vue + '</span>'
           +   '<span class="tsle-calque-txt">'
           +     '<b>' + esc(nom) + '</b>'
           +     '<i>' + (texte ? 'Texte' : 'Image') + '</i>'
           +   '</span>'
           +   '<button type="button" class="tsle-ico" title="'
           +     (c.locked ? 'Déverrouiller' : 'Verrouiller') + '">'
           +     '<svg viewBox="0 0 24 24" aria-hidden="true">'
           +       (c.locked ? CADENAS.ferme : CADENAS.libre) + '</svg></button>'
           + '</div>';
    }).join('');
    this.ajuster();
  };

  /** Décale un calque d'un cran. `sens` : +1 vers l'avant, -1 vers l'arrière. */
  Editeur.prototype.deplacerCalque = function (id, sens) {
    var ids = this.moteur.lireCalques().map(function (c) { return c.id; });
    var i = ids.indexOf(id);
    var j = i + sens;
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids[i] = ids[j]; ids[j] = id;
    // reordonner() remonte chaque identifiant au premier plan dans l'ordre
    // reçu : lui passer la liste de l'arrière vers l'avant la reconstitue.
    this.moteur.reordonner(ids);
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
    this.brancherPanier();
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
    if (!this.compositionNonVide()) return this.soumettreFormulaire();
    this.envoyerAuPanier();
  };

  Editeur.prototype.soumettreFormulaire = function () {
    var form = document.querySelector('form[action*="/cart/add"]');
    if (!form) return;
    this._laisserPasser = true;
    if (form.requestSubmit) form.requestSubmit(); else form.submit();
    this._laisserPasser = false;
  };

  /** Y a-t-il quelque chose à imprimer ? */
  Editeur.prototype.compositionNonVide = function () {
    if (!this.moteur) return false;
    var c = this.moteur.exporterComposition();
    var faces = c.faces || {};
    for (var k in faces) {
      if (faces[k] && faces[k].layers && faces[k].layers.length) return true;
    }
    return false;
  };

  /**
   * Détourne le bouton panier du thème.
   *
   * Sans ça, le client dessine puis clique « Ajouter au panier » — celui du
   * thème, pas le nôtre — et le formulaire part seul : la ligne de panier
   * ne porte aucune trace de la composition, et c'est le produit vierge qui
   * arrive dans le tiroir. On n'intercepte que s'il y a réellement quelque
   * chose à imprimer ; un achat sans personnalisation suit son chemin
   * habituel.
   */
  Editeur.prototype.brancherPanier = function () {
    var self = this;
    var intercepter = function (e) {
      if (self._laisserPasser || !self.compositionNonVide()) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      self.ajouterAuPanier();
    };
    var form = document.querySelector('form[action*="/cart/add"]');
    // Le bouton est relu à chaque passage : beaucoup de thèmes reconstruisent
    // le formulaire au changement de variante, et celui qu'on avait branché
    // n'est alors plus dans la page.
    this.boutonTheme = document.querySelector('form[action*="/cart/add"] [name="add"]')
                    || document.querySelector('form[action*="/cart/add"] button[type="submit"]')
                    || this.boutonTheme;
    // En phase de CAPTURE : beaucoup de thèmes posent leur propre gestionnaire
    // et partent en AJAX. Les laisser passer en premier, c'est perdre la
    // composition.
    if (form && !form.__tsleBranche) {
      form.__tsleBranche = true;
      form.addEventListener('submit', intercepter, true);
    }
    if (this.boutonTheme && !this.boutonTheme.__tsleBranche) {
      this.boutonTheme.__tsleBranche = true;
      this.boutonTheme.addEventListener('click', intercepter, true);
    }
  };

  /**
   * Circuit de commande : la composition part au serveur, qui reconstruit
   * les fichiers d'impression et rend les propriétés de ligne.
   *
   * Le PNG n'est jamais envoyé par le navigateur : il est REFABRIQUÉ côté
   * serveur depuis ce qui est enregistré. Un fichier fourni par le client
   * ne prouve rien — là, on imprime la commande et pas autre chose.
   */
  Editeur.prototype.envoyerAuPanier = function () {
    var self = this;
    if (this._envoiEnCours) return;
    this._envoiEnCours = true;
    this.occuperBoutons(true);

    var shop = encodeURIComponent(boutique());
    var comp = this.moteur.exporterComposition();
    var vignette = '';
    try { vignette = this.moteur.exporterImpression(500); } catch (e) { /* canevas teinté */ }

    var v = this.variantCourant() || {};
    var couleur = (this.iCouleur >= 0 && v.options) ? v.options[this.iCouleur] : '';

    fetch(BACKEND + '/api/designs?shop=' + shop, {
      method: 'POST', credentials: 'omit', mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: (this.donnees.handle || 'personnalisation') + ' — ' + (v.title || ''),
        product: String(this.produit),
        color: couleur || '#FFFFFF',
        thumbnail: vignette,
        composition: comp,
      }),
    }).then(function (r) {
      if (!r.ok) throw new Error('design ' + r.status);
      return r.json();
    }).then(function (design) {
      if (!design || !design.id) throw new Error('design sans identifiant');
      self._design = design;
      return fetch(BACKEND + '/api/render/from-composition/' + design.id + '?shop=' + shop, {
        method: 'POST', credentials: 'omit', mode: 'cors',
        headers: { 'Content-Type': 'application/json', 'X-Design-Token': design.edit_token || '' },
        body: JSON.stringify({ design_token: design.edit_token || '' }),
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (d) {
          if (!r.ok || !d || !d.properties) throw new Error((d && d.error) || 'rendu ' + r.status);
          return d;
        });
      });
    }).then(function (rendu) {
      var props = rendu.properties;
      var impression = (rendu.faces && rendu.faces.front && rendu.faces.front.url)
                    || (rendu.faces && rendu.faces.back && rendu.faces.back.url) || '';
      // Vignette du panier : la création POSÉE SUR LA PHOTO du produit. Le
      // fichier d'impression seul — un visuel sur fond transparent, hors
      // contexte — ne ressemble pas à ce qu'on vient d'acheter. On retombe
      // dessus si le produit n'a pas de zone calibrée.
      return self.apercuSurLaPhoto(self._design).then(function (sur) {
        self.poserDansLePanier(props, sur || impression);
      });
    }).catch(function (err) {
      self._envoiEnCours = false;
      self.occuperBoutons(false);
      self._message('Impossible d\'enregistrer votre personnalisation ('
        + (err && err.message ? err.message : 'erreur') + '). Réessayez.', true);
      // Le client a pu cliquer le bouton du thème sans ouvrir le tiroir : le
      // message ci-dessus serait alors invisible. L'échec doit se voir là où
      // il a cliqué, sinon il croit son panier rempli.
      self.signalerEchecPanier();
    });
  };

  /**
   * Demande au serveur la création posée sur la photo du produit.
   * Rend l'URL finale, ou une chaîne vide si l'aperçu n'est pas possible
   * (produit sans zone calibrée) — l'appelant retombe alors sur le fichier
   * d'impression.
   */
  Editeur.prototype.apercuSurLaPhoto = function (design) {
    if (!design || !design.id) return Promise.resolve('');
    var photo = imageProduit();
    var media = photo ? (photo.currentSrc || photo.src || '') : '';
    var url = BACKEND + '/api/products/' + this.produit + '/composition-preview'
            + '?design=' + encodeURIComponent(design.id)
            + '&token=' + encodeURIComponent(design.edit_token || '')
            + '&media=' + encodeURIComponent(media)
            + '&shop=' + encodeURIComponent(boutique());
    return fetch(url, { credentials: 'omit', mode: 'cors' })
      .then(function (r) {
        // La route redirige vers le fichier produit : c'est l'URL d'arrivée
        // qui nous intéresse, pas celle qu'on a demandée.
        return (r.ok && r.url) ? r.url : '';
      })
      .catch(function () { return ''; });
  };

  Editeur.prototype.poserDansLePanier = function (props, apercu) {
    var self = this;
    var v = this.variantCourant();
    var qte = 1;
    var champ = document.querySelector('form[action*="/cart/add"] [name="quantity"]');
    if (champ && Number(champ.value) > 0) qte = Number(champ.value);

    // tl-modal.js sait déjà ajouter au panier, ouvrir le tiroir, masquer les
    // propriétés internes et poser la vignette du design par-dessus l'image
    // du produit. On lui passe la main plutôt que de réécrire ce circuit —
    // et surtout pour que le panier se comporte pareil qu'avec le studio.
    if (window.__TLModalInitialized) {
      window.postMessage({
        type: 'tl-add-to-cart',
        variantId: v && v.id, quantity: qte,
        properties: props, previewUrl: apercu,
      }, '*');
      setTimeout(function () {
        self._envoiEnCours = false;
        self.occuperBoutons(false);
        self.fermer();
      }, 600);
      return;
    }

    // Sans tl-modal sur la page : ajout direct, puis le panier.
    if (apercu) props._preview_img = apercu;
    fetch('/cart/add.js', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: v && v.id, quantity: qte, properties: props }),
    }).then(function (r) {
      if (!r.ok) throw new Error('panier ' + r.status);
      window.location.href = '/cart';
    }).catch(function () {
      self._envoiEnCours = false;
      self.occuperBoutons(false);
      self._message('L\'ajout au panier a échoué. Réessayez.', true);
    });
  };

  Editeur.prototype.signalerEchecPanier = function () {
    var self = this;
    var dire = function (el, txt) {
      if (!el) return;
      var cible = el.querySelector('span') || el;
      cible.textContent = txt;
      el.classList.add('tsle-alerte');
      setTimeout(function () { el.classList.remove('tsle-alerte'); self.majPrix(); }, 4000);
    };
    dire(this.boutonTheme, 'Échec — réessayez');
    if (this.mbar) dire(this.mbar.querySelector('.tsle-mcart'), 'Échec');
  };

  /** Pendant l'envoi, tous les boutons panier disent la même chose. */
  Editeur.prototype.occuperBoutons = function (occupe) {
    var libelle = occupe ? 'Préparation de votre fichier…' : null;
    if (this.boutonTheme) {
      var el = this.boutonTheme.querySelector('span') || this.boutonTheme;
      if (occupe) { this.boutonTheme.__tsleAvant = el.textContent; el.textContent = libelle; }
      else if (this.boutonTheme.__tsleAvant) { el.textContent = this.boutonTheme.__tsleAvant; }
      this.boutonTheme.disabled = !!occupe;
    }
    if (this.mbar) {
      var mc = this.mbar.querySelector('.tsle-mcart');
      if (mc) { mc.disabled = !!occupe; if (occupe) mc.textContent = '…'; }
    }
    if (!occupe) this.majPrix();
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
