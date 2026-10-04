/**
 * tl-designs.js — Sélecteur de designs sur la fiche produit.
 * ═══════════════════════════════════════════════════════════════════════════
 * « Choisissez un design » : le client parcourt la bibliothèque WinShirt
 * directement sur la fiche produit, sans qu'aucune déclinaison Shopify n'ait
 * été créée. C'est ce qui permet 50 produits × 200 visuels sans 10 000
 * variantes.
 *
 * Le serveur a déjà fait le tri (routes/product-designs.js) : il ne renvoie
 * que les visuels en vente, non exclus de ce support, et dont la résolution
 * et les proportions conviennent à sa zone d'impression. Ce script ne décide
 * de rien, il affiche.
 *
 * Posé par le block de thème « Sélecteur de design », qui écrit simplement :
 *   <div data-tsl-designs="{{ product.id }}"></div>
 *
 * Contraintes :
 *  • style ES5, comme tl-modal.js — ce script tourne sur des thèmes variés ;
 *  • aucune dépendance, aucun framework ;
 *  • si le serveur ne répond pas ou qu'aucun design ne convient, le bloc
 *    disparaît complètement. Une section vide intitulée « Choisissez un
 *    design » est pire que pas de section du tout.
 */
(function () {
  'use strict';
  if (window.__TSL_DESIGNS_LOADED) return;
  window.__TSL_DESIGNS_LOADED = true;

  // Même littéral que dans tl-modal.js : l'App Proxy le remplace par l'origin
  // du backend réellement installé sur la boutique (cf. routes/app-proxy.js).
  var BACKEND = 'https://textile-studio-production.up.railway.app';

  var PARAM = 'design';      // ?design=<slug> dans l'URL de la fiche produit
  var etat  = {};            // slug sélectionné, par conteneur

  // ── Styles ────────────────────────────────────────────────────────────────
  // Volontairement sobres et peu nombreux : le bloc doit se fondre dans
  // n'importe quel thème. On hérite de la police, on ne force ni fond ni
  // couleur de texte, et toutes les classes sont préfixées.
  var CSS = ''
    // Le conteneur ne doit jamais imposer sa largeur au thème : `min-width:0`
    // le rend compressible dans une colonne flex ou grid.
    + '.tsld{margin:18px 0;min-width:0;max-width:100%}'
    + '.tsld-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px}'
    + '.tsld-title{font-weight:600;font-size:1rem;margin:0}'
    + '.tsld-count{font-size:.8rem;opacity:.6}'
    + '.tsld-cats{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:10px;scrollbar-width:thin;'
    +   'width:0;min-width:100%}'
    + '.tsld-cat{flex:0 0 auto;border:1px solid currentColor;border-radius:999px;padding:5px 12px;font-size:.8rem;'
    +   'background:transparent;color:inherit;opacity:.55;cursor:pointer;white-space:nowrap;line-height:1.2}'
    + '.tsld-cat[aria-pressed="true"]{opacity:1;font-weight:600}'
    + '.tsld-search{width:100%;box-sizing:border-box;padding:9px 12px;margin-bottom:10px;font:inherit;font-size:.9rem;'
    +   'border:1px solid currentColor;border-radius:8px;background:transparent;color:inherit;opacity:.75}'
    // `width:0; min-width:100%` — la clé du défilement horizontal.
    //
    // Un défileur en grid-auto-flow:column a une largeur intrinsèque égale à
    // la somme de ses colonnes : 17 vignettes ≈ 2 000 px. Posé dans la colonne
    // d'infos d'un thème dimensionnée par son contenu, il l'élargit d'autant
    // et fait exploser toute la mise en page — colonne image écrasée, page qui
    // déborde horizontalement.
    //
    // `width:0` annule cette contribution au calcul de largeur du parent ;
    // `min-width:100%` rétablit ensuite la largeur réelle, une fois le parent
    // dimensionné sans nous. Le défilement interne est intact.
    + '.tsld-grid{display:grid;grid-auto-flow:column;grid-auto-columns:116px;grid-template-rows:auto;gap:10px;'
    +   'overflow-x:auto;padding-bottom:8px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;'
    +   'width:0;min-width:100%}'
    + '.tsld-grid.tsld-wrap{grid-auto-flow:row;grid-template-columns:repeat(auto-fill,minmax(116px,1fr));'
    +   'overflow-x:visible;width:auto;min-width:0}'
    + '.tsld-item{scroll-snap-align:start;border:2px solid transparent;border-radius:10px;padding:4px;cursor:pointer;'
    +   'background:transparent;font:inherit;color:inherit;text-align:center;display:block;width:100%}'
    + '.tsld-item:hover{border-color:currentColor}'
    + '.tsld-item[aria-pressed="true"]{border-color:currentColor;box-shadow:0 0 0 1px currentColor inset}'
    + '.tsld-thumb{width:100%;aspect-ratio:1;object-fit:contain;display:block;border-radius:6px;background:rgba(127,127,127,.08)}'
    + '.tsld-name{font-size:.72rem;line-height:1.3;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}'
    + '.tsld-empty{font-size:.85rem;opacity:.6;padding:10px 0}'
    + '.tsld-cart{display:none;margin-top:12px}'
    + '.tsld-cart.tsld-show{display:block}'
    + '.tsld-cart-btn{width:100%;box-sizing:border-box;padding:12px 16px;font:inherit;font-size:.95rem;'
    +   'font-weight:600;border:1px solid currentColor;border-radius:8px;background:transparent;color:inherit;'
    +   'cursor:pointer;opacity:.9}'
    + '.tsld-cart-btn:hover{opacity:1}'
    + '.tsld-cart-btn:disabled{opacity:.5;cursor:default}'
    + '@media (max-width:600px){.tsld-grid{grid-auto-columns:96px}}';

  function injecterStyles() {
    if (document.getElementById('tsld-css')) return;
    var s = document.createElement('style');
    s.id = 'tsld-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function boutique() {
    return (window.Shopify && window.Shopify.shop) || window._TL_SHOP || window.location.hostname;
  }

  /** Les visuels viennent du backend ; leurs URL locales sont relatives à lui. */
  function absolu(u) {
    if (!u) return '';
    return /^https?:\/\//i.test(u) ? u : BACKEND + u;
  }

  // ── Sélection ─────────────────────────────────────────────────────────────

  /**
   * Mémorise le design choisi et le propage.
   *
   * Trois effets, volontairement séparés :
   *  1. l'URL porte ?design=<slug> — le lien devient partageable, et rouvrir
   *     la page restitue le choix. Le canonical du thème reste la fiche nue :
   *     ce paramètre sert au partage, pas au référencement ;
   *  2. les boutons « Personnaliser » reçoivent data-tsl-visual, que
   *     tl-modal.js transmet au studio ;
   *  3. un évènement `tsl:design` est émis, pour que le thème ou l'aperçu
   *     dynamique puissent réagir sans que ce script les connaisse.
   */
  function choisir(conteneur, design) {
    etat[conteneur.__tsldId] = design ? design.slug : null;

    var boutons = conteneur.querySelectorAll('.tsld-item');
    for (var i = 0; i < boutons.length; i++) {
      boutons[i].setAttribute('aria-pressed', design && boutons[i].dataset.slug === design.slug ? 'true' : 'false');
    }

    try {
      var u = new URL(window.location.href);
      if (design) u.searchParams.set(PARAM, design.slug);
      else        u.searchParams.delete(PARAM);
      window.history.replaceState(null, '', u.toString());
    } catch (e) { /* navigateur capricieux : le reste fonctionne quand même */ }

    var ctas = document.querySelectorAll('[data-tsl-open]');
    for (var j = 0; j < ctas.length; j++) {
      if (design) ctas[j].setAttribute('data-tsl-visual', design.slug);
      else        ctas[j].removeAttribute('data-tsl-visual');
    }

    appliquerSurLaPhoto(conteneur, design);

    var barrePanier = conteneur.querySelector('.tsld-cart');
    if (barrePanier) barrePanier.classList.toggle('tsld-show', !!design);

    try {
      document.dispatchEvent(new CustomEvent('tsl:design', {
        detail: { design: design, productId: conteneur.__tsldProduct },
      }));
    } catch (e) { /* CustomEvent indisponible : non bloquant */ }
  }

  // ── Ajout direct au panier, sans studio ──────────────────────────────────
  //
  // Lot E : le client choisit un visuel et l'ajoute tel quel, à la taille/
  // format déjà réglés sur le produit (pas de studio, pas de canvas à ouvrir).
  // Le fichier d'impression, lui, est généré côté serveur à la commande
  // confirmée (routes/shopify.js, webhook orders/paid) — décision prise avec
  // Alan le 2026-10-03.
  //
  // On ne réimplémente pas l'ajout panier ici : on réutilise le canal
  // postMessage que tl-modal.js écoute déjà pour le studio (ouverture du
  // tiroir, nouvelles tentatives si Shopify répond 422, injection de l'image
  // dans le panier via la propriété _preview_img — déjà générique, déjà
  // théma-agnostique). tl-designs.js et tl-modal.js tournent dans la même
  // page (pas une iframe), donc ce postMessage reste local à l'onglet.
  function _tsldVariantId() {
    var input = document.querySelector('form[action*="/cart/add"] input[name="id"]')
      || document.querySelector('product-form input[name="id"]')
      || document.querySelector('input[name="id"][value]');
    var value = input && input.value ? String(input.value).trim() : '';
    return /^\d+$/.test(value) ? value : '';
  }

  function ajouterAuPanier(design, bouton) {
    var variantId = _tsldVariantId();
    if (!variantId) {
      alert('Choisissez d’abord une taille avant d’ajouter au panier.');
      return;
    }
    var previewUrl = absolu(design.thumb);
    var props = {
      'Visuel':       design.nom,
      '_library_id':  String(design.id),
      '_preview_img': previewUrl,
    };

    bouton.disabled = true;
    var texteOrigine = bouton.textContent;
    bouton.textContent = 'Ajout…';
    var fini = function () {
      bouton.disabled = false;
      bouton.textContent = texteOrigine;
    };
    document.addEventListener('cart:update', fini, { once: true });
    setTimeout(fini, 3500); // filet de sécurité si l'évènement de succès n'arrive pas

    window.postMessage({
      type: 'tl-add-to-cart',
      variantId: variantId,
      quantity: 1,
      properties: props,
      previewUrl: previewUrl,
    }, window.location.origin);
  }

  // ── Le design sur la photo du produit ─────────────────────────────────────
  //
  // C'est la cible : pas une image de plus à côté de la grille, mais LA photo
  // du produit qui porte le design. Le serveur compose, ici on ne fait que
  // remplacer la source de l'image principale.
  //
  // Trouver « l'image principale » sans rien savoir du thème : c'est la plus
  // grande image affichée de la page, hors notre propre grille. Sur une fiche
  // produit, c'est toujours le visuel du produit — aucun autre élément n'en
  // approche la surface.
  function imagePrincipale() {
    var imgs = document.querySelectorAll('img');
    var meilleure = null, aireMax = 0;
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      if (im.closest('.tsld')) continue;                 // nos vignettes
      var r = im.getBoundingClientRect();
      var aire = r.width * r.height;
      if (aire < 40000) continue;                        // moins de 200×200 : pas le visuel produit
      if (aire > aireMax) { aireMax = aire; meilleure = im; }
    }
    return meilleure;
  }

  function urlApercu(conteneur, design, source) {
    return BACKEND + '/api/products/' + conteneur.__tsldProduct + '/preview'
         + '?design=' + encodeURIComponent(design.slug)
         + '&shop=' + encodeURIComponent(boutique())
         + (source ? '&media=' + encodeURIComponent(source) : '');
  }

  /**
   * Remplace la source de l'image principale par le rendu, ou la restaure.
   *
   * `srcset` doit être vidé : laissé en place, le navigateur y repioche une
   * variante de l'image d'origine et notre remplacement n'a aucun effet
   * visible — panne classique et déroutante.
   *
   * Si le rendu échoue (produit non calibré, serveur indisponible), la photo
   * d'origine reste : la fiche n'est jamais cassée par cette fonctionnalité.
   */
  function appliquerSurLaPhoto(conteneur, design) {
    if (conteneur.getAttribute('data-tsl-apply-image') === '0') return;
    var img = imagePrincipale();
    if (!img) return;

    if (!img.__tsldOrigine) {
      img.__tsldOrigine = { src: img.getAttribute('src'), srcset: img.getAttribute('srcset') };
    }
    var origine = img.__tsldOrigine;

    if (!design) {
      img.__tsldRendu = null;
      if (origine.src) img.setAttribute('src', origine.src);
      if (origine.srcset) img.setAttribute('srcset', origine.srcset);
      return;
    }

    // La source demandée au serveur est la photo actuellement affichée : c'est
    // ainsi que les coloris fonctionnent. Le client clique « terracotta », le
    // thème change la photo, et le design se recompose sur celle-là.
    var url = urlApercu(conteneur, design, origine.src || '');
    var sonde = new Image();
    sonde.onload = function () {
      img.__tsldRendu = url;
      img.removeAttribute('srcset');
      img.setAttribute('src', url);
      surveillerPhoto(conteneur, img);
    };
    sonde.onerror = function () { /* pas de rendu : la photo d'origine reste */ };
    sonde.src = url;
  }

  /**
   * Les thèmes reconstruisent leur galerie à chaque changement de variante ou
   * de vignette, ce qui efface notre remplacement. On le repose, et on en
   * profite pour recomposer sur la NOUVELLE photo — c'est exactement ce qu'il
   * faut quand le client change de couleur.
   */
  function surveillerPhoto(conteneur, img) {
    if (img.__tsldObs) return;
    img.__tsldObs = new MutationObserver(function () {
      var actuel = img.getAttribute('src');
      if (!img.__tsldRendu || actuel === img.__tsldRendu) return;
      // Le thème a repris la main : nouvelle photo d'origine, nouveau rendu.
      img.__tsldOrigine = { src: actuel, srcset: img.getAttribute('srcset') };
      var slug = etat[conteneur.__tsldId];
      var design = null;
      for (var i = 0; i < (conteneur.__tsldTous || []).length; i++) {
        if (conteneur.__tsldTous[i].slug === slug) design = conteneur.__tsldTous[i];
      }
      if (design) appliquerSurLaPhoto(conteneur, design);
    });
    img.__tsldObs.observe(img, { attributes: true, attributeFilter: ['src'] });
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────

  function rendreGrille(conteneur, designs) {
    var grille = conteneur.querySelector('.tsld-grid');
    if (!designs.length) {
      grille.innerHTML = '<div class="tsld-empty">Aucun design ne correspond.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < designs.length; i++) {
      var d = designs[i];
      html += '<button type="button" class="tsld-item" data-slug="' + esc(d.slug) + '" aria-pressed="false" title="' + esc(d.nom) + '">'
            +   '<img class="tsld-thumb" src="' + esc(absolu(d.thumb)) + '" alt="' + esc(d.nom) + '" loading="lazy">'
            +   '<span class="tsld-name">' + esc(d.nom) + '</span>'
            + '</button>';
    }
    grille.innerHTML = html;
    var choisi = etat[conteneur.__tsldId];
    if (choisi) {
      var actif = grille.querySelector('.tsld-item[data-slug="' + choisi.replace(/"/g, '') + '"]');
      if (actif) actif.setAttribute('aria-pressed', 'true');
    }
  }

  function filtrer(conteneur) {
    var tous = conteneur.__tsldTous;
    var cat  = conteneur.__tsldCat;
    var q    = (conteneur.__tsldQuery || '').toLowerCase();
    var out  = [];
    for (var i = 0; i < tous.length; i++) {
      var d = tous[i];
      if (cat && d.categorie !== cat) continue;
      if (q) {
        var foin = (d.nom + ' ' + d.categorie + ' ' + (d.tags || []).join(' ')).toLowerCase();
        if (foin.indexOf(q) === -1) continue;
      }
      out.push(d);
    }
    rendreGrille(conteneur, out);
    var compteur = conteneur.querySelector('.tsld-count');
    if (compteur) compteur.textContent = out.length + (out.length > 1 ? ' designs' : ' design');
  }

  function construire(conteneur, data) {
    var titre      = conteneur.getAttribute('data-tsl-title') || 'Choisissez un design';
    var avecCats   = conteneur.getAttribute('data-tsl-categories') !== '0';
    var avecSearch = conteneur.getAttribute('data-tsl-search') !== '0';
    var enGrille   = conteneur.getAttribute('data-tsl-layout') === 'grid';

    var html = '<div class="tsld-head"><p class="tsld-title">' + esc(titre) + '</p><span class="tsld-count"></span></div>';
    if (avecCats && data.categories.length > 1) {
      html += '<div class="tsld-cats"><button type="button" class="tsld-cat" data-cat="" aria-pressed="true">Tous</button>';
      for (var i = 0; i < data.categories.length; i++) {
        html += '<button type="button" class="tsld-cat" data-cat="' + esc(data.categories[i]) + '" aria-pressed="false">'
              + esc(data.categories[i]) + '</button>';
      }
      html += '</div>';
    }
    if (avecSearch && data.designs.length > 8) {
      html += '<input type="search" class="tsld-search" placeholder="Rechercher un design…" aria-label="Rechercher un design">';
    }
    html += '<div class="tsld-grid' + (enGrille ? ' tsld-wrap' : '') + '"></div>';
    html += '<div class="tsld-cart"><button type="button" class="tsld-cart-btn">Ajouter au panier</button></div>';
    conteneur.innerHTML = html;
    conteneur.classList.add('tsld');

    conteneur.__tsldTous = data.designs;
    conteneur.__tsldCat  = '';
    conteneur.__tsldQuery = '';

    conteneur.addEventListener('click', function (e) {
      var btnPanier = e.target.closest ? e.target.closest('.tsld-cart-btn') : null;
      if (btnPanier) {
        var slugChoisi = etat[conteneur.__tsldId];
        var designChoisi = null;
        for (var p = 0; p < data.designs.length; p++) {
          if (data.designs[p].slug === slugChoisi) designChoisi = data.designs[p];
        }
        if (designChoisi) ajouterAuPanier(designChoisi, btnPanier);
        return;
      }
      var cat = e.target.closest ? e.target.closest('.tsld-cat') : null;
      if (cat) {
        conteneur.__tsldCat = cat.getAttribute('data-cat') || '';
        var puces = conteneur.querySelectorAll('.tsld-cat');
        for (var k = 0; k < puces.length; k++) puces[k].setAttribute('aria-pressed', puces[k] === cat ? 'true' : 'false');
        filtrer(conteneur);
        return;
      }
      var item = e.target.closest ? e.target.closest('.tsld-item') : null;
      if (item) {
        var slug = item.dataset.slug;
        // Recliquer le design déjà choisi le désélectionne : le client doit
        // pouvoir revenir au produit nu sans recharger la page.
        var deja = etat[conteneur.__tsldId] === slug;
        var d = null;
        if (!deja) {
          for (var m = 0; m < data.designs.length; m++) if (data.designs[m].slug === slug) d = data.designs[m];
        }
        choisir(conteneur, d);
      }
    });

    var champ = conteneur.querySelector('.tsld-search');
    if (champ) {
      champ.addEventListener('input', function () {
        conteneur.__tsldQuery = champ.value || '';
        filtrer(conteneur);
      });
    }

    filtrer(conteneur);

    // Restitution d'un lien partagé : ?design=<slug> présélectionne.
    try {
      var demande = new URL(window.location.href).searchParams.get(PARAM);
      if (demande) {
        for (var n = 0; n < data.designs.length; n++) {
          if (data.designs[n].slug === demande) { choisir(conteneur, data.designs[n]); break; }
        }
      }
    } catch (e) { /* ignoré */ }
  }

  // ── Chargement ────────────────────────────────────────────────────────────

  function charger(conteneur, index) {
    var produit = String(conteneur.getAttribute('data-tsl-designs') || '').replace(/\D/g, '');
    if (!produit) { conteneur.style.display = 'none'; return; }

    conteneur.__tsldId = index;
    conteneur.__tsldProduct = produit;
    conteneur.style.display = 'none'; // rien ne s'affiche avant d'avoir du contenu

    var url = BACKEND + '/api/products/' + produit + '/designs?shop=' + encodeURIComponent(boutique());
    fetch(url, { credentials: 'omit', mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        // Pas de catalogue, pas de section. Une section « Choisissez un
        // design » vide donnerait l'impression d'une boutique cassée.
        if (!data || !data.designs || !data.designs.length) return;
        injecterStyles();
        construire(conteneur, data);
        conteneur.style.display = '';
      })
      .catch(function () { /* silencieux : le bloc reste masqué */ });
  }

  function demarrer() {
    var blocs = document.querySelectorAll('[data-tsl-designs]');
    for (var i = 0; i < blocs.length; i++) {
      if (blocs[i].__tsldInit) continue;
      blocs[i].__tsldInit = true;
      charger(blocs[i], i);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();

  // Thèmes à sections dynamiques (Shopify 2.0) : le bloc peut arriver après coup.
  document.addEventListener('shopify:section:load', demarrer);

  window.TSL_DESIGNS = { refresh: demarrer };
})();
