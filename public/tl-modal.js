/**
 * tl-modal.js — TextileLab Studio : ouverture de l'éditeur en modal plein écran
 *
 * À inclure dans le thème Shopify (layout/theme.liquid ou via snippet).
 * Intercepts les liens "Personnalisé" (href contenant /textilelab-studio.html
 * ou data-tl-editor="true") et ouvre l'éditeur dans un overlay plein écran.
 *
 * Communication iframe ↔ parent via postMessage :
 *   - { type: 'tl-add-to-cart', cartUrl }  → redirige vers le panier Shopify
 *   - { type: 'tl-close-modal' }           → ferme le modal
 */

(function () {
  'use strict';

  // ── Styles injectés ─────────────────────────────────────────────────────────
  const CSS = `
    #tl-modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: #0a0a0c;
    }
    #tl-modal-overlay.tl-open {
      display: block;
    }
    #tl-modal-iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
    }
    #tl-modal-close {
      position: fixed;
      top: 12px;
      right: 14px;
      z-index: 2147483647;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      color: #fff;
      border-radius: 50%;
      width: 36px;
      height: 36px;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(8px);
      transition: background 0.15s;
    }
    #tl-modal-close:hover {
      background: rgba(255,255,255,0.2);
    }
    #tl-modal-overlay.tl-open + #tl-modal-close,
    #tl-modal-close.tl-visible {
      display: flex;
    }
  `;

  // ── Injection des éléments DOM ──────────────────────────────────────────────
  function injectDOM() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'tl-modal-overlay';

    const iframe = document.createElement('iframe');
    iframe.id = 'tl-modal-iframe';
    iframe.setAttribute('allow', 'clipboard-write');
    iframe.setAttribute('allowfullscreen', '');
    overlay.appendChild(iframe);

    const closeBtn = document.createElement('button');
    closeBtn.id = 'tl-modal-close';
    closeBtn.setAttribute('aria-label', 'Fermer l\'éditeur');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', closeModal);

    document.body.appendChild(overlay);
    document.body.appendChild(closeBtn);
  }

  // ── Ouverture du modal ──────────────────────────────────────────────────────
  function openModal(editorUrl) {
    const overlay = document.getElementById('tl-modal-overlay');
    const iframe  = document.getElementById('tl-modal-iframe');
    const closeBtn = document.getElementById('tl-modal-close');

    if (!overlay || !iframe) return;

    // Empêcher le scroll de la page en arrière-plan
    document.body.style.overflow = 'hidden';

    iframe.src = editorUrl;
    overlay.classList.add('tl-open');
    if (closeBtn) closeBtn.classList.add('tl-visible');
  }

  // ── Fermeture du modal ──────────────────────────────────────────────────────
  function closeModal() {
    const overlay  = document.getElementById('tl-modal-overlay');
    const iframe   = document.getElementById('tl-modal-iframe');
    const closeBtn = document.getElementById('tl-modal-close');

    if (!overlay) return;

    overlay.classList.remove('tl-open');
    if (closeBtn) closeBtn.classList.remove('tl-visible');

    // Vider l'iframe pour libérer les ressources
    setTimeout(() => {
      if (iframe) iframe.src = 'about:blank';
      document.body.style.overflow = '';
    }, 200);
  }

  // ── Ouverture du drawer panier natif du thème ──────────────────────────────
  function _tlOpenCartDrawer() {
    // Rafraîchir le compteur panier (universel)
    document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
    // Dawn / OS 2.0 (thème le plus répandu)
    document.documentElement.dispatchEvent(new CustomEvent('cart:open', { bubbles: true }));

    // Fallback : clic sur l'icône panier (couvre la plupart des thèmes custom)
    var _selectors = [
      '#cart-icon-bubble',
      '[data-cart-toggle]',
      '[data-drawer-toggle="cart-drawer"]',
      '[data-cart-drawer-trigger]',
      '.cart-count-bubble',
      '.header__icon--cart',
      'a[href="/cart"]',
    ];
    for (var i = 0; i < _selectors.length; i++) {
      var el = document.querySelector(_selectors[i]);
      if (el) {
        (function(btn) { setTimeout(function() { btn.click(); }, 150); })(el);
        break;
      }
    }
  }

  // ── Injection visuelle dans le drawer après ajout au panier ───────────────
  // Remplace les URLs brutes des propriétés line-item par des éléments visuels.
  // Fonctionne avec n'importe quel thème Shopify, sans modification liquid.
  function _tlInjectCartImages() {
    var _attempts = 0;

    function _tryInject() {
      _attempts++;
      var injected = false;

      // Sélecteurs couvrant Dawn, Debut et la plupart des thèmes OS 2.0
      var propValues = document.querySelectorAll(
        '#cart-drawer dd, .cart-drawer__content dd, [id*="CartDrawer"] dd, ' +
        '.drawer__inner dd, .cart-item__details dd, [class*="cart"] dl dd'
      );

      propValues.forEach(function(dd) {
        var text    = (dd.textContent || '').trim();
        var prevDt  = dd.previousElementSibling;
        var propKey = prevDt ? prevDt.textContent.trim() : '';

        // ── _preview_img → remplacer l'URL par une vraie miniature ──
        if (propKey === '_preview_img' && text.startsWith('http')) {
          var dl = dd.closest('dl');
          if (dl && !dl.dataset.tlImg) {
            dl.dataset.tlImg = '1';
            // Cacher la ligne brute de la propriété
            if (prevDt) prevDt.style.display = 'none';
            dd.style.display = 'none';
            // Injecter la miniature juste avant la liste de propriétés
            var wrap = document.createElement('div');
            wrap.style.cssText = 'width:64px;height:64px;border-radius:6px;overflow:hidden;margin:4px 0 6px;flex-shrink:0;border:1px solid rgba(0,0,0,0.1)';
            var img = document.createElement('img');
            img.src = text;
            img.alt = 'Aperçu design';
            img.style.cssText = 'width:100%;height:100%;object-fit:cover';
            img.onerror = function() { wrap.style.display = 'none'; };
            wrap.appendChild(img);
            dl.parentNode.insertBefore(wrap, dl);
            injected = true;
          }
        }

        // ── Voir mon design → lien cliquable propre ──
        if (propKey === 'Voir mon design' && text.startsWith('http') && !dd.dataset.tlLink) {
          dd.dataset.tlLink = '1';
          dd.innerHTML = '<a href="' + text + '" target="_blank" rel="noopener" ' +
            'style="color:inherit;font-size:11px;text-decoration:underline;opacity:0.7">👁 Voir le design</a>';
          injected = true;
        }
      });

      // Réessayer jusqu'à 5 fois si le drawer n'est pas encore rendu
      if (!injected && _attempts < 5) {
        setTimeout(_tryInject, 600);
      }
    }

    setTimeout(_tryInject, 500);
  }

  // ── Écoute des messages de l'iframe ────────────────────────────────────────
  function listenMessages() {
    window.addEventListener('message', function (e) {
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
            // ── AJAX Shopify Cart API → reste sur la page, ouvre le drawer ──
            fetch('/cart/add.json', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body:    JSON.stringify({ items: [{ id: parseInt(_vid, 10), quantity: _qty, properties: _props }] }),
            })
            .then(function(r) { return r.json(); })
            .then(function() {
              _tlOpenCartDrawer();
              _tlInjectCartImages();
            })
            .catch(function() { window.location.href = '/cart'; });
          } else if (e.data.cartUrl) {
            // Rétrocompat
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
  // Détecte :
  //  1. data-tl-editor="true"  (recommandé — à ajouter dans le thème)
  //  2. href contenant "textilelab-studio.html"
  //  3. href contenant "/apps/textilelab"
  function interceptLinks() {
    document.addEventListener('click', function (e) {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href') || '';
      const isTLEditor =
        link.dataset.tlEditor === 'true' ||
        href.includes('textilelab-studio.html') ||
        href.includes('/apps/textilelab');

      if (!isTLEditor) return;

      e.preventDefault();
      e.stopPropagation();

      // Construire l'URL complète si relative
      let editorUrl = href;
      if (!href.startsWith('http') && !href.startsWith('//')) {
        editorUrl = new URL(href, window.location.origin).href;
      }

      openModal(editorUrl);
    }, true); // capture phase pour devancer d'autres handlers
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

  // Exposition publique pour usage avancé
  window.TLModal = { open: openModal, close: closeModal };
})();
