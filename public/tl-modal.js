/**
 * tl-modal.js — TextileLab Studio : ouverture de l'éditeur en modal plein écran
 *
 * À inclure dans le thème Shopify (layout/theme.liquid ou via snippet).
 * Intercepte les liens "Personnalisé" et ouvre l'éditeur dans un overlay plein écran.
 *
 * Communication iframe ↔ parent via postMessage :
 *   - { type: 'tl-add-to-cart', variantId, quantity, properties } → AJAX cart + drawer
 *   - { type: 'tl-close-modal' }                                  → ferme le modal
 */

(function () {
  'use strict';

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
  // Appelée avec data.sections retourné par /cart/add.json?sections=...
  function _tlUpdateCartSections(sections) {
    if (!sections) return;
    var parser = new DOMParser();
    Object.keys(sections).forEach(function(sectionId) {
      var doc    = parser.parseFromString(sections[sectionId], 'text/html');
      var newEl  = doc.getElementById(sectionId);
      var existEl = document.getElementById(sectionId);
      if (newEl && existEl) {
        existEl.innerHTML = newEl.innerHTML;
      }
    });
  }

  // ── Mise à jour manuelle du compteur panier (fallback) ─────────────────────
  function _tlRefreshCartCount() {
    fetch('/cart.js')
      .then(function(r) { return r.json(); })
      .then(function(cart) {
        var count = cart.item_count || 0;
        // Sélecteurs communs pour le compteur panier
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
    // Dawn / Shopify OS 2.0
    document.documentElement.dispatchEvent(new CustomEvent('cart:open', { bubbles: true }));
    document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));

    // Fallback universel : clic sur l'icône panier
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

  // ── Remplacement de l'image produit par l'aperçu design ────────────────────
  // previewUrl = URL directe du PNG de prévisualisation (Railway CDN ou Shopify)
  function _tlInjectCartImages(previewUrl) {
    var _attempts = 0;

    function _try() {
      _attempts++;
      var cartItems = document.querySelectorAll(
        '#cart-drawer .cart-item, .cart-drawer__content .cart-item, ' +
        '[id*="CartDrawer"] .cart-item, .cart-items .cart-item, ' +
        '.cart-drawer [class*="cart-item"]'
      );

      // Cibler le dernier item ajouté (le plus récent)
      var lastItem = cartItems.length > 0 ? cartItems[cartItems.length - 1] : null;

      if (lastItem && !lastItem.dataset.tlImg) {
        lastItem.dataset.tlImg = '1';

        // Fix layout drawer — texte à droite de la vignette
        lastItem.style.display    = 'flex';
        lastItem.style.alignItems = 'flex-start';
        lastItem.style.gap        = '1rem';

        // Remplacer l'image produit par défaut par l'aperçu du design
        if (previewUrl) {
          var img = lastItem.querySelector('img.cart-item__image, img[loading="lazy"], img');
          if (img) {
            img.src            = previewUrl;
            img.srcset         = '';
            img.style.objectFit = 'cover';
            // Fond transparent sur la vignette
            img.style.background    = 'transparent';
            img.style.mixBlendMode  = 'multiply';
            if (img.parentElement) img.parentElement.style.background = 'transparent';
            // Bloc texte à droite de l'image
            var imgContainer = img.closest('.cart-item__image-container');
            if (imgContainer && imgContainer.nextElementSibling) {
              imgContainer.nextElementSibling.style.flex = '1';
            }
          }
        }

        // Transformer les propriétés brutes en éléments lisibles
        _tlFixLineItemProps(lastItem);

      } else if (!lastItem && _attempts < 5) {
        setTimeout(_try, 600);
      }

      // Passer aussi sur tous les items existants (cas page rafraîchie)
      cartItems.forEach(function(item) { _tlFixLineItemProps(item); });
    }

    setTimeout(_try, 450);
  }

  // ── Nettoyage des propriétés line item dans le drawer ─────────────────────
  function _tlFixLineItemProps(container) {
    if (!container) return;
    var dts = container.querySelectorAll('dl dt, dl dt');
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
          closeModal();
          var _vid   = e.data.variantId;
          var _props = e.data.properties;
          var _qty   = e.data.quantity || 1;

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
              // 1. Déclencher cart:update — component-cart-items.js va re-fetcher les sections automatiquement
              document.dispatchEvent(new CustomEvent('cart:update', {
                bubbles: true,
                detail: { source: 'tl-modal', data: { sections: {} } }
              }));

              // 2. Ouvrir le drawer directement via l'API du composant
              var drawerEl = document.querySelector('cart-drawer-component');
              if (drawerEl) {
                if (typeof drawerEl.open === 'function') { drawerEl.open(); }
                else if (typeof drawerEl.showDialog === 'function') { drawerEl.showDialog(); }
              }

              // 3. Nettoyer les propriétés _ sur les items après re-render
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
            // Rétrocompat : ancienne version avec cartUrl
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
