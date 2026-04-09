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

  // ── Écoute des messages de l'iframe ────────────────────────────────────────
  function listenMessages() {
    window.addEventListener('message', function (e) {
      if (!e.data || typeof e.data !== 'object') return;

      switch (e.data.type) {
        case 'tl-close-modal':
          closeModal();
          break;

        case 'tl-add-to-cart':
          if (e.data.cartUrl) {
            closeModal();
            // Petit délai pour laisser le modal se fermer visuellement
            setTimeout(() => {
              window.location.href = e.data.cartUrl;
            }, 250);
          }
          break;

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
