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
  ';

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
  // Double approche :
  //   1. [data-variant-id] — attribut natif Shopify (Dawn, Debut, la plupart des thèmes)
  //   2. /cart.js + index — pour les thèmes table-based sans [data-variant-id] sur les lignes
  // MutationObserver pour couvrir les drawers lazy-loadés, timeout 5s.
  function _tlInjectCartImage(variantId, previewUrl) {
    if (!previewUrl || !variantId) return;
    var vid = String(variantId);

    // Approche 1 : sélecteur [data-variant-id] natif Shopify
    // Stratégie thème-agnostique : on REMPLACE seulement la source de l'image,
    // sans toucher aux attributs width/height/class ni au container. C'est le
    // thème qui contrôle la taille de la cellule — on laisse son CSS faire son
    // boulot. On ajoute juste un fond blanc opaque pour que les rendus PNG sur
    // fond transparent restent lisibles sur les drawers à fond sombre.
    //
    // max-width:100% / max-height:100% : protection universelle contre les
    // <img> sans contrainte CSS qui déborderaient du container quand on
    // remplace src par une image de grande dimension (rendu HD 2000x2000).
    function _injectByVariantId() {
      var nodes = document.querySelectorAll('[data-variant-id="' + vid + '"]');
      nodes.forEach(function(node) {
        if (node.dataset.tlImg) return;
        node.dataset.tlImg = '1';
        var img = node.querySelector('img');
        if (img) {
          img.src    = previewUrl;
          img.srcset = '';
          img.style.maxWidth     = '100%';
          img.style.maxHeight    = '100%';
          img.style.width        = '100%';
          img.style.height       = '100%';
          img.style.background   = '#ffffff';
          img.style.mixBlendMode = 'normal';
          img.style.objectFit    = 'contain';
        }
        _tlFixLineItemProps(node);
      });
    }

    // Approche 2 : /cart.js + correspondance par index (thèmes table-based)
    function _injectByCartIndex() {
      fetch('/cart.js')
        .then(function(r) { return r.json(); })
        .then(function(cart) {
          var items = cart.items || [];
          // Sélecteurs couvrant les drawers table-based courants
          var rows = Array.from(document.querySelectorAll(
            'cart-drawer tbody tr, ' +
            '.cart-drawer tbody tr, ' +
            '[id*="CartDrawer"] tbody tr, ' +
            '[id*="cart-drawer"] tbody tr, ' +
            '[id*="cart"] tbody tr'
          ));
          if (!rows.length) return;
          items.forEach(function(item, idx) {
            var url = (item.properties && item.properties['_preview_img']) || null;
            if (!url) return;
            var row = rows[idx];
            if (!row || row.dataset.tlImg) return;
            row.dataset.tlImg = '1';
            var img = row.querySelector('img');
            if (img) {
              img.src    = url;
              img.srcset = '';
              img.style.maxWidth     = '100%';
              img.style.maxHeight    = '100%';
              img.style.width        = '100%';
              img.style.height       = '100%';
              img.style.background   = '#ffffff';
              img.style.mixBlendMode = 'normal';
              img.style.objectFit    = 'contain';
            }
            _tlFixLineItemProps(row);
          });
        })
        .catch(function() {});
    }

    // Exécuter les deux approches immédiatement
    _injectByVariantId();
    _injectByCartIndex();

    // MutationObserver pour les drawers qui se chargent après (lazy render)
    var _observer = new MutationObserver(function() {
      _injectByVariantId();
      _injectByCartIndex();
    });
    _observer.observe(document.body, { childList: true, subtree: true });

    // Déconnecter après 5 secondes
    setTimeout(function() { _observer.disconnect(); }, 5000);
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

      // "Voir mon design" → lien cliquable propre
      if (key === 'Voir mon design') {
        var url = dd.textContent.trim();
        if (url.startsWith('http')) {
          dd.innerHTML = '<a href="' + url + '" target="_blank" rel="noopener" ' +
            'style="color:inherit;font-size:11px;text-decoration:underline;opacity:0.75">' +
            '👁\u00a0Voir le design</a>';
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.TLModal = { open: openModal, close: closeModal };
})();
