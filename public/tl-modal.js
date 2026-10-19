/**
 * tl-modal.js — TextileLab Studio : ouverture de l'éditeur en modal plein écran
 *
 * À inclure dans le thème Shopify via l'App Embed Block (tl-embed.liquid).
 * Intercepte les liens "Personnalisé" et ouvre l'éditeur dans un overlay plein écran.
 *
 * Communication iframe ↔ parent via postMessage :
 *   - { type: 'tl-add-to-cart', variantId, quantity, properties, previewUrl } → AJAX cart + drawer
 *   - { type: 'tl-close-modal', designId, designToken }                       → ferme le modal
 *     (designId/designToken : backlog item 25, lien de reprise par email pour
 *     un visiteur non connecté — cf. _tlOfferEmailResumeLink ci-dessous)
 */

(function () {
  'use strict';

  // ── Guard anti-double-init (si le script est chargé deux fois) ──────────────
  if (window.__TLModalInitialized) return;
  window.__TLModalInitialized = true;

  // ── Préférence marchand : couleur de fond derrière la preview drawer ───────
  // Configurée dans l'admin TextileLab (Paramètres → Apparence du drawer panier)
  // et exposée par GET /api/shop-settings/style/public?shop=<myshopify_domain>.
  // Tant que le fetch n'a pas répondu, fallback transparent (comportement actuel).
  // Appliquée dans _tlInjectOverlay() au moment de l'injection ET sur tous les
  // overlays déjà présents quand la réponse arrive (cas où le drawer s'ouvre
  // avant la fin du fetch).
  var _TL_CART_BG = '';

  // Flag item 25 (lien de reprise par email) : lu une fois par _tlLoadStyleSettings,
  // consommé à la fermeture du studio. false tant que la réponse n'est pas arrivée
  // (comportement identique à aujourd'hui : rien ne s'affiche).
  var _TL_EMAIL_RESUME_ENABLED = false;

  // Flag item 26 (bouton "Modifier" sur une ligne de panier déjà personnalisée) :
  // même mécanique que _TL_EMAIL_RESUME_ENABLED ci-dessus, lu une fois par
  // _tlLoadStyleSettings. false tant que la réponse n'est pas arrivée.
  var _TL_CART_EDIT_DESIGN_ENABLED = false;

  // Flag item 23 (panneau partiel desktop, au lieu du plein écran opaque) :
  // même mécanique, lu une fois par _tlLoadStyleSettings. false tant que la
  // réponse n'est pas arrivée (comportement identique à aujourd'hui : plein
  // écran). Consommé par openModal()/closeModal() ci-dessous, desktop
  // uniquement (mobile toujours en plein écran par construction).
  var _TL_PANEL_MODE_STUDIO_ENABLED = false;

  // Flag item 32 (même création, dans une autre taille, sans repasser par le
  // studio) : même mécanique, lu une fois par _tlLoadStyleSettings. false
  // tant que la réponse n'est pas arrivée (comportement identique à
  // aujourd'hui : rien ne s'affiche après l'ajout au panier).
  var _TL_SAME_DESIGN_OTHER_SIZE_ENABLED = false;

  // Flag item 33 (2e exemplaire identique, spec de repli du 15/10 — sans
  // aucun pourcentage de remise calculé/affiché par TSL) : même mécanique,
  // lu une fois par _tlLoadStyleSettings. Complète _TL_SAME_DESIGN_OTHER_SIZE_
  // ENABLED sans le chevaucher (autre taille vs même variante).
  var _TL_SAME_DESIGN_SECOND_UNIT_ENABLED = false;

  // Flag item 37 (bandeau "défaut d'impression refait gratuitement" après
  // l'ajout au panier) : même mécanique, lu une fois par
  // _tlLoadStyleSettings. false tant que la réponse n'est pas arrivée
  // (comportement identique à aujourd'hui : rien ne s'affiche).
  var _TL_PRINT_GUARANTEE_BANNER_ENABLED = false;

  // Clé ("<variantId>:<hash>") de la ligne de panier en cours de modification
  // via le bouton "Modifier" (item 26), le temps que le nouvel ajout soit
  // confirmé — remise à null après la suppression de l'ancienne ligne OU à la
  // fermeture du studio sans sauvegarde (sinon un ajout ultérieur sans rapport
  // supprimerait à tort cette ancienne ligne).
  var _tlEditingCartKey = null;

  // ── Styles injectés ─────────────────────────────────────────────────────────
  // Le bloc CART_FIX_CSS résout le bug de chevauchement image/titre dans les
  // drawers panier des thèmes Shopify modernes (Studio, Sense, etc.) où une
  // <td> a un width inline (ex: width:140px) qui contredit le grid-template-
  // columns calculé par le thème. On neutralise les widths inline sur les
  // cellules de cart rows ; le grid CSS prend alors le relais et tout
  // s'aligne. Approche purement CSS = pas de timing JS à gérer.
  // Restauré après commit 8e057ea : la version JS-only ne couvrait pas tous
  // les cas (overlay invisible / image produit en pleine largeur). On garde
  // _tlFixCartGridConflict() en complément pour les rows en grid sous-dim.
  var CART_FIX_CSS = [
    /* 1. Cellules <td> de rows de panier : neutraliser tous les widths inline */
    '.cart-items__table-row > td,',
    'tr[class*="cart-item"][class*="row"] > td,',
    'tr[class*="line-item"] > td {',
    '  width: auto !important;',
    '  min-width: 0 !important;',
    '}',
    /* 2. Container interne <a class="*media-container"> qui a aussi un width inline */
    '.cart-items__media-container,',
    '[class*="cart-items__media"] > a,',
    '[class*="cart-item__image"] > a {',
    '  width: 100% !important;',
    '  height: auto !important;',
    '  max-width: 100% !important;',
    '  min-width: 0 !important;',
    '}',
    /* 3. Forcer une largeur minimale raisonnable pour la 1ère colonne quand le */
    /*    thème la sous-dimensionne (signature : tr en grid avec image dedans). */
    /*    Détails : min 140px pour empêcher le titre de wrap caractère par car. */
    '.cart-items__table-row {',
    '  grid-template-columns: 120px minmax(140px, 1fr) minmax(70px, auto) !important;',
    '  column-gap: 12px !important;',
    '}',
    /* 3b. La cellule détails et tous ses enfants : autoriser le wrap normal */
    /*     (pas de break-all hérité du thème qui casserait lettre par lettre)  */
    '.cart-items__details,',
    '.cart-items__details *,',
    '[class*="cart-items__details"],',
    '[class*="cart-items__details"] * {',
    '  min-width: 0 !important;',
    '  word-break: normal !important;',
    '  overflow-wrap: anywhere !important;',
    '  white-space: normal !important;',
    '  hyphens: none !important;',
    '}',
    /* 3c. Titre lui-même : pas de letter-by-letter, ratio lisible */
    '.cart-items__details a,',
    '.cart-items__details [class*="title"],',
    '.cart-items__details h1,',
    '.cart-items__details h2,',
    '.cart-items__details h3 {',
    '  display: block !important;',
    '  writing-mode: horizontal-tb !important;',
    '  text-orientation: mixed !important;',
    '  word-spacing: normal !important;',
    '  letter-spacing: normal !important;',
    '  line-height: 1.3 !important;',
    '}',
    /* 4. Forcer le container media à 100px de large MAIS hauteur auto pour
          préserver le ratio naturel de l\'image mockup (rectangulaire, pas carrée).
          Le _tlInjectOverlay() applique ensuite aspect-ratio dynamiquement quand
          l\'image overlay charge — cf. _tlApplyAspectRatio().
          (réduit de 160→100px le 2026-05-06 pour libérer la place du titre/desc
          dans le drawer panier — la miniature reste parfaitement lisible.) */
    '.cart-items__media-container,',
    '[class*="cart-items__media-container"],',
    '[class*="cart-item__image"] > a {',
    '  width: 120px !important;',
    '  height: auto !important;',
    '  max-width: 120px !important;',
    '  min-width: 120px !important;',
    '}',
    '.cart-items__media-image,',
    '[class*="cart-items__media-image"] {',
    '  width: 100% !important;',
    '  height: auto !important;',
    '  object-fit: contain !important;',
    '}',
    /* Quand un overlay TL est présent, on cache l\'image native du tshirt rouge
       (sinon on la verrait à travers les bandes transparentes haut/bas du contain). */
    '.cart-items__media-container:has(.tl-design-overlay) > img,',
    '[class*="cart-items__media-container"]:has(.tl-design-overlay) > img,',
    '[class*="cart-item__image"] > a:has(.tl-design-overlay) > img {',
    '  visibility: hidden !important;',
    '}',
    /* Pendant l\'add-to-cart, on masque préemptivement les images natives
       des line items pour éviter le flash "t-shirt rouge variant" avant
       que tl-modal n\'injecte l\'overlay. Le marker body.tl-cart-loading
       est posé/retiré dans le handler tl-add-to-cart. */
    'body.tl-cart-loading [class*="cart-items__media"] img,',
    'body.tl-cart-loading [class*="cart-item__image"] img,',
    'body.tl-cart-loading cart-drawer img[src*="cdn.shopify"]:not([src*="textile"]) {',
    '  visibility: hidden !important;',
    '}',
    /* 4b. ANTI-FLICKER properties : cacher préemptivement les line item    */
    /*     properties (dt/dd, li) tant que tl-modal n'a pas eu le temps de   */
    /*     transformer "Voir mon design: <url>" en bouton orange propre.    */
    /*     - Le marker [data-tl-props-ready] est posé par _tlFixLineItemProps */
    /*       sur les <dl> traités → elles ré-apparaissent unifiées.          */
    /*     - Pour les éléments feuille (li/p/span/td), le marker            */
    /*       [data-tl-leaf-ready] est posé sur le row → idem.                */
    /*     visibility (pas display) garde le layout stable, juste invisible. */
    '.cart-items dl:not([data-tl-props-ready]) > dt,',
    '.cart-items dl:not([data-tl-props-ready]) > dd,',
    '[class*="cart-item"] dl:not([data-tl-props-ready]) > dt,',
    '[class*="cart-item"] dl:not([data-tl-props-ready]) > dd,',
    '[class*="line-item"] dl:not([data-tl-props-ready]) > dt,',
    '[class*="line-item"] dl:not([data-tl-props-ready]) > dd,',
    'cart-drawer dl:not([data-tl-props-ready]) > dt,',
    'cart-drawer dl:not([data-tl-props-ready]) > dd,',
    '.cart-drawer dl:not([data-tl-props-ready]) > dt,',
    '.cart-drawer dl:not([data-tl-props-ready]) > dd {',
    '  visibility: hidden !important;',
    '}',
    /* Idem pour les structures non-<dl> (li[class*="property"], p, etc.) :  */
    /* on cache les éléments line-item-property dans les rows non-fixés.     */
    '[class*="cart-item"]:not([data-tl-leaf-ready]) [class*="line-item-property"],',
    '[class*="cart-item"]:not([data-tl-leaf-ready]) [class*="line-item__properties"] li,',
    'cart-drawer [class*="cart-item"]:not([data-tl-leaf-ready]) li[class*="property"] {',
    '  visibility: hidden !important;',
    '}',
    /* 5. Notre overlay : pleine cellule, fond TRANSPARENT, image en CONTAIN
          (préserve le ratio naturel du mockup, pas de crop). */
    '.tl-design-overlay {',
    '  position: absolute !important;',
    '  inset: 0 !important;',
    '  background: transparent !important;',
    '  z-index: 2 !important;',
    '  pointer-events: none !important;',
    '  overflow: hidden !important;',
    '  display: block !important;',
    '}',
    '.tl-design-overlay > img {',
    '  width: 100% !important;',
    '  height: 100% !important;',
    '  max-width: 100% !important;',
    '  max-height: 100% !important;',
    '  object-fit: contain !important;',
    '  display: block !important;',
    '  background: transparent !important;',
    '  margin: auto !important;',
    '}',
  ].join('\n');

  // ── Allure du bouton « Personnaliser » ─────────────────────────────────────
  //
  // Le bloc ne donne au bouton que sa mise en page : il hérite donc des
  // couleurs de `.button` du thème, et se retrouvait violet à gros arrondi,
  // étranger au reste de la page. On l'habille ici plutôt que dans le bloc,
  // pour couvrir aussi les boutons posés à la main dans un bloc « Liquid
  // personnalisé » — ils portent la même classe.
  //
  // `!important` partout : la règle du thème est plus spécifique que la
  // nôtre, et les styles en ligne du bloc l'emporteraient de toute façon.
  var TL_CTA_CSS = '\
    .tl-personalise-btn {\
      background: #000 !important;\
      background-image: none !important;\
      color: #fff !important;\
      border: 1px solid #000 !important;\
      border-radius: 6px !important;\
      box-shadow: none !important;\
      transition: background-color .15s ease, color .15s ease !important;\
    }\
    .tl-personalise-btn > * { color: inherit !important; }\
    .tl-personalise-btn:hover,\
    .tl-personalise-btn:focus-visible {\
      background: transparent !important;\
      background-image: none !important;\
      color: #000 !important;\
      border-color: #000 !important;\
    }\
  ';

  var TL_UPSELL_CSS = '\
    .tl-upsell {\
      position: fixed;\
      left: 50%;\
      bottom: 16px;\
      transform: translateX(-50%) translateY(12px);\
      z-index: 2147483000;\
      width: calc(100vw - 24px);\
      max-width: 520px;\
      box-sizing: border-box;\
      padding: 12px 14px 14px;\
      border-radius: 16px;\
      background: #fff;\
      color: #16161a;\
      box-shadow: 0 10px 40px rgba(0,0,0,.22);\
      font: 400 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\
      opacity: 0;\
      transition: opacity .25s ease, transform .25s ease;\
    }\
    .tl-upsell.tl-on { opacity: 1; transform: translateX(-50%) translateY(0); }\
    .tl-upsell-t { font-weight: 600; font-size: 14px; margin: 0 28px 10px 2px; }\
    .tl-upsell-x {\
      position: absolute; top: 8px; right: 8px;\
      width: 30px; height: 30px; padding: 0;\
      border: 0; border-radius: 50%;\
      background: rgba(0,0,0,.06); color: #16161a;\
      font-size: 18px; line-height: 1; cursor: pointer;\
    }\
    .tl-upsell-g {\
      display: grid;\
      grid-template-columns: repeat(auto-fit, minmax(0, 1fr));\
      gap: 10px;\
    }\
    .tl-upsell-c {\
      display: block;\
      text-decoration: none;\
      color: inherit;\
      min-width: 0;\
    }\
    .tl-upsell-i {\
      display: block;\
      width: 100%;\
      aspect-ratio: 1 / 1;\
      border-radius: 10px;\
      background: #f2f2f4 center / cover no-repeat;\
      margin-bottom: 6px;\
    }\
    .tl-upsell-n {\
      display: block;\
      font-size: 12px;\
      line-height: 1.25;\
      overflow: hidden;\
      display: -webkit-box;\
      -webkit-line-clamp: 2;\
      -webkit-box-orient: vertical;\
    }\
    .tl-upsell-p { display: block; font-size: 12px; opacity: .6; margin-top: 2px; }\
    @media (max-width: 480px) {\
      .tl-upsell { bottom: 8px; padding: 10px 12px 12px; }\
      .tl-upsell-n { font-size: 11px; }\
    }\
  ';

  // Bandeau "Reprendre ma création" (item 24) : discret, posé juste au-dessus
  // du bouton "Personnaliser" qu'il remplace visuellement en priorité — pas
  // un popup, pas de fond opaque, pour ne jamais paraître plus intrusif que
  // le bandeau de réassurance déjà livré dans le studio.
  var TL_RESUME_CSS = '\
    .tl-resume {\
      display: flex;\
      flex-wrap: wrap;\
      align-items: center;\
      justify-content: space-between;\
      gap: 8px;\
      margin: 0 0 8px;\
      padding: 10px 12px;\
      border-radius: 10px;\
      border: 1px solid rgba(0,0,0,.12);\
      background: rgba(0,0,0,.03);\
      font: 400 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\
      color: inherit;\
    }\
    .tl-resume-t { font-weight: 600; }\
    .tl-resume-a { display: flex; gap: 10px; flex-shrink: 0; }\
    .tl-resume-r, .tl-resume-z {\
      border: 0;\
      background: none;\
      padding: 0;\
      font: inherit;\
      font-weight: 600;\
      text-decoration: underline;\
      cursor: pointer;\
      color: inherit;\
    }\
    .tl-resume-z { font-weight: 400; opacity: .7; }\
  ';

  // Lien "Recevoir un lien pour reprendre ma création" (item 25) : même ton
  // discret que .tl-resume (item 24), proposé uniquement à un visiteur SANS
  // jeton client (sinon le bandeau .tl-resume prend le relais). Replié en un
  // simple lien tant qu'il n'est pas cliqué, pour ne jamais ressembler à un
  // popup qui s'impose.
  var TL_EMAIL_RESUME_CSS = '\
    .tl-email-resume {\
      margin: 0 0 8px;\
      padding: 10px 12px;\
      border-radius: 10px;\
      border: 1px solid rgba(0,0,0,.12);\
      background: rgba(0,0,0,.03);\
      font: 400 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\
      color: inherit;\
    }\
    .tl-email-resume-link {\
      border: 0;\
      background: none;\
      padding: 0;\
      font: inherit;\
      font-weight: 600;\
      text-decoration: underline;\
      cursor: pointer;\
      color: inherit;\
    }\
    .tl-email-resume-form { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }\
    .tl-email-resume-input {\
      flex: 1 1 180px;\
      min-width: 0;\
      padding: 7px 10px;\
      border-radius: 8px;\
      border: 1px solid rgba(0,0,0,.2);\
      font: inherit;\
    }\
    .tl-email-resume-send, .tl-email-resume-cancel {\
      border: 0;\
      border-radius: 8px;\
      padding: 7px 12px;\
      font: inherit;\
      font-weight: 600;\
      cursor: pointer;\
    }\
    .tl-email-resume-send { background: #111; color: #fff; }\
    .tl-email-resume-cancel { background: none; opacity: .7; }\
    .tl-email-resume-msg { display: block; margin-top: 6px; font-size: 12px; opacity: .8; }\
  ';

  // Encart "Vous voulez aussi cette création en [taille] ?" (item 32) : même
  // famille visuelle discrète que .tl-resume/.tl-email-resume ci-dessus,
  // posé juste au-dessus du bouton "Personnaliser" après un ajout au panier
  // réussi — jamais un popup qui s'impose.
  var TL_OTHER_SIZE_CSS = '\
    .tl-other-size {\
      display: flex;\
      flex-wrap: wrap;\
      align-items: center;\
      justify-content: space-between;\
      gap: 8px;\
      margin: 0 0 8px;\
      padding: 10px 12px;\
      border-radius: 10px;\
      border: 1px solid rgba(0,0,0,.12);\
      background: rgba(0,0,0,.03);\
      font: 400 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\
      color: inherit;\
    }\
    .tl-other-size-t { font-weight: 600; }\
    .tl-other-size-a { display: flex; gap: 10px; flex-shrink: 0; flex-wrap: wrap; }\
    .tl-other-size-b, .tl-other-size-z {\
      border: 0;\
      background: none;\
      padding: 0;\
      font: inherit;\
      font-weight: 600;\
      text-decoration: underline;\
      cursor: pointer;\
      color: inherit;\
    }\
    .tl-other-size-z { font-weight: 400; opacity: .7; }\
    .tl-other-size-b[disabled] { opacity: .5; cursor: default; text-decoration: none; }\
    .tl-other-size-msg { flex-basis: 100%; font-size: 12px; opacity: .8; color: #b42318; }\
  ';

  // Encart "Ajouter un 2e exemplaire identique" (item 33, spec de repli du
  // 15/10 — sans aucun pourcentage de remise calculé/affiché par TSL) : même
  // famille visuelle que .tl-other-size ci-dessus, classe racine distincte
  // pour ne pas être effacé par le "var vieux = querySelector('.tl-other-size')"
  // de _tlInjectOtherSizeOffer (les deux encarts peuvent coexister, empilés).
  var TL_SECOND_UNIT_CSS = '\
    .tl-second-unit {\
      display: flex;\
      flex-wrap: wrap;\
      align-items: center;\
      justify-content: space-between;\
      gap: 8px;\
      margin: 0 0 8px;\
      padding: 10px 12px;\
      border-radius: 10px;\
      border: 1px solid rgba(0,0,0,.12);\
      background: rgba(0,0,0,.03);\
      font: 400 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\
      color: inherit;\
    }\
    .tl-second-unit-t { font-weight: 600; }\
    .tl-second-unit-a { display: flex; gap: 10px; flex-shrink: 0; flex-wrap: wrap; }\
    .tl-second-unit-b, .tl-second-unit-z {\
      border: 0;\
      background: none;\
      padding: 0;\
      font: inherit;\
      font-weight: 600;\
      text-decoration: underline;\
      cursor: pointer;\
      color: inherit;\
    }\
    .tl-second-unit-z { font-weight: 400; opacity: .7; }\
    .tl-second-unit-b[disabled] { opacity: .5; cursor: default; text-decoration: none; }\
    .tl-second-unit-msg { flex-basis: 100%; font-size: 12px; opacity: .8; color: #b42318; }\
  ';

  // Bandeau de confiance "défaut d'impression refait gratuitement" (item 37) :
  // même famille visuelle discrète que .tl-other-size/.tl-second-unit
  // ci-dessus, mais sans bouton ni action — une seule ligne de texte.
  var TL_PRINT_GUARANTEE_CSS = '\
    .tl-print-guarantee {\
      margin: 0 0 8px;\
      padding: 10px 12px;\
      border-radius: 10px;\
      border: 1px solid rgba(0,0,0,.12);\
      background: rgba(0,0,0,.03);\
      font: 600 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\
      color: inherit;\
    }\
  ';

  // NOTE : ne pas nommer cette variable "CSS" — cela écraserait window.CSS
  // (l'API globale) dans le scope de l'IIFE et ferait planter CSS.escape().
  // ── Sélecteur de support, ouvert depuis un lien de menu ──────────────────
  //
  // Surface opaque et police système : on s'affiche par-dessus un thème dont
  // on ne maîtrise rien, et hériter de ses styles donnerait n'importe quoi.
  var TL_CHOIX_CSS = '\
    .tl-choix {\
      position: fixed; inset: 0; z-index: 2147483000;\
      display: flex; align-items: center; justify-content: center;\
      padding: 18px; background: rgba(10,10,12,.62);\
      opacity: 0; transition: opacity .18s ease;\
      font: 400 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\
    }\
    .tl-choix.tl-on { opacity: 1; }\
    .tl-choix-c {\
      width: 100%; max-width: 620px; max-height: 86vh; box-sizing: border-box;\
      display: flex; flex-direction: column; overflow: hidden;\
      padding: 20px 20px 18px; border-radius: 16px;\
      background: #fff; color: #16161a;\
      box-shadow: 0 18px 60px rgba(0,0,0,.3);\
      transform: translateY(10px) scale(.98); transition: transform .18s ease;\
    }\
    .tl-choix.tl-on .tl-choix-c { transform: none; }\
    .tl-choix-corps { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }\
    .tl-choix-t { font-weight: 600; font-size: 16px; margin: 0 30px 4px 2px; flex-shrink: 0; }\
    .tl-choix-s { font-size: 13px; opacity: .62; margin: 0 30px 16px 2px; flex-shrink: 0; }\
    .tl-choix-x {\
      position: absolute; top: 14px; right: 14px; width: 32px; height: 32px;\
      padding: 0; border: 0; border-radius: 50%; cursor: pointer;\
      background: rgba(0,0,0,.06); color: #16161a; font-size: 19px; line-height: 1;\
    }\
    .tl-choix-g {\
      display: grid; gap: 12px; padding: 2px;\
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));\
      flex: 1 1 auto; min-height: 0; overflow-y: auto;\
    }\
    .tl-choix-i { display: block; text-decoration: none; color: inherit; min-width: 0; }\
    .tl-choix-v {\
      display: block; width: 100%; aspect-ratio: 1 / 1; border-radius: 10px;\
      margin-bottom: 7px; background: #7b7b82 center / cover no-repeat;\
    }\
    .tl-choix-n { display: block; font-size: 12.5px; line-height: 1.3; }\
    .tl-choix-p { display: block; font-size: 12px; opacity: .6; margin-top: 2px; }\
    .tl-choix-vide { padding: 10px 2px 4px; font-size: 13px; opacity: .7; }\
    .tl-choix-retour {\
      display: inline-flex; align-items: center; gap: 6px; margin: 0 0 12px;\
      padding: 7px 12px 7px 9px; border: 0; border-radius: 9px; cursor: pointer;\
      background: rgba(0,0,0,.06); color: inherit; font: inherit; font-size: 12.5px;\
      flex-shrink: 0;\
    }\
    .tl-choix-tailles {\
      display: flex; flex-wrap: wrap; align-content: flex-start; gap: 8px;\
      flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 2px 2px 4px;\
    }\
    .tl-choix-taille {\
      padding: 11px 16px; border: 1px solid rgba(0,0,0,.18); border-radius: 9px;\
      background: #fff; color: inherit; font: inherit; font-size: 13.5px; cursor: pointer;\
    }\
    .tl-choix-taille:hover { background: #16161a; color: #fff; border-color: #16161a; }\
    .tl-choix-taille[disabled] { opacity: .35; cursor: default; text-decoration: line-through; }\
  ';

  var TL_STYLES = '\
    #tl-modal-overlay {\
      display: none;\
      position: fixed;\
      inset: 0;\
      z-index: 2147483647;\
      background: #0a0a0c;\
    }\
    #tl-modal-overlay.tl-open {\
      display: block;\
    }\
    #tl-modal-iframe {\
      width: 100%;\
      height: 100%;\
      border: none;\
      display: block;\
    }\
    @media (min-width: 769px) {\
      #tl-modal-overlay.tl-panel-mode {\
        background: rgba(10, 10, 12, .6);\
        backdrop-filter: blur(4px);\
        -webkit-backdrop-filter: blur(4px);\
      }\
      #tl-modal-overlay.tl-panel-mode #tl-modal-iframe {\
        position: absolute;\
        inset: 5vh 5vw;\
        width: 90vw;\
        height: 90vh;\
        border-radius: 16px;\
        box-shadow: 0 20px 60px rgba(0, 0, 0, .4);\
      }\
    }\
  ' + CART_FIX_CSS + TL_CTA_CSS + TL_UPSELL_CSS + TL_RESUME_CSS + TL_EMAIL_RESUME_CSS + TL_OTHER_SIZE_CSS + TL_SECOND_UNIT_CSS + TL_PRINT_GUARANTEE_CSS + TL_CHOIX_CSS;

  // ── Injection des éléments DOM ──────────────────────────────────────────────
  function injectDOM() {
    var style = document.createElement('style');
    style.textContent = TL_STYLES;
    document.head.appendChild(style);

    var overlay = document.createElement('div');
    overlay.id = 'tl-modal-overlay';

    var iframe = document.createElement('iframe');
    iframe.id = 'tl-modal-iframe';
    iframe.setAttribute('allow', 'clipboard-write');
    iframe.setAttribute('allowfullscreen', '');
    overlay.appendChild(iframe);

    document.body.appendChild(overlay);
  }

  // ── Ouverture du modal ──────────────────────────────────────────────────────
  function openModal(editorUrl) {
    var overlay = document.getElementById('tl-modal-overlay');
    var iframe  = document.getElementById('tl-modal-iframe');
    if (!overlay || !iframe) return;
    // Transmettre le domaine du storefront (parent) pour autoriser l'iframe côté
    // backend (frame-ancestors) — indispensable sur les domaines custom (ex:
    // winshirt.fr) où *.myshopify.com ne suffit pas. Marche pour tout marchand.
    try {
      var _u = new URL(editorUrl, window.location.origin);
      if (!_u.searchParams.get('parent_domain')) {
        _u.searchParams.set('parent_domain', window.location.hostname);
      }
      editorUrl = _u.href;
    } catch (e) {}
    document.body.style.overflow = 'hidden';
    iframe.src = editorUrl;
    overlay.classList.add('tl-open');
    // Item 23 : panneau partiel sur desktop uniquement (même seuil que le
    // reste du fichier/du studio) — mobile toujours en plein écran, par
    // construction, aucune condition JS supplémentaire nécessaire côté mobile.
    if (_TL_PANEL_MODE_STUDIO_ENABLED && window.innerWidth > 768) {
      overlay.classList.add('tl-panel-mode');
    }
  }

  // ── Fermeture du modal ──────────────────────────────────────────────────────
  function closeModal() {
    var overlay = document.getElementById('tl-modal-overlay');
    var iframe  = document.getElementById('tl-modal-iframe');
    if (!overlay) return;
    overlay.classList.remove('tl-open');
    overlay.classList.remove('tl-panel-mode');
    setTimeout(function() {
      if (iframe) iframe.src = 'about:blank';
      document.body.style.overflow = '';
    }, 200);
  }

  // ── Mise à jour des sections Shopify (Dawn / OS 2.0) ───────────────────────
  function _tlUpdateCartSections(sections) {
    if (!sections) return;
    var parser = new DOMParser();
    Object.keys(sections).forEach(function(sectionId) {
      var doc     = parser.parseFromString(sections[sectionId], 'text/html');
      var newEl   = doc.getElementById(sectionId);
      var existEl = document.getElementById(sectionId);
      if (newEl && existEl) existEl.innerHTML = newEl.innerHTML;
    });
  }

  // ── Mise à jour manuelle du compteur panier (fallback) ─────────────────────
  function _tlRefreshCartCount() {
    fetch('/cart.js')
      .then(function(r) { return r.json(); })
      .then(function(cart) {
        var count = cart.item_count || 0;
        var bubbles = document.querySelectorAll(
          '.cart-count-bubble span, #cart-icon-bubble .cart-count-bubble span, ' +
          '[data-cart-count], .header__cart-count'
        );
        bubbles.forEach(function(el) {
          if (!isNaN(parseInt(el.textContent))) el.textContent = count;
        });
      })
      .catch(function() {});
  }

  // ── Section Rendering API : id de la section du drawer panier ───────────────
  // Permet de demander à Shopify le HTML frais du drawer lors de /cart/add, et
  // de l'injecter → le produit apparaît dès la 1re ouverture (fini le "2 fois").
  // Certains thèmes (dont Dawn et ses dérivés) ne montent le markup du
  // drawer panier dans le DOM qu'une fois le panier non-vide, ou seulement
  // après une première ouverture — jamais au tout premier chargement de
  // page d'une session neuve, cart.item_count valant alors 0. Sans repli,
  // le tout 1er ajout au panier d'un nouveau visiteur ne trouvait aucun
  // élément à sonder : aucun id de section déterminé, donc aucune section
  // demandée à /cart/add.json, donc rien à injecter — le panier semblait
  // vide jusqu'à un 2e ajout (le drawer existe alors enfin) ou un rechargement
  // complet (rendu serveur, cart.item_count à jour). "cart-drawer" est le nom
  // de section quasi universel des thèmes Shopify 2.0 : tenté par défaut
  // même si rien n'est encore visible dans le DOM, pour toujours demander
  // la bonne donnée au serveur dès le premier ajout.
  function _tlCartDrawerSectionId() {
    var el = document.querySelector(
      'cart-drawer-component, cart-drawer, #CartDrawer, #cart-drawer, .cart-drawer, .drawer--cart'
    );
    var sec = el && el.closest ? el.closest('.shopify-section') : null;
    if (sec && sec.id) return sec.id.replace(/^shopify-section-/, '');
    return 'cart-drawer';
  }
  function _tlInjectSectionHTML(sectionId, html) {
    try {
      if (!html) return;
      var parsed = new DOMParser().parseFromString(html, 'text/html');
      var fresh  = parsed.getElementById('shopify-section-' + sectionId);
      var wrap   = document.getElementById('shopify-section-' + sectionId);
      if (!wrap) {
        // Le wrapper n'existe pas encore (1er ajout d'une session neuve, cart
        // vide au chargement) : l'insérer tel que rendu par le serveur plutôt
        // que de perdre ce rendu — c'est précisément ce qui manquait pour
        // que le drawer existe dès le premier ajout, pas seulement le 2e.
        if (fresh) document.body.appendChild(fresh);
        return;
      }
      wrap.innerHTML = fresh ? fresh.innerHTML : (parsed.body ? parsed.body.innerHTML : wrap.innerHTML);
    } catch (e) { /* silencieux — on garde l'ancien contenu */ }
  }

  // ── Ouverture du drawer panier natif du thème ───────────────────────────────
  function _tlOpenCartDrawer() {
    document.documentElement.dispatchEvent(new CustomEvent('cart:open', { bubbles: true }));
    document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));

    var _selectors = [
      '#cart-icon-bubble',
      '[data-cart-toggle]',
      '[data-drawer-toggle="cart-drawer"]',
      '[data-cart-drawer-trigger]',
      '.cart-count-bubble',
      '.header__icon--cart',
    ];
    for (var i = 0; i < _selectors.length; i++) {
      var el = document.querySelector(_selectors[i]);
      if (el) {
        (function(btn) { setTimeout(function() { btn.click(); }, 150); })(el);
        break;
      }
    }
  }

  // ── Injection universelle de l'image design dans le panier ─────────────────
  //
  // STRATÉGIE OVERLAY (thème-agnostique, non-invasive) :
  //
  // On ne touche JAMAIS à l'<img> originale du thème (pas de src, pas de
  // style, pas de removeAttribute). À la place, on insère un <div> overlay
  // en position:absolute; inset:0 dans le container parent de l'image.
  // L'overlay contient notre rendu HD et masque visuellement l'image native
  // sans altérer le DOM du thème.
  //
  // Avantages :
  //   - Aucun risque de débordement (l'overlay s'adapte au container)
  //   - Pas de carré blanc fantôme (le container du thème reste maître)
  //   - Au refresh / re-render : l'image native revient proprement, et la
  //     fonction _tlSyncCartImages() ré-injecte les overlays si nécessaire
  //   - Compatible avec tous les thèmes (Dawn, Sense, Studio, table-based…)
  //
  // Synchronisation persistante :
  //   - DOMContentLoaded → premier sync
  //   - cart:update / cart:refresh → re-sync
  //   - MutationObserver permanent debouncé (200ms) → couvre les rendus
  //     dynamiques du drawer (open/close, quantity change, etc.)

  // ── Fix layout du <tr>/<div> grid panier ───────────────────────────────────
  // Bug observé sur les thèmes Shopify modernes (notamment Studio) : le row
  // utilise display:grid avec grid-template-columns dynamique (ex: "53px 1fr
  // 96px") MAIS la <td> de l'image a un style HTML inline width:140px;
  // min-width:140px qui force la cellule à 140px → la cellule déborde de la
  // colonne grid prévue (53px) et chevauche la cellule details voisine, qui
  // contient le titre du produit + line item properties.
  //
  // Fix universel : sur les <tr>/<div> grid contenant une <img>, on
  // neutralise les widths inline des cellules ET on élargit la 1ère colonne
  // grid à 120px si elle calculait moins de 80px (signature du bug). Aucun
  // effet sur les thèmes sains où grid-template-columns est cohérent avec
  // le contenu.
  function _tlFixCartGridConflict(rowEl) {
    if (!rowEl) return;
    var cs = window.getComputedStyle(rowEl);
    if (cs.display !== 'grid') return;
    if (!rowEl.querySelector('img')) return;
    if (rowEl.dataset.tlGridFixed) return;
    rowEl.dataset.tlGridFixed = '1';

    // Neutraliser les widths inline des cellules directes — le grid prendra
    // le relais pour calculer leur largeur.
    Array.prototype.forEach.call(rowEl.children, function(cell) {
      cell.style.setProperty('width', 'auto', 'important');
      cell.style.setProperty('min-width', '0', 'important');
    });

    // Si la 1ère colonne calculée fait < 80px (signe que le grid a sous-
    // dimensionné l'image), élargir à 120px. On préserve les colonnes
    // suivantes telles quelles.
    var cols = (cs.gridTemplateColumns || '').split(' ');
    if (cols.length >= 2) {
      var firstColPx = parseFloat(cols[0]);
      if (!isNaN(firstColPx) && firstColPx < 80) {
        var rest = cols.slice(1).join(' ');
        rowEl.style.setProperty('grid-template-columns', '120px ' + rest, 'important');
      }
    }
  }

  function _tlInjectOverlay(rowEl, previewUrl) {
    if (!rowEl || !previewUrl) return;
    // Fix layout AVANT d'injecter l'overlay — sinon l'overlay hérite du
    // container chevauchant et le bug visuel persiste.
    _tlFixCartGridConflict(rowEl);
    var img = rowEl.querySelector('img');
    if (!img) return;
    var container = img.parentElement;
    if (!container) return;
    // Si un overlay TL existe déjà dans le container, on n'en remet pas un
    if (container.querySelector(':scope > .tl-design-overlay')) return;

    // Ancrer l'overlay en absolute via position:relative sur le container.
    // On ne change la position QUE si elle est static (default).
    var pos = window.getComputedStyle(container).position;
    if (pos === 'static') container.style.position = 'relative';
    // Fallback sans :has() (certains webviews / thèmes) :
    // masquer explicitement l'image native pour éviter qu'elle garde sa
    // largeur d'origine et annule l'effet visuel des tailles forcées.
    if (img) {
      img.style.setProperty('opacity', '0', 'important');
      img.style.setProperty('visibility', 'hidden', 'important');
      img.style.setProperty('pointer-events', 'none', 'important');
    }

    var overlay = document.createElement('div');
    overlay.className = 'tl-design-overlay';
    // Background : `_TL_CART_BG` (configuré par le marchand dans l'admin → API
    // /api/shop-settings/style/public). Par défaut transparent → on voit le
    // drawer du thème dessous. Quand le marchand pose une couleur, on l'applique
    // en !important inline (max spécificité, surcharge le CSS injecté).
    var bg = _TL_CART_BG || 'transparent';
    overlay.style.cssText =
      'position:absolute;' +
      'inset:0;' +
      'z-index:2;' +
      'pointer-events:none;' +
      'overflow:hidden;' +
      'display:block;';
    overlay.style.setProperty('background', bg, _TL_CART_BG ? 'important' : '');

    var ovImg = document.createElement('img');
    ovImg.src = previewUrl;
    ovImg.alt = '';
    ovImg.loading = 'eager';
    // Taille fixée à 160×160 max (Alan a calé cette valeur via DevTools sur le
    // drawer Studio). object-fit contain + margin auto centre l'image dans le
    // container et préserve le ratio naturel du mockup.
    // Responsive : remplit le container (100% w/h) avec object-fit:contain.
    // FINI le 160px fixe qui se faisait clipper par .tl-design-overlay overflow:hidden
    // sur les thèmes où le container fait < 160px (ex. Horizon). Le t-shirt
    // s'adapte maintenant à la taille réelle de la cellule, quel que soit le thème.
    ovImg.style.cssText =
      'width:100%;' +
      'height:100%;' +
      'max-width:100%;' +
      'max-height:100%;' +
      'object-fit:contain;' +
      'display:block;' +
      'background:transparent;' +
      'margin:auto;';

    // Quand l'image mockup est chargée, on applique son aspect-ratio naturel
    // au container parent → le container suit le ratio du mockup au lieu d'être
    // forcé en carré (et donc plus de crop, plus de bandes vides).
    var applyAspectRatio = function() {
      var nw = ovImg.naturalWidth, nh = ovImg.naturalHeight;
      if (nw > 0 && nh > 0 && container) {
        var ratio = (nw / nh).toFixed(4);
        container.style.setProperty('aspect-ratio', ratio, 'important');
        container.style.setProperty('height', 'auto', 'important');
        // L'image native (cachée par CSS visibility:hidden) doit aussi suivre
        // sinon elle réserve une hauteur 0 et le container collapse.
        if (img && img !== ovImg) {
          img.style.setProperty('aspect-ratio', ratio, 'important');
          img.style.setProperty('height', 'auto', 'important');
          img.style.setProperty('width', '100%', 'important');
        }
      }
    };
    if (ovImg.complete && ovImg.naturalWidth) applyAspectRatio();
    else ovImg.addEventListener('load', applyAspectRatio, { once: true });

    overlay.appendChild(ovImg);
    container.appendChild(overlay);
  }

  // Synchronisation : fetch /cart.js, puis pour chaque cart-item du DOM ayant
  // une key correspondante avec un _preview_img, injecter overlay + nettoyer
  // les properties préfixées '_'.
  var _tlSyncing = false;
  var _tlSyncTimeout = null;
  function _tlSyncCartImages() {
    if (_tlSyncing) return;
    _tlSyncing = true;
    fetch('/cart.js', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(cart) {
        var items = cart.items || [];
        if (!items.length) return;

        // Map: key → { url, designId, cartKey } (item.key = "<variantId>:<hash>")
        // designId (_design_id) est déjà posé en propriété de ligne panier à
        // chaque ajout (routes/render.js, routes/storefront.js, routes/app-proxy.js)
        // mais n'était jusqu'ici jamais lu côté drawer — aucun appel réseau
        // supplémentaire, juste une clé de plus prise sur la même réponse /cart.js
        // (backlog item 26, bouton "Modifier" sur une ligne déjà personnalisée).
        var byKey = {};
        items.forEach(function(item) {
          var url = (item.properties && item.properties['_preview_img']) || null;
          if (url) {
            byKey[item.key] = {
              url: url,
              designId: (item.properties && item.properties['_design_id']) || null,
              cartKey: item.key,
            };
          }
        });

        // Approche A : matching par data-key (Dawn 2024+, plupart des thèmes modernes)
        Object.keys(byKey).forEach(function(key) {
          var rows = document.querySelectorAll(
            '[data-key="' + CSS.escape(key) + '"], ' +
            '[data-cart-item-key="' + CSS.escape(key) + '"]'
          );
          rows.forEach(function(row) {
            _tlInjectOverlay(row, byKey[key].url);
            _tlFixLineItemProps(row);
            _tlEnsureModifierButton(row, byKey[key]);
          });
        });

        // Approche B : matching par index dans les tbody (thèmes table-based legacy)
        // Pour chaque tbody distinct, on aligne les <tr> avec l'ordre des items.
        var tbodies = document.querySelectorAll(
          'cart-drawer tbody, .cart-drawer tbody, ' +
          '[id*="CartDrawer"] tbody, [id*="cart-drawer"] tbody, ' +
          '.cart-items__table tbody, [class*="cart-items"] tbody'
        );
        tbodies.forEach(function(tbody) {
          var rows = tbody.querySelectorAll(':scope > tr');
          if (!rows.length) return;
          items.forEach(function(item, idx) {
            var url = (item.properties && item.properties['_preview_img']) || null;
            if (!url || !rows[idx]) return;
            _tlInjectOverlay(rows[idx], url);
            _tlFixLineItemProps(rows[idx]);
            _tlEnsureModifierButton(rows[idx], {
              designId: (item.properties && item.properties['_design_id']) || null,
              cartKey: item.key,
            });
          });
        });

        // Approche C : matching par variant-id (fallback ancien)
        Object.keys(byKey).forEach(function(key) {
          var vid = String(key).split(':')[0];
          if (!vid) return;
          var nodes = document.querySelectorAll('[data-variant-id="' + CSS.escape(vid) + '"]');
          nodes.forEach(function(node) {
            _tlInjectOverlay(node, byKey[key].url);
            _tlFixLineItemProps(node);
            _tlEnsureModifierButton(node, byKey[key]);
          });
        });
      })
      .catch(function() {})
      .finally(function() { _tlSyncing = false; });
  }

  // Debounce la sync pour les rafales de mutations DOM.
  function _tlScheduleSync() {
    clearTimeout(_tlSyncTimeout);
    _tlSyncTimeout = setTimeout(function() {
      _tlSyncCartImages();
      _tlFixAllLineItems();
    }, 200);
    // Fix props immédiat (idempotent) → ne pas attendre le debounce pour
    // relâcher le voile CSS anti-flicker.
    _tlFixAllLineItems();
  }

  // Exposé pour réutilisation depuis le handler tl-add-to-cart.
  function _tlInjectCartImage(/* variantId, previewUrl */) {
    // Le payload arrive juste avant que le drawer Shopify ne soit re-render.
    // On déclenche plusieurs syncs étalées pour couvrir tous les timings de
    // re-render du thème.
    _tlSyncCartImages();
    setTimeout(_tlSyncCartImages, 300);
    setTimeout(_tlSyncCartImages, 800);
    setTimeout(_tlSyncCartImages, 1500);
  }

  // ── Bouton "Modifier" sur une ligne de panier déjà personnalisée (item 26) ─
  // L'URL du studio est construite à la main (comme le fait déjà
  // _tlInjectEmailResumeLink plus bas pour un autre besoin) plutôt que via
  // buildStudioUrl(ref) : une ligne de panier ne porte que _design_id, pas
  // forcément le handle/id produit — déjà suffisant pour rouvrir le studio
  // sur cette création précise.
  function _tlCartEditDesignUrl(designId) {
    var shop = (window.Shopify && window.Shopify.shop) || window._TL_SHOP || window.location.hostname;
    var params = new URLSearchParams({ shop: shop, embed: '1', design: String(designId) });
    if (_tlCustomerToken) params.set('ct', _tlCustomerToken);
    return TSL_BACKEND_ORIGIN + '/textilelab-studio.html?' + params.toString();
  }

  // Ajoute le bouton "Modifier" juste après le lien "Voir mon design" déjà
  // rendu dans `row` — appelé UNIQUEMENT depuis _tlSyncCartImages (ci-dessus),
  // jamais depuis _tlFixLineItemProps/_tlFixAllLineItems : ces derniers tournent
  // aussi en amont SANS `extra` (balayage "immédiat" anti-flicker, avant que le
  // fetch /cart.js n'ait pu résoudre), et leur garde `dataset.tlFixed` rendrait
  // sinon cette insertion définitivement sautée pour la ligne si elle passait
  // par le même chemin trop tôt. Idempotent via `data-tl-cart-key` sur le
  // bouton lui-même (pas de garde dans le DOM parent) → peut être retenté sans
  // coût à chaque sync tant que "Voir mon design" n'est pas encore rendu.
  function _tlEnsureModifierButton(row, extra) {
    if (!_TL_CART_EDIT_DESIGN_ENABLED || !row || !extra || !extra.designId || !extra.cartKey) return;
    var link = row.querySelector('.tl-voir-design-link');
    if (!link || !link.parentNode) return; // pas encore rendu → retenté au sync suivant
    var cartKeyAttr = String(extra.cartKey).replace(/"/g, '');
    if (link.parentNode.querySelector('.tl-cart-edit-btn[data-tl-cart-key="' + cartKeyAttr + '"]')) return;
    // Couleur en dur comme les autres boutons injectés ici : ce script
    // s'injecte dans le thème du marchand, qui n'a aucune de nos variables CSS.
    link.insertAdjacentHTML('afterend',
      '<button type="button" class="tl-cart-edit-btn" data-tl-cart-key="' + cartKeyAttr + '" ' +
      'style="display:inline-flex;align-items:center;gap:6px;' +
      'padding:6px 12px;margin-top:4px;margin-left:6px;border-radius:8px;' +
      'background:transparent;color:#111114 !important;border:1px solid #111114;' +
      'font-size:12px;font-weight:600;cursor:pointer;">' +
      '<span aria-hidden="true">&#9999;&#65039;</span> Modifier</button>'
    );
    var btn = link.parentNode.querySelector('.tl-cart-edit-btn[data-tl-cart-key="' + cartKeyAttr + '"]');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      // Mémorisé pour que le handler 'tl-add-to-cart' retire cette ancienne
      // ligne une fois le nouvel ajout confirmé (voir plus bas) ; remis à
      // null sur une fermeture du studio SANS sauvegarde (case 'tl-close-modal').
      _tlEditingCartKey = extra.cartKey;
      openModal(_tlCartEditDesignUrl(extra.designId));
    });
  }

  // ── Nettoyage des propriétés line item dans le drawer ─────────────────────
  // Le bouton "Modifier" (item 26) n'est PAS injecté ici : cette fonction tourne
  // aussi en amont sans donnée cart (balayage "immédiat" anti-flicker, avant que
  // le fetch /cart.js n'ait pu résoudre) et son garde `dataset.tlFixed` rendrait
  // sinon l'insertion définitivement sautée pour la ligne. Le lien "Voir mon
  // design" est juste marqué `.tl-voir-design-link`, point d'ancrage que
  // _tlEnsureModifierButton (ci-dessus, appelée depuis _tlSyncCartImages où la
  // donnée cart est connue) utilise pour s'insérer après coup, sans course.
  function _tlFixLineItemProps(container) {
    if (!container) return;
    var dts = container.querySelectorAll('dl dt');
    dts.forEach(function(dt) {
      if (dt.dataset.tlFixed) return;
      dt.dataset.tlFixed = '1';
      // Certains thèmes ajoutent ":" ou un espace insécable derrière le label
      // → on normalise pour que la condition exact-match marche partout.
      var key = dt.textContent.replace(/[: \s]+$/g, '').trim();
      var dd  = dt.nextElementSibling;
      if (!dd) return;

      // "Voir mon design" / "_voir_mon_design" → bouton cliquable.
      // IMPORTANT : ce traitement doit passer AVANT le filtre des clés
      // préfixées '_' ci-dessous, sinon la clé masquée disparaîtrait.
      if (key === 'Voir mon design' || key === '_voir_mon_design') {
        var url = dd.textContent.trim();
        dt.style.display = 'none'; // masquer la key technique
        if (url.startsWith('http')) {
          dd.innerHTML = '<a href="' + url + '" target="_blank" rel="noopener" class="tl-voir-design-link" ' +
            'style="display:inline-flex;align-items:center;gap:6px;' +
            'padding:6px 12px;margin-top:4px;border-radius:8px;' +
            'background:#111114;color:#ffffff !important;' +
            'font-size:12px;font-weight:600;text-decoration:none;' +
            'box-shadow:0 1px 2px rgba(0,0,0,.12);">' +
            '<span aria-hidden=\"true\">👁</span> Voir mon design</a>';
        }
        return;
      }

      // Toutes les autres propriétés internes (_design_id, _format, etc.) → masquer
      if (key.startsWith('_')) {
        dt.style.display = 'none';
        dd.style.display = 'none';
        return;
      }
    });

    // Marquer tous les <dl> traités → CSS anti-flicker se relâche.
    container.querySelectorAll('dl').forEach(function(dl) {
      dl.setAttribute('data-tl-props-ready', '1');
    });

    // ─ Pattern 2 : balayage texte brut sur éléments feuilles ─────────────
    // - "_xxx:" ou "_xxx=" → masquer (property technique)
    // - "Voir mon design: https://..." → transformer en bouton orange
    var leafEls = container.querySelectorAll('li, p, span, div, td');
    leafEls.forEach(function(el) {
      if (el.dataset.tlFixed2) return;
      if (el.children.length > 2) return;
      var t = (el.textContent || '').trim();
      if (!t) return;
      // Property technique préfixée '_'
      if (/^_[a-z_]+\s*[:=]/i.test(t)) {
        el.dataset.tlFixed2 = '1';
        el.style.display = 'none';
        return;
      }
      // "Voir mon design: https://..." rendu en texte brut → bouton
      // Couleur en dur et non var(--amber) : ce script s'injecte dans le
      // thème du marchand, qui n'a aucune de nos variables.
      var m = t.match(/^Voir mon design\s*[:=]\s*(https?:\/\/\S+)\s*$/i);
      if (m) {
        el.dataset.tlFixed2 = '1';
        el.innerHTML = '<a href="' + m[1] + '" target="_blank" rel="noopener" class="tl-voir-design-link" ' +
          'style="display:inline-flex;align-items:center;gap:6px;' +
          'padding:6px 12px;margin-top:4px;border-radius:8px;' +
          'background:#111114;color:#ffffff !important;' +
          'font-size:12px;font-weight:600;text-decoration:none;' +
          'box-shadow:0 1px 2px rgba(0,0,0,.12);">' +
          '<span aria-hidden="true">&#128065;</span> Voir mon design</a>';
      }
    });

    // Le row entier est marqué "leaf-ready" → CSS anti-flicker se relâche.
    container.setAttribute('data-tl-leaf-ready', '1');
  }

  // Helper : balayer TOUS les line items du DOM en un coup. Idempotent.
  function _tlFixAllLineItems() {
    var rows = document.querySelectorAll(
      '[class*="cart-item"], [class*="line-item"], cart-drawer .cart-items > *, ' +
      '.cart-drawer .cart-items > *, .cart-items__table-row, ' +
      'cart-drawer-component [data-key], .cart-drawer [data-key]'
    );
    rows.forEach(function(row) { _tlFixLineItemProps(row); });
  }

  // ── Écoute des messages de l'iframe ────────────────────────────────────────
  function listenMessages() {
    window.addEventListener('message', function(e) {
      if (!e.data || typeof e.data !== 'object') return;

      switch (e.data.type) {

        case 'tl-close-modal':
          closeModal();
          // Fermeture SANS sauvegarde après un clic sur "Modifier" (item 26) :
          // remettre à null pour qu'un ajout ultérieur sans rapport ne
          // supprime pas à tort l'ancienne ligne modifiée (le cas "fermeture
          // APRÈS sauvegarde" est géré dans 'tl-add-to-cart' ci-dessous, qui
          // ne passe jamais par ce message).
          _tlEditingCartKey = null;
          _tlMaybeOfferEmailResumeLink(e.data.designId || null, e.data.designToken || null);
          break;

        case 'tl-open-product-page':
          closeModal();
          _tlGoToProductPage(e.data.product || '');
          break;

        case 'tl-add-to-cart': {
          var _vid        = e.data.variantId;
          var _props      = e.data.properties || {};
          var _qty        = e.data.quantity || 1;
          var _previewUrl = e.data.previewUrl || _props['_preview_img'] || null;

          // Stocker previewUrl dans les propriétés line item (masqué côté drawer via _tlFixLineItemProps)
          if (_previewUrl) _props['_preview_img'] = _previewUrl;

          if (_vid && _props) {
            // Marquer la phase loading pour cacher préemptivement les images
            // natives des cart items via CSS (anti-flash variant rouge).
            document.body.classList.add('tl-cart-loading');
            // UNE SEULE LIGNE : le prix d'impression est inclus dans la variante.
            // (Le modèle « 2e ligne Frais d'impression » a été supprimé — CDC juin 2026.)
            var _items = [{ id: parseInt(_vid, 10), quantity: _qty, properties: _props }];
            // Section Rendering API : on demande le HTML frais du drawer pour
            // qu'il s'affiche rempli dès la 1re ouverture.
            var _sectionId = _tlCartDrawerSectionId();
            var _addBody = { items: _items };
            if (_sectionId) { _addBody.sections = _sectionId; _addBody.sections_url = window.location.pathname; }
            // Une variante d'impression tout juste créée par le backend n'est pas
            // immédiatement ajoutable : Shopify met un instant à la publier sur
            // la boutique, et répond 422 entre-temps. D'où les tentatives
            // espacées — sans elles, le premier ajout échouait systématiquement
            // et il fallait recommencer.
            //
            // Et surtout : on VÉRIFIE la réponse. Le code se contentait de
            // r.json() ; un refus 422 passait donc pour un succès, le modal se
            // fermait et le tiroir s'ouvrait vide, sans un mot d'explication.
            // Une 4e tentative plus tardive : une variante que le backend
            // vient de créer met parfois plus de deux secondes à devenir
            // achetable, et l'échec retombait alors sur le client.
            var _essais = [0, 900, 2000, 4000];
            var _tenterAjout = function (n) {
              return fetch('/cart/add.json', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(_addBody),
              })
              .then(function (r) {
                // On lit le corps en TEXTE d'abord : un refus n'est pas
                // toujours du JSON, et `r.json()` le jetait — il ne restait
                // qu'un « HTTP 422 » muet, impossible à diagnostiquer.
                return r.text().then(function (txt) {
                  var data = null;
                  try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* pas du JSON */ }
                  // Shopify renvoie {status, message, description} en cas de refus.
                  var echec = !r.ok || !data || data.status >= 400;
                  if (!echec) return data;
                  if (n + 1 < _essais.length) {
                    return new Promise(function (ok) { setTimeout(ok, _essais[n + 1]); })
                      .then(function () { return _tenterAjout(n + 1); });
                  }
                  var raison = (data && (data.description || data.message))
                    || String(txt || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
                    || ('HTTP ' + r.status);
                  console.error('[TSL] /cart/add.json refusé', r.status, { variante: _vid, corps: txt });
                  var err = new Error(raison);
                  err.panierRefuse = true;
                  throw err;
                });
              });
            };

            _tenterAjout(0)
            .then(function(data) {
              // Fermer le modal APRÈS succès
              closeModal();

              // 1. Injecter le HTML frais du drawer (sinon il s'ouvre vide au 1er ajout)
              if (_sectionId && data && data.sections && data.sections[_sectionId]) {
                _tlInjectSectionHTML(_sectionId, data.sections[_sectionId]);
              }
              // Déclencher cart:update (compat thèmes qui écoutent l'event)
              document.dispatchEvent(new CustomEvent('cart:update', {
                bubbles: true,
                detail: { source: 'tl-modal', data: { sections: {} } }
              }));

              // 2. Ouvrir le drawer via l'API du composant (re-query après injection)
              var drawerEl = document.querySelector('cart-drawer-component, cart-drawer');
              if (drawerEl) {
                if (typeof drawerEl.open === 'function')           { drawerEl.open(); }
                else if (typeof drawerEl.showDialog === 'function') { drawerEl.showDialog(); }
              }

              // 3. Injection universelle de l'image design via [data-variant-id]
              if (_previewUrl) {
                _tlInjectCartImage(_vid, _previewUrl);
                setTimeout(function() { _tlInjectCartImage(_vid, _previewUrl); }, 200);
                setTimeout(function() { _tlInjectCartImage(_vid, _previewUrl); }, 600);
              }

              // 4. Nettoyer les propriétés _ sur les items IMMÉDIATEMENT
              //    (anti-flicker : le CSS hide les <dl>/<li> tant que
              //    [data-tl-props-ready]/[data-tl-leaf-ready] n'est pas posé).
              //    On répète à plusieurs timings pour couvrir tous les
              //    re-render du thème (Dawn, Studio, Sense…).
              _tlFixAllLineItems();
              setTimeout(_tlFixAllLineItems, 100);
              setTimeout(_tlFixAllLineItems, 400);
              setTimeout(_tlFixAllLineItems, 1000);
              setTimeout(_tlFixAllLineItems, 2000);
              // Retirer le marker loading après que les overlays soient en place.
              setTimeout(function() {
                document.body.classList.remove('tl-cart-loading');
              }, 1800);

              // 5. Si cet ajout remplace une création déjà en panier (bouton
              //    "Modifier", item 26) : retirer l'ancienne ligne plutôt que
              //    d'empiler un doublon. Jamais bloquant pour le nouvel ajout
              //    déjà confirmé ci-dessus, même si cette suppression échoue.
              if (_tlEditingCartKey) {
                var _oldKey = _tlEditingCartKey;
                _tlEditingCartKey = null;
                fetch('/cart/change.json', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: _oldKey, quantity: 0 }),
                })
                .then(function() { _tlFixAllLineItems(); _tlSyncCartImages(); })
                .catch(function() {});
              }

              // 6. Suggestions curées par le marchand pour ce produit.
              _tlProposerUpsell(e.data);

              // 7. Même création, dans une autre taille (item 32) — sous flag,
              //    jamais bloquant pour l'ajout déjà confirmé ci-dessus.
              _tlOfferOtherSize(_vid, _props, _previewUrl);

              // 8. 2e exemplaire identique, même variante (item 33) — sous
              //    flag, aucune remise calculée/affichée, jamais bloquant.
              _tlOfferSecondUnit(_vid, _props, _previewUrl);

              // 9. Bandeau de confiance "défaut d'impression refait
              //    gratuitement" (item 37) — sous flag, pur affichage,
              //    jamais bloquant.
              _tlShowPrintGuaranteeBanner();
            })
            .catch(function(err) {
              document.body.classList.remove('tl-cart-loading');
              // Refus explicite de Shopify après toutes les tentatives : le
              // renvoyer vers /cart afficherait un panier vide sans rien
              // expliquer. On le dit, et on laisse le studio ouvert pour
              // réessayer sans tout refaire.
              if (err && err.panierRefuse) {
                try {
                  var f = document.querySelector('#tl-modal iframe, .tl-modal iframe');
                  if (f && f.contentWindow) {
                    f.contentWindow.postMessage({ type: 'tl-add-failed', message: err.message }, '*');
                  }
                } catch (e2) {}
                var _errShop = (window.Shopify && window.Shopify.shop) || window._TL_SHOP || window.location.hostname;
                _tlTrackCartError(_errShop, _vid, err.message);
                alert('L\'ajout au panier a été refusé : ' + err.message
                    + '\n\nRéessayez dans quelques secondes.');
                return;
              }
              window.location.href = '/cart';
            });

          } else if (e.data.cartUrl) {
            setTimeout(function() { window.location.href = e.data.cartUrl; }, 250);
          }
          break;
        }

        default:
          break;
      }
    });
  }

  // ── Entrée par le menu ──────────────────────────────────────────────────────
  //
  // Un menu Shopify n'accepte qu'une URL : pas de bouton, pas d'attribut.
  // On guette donc un marqueur dans l'adresse, lu au chargement de n'importe
  // quelle page — l'app embed charge ce script partout.
  //
  //   /?tsl=1                → demande sur quel support créer
  //   /?tsl=t-shirt-xyz      → va droit à ce produit
  //   /pages/creer#tsl       → même chose, pour les menus qui refusent le « ? »
  //
  // Le sélecteur mène à la FICHE PRODUIT, pas au studio. Sans variante
  // choisie, le studio retombe sur la première du produit et vendrait du XS
  // à tout le monde : la taille se choisit sur la fiche, et c'est le bouton
  // « Personnaliser » qui ouvre ensuite le studio avec elle.

  function _tlMarqueurUrl() {
    try {
      var p = new URLSearchParams(window.location.search).get('tsl');
      if (p !== null) return String(p || '1').trim().toLowerCase();
      var h = String(window.location.hash || '');
      if (/^#tsl(=|$)/i.test(h)) return (h.split('=')[1] || '1').trim().toLowerCase();
    } catch (e) { /* URL exotique : on ne force rien */ }
    return null;
  }

  // L'adresse est nettoyée pour qu'un rafraîchissement ou un retour arrière
  // ne rouvre pas la fenêtre dans le dos du visiteur.
  function _tlEffacerMarqueur() {
    try {
      var u = new URL(window.location.href);
      u.searchParams.delete('tsl');
      if (/^#tsl(=|$)/i.test(u.hash)) u.hash = '';
      window.history.replaceState({}, '', u.pathname + u.search + u.hash);
    } catch (e) { /* pas d'historique : sans gravité */ }
  }

  function _tlFermerChoix() {
    var v = document.querySelector('.tl-choix');
    if (v && v.parentNode) v.parentNode.removeChild(v);
  }

  /** Les supports personnalisables : ceux que l'admin a liés à un mockup. */
  function _tlSupports() {
    var shop = (window.Shopify && window.Shopify.shop)
            || window._TL_SHOP
            || window.location.hostname;
    return fetch(TSL_BACKEND_ORIGIN + '/api/product-links/public?shop='
                 + encodeURIComponent(shop) + '&_=' + Date.now(),
                 { credentials: 'omit', mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (l) {
        if (!Array.isArray(l)) return [];
        var vus = {};
        return l.filter(function (x) {
          var h = x && x.shopify_product_handle;
          if (!h || vus[h]) return false;
          vus[h] = 1;
          return true;
        });
      })
      .catch(function () { return []; });
  }

  /**
   * Visuel, nom et prix lus sur la boutique elle-même.
   *
   * Requête de MÊME ORIGINE, donc avec les cookies : sans eux, une boutique
   * protégée par mot de passe rend sa page de garde. Et on juge la réponse
   * sur son contenu, car Shopify sert cette API en `text/javascript`.
   */
  /**
   * Les variantes qu'on peut proposer : celles SANS impression.
   *
   * Un produit préparé porte une option « Impression » qui transporte le
   * surcoût. Elle n'a rien à faire dans un choix de taille — c'est la
   * création qui la déterminera, et `_tlHidePrintOption` la cache d'ailleurs
   * sur la fiche. On ne garde donc que la valeur de base, et on n'affiche
   * que ce qui reste : la taille, la couleur, ce que le marchand a défini.
   */
  function _tlVariantesDeBase(d) {
    var noms = (d.options || []).map(function (o) {
      return String((o && o.name) || o || '');
    });
    var iImpr = -1;
    for (var i = 0; i < noms.length; i++) {
      if (/impr|print|perso|finition/i.test(noms[i])) { iImpr = i; break; }
    }
    return (d.variants || []).filter(function (v) {
      if (iImpr < 0) return true;
      var val = String((v.options || [])[iImpr] || '').toLowerCase();
      return val.indexOf('sans') === 0 || !val;
    }).map(function (v) {
      var etiquette = (v.options || []).filter(function (_, i) { return i !== iImpr; })
        .filter(Boolean).join(' / ');
      return { id: v.id, nom: etiquette || v.title, dispo: v.available !== false };
    });
  }

  function _tlFicheSupport(p) {
    var h = p.shopify_product_handle;
    return fetch('/products/' + encodeURIComponent(h) + '.js', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (txt) {
        var d = null;
        try { d = JSON.parse(txt); } catch (e) { /* page de garde, pas un produit */ }
        // Produit dépublié ou supprimé — ça existe, j'en ai trouvé deux
        // encore liés à un mockup. Mieux vaut l'omettre que proposer une
        // vignette qui mène à une page introuvable.
        if (!d || !d.title) return null;
        var prix = '';
        try {
          var dev = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'EUR';
          prix = new Intl.NumberFormat(document.documentElement.lang || 'fr',
                   { style: 'currency', currency: dev }).format(d.price / 100);
        } catch (e) { /* devise inconnue : on se passe du prix */ }
        return { handle: h, titre: d.title, image: d.featured_image || '',
                 prix: prix, variantes: _tlVariantesDeBase(d) };
      })
      .catch(function () { return null; });
  }

  /**
   * Ouvre le studio sur un support et une variante précise.
   *
   * La variante est indispensable : sans elle, le studio retombe sur la
   * première du produit et vendrait du XS à tout le monde. C'est pour ça
   * qu'on la demande ICI plutôt que de renvoyer le visiteur sur la fiche —
   * une étape de plus pour le même résultat.
   */
  function _tlLancerStudio(handle, variantId) {
    _tlFermerChoix();
    openProduct(handle, variantId);
  }

  function _tlAfficherChoix(fiches) {
    _tlFermerChoix();
    var v = document.createElement('div');
    v.className = 'tl-choix';
    v.setAttribute('role', 'dialog');
    v.setAttribute('aria-modal', 'true');

    var c = document.createElement('div');
    c.className = 'tl-choix-c';
    c.style.position = 'relative';

    var x = document.createElement('button');
    x.type = 'button'; x.className = 'tl-choix-x';
    x.setAttribute('aria-label', 'Fermer');
    x.textContent = '\u00d7';

    var corps = document.createElement('div');
    corps.className = 'tl-choix-corps';

    // ── Premier temps : le support ──────────────────────────────────────
    var etapeSupports = function () {
      corps.innerHTML = '';
      var t = document.createElement('div');
      t.className = 'tl-choix-t'; t.textContent = 'Que voulez-vous personnaliser ?';
      var st = document.createElement('p');
      st.className = 'tl-choix-s'; st.textContent = 'Choisissez un support pour commencer.';
      var g = document.createElement('div');
      g.className = 'tl-choix-g';

      fiches.forEach(function (f) {
        var a = document.createElement('a');
        a.className = 'tl-choix-i';
        a.href = '/products/' + f.handle;   // sens pour un clic du milieu, ou sans JS
        var vig = document.createElement('span');
        vig.className = 'tl-choix-v';
        if (f.image) vig.style.backgroundImage = 'url("' + String(f.image).replace(/"/g, '%22') + '")';
        a.appendChild(vig);
        var n = document.createElement('span');
        n.className = 'tl-choix-n'; n.textContent = f.titre;
        a.appendChild(n);
        if (f.prix) {
          var pr = document.createElement('span');
          pr.className = 'tl-choix-p'; pr.textContent = f.prix;
          a.appendChild(pr);
        }
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var vars = f.variantes || [];
          // Une seule variante : rien à demander, on ouvre.
          if (vars.length === 1) return _tlLancerStudio(f.handle, vars[0].id);
          if (!vars.length) return _tlGoToProductPage(f.handle);
          etapeTailles(f);
        });
        g.appendChild(a);
      });

      corps.appendChild(t); corps.appendChild(st); corps.appendChild(g);
    };

    // Construit la grille de boutons taille (réutilisée par le cas simple
    // ET par le 3e temps "taille d'une couleur donnée").
    var construireGrilleVariantes = function (variantes, surChoix) {
      var g = document.createElement('div');
      g.className = 'tl-choix-tailles';
      variantes.forEach(function (va) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'tl-choix-taille';
        b.textContent = va.nom;
        if (!va.dispo) { b.disabled = true; b.title = 'Épuisé'; }
        else b.addEventListener('click', function () { surChoix(va); });
        g.appendChild(b);
      });
      return g;
    };

    // Un produit comme IB311 (14 couleurs x 7 tailles ~ 100 variantes)
    // affichait TOUTES les combinaisons "Couleur / Taille" a plat dans une
    // seule grille non bornee en hauteur : ca debordait du modal (coupe par
    // le bas de l'ecran, aucun scroll possible -- .tl-choix-tailles n'avait
    // ni hauteur bornee ni overflow). Au-dela du seuil ci-dessous ET quand
    // le nom de variante a bien la forme "Couleur / Taille", on scinde en
    // 2 temps : couleur d'abord (chips), taille ensuite -- un produit a une
    // seule dimension (la majorite : juste des tailles) n'est pas concerne,
    // comportement strictement inchange pour lui.
    var SEUIL_GROUPAGE_COULEUR = 8;

    var etapeTailles = function (f) {
      corps.innerHTML = '';
      var retour = document.createElement('button');
      retour.type = 'button'; retour.className = 'tl-choix-retour';
      retour.textContent = '\u2190 Changer de support';
      retour.addEventListener('click', etapeSupports);

      var t = document.createElement('div');
      t.className = 'tl-choix-t'; t.textContent = f.titre;
      var st = document.createElement('p');
      st.className = 'tl-choix-s';

      corps.appendChild(retour); corps.appendChild(t); corps.appendChild(st);

      // Regroupe par 1er segment ("Couleur / Taille" -> "Couleur"). Si UNE
      // seule variante n'a pas ce format (ex. juste "M"), on renonce au
      // groupage plutot que de perdre une taille en route.
      var groupes = {}, ordreGroupes = [], formatUniforme = true;
      f.variantes.forEach(function (va) {
        var idx = va.nom.indexOf(' / ');
        if (idx < 0) { formatUniforme = false; return; }
        var grp = va.nom.slice(0, idx);
        var reste = va.nom.slice(idx + 3);
        if (!groupes[grp]) { groupes[grp] = []; ordreGroupes.push(grp); }
        groupes[grp].push({ id: va.id, nom: reste || va.nom, dispo: va.dispo });
      });

      if (formatUniforme && ordreGroupes.length >= 2 && f.variantes.length > SEUIL_GROUPAGE_COULEUR) {
        st.textContent = 'Choisissez votre couleur.';
        var gc = construireGrilleVariantes(
          ordreGroupes.map(function (grp) {
            return { nom: grp, dispo: groupes[grp].some(function (v) { return v.dispo; }) };
          }),
          function (choisie) { etapeTaillesDuGroupe(f, choisie.nom, groupes[choisie.nom]); }
        );
        corps.appendChild(gc);
        var premiereCouleur = gc.querySelector('.tl-choix-taille:not([disabled])');
        if (premiereCouleur) premiereCouleur.focus();
        return;
      }

      st.textContent = 'Choisissez votre taille, puis la création s\'ouvre.';
      var g = construireGrilleVariantes(f.variantes, function (va) { _tlLancerStudio(f.handle, va.id); });
      corps.appendChild(g);
      var premier = g.querySelector('.tl-choix-taille:not([disabled])');
      if (premier) premier.focus();
    };

    // Troisieme temps (uniquement si regroupement par couleur) : la taille,
    // une fois la couleur choisie.
    var etapeTaillesDuGroupe = function (f, grp, variantesDuGroupe) {
      corps.innerHTML = '';
      var retour = document.createElement('button');
      retour.type = 'button'; retour.className = 'tl-choix-retour';
      retour.textContent = '\u2190 Changer de couleur';
      retour.addEventListener('click', function () { etapeTailles(f); });

      var t = document.createElement('div');
      t.className = 'tl-choix-t'; t.textContent = f.titre + ' \u2014 ' + grp;
      var st = document.createElement('p');
      st.className = 'tl-choix-s'; st.textContent = 'Choisissez votre taille, puis la création s\'ouvre.';

      var g = construireGrilleVariantes(variantesDuGroupe, function (va) { _tlLancerStudio(f.handle, va.id); });

      corps.appendChild(retour); corps.appendChild(t); corps.appendChild(st); corps.appendChild(g);
      var premier = g.querySelector('.tl-choix-taille:not([disabled])');
      if (premier) premier.focus();
    };

    etapeSupports();
    c.appendChild(x); c.appendChild(corps);
    v.appendChild(c);

    var auClavier = function (e) {
      if (e.key !== 'Escape') return;
      _tlFermerChoix();
      document.removeEventListener('keydown', auClavier);
    };
    v.addEventListener('click', function (e) {
      if (e.target === v || e.target === x) { _tlFermerChoix(); document.removeEventListener('keydown', auClavier); }
    });
    document.addEventListener('keydown', auClavier);

    document.body.appendChild(v);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { v.classList.add('tl-on'); });
    });
    if (x) x.focus();
  }

  /**
   * « Sur quoi voulez-vous créer ? »
   *
   * Partagé par le lien /?tsl=1 et par tout bouton générique : les deux
   * posent la même question, ils doivent donner la même réponse.
   */
  function _tlDemanderLeSupport() {
    _tlSupports().then(function (liste) {
      // Aucun support lié : le produit vierge désigné dans l'app embed est
      // le dernier recours — encore faut-il qu'il existe. Un handle
      // désactivé mènerait à une page introuvable, ce qui est pire que rien.
      if (!liste.length) {
        var defaut = _tlDefaultProductHandle();
        fetch('/products/' + encodeURIComponent(defaut) + '.js', { credentials: 'same-origin' })
          .then(function (r) { if (r.ok) _tlGoToProductPage(defaut); })
          .catch(function () { /* injoignable : on ne renvoie nulle part */ });
        return;
      }
      Promise.all(liste.map(_tlFicheSupport)).then(function (fiches) {
        // Les produits dépubliés sont tombés à null : on ne propose que ce
        // qui existe encore sur la boutique.
        var vivants = fiches.filter(Boolean);
        if (!vivants.length) return;
        // Un seul support ET une seule variante : la question ne se pose pas.
        if (vivants.length === 1 && (vivants[0].variantes || []).length === 1) {
          return _tlLancerStudio(vivants[0].handle, vivants[0].variantes[0].id);
        }
        _tlAfficherChoix(vivants);
      });
    });
  }

  function _tlEntreeParLeMenu() {
    var m = _tlMarqueurUrl();
    if (m === null) return;
    _tlEffacerMarqueur();
    // Un handle explicite : on n'a rien à demander.
    if (m !== '1' && /^[a-z0-9][a-z0-9-]*$/.test(m)) { _tlGoToProductPage(m); return; }
    _tlDemanderLeSupport();
  }

  // ── Interception des liens "Personnalisé" ───────────────────────────────────
  function _tlDefaultProductHandle() {
    var configured = window.TL_CONFIG && window.TL_CONFIG.defaultProductHandle;
    var handle = String(configured || 't-shirt-personnalisable').trim().toLowerCase();
    return /^[a-z0-9][a-z0-9-]*$/.test(handle) ? handle : 't-shirt-personnalisable';
  }

  function _tlProductPageUrl(handle) {
    var clean = String(handle || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(clean)) clean = _tlDefaultProductHandle();
    return '/products/' + encodeURIComponent(clean);
  }

  function _tlGoToProductPage(handle) {
    window.location.assign(_tlProductPageUrl(handle));
  }

  // Variante actuellement sélectionnée sur LA fiche produit qui porte ce
  // bouton — jamais une autre. Sur une page qui affiche plusieurs produits
  // (recommandations, upsell, carrousel « vu récemment »), chacun a son
  // propre formulaire /cart/add : si le bouton n'est pas retrouvé dans une
  // section scopée à SON produit, on ne doit PAS deviner avec le premier
  // formulaire du document entier — ce serait potentiellement celui d'un
  // AUTRE produit, et le client ajouterait au panier un produit différent de
  // celui qu'il vient de personnaliser (variante sans rapport avec le
  // product_id déjà correct, transmis par ailleurs dans l'URL). Mieux vaut
  // ne rien trouver ici : l'appelant retombe alors sur `variant_id` déjà
  // posé dans l'URL par Liquid pour CE produit (voir personalise-button.liquid).
  function _tlCurrentVariantId(link) {
    var scope = link && link.closest
      ? link.closest('.shopify-section, product-info, main')
      : null;
    if (!scope) return '';
    var input = scope.querySelector('form[action*="/cart/add"] input[name="id"]')
      || scope.querySelector('product-form input[name="id"]')
      || scope.querySelector('input[name="id"][value]');
    var value = input && input.value ? String(input.value).trim() : '';
    return /^\d+$/.test(value) ? value : '';
  }

  function _tlEditorRequest(href, link) {
    try {
      var url = new URL(href, window.location.origin);
      var hasProduct = !!(url.searchParams.get('product_id') || url.searchParams.get('product'));
      var variantId = _tlCurrentVariantId(link) || url.searchParams.get('variant_id');
      if (variantId) url.searchParams.set('variant_id', variantId);
      return { url: url.href, ready: hasProduct && !!variantId };
    } catch (e) {
      return { url: href, ready: false };
    }
  }

  function interceptLinks() {
    document.addEventListener('click', function(e) {
      var link = e.target.closest('a');
      if (!link) return;
      if (link.hasAttribute('data-tsl-open')) return;
      var href = link.getAttribute('href') || '';
      var isTLEditor =
        link.dataset.tlEditor === 'true' ||
        href.includes('textilelab-studio.html') ||
        href.includes('/apps/textilelab');
      if (!isTLEditor) return;
      e.preventDefault();
      e.stopPropagation();
      var request = _tlEditorRequest(href, link);
      if (!request.ready) {
        _tlGoToProductPage('');
        return;
      }
      openModal(request.url);
    }, true);
  }

  // ── Bouton universel [data-tsl-open] ────────────────────────────────────────
  // Permet d'insérer un bouton "Personnaliser" dans n'importe quelle section
  // Liquid sans devoir gérer onclick / href / TLModal manuellement.
  //
  // Usage :
  //   <a data-tsl-open>Créer mon T-shirt</a>                — mode générique
  //   <a data-tsl-open="123456789">Créer</a>                — product_id
  //   <a data-tsl-open="t-shirt-personnalise">Créer</a>     — product handle
  //   <a data-tsl-open data-tsl-url="/...">Créer</a>        — URL custom

  // Origin du backend TextileLab. URL directe (pas /apps/textilelab) car les
  // responses de l'App Proxy sont servies avec X-Frame-Options: SAMEORIGIN par
  // Shopify, ce qui bloque l'embed iframe. La route /textilelab-studio.html
  // côté Railway envoie au contraire une CSP frame-ancestors qui autorise
  // *.myshopify.com → embed iframe OK.
  var TSL_BACKEND_ORIGIN = 'https://textile-studio-production.up.railway.app';

  // ── Identité du client connecté ─────────────────────────────────────────────
  // Le studio tourne dans une iframe Railway : il ne voit pas la session
  // Shopify. On demande donc à l'App Proxy un jeton signé (/apps/textilelab/
  // whoami) et on le lui transmet. C'est ce jeton qui débloque le quota de
  // générations IA réservé aux clients connectés.
  var _tlCustomerToken = null;

  function _tlFetchCustomerToken() {
    if (_tlCustomerToken) return Promise.resolve(_tlCustomerToken);
    // Chemin relatif : Shopify route vers le backend de l'app installée sur
    // CETTE boutique et signe la requête en y ajoutant logged_in_customer_id.
    return fetch('/apps/textilelab/whoami', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        _tlCustomerToken = (d && d.loggedIn && d.token) ? d.token : null;
        return _tlCustomerToken;
      })
      .catch(function () { return null; }); // non connecté ou proxy indisponible
  }

  // `visual` = slug du design choisi dans le sélecteur de la fiche produit
  // (tl-designs.js le pose en data-tsl-visual sur les boutons). Le studio
  // l'ouvre avec ce visuel déjà posé dans la zone d'impression.
  function buildStudioUrl(idOrHandle, visual) {
    var shop = (window.Shopify && window.Shopify.shop)
            || window._TL_SHOP
            || window.location.hostname;
    var params = new URLSearchParams({ shop: shop, embed: '1' });
    if (idOrHandle) {
      var v = String(idOrHandle).trim();
      if (v) {
        if (/^\d+$/.test(v)) params.set('product_id', v);
        else                 params.set('product', v);
      }
    }
    if (visual) params.set('visual', String(visual).trim());
    if (_tlCustomerToken) params.set('ct', _tlCustomerToken);
    return TSL_BACKEND_ORIGIN + '/textilelab-studio.html?' + params.toString();
  }

  function interceptTslButtons() {
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-tsl-open]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();

      var customUrl = btn.dataset.tslUrl;
      var ref = String(btn.getAttribute('data-tsl-open') || '').trim();
      // L'URL est construite APRÈS la résolution du jeton, pour qu'il y figure.
      // Le jeton est normalement déjà en cache (récupéré au chargement) ; on
      // le réclame ici aussi pour couvrir le cas d'une connexion faite entre
      // temps, sans bloquer l'ouverture si le proxy ne répond pas.
      _tlFetchCustomerToken().then(function () {
        var visual   = String(btn.getAttribute('data-tsl-visual') || '').trim();
        var finalUrl = customUrl ? customUrl : buildStudioUrl(ref, visual);
        var request  = _tlEditorRequest(finalUrl, btn);
        if (!request.ready) {
          // Un bouton qui désigne un produit : on y va.
          if (/^[a-z0-9][a-z0-9-]*$/.test(ref)) { _tlGoToProductPage(ref); return; }
          // Un bouton GÉNÉRIQUE — « Personnaliser » dans un menu, par
          // exemple — ne désigne rien. On envoyait alors sur le produit
          // vierge par défaut, qui peut très bien être désactivé : c'est
          // une page introuvable au bout d'un bouton d'accueil. On demande
          // plutôt sur quoi créer, comme le fait le lien /?tsl=1.
          _tlDemanderLeSupport();
          return;
        }
        openModal(request.url);
      });
    }, true);
  }

  // Helper exposé pour usage JS direct. Sans variante, retour obligatoire par
  // la fiche produit afin que le client choisisse réellement sa taille.
  function openProduct(idOrHandle, variantId) {
    var ref = String(idOrHandle || '').trim();
    if (!variantId) {
      _tlGoToProductPage(/^[a-z0-9][a-z0-9-]*$/.test(ref) ? ref : '');
      return;
    }
    var url = new URL(buildStudioUrl(ref));
    url.searchParams.set('variant_id', String(variantId));
    openModal(url.href);
  }

  // ── Préférences marchand (apparence drawer) ────────────────────────────────
  // Fetch sans bloquer l'init : si la réponse arrive après que des overlays sont
  // déjà injectés, on les rattrape via _tlApplyBgToExistingOverlays().
  function _tlLoadStyleSettings() {
    try {
      var shop = (window.Shopify && window.Shopify.shop)
              || window._TL_SHOP
              || window.location.hostname;
      if (!shop) return;
      var url = TSL_BACKEND_ORIGIN
              + '/api/shop-settings/style/public?shop='
              + encodeURIComponent(shop);
      fetch(url, { credentials: 'omit', mode: 'cors' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (!data) return;
          var bg = String(data.cart_drawer_bg_color || '').trim().toLowerCase();
          if (bg && bg !== 'transparent') {
            _TL_CART_BG = bg;
            _tlApplyBgToExistingOverlays();
          }
          // Flag item 24 (bandeau "Reprendre ma création") : lu ici plutôt que
          // sur la route /api/designs/mine elle-même, pour ne faire cet appel
          // réseau en plus (whoami + designs/mine) que si le marchand l'a activé.
          if (data.resume_design_enabled) _tlCheckResumeDesign();
          // Flag item 25 (lien de reprise par email) : simple mémorisation,
          // consommée à la fermeture du studio (case 'tl-close-modal' ci-dessous) —
          // pas d'appel réseau supplémentaire ici.
          _TL_EMAIL_RESUME_ENABLED = !!data.email_resume_enabled;
          // Flag item 26 (bouton "Modifier" sur une ligne de panier) : simple
          // mémorisation, consommée par _tlEnsureModifierButton à chaque sync
          // panier — si la réponse arrive après que des lignes ont déjà été
          // fixées sans le bouton, le sync suivant (debounce/MutationObserver/
          // évènements thème) le rattrape, _tlEnsureModifierButton n'étant pas
          // gardée par le même marqueur "déjà traité" que _tlFixLineItemProps.
          _TL_CART_EDIT_DESIGN_ENABLED = !!data.cart_edit_design_enabled;
          if (_TL_CART_EDIT_DESIGN_ENABLED) _tlSyncCartImages();
          // Flag item 23 (panneau partiel desktop) : simple mémorisation,
          // consommée par openModal()/closeModal() à la prochaine ouverture —
          // si le studio est déjà ouvert quand la réponse arrive, il reste en
          // plein écran jusqu'à la fermeture suivante (pas de bascule à chaud).
          _TL_PANEL_MODE_STUDIO_ENABLED = !!data.panel_mode_studio_enabled;
          // Flag item 32 (même création, autre taille) : simple mémorisation,
          // consommée par _tlOfferOtherSize() juste après un ajout au panier
          // réussi — pas d'appel réseau supplémentaire ici.
          _TL_SAME_DESIGN_OTHER_SIZE_ENABLED = !!data.same_design_other_size_enabled;
          // Flag item 33 (2e exemplaire identique) : simple mémorisation,
          // consommée par _tlOfferSecondUnit() juste après un ajout au panier
          // réussi — pas d'appel réseau supplémentaire ici.
          _TL_SAME_DESIGN_SECOND_UNIT_ENABLED = !!data.same_design_second_unit_enabled;
          // Flag item 37 (bandeau "défaut d'impression refait gratuitement") :
          // simple mémorisation, consommée par _tlShowPrintGuaranteeBanner()
          // juste après un ajout au panier réussi — pas d'appel réseau
          // supplémentaire ici.
          _TL_PRINT_GUARANTEE_BANNER_ENABLED = !!data.print_guarantee_banner_enabled;
        })
        .catch(function() {});
    } catch (e) { /* silencieux */ }
  }

  function _tlApplyBgToExistingOverlays() {
    if (!_TL_CART_BG) return;
    var overlays = document.querySelectorAll('.tl-design-overlay');
    for (var i = 0; i < overlays.length; i++) {
      overlays[i].style.setProperty('background', _TL_CART_BG, 'important');
    }
  }

  // ── Gating du bouton « Personnaliser » selon les liaisons admin ─────────────
  // Le block liquid rend le bouton masqué (display:none) sur le storefront.
  // On interroge /api/product-links/public et on ne révèle que les produits
  // LIÉS à un mockup en admin. Fail-open : en cas d'erreur réseau/API, on révèle
  // tous les boutons pour ne jamais casser la perso d'un produit légitimement lié.
  function _tlRevealCtas(btns) {
    for (var i = 0; i < btns.length; i++) _tlCtaContainer(btns[i]).style.display = '';
  }
  // Conteneur à afficher/masquer pour un bouton donné (compat ancien + nouveau liquid).
  function _tlCtaContainer(btn) {
    return btn.closest('.tl-cta-block')
        || btn.closest('[id^="tl-cta-"]')
        || btn;
  }
  // Contexte produit : data-attributes (nouveau liquid) sinon params du href (ancien).
  function _tlBtnProduct(btn) {
    var box = btn.closest('[data-tl-product-id], [data-tl-product-handle]');
    var pid = box ? (box.getAttribute('data-tl-product-id') || '') : '';
    var ph  = box ? (box.getAttribute('data-tl-product-handle') || '') : '';
    if (!pid && !ph) {
      try {
        var u = new URL(btn.getAttribute('href') || '', window.location.origin);
        pid = u.searchParams.get('product_id') || '';
        ph  = u.searchParams.get('product') || '';
      } catch (e) { /* href non parsable → laissé vide */ }
    }
    return { pid: String(pid).trim(), ph: String(ph).trim().toLowerCase() };
  }
  function _tlGatePersonaliseButtons() {
    var btns = document.querySelectorAll('.tl-personalise-btn');
    if (!btns.length) return;
    var shop = (window.Shopify && window.Shopify.shop)
            || window._TL_SHOP
            || window.location.hostname;
    if (!shop) { _tlRevealCtas(btns); return; }
    var url = TSL_BACKEND_ORIGIN
            + '/api/product-links/public?shop=' + encodeURIComponent(shop)
            + '&_=' + Date.now();
    fetch(url, { credentials: 'omit', mode: 'cors' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(links) {
        // fail-open : erreur API OU boutique sans AUCUNE liaison (install fraîche /
        // store de review Shopify) → on affiche les boutons pour ne pas paraître
        // cassé. Le gating ne s'active que dès qu'au moins un produit est lié.
        if (!Array.isArray(links) || links.length === 0) { _tlRevealCtas(btns); return; }
        var ids = {}, handles = {};
        links.forEach(function(l) {
          if (l.shopify_product_id != null) ids[String(l.shopify_product_id)] = 1;
          if (l.shopify_product_handle) handles[String(l.shopify_product_handle).toLowerCase()] = 1;
        });
        for (var i = 0; i < btns.length; i++) {
          var p = _tlBtnProduct(btns[i]);
          // Bouton générique (aucun produit ciblé) → on n'y touche pas.
          if (!p.pid && !p.ph) { _tlCtaContainer(btns[i]).style.display = ''; continue; }
          var linked = (p.pid && ids[p.pid]) || (p.ph && handles[p.ph]);
          _tlCtaContainer(btns[i]).style.display = linked ? '' : 'none';
        }
      })
      .catch(function() { _tlRevealCtas(btns); }); // fail-open
  }

  // ── Reprise de création pour le client connecté (backlog item 24) ─────────
  //
  // Un client connecté qui interrompt sa personnalisation avant achat (onglet
  // fermé, coupure mobile, hésitation) repart aujourd'hui de zéro en revenant
  // sur le produit. S'il existe une création récente et pas encore commandée,
  // on le propose discrètement au-dessus du bouton "Personnaliser" plutôt que
  // d'ouvrir directement un éditeur vierge. V1 lean : client connecté
  // uniquement (le serveur refuse sans jeton signé), un seul produit (le
  // premier bouton de perso présent sur la page), pas d'écran "Mes créations".
  var _TL_RESUME_DONE = false; // un seul essai par chargement de page

  function _tlResumeDismissKey(designId) { return 'tl_resume_dismissed_' + designId; }

  function _tlCheckResumeDesign() {
    if (_TL_RESUME_DONE) return;
    _TL_RESUME_DONE = true;
    var btns = document.querySelectorAll('.tl-personalise-btn');
    if (!btns.length) return;
    var btn = null, ref = '';
    for (var i = 0; i < btns.length; i++) {
      var p = _tlBtnProduct(btns[i]);
      if (p.pid || p.ph) { btn = btns[i]; ref = p.pid || p.ph; break; }
    }
    if (!btn || !ref) return; // bouton générique (aucun produit ciblé) → rien à reprendre

    _tlFetchCustomerToken().then(function (token) {
      if (!token) return; // visiteur non connecté : pas de reprise en V1

      var shop = (window.Shopify && window.Shopify.shop) || window._TL_SHOP || window.location.hostname;
      var url = TSL_BACKEND_ORIGIN
              + '/api/designs/mine?shop=' + encodeURIComponent(shop)
              + '&product=' + encodeURIComponent(ref)
              + '&ct=' + encodeURIComponent(token);
      fetch(url, { credentials: 'omit', mode: 'cors' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (design) {
          if (!design || !design.id) return;
          try { if (sessionStorage.getItem(_tlResumeDismissKey(design.id))) return; } catch (e) { /* stockage indisponible → on propose quand même */ }
          _tlInjectResumeBanner(btn, ref, design);
        })
        .catch(function () {}); // jamais bloquant : pas de design, pas de bandeau
    });
  }

  function _tlInjectResumeBanner(btn, ref, design) {
    var vieux = document.querySelector('.tl-resume');
    if (vieux && vieux.parentNode) vieux.parentNode.removeChild(vieux);

    var el = document.createElement('div');
    el.className = 'tl-resume';

    var texte = document.createElement('span');
    texte.className = 'tl-resume-t';
    texte.textContent = 'Vous avez une création en cours';
    el.appendChild(texte);

    var actions = document.createElement('span');
    actions.className = 'tl-resume-a';

    var reprendre = document.createElement('button');
    reprendre.type = 'button';
    reprendre.className = 'tl-resume-r';
    reprendre.textContent = 'Reprendre';
    reprendre.addEventListener('click', function () {
      var studioUrl = new URL(buildStudioUrl(ref));
      studioUrl.searchParams.set('design', String(design.id));
      openModal(studioUrl.href);
    });
    actions.appendChild(reprendre);

    var zero = document.createElement('button');
    zero.type = 'button';
    zero.className = 'tl-resume-z';
    zero.textContent = 'Repartir de zéro';
    zero.addEventListener('click', function () {
      try { sessionStorage.setItem(_tlResumeDismissKey(design.id), '1'); } catch (e) { /* tant pis, pas bloquant */ }
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    actions.appendChild(zero);

    el.appendChild(actions);

    var container = _tlCtaContainer(btn);
    container.parentNode.insertBefore(el, container);
  }

  // ── Lien de reprise par email, pour le visiteur NON connecté (item 25) ─────
  //
  // Complète le bandeau "Reprendre ma création" ci-dessus (item 24, client
  // connecté uniquement) : un visiteur anonyme qui ferme le studio sans avoir
  // acheté peut demander à recevoir par email un lien pour reprendre sa
  // création plus tard. Déclenché uniquement à la fermeture VOLONTAIRE du
  // studio (case 'tl-close-modal') — jamais après un ajout au panier (fermé
  // par le message 'tl-add-to-cart' ci-dessus, qui ne passe pas par ici) :
  // pas de proposition sur un achat déjà fait.
  function _tlEmailResumeDismissKey(designId) { return 'tl_email_resume_dismissed_' + designId; }

  function _tlMaybeOfferEmailResumeLink(designId, designToken) {
    if (!_TL_EMAIL_RESUME_ENABLED || !designId) return;
    try { if (sessionStorage.getItem(_tlEmailResumeDismissKey(designId))) return; } catch (e) { /* stockage indisponible → on propose quand même */ }

    _tlFetchCustomerToken().then(function (token) {
      if (token) return; // client connecté : le bandeau .tl-resume (item 24) prend déjà le relais
      _tlInjectEmailResumeLink(designId, designToken);
    });
  }

  function _tlInjectEmailResumeLink(designId, designToken) {
    var vieux = document.querySelector('.tl-email-resume');
    if (vieux && vieux.parentNode) vieux.parentNode.removeChild(vieux);

    var btns = document.querySelectorAll('.tl-personalise-btn');
    var btn = null;
    for (var i = 0; i < btns.length; i++) {
      var p = _tlBtnProduct(btns[i]);
      if (p.pid || p.ph) { btn = btns[i]; break; }
    }
    if (!btn) return; // aucun bouton de personnalisation sur cette page → rien à ancrer

    var el = document.createElement('div');
    el.className = 'tl-email-resume';

    var lien = document.createElement('button');
    lien.type = 'button';
    lien.className = 'tl-email-resume-link';
    lien.textContent = 'Recevoir un lien pour reprendre ma création';
    el.appendChild(lien);

    var msg = document.createElement('span');
    msg.className = 'tl-email-resume-msg';
    msg.style.display = 'none';

    lien.addEventListener('click', function () {
      if (el.querySelector('.tl-email-resume-form')) return; // déjà ouvert
      lien.style.display = 'none';

      var form = document.createElement('div');
      form.className = 'tl-email-resume-form';

      var input = document.createElement('input');
      input.type = 'email';
      input.className = 'tl-email-resume-input';
      input.placeholder = 'votre@email.com';
      form.appendChild(input);

      var envoyer = document.createElement('button');
      envoyer.type = 'button';
      envoyer.className = 'tl-email-resume-send';
      envoyer.textContent = 'Envoyer';
      form.appendChild(envoyer);

      var annuler = document.createElement('button');
      annuler.type = 'button';
      annuler.className = 'tl-email-resume-cancel';
      annuler.textContent = 'Annuler';
      annuler.addEventListener('click', function () {
        try { sessionStorage.setItem(_tlEmailResumeDismissKey(designId), '1'); } catch (e) { /* tant pis, pas bloquant */ }
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      form.appendChild(annuler);

      el.appendChild(form);
      el.appendChild(msg);
      input.focus();

      envoyer.addEventListener('click', function () {
        var email = String(input.value || '').trim();
        if (!email || email.indexOf('@') === -1 || email.indexOf('.') === -1) {
          msg.textContent = 'Adresse email invalide.';
          msg.style.display = '';
          return;
        }
        envoyer.disabled = true;
        var shop = (window.Shopify && window.Shopify.shop) || window._TL_SHOP || window.location.hostname;
        var url = TSL_BACKEND_ORIGIN
                + '/api/designs/' + encodeURIComponent(designId) + '/email-resume-link'
                + '?shop=' + encodeURIComponent(shop);
        fetch(url, {
          method: 'POST',
          mode: 'cors',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, design_token: designToken }),
        })
        .then(function (r) { return r.ok; })
        .then(function (ok) {
          envoyer.disabled = false;
          if (ok) {
            try { sessionStorage.setItem(_tlEmailResumeDismissKey(designId), '1'); } catch (e) { /* non bloquant */ }
            form.style.display = 'none';
            msg.textContent = 'Lien envoyé — vérifiez votre boîte mail.';
          } else {
            msg.textContent = 'Envoi impossible, réessayez plus tard.';
          }
          msg.style.display = '';
        })
        .catch(function () {
          envoyer.disabled = false;
          msg.textContent = 'Envoi impossible, réessayez plus tard.';
          msg.style.display = '';
        });
      });
    });

    var container = _tlCtaContainer(btn);
    container.parentNode.insertBefore(el, container);
  }

  // ── Même création, dans une autre taille, sans repasser par le studio (item 32) ─
  //
  // Un client qui vient d'ajouter sa création au panier dans une taille peut
  // vouloir la même création dans une 2e taille (pour lui-même ou pour un
  // proche) — aujourd'hui il doit fermer le studio, changer la taille sur la
  // fiche, le rouvrir et tout redessiner de zéro. Le fichier d'impression
  // (design_id/layers_json) n'est jamais lié à une variant_id Shopify : la
  // même création reste valide quelle que soit la taille, il suffit de poser
  // une 2e ligne panier avec les mêmes `properties` (donc le même
  // `_design_id`/`_preview_img`) et une `id` de variante différente — jamais
  // de réouverture du studio, jamais de nouveau rendu Fabric.js.
  //
  // Ce n'est PAS la "commande groupée" rejetée par Alan : un seul acheteur,
  // une seule création, un 2e exemplaire pour lui-même/un proche dans une
  // autre taille — pas plusieurs personnes différentes dans une commande
  // partagée.
  function _tlOtherSizeDismissKey(designId, variantId) {
    return 'tl_other_size_dismissed_' + (designId || 'na') + '_' + variantId;
  }

  function _tlOfferOtherSize(vid, props, previewUrl) {
    if (!_TL_SAME_DESIGN_OTHER_SIZE_ENABLED || !vid) return;
    var designId = (props && props['_design_id']) || '';
    try { if (sessionStorage.getItem(_tlOtherSizeDismissKey(designId, vid))) return; } catch (e) { /* stockage indisponible → on propose quand même */ }

    // Même mécanisme que _tlCheckResumeDesign/_tlInjectEmailResumeLink pour
    // retrouver le produit courant sans appel réseau supplémentaire — ici il
    // faut un handle (pas seulement un id) pour pouvoir lire /products/<h>.js,
    // comme le fait déjà _tlFicheSupport pour l'upsell.
    var btns = document.querySelectorAll('.tl-personalise-btn');
    var btn = null, ph = '';
    for (var i = 0; i < btns.length; i++) {
      var p = _tlBtnProduct(btns[i]);
      if (p.ph) { btn = btns[i]; ph = p.ph; break; }
    }
    if (!btn || !ph) return; // pas de handle connu sur cette page → rien à proposer

    fetch('/products/' + encodeURIComponent(ph) + '.js', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (txt) {
        var d = null;
        try { d = JSON.parse(txt); } catch (e) { /* page de garde, pas un produit */ }
        if (!d) return;
        var vidNum = parseInt(vid, 10);
        // Les autres tailles DISPONIBLES de ce même produit, sans la variante
        // qui vient d'être ajoutée — au plus 2, pour rester discret.
        var autres = _tlVariantesDeBase(d).filter(function (v) {
          return v.id !== vidNum && v.dispo !== false;
        }).slice(0, 2);
        if (!autres.length) return;
        _tlInjectOtherSizeOffer(btn, autres, designId, vid, props, previewUrl);
      })
      .catch(function () {}); // jamais bloquant : pas de suggestion, le client continue
  }

  function _tlInjectOtherSizeOffer(btn, autres, designId, vid, props, previewUrl) {
    var vieux = document.querySelector('.tl-other-size');
    if (vieux && vieux.parentNode) vieux.parentNode.removeChild(vieux);

    var el = document.createElement('div');
    el.className = 'tl-other-size';

    var texte = document.createElement('span');
    texte.className = 'tl-other-size-t';
    texte.textContent = autres.length > 1
      ? 'Vous voulez aussi cette création dans une autre taille ?'
      : 'Vous voulez aussi cette création en ' + autres[0].nom + ' ?';
    el.appendChild(texte);

    var actions = document.createElement('span');
    actions.className = 'tl-other-size-a';

    autres.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tl-other-size-b';
      b.textContent = v.nom;
      b.addEventListener('click', function () {
        if (b.disabled) return;
        b.disabled = true;
        fetch('/cart/add.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ items: [{ id: v.id, quantity: 1, properties: props }] }),
        })
        // Même piège déjà corrigé le 13/10 pour l'ajout principal : un refus
        // Shopify (422, variante épuisée entre-temps, etc.) répond souvent un
        // JSON {status,message,description} avec un code HTTP non-200 — jamais
        // lire juste r.json() sans vérifier r.ok/data.status, sous peine de
        // traiter un refus silencieux comme un succès (image injectée pour une
        // ligne jamais ajoutée, encart masqué, plus jamais reproposé).
        .then(function (r) {
          return r.text().then(function (txt) {
            var data = null;
            try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* pas du JSON */ }
            var echec = !r.ok || !data || data.status >= 400;
            if (echec) {
              var raison = (data && (data.description || data.message))
                || String(txt || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
                || ('HTTP ' + r.status);
              var err = new Error(raison);
              err.panierRefuse = true;
              throw err;
            }
            return data;
          });
        })
        .then(function () {
          if (previewUrl) {
            _tlInjectCartImage(v.id, previewUrl);
            setTimeout(function () { _tlInjectCartImage(v.id, previewUrl); }, 200);
            setTimeout(function () { _tlInjectCartImage(v.id, previewUrl); }, 600);
          }
          _tlFixAllLineItems();
          setTimeout(_tlFixAllLineItems, 300);
          try { sessionStorage.setItem(_tlOtherSizeDismissKey(designId, vid), '1'); } catch (e) { /* non bloquant */ }
          if (el.parentNode) el.parentNode.removeChild(el);
        })
        .catch(function (err) {
          // Jamais bloquant pour le 1er ajout (déjà acquis) : on réactive le
          // bouton et on le dit, plutôt que de laisser croire que le 2e
          // exemplaire a été ajouté alors que rien n'est au panier.
          b.disabled = false;
          var shop = (window.Shopify && window.Shopify.shop) || window._TL_SHOP || window.location.hostname;
          _tlTrackCartError(shop, v.id, (err && err.message) || 'other-size-add-failed');
          var msg = el.querySelector('.tl-other-size-msg');
          if (!msg) {
            msg = document.createElement('div');
            msg.className = 'tl-other-size-msg';
            el.appendChild(msg);
          }
          msg.textContent = 'Ajout impossible pour l\'instant, réessayez.';
        });
      });
      actions.appendChild(b);
    });

    var fermer = document.createElement('button');
    fermer.type = 'button';
    fermer.className = 'tl-other-size-z';
    fermer.textContent = 'Non merci';
    fermer.addEventListener('click', function () {
      try { sessionStorage.setItem(_tlOtherSizeDismissKey(designId, vid), '1'); } catch (e) { /* tant pis, pas bloquant */ }
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    actions.appendChild(fermer);

    el.appendChild(actions);

    var container = _tlCtaContainer(btn);
    container.parentNode.insertBefore(el, container);
  }

  // ── "Ajouter un 2e exemplaire identique" (item 33) ──────────────────────────
  //
  // Spec de repli du 15/10 (veille CPB) : la V1 originale envisageait une
  // remise affichée ("-10%"), mais aucune API panier Shopify ni aucun code de
  // ce dépôt ne sait aujourd'hui créer/piloter une remise réelle — promettre
  // un pourcentage non tenu au checkout serait un bug de confiance. Cette
  // version ne calcule ni n'affiche AUCUN pourcentage : juste la même
  // variante/properties que l'ajout qui vient d'avoir lieu (pas une autre
  // taille, voir _tlOfferOtherSize ci-dessus), posée une 2e fois au panier —
  // Shopify fusionne alors les deux lignes identiques en une seule quantité 2,
  // aucun nouveau rendu Fabric.js nécessaire. Si Alan configure un jour une
  // remise automatique native Shopify sur ce produit/cette collection, elle
  // s'appliquera d'elle-même au panier/checkout sans que TSL ait besoin de la
  // connaître ni de la promettre.
  function _tlSecondUnitDismissKey(designId, variantId) {
    return 'tl_second_unit_dismissed_' + (designId || 'na') + '_' + variantId;
  }

  function _tlOfferSecondUnit(vid, props, previewUrl) {
    if (!_TL_SAME_DESIGN_SECOND_UNIT_ENABLED || !vid) return;
    var designId = (props && props['_design_id']) || '';
    try { if (sessionStorage.getItem(_tlSecondUnitDismissKey(designId, vid))) return; } catch (e) { /* stockage indisponible → on propose quand même */ }

    var btn = document.querySelector('.tl-personalise-btn');
    if (!btn) return; // aucun bouton sur cette page → rien où ancrer l'encart

    _tlInjectSecondUnitOffer(btn, vid, props, previewUrl, designId);
  }

  function _tlInjectSecondUnitOffer(btn, vid, props, previewUrl, designId) {
    var vieux = document.querySelector('.tl-second-unit');
    if (vieux && vieux.parentNode) vieux.parentNode.removeChild(vieux);

    var el = document.createElement('div');
    el.className = 'tl-second-unit';

    var texte = document.createElement('span');
    texte.className = 'tl-second-unit-t';
    texte.textContent = 'Vous en voulez un 2e exemplaire identique ?';
    el.appendChild(texte);

    var actions = document.createElement('span');
    actions.className = 'tl-second-unit-a';

    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tl-second-unit-b';
    b.textContent = 'Ajouter un 2e exemplaire';
    b.addEventListener('click', function () {
      if (b.disabled) return;
      b.disabled = true;
      fetch('/cart/add.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ items: [{ id: vid, quantity: 1, properties: props }] }),
      })
      // Même détection de refus silencieux que _tlInjectOtherSizeOffer
      // (bug trouvé le 15/10) : jamais un r.json() non vérifié.
      .then(function (r) {
        return r.text().then(function (txt) {
          var data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* pas du JSON */ }
          var echec = !r.ok || !data || data.status >= 400;
          if (echec) {
            var raison = (data && (data.description || data.message))
              || String(txt || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
              || ('HTTP ' + r.status);
            var err = new Error(raison);
            err.panierRefuse = true;
            throw err;
          }
          return data;
        });
      })
      .then(function () {
        if (previewUrl) {
          _tlInjectCartImage(vid, previewUrl);
          setTimeout(function () { _tlInjectCartImage(vid, previewUrl); }, 200);
          setTimeout(function () { _tlInjectCartImage(vid, previewUrl); }, 600);
        }
        _tlFixAllLineItems();
        setTimeout(_tlFixAllLineItems, 300);
        try { sessionStorage.setItem(_tlSecondUnitDismissKey(designId, vid), '1'); } catch (e) { /* non bloquant */ }
        if (el.parentNode) el.parentNode.removeChild(el);
      })
      .catch(function (err) {
        b.disabled = false;
        var shop = (window.Shopify && window.Shopify.shop) || window._TL_SHOP || window.location.hostname;
        _tlTrackCartError(shop, vid, (err && err.message) || 'second-unit-add-failed');
        var msg = el.querySelector('.tl-second-unit-msg');
        if (!msg) {
          msg = document.createElement('div');
          msg.className = 'tl-second-unit-msg';
          el.appendChild(msg);
        }
        msg.textContent = 'Ajout impossible pour l\'instant, réessayez.';
      });
    });
    actions.appendChild(b);

    var fermer = document.createElement('button');
    fermer.type = 'button';
    fermer.className = 'tl-second-unit-z';
    fermer.textContent = 'Non merci';
    fermer.addEventListener('click', function () {
      try { sessionStorage.setItem(_tlSecondUnitDismissKey(designId, vid), '1'); } catch (e) { /* tant pis, pas bloquant */ }
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    actions.appendChild(fermer);

    el.appendChild(actions);

    var container = _tlCtaContainer(btn);
    container.parentNode.insertBefore(el, container);
  }

  // Bandeau de confiance "défaut d'impression refait gratuitement" (item 37)
  // — calqué sur _tlInjectSecondUnitOffer ci-dessus, mais sans bouton ni appel
  // réseau : une seule ligne de texte, jamais bloquante. Texte placeholder,
  // à relire/ajuster avec Alan selon la politique réelle de WinShirt avant
  // activation (flag désactivé par défaut).
  function _tlShowPrintGuaranteeBanner() {
    if (!_TL_PRINT_GUARANTEE_BANNER_ENABLED) return;
    var btn = document.querySelector('.tl-personalise-btn');
    if (!btn) return; // aucun bouton sur cette page → rien où ancrer le bandeau

    var vieux = document.querySelector('.tl-print-guarantee');
    if (vieux && vieux.parentNode) vieux.parentNode.removeChild(vieux);

    var el = document.createElement('div');
    el.className = 'tl-print-guarantee';
    el.textContent = '✅ Un souci avec l\'impression ? On la refait gratuitement.';

    var container = _tlCtaContainer(btn);
    container.parentNode.insertBefore(el, container);
  }

  // ── Suggestions après l'ajout au panier (Upsell V2) ────────────────────────
  //
  // Le marchand associe en admin 2 à 4 produits à proposer une fois un
  // produit ajouté au panier. On les montre dans NOTRE encart, pas dans le
  // tiroir du thème : son balisage change d'un thème à l'autre, et une
  // injection dedans casserait au premier changement de thème — on a déjà
  // assez à faire pour y remettre la bonne vignette.
  //
  // Jamais bloquant : pas de suggestion, pas d'identifiant produit, API
  // muette, réseau coupé → on ne montre rien et le client continue.


  /**
   * Produit dont on vient d'ajouter une personnalisation.
   *
   * L'éditeur de fiche le passe dans le message ; le studio, lui, ne le
   * connaît pas toujours — on retombe alors sur ce que la page sait d'elle
   * même, et en dernier recours sur le bloc du bouton.
   */
  function _tlUpsellSource(data) {
    var id = (data && data.productId) || '';
    if (!id) {
      try {
        id = (window.ShopifyAnalytics && window.ShopifyAnalytics.meta
           && window.ShopifyAnalytics.meta.product
           && window.ShopifyAnalytics.meta.product.id) || '';
      } catch (e) { /* meta absent sur une page hors fiche produit */ }
    }
    if (!id) {
      var box = document.querySelector('[data-tl-product-id]');
      if (box) id = box.getAttribute('data-tl-product-id') || '';
    }
    return String(id || '').trim();
  }

  /** Prix formaté dans la devise de la boutique, ou rien si on ne sait pas. */
  function _tlUpsellPrix(centimes) {
    if (typeof centimes !== 'number' || !isFinite(centimes)) return '';
    try {
      var devise = (window.Shopify && window.Shopify.currency
                 && window.Shopify.currency.active) || 'EUR';
      return new Intl.NumberFormat(document.documentElement.lang || 'fr', {
        style: 'currency', currency: devise,
      }).format(centimes / 100);
    } catch (e) { return ''; }
  }

  /**
   * Ne remplace une image que si la nouvelle charge vraiment.
   *
   * L'aperçu composé est rendu à la demande par le serveur : il peut
   * manquer (produit non calibré), tarder, ou échouer. On part donc de la
   * photo nue, et on ne la remplace qu'une fois l'autre prête — jamais de
   * case vide en attendant.
   */
  function _tlImageSiChargeable(url, surSucces) {
    var img = new Image();
    var fini = false;
    var minuteur = setTimeout(function () { fini = true; img.src = ''; }, 8000);
    img.onload = function () {
      if (fini) return;
      clearTimeout(minuteur);
      surSucces(url);
    };
    img.onerror = function () { clearTimeout(minuteur); };
    img.src = url;
  }

  /**
   * La création du client, posée sur le produit suggéré.
   *
   * Sans elle, on propose un vêtement vierge à quelqu'un qui vient justement
   * de dessiner : il doit imaginer le résultat. La photo de référence du
   * produit cible est utilisée — c'est celle sur laquelle le marchand a
   * calibré sa zone, donc la seule où le placement est juste. Produit non
   * calibré : le serveur répond 404 et on garde la photo nue.
   */
  function _tlUpsellApercuCompose(c, design, shop) {
    var cible = String((c && c.product_id) || '').replace(/\D/g, '');
    if (!cible || !design || !design.id) return '';
    return TSL_BACKEND_ORIGIN + '/api/products/' + cible + '/composition-preview'
         + '?design=' + encodeURIComponent(design.id)
         + '&token=' + encodeURIComponent(design.token || '')
         + '&shop=' + encodeURIComponent(shop);
  }

  /**
   * Impression/clic de l'encart, envoyés sans jamais attendre ni bloquer.
   *
   * `sendBeacon` survit à la navigation qui suit immédiatement un clic (un
   * `fetch` classique serait parfois annulé par le changement de page avant
   * d'avoir pu partir) ; `keepalive` est le filet de secours sur les
   * navigateurs qui ne l'ont pas. Échec réseau, CORS, shop inconnu : jamais
   * d'erreur remontée à l'appelant, l'encart continue comme si de rien.
   */
  function _tlTrackUpsell(shop, source, target, event) {
    try {
      var url = TSL_BACKEND_ORIGIN
              + '/api/upsell-candidates/track?shop=' + encodeURIComponent(shop);
      var payload = JSON.stringify({ source: source, target: target, event: event });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(url, {
          method: 'POST', mode: 'cors', credentials: 'omit', keepalive: true,
          headers: { 'Content-Type': 'application/json' }, body: payload,
        }).catch(function () {});
      }
    } catch (e) { /* jamais bloquant */ }
  }

  /**
   * Refus de /cart/add déjà détecté par le client (tl-modal.js), envoyé
   * sans jamais attendre ni bloquer — même mécanique que _tlTrackUpsell().
   * Backlog item 31 : objectiver le point P0 (trou paiement commencé →
   * commande) sans dépendre d'un accès live à Shopify Analytics.
   */
  function _tlTrackCartError(shop, variantId, reason) {
    try {
      var url = TSL_BACKEND_ORIGIN
              + '/api/cart-add-errors/track?shop=' + encodeURIComponent(shop);
      var payload = JSON.stringify({ variantId: variantId, reason: reason });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(url, {
          method: 'POST', mode: 'cors', credentials: 'omit', keepalive: true,
          headers: { 'Content-Type': 'application/json' }, body: payload,
        }).catch(function () {});
      }
    } catch (e) { /* jamais bloquant */ }
  }

  function _tlFermerUpsell() {
    var vieux = document.querySelector('.tl-upsell');
    if (vieux && vieux.parentNode) vieux.parentNode.removeChild(vieux);
  }

  /**
   * Visuel, titre et prix d'un produit, lus sur la boutique elle-même.
   *
   * Le backend ne stocke que l'identifiant et le handle : une image ou un
   * prix recopiés chez nous seraient faux au premier changement en admin.
   */
  function _tlUpsellFiche(c) {
    // Requête de MÊME ORIGINE, donc avec les cookies : sans eux, une boutique
    // protégée par mot de passe (preview, boutique de dev) renvoie sa page de
    // garde au lieu du produit — on perdait visuel ET prix, sans la moindre
    // erreur, et un 200 tout à fait honnête.
    //
    // On juge la réponse sur son CONTENU et non sur son type : Shopify sert
    // cette API en `text/javascript`, pas en `application/json`. Exiger du
    // JSON dans l'en-tête rejetait toutes les bonnes réponses ; une page de
    // garde, elle, ne se parse pas.
    return fetch('/products/' + encodeURIComponent(c.handle) + '.js', {
      credentials: 'same-origin',
    })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (txt) {
        try {
          var p = JSON.parse(txt);
          return (p && typeof p === 'object' && p.title) ? p : null;
        } catch (e) { return null; }
      })
      .then(function (p) {
        if (!p) return c;
        // Le prix annoncé est celui que le client PAIERA : base du produit
        // + impression de sa création sur CE support. Afficher le prix nu
        // lui ferait découvrir l'écart après le clic.
        var sup = Number(c.surcharge) || 0;
        return {
          product_id: c.product_id,
          handle: c.handle,
          title:  p.title || c.title,
          image:  p.featured_image || (p.images && p.images[0]) || '',
          prix:   _tlUpsellPrix(p.price + Math.round(sup * 100)),
          avecImpression: sup > 0,
        };
      })
      .catch(function () { return c; });
  }

  function _tlAfficherUpsell(fiches, design, shop, source) {
    _tlFermerUpsell();
    var el = document.createElement('div');
    el.className = 'tl-upsell';
    el.setAttribute('role', 'complementary');
    el.setAttribute('aria-label', 'Suggestions');

    var fermer = document.createElement('button');
    fermer.type = 'button';
    fermer.className = 'tl-upsell-x';
    fermer.setAttribute('aria-label', 'Fermer les suggestions');
    fermer.textContent = '\u00d7';
    fermer.addEventListener('click', _tlFermerUpsell);

    var titre = document.createElement('div');
    titre.className = 'tl-upsell-t';
    titre.textContent = 'Vous aimeriez aussi';

    var grille = document.createElement('div');
    grille.className = 'tl-upsell-g';
    fiches.forEach(function (f) {
      var a = document.createElement('a');
      a.className = 'tl-upsell-c';
      a.href = '/products/' + f.handle;
      // Juste avant de suivre le lien, jamais après : le clic doit partir
      // même si la navigation qui suit coupe tout le reste.
      a.addEventListener('click', function () {
        _tlTrackUpsell(shop, source, f.product_id, 'click');
      });
      // La case est posée même sans visuel : une carte sur deux sans image
      // désalignerait la grille, et un <img> sans source affiche une icône
      // de fichier cassé.
      var vignette = document.createElement('span');
      vignette.className = 'tl-upsell-i';
      var poser = function (u) {
        vignette.style.backgroundImage = 'url("' + String(u).replace(/"/g, '%22') + '")';
      };
      if (f.image) poser(f.image);
      a.appendChild(vignette);

      // Puis, si elle arrive, la même création posée sur CE produit.
      var compose = _tlUpsellApercuCompose(f, design, shop);
      if (compose) _tlImageSiChargeable(compose, poser);
      var nom = document.createElement('span');
      nom.className = 'tl-upsell-n';
      nom.textContent = f.title || f.handle;
      a.appendChild(nom);
      if (f.prix) {
        var p = document.createElement('span');
        p.className = 'tl-upsell-p';
        p.textContent = f.avecImpression ? f.prix + ' impression comprise' : f.prix;
        a.appendChild(p);
      }
      grille.appendChild(a);
    });

    // Une impression par fiche réellement montrée, pas par tentative de
    // chargement d'image (qui peut réessayer en arrière-plan).
    fiches.forEach(function (f) {
      _tlTrackUpsell(shop, source, f.product_id, 'impression');
    });

    el.appendChild(fermer);
    el.appendChild(titre);
    el.appendChild(grille);
    document.body.appendChild(el);
    // Deux images consécutives : la seconde enclenche la transition, posée
    // en ligne la classe arriverait dans la même passe de style et rien ne
    // s'animerait.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('tl-on'); });
    });

    var auClavier = function (ev) {
      if (ev.key !== 'Escape') return;
      _tlFermerUpsell();
      document.removeEventListener('keydown', auClavier);
    };
    document.addEventListener('keydown', auClavier);
  }

  function _tlProposerUpsell(data) {
    var source = _tlUpsellSource(data);
    if (!source) return;
    var shop = (window.Shopify && window.Shopify.shop)
            || window._TL_SHOP
            || window.location.hostname;
    // Le design sert deux fois : à tarifer l'impression sur chaque support,
    // et à poser la création sur leurs vignettes.
    var url = TSL_BACKEND_ORIGIN
            + '/api/upsell-candidates/public?shop=' + encodeURIComponent(shop)
            + '&source=' + encodeURIComponent(source)
            + '&design=' + encodeURIComponent((data && data.designId) || '')
            + '&token=' + encodeURIComponent((data && data.designToken) || '');
    fetch(url, { credentials: 'omit', mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (liste) {
        if (!Array.isArray(liste) || !liste.length) return null;
        return Promise.all(liste.map(_tlUpsellFiche));
      })
      .then(function (fiches) {
        if (!fiches || !fiches.length) return;
        var design = { id: (data && data.designId) || '', token: (data && data.designToken) || '' };
        // Après l'ouverture du tiroir : l'encart doit arriver sur un panier
        // déjà affiché, sinon il se fait recouvrir sans avoir été lu.
        setTimeout(function () { _tlAfficherUpsell(fiches, design, shop, source); }, 900);
      })
      .catch(function () { /* suggestions absentes : jamais bloquant */ });
  }

  // ── Masquage de l'option « Impression » sur la fiche produit ────────────────
  // L'option porte les variantes pré-tarifées (prix d'impression inclus). Le
  // client ne doit PAS la voir ni la choisir sur la fiche — il passe par le
  // studio. Best-effort multi-thèmes : on masque le bloc d'option dont le
  // libellé/legend commence par « Impression ». La variante par défaut reste
  // « Sans impression » (prix de base) → fiche produit normale.
  function _tlHidePrintOption() {
    try {
      var RE = /^\s*impression\b/i;
      var nodes = document.querySelectorAll(
        'fieldset legend, .product-form__input > label, .product-form__input legend, label, .form__label'
      );
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (!RE.test(el.textContent || '')) continue;
        var box = el.closest('.product-form__input')
               || el.closest('fieldset')
               || (el.parentElement && (el.parentElement.querySelector('select, input, .select')
                    ? el.parentElement : null));
        if (box) box.style.display = 'none';
      }
    } catch (e) { /* silencieux */ }
  }

  // ── Libellé adaptatif des boutons TSL ──────────────────────────────────────
  // Un produit porteur d'un design (metafield custom.tsl_template) n'est pas
  // « à personnaliser » : il est déjà dessiné, le client vient le retoucher.
  //   template présent → « Modifier ce visuel »
  //   template absent  → « Personnaliser »
  // Les deux libellés sont posés explicitement, sans que le marchand ait à
  // modifier son thème.
  //
  // Personnalisable via attributs, sur le bouton ou sur <body> :
  //   data-tsl-label-template="Modifier ce visuel"
  //   data-tsl-label-plain="Personnaliser"
  var TL_LABEL_TEMPLATE = 'Modifier ce visuel'; // produit AVEC design
  var TL_LABEL_PLAIN    = 'Personnaliser';      // produit SANS design
  var _tlTemplateCache  = {};   // productId → bool

  function _tlSetButtonLabel(btn, label) {
    // Remplace le LIBELLÉ en préservant les icônes. Une icône emoji est un
    // noeud texte comme un autre ("🎨 ") : viser le premier noeud non vide
    // écraserait l'emoji et laisserait l'ancien libellé à côté. On ne retient
    // donc que le premier noeud contenant une LETTRE, et on y remplace la
    // portion lettrée en gardant les espaces autour.
    var walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT, null);
    var node, target = null;
    while ((node = walker.nextNode())) {
      if (/[A-Za-zÀ-ÿ]/.test(node.nodeValue || '')) { target = node; break; }
    }
    if (target) {
      target.nodeValue = target.nodeValue.replace(/[A-Za-zÀ-ÿ][\s\S]*[A-Za-zÀ-ÿ]|[A-Za-zÀ-ÿ]/, label);
      // Un thème peut répéter le libellé dans un noeud suivant (icône + texte
      // dupliqué pour l'accessibilité) : on vide les autres noeuds lettrés.
      while ((node = walker.nextNode())) {
        if (/[A-Za-zÀ-ÿ]/.test(node.nodeValue || '')) node.nodeValue = '';
      }
      return true;
    }
    btn.textContent = label; // bouton sans texte : on en pose un
    return true;
  }

  function _tlHasTemplate(productId) {
    if (Object.prototype.hasOwnProperty.call(_tlTemplateCache, productId)) {
      return Promise.resolve(_tlTemplateCache[productId]);
    }
    var shop = (window.Shopify && window.Shopify.shop) || window._TL_SHOP || '';
    var url  = TSL_BACKEND_ORIGIN + '/api/products/' + encodeURIComponent(productId)
             + '/template?shop=' + encodeURIComponent(shop);
    return fetch(url, { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var has = !!(d && d.exists);
        _tlTemplateCache[productId] = has;
        return has;
      })
      .catch(function () { return false; }); // réseau KO → libellé d'origine
  }

  function _tlRelabelTemplateButtons() {
    var btns = [].slice.call(document.querySelectorAll('[data-tsl-open]'));
    if (!btns.length) return;

    btns.forEach(function (btn) {
      if (btn.getAttribute('data-tsl-relabelled')) return;
      var pid = String(btn.getAttribute('data-tsl-open') || '').replace(/\D/g, '');
      if (!pid) return; // bouton générique (handle) → pas de template à chercher
      btn.setAttribute('data-tsl-relabelled', '1');

      _tlHasTemplate(pid).then(function (has) {
        // Les deux cas sont écrits explicitement : un produit sans design doit
        // dire « Personnaliser », même si le thème affichait autre chose.
        var attr  = has ? 'data-tsl-label-template' : 'data-tsl-label-plain';
        var label = btn.getAttribute(attr)
                 || (document.body && document.body.getAttribute(attr))
                 || (has ? TL_LABEL_TEMPLATE : TL_LABEL_PLAIN);
        _tlSetButtonLabel(btn, label);
        // Crochet CSS pour qui voudrait différencier visuellement les deux cas.
        btn.setAttribute('data-tsl-has-template', has ? '1' : '0');
      });
    });
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  function init() {
    injectDOM();
    listenMessages();
    interceptLinks();
    interceptTslButtons();
    _tlInitCartSync();
    _tlLoadStyleSettings();
    _tlGatePersonaliseButtons();
    _tlHidePrintOption();
    _tlRelabelTemplateButtons();
    _tlFetchCustomerToken(); // en avance, pour que l'ouverture du studio soit immédiate
    _tlEntreeParLeMenu();
    // Les sélecteurs de variante peuvent se rendre tardivement (thèmes JS).
    setTimeout(_tlHidePrintOption, 800);
    setTimeout(_tlHidePrintOption, 2000);
    // Idem pour les boutons rendus après coup (sections AJAX, quick view).
    setTimeout(_tlRelabelTemplateButtons, 900);
    setTimeout(_tlRelabelTemplateButtons, 2200);
  }

  // ── Synchronisation persistante des images du panier ───────────────────────
  // Branche tous les déclencheurs qui peuvent re-render le drawer panier :
  //   - Premier load de page → restaurer overlays sur items déjà au panier
  //   - Évènements thème (cart:update, cart:refresh, theme:cart:update)
  //   - MutationObserver permanent, debouncé à 200ms — couvre les ouvertures/
  //     fermetures de drawer, changements de quantité, etc.
  // Comme _tlSyncCartImages() est idempotent (skip si overlay existe déjà),
  // appeler plusieurs fois est sans coût.
  function _tlInitCartSync() {
    // Premier sync au load + fix props
    _tlSyncCartImages();
    _tlFixAllLineItems();

    // Évènements émis par les thèmes Shopify modernes
    ['cart:update', 'cart:refresh', 'theme:cart:update', 'cart-drawer:open']
      .forEach(function(ev) {
        document.addEventListener(ev, function() {
          _tlScheduleSync();
          _tlFixAllLineItems();
          setTimeout(_tlFixAllLineItems, 200);
        });
      });

    // Observer permanent sur le DOM body — mutations enfants/sous-arbre +
    // changements d'attributs (couvre l'ouverture du <dialog> via 'open',
    // les classes 'is-open' sur les drawers, etc.)
    try {
      var obs = new MutationObserver(_tlScheduleSync);
      obs.observe(document.body, {
        childList:        true,
        subtree:          true,
        attributes:       true,
        attributeFilter:  ['open', 'class', 'aria-hidden', 'aria-expanded']
      });
    } catch (e) { /* sandbox sans MutationObserver — ignoré */ }

    // Hook spécifique : intercepter dialog.showModal() / show() sur tous les
    // <dialog> de la page. Quand un drawer s'ouvre, on relance la sync.
    try {
      var origShowModal = HTMLDialogElement.prototype.showModal;
      var origShow      = HTMLDialogElement.prototype.show;
      HTMLDialogElement.prototype.showModal = function() {
        var r = origShowModal.apply(this, arguments);
        _tlScheduleSync();
        _tlFixAllLineItems();
        setTimeout(_tlSyncCartImages, 300);
        setTimeout(_tlFixAllLineItems, 50);
        setTimeout(_tlFixAllLineItems, 300);
        setTimeout(_tlSyncCartImages, 800);
        setTimeout(_tlFixAllLineItems, 800);
        return r;
      };
      HTMLDialogElement.prototype.show = function() {
        var r = origShow.apply(this, arguments);
        _tlScheduleSync();
        _tlFixAllLineItems();
        setTimeout(_tlSyncCartImages, 300);
        setTimeout(_tlFixAllLineItems, 50);
        setTimeout(_tlFixAllLineItems, 300);
        setTimeout(_tlSyncCartImages, 800);
        setTimeout(_tlFixAllLineItems, 800);
        return r;
      };
    } catch (e) { /* HTMLDialogElement non dispo (vieux navigateur) — ignoré */ }

    // Sync au focus de la fenêtre (cas : retour sur l'onglet après ajout)
    window.addEventListener('focus', _tlScheduleSync);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.TLModal = { open: openModal, close: closeModal, openProduct: openProduct };
})();
