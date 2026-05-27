/**
 * tl-modal.js — TextileLab Studio : ouverture de l'éditeur en modal plein écran
 *
 * À inclure dans le thème Shopify via l'App Embed Block (tl-embed.liquid).
 * Intercepte les liens "Personnalisé" et ouvre l'éditeur dans un overlay plein écran.
 *
 * Communication iframe ↔ parent via postMessage :
 *   - { type: 'tl-add-to-cart', variantId, quantity, properties, previewUrl } → AJAX cart + drawer
 *   - { type: 'tl-close-modal' }                                               → ferme le modal
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

  // NOTE : ne pas nommer cette variable "CSS" — cela écraserait window.CSS
  // (l'API globale) dans le scope de l'IIFE et ferait planter CSS.escape().
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
  ' + CART_FIX_CSS;

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
    document.body.style.overflow = 'hidden';
    iframe.src = editorUrl;
    overlay.classList.add('tl-open');
  }

  // ── Fermeture du modal ──────────────────────────────────────────────────────
  function closeModal() {
    var overlay = document.getElementById('tl-modal-overlay');
    var iframe  = document.getElementById('tl-modal-iframe');
    if (!overlay) return;
    overlay.classList.remove('tl-open');
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

        // Map: key → { url } (item.key = "<variantId>:<hash>")
        var byKey = {};
        items.forEach(function(item) {
          var url = (item.properties && item.properties['_preview_img']) || null;
          if (url) byKey[item.key] = { url: url };
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

  // ── Nettoyage des propriétés line item dans le drawer ─────────────────────
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
          dd.innerHTML = '<a href="' + url + '" target="_blank" rel="noopener" ' +
            'style="display:inline-flex;align-items:center;gap:6px;' +
            'padding:6px 12px;margin-top:4px;border-radius:8px;' +
            'background:#F59E0B;color:#0a0a0c !important;' +
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
      // "Voir mon design: https://..." rendu en texte brut → bouton orange
      var m = t.match(/^Voir mon design\s*[:=]\s*(https?:\/\/\S+)\s*$/i);
      if (m) {
        el.dataset.tlFixed2 = '1';
        el.innerHTML = '<a href="' + m[1] + '" target="_blank" rel="noopener" ' +
          'style="display:inline-flex;align-items:center;gap:6px;' +
          'padding:6px 12px;margin-top:4px;border-radius:8px;' +
          'background:#F59E0B;color:#0a0a0c !important;' +
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
            fetch('/cart/add.json', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({
                items: [{ id: parseInt(_vid, 10), quantity: _qty, properties: _props }],
              }),
            })
            .then(function(r) { return r.json(); })
            .then(function() {
              // Fermer le modal APRÈS succès
              closeModal();

              // 1. Déclencher cart:update
              document.dispatchEvent(new CustomEvent('cart:update', {
                bubbles: true,
                detail: { source: 'tl-modal', data: { sections: {} } }
              }));

              // 2. Ouvrir le drawer via l'API du composant
              var drawerEl = document.querySelector('cart-drawer-component');
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
            })
            .catch(function() {
              document.body.classList.remove('tl-cart-loading');
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

  // ── Interception des liens "Personnalisé" ───────────────────────────────────
  function interceptLinks() {
    document.addEventListener('click', function(e) {
      var link = e.target.closest('a');
      if (!link) return;
      var href = link.getAttribute('href') || '';
      var isTLEditor =
        link.dataset.tlEditor === 'true' ||
        href.includes('textilelab-studio.html') ||
        href.includes('/apps/textilelab');
      if (!isTLEditor) return;
      e.preventDefault();
      e.stopPropagation();
      var editorUrl = href;
      if (!href.startsWith('http') && !href.startsWith('//')) {
        editorUrl = new URL(href, window.location.origin).href;
      }
      openModal(editorUrl);
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

  function buildStudioUrl(idOrHandle) {
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
    return TSL_BACKEND_ORIGIN + '/textilelab-studio.html?' + params.toString();
  }

  function interceptTslButtons() {
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-tsl-open]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();

      var customUrl = btn.dataset.tslUrl;
      var url = customUrl ? customUrl : buildStudioUrl(btn.getAttribute('data-tsl-open'));
      openModal(url);
    }, true);
  }

  // Helper exposé pour usage JS direct : TLModal.openProduct('123' | 'handle')
  function openProduct(idOrHandle) {
    openModal(buildStudioUrl(idOrHandle));
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
          if (!bg || bg === 'transparent') return;
          _TL_CART_BG = bg;
          _tlApplyBgToExistingOverlays();
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

  // ── Init ────────────────────────────────────────────────────────────────────
  function init() {
    injectDOM();
    listenMessages();
    interceptLinks();
    interceptTslButtons();
    _tlInitCartSync();
    _tlLoadStyleSettings();
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
