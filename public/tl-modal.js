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

  // ── Styles injectés ─────────────────────────────────────────────────────────
  // Le bloc CART_FIX_CSS résout le bug de chevauchement image/titre dans les
  // drawers panier des thèmes Shopify modernes (Studio, Sense, etc.) où une
  // <td> a un width inline (ex: width:140px) qui contredit le grid-template-
  // columns calculé par le thème. On neutralise les widths inline sur les
  // cellules de cart rows ; le grid CSS prend alors le relais et tout
  // s'aligne. Approche purement CSS = pas de timing JS à gérer.
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
    /*    thème la sous-dimensionne (signature : tr en grid avec image dedans)  */
    '.cart-items__table-row {',
    '  grid-template-columns: minmax(80px, max-content) minmax(0, 1fr) minmax(80px, auto) !important;',
    '}',
    /* 4. Notre overlay : pleine cellule, fond blanc opaque, contain ratio */
    '.tl-design-overlay {',
    '  position: absolute !important;',
    '  inset: 0 !important;',
    '  background: #ffffff !important;',
    '  z-index: 2 !important;',
    '  pointer-events: none !important;',
    '  overflow: hidden !important;',
    '  display: flex !important;',
    '  align-items: center !important;',
    '  justify-content: center !important;',
    '}',
    '.tl-design-overlay > img {',
    '  width: 100% !important;',
    '  height: 100% !important;',
    '  object-fit: contain !important;',
    '  display: block !important;',
    '  background: #ffffff !important;',
    '}',
  ].join('\n');

  var CSS = '\
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
    style.textContent = CSS;
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

    var overlay = document.createElement('div');
    overlay.className = 'tl-design-overlay';
    overlay.style.cssText =
      'position:absolute;' +
      'inset:0;' +
      'background:#ffffff;' +
      'z-index:2;' +
      'pointer-events:none;' +
      'overflow:hidden;' +
      'display:flex;' +
      'align-items:center;' +
      'justify-content:center;';

    var ovImg = document.createElement('img');
    ovImg.src = previewUrl;
    ovImg.alt = '';
    ovImg.loading = 'lazy';
    ovImg.style.cssText =
      'width:100%;' +
      'height:100%;' +
      'object-fit:contain;' +
      'display:block;' +
      'background:#ffffff;';
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
    _tlSyncTimeout = setTimeout(_tlSyncCartImages, 200);
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
      var key = dt.textContent.trim();
      var dd  = dt.nextElementSibling;
      if (!dd) return;

      // Masquer les propriétés internes (_prefixed)
      if (key.startsWith('_')) {
        dt.style.display = 'none';
        dd.style.display = 'none';
        return;
      }

      // "_voir_mon_design" → lien cliquable propre dans le drawer panier
      // (clé préfixée '_' = invisible nativement dans le checkout Shopify,
      //  tl-modal.js la rend visible ici sous forme de lien)
      if (key === '_voir_mon_design') {
        var url = dd.textContent.trim();
        dt.style.display = 'none'; // masquer la key technique
        if (url.startsWith('http')) {
          dd.innerHTML = '<a href="' + url + '" target="_blank" rel="noopener" ' +
            'style="color:inherit;font-size:11px;text-decoration:underline;opacity:0.75">' +
            '👁 Voir le design</a>';
        }
      }
    });

    // ─ Pattern 2 : balayage texte brut "_key: value" sur les éléments feuilles ─
    // Masque tout élément dont le texte commence par "_xxx:" ou "_xxx="
    // (signe d'une property interne non traitée par le pattern <dl>).
    var leafEls = container.querySelectorAll('li, p, span, div, td');
    leafEls.forEach(function(el) {
      if (el.dataset.tlFixed2) return;
      if (el.children.length > 2) return;
      var t = (el.textContent || '').trim();
      if (!t) return;
      if (/^_[a-z_]+\s*[:=]/i.test(t)) {
        el.dataset.tlFixed2 = '1';
        el.style.display = 'none';
      }
    });
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
                setTimeout(function() { _tlInjectCartImage(_vid, _previewUrl); }, 400);
              }

              // 4. Nettoyer les propriétés _ sur les items après re-render
              setTimeout(function() {
                var cartItems = document.querySelectorAll(
                  '#cart-drawer .cart-item, .cart-drawer__content .cart-item, ' +
                  '[id*="CartDrawer"] .cart-item, .cart-items .cart-item, ' +
                  '.cart-drawer [class*="cart-item"]'
                );
                cartItems.forEach(function(item) { _tlFixLineItemProps(item); });
              }, 800);
            })
            .catch(function() { window.location.href = '/cart'; });

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

  // ── Init ────────────────────────────────────────────────────────────────────
  function init() {
    injectDOM();
    listenMessages();
    interceptLinks();
    _tlInitCartSync();
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
    // Premier sync au load
    _tlSyncCartImages();

    // Évènements émis par les thèmes Shopify modernes
    ['cart:update', 'cart:refresh', 'theme:cart:update', 'cart-drawer:open']
      .forEach(function(ev) {
        document.addEventListener(ev, _tlScheduleSync);
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
        setTimeout(_tlSyncCartImages, 300);
        setTimeout(_tlSyncCartImages, 800);
        return r;
      };
      HTMLDialogElement.prototype.show = function() {
        var r = origShow.apply(this, arguments);
        _tlScheduleSync();
        setTimeout(_tlSyncCartImages, 300);
        setTimeout(_tlSyncCartImages, 800);
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

  window.TLModal = { open: openModal, close: closeModal };
})();
