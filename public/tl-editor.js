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
    // Barre et panneau sont déplacés dans la grille produit : le bloc du
    // marchand n'a plus rien à montrer, et son emplacement n'importe plus.
    + '.tsle-efface{display:none!important}'
    // La barre vit sous la photo, centrée.
    // `position:relative` + `z-index` : la barre est posée dans la colonne
    // média du thème, dont on ne maîtrise ni l'empilement ni les calques.
    // `pointer-events` forcé : certains thèmes neutralisent les clics sur
    // tout ce qui n'est pas la diapositive active de leur galerie.
    + '.tsle-bar{position:relative;z-index:6;display:flex;flex-wrap:wrap;justify-content:center;'
    +   'gap:6px;padding:14px 0 2px;width:100%;box-sizing:border-box;pointer-events:auto}'
    + '.tsle-bar .tsle-tool{pointer-events:auto}'
    + '.tsle-bar.tsle-sousphoto{position:absolute;left:0;right:0;width:auto;padding:0}'
    // Le sélecteur de face occupe sa propre ligne au-dessus des outils.
    + '.tsle-faces{flex:0 0 100%;display:flex;justify-content:center;gap:6px;margin-bottom:8px}'
    + '.tsle-face{padding:7px 16px;border-radius:999px;border:1px solid rgba(128,128,128,.35);'
    +   'background:transparent;color:inherit;font:inherit;font-size:.8rem;cursor:pointer;line-height:1}'
    + '.tsle-face[aria-pressed="true"]{background:var(--tsle-accent,#111114);'
    +   'color:var(--tsle-on-accent,#fff);border-color:var(--tsle-accent,#111114)}'
    // Repli : la barre flotte au bas de la photo quand sa place dans le
    // flux s'avère inutilisable.
    + '.tsle-bar.tsle-flottante{position:absolute;z-index:2147483000;width:auto;padding:0;'
    +   'justify-content:center}'
    + '.tsle-tool{flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border-radius:999px;'
    +   'border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font:inherit;font-size:.85rem;'
    +   'cursor:pointer;line-height:1;white-space:nowrap;transition:background .18s,color .18s,border-color .18s}'
    + '.tsle-tool svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}'
    + '.tsle-tool[aria-expanded="true"]{background:var(--tsle-accent,#111114);color:var(--tsle-on-accent,#fff);border-color:var(--tsle-accent,#111114)}'

    // Le panneau occupe EXACTEMENT la colonne d'informations : il ne se
    // superpose plus, il la remplace. Plus d'ombre ni de bordure — ce n'est
    // pas un objet posé sur la page, c'est la colonne elle-même.
    // L'état fermé passe par une CLASSE À NOUS, et pas par l'attribut
    // `hidden`. La règle du navigateur `[hidden]{display:none}` a une
    // spécificité nulle : n'importe quelle règle du thème qui pose un
    // `display` sur les enfants de la colonne la bat, et le panneau reste
    // affiché en permanence, vide, par-dessus le titre et le prix.
    + '.tsle-vue{display:none!important}'
    + '.tsle-vue.ouvert{position:absolute;inset:0;z-index:4;display:flex!important;flex-direction:column;'
    +   'overflow:hidden;will-change:transform,opacity}'
    // Repli sur un thème dont on ne sait pas lire la grille : le panneau
    // reste dans le flux, encadré, sans animation.
    + '.tsle-vue.ouvert.tsle-plat{position:static;border:1px solid rgba(128,128,128,.25);'
    +   'border-radius:16px;margin-top:10px;max-height:70vh}'
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
    + '.tsle-body{flex:1;min-height:0;overflow-y:auto;padding:4px 18px 18px}'
    + '.tsle-panel{display:none}'
    + '.tsle-panel.on{display:block}'
    + '.tsle-vide{padding:26px 0;text-align:center;font-size:.85rem;opacity:.5}'
    + '.tsle-chargement{padding:26px 0;text-align:center;font-size:.85rem;opacity:.6}'

    // Calque d'édition posé SUR la photo produit. `pointer-events:none` tant
    // qu'aucun outil n'est ouvert : sans ça, Fabric capte les gestes tactiles
    // et bloque le défilement de la page — on ne peut plus lire la fiche.
    // Le calque d'édition se cale sur la PHOTO, pas sur son conteneur.
    // En `inset:0` il couvrait tout le parent — barre d'outils comprise,
    // qui devenait incliquable dès qu'un outil était ouvert.
    + '.tsle-scene{position:absolute;z-index:5;pointer-events:none}'
    // `touch-action:none` : sans ça le navigateur interprète lui-même le
    // glissement comme un défilement ou un balayage, avant même que la page
    // en entende parler.
    + '.tsle-scene.actif{pointer-events:auto;touch-action:none}'
    + '.tsle-scene.actif canvas{touch-action:none}'
    + '.tsle-scene canvas{position:absolute;top:0;left:0}'
    + '.tsle-cadre{position:absolute;border:1px dashed rgba(0,0,0,.45);pointer-events:none;'
    +   'box-shadow:0 0 0 9999px rgba(255,255,255,.08)}'
    + '.tsle-scene:not(.actif) .tsle-cadre{display:none}'

    // Beaucoup de thèmes agrandissent la photo au SURVOL. Sur un canevas
    // d'édition c'est intenable : l'image bouge sous le curseur pendant
    // qu'on place un texte. On neutralise le survol, pas le clic — le zoom
    // en plein écran reste accessible.

    // Au SURVOL seulement, on impose notre propre agrandissement — celui du
    // thème ferait bouger le vêtement sous le curseur pendant qu'on y place
    // un texte. La variable reprend exactement la valeur posée en ligne.
    + '.tsle-sanszoom img:hover,.tsle-sanszoom:hover img,.tsle-sanszoom *:hover > img{'
    +   'transform:var(--tsle-zoom,none)!important;scale:none!important;'
    +   'transform-origin:var(--tsle-origine,50% 50%)!important}'
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
    +   '.tsle-grid .tsle-seg{height:42px}'
    + '.tsle-grid .tsle-chips{min-height:42px;height:auto;align-items:center}'
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
    + '.tsle-vue.ouvert.large .tsle-deux{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;align-items:start}'
    + '.tsle-vue.ouvert.large .tsle-deux > div + div:not(.tsle-pleine){padding-left:24px;'
    +   'border-left:1px solid rgba(128,128,128,.22)}'
    + '.tsle-vue.ouvert.large .tsle-pleine{grid-column:1/-1}'
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
    + '.tsle-police{text-align:left;cursor:pointer;display:flex;align-items:center}'
    + '.tsle-police::after{content:"\\25BE";margin-left:auto;opacity:.5;font-size:.8em}'
    // Une colonne, pas une grille : chaque nom doit avoir la place de
    // montrer sa police. Hauteur bornée, sinon cent dix-huit lignes
    // pousseraient tout le reste du panneau hors de vue.
    + '.tsle-polices{max-height:300px;overflow-y:auto;margin-top:10px;'
    +   'border:1px solid rgba(128,128,128,.28);border-radius:12px;padding:6px}'
    + '.tsle-pol{display:block;width:100%;padding:9px 12px;border:0;border-radius:9px;'
    +   'background:transparent;color:inherit;font-size:1.15rem;cursor:pointer;text-align:left;'
    +   'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.5}'
    + '.tsle-pol:hover{background:rgba(128,128,128,.12)}'
    + '.tsle-pol[aria-pressed="true"]{background:var(--tsle-accent,#111114);'
    +   'color:var(--tsle-on-accent,#fff);border-color:var(--tsle-accent,#111114)}'
    + '.tsle-sousbloc{display:none;grid-column:1/-1}'
    + '.tsle-sousbloc.on{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:15px 18px;align-items:end}'

    // Barre contextuelle : posée sur le corps du document, au-dessus de
    // l'élément sélectionné. Hors de la colonne et hors du calque zoomé —
    // sinon elle grossirait avec la photo.
    + '.tsle-ctx{position:absolute;z-index:2147483001;display:none;align-items:center;gap:3px;'
    +   'padding:5px;border-radius:12px;background:var(--tsle-surface,#fff);'
    +   'border:1px solid rgba(128,128,128,.25);box-shadow:0 6px 24px rgba(0,0,0,.18);'
    +   'transform:translateX(-50%);white-space:nowrap}'
    + '.tsle-ctx.on{display:flex}'
    + '.tsle-cb{min-width:32px;height:32px;padding:0 7px;border:0;border-radius:8px;background:transparent;'
    +   'color:inherit;font:inherit;font-size:.85rem;cursor:pointer;display:inline-flex;'
    +   'align-items:center;justify-content:center;opacity:.8}'
    + '.tsle-cb:hover{opacity:1;background:rgba(128,128,128,.14)}'
    + '.tsle-cb[aria-pressed="true"]{background:var(--tsle-accent,#111114);color:var(--tsle-on-accent,#fff);opacity:1}'
    + '.tsle-cb.danger{color:#dc2626}'
    + '.tsle-cb.danger:hover{background:rgba(220,38,38,.14)}'
    + '.tsle-cb svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;'
    +   'stroke-linecap:round;stroke-linejoin:round}'
    + '.tsle-cc{width:30px;height:30px;padding:0;border:1px solid rgba(128,128,128,.4);'
    +   'border-radius:50%;background:transparent;cursor:pointer;overflow:hidden}'
    + '.tsle-cc::-webkit-color-swatch-wrapper{padding:0}'
    + '.tsle-cc::-webkit-color-swatch{border:0;border-radius:50%}'
    + '.tsle-cs{width:1px;height:20px;background:rgba(128,128,128,.3);margin:0 3px}'
    + '.tsle-cfmt{padding:0 8px;font-size:.76rem;white-space:nowrap;opacity:.8}'
    + '.tsle-cfmt b{font-size:.82rem;opacity:1}'
    + '.tsle-alerte{animation:tsle-pulse 1.1s ease 2}'
    + '@keyframes tsle-pulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,0)}50%{box-shadow:0 0 0 4px rgba(220,38,38,.35)}}'

    // ── Mobile ─────────────────────────────────────────────────────────
    // Les libellés disparaissent : sur 375 px de large, cinq pastilles
    // texte prennent deux lignes et mangent la hauteur de la photo, qui est
    // précisément ce qu'on vient chercher. L'icône seule tient sur une
    // ligne, et la cible de 48 px reste confortable au doigt.
    + '@media (max-width:767px){'
    +   '.tsle-bar{gap:10px;padding:10px 0 2px}'
    +   '.tsle-tool{width:48px;height:48px;padding:0;justify-content:center;border-radius:14px}'
    +   '.tsle-tool span{display:none}'
    +   '.tsle-tool svg{width:21px;height:21px}'
    +   '.tsle-faces{gap:10px;margin-bottom:10px}'
    +   '.tsle-face{padding:9px 20px;font-size:.85rem}'
    // Le panneau occupe la colonne : sur mobile elle est pleine largeur,
    // donc une seule colonne de réglages, plus aérée.
    +   '.tsle-body{padding:4px 14px 16px}'
    +   '.tsle-grid{grid-template-columns:1fr;gap:12px}'
    +   '.tsle-polices{max-height:240px}'
    +   '.tsle-cb{min-width:38px;height:38px}'
    +   '.tsle-cc{width:34px;height:34px}'
    + '}'
    + '@media (prefers-reduced-motion:reduce){.tsle-vue,.tsle-panel{transition:none!important}}';

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

    // Un produit vendu tel quel, déjà imprimé, ne doit rien proposer. Le
    // marqueur retenu est la zone d'impression calibrée : c'est une donnée
    // que le marchand tient déjà, et sans elle l'éditeur ne saurait de
    // toute façon pas où poser un visuel. Rien n'est construit tant que la
    // réponse n'est pas là — faire apparaître une barre pour la retirer
    // ensuite serait pire que de ne rien montrer.
    var self = this;
    if (racine.getAttribute('data-tsl-exiger-zone') === '1') {
      api('/api/products/' + this.produit + '/display-zone')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && d.exists) {
            self.zoneCalibree = d;
            self.faces = d.faces || [];
            self.tarif = d.tarif || null;
            self.construire();
          }
          else {
            console.info('[TSL] Produit sans zone d\'impression calibrée : '
              + 'personnalisation non proposée. Calibrez-le dans Zones produit '
              + 'pour l\'activer.');
          }
        })
        .catch(function () { /* backend injoignable : on ne propose rien */ });
      return;
    }
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

    // La barre va SOUS la photo, le panneau DANS la colonne d'informations.
    // Le bloc du marchand ne porte donc plus rien de visible : il reste en
    // place parce que c'est lui qui transporte les réglages, mais sans
    // surface. Ça rend aussi son emplacement dans le thème indifférent.
    this.barre = document.createElement('div');
    this.barre.className = 'tsle-bar';
    this.barre.setAttribute('role', 'tablist');
    this.barre.innerHTML = this.outils.map(function (cle) {
      var o = OUTILS[cle];
      return '<button type="button" class="tsle-tool" data-outil="' + cle + '" aria-expanded="false">'
           +   '<svg viewBox="0 0 24 24" aria-hidden="true">' + o.icone + '</svg>'
           +   '<span>' + esc(o.titre) + '</span>'
           + '</button>';
    }).join('');

    this.vue = document.createElement('div');
    this.vue.className = 'tsle-vue';
    this.vue.setAttribute('role', 'dialog');
    this.vue.setAttribute('aria-label', 'Personnalisation');
    this.vue.innerHTML =
        '<div class="tsle-head">'
      +   '<span class="tsle-head-icon"><svg viewBox="0 0 24 24" aria-hidden="true"></svg></span>'
      +   '<span class="tsle-head-txt"><b></b><span></span></span>'
      +   '<button type="button" class="tsle-close" aria-label="Fermer">×</button>'
      + '</div>'
      + '<div class="tsle-body">'
      +   this.outils.map(function (cle) {
            return '<div class="tsle-panel" data-panneau="' + cle + '">'
                 +   '<div class="tsle-vide">Panneau « ' + esc(OUTILS[cle].titre) + ' » — à venir</div>'
                 + '</div>';
          }).join('')
      + '</div>';

    this.placer();

    this.barre.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('.tsle-tool') : null;
      if (t) self.basculer(t.getAttribute('data-outil'));
    });
    this.vue.addEventListener('click', function (e) {
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
      if (!t || !t.closest || !self.vue.contains(t)) return;
      if (!t.closest('.tsle-close')) return;
      e.preventDefault(); e.stopPropagation();
      self.fermer();
    };
    document.addEventListener('pointerdown', fermerSi, true);
    document.addEventListener('click', fermerSi, true);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && self.outil) self.fermer();
    });

    // La largeur de la colonne change avec la fenêtre : la distance de
    // glissement aussi, sinon le contenu sorti réapparaît par le bord.
    window.addEventListener('resize', function () {
      if (self.outil) self.glisser(true, true);
    });

    // Le thème reconstruit ses colonnes au changement de variante : la barre
    // et le panneau disparaissent avec. On les repose.
    if (window.MutationObserver) {
      var o = new MutationObserver(function () {
        if (!self.colonne || !self.barre.isConnected || !self.vue.isConnected) self.placer();
        // Le changement de coloris remplace la photo : le canevas part avec
        // elle. On laisse le thème finir son remplacement avant de regarder.
        clearTimeout(self._verifScene);
        self._verifScene = setTimeout(function () { self.verifierScene(); }, 250);
      });
      o.observe(document.body, { childList: true, subtree: true });
    }

    // Les images ne sont pas forcément mises en page quand le script
    // s'exécute : sans seconde tentative, une fiche parfaitement normale
    // resterait sur le repli pour toute la visite.
    if (!this.colonne) {
      window.addEventListener('load', function () { self.placer(); });
      setTimeout(function () {
        self.placer();
        // On n'avertit qu'après avoir réessayé : une photo pas encore mise
        // en page n'est pas un défaut d'intégration, et crier trop tôt
        // enverrait l'intégrateur chercher un problème qui n'existe pas.
        if (!self.colonne) {
          console.warn('[TSL] Colonne produit introuvable : la barre et le panneau restent '
            + 'dans le bloc. Vérifiez que la fiche a bien une photo principale.');
        }
      }, 1200);
    }

    this.reperColoris();
    this.brancherPrix();
    this.brancherPanier();

    var parDefaut = this.racine.getAttribute('data-tsl-default-tool');
    if (parDefaut && OUTILS[parDefaut] && this.outils.indexOf(parDefaut) >= 0) {
      this.ouvrir(parDefaut, true);
    }
  };

  // ── Où poser la barre et le panneau ───────────────────────────────────────
  //
  // Rien n'est codé en dur sur le thème : on part de la photo du produit et
  // on remonte. La colonne d'informations est le premier ancêtre du bloc qui
  // ne contient PAS la photo alors que son parent, lui, la contient — c'est
  // la définition même de « l'autre colonne de la grille produit ».

  Editeur.prototype.colonneInfos = function (img) {
    if (!img) return null;
    var n = this.racine;
    while (n && n.parentElement && n.parentElement !== document.body) {
      if (!n.contains(img) && n.parentElement.contains(img)) return n;
      n = n.parentElement;
    }
    return null;
  };

  Editeur.prototype.colonneMedia = function (colonne, img) {
    var grille = colonne && colonne.parentElement;
    if (!grille) return null;
    for (var i = 0; i < grille.children.length; i++) {
      if (grille.children[i].contains(img)) return grille.children[i];
    }
    return null;
  };

  /**
   * Fond opaque hérité de la page.
   *
   * Le panneau recouvre la colonne : il lui faut un fond, et un fond blanc
   * codé en dur serait illisible sur un thème sombre. On remonte jusqu'au
   * premier ancêtre qui en déclare un vraiment.
   */
  function fondOpaque(el) {
    var n = el;
    while (n && n !== document.documentElement) {
      var c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c)) return c;
      n = n.parentElement;
    }
    return '#ffffff';
  }

  Editeur.prototype.placer = function () {
    var img = imageProduit();
    var colonne = this.colonneInfos(img);
    var media = colonne ? this.colonneMedia(colonne, img) : null;

    if (!colonne || !media) {
      // Repli : thème dont on ne sait pas lire la grille. Tout reste dans le
      // bloc, en flux normal — moins beau, mais utilisable, et l'intégrateur
      // sait pourquoi.
      this.vue.classList.add('tsle-plat');
      if (this.barre.parentElement !== this.racine) this.racine.appendChild(this.barre);
      if (this.vue.parentElement !== this.racine) this.racine.appendChild(this.vue);
      this.colonne = null;
      return false;
    }

    this.racine.classList.add('tsle-efface');
    this.vue.classList.remove('tsle-plat');
    if (this.barre.parentElement !== media) media.appendChild(this.barre);
    this.media = media;
    // La colonne média est souvent plus haute que la photo — galerie qui
    // garde la place de ses autres vues, espace réservé — et la barre,
    // simplement ajoutée à la fin, se retrouvait très loin dessous. On la
    // cale donc SUR la photo plutôt que sur le flux du thème.
    if (getComputedStyle(media).position === 'static') media.style.position = 'relative';
    this.barre.classList.add('tsle-sousphoto');
    this.calerBarre();
    if (this.vue.parentElement !== colonne) colonne.appendChild(this.vue);
    this.colonne = colonne;

    // Repère de positionnement du panneau. On ne touche à rien d'autre :
    // la colonne garde sa largeur, sa hauteur et son comportement collant.
    if (getComputedStyle(colonne).position === 'static') colonne.style.position = 'relative';
    this.vue.style.background = fondOpaque(colonne);
    this.vue.classList.toggle('large', colonne.offsetWidth >= 640);
    this.verifierBarre();
    return true;
  };

  /**
   * Pose la barre juste sous la photo, dans le repère de la colonne média.
   *
   * On vise le bas de la zone VISIBLE : pendant le zoom, la photo déborde
   * de son conteneur, qui la rogne. Suivre le bas de l'image elle-même
   * ferait descendre la barre hors de l'écran.
   */
  Editeur.prototype.calerBarre = function () {
    var media = this.media;
    var img = imageProduit();
    if (!media || !img || this.barre.classList.contains('tsle-flottante')) return;
    // Sous la zone d'aperçu, qui n'est pas toujours la photo : pendant
    // l'édition on donne de la hauteur au conteneur pour agrandir le visuel,
    // et la barre doit descendre d'autant — sinon ses boutons se retrouvent
    // au milieu du vêtement, par-dessus la zone d'impression. On ne se fie
    // pas pour autant à la hauteur du conteneur, qu'un thème peut étirer
    // bien au-delà de la photo : on prend celle qu'on a demandée.
    //
    // Position de MISE EN PAGE et non d'affichage : la photo agrandie
    // déborde, et la mesurer à l'écran ferait descendre la barre à chaque
    // changement d'outil, d'autant que la transition n'est pas finie.
    var d = decalageDans(img, media);
    var hauteur = Math.max(img.offsetHeight, this.outil ? (this._hauteurVue || 0) : 0);
    this.barre.style.top = Math.round(d.y + hauteur + 10) + 'px';
  };

  /**
   * La barre est-elle réellement cliquable là où on l'a posée ?
   *
   * Elle atterrit dans la colonne média du thème, dont on ne maîtrise rien :
   * galerie à diapositives qui neutralise les clics hors de la vue active,
   * calque de zoom par-dessus, conteneur sans hauteur… Le symptôme est
   * toujours le même et toujours muet — des boutons visibles qui ne
   * répondent pas. On vérifie donc, et on se replie.
   */
  Editeur.prototype.verifierBarre = function () {
    var self = this;
    clearTimeout(this._verifBarre);
    this._verifBarre = setTimeout(function () {
      var b = self.barre.querySelector('.tsle-tool');
      if (!b || self.barre.classList.contains('tsle-flottante')) return;
      var r = b.getBoundingClientRect();
      if (!r.width || !r.height) return self.barreFlottante('sans surface');
      var dessus = document.elementFromPoint(
        Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      // Hors écran : on ne peut rien conclure, on réessaiera au défilement.
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      if (!dessus || !self.barre.contains(dessus)) self.barreFlottante('recouverte');
    }, 900);
  };

  /**
   * Repli : la barre quitte le flux et vient flotter au bas de la photo.
   * Posée sur le corps du document, plus aucun habillage de thème ne peut
   * la rogner, la masquer ni lui prendre ses clics.
   */
  Editeur.prototype.barreFlottante = function (raison) {
    var self = this;
    console.warn('[TSL] Barre d\'outils ' + raison + ' à sa place dans la page : '
      + 'elle passe en flottant au bas de la photo.');
    this.barre.classList.add('tsle-flottante');
    document.body.appendChild(this.barre);

    var suivre = function () {
      var img = imageProduit();
      if (!img) return;
      var r = img.getBoundingClientRect();
      var l = r.left + window.scrollX + r.width / 2;
      self.barre.style.left = Math.round(l) + 'px';
      self.barre.style.top = Math.round(r.bottom + window.scrollY - 56) + 'px';
      self.barre.style.transform = 'translateX(-50%)';
    };
    suivre();
    window.addEventListener('scroll', suivre, { passive: true });
    window.addEventListener('resize', suivre);
    this._suivreBarre = suivre;
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
    this.vue.querySelector('.tsle-head-icon svg').innerHTML = o.icone;
    this.vue.querySelector('.tsle-head-txt b').textContent = o.titre;
    this.vue.querySelector('.tsle-head-txt span').textContent = o.sous;

    // Changement d'outil panneau ouvert : on fond le contenu, la colonne ne
    // revient pas pour repartir aussitôt.
    var corps = this.vue.querySelector('.tsle-body');
    var montrer = function () {
      self.vue.querySelectorAll('.tsle-panel').forEach(function (p) {
        p.classList.toggle('on', p.getAttribute('data-panneau') === cle);
      });
      self.remplirPanneau(cle);
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

    if (!changement) this.glisser(true, sansAnim);
  };

  Editeur.prototype.fermer = function () {
    if (!this.outil) return;

    // Retour au recto avant de refermer. La galerie du thème reprend sa
    // photo — celle de l'avant — et laisser le canevas sur le verso
    // affichait le visuel du dos sur la poitrine, jusqu'à ce qu'on rouvre
    // pour rebasculer deux fois.
    this._attenteRecto = (this._attenteRecto || 0) + 1;
    if (this.moteur && this.moteur.face !== 'front'
        && this.faces && this.faces.length > 1 && this._attenteRecto < 30) {
      var self = this;
      this.changerFace('front');
      // La bascule est asynchrone : on referme une fois la face revenue.
      // Borné, pour qu'un chargement qui n'aboutit pas n'empêche jamais de
      // fermer le panneau.
      setTimeout(function () { self.fermer(); }, 60);
      return;
    }
    this._attenteRecto = 0;

    this.outil = null;
    // Le canevas redevient inerte : laissé actif, Fabric capte les gestes
    // tactiles et le client ne peut plus faire défiler la fiche produit.
    if (this.scene) this.scene.classList.remove('actif');
    if (this.moteur) this.moteur.canvas.discardActiveObject().requestRenderAll();
    this.zoomerSurLaZone(false);
    this.cacherCtx();
    this.barre.querySelectorAll('.tsle-tool').forEach(function (b) {
      b.setAttribute('aria-expanded', 'false');
    });
    this.glisser(false);
  };

  /**
   * Échange la colonne d'informations contre le panneau, par glissement.
   *
   * Le contenu de la colonne part vers la DROITE, le panneau arrive par la
   * GAUCHE : les deux ne se croisent jamais à l'écran. On déplace les
   * enfants de la colonne, pas la colonne elle-même — une translation ne
   * change pas la place occupée dans la mise en page, donc la fiche ne bouge
   * pas d'un pixel et le comportement collant de la colonne est intact.
   *
   * Le rognage est posé sur la colonne elle-même, jamais sur un de ses
   * parents : `overflow` sur un ancêtre d'un élément collant le décolle.
   * Et `clip` plutôt que `hidden`, qui lui créerait un conteneur de
   * défilement.
   */
  Editeur.prototype.glisser = function (ouvert, instantane) {
    var self = this;
    var col = this.colonne;
    var duree = (instantane || SOBRE) ? 0 : DUREE;

    clearTimeout(this._finGlissement);

    if (!col) {
      // Repli sans colonne : le panneau se montre et se cache, sans décor.
      this.vue.classList.toggle('ouvert', !!ouvert);
      return;
    }

    var dx = Math.round(col.offsetWidth + 24);
    var enfants = [];
    for (var i = 0; i < col.children.length; i++) {
      if (col.children[i] !== this.vue) enfants.push(col.children[i]);
    }

    // `CSS` est ici la feuille de styles du module, pas l'objet global —
    // d'où window.CSS. `clip` est préférable à `hidden` : il rogne sans
    // créer de conteneur de défilement.
    var clip = window.CSS && window.CSS.supports && window.CSS.supports('overflow', 'clip');
    col.style.overflow = clip ? 'clip' : 'hidden';

    // Le panneau a souvent plus à dire que la colonne n'est haute. On
    // l'étire à la hauteur de la photo : la rangée de la grille fait déjà
    // cette hauteur, donc rien ne bouge dans la page, et le panneau tombe
    // en face du visuel qu'il sert à composer — c'est la maquette.
    if (ouvert) {
      var media = this.colonneMedia(col, imageProduit());
      var vise = media ? Math.min(media.offsetHeight, Math.round(window.innerHeight * 0.9)) : 0;
      if (vise > col.offsetHeight) col.style.minHeight = vise + 'px';
    }
    var transition = duree
      ? 'transform ' + duree + 'ms ' + COURBE + ', opacity ' + duree + 'ms linear'
      : 'none';

    enfants.forEach(function (e) {
      e.style.transition = transition;
      e.style.transform = ouvert ? 'translateX(' + dx + 'px)' : '';
      e.style.opacity = ouvert ? '0' : '';
      e.style.pointerEvents = ouvert ? 'none' : '';
      if (ouvert) e.setAttribute('aria-hidden', 'true');
      else e.removeAttribute('aria-hidden');
    });

    this.vue.style.transition = transition;
    if (ouvert) {
      this.vue.classList.add('ouvert');
      this.vue.style.transform = 'translateX(-' + dx + 'px)';
      this.vue.style.opacity = '0';
      // Laisser le navigateur enregistrer la position de départ avant
      // d'animer, sinon il interpole depuis l'état final.
      void this.vue.offsetWidth;
      this.vue.style.transform = 'translateX(0)';
      this.vue.style.opacity = '1';
    } else {
      this.vue.style.transform = 'translateX(-' + dx + 'px)';
      this.vue.style.opacity = '0';
    }

    this._finGlissement = setTimeout(function () {
      if (!ouvert) {
        self.vue.classList.remove('ouvert');
        col.style.overflow = '';
        col.style.minHeight = '';
        enfants.forEach(function (e) { e.style.transition = ''; });
      }
      self.vue.style.transition = '';
    }, duree + 30);
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
    var hote = this.vue.querySelector('.tsle-panel[data-panneau="' + cle + '"]');
    var batisseur = BATISSEURS[cle];
    if (!hote || !batisseur) {
      if (this.scene) this.scene.classList.remove('actif');
      return Promise.resolve(null);
    }

    if (hote.__rempli) {
      if (this.scene) this.scene.classList.add('actif');
      this.zoomerSurLaZone(true);
      // Certains panneaux reflètent l'état du canevas (les calques) : ils se
      // remettent à jour à chaque ouverture, sans être reconstruits — ça
      // perdrait la saisie en cours dans les autres.
      if (hote.__maj) hote.__maj();
      return Promise.resolve(hote);
    }

    hote.__rempli = true;
    hote.innerHTML = '<div class="tsle-chargement">Préparation de l\'éditeur…</div>';
    return this.prepareScene().then(function () {
      self[batisseur](hote);
      if (self.outil === cle && self.scene) self.scene.classList.add('actif');
      self.zoomerSurLaZone(true);
      return hote;
    }).catch(function () {
      // Rouvrir doit pouvoir réessayer : une coupure réseau passagère ne
      // doit pas condamner l'outil pour le reste de la visite.
      hote.__rempli = false;
      hote.innerHTML = '<div class="tsle-vide">Éditeur indisponible — rechargez la page.</div>';
      return null;
    });
  };

  /**
   * Rapproche la photo de la zone d'impression pendant l'édition.
   *
   * On agrandit la PHOTO et le calque ensemble, autour du centre de la zone.
   * Le facteur vient de la zone elle-même : une poitrine de t-shirt n'occupe
   * qu'un sixième du cliché, un tote bag presque la moitié — un grossissement
   * fixe serait ridicule dans un cas et illisible dans l'autre.
   *
   * Le zoom passe par deux variables CSS posées sur le conteneur de la photo,
   * et non par un style en ligne : c'est ce qui permet à la règle qui
   * neutralise le survol du thème de le respecter au lieu de l'écraser.
   */
  /**
   * Aperçu en pleine largeur pendant l'édition, sur mobile.
   *
   * La photo tient dans la colonne du thème, marges comprises, et la zone
   * d'impression ne peut pas dépasser cette largeur : c'est elle qui plafonne
   * l'agrandissement, pas la hauteur. On va donc chercher les marges — en
   * vérifiant que le bord gagné est bien visible, car un parent qui rogne
   * couperait la zone au lieu de l'élargir, et il « manquerait un bout ».
   *
   * Renvoie vrai si la largeur a changé : la scène, le canevas et la zone
   * doivent alors être recalés, ce que `definirZone` fait en conservant la
   * composition — elle est mémorisée en fractions de zone, pas en pixels.
   */
  Editeur.prototype.elargirApercu = function (hote, actif) {
    var remettre = function (self) {
      hote.style.marginLeft = self._margesHote[0];
      hote.style.marginRight = self._margesHote[1];
      self._margesHote = null;
    };
    if (!actif) {
      if (!this._margesHote) return false;
      remettre(this);
      return true;
    }
    if (this._margesHote || window.innerWidth >= 768) return false;
    var avant = Math.round(hote.getBoundingClientRect().width);
    if (avant >= window.innerWidth - 8) return false;

    this._margesHote = [hote.style.marginLeft, hote.style.marginRight];
    hote.style.marginLeft = 'calc(50% - 50vw)';
    hote.style.marginRight = 'calc(50% - 50vw)';

    var r = hote.getBoundingClientRect();
    var y = Math.min(Math.max(r.top + 8, 8), window.innerHeight - 8);
    var bord = document.elementFromPoint(Math.round(r.left + 3), Math.round(y));
    if (Math.round(r.width) <= avant + 8 || !bord || !hote.contains(bord)) {
      remettre(this);
      return false;
    }
    return true;
  };

  Editeur.prototype.zoomerSurLaZone = function (actif) {
    var hote = this.scene && this.scene.parentElement;
    if (!hote || !this.moteur) return;

    // La transition est posée EN LIGNE au moment du changement, et pas
    // dans la feuille de styles. Déclarée à l'avance, elle démarrait avant
    // que la valeur soit lue et restait figée sur son point de départ —
    // or une transition l'emporte sur toute déclaration, `!important`
    // compris : l'image ne grossissait jamais, sans la moindre erreur.
    var poser = function (el, t, o) {
      if (!el) return;
      el.style.transition = SOBRE ? 'none' : 'transform .4s ' + COURBE;
      el.style.transformOrigin = o;
      el.style.transform = t;
    };

    if (!actif) {
      hote.style.removeProperty('--tsle-zoom');
      hote.style.removeProperty('--tsle-origine');
      poser(this.imageProduit, '', '');
      poser(this.scene, '', '');
      this.majTaillePoignees(1);
      this.definitionCanevas(1);
      this.affinerPhoto(0);
      hote.style.minHeight = this._hauteurHote || '';
      this._hauteurVue = 0;
      if (this.elargirApercu(hote, false)) this.recalerScene();
      var self = this;
      // Après la transition : le conteneur a retrouvé sa taille.
      setTimeout(function () { self.calerBarre(); }, SOBRE ? 0 : 420);
      if (this._surplusHote !== undefined) hote.style.overflow = this._surplusHote;
      return;
    }

    // Avant toute mesure : la largeur de l'aperçu peut changer, et tout en
    // dépend — échelle, canevas, zone.
    if (this.elargirApercu(hote, true)) this.recalerScene();

    var d = this._dimensions();
    var z = d.zone;
    if (!z.w || !z.h) return;

    // Sur mobile, la photo fait toute la largeur mais guère plus de 290 px
    // de haut : la zone d'impression, même remplie à ras bord, reste
    // minuscule. On donne donc de la hauteur au conteneur — il rogne déjà —
    // et le zoom vise cette boîte-là, agrandie, plutôt que la photo seule.
    if (this._hauteurHote === undefined) this._hauteurHote = hote.style.minHeight || '';

    var large = d.largeur;
    // Le plafond monte sur mobile, où la surface d'affichage est le vrai
    // facteur limitant — et où un visuel trop petit ne se place pas au
    // doigt. La netteté suit : canevas et photo demandent leur définition
    // en fonction du facteur.
    var plafond = window.innerWidth < 768 ? 6 : 4;
    // Part d'écran qu'on s'autorise pour l'aperçu pendant l'édition.
    var hMax = Math.round(window.innerHeight * (window.innerWidth < 768 ? 0.68 : 0.74));
    // 0,98 en largeur, 0,86 en hauteur : un filet au-dessus et en dessous
    // de la zone, pour qu'elle se lise comme posée sur le vêtement et que
    // ses poignées restent attrapables.
    var k = Math.min(plafond, Math.max(1,
      Math.min(large * 0.98 / z.w, hMax * 0.86 / z.h)));

    // La boîte prend juste la hauteur de la zone agrandie, marges comprises.
    // Une hauteur fixe laissait un grand vide sous le cadre — et comme les
    // boutons se posent dessous, ils tombaient au milieu de l'écran. On ne
    // fait que l'agrandir : jamais rogner l'aperçu d'origine.
    var voulue = Math.max(d.hauteur, Math.min(hMax, Math.round((z.h * k) / 0.86)));
    this._hauteurVue = voulue;
    if (voulue > d.hauteur) hote.style.minHeight = voulue + 'px';

    var boite = { w: large, h: voulue };
    var ox = (z.x + z.w / 2) / d.largeur * 100;
    var oy = (z.y + z.h / 2) / d.hauteur * 100;

    if (this._surplusHote === undefined) this._surplusHote = hote.style.overflow;
    hote.style.overflow = 'hidden';

    // Recentrage. Avec une origine posée sur le centre de la zone, ce point
    // reste là où il était : si la zone est basse ou décalée sur la photo,
    // l'agrandissement la pousse hors du cadre et il « manque un bout ».
    // On translate donc ce point jusqu'où on veut le voir. Le repère est la
    // photo et non son conteneur : un thème peut étirer celui-ci bien
    // au-delà, et la zone partait alors se centrer dans du vide.
    //
    // Centrée horizontalement, posée HAUT verticalement : la zone est ce
    // qu'on vient regarder, le vêtement autour n'est qu'un repère. Centrer
    // en hauteur la laissait flotter au milieu, avec du vide dessous.
    var tx = Math.round(boite.w / 2 - (z.x + z.w / 2));
    var ty = Math.round(Math.min(boite.h / 2, boite.h * 0.07 + (z.h * k) / 2)
                        - (z.y + z.h / 2));

    var origine = ox.toFixed(2) + '% ' + oy.toFixed(2) + '%';
    var echelle = 'translate(' + tx + 'px,' + ty + 'px) scale(' + k.toFixed(3) + ')';
    // Le style EN LIGNE porte l'agrandissement, la variable ne sert qu'à la
    // règle de survol. Piloter la transformation depuis une variable posée
    // sur le parent laissait la transition figée à son point de départ :
    // une transition l'emporte sur toute déclaration, même `!important`,
    // et l'image restait à sa taille initiale sans un mot.
    hote.style.setProperty('--tsle-origine', origine);
    hote.style.setProperty('--tsle-zoom', echelle);
    poser(this.imageProduit, echelle, origine);
    poser(this.scene, echelle, origine);
    this.majTaillePoignees(k);
    this.definitionCanevas(k);
    this.affinerPhoto(k);
    this.calerBarre();
  };

  // ── Panneau Textes ────────────────────────────────────────────────────────

  // Une centaine de familles Google, groupées par registre pour que la liste
  // se parcoure au lieu de se lire. Toutes sont récupérables côté serveur à
  // la demande (utils/print-composition.js), donc tout ce qui est proposé ici
  // s'imprimera dans la bonne police.
  var POLICES = [
    // Sans — les plus sûres pour un slogan lisible
    'Montserrat', 'Poppins', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Raleway',
    'Nunito', 'Work Sans', 'Rubik', 'Karla', 'Manrope', 'Outfit', 'DM Sans',
    'Quicksand', 'Barlow', 'Cabin', 'Mulish', 'Figtree', 'Jost', 'Urbanist',
    'Sora', 'Space Grotesk', 'Archivo', 'Asap', 'Catamaran', 'Exo 2', 'Heebo',
    'Hind', 'Josefin Sans', 'Kanit', 'Lexend', 'Overpass', 'Public Sans',
    'Red Hat Display', 'Signika', 'Titillium Web', 'Ubuntu', 'Varela Round',
    // Condensées et affiches
    'Anton', 'Bebas Neue', 'Oswald', 'Archivo Black', 'Teko', 'Fjalla One',
    'Staatliches', 'Russo One', 'Alfa Slab One', 'Black Ops One', 'Bungee',
    'Chivo', 'Khand', 'Saira Condensed', 'Big Shoulders Display', 'Antonio',
    // Serif
    'Playfair Display', 'Merriweather', 'Lora', 'PT Serif', 'Libre Baskerville',
    'Cormorant Garamond', 'Crimson Text', 'EB Garamond', 'Bitter', 'Arvo',
    'Zilla Slab', 'Spectral', 'Cardo', 'Domine', 'Rozha One', 'Abril Fatface',
    'Vollkorn', 'Noto Serif', 'Source Serif 4', 'Frank Ruhl Libre',
    // Manuscrites et pinceau
    'Pacifico', 'Lobster', 'Dancing Script', 'Great Vibes', 'Satisfy',
    'Caveat', 'Sacramento', 'Parisienne', 'Allura', 'Yellowtail',
    'Shadows Into Light', 'Indie Flower', 'Amatic SC', 'Kalam', 'Courgette',
    'Cookie', 'Marck Script', 'Italianno', 'Petit Formal Script',
    // Marqueur, graffiti, fantaisie
    'Permanent Marker', 'Bangers', 'Luckiest Guy', 'Fredoka', 'Titan One',
    'Righteous', 'Creepster', 'Monoton', 'Press Start 2P', 'Rock Salt',
    'Special Elite', 'Nosifer', 'Bowlby One', 'Shrikhand', 'Chewy',
    'Gloria Hallelujah', 'Patrick Hand', 'Comfortaa', 'Baloo 2',
    // Mono
    'Roboto Mono', 'Space Mono', 'JetBrains Mono', 'IBM Plex Mono', 'Courier Prime',
  ];

  /**
   * Catalogue des polices, en UNE requête.
   *
   * La feuille déclare les cent familles, mais le navigateur ne télécharge
   * que celles qu'il doit réellement peindre : poser cent liens séparés
   * coûterait cent allers-retours pour le même résultat.
   */
  function chargerCatalogueFontes() {
    if (document.getElementById('tsle-fontes')) return;
    var l = document.createElement('link');
    l.id = 'tsle-fontes';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?'
           + POLICES.map(function (n) {
               return 'family=' + encodeURIComponent(n).replace(/%20/g, '+') + ':wght@400;700';
             }).join('&')
           + '&display=swap';
    document.head.appendChild(l);
  }
  var MAX_CARACTERES = 60;

  var DEFORMATIONS = [
    { v: 'none',  t: 'Aucune' },
    { v: 'arc',   t: 'Arc' },
    { v: 'arcbas', t: 'Arc bas' },
    { v: 'wave',  t: 'Vague' },
    { v: 'flag',  t: 'Drapeau' },
    { v: 'slant', t: 'Penché' },
  ];

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

      // Le natif <select> ne sait pas afficher chaque ligne dans sa propre
      // police selon les navigateurs : on ouvre notre liste. La valeur reste
      // portée par un champ caché, le reste du panneau n'a pas à le savoir.
      + champ('Police d\'écriture',
          '<button type="button" class="tsle-select tsle-police" data-r="policeBtn">Montserrat</button>'
        + '<input type="hidden" data-r="police" value="Montserrat">')

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

      + champ('Déformation',
          '<div class="tsle-chips">'
        + DEFORMATIONS.map(function (d) {
            return '<button type="button" class="tsle-chip" data-r="deform" data-v="' + d.v + '" '
                 +   'aria-pressed="' + (d.v === 'none' ? 'true' : 'false') + '">' + esc(d.t) + '</button>';
          }).join('')
        + '</div>')
      + '<div class="tsle-f" data-r="blocIntensite" style="display:none">'
      +   '<span class="tsle-lab">Intensité</span>'
      +   curseur('intensite', 5, 100, 35)
      + '</div>'

      + champ('Effets',
          '<div class="tsle-chips">'
        +   '<button type="button" class="tsle-chip" data-r="contour" aria-pressed="false">Contour</button>'
        +   '<button type="button" class="tsle-chip" data-r="ombre" aria-pressed="false">Ombre</button>'
        + '</div>')

      + '<div class="tsle-sousbloc" data-r="blocPolices">'
      +   '<div class="tsle-f" style="grid-column:1/-1">'
      +     '<div class="tsle-polices" data-r="listePolices"></div>'
      +   '</div>'
      + '</div>'

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

    // ── Liste des polices ───────────────────────────────────────────────
    var bloc = q('blocPolices');
    var liste = q('listePolices');
    var bouton = q('policeBtn');

    // Une liste déroulante, pas un moteur de recherche : personne ne connaît
    // le nom des cent dix-huit familles, on les reconnaît en les voyant.
    // D'où une ligne par police, chacune écrite dans la sienne.
    var dessiner = function () {
      liste.innerHTML = POLICES.map(function (n) {
        return '<button type="button" class="tsle-pol" data-police="' + esc(n) + '" '
             +   'style="font-family:\'' + esc(n) + '\',sans-serif"'
             +   (n === self._t.police.value ? ' aria-pressed="true"' : '') + '>'
             +   esc(n) + '</button>';
      }).join('');
      // La police retenue est amenée sous les yeux : sans ça, rouvrir la
      // liste la laissait quelque part au milieu des cent autres.
      var actif = liste.querySelector('[aria-pressed="true"]');
      if (actif) liste.scrollTop = Math.max(0, actif.offsetTop - 80);
    };

    bouton.addEventListener('click', function () {
      var ouvert = bloc.classList.toggle('on');
      if (!ouvert) return;
      chargerCatalogueFontes();
      dessiner();
    });
    liste.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-police]') : null;
      if (!b) return;
      var nom = b.getAttribute('data-police');
      self._t.police.value = nom;
      bouton.textContent = nom;
      bouton.style.fontFamily = '"' + nom + '", sans-serif';
      liste.querySelectorAll('[data-police]').forEach(function (x) {
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      bloc.classList.remove('on');
      self.chargerPolice(nom);
      self.majTexteActif();
    });

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
    ['taille', 'espacement', 'opacite', 'contourEpaisseur', 'intensite'].forEach(function (r) {
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
        var role = b.getAttribute('data-r');
        if (role === 'al' || role === 'deform') {
          hote.querySelectorAll('[data-r="' + role + '"]').forEach(function (x) {
            x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
          });
          if (role === 'deform') {
            q('blocIntensite').style.display =
              b.getAttribute('data-v') === 'none' ? 'none' : '';
          }
        } else {
          b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        }
        if (b.getAttribute('data-r') === 'contour') {
          var bloc = q('blocContour');
          if (bloc) bloc.classList.toggle('on', b.getAttribute('aria-pressed') === 'true');
        }
        self.majTexteActif();
        return;
      }
      if (e.target.closest && e.target.closest('[data-r="ajouter"]')) self.ajouterTexte();
    });
  };

  /** Réglages courants du panneau. */
  Editeur.prototype._reglagesTexte = function () {
    var h = this.vue;
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
      deformation: (h.querySelector('[data-r="deform"][aria-pressed="true"]') || {}).getAttribute
        ? h.querySelector('[data-r="deform"][aria-pressed="true"]').getAttribute('data-v') : 'none',
      intensite: Number(v('intensite', 35)) || 35,
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
      self._appliquerDeformation(obj, r);
      // On garde la taille demandée au lieu d'étirer le texte à la zone :
      // tout texte ajouté se retrouvait sinon à la dimension maximale, donc
      // facturé au plus grand format quelle que soit la valeur du curseur.
      self.ajusterDansLaZone(obj);
      self.moteur.centrerSeul(obj);
      self.moteur.canvas.requestRenderAll();
      self.chargerPolice(r.police);
      // Le moteur sélectionne l'objet dès qu'il l'ajoute, donc AVANT que le
      // style soit posé : le panneau se recopiait sur un texte encore brut
      // et affichait un alignement à gauche pour un texte centré.
      self.recopierTexte(obj);
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

  /** Délègue au moteur : la géométrie des déformations n'existe qu'à un seul
   *  endroit, sinon un texte courbé rechargé depuis une composition
   *  retrouverait une forme légèrement différente. */
  Editeur.prototype._appliquerDeformation = function (o, r) {
    if (this.moteur) this.moteur.deformer(o, r.deformation, r.intensite);
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
    this._appliquerDeformation(o, r);

    // Le corps se déduit de la HAUTEUR de la zone : un mot long déborde donc
    // en largeur, et une courbure élargit encore l'encombrement. On réduit
    // juste ce qu'il faut pour rester dans la zone. Sans ce garde-fou,
    // toucher n'importe quel réglage faisait ressortir le texte du cadre
    // d'impression — il avait été ajusté à l'ajout, jamais aux retouches.
    this.ajusterDansLaZone(o);

    this.moteur.canvas.requestRenderAll();
    // Le format d'impression vient de la taille : le prix doit suivre le
    // curseur, pas attendre qu'on relâche un objet sur le canevas.
    this.majPrix();
    this.chargerPolice(r.police);
  };

  /**
   * Réduit un objet juste ce qu'il faut pour tenir dans la zone.
   *
   * La mesure se fait sur la BOÎTE ENGLOBANTE et non sur width/height : un
   * cisaillement élargit l'encombrement sans toucher à la largeur propre du
   * texte, et « Penché » ressortait de la zone de quelques pour cent.
   * N'agrandit jamais — la taille choisie reste la taille choisie.
   */
  Editeur.prototype.ajusterDansLaZone = function (o) {
    if (!this.moteur) return;
    var z = this.moteur.zone;
    o.setCoords();
    var b = o.getBoundingRect(true, true);
    var tenir = Math.min(1,
      (z.w * 0.98) / Math.max(1, b.width),
      (z.h * 0.98) / Math.max(1, b.height));
    if (tenir < 1) o.set({ scaleX: (o.scaleX || 1) * tenir, scaleY: (o.scaleY || 1) * tenir });
    o.setCoords();
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
    var corps = this.vue.querySelector('.tsle-body');
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
    }, erreur ? 6000 : 3000);
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
   * Appel au backend — la boutique voyage dans l'EN-TÊTE, jamais en
   * paramètre d'URL.
   *
   * Le serveur redirige vers sa page d'abonnement toute requête portant
   * `?shop=` venant d'une boutique sans souscription active. Le client
   * final, lui, ne souscrit pas : il recevait donc du HTML de facturation
   * à la place du JSON attendu, et la génération IA comme l'ajout au
   * panier échouaient sans rien dire d'utile. Le studio y échappait déjà
   * en passant par l'en-tête ; on fait pareil.
   */
  function api(chemin, options) {
    options = options || {};
    var h = options.headers || {};
    h['X-Shop-Domain'] = boutique();
    options.headers = h;
    options.credentials = 'omit';
    options.mode = 'cors';
    return fetch(BACKEND + chemin, options);
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

    api('/api/products/' + this.produit + '/designs')
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
  };

  // ── Panneau IA ────────────────────────────────────────────────────────────
  //
  // Les réglages de l'onglet IA du studio : en-tête, photo de départ
  // facultative, description, génération, quota, galerie. À une différence
  // près, et elle est voulue : au lieu d'une question de style identique
  // pour tout le monde, le modèle lit la demande et ne réclame que ce qui
  // lui manque réellement.

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

      // Les précisions que l'IA réclame avant de générer. Elles ne sont pas
      // écrites d'avance : le modèle lit la demande et ne pose que ce qui
      // manque vraiment. C'est tout l'écart avec la question de style, qui
      // était la même pour tout le monde et tombait souvent à côté.
      + '<div class="tsle-sousbloc" data-r="blocQuestions" style="margin-top:12px">'
      +   '<div class="tsle-f" style="grid-column:1/-1">'
      +     '<span class="tsle-lab">Deux précisions et c\'est parti</span>'
      +     '<div data-r="questions"></div>'
      +     '<div class="tsle-chips" style="margin-top:12px">'
      +       '<button type="button" class="tsle-chip" data-r="qPasser" style="flex:1">'
      +         'Laisser l\'IA décider</button>'
      +       '<button type="button" class="tsle-chip" data-r="qValider" style="flex:1">Générer</button>'
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
      self.preparerGeneration(hote);
    });
    hote.querySelector('[data-r="qPasser"]').addEventListener('click', function () {
      self.genererIA(hote, []);
    });
    hote.querySelector('[data-r="qValider"]').addEventListener('click', function () {
      self.genererIA(hote, self.lireReponses(hote));
    });
    // Une suggestion remplit le champ de sa question, elle ne génère pas :
    // le client doit pouvoir répondre aux deux avant de lancer.
    hote.querySelector('[data-r="questions"]').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-suggestion]') : null;
      if (!b) return;
      var champ = b.closest('[data-question]').querySelector('input');
      champ.value = b.getAttribute('data-suggestion');
      b.closest('.tsle-chips').querySelectorAll('[data-suggestion]').forEach(function (x) {
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
    });
    // Nouvelle description : les précisions d'avant ne valent plus rien.
    hote.querySelector('[data-r="prompt"]').addEventListener('input', function () {
      hote.querySelector('[data-r="blocQuestions"]').classList.remove('on');
    });

    this.majQuotaIA(hote);
  };

  /**
   * Demande au modèle ce qui manque, puis génère.
   *
   * Avec une photo de départ, la consigne du client EST la précision : on ne
   * lui redemande rien. Et si le service ne répond pas, on génère quand
   * même — des questions sont un confort, pas une condition.
   */
  Editeur.prototype.preparerGeneration = function (hote) {
    var self = this;
    var champTexte = hote.querySelector('[data-r="prompt"]');
    var demande = (champTexte.value || '').trim();
    if (!demande) { champTexte.focus(); return; }

    var bloc = hote.querySelector('[data-r="blocQuestions"]');
    if (this._photoIA || bloc.classList.contains('on')) {
      return this.genererIA(hote, this.lireReponses(hote));
    }

    var btn = hote.querySelector('[data-r="generer"]');
    btn.disabled = true;
    btn.textContent = 'Un instant…';
    var rendre = function () { btn.disabled = false; btn.textContent = 'Générer le design'; };

    jetonClient().then(function (jeton) {
      return api('/api/ai/questions', {
        method: 'POST', headers: enTetesIA(jeton),
        body: JSON.stringify({ prompt: demande }),
      });
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var liste = (d && d.questions) || [];
        rendre();
        if (!liste.length) return self.genererIA(hote, []);
        self.afficherQuestions(hote, liste);
      })
      .catch(function () { rendre(); self.genererIA(hote, []); });
  };

  Editeur.prototype.afficherQuestions = function (hote, liste) {
    hote.querySelector('[data-r="questions"]').innerHTML = liste.map(function (q, i) {
      return '<div data-question="' + esc(q.id) + '"' + (i ? ' style="margin-top:14px"' : '') + '>'
           +   '<span class="tsle-lab">' + esc(q.label) + '</span>'
           +   '<input class="tsle-input" placeholder="Votre réponse">'
           +   (q.suggestions.length
                 ? '<div class="tsle-chips" style="margin-top:8px">'
                   + q.suggestions.map(function (v) {
                       return '<button type="button" class="tsle-chip" data-suggestion="'
                            + esc(v) + '" aria-pressed="false">' + esc(v) + '</button>';
                     }).join('') + '</div>'
                 : '')
           + '</div>';
    }).join('');
    hote.querySelector('[data-r="blocQuestions"]').classList.add('on');
    try { hote.querySelector('[data-r="questions"] input').focus(); } catch (e) {}
  };

  /** Les précisions saisies, dans l'ordre des questions. */
  Editeur.prototype.lireReponses = function (hote) {
    var out = [];
    hote.querySelectorAll('[data-question]').forEach(function (d) {
      var v = (d.querySelector('input').value || '').trim();
      if (v) out.push({ label: d.querySelector('.tsle-lab').textContent, valeur: v });
    });
    return out;
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
      });
    };
    fr.readAsDataURL(f);
  };

  Editeur.prototype.retirerPhotoIA = function (hote) {
    this._photoIA = null;
    hote.querySelector('[data-r="photoVue"]').style.display = 'none';
    hote.querySelector('[data-r="photoZone"]').style.display = '';
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
      return api('/api/ai/quota', { headers: enTetesIA(jeton) });
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(montrer).catch(function () {});
  };

  Editeur.prototype.genererIA = function (hote, reponses) {
    var self = this;
    var champTexte = hote.querySelector('[data-r="prompt"]');
    var demande = (champTexte.value || '').trim();
    if (!demande) { champTexte.focus(); return; }

    reponses = reponses || [];
    hote.querySelector('[data-r="blocQuestions"]').classList.remove('on');

    var btn = hote.querySelector('[data-r="generer"]');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Génération en cours…';
    var fini = function () { btn.disabled = false; btn.textContent = 'Générer le design'; };

    var photo = this._photoIA;
    var chemin, corps;
    if (photo) {
      chemin = '/api/ai/transform';
      corps = { imageBase64: photo, prompt: demande, style: 'cartoon' };
    } else {
      chemin = '/api/ai/dalle';
      // Même enrobage que le studio : la même description doit donner le
      // même visuel, d'où qu'elle parte. Les précisions sont AJOUTÉES à la
      // fin, elles ne remplacent rien — c'est ce qui permet de les comparer
      // à une génération sans elles.
      var texte = 'T-shirt print design: ' + demande
                + '. White background, transparent-ready, bold graphic, print-ready, '
                + 'no text unless explicitly requested.';
      if (reponses.length) {
        texte += '\n\nAdditional requirements:\n'
               + reponses.map(function (r) { return '- ' + r.label + ' ' + r.valeur; }).join('\n');
      }
      corps = { prompt: texte, size: '1024x1024' };
    }

    jetonClient().then(function (jeton) {
      return api(chemin, { method: 'POST', headers: enTetesIA(jeton), body: JSON.stringify(corps) });
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
        api('/api/ai/creations', {
          method: 'POST', headers: enTetesIA(jeton),
          body: JSON.stringify({
            image_base64: src,
            prompt: demande + (reponses.length
              ? ' — ' + reponses.map(function (r) { return r.valeur; }).join(', ') : ''),
          }),
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
    api('/api/qr-frames/public')
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
      return;
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

  // ── Poignées de sélection, clavier et gestes ──────────────────────────────
  //
  // Les mêmes quatre coins que le studio : supprimer, pivoter, dupliquer,
  // redimensionner. Posés une seule fois sur le prototype Fabric, donc
  // valables pour tous les objets, textes compris.

  var TACTILE = ('ontouchstart' in window);
  // Rayon DESSINÉ, en pixels d'écran. Les poignées vivent sur un canevas
  // agrandi par le zoom : à taille fixe en unités de canevas, elles
  // doublaient ou triplaient à l'écran. On divise donc par le zoom courant.
  var RAYON_ECRAN = TACTILE ? 13 : 11;
  // Surface CLIQUABLE : plus large que le dessin sur un écran tactile, où
  // un doigt ne vise pas au pixel près.
  var CIBLE_ECRAN = TACTILE ? 44 : 30;
  var RAYON = RAYON_ECRAN;          // compatibilité : écart de la barre contextuelle
  var _controlesPoses = false;
  var _zoomPoignees = 1;

  function poignee(ctx, couleur, icone) {
    var r = RAYON_ECRAN / (_zoomPoignees || 1);
    var k = r / RAYON_ECRAN;        // les icônes suivent le même facteur
    ctx.save();
    ctx.shadowColor = couleur;
    ctx.shadowBlur = 10 * k;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = couleur;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.beginPath();
    ctx.arc(0, 0, r - 2 * k, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6,6,10,.92)';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 1.7 * k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.scale(k, k);
    icone(ctx);
    ctx.restore();
  }

  var ICONES_P = {
    supprimer: function (c) {
      var s = 5.5;
      c.beginPath(); c.moveTo(-s, -s); c.lineTo(s, s); c.stroke();
      c.beginPath(); c.moveTo(s, -s); c.lineTo(-s, s); c.stroke();
    },
    pivoter: function (c) {
      var s = 5.5;
      c.beginPath(); c.arc(0, 0, s, -Math.PI * 0.8, Math.PI * 0.7); c.stroke();
      c.beginPath();
      c.moveTo(s - 0.5, 3.5); c.lineTo(s + 3, -0.5); c.lineTo(s - 3.5, -0.5);
      c.closePath(); c.fill();
    },
    dupliquer: function (c) {
      var s = 5;
      c.strokeRect(-s + 2, -s + 2, s * 1.5, s * 1.5);
      c.strokeRect(-s - 1, -s - 1, s * 1.5, s * 1.5);
    },
    agrandir: function (c) {
      var s = 5.5;
      c.beginPath(); c.moveTo(-s, -s); c.lineTo(s, s); c.stroke();
      c.beginPath(); c.moveTo(s, s); c.lineTo(s - 3, s); c.lineTo(s, s - 3); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(-s, -s); c.lineTo(-s + 3, -s); c.lineTo(-s, -s + 3); c.closePath(); c.fill();
    },
  };

  function rendu(couleur, icone) {
    return function (ctx, gauche, haut, _style, objet) {
      ctx.save();
      ctx.translate(gauche, haut);
      ctx.rotate(window.fabric.util.degreesToRadians(objet.angle || 0));
      poignee(ctx, couleur, icone);
      ctx.restore();
    };
  }

  Editeur.prototype.poserControles = function () {
    if (_controlesPoses || !window.fabric) return;
    _controlesPoses = true;
    var self = this;
    var F = window.fabric;
    var u = F.controlsUtils || {};

    var surObjet = function (fn) {
      return function () {
        var ed = self;
        var o = ed.moteur && ed.moteur.canvas.getActiveObject();
        if (!o) return false;
        fn(ed, o);
        return true;
      };
    };

    F.Object.prototype.controls = {
      tl: new F.Control({
        x: -0.5, y: -0.5, cursorStyle: 'pointer', cornerSize: CIBLE_ECRAN,
        render: rendu('#ef4444', ICONES_P.supprimer),
        mouseUpHandler: surObjet(function (ed, o) {
          ed.moteur.canvas.discardActiveObject();
          ed.moteur.supprimer(o.__tslId);
          ed.cacherCtx();
        }),
      }),
      tr: new F.Control({
        x: 0.5, y: -0.5, cursorStyle: 'crosshair', actionName: 'rotate',
        cornerSize: CIBLE_ECRAN,
        actionHandler: u.rotationWithSnapping || u.rotationHandler || function () {},
        render: rendu('#60a5fa', ICONES_P.pivoter),
      }),
      bl: new F.Control({
        x: -0.5, y: 0.5, cursorStyle: 'copy', cornerSize: CIBLE_ECRAN,
        render: rendu('#a78bfa', ICONES_P.dupliquer),
        mouseUpHandler: surObjet(function (ed, o) { ed.dupliquerCalque(o.__tslId); }),
      }),
      br: new F.Control({
        x: 0.5, y: 0.5, cursorStyle: 'nwse-resize', actionName: 'scale',
        cornerSize: CIBLE_ECRAN,
        actionHandler: u.scalingEqually || u.scaleEqually || function () {},
        render: rendu('#f59e0b', ICONES_P.agrandir),
      }),
    };

    // Pas de poignées latérales : elles déforment, et un visuel déformé
    // s'imprime déformé.
    F.Object.prototype.setControlsVisibility({
      mt: false, mb: false, ml: false, mr: false, mtr: false,
    });
    F.Object.prototype.set({
      borderColor: 'rgba(245,158,11,.85)',
      borderDashArray: [6, 4],
      borderScaleFactor: 1.5,
      transparentCorners: false,
      hasRotatingPoint: false,
    });
    if (F.IText) F.IText.prototype.controls = F.Object.prototype.controls;
    this.majTaillePoignees(1);
  };

  /**
   * Accorde les poignées au zoom.
   *
   * Dessin ET surface cliquable sont exprimés en pixels d'ÉCRAN : sans
   * cette division, une poignée de 30 px devenait un disque de 70 px dès
   * qu'on zoomait, au point de recouvrir le visuel.
   */
  Editeur.prototype.majTaillePoignees = function (zoom) {
    if (!window.fabric) return;
    _zoomPoignees = Math.max(0.2, zoom || 1);
    var taille = CIBLE_ECRAN / _zoomPoignees;
    var c = window.fabric.Object.prototype.controls || {};
    Object.keys(c).forEach(function (k) { c[k].cornerSize = taille; });
    window.fabric.Object.prototype.cornerSize = taille;
    if (this.moteur) this.moteur.canvas.requestRenderAll();
  };

  /**
   * Flèches pour déplacer, Suppr pour effacer.
   *
   * Seulement quand un outil est ouvert ET qu'on ne saisit pas du texte :
   * sans cette double condition, taper « Winshirt » dans le champ déplacerait
   * le calque à chaque flèche.
   */
  Editeur.prototype.brancherClavier = function () {
    var self = this;
    if (this._clavierBranche) return;
    this._clavierBranche = true;

    document.addEventListener('keydown', function (e) {
      if (!self.outil || !self.moteur) return;
      var cible = e.target;
      var tag = cible && cible.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
          || (cible && cible.isContentEditable)) return;

      var o = self.moteur.canvas.getActiveObject();
      if (!o) return;
      // Un texte en cours d'édition dans le canevas garde ses touches.
      if (o.isEditing) return;

      var pas = e.shiftKey ? 10 : 1;
      var dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -pas;
      else if (e.key === 'ArrowRight') dx = pas;
      else if (e.key === 'ArrowUp') dy = -pas;
      else if (e.key === 'ArrowDown') dy = pas;
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        self.moteur.canvas.discardActiveObject();
        self.moteur.supprimer(o.__tslId);
        self.cacherCtx();
        return;
      } else return;

      e.preventDefault();
      o.set({ left: (o.left || 0) + dx, top: (o.top || 0) + dy });
      o.setCoords();
      self.moteur.canvas.requestRenderAll();
      self.placerCtx();
    });
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
      // 20000 ≈ 141×141 : au-dessus des vignettes de galerie, en dessous
      // de la photo principale d'un téléphone étroit, qui était écartée.
      if (a > 20000 && a > aire) { aire = a; meilleure = imgs[i]; }
    }
    return meilleure;
  }

  Editeur.prototype.prepareScene = function () {
    var self = this;
    if (this._scenePrete) return this._scenePrete;

    var zone = this.zoneCalibree
      ? Promise.resolve(this.zoneCalibree)
      : api('/api/products/' + this.produit + '/display-zone')
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });

    this._scenePrete = Promise.all([
      charger(FABRIC).then(function () { return charger(BACKEND + '/tsl-engine.js'); }),
      zone,
    ]).then(function (res) {
      self.zoneCalibree = res[1] && res[1].exists ? res[1] : null;
      self.faces = (res[1] && res[1].faces) || [];
      self.tarif = (res[1] && res[1].tarif) || null;
      return self._monterCanvas();
    });
    return this._scenePrete;
  };

  Editeur.prototype._monterCanvas = function () {
    var img = imageProduit();
    if (!img || !window.fabric || !window.TSLEngine) return null;

    // Le conteneur retenu doit être une BOÎTE : beaucoup de galeries
    // enveloppent leur image dans un <picture>, qui est en ligne — on ne
    // peut ni le positionner, ni lui donner une hauteur, ni y rogner quoi
    // que ce soit. On remonte jusqu'au premier élément de bloc.
    var hote = img.parentElement;
    while (hote && hote.parentElement && getComputedStyle(hote).display === 'inline') {
      hote = hote.parentElement;
    }
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
    this.poserControles();
    this.brancherClavier();

    // La galerie du thème écoute les gestes sur un parent. Un glissement
    // vers la gauche y passait pour un balayage : on déplaçait un calque et
    // c'est le carrousel qui partait à la photo suivante. On laisse Fabric
    // traiter l'évènement — il est plus bas, donc servi en premier — puis
    // on l'arrête avant qu'il ne remonte jusqu'au thème.
    // SEULEMENT l'appui initial. Arrêter aussi les mouvements était une
    // faute : dès qu'un glissement commence, Fabric écoute `pointermove` et
    // `touchmove` sur le DOCUMENT. Les bloquer ici revenait à lui couper la
    // main — on pouvait appuyer, jamais déplacer ni redimensionner. Invisible
    // sur bureau, où la souris passe par d'autres évènements ; bloquant au
    // doigt. Couper l'appui suffit de toute façon : une galerie qui n'a pas
    // vu le début d'un geste ne le suivra pas.
    ['pointerdown', 'mousedown', 'touchstart', 'dragstart'].forEach(function (ev) {
      scene.addEventListener(ev, function (e) {
        if (scene.classList.contains('actif')) e.stopPropagation();
      });
    });

    this._placerScene();
    var dims = this._dimensions();
    cnv.width = dims.largeur; cnv.height = dims.hauteur;
    this.moteur = new window.TSLEngine.Moteur(cnv, { zone: dims.zone });
    this._placerCadre(dims.zone);

    // La photo change de taille (chargement, redimensionnement, variante) :
    // le canevas et la zone doivent suivre, sinon le design dérive.
    var self = this;
    var c = this.moteur.canvas;
    c.on('selection:created', function () { self.surSelection(); });
    c.on('selection:updated', function () { self.surSelection(); });
    c.on('selection:cleared', function () { self.cacherCtx(); });
    // Le prix dépend de la taille imprimée : tout geste qui la change doit
    // le mettre à jour, sinon le client découvre le surcoût au panier.
    ['object:added', 'object:removed', 'object:modified']
      .forEach(function (ev) { c.on(ev, function () { self.majPrix(); }); });
    ['object:moving', 'object:scaling', 'object:rotating', 'object:modified']
      .forEach(function (ev) { c.on(ev, function () { self.placerCtx(); }); });
    // Écouteurs liés à CE canevas : ils sont retenus pour être retirés au
    // remontage. Sans ça, chaque changement de coloris en ajoutait une
    // série de plus, toutes actives sur des canevas morts — c'est le genre
    // d'accumulation qui finit par faire ramer la page sans rien casser de
    // visible.
    var auDefilement = function () { self.placerCtx(); };
    var suivre = function () { self.recalerScene(); };
    window.addEventListener('scroll', auDefilement, { passive: true });
    window.addEventListener('resize', suivre);
    var observateur = null;
    if (window.ResizeObserver) {
      observateur = new ResizeObserver(suivre);
      observateur.observe(img);
    }
    this._detacherScene = function () {
      window.removeEventListener('scroll', auDefilement);
      window.removeEventListener('resize', suivre);
      if (observateur) observateur.disconnect();
    };

    this.monterFaces();
    return this.moteur;
  };

  /** Remet canevas, zone, cadre et barres en accord avec la photo affichée. */
  Editeur.prototype.recalerScene = function () {
    if (!this.moteur) return;
    this._placerScene();
    this.calerBarre();
    this.placerCtx();
    var d = this._dimensions();
    this.moteur.canvas.setDimensions({ width: d.largeur, height: d.hauteur });
    this.moteur.definirZone(d.zone);
    this._placerCadre(d.zone);
  };

  // ── Recto / verso ─────────────────────────────────────────────────────────
  //
  // Une face, c'est une photo du produit sur laquelle le marchand a calibré
  // une zone. Deux zones calibrées valent donc deux faces à imprimer, et le
  // format de composition en accepte exactement deux.

  var NOM_FACE = { front: 'Recto', back: 'Verso' };

  Editeur.prototype.monterFaces = function () {
    var self = this;
    if (!this.faces || this.faces.length < 2 || this.selFaces) return;

    var el = document.createElement('div');
    el.className = 'tsle-faces';
    el.innerHTML = this.faces.map(function (f) {
      return '<button type="button" class="tsle-face" data-face="' + f.face + '" '
           +   'aria-pressed="' + (f.face === 'front' ? 'true' : 'false') + '">'
           +   esc(NOM_FACE[f.face] || f.face) + '</button>';
    }).join('');
    el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-face]') : null;
      if (b) self.changerFace(b.getAttribute('data-face'));
    });
    this.barre.insertBefore(el, this.barre.firstChild);
    this.selFaces = el;

    // Les deux photos sont mises en cache dès maintenant : la bascule doit
    // être instantanée, pas lancer un téléchargement.
    this.faces.forEach(function (f) { if (f.url) { var i = new Image(); i.src = f.url; } });
  };

  Editeur.prototype.changerFace = function (face) {
    var self = this;
    if (!this.moteur || this.moteur.face === face || this._bascule) return;
    var cible = null;
    this.faces.forEach(function (f) { if (f.face === face) cible = f; });
    if (!cible) return;

    // On ne bascule qu'une fois la photo prête à peindre : calques et image
    // changent alors dans la même image-écran, sans montrer l'un sans
    // l'autre. Et une bascule à la fois — les clics répétés attendent.
    this._bascule = true;
    // Filet : un chargement qui n'aboutit jamais ne doit pas condamner le
    // sélecteur de face pour le reste de la visite.
    clearTimeout(this._filetBascule);
    this._filetBascule = setTimeout(function () { self._bascule = false; }, 4000);
    prete(cible.url).then(function () { self._basculerVers(face, cible); });
  };

  Editeur.prototype._basculerVers = function (face, cible) {
    var self = this;
    this.moteur.changerFace(face, function () {
      self._bascule = false;
      self.recalerScene();
      if (self.outil) self.zoomerSurLaZone(true);
      self.cacherCtx();
      if (self.selFaces) {
        self.selFaces.querySelectorAll('[data-face]').forEach(function (b) {
          b.setAttribute('aria-pressed', b.getAttribute('data-face') === face ? 'true' : 'false');
        });
      }
    }, function () {
      // Entre la sauvegarde de l'ancienne face et le chargement de la
      // nouvelle : c'est le seul moment où changer de zone ne décale rien.
      self.zoneCalibree = { exists: true, corners: cible.corners };
      self.montrerPhotoDeFace(cible.url);
      self.recalerScene();
    });
  };

  /**
   * Affiche la photo d'une face à la place de celle du thème.
   *
   * On remplace la source plutôt que de piloter la galerie : son balisage
   * change d'un thème à l'autre, alors que l'image, elle, est toujours là.
   * L'original est mémorisé une fois pour toutes — jamais écrasé par les
   * substitutions successives — et rendu à la fermeture.
   */
  /**
   * Impose une image, quoi qu'en dise le thème.
   * ──────────────────────────────────────────────────────────────────────
   * Changer `src` ne suffit pas : dans un <picture>, ce sont les <source>
   * qui décident, et l'attribut `srcset` de l'image elle-même passe avant
   * `src`. Une galerie bâtie ainsi gardait donc la photo du recto pendant
   * qu'on croyait afficher le verso — les calques basculaient, l'image non.
   *
   * Les valeurs d'origine sont mémorisées une seule fois, au premier
   * remplacement, pour pouvoir rendre la galerie intacte à la fermeture.
   */
  function imposerSource(img, url) {
    if (!img || !url) return;
    if (!img.__tslOrigine) {
      img.__tslOrigine = { src: img.currentSrc || img.src, srcset: img.getAttribute('srcset') || '' };
    }
    var pic = img.closest ? img.closest('picture') : null;
    if (pic) {
      pic.querySelectorAll('source').forEach(function (so) {
        if (so.__tslSrcset === undefined) so.__tslSrcset = so.getAttribute('srcset') || '';
        so.setAttribute('srcset', url);
      });
    }
    img.setAttribute('srcset', '');
    img.src = url;
  }

  /** Rend à la galerie ses propres sources. */
  function rendreSource(img) {
    if (!img || !img.__tslOrigine) return;
    var pic = img.closest ? img.closest('picture') : null;
    if (pic) {
      pic.querySelectorAll('source').forEach(function (so) {
        if (so.__tslSrcset !== undefined) { so.setAttribute('srcset', so.__tslSrcset); so.__tslSrcset = undefined; }
      });
    }
    img.setAttribute('srcset', img.__tslOrigine.srcset);
    img.src = img.__tslOrigine.src;
  }

  /**
   * Attend qu'une image soit chargée ET décodée.
   *
   * Sans cette attente, la bascule de face changeait les calques tout de
   * suite et la photo quelques dixièmes de seconde plus tard : on voyait
   * le visuel du verso sur la photo du recto. `decode()` garantit que
   * l'image est prête à peindre, pas seulement reçue.
   */
  function prete(url) {
    return new Promise(function (ok) {
      if (!url) return ok();
      var i = new Image();
      var fini = function () { ok(); };
      i.onload = function () {
        if (i.decode) i.decode().then(fini, fini); else fini();
      };
      i.onerror = fini;
      i.src = url;
      // Filet : une image qui ne répond pas ne doit pas bloquer la bascule.
      setTimeout(fini, 2500);
    });
  }

  /** URL ramenée en absolu, sans paramètres — pour comparer deux sources. */
  function absolu(u) {
    if (!u) return '';
    var a = document.createElement('a');
    a.href = u;
    return a.href.split('?')[0];
  }

  Editeur.prototype.montrerPhotoDeFace = function (url) {
    var img = this.imageProduit;
    if (!img || !url) return;
    if (!img.__tslOrigine) {
      img.__tslOrigine = { src: img.currentSrc || img.src, srcset: img.getAttribute('srcset') || '' };
    }
    this._faceUrl = url;
    imposerSource(img, url);

    // Certaines galeries de thème réimposent leur propre source après coup.
    // On vérifie donc que la photo a bien changé, et on insiste une fois :
    // sans ça la bascule change les calques mais pas la vue, et on croit
    // que le verso ne marche pas.
    var self = this;
    clearTimeout(this._gardePhoto);
    this._gardePhoto = setTimeout(function () {
      if (self._faceUrl !== url) return;
      // Les deux formes sont ramenées en absolu avant comparaison : une URL
      // relative et la même en absolu désignent le même fichier, et les
      // confondre déclenchait l'alerte pour rien.
      if (absolu(img.getAttribute('src')) === absolu(url)) return;
      console.info('[TSL] La galerie du thème a repris la main sur la photo — on repose la face.');
      imposerSource(img, url);
    }, 500);
  };

  /**
   * Un élément vient d'être sélectionné sur le vêtement.
   *
   * Chaque type ouvre son outil. Pour un texte, ses propres réglages sont
   * chargés dans le panneau — sans cette recopie, le premier caractère tapé
   * écraserait sa police, sa taille et sa couleur par celles du panneau,
   * qui dataient du texte précédent.
   */
  Editeur.prototype.surSelection = function () {
    var o = this.moteur && this.moteur.canvas.getActiveObject();
    if (!o) return this.cacherCtx();
    var outil = o.__tslType === 'text' ? 'text' : 'image';
    if (this.outil !== outil && this.outils.indexOf(outil) >= 0) this.ouvrir(outil);
    if (o.__tslType === 'text') this.recopierTexte(o);
    this.montrerCtx(o);
  };

  /** Recopie les propriétés d'un texte sélectionné dans le panneau. */
  Editeur.prototype.recopierTexte = function (o) {
    var h = this.vue.querySelector('.tsle-panel[data-panneau="text"]');
    if (!h || !h.__rempli || !this._t) return;
    var q = function (r) { return h.querySelector('[data-r="' + r + '"]'); };
    var poser = function (r, v) { var e = q(r); if (e) e.value = v; };
    var presser = function (r, v) { var e = q(r); if (e) e.setAttribute('aria-pressed', v ? 'true' : 'false'); };

    poser('texte', o.text || '');
    var c = q('compteur');
    if (c) c.textContent = (o.text || '').length + '/' + MAX_CARACTERES;
    poser('police', o.fontFamily || 'Montserrat');
    var bp = q('policeBtn');
    if (bp) {
      bp.textContent = o.fontFamily || 'Montserrat';
      bp.style.fontFamily = '"' + (o.fontFamily || 'Montserrat') + '", sans-serif';
    }
    poser('couleur', typeof o.fill === 'string' && o.fill.charAt(0) === '#' ? o.fill : '#111114');
    presser('gras', o.fontWeight === 'bold' || o.fontWeight === 700);
    presser('italique', o.fontStyle === 'italic');
    presser('souligne', !!o.underline);
    h.querySelectorAll('[data-r="al"]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-v') === (o.textAlign || 'center') ? 'true' : 'false');
    });

    // La taille du panneau est une part de la hauteur de zone, pas des pixels.
    var zone = this.moteur.zone;
    var pct = Math.round((o.fontSize || 40) / (zone.h || 1) * 100);
    poser('taille', Math.min(100, Math.max(5, pct)));
    poser('tailleVal', Math.min(100, Math.max(5, pct)));
    poser('espacement', Math.round(o.charSpacing || 0));
    poser('espacementVal', Math.round(o.charSpacing || 0));
    var op = Math.round((typeof o.opacity === 'number' ? o.opacity : 1) * 100);
    poser('opacite', op); poser('opaciteVal', op);
    presser('contour', !!(o.stroke && o.strokeWidth));
    if (o.stroke && String(o.stroke).charAt(0) === '#') poser('contourCouleur', o.stroke);
    if (o.strokeWidth) { poser('contourEpaisseur', Math.round(o.strokeWidth)); poser('contourEpaisseurVal', Math.round(o.strokeWidth)); }
    presser('ombre', !!o.shadow);
    var deform = o.__tslDeform || 'none';
    h.querySelectorAll('[data-r="deform"]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-v') === deform ? 'true' : 'false');
    });
    poser('intensite', o.__tslDeformInt || 35);
    poser('intensiteVal', o.__tslDeformInt || 35);
    var bi = q('blocIntensite');
    if (bi) bi.style.display = deform === 'none' ? 'none' : '';
    var bloc = q('blocContour');
    if (bloc) bloc.classList.toggle('on', !!(o.stroke && o.strokeWidth));

    // Le bouton d'ajout change de sens : tant qu'un texte est sélectionné,
    // la saisie le MODIFIE. Sans ce changement, taper puis « Ajouter »
    // renommait l'existant et en créait un second avec le même contenu.
    var b = q('ajouter');
    if (b) b.textContent = 'Ajouter un autre texte';
  };

  /**
   * Redemande la photo dans une définition adaptée au zoom.
   *
   * Le thème sert un cliché dimensionné pour l'affichage normal ; agrandi
   * deux fois, il devient mou. Le CDN Shopify sait en servir un plus grand
   * à la demande. On ne touche qu'aux URL de ce CDN — ailleurs on ne sait
   * pas ce qu'un paramètre de largeur provoquerait — et l'original est
   * remis en place à la fermeture.
   */
  Editeur.prototype.affinerPhoto = function (facteur) {
    var img = this.imageProduit;
    if (!img) return;
    if (!img.__tslOrigine) {
      img.__tslOrigine = { src: img.currentSrc || img.src, srcset: img.getAttribute('srcset') || '' };
    }

    if (!facteur) {
      // Fin d'édition : la galerie du thème reprend ses sources. La face
      // choisie est conservée — rouvrir un outil doit retrouver le verso.
      rendreSource(img);
      return;
    }

    var base = this._faceUrl || img.__tslOrigine.src;
    if (!/\/\/cdn\.shopify\.com\//.test(base)) {
      if (absolu(img.getAttribute('src')) !== absolu(base)) imposerSource(img, base);
      return;
    }
    var vise = Math.min(4000, Math.ceil(img.offsetWidth
                                        * facteur * (window.devicePixelRatio || 1)));
    var cible = base.split('?')[0] + '?width=' + vise;
    if (absolu(img.getAttribute('src')) === absolu(cible)) return;

    // On n'impose la version haute définition qu'une fois reçue : posée
    // tout de suite, elle laissait la photo vide le temps du chargement.
    // L'agrandissement, lui, est immédiat — c'est une transformation.
    var self = this;
    this._hdAttendu = cible;
    prete(cible).then(function () {
      if (self._hdAttendu !== cible) return;   // un autre zoom a pris la main
      // Les sources du thème sont écrasées le temps du zoom : laissées en
      // place, le navigateur retomberait aussitôt sur une image étroite.
      imposerSource(img, cible);
    });
  };

  /**
   * La photo a-t-elle été remplacée sous nos pieds ?
   *
   * Changer de coloris fait reconstruire la colonne média par le thème : la
   * nouvelle photo est un autre nœud, et le calque d'édition s'en va avec
   * l'ancienne — le client voyait sa composition disparaître. On remonte
   * donc le canevas sur la nouvelle photo et on y REMET la composition.
   *
   * Elle est relue avant démontage, et non conservée au fil de l'eau : la
   * seule version qui fasse autorité est celle du canevas à cet instant.
   */
  Editeur.prototype.verifierScene = function () {
    var self = this;
    if (!this.moteur || this._remonte) return;
    var img = imageProduit();
    if (!img) return;
    if (this.scene && this.scene.isConnected && this.imageProduit === img) return;

    this._remonte = true;
    var composition = this.moteur.exporterComposition();
    var face = this.moteur.face;

    if (this._detacherScene) { this._detacherScene(); this._detacherScene = null; }
    if (this.moteur.canvas) { try { this.moteur.canvas.dispose(); } catch (e) {} }
    if (this.scene && this.scene.parentNode) this.scene.parentNode.removeChild(this.scene);
    this.scene = null;
    this.moteur = null;
    this._scenePrete = null;
    this.affinerPhoto(0);            // rendre son `src` d'origine à l'ancienne photo
    this._faceUrl = null;            // les URL de faces étaient celles de l'ancien coloris
    this.faces = [];
    if (this.selFaces && this.selFaces.parentNode) {
      this.selFaces.parentNode.removeChild(this.selFaces);
      this.selFaces = null;
    }
    this._surplusHote = undefined;   // l'ancien conteneur n'est plus le nôtre
    this._densite = null;
    this.cacherCtx();

    this.prepareScene().then(function () {
      self._remonte = false;
      if (!self.moteur) return;
      self.moteur.chargerComposition(composition, face, function () {
        if (!self.outil) return;
        self.scene.classList.add('actif');
        self.zoomerSurLaZone(true);
      });
    }).catch(function () { self._remonte = false; });
  };

  /**
   * Densité du canevas pendant le zoom.
   *
   * Le canevas garde la taille de la photo à l'écran, mais l'agrandissement
   * CSS étire ses pixels : un visuel en 4000 px se retrouvait rendu dans
   * 756 px puis grossi presque deux fois, d'où le flou alors que la source
   * est parfaitement nette. On multiplie donc sa définition interne par le
   * facteur de zoom — sa taille affichée, elle, ne change pas.
   */
  Editeur.prototype.definitionCanevas = function (facteur) {
    if (!this.moteur || !window.fabric) return;
    var base = window.devicePixelRatio || 1;
    var vise = base * Math.max(1, facteur || 1);
    if (this._densite === vise) return;
    this._densite = vise;
    window.fabric.devicePixelRatio = vise;
    var d = this._dimensions();
    this.moteur.canvas.setDimensions({ width: d.largeur, height: d.hauteur });
    this.moteur.canvas.requestRenderAll();
  };

  /** Cale le calque d'édition sur la photo, à l'intérieur de son conteneur. */
  /**
   * Position d'un élément dans un de ses ancêtres, en pixels de MISE EN PAGE.
   *
   * `offsetLeft` ignore les transformations, contrairement au rectangle
   * d'affichage. C'est tout l'enjeu ici : la photo est agrandie pendant
   * l'édition, et la mesurer telle qu'elle apparaît revenait à réappliquer
   * le zoom à chaque recalcul. Le facteur se multipliait par lui-même, le
   * visuel grossissait sans fin et le vêtement semblait bouger tout seul.
   */
  function decalageDans(el, hote) {
    var x = 0, y = 0, n = el;
    while (n && n !== hote) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x: x, y: y };
  }

  Editeur.prototype._placerScene = function () {
    var hote = this.scene && this.scene.parentElement;
    var img = this.imageProduit;
    if (!hote || !img) return;
    var d = decalageDans(img, hote);
    this.scene.style.left = Math.round(d.x) + 'px';
    this.scene.style.top = Math.round(d.y) + 'px';
    this.scene.style.width = Math.round(img.offsetWidth) + 'px';
    this.scene.style.height = Math.round(img.offsetHeight) + 'px';
  };

  /** Taille du canevas et zone d'édition, en pixels de la photo affichée. */
  Editeur.prototype._dimensions = function () {
    // Dimensions de MISE EN PAGE, jamais celles affichées : le zoom est une
    // transformation, et la reprendre dans la mesure la rendrait cumulative.
    var largeur = Math.max(1, Math.round(this.imageProduit.offsetWidth));
    var hauteur = Math.max(1, Math.round(this.imageProduit.offsetHeight));

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

  // ── Barre contextuelle ────────────────────────────────────────────────────
  //
  // Les mêmes gestes que dans le studio, posés au-dessus de l'élément
  // sélectionné : les actions les plus fréquentes ne doivent pas obliger à
  // aller les chercher dans un panneau.

  var ICO_CTX = {
    copier:  '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    monter:  '<path d="M12 19V5m0 0-6 6m6-6 6 6"/>',
    baisser: '<path d="M12 5v14m0 0 6-6m-6 6-6-6"/>',
    jeter:   '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/>',
    fond:    '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.1 7.9 20 20M8.1 16.1 20 4"/>',
    // Gouttes barrées : rendre au visuel ses couleurs d'origine.
    teinteOff: '<path d="M12 3s5 6 5 10a5 5 0 0 1-10 0c0-4 5-10 5-10z"/><path d="M4 4l16 16"/>',
  };

  var DIMS_MM = { A3: '297×420', A4: '210×297', A5: '148×210', A6: '105×148' };

  /**
   * Taille réelle d'un objet, en millimètres et en format.
   *
   * Même échelle que la tarification : c'est la largeur physique de la zone
   * qui convertit. Le client doit voir ce qu'il achète — passer de A6 à A5
   * en tirant une poignée doit se lire, pas se deviner au moment du panier.
   */
  Editeur.prototype.tailleImprimee = function (o) {
    if (!this.moteur || !this.tarif || !o) return null;
    var z = this.moteur.zone;
    var Lmm = Number((this.tarif.largeurMm || {})[this.moteur.face]) || 420;
    var Hmm = Lmm / ((z.w / z.h) || 1);
    var b = o.getBoundingRect(true, true);
    var mmW = Math.round(b.width / z.w * Lmm);
    var mmH = Math.round(b.height / z.h * Hmm);
    var mm = Math.max(mmW, mmH);
    var fmt = mm >= 297 ? 'A3' : mm >= 210 ? 'A4' : mm >= 148 ? 'A5' : 'A6';
    return { mmW: mmW, mmH: mmH, format: fmt };
  };

  Editeur.prototype.creerCtx = function () {
    if (this.ctx) return this.ctx;
    var self = this;
    var d = document.createElement('div');
    d.className = 'tsle-ctx';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-ctx]') : null;
      if (b) { e.preventDefault(); self.actionCtx(b.getAttribute('data-ctx')); }
    });
    d.addEventListener('input', function (e) {
      var r = e.target.getAttribute('data-ctx');
      if (r === 'couleur' || r === 'teinte') self.actionCtx(r, e.target.value);
    });
    this.ctx = d;
    return d;
  };

  Editeur.prototype.cacherCtx = function () {
    if (this.ctx) this.ctx.classList.remove('on');
  };

  Editeur.prototype.montrerCtx = function (o) {
    var d = this.creerCtx();
    var texte = o.__tslType === 'text';
    var bouton = function (act, forme, titre, danger) {
      return '<button type="button" class="tsle-cb' + (danger ? ' danger' : '') + '" data-ctx="' + act + '" '
           +   'title="' + esc(titre) + '" aria-label="' + esc(titre) + '">'
           +   '<svg viewBox="0 0 24 24" aria-hidden="true">' + forme + '</svg></button>';
    };
    var html = '';
    if (texte) {
      html += '<button type="button" class="tsle-cb" data-ctx="gras" title="Gras"'
            + (o.fontWeight === 'bold' ? ' aria-pressed="true"' : '') + '><b>B</b></button>'
            + '<button type="button" class="tsle-cb" data-ctx="italique" title="Italique"'
            + (o.fontStyle === 'italic' ? ' aria-pressed="true"' : '') + '><i>I</i></button>'
            + '<span class="tsle-cs"></span>'
            + '<button type="button" class="tsle-cb" data-ctx="moins" title="Réduire">A−</button>'
            + '<button type="button" class="tsle-cb" data-ctx="plus" title="Agrandir">A+</button>'
            + '<input type="color" class="tsle-cc" data-ctx="couleur" title="Couleur du texte" value="'
            + esc(typeof o.fill === 'string' && o.fill.charAt(0) === '#' ? o.fill : '#111114') + '">'
            + '<span class="tsle-cs"></span>';
    } else {
      // Un visuel d'une seule couleur — pictogramme, logo, code-barres — doit
      // pouvoir s'accorder au vêtement. La teinte ne garde du dessin que sa
      // transparence, donc elle n'a de sens que sur du monochrome ; on la
      // propose quand même sur tout visuel, c'est au client de juger.
      var teinte = this.moteur.teinteDe(o);
      html += bouton('fond', ICO_CTX.fond, 'Détourer le fond')
            + '<input type="color" class="tsle-cc" data-ctx="teinte"'
            +   ' title="Couleur du visuel" value="' + esc(teinte || '#111114') + '">'
            + (teinte
                ? bouton('teinteOff', ICO_CTX.teinteOff, 'Couleurs d\'origine')
                : '')
            + '<span class="tsle-cs"></span>';
    }
    var t = this.tailleImprimee(o);
    if (t) {
      html += '<span class="tsle-cfmt" data-ctx-taille>'
            +   '<b>' + t.format + '</b> ' + t.mmW + '×' + t.mmH + ' mm'
            + '</span><span class="tsle-cs"></span>';
    }
    html += bouton('copier', ICO_CTX.copier, 'Dupliquer')
          + bouton('monter', ICO_CTX.monter, 'Vers l\'avant')
          + bouton('baisser', ICO_CTX.baisser, 'Vers l\'arrière')
          + '<span class="tsle-cs"></span>'
          + bouton('jeter', ICO_CTX.jeter, 'Supprimer', true);
    d.innerHTML = html;
    d.classList.add('on');
    this.placerCtx();
  };

  /**
   * Place la barre au-dessus de l'élément.
   *
   * Les coordonnées passent par le rectangle du canevas À L'ÉCRAN, pas par
   * sa taille interne : la photo est agrandie en CSS pendant l'édition, et
   * le rapport entre les deux est précisément ce zoom.
   */
  Editeur.prototype.placerCtx = function () {
    if (!this.ctx || !this.ctx.classList.contains('on') || !this.moteur) return;
    var o = this.moteur.canvas.getActiveObject();
    if (!o) return this.cacherCtx();
    var el = this.moteur.canvas.upperCanvasEl;
    var rc = el.getBoundingClientRect();
    var e = rc.width / (this.moteur.canvas.getWidth() || 1);
    var br = o.getBoundingRect(true);
    var x = rc.left + window.scrollX + (br.left + br.width / 2) * e;
    // On s'écarte du rayon d'une poignée : collée, la barre recouvrait la
    // croix de suppression et le bouton de rotation.
    var y = rc.top + window.scrollY + br.top * e - (RAYON + 14);
    this.ctx.style.left = Math.round(x) + 'px';
    this.ctx.style.top = Math.round(Math.max(window.scrollY + 6, y - this.ctx.offsetHeight)) + 'px';

    // Le format se lit pendant qu'on tire la poignée, pas une fois lâchée.
    var badge = this.ctx.querySelector('[data-ctx-taille]');
    var t = this.tailleImprimee(o);
    if (badge && t) badge.innerHTML = '<b>' + t.format + '</b> ' + t.mmW + '×' + t.mmH + ' mm';
  };

  Editeur.prototype.actionCtx = function (act, valeur) {
    var self = this;
    var c = this.moteur && this.moteur.canvas;
    var o = c && c.getActiveObject();
    if (!o) return;
    var id = o.__tslId;

    if (act === 'jeter') { this.moteur.supprimer(id); return this.cacherCtx(); }
    if (act === 'copier') return this.dupliquerCalque(id);
    if (act === 'monter' || act === 'baisser') {
      this.deplacerCalque(id, act === 'monter' ? 1 : -1);
      c.setActiveObject(o).requestRenderAll();
      return;
    }
    if (act === 'fond') {
      // Le détourage vit dans le panneau Images : on l'ouvre, et on attend
      // qu'il soit réellement construit plutôt que de parier sur un délai.
      this.ouvrir('image');
      return Promise.resolve(this.remplirPanneau('image')).then(function (hote) {
        if (hote) { c.setActiveObject(o); self.ouvrirDetourage(hote); }
      });
    }

    if (act === 'gras') o.set('fontWeight', o.fontWeight === 'bold' ? 'normal' : 'bold');
    else if (act === 'italique') o.set('fontStyle', o.fontStyle === 'italic' ? 'normal' : 'italic');
    else if (act === 'moins' || act === 'plus') {
      var pas = Math.max(1, Math.round((o.fontSize || 40) * 0.08));
      o.set('fontSize', Math.max(6, (o.fontSize || 40) + (act === 'plus' ? pas : -pas)));
      o.set({ scaleX: 1, scaleY: 1 });
    } else if (act === 'couleur') o.set('fill', valeur);
    else if (act === 'teinte') this.moteur.teinter(o, valeur);
    else if (act === 'teinteOff') this.moteur.teinter(o, '');

    c.requestRenderAll();
    this.recopierTexte(o);
    this.montrerCtx(o);
    this.majPrix();
  };

  // ── Coloris ───────────────────────────────────────────────────────────────

  /**
   * Repère l'option « couleur » dans les variantes.
   *
   * Il n'y a plus de pastilles à nous : le panneau remplace la colonne et le
   * nuancier du thème revient dès qu'on referme. On garde seulement l'indice,
   * qui sert à nommer le coloris sur la commande.
   */
  Editeur.prototype.reperColoris = function () {
    var iCouleur = -1;
    ((this.donnees && this.donnees.optionNames) || []).forEach(function (n, i) {
      if (/couleur|colou?r/i.test(n)) iCouleur = i;
    });
    this.iCouleur = iCouleur;
  };

  // ── Tarification ──────────────────────────────────────────────────────────
  //
  // Calquée sur le studio, au millimètre près et avec les mêmes montants :
  // un même visuel doit coûter la même chose qu'on le compose ici ou là-bas.
  //
  // L'échelle vient d'une seule donnée, `printWidthMm` — la largeur physique
  // de la zone d'impression du mockup, calibrée en admin. Elle suffit, parce
  // que les calques sont enregistrés en FRACTIONS de zone : une largeur de
  // 0,5 vaut la moitié de la zone, donc la moitié de sa largeur réelle. Le
  // fait que la photo soit en perspective ne change rien — la zone désigne
  // la même surface physique dans les deux cas.

  var SEUILS_MM = [['A3', 297], ['A4', 210], ['A5', 148], ['A6', 0]];

  Editeur.prototype.surchargeImpression = function () {
    if (!this.moteur || !this.tarif) return { total: 0, detail: [] };
    var bareme = this.tarif.formats || {};
    var largeurs = this.tarif.largeurMm || {};
    var comp = this.moteur.exporterComposition();
    var detail = [], total = 0;

    Object.keys(comp.faces).forEach(function (face) {
      var calques = (comp.faces[face] && comp.faces[face].layers) || [];
      if (!calques.length) return;

      var Lmm = Number(largeurs[face]) || 420;
      var rapport = (comp.faces[face].zone && comp.faces[face].zone.ratio) || 1;
      var Hmm = Lmm / (rapport || 1);

      // Boîte englobant TOUS les visuels de la face : deux petits logos
      // éloignés demandent un grand format d'impression, pas deux petits.
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      calques.forEach(function (c) {
        var l = (c.w || 0) * Lmm;
        var h = l * (c.ratio || 1);
        var cx = (c.x || 0) * Lmm, cy = (c.y || 0) * Hmm;
        x0 = Math.min(x0, cx - l / 2); x1 = Math.max(x1, cx + l / 2);
        y0 = Math.min(y0, cy - h / 2); y1 = Math.max(y1, cy + h / 2);
      });

      // Classement par la plus grande dimension, comme le studio : un visuel
      // long et étroit occupe quand même un grand format sur la table.
      var mm = Math.max(x1 - x0, y1 - y0);
      var fmt = 'A6';
      for (var i = 0; i < SEUILS_MM.length; i++) {
        if (mm >= SEUILS_MM[i][1]) { fmt = SEUILS_MM[i][0]; break; }
      }
      var extra = Number(bareme[fmt]) || 0;
      total += extra;
      detail.push({ face: face, format: fmt, mm: Math.round(mm), extra: extra });
    });

    return { total: Math.round(total * 100) / 100, detail: detail };
  };

  /**
   * Variante pré-tarifée correspondant à la surcharge.
   *
   * Le coût d'impression est porté par une variante Shopify dont l'option
   * « Impression » vaut le montant — une seule ligne de panier, pas de
   * produit de frais à côté. C'est le modèle déjà en place pour le studio.
   */
  /**
   * Tous les montants possibles, du barème : une face, ou deux cumulées.
   * Sert d'échelle de repli quand la variante exacte n'existe pas.
   */
  Editeur.prototype.paliers = function () {
    var bareme = (this.tarif && this.tarif.formats) || {};
    var valeurs = Object.keys(bareme).map(function (k) { return Number(bareme[k]) || 0; })
                        .filter(function (v) { return v > 0; });
    var tous = {};
    valeurs.forEach(function (a) {
      tous[a.toFixed(2)] = a;
      valeurs.forEach(function (b) { var s2 = Math.round((a + b) * 100) / 100; tous[s2.toFixed(2)] = s2; });
    });
    return Object.keys(tous).map(function (k) { return tous[k]; })
                 .sort(function (a, b) { return a - b; });
  };

  /**
   * Variante pré-tarifée correspondant à la surcharge.
   *
   * Le coût d'impression est porté par une variante Shopify dont l'option
   * « Impression » vaut le montant — une seule ligne de panier, pas de
   * produit de frais à côté. C'est le modèle déjà en place pour le studio.
   *
   * Si ce montant exact n'est pas configuré, on monte au palier suivant
   * plutôt que de refuser la vente : mieux vaut facturer un peu trop que
   * dire au client que ce n'est pas possible. Règle d'Alan, et elle est
   * juste — une vente manquée coûte plus cher qu'un euro de trop.
   */
  Editeur.prototype.varianteTarifee = function (montant) {
    var self = this;
    var v = this.variantCourant();
    if (!v) return Promise.resolve(null);
    if (!montant) return Promise.resolve({ ok: true, variant_id: String(v.id), amount: 0 });

    var aTenter = [montant].concat(
      this.paliers().filter(function (p) { return p > montant; })
    );

    var essayer = function (i) {
      if (i >= aTenter.length) return Promise.resolve(null);
      return api('/api/shopify/resolve-variant?base_variant_id=' + encodeURIComponent(v.id)
               + '&product_id=' + encodeURIComponent(self.produit)
               + '&amount=' + encodeURIComponent(aTenter[i]))
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (d) {
          if (d && d.ok && d.variant_id) {
            if (i > 0) {
              console.info('[TSL] Palier ' + montant + ' € non configuré — facturé '
                + aTenter[i] + ' €, le palier suivant.');
            }
            return d;
          }
          return essayer(i + 1);
        })
        .catch(function () { return essayer(i + 1); });
    };
    return essayer(0);
  };

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

    var sur = this.surchargeImpression();
    var montant = prix((v.price + Math.round(sur.total * 100)) * qte, this.donnees.moneyFormat);
    var base = this.racine.getAttribute('data-tsl-cart-label') || 'Ajouter au panier';
    var libelle = base + ' — ' + montant;
    this._surcharge = sur;

    if (this.boutonTheme) {
      var el = this.boutonTheme.querySelector('span') || this.boutonTheme;
      if (el.textContent.trim() !== libelle) { el.textContent = libelle; fondu(el); }
    }

    this.majPrixAffiche(v.price * qte, (v.price + Math.round(sur.total * 100)) * qte);
  };

  /**
   * Met le prix de la fiche d'accord avec le bouton.
   *
   * Le prix du thème restait celui du produit nu pendant que le bouton
   * annonçait le prix réel : deux montants différents sur le même écran,
   * et c'est toujours le plus bas qu'on retient. On modifie donc aussi
   * l'affichage du thème.
   *
   * L'élément n'est pas cherché par une classe — chaque thème a la sienne —
   * mais par son CONTENU : la feuille de prix est celle qui affiche
   * exactement le montant de la variante courante.
   */
  Editeur.prototype.majPrixAffiche = function (centimesBase, centimesTotal) {
    var fmt = this.donnees.moneyFormat;
    var txtBase = prix(centimesBase, fmt);
    var txtTotal = prix(centimesTotal, fmt);

    var el = this._prixTheme;
    if (el && !el.isConnected) el = this._prixTheme = null;
    if (!el) el = this._prixTheme = this.trouverPrixAffiche(txtBase);
    if (!el) return;

    if (el.textContent.trim() !== txtTotal) {
      el.textContent = txtTotal;
      fondu(el);
    }
  };

  /** Montant seul, sans symbole ni espace — pour comparer deux écritures. */
  function chiffresPrix(t) {
    return String(t || '').replace(/[^0-9]/g, '');
  }

  Editeur.prototype.trouverPrixAffiche = function (txtBase) {
    var racine = this.colonne || document.querySelector('form[action*="/cart/add"]');
    if (!racine) return null;
    var vise = chiffresPrix(txtBase);
    if (!vise) return null;

    var noeuds = racine.querySelectorAll('*');
    for (var i = 0; i < noeuds.length; i++) {
      var n = noeuds[i];
      // Feuille seulement : un conteneur qui englobe le prix contient aussi
      // le titre et la description, le réécrire effacerait la fiche.
      if (n.children.length) continue;
      if (this.vue && this.vue.contains(n)) continue;   // notre propre panneau
      if (this.barre && this.barre.contains(n)) continue;
      if (this.boutonTheme && this.boutonTheme.contains(n)) continue;
      var t = (n.textContent || '').trim();
      if (!t || t.length > 24) continue;
      if (chiffresPrix(t) === vise) return n;
    }
    return null;
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

    var comp = this.moteur.exporterComposition();
    var vignette = '';
    try { vignette = this.moteur.exporterImpression(500); } catch (e) { /* canevas teinté */ }

    var v = this.variantCourant() || {};
    var couleur = (this.iCouleur >= 0 && v.options) ? v.options[this.iCouleur] : '';

    api('/api/designs', {
      method: 'POST',
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
      return api('/api/render/from-composition/' + design.id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Design-Token': design.edit_token || '' },
        body: JSON.stringify({ design_token: design.edit_token || '' }),
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (d) {
          if (!r.ok || !d || !d.properties) throw new Error((d && d.error) || 'rendu ' + r.status);
          return d;
        });
      });
    }).then(function (rendu) {
      // La variante pré-tarifée est résolue AVANT d'ajouter : c'est elle qui
      // porte le coût d'impression, et une ligne ajoutée sur la variante de
      // base vendrait l'impression gratuitement.
      var sur = self.surchargeImpression();
      return self.varianteTarifee(sur.total).then(function (v) {
        if (sur.total > 0 && (!v || !v.ok || !v.variant_id)) {
          // Aucun palier configuré du tout : on vend quand même, au prix de
          // base, plutôt que de bloquer. L'avertissement console dit au
          // marchand ce qu'il lui manque.
          console.warn('[TSL] Aucune variante « Impression » disponible pour '
            + sur.total + ' € ni au-dessus — vendu au prix de base. '
            + 'Configurez l\'option Impression sur ce produit.');
        }
        rendu.varianteId = (v && v.variant_id) || null;
        rendu.surcharge = sur;
        return rendu;
      });
    }).then(function (rendu) {
      var props = rendu.properties;
      var impression = (rendu.faces && rendu.faces.front && rendu.faces.front.url)
                    || (rendu.faces && rendu.faces.back && rendu.faces.back.url) || '';
      // Vignette du panier : la création POSÉE SUR LA PHOTO du produit. Le
      // fichier d'impression seul — un visuel sur fond transparent, hors
      // contexte — ne ressemble pas à ce qu'on vient d'acheter. On retombe
      // dessus si le produit n'a pas de zone calibrée.
      // Le détail du calcul part avec la commande : sans lui, impossible de
      // savoir plus tard pourquoi telle ligne a été facturée tel montant.
      if (rendu.surcharge && rendu.surcharge.detail.length) {
        props._impression = rendu.surcharge.detail
          .map(function (d) { return d.face + ':' + d.format + ':' + d.mm + 'mm'; }).join(' ');
        props.Impression = rendu.surcharge.detail
          .map(function (d) { return d.format; }).join(' + ');
      }
      return self.apercuSurLaPhoto(self._design).then(function (apercu) {
        self.poserDansLePanier(props, apercu || impression, rendu.varianteId);
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
    var url = '/api/products/' + this.produit + '/composition-preview'
            + '?design=' + encodeURIComponent(design.id)
            + '&token=' + encodeURIComponent(design.edit_token || '')
            + '&media=' + encodeURIComponent(media);
    return api(url)
      .then(function (r) {
        // La route redirige vers le fichier produit : c'est l'URL d'arrivée
        // qui nous intéresse, pas celle qu'on a demandée.
        return (r.ok && r.url) ? r.url : '';
      })
      .catch(function () { return ''; });
  };

  Editeur.prototype.poserDansLePanier = function (props, apercu, varianteId) {
    var self = this;
    var v = this.variantCourant();
    var idLigne = varianteId || (v && v.id);
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
        variantId: idLigne, quantity: qte,
        properties: props, previewUrl: apercu,
        // Le produit, pour les suggestions curées par le marchand : la page
        // peut en contenir plusieurs, et la ligne de panier ne porte que la
        // variante. Le design va avec : il sert à poser la création du client
        // sur les produits suggérés.
        productId: self.produit,
        designId: self._design && self._design.id,
        designToken: self._design && self._design.edit_token,
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
      body: JSON.stringify({ id: idLigne, quantity: qte, properties: props }),
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
    if (!occupe) this.majPrix();
  };

  // ── Démarrage ─────────────────────────────────────────────────────────────

  var _instances = [];

  function demarrer() {
    var blocs = document.querySelectorAll('[data-tsl-editor]');
    for (var i = 0; i < blocs.length; i++) {
      if (blocs[i].__tsleInit) continue;
      blocs[i].__tsleInit = true;
      styles();
      // Gardée pour le diagnostic : sans référence à l'instance, impossible
      // d'inspecter le canevas depuis la console d'une boutique.
      _instances.push(new Editeur(blocs[i]));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();
  document.addEventListener('shopify:section:load', demarrer);

  // Diagnostic : la boutique de développement est protégée par mot de
  // passe, on ne peut pas l'inspecter de l'extérieur. Une ligne à coller
  // dans la console vaut mieux qu'un aller-retour de captures d'écran.
  window.TSL_EDITOR = {
    refresh: demarrer,
    instances: _instances,
    diag: function () {
      var bar = document.querySelector('.tsle-bar');
      var vue = document.querySelector('.tsle-vue');
      var out = {
        script: window.__TSL_EDITOR_LOADED === true,
        bloc: !!document.querySelector('[data-tsl-editor]'),
        barre: !!bar, panneau: !!vue,
        barreDans: bar && bar.parentElement ? (bar.parentElement.tagName + '.' + bar.parentElement.className).slice(0, 70) : null,
        panneauDans: vue && vue.parentElement ? (vue.parentElement.tagName + '.' + vue.parentElement.className).slice(0, 70) : null,
        panneauOuvert: vue ? vue.classList.contains('ouvert') : null,
        panneauAffiche: vue ? getComputedStyle(vue).display : null,
        flottante: bar ? bar.classList.contains('tsle-flottante') : null,
        faces: (this.instances[0] && this.instances[0].faces || []).map(function (x) {
          return x.face + ' → ' + String(x.url || '').split('/').pop().split('?')[0];
        }),
        faceAffichee: (this.instances[0] && this.instances[0].moteur
          && this.instances[0].moteur.face) || null,
        photoAffichee: (function () {
          var e = this.instances[0];
          var im = e && e.imageProduit;
          if (!im) return null;
          var pic = im.closest ? im.closest('picture') : null;
          return (im.currentSrc || im.src || '').split('/').pop().split('?')[0]
               + (pic ? ' (dans un <picture>, ' + pic.querySelectorAll('source').length + ' source)' : '');
        }).call(this),
        zoneCalibree: !!(this.instances[0] && this.instances[0].zoneCalibree),
      };
      if (bar) {
        var b = bar.querySelector('.tsle-tool');
        if (b) {
          var r = b.getBoundingClientRect();
          out.bouton = { l: Math.round(r.width), h: Math.round(r.height) };
          var d = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
          out.sousLeCurseur = d ? (d.tagName + '.' + String(d.className)).slice(0, 70) : null;
          out.cliquable = !!(d && bar.contains(d));
        }
      }
      if (vue) {
        var rv = vue.getBoundingClientRect();
        out.panneauRect = { l: Math.round(rv.width), h: Math.round(rv.height) };
      }
      console.table(out);
      return out;
    },
  };
})();
