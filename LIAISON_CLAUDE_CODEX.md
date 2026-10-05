# 🔗 Fichier de liaison — Claude ↔ Codex

> **But :** Alan travaille en binôme avec deux assistants (Claude/Cowork et Codex/ChatGPT)
> et ne peut pas faire une session toutes les 4 h. Ce fichier est la **mémoire partagée**
> du projet TextileLab. Il est dans le repo et **doit être mis à jour à chaque push**
> par celui qui pousse (Claude ou Codex).

**Dernière mise à jour :** 2026-10-05 — par **Claude** (Routine « Option du jour » — remise à jour de contexte après 3 mois et demi d'écart, voir §3/§4/§6 ; aucun nouveau code ce passage)
**Branche :** `dev` · **Dernier commit poussé connu :** *(voir `docs/ROADMAP-DEV.md` §1 « Options livrées » et §4 « Journal des routines » pour le détail complet depuis fin juin)*

> ⚠️ Ce fichier était figé au 2026-06-24. Le détail de tout ce qui a été livré depuis (tarification résolue, multi-tenant, gating bouton, templates, IA Photo→Illustration + quota, réassurance, preuve sociale, upsell étape 1, etc.) vit désormais dans `docs/ROADMAP-DEV.md` (créé le 2026-09-29, mis à jour quotidiennement par des routines automatisées) — ce fichier ne le duplique plus, voir §3.
> Un chantier séparé et manuel est aussi en cours sur `dev` : **« Bibliothèque de designs »** (journal dans `docs/CHANTIER-BIBLIOTHEQUE-DESIGNS.md`) — sélecteur de design sur la fiche produit, moteur de rendu Fabric.js partagé en cours d'extraction, éditeur `public/tl-editor.js`. À ne pas confondre avec le studio de personnalisation (`public/textilelab-studio.html`) décrit ci-dessous.

---

## 0. Règles du binôme (à respecter par les deux)

1. **Avant de coder**, lire : ce fichier, `CDC_TEXTILELAB.md` (à valider), `AUDIT_TSL_2026-06-15.md`.
2. **Ne jamais affirmer « c'est prêt / sans bug »** sans l'avoir vérifié contre le code ET testé. (Leçon du 2026-06-15 : Claude a sur-affirmé que l'app était prête avant la 1ʳᵉ soumission — c'était faux.)
3. **À chaque push**, mettre à jour la section `## 1. Journal des push` (en haut), la section `## 3. État courant`, et `## 4. Tâches`.
4. **Une seule personne code un fichier à la fois.** Annoncer dans `## 5. Verrous` le fichier qu'on prend, le libérer après push.
5. **Pas d'irréversible sur la prod** (suppression, modif checkout/billing live) sans accord explicite d'Alan + diagnostic écrit ici.
6. **Convention de commit :** `type(scope): description` (feat/fix/refactor/docs/chore). Référencer la tâche : `(#tâche)`.
7. **Toujours répondre à Alan en français.**

---

## 1. Journal des push (le plus récent en haut)

| Date | Auteur | Commit | Résumé | Risque |
|------|--------|--------|--------|--------|
| 2026-06-28 | Claude | *(ce push)* | **Suppression de catégories de bibliothèque (admin).** `routes/library.js` : `DELETE /api/library/categories/:name` (requireAuth) — **refuse (409) si la catégorie contient des images** (aucune cascade), nettoie les placeholders `__cat_placeholder_%` puis supprime la ligne `categories`. Admin : bouton « 🗑 Catégorie » (à côté de « + Catégorie ») → modal listant chaque catégorie + nb d'images ; Supprimer actif seulement si vide (sinon grisé + hint « Changer de catégorie »). `node --check` + blocs JS OK. | faible |
| 2026-06-28 | Claude | `45acd93` | **Suivi nuancier : rendu noir + bord des pastilles.** Le mode de fusion (`applyColorOverlay`, multiply) n'avait PAS changé (vérifié git : inchangé depuis le commit initial) — l'aplat venait du **#000000** saisi dans le nuancier admin (multiply par noir pur écrase les plis ; le « Black » d'origine était **#222222**). Fix : plancher auto dans `applyColorOverlay` — toute couleur quasi noire (r,g,b < 0x22) est rendue **#222222** → plis préservés quel que soit le noir saisi. CSS `.swatch` : `border: 1px solid #000` (au lieu de 2px transparent) ; la sélection ambre (`.swatch.active`) continue de primer. | faible |
| 2026-06-28 | Claude | `b79bd72` | **Nuancier de couleurs PAR MOCKUP (fin de la palette codée en dur).** DB : colonne `mockups.colors_json` (`[{name,hex}]`, `[]` = palette générique). `routes/mockups.js` : `colors` accepté (POST/PUT, sanitizé : hex valide, dédup, max 60) et renvoyé partout (`serializeMockup`). Admin (modal mockup) : section « Couleurs du textile disponibles » — chips + picker + nom, retrait au clic (`ED.colors`, `renderMockupColors/addMockupColor/removeMockupColor`), envoyé par `saveMockup`. Studio : `_activePalette` remplace la const `PALETTE` ; `_setPaletteForMockup()` appelé par `applyMockup` — nuancier admin défini → seules CES couleurs, **picker libre masqué** (`#custom-color-section`), titre « Couleurs disponibles (N) », bascule sur la 1re couleur si l'actuelle est indisponible ; sinon fallback 36 couleurs + picker visible (comportement inchangé). `node --check` + blocs JS OK. Non testé live. | faible |
| 2026-06-28 | Claude | *(push préc.)* | **2 fix studio upload image.** (1) **Même logo recto+verso** : `handleImageUpload` réinitialise `input.value` après lecture → re-sélectionner le MÊME fichier redéclenche `change` (avant : rien ne se passait). (2) **Réutilisation en session** : chaque visuel uploadé est ajouté à `_sessionUploads` (dédup par dataURL) et affiché en tête de la bibliothèque (`renderLibraryGrid`), cliquable comme les autres items. Non persistant (RAM, durée de session). Front only (Railway). `node --check` OK. | faible |
| 2026-06-24 | Claude | `textile-studio-lab-17` | **Prépa soumission Shopify.** Check complet : tout le JS (backend + scripts + 6 HTML) passe `node --check`, git clean. (A) `shopify.app.toml` : **`write_products` rétabli** (scopes `read_products,read_orders,write_products`) — requis par la perso tarifée (Option A) sur l'app publique ; re-consentement OAuth nécessaire sur les installs existantes. (B) `tl-modal.js` : le gating du bouton Personnaliser **fail-open si la boutique n'a AUCUNE liaison** (sinon rejet review : bouton invisible sur store de test). **⚠️ Soumission = actions manuelles d'Alan** : `shopify app deploy` (push config + extension theme) puis soumission dans le Partner Dashboard. | faible |
| 2026-06-24 | Claude | *(push préc.)* | **2 fix front studio.** (1) **Catégories** : `loadProductCategories` masque désormais les catégories codées en dur (hoodie/totebag…) absentes de `/api/product-categories` → le front suit l'admin ; bascule sur la 1re catégorie admin si l'active n'existe plus. (2) **Drawer panier vide au 1er ajout** : `tl-modal.js` utilise la **Section Rendering API** (`sections`+`sections_url` dans `/cart/add.json`) et injecte le HTML frais du drawer (`_tlCartDrawerSectionId` + `_tlInjectSectionHTML`) → le produit apparaît dès la 1re ouverture (avant : `sections:{}` vide → drawer vide, fallait ajouter 2×). Dégradation gracieuse si la section n'est pas détectée. **Problème panneau « Produits disponibles » (produits non liés/doublons)** : code de filtrage par mockup vérifié correct + PUT product-links supprime bien la liaison → cause probable = liens chargés à l'ouverture du studio (avant déliaison), à confirmer par rechargement. **Vérifs** : `node --check` OK. Non testé live. | faible |
| 2026-06-24 | Claude | `63d4e94` | **fix prix studio** : `updatePrice()` rappelé après récupération du prix de base Shopify (`refreshResolvedProductPrice` + `prefetchLinkedProductPrices`) → le modal n'affiche plus le fallback codé en dur (19,90€) mais le vrai prix de base. **Décision point checkout** : la vignette de la page checkout (Shopify-hosted) **ne peut pas** être remplacée par la preview client sans Checkout UI Extensions (et même là, la vignette native n'est pas surchargeable) → on garde l'image produit par défaut ; le design reste capturé (props de ligne, drawer, commande admin). Option A validée OK par Alan (test 29€ + A3 → 33€). | faible |
| 2026-06-24 | Claude | `f1f0bef` | **Option A — surcharge d'impression : auto-création des variantes pré-tarifées + option « Impression » masquée sur la fiche.** Résout le 409 « combinaison non configurée » sur boutique live hors Plus. **(P2, cœur)** `routes/storefront.js` `resolveVariantForCustomization` : nouvelle **Stratégie C** — si le produit a l'option « Impression » mais que la variante (taille+montant) manque, le backend la CRÉE via `createPricedVariant()` (REST POST /variants, prix = base + surcharge, additif, hérite taxable/shipping/poids, stock `continue`), la mémorise dans le mapping, renvoie `source:'created'`. Message 409 distinct si l'option est absente. **(P1, setup explicite)** `POST /api/shopify/prepare-customization` (admin, `write_products`) ajoute l'option « Impression » (valeur « Sans impression ») via Admin **GraphQL 2025-01** `productOptionsCreate` (variantStrategy LEAVE_AS_IS) ; bouton « ✨ Activer perso tarifée » par produit dans Admin → Produits & Mockups. **(P3, fiche propre)** `public/tl-modal.js` `_tlHidePrintOption()` masque le bloc d'option « Impression » sur la fiche (best-effort multi-thèmes, re-essais 800/2000ms). **Vérifs** : `node --check` storefront.js + tl-modal.js OK, blocs JS admin OK. **NON testé live** — en particulier le comportement de `productOptionsCreate` sur les variantes existantes (P1) à valider sur 1 produit d'abord. | **moyen** (crée des variantes + ajoute une option sur produit live ; actions additives, P1 explicite) |
| 2026-06-23 | Claude | *(push préc.)* | **Bouton « Personnaliser » : affiché uniquement sur les produits LIÉS à un mockup en admin.** Régression depuis le « fix review Shopify 2.1.1 » où le block liquid était toujours visible. `routes/product-links.js` : `/public` reçoit CORS (`ACAO *`) + `OPTIONS` + `Cache-Control: no-store`. `extensions/.../personalise-button.liquid` : conteneur masqué par défaut sur storefront (`display:none` sauf `request.design_mode`), ajout `class="tl-cta-block"` + `data-tl-product-id/handle`. `public/tl-modal.js` : `_tlGatePersonaliseButtons()` (appelé dans `init()`) interroge `/api/product-links/public?shop=`, ne révèle que les produits liés (match par **handle** ou id) ; **fail-open** si l'API échoue. Compat : le JS cible `.tl-personalise-btn` et lit le produit via data-attrs OU le `href` → marche même AVANT le redéploiement de l'extension (avec un léger flash, supprimé une fois l'extension redéployée). **⚠️ ACTION : `shopify app deploy`** pour pousser le liquid (sinon pas de masquage par défaut, juste le gating JS avec flash). **Vérifs** : `node --check` OK sur product-links.js + tl-modal.js. **Non testé live.** | faible |
| 2026-06-23 | Claude | *(push préc.)* | **fix cache** : studio lit le flag Styles IA en `cache:'no-store'` (désactivation immédiate). | faible |
| 2026-06-23 | Claude | *(push préc.)* | **Styles IA (Photo → Illustration) : réactivés en front, pilotés par un switch admin par boutique.** Nouveau flag `ai_photo_styles_enabled` dans `routes/shop-settings.js` (GET/POST `/style` + `/style/public`), POST en **mise à jour partielle** (le toggle n'écrase plus `cart_drawer_bg_color`). **Défaut = activé** (`AI_PHOTO_STYLES_DEFAULT=true`). Admin `textilelab-admin.html` : carte « ✨ Studio — Styles IA » avec switch (load `loadAiPhotoStyles` / save `saveAiPhotoStyles`). Front `textilelab-studio.html` : à l'init storefront (`?shop=`), lit le flag public et `_revealPhotoStylesUI()` affiche l'onglet Photo aux 3 endroits masqués (tab desktop `data-tab=photo`, `#bnav-photo`, `#mtool-photo`). **Vérifs** : `node --check` route OK ; blocs JS inline des 2 HTML parsés OK. **Non testé live** (pas de `.env`/DB en local). Limite : le flag masque le point d'entrée (onglet), les routes `/api/ai/styles/public` + `/api/ai/transform` ne sont pas bloquées côté serveur. | faible |
| 2026-06-15 | Claude | *(local, à pousser)* | **Modèle MONTANT (cumul recto/verso).** Le palier d'impression = montant total de surcharge (€), plus un format. Règle Alan : par face cumul des visuels → format englobant (cap A3) ; total = somme des faces (A4 recto + A3 verso = 7 €) ; plafond A3+A3 = 8 €. `utils/print-tiers.js` réécrit (amountLabel/amountKey/mappingKey/paliers, plus de TIER_BY_KEY). `routes/storefront.js` : resolveVariantForCustomization + /resolve-variant prennent `amount` ; mapping par montant ; /variant-mapping renvoie `paliers`. `textilelab-studio.html` : `_computeSurcharge` cumule même-face (bounding box union, face courante) ; `_checkoutShopifyDirect` envoie `amount` ; props `_print_amount/_print_label/_print_sides/_print_format`. `textilelab-admin.html` : select mapping = montants. **Shopify (API, WinShirt)** : T-Shirt Monster Édition Homme reconstruit → option Impression 12 valeurs (Sans, +1,50 … +8,00 €), 108 variantes tarifées (29 → 37 €). **Vérifs** : node --check OK, simulation résolveur par montant OK (3€→32, 7€→36, 8€→37, 0→base, imprévu→erreur). Limite connue : cumul même-face fiable sur la FACE COURANTE ; faces non courantes = format propre. | **moyen** (touche surcharge + structure variantes) |
| 2026-06-15 | Claude (push Alan) | `fcfb1ce` | **Refonte tarification impression → variantes pré-tarifées.** Abandon total de la 2e ligne « Frais d'impression ». Désormais UNE seule ligne panier, prix d'impression inclus dans la variante. Nouveau `utils/print-tiers.js` (paliers CDC : NONE/LOGO=A6/A5/A4/A3 recto/DUPLEX). Backend `routes/storefront.js` : `resolveVariantForCustomization()` + `GET /api/shopify/resolve-variant` (hybride : option « Impression » du produit → sinon table de mapping admin → sinon 409 + log). `GET/POST /api/shopify/variant-mapping`. `/fee-variant` → **410 déprécié** (ne crée plus de produit caché). Studio `textilelab-studio.html` : `_checkoutShopifyDirect()` appelle resolve-variant, props production enrichies (`_print_tier/_print_label/_print_sides/_print_format`), erreur claire si variante absente. `tl-modal.js` : branche `feeLine` supprimée. Admin `textilelab-admin.html` : section « Mapping variantes d'impression ». `server.js` : resolve-variant ajouté à l'allowlist abonnement. **Vérifs :** `node --check` OK sur tous les JS ; blocs JS HTML validés ; 4 cas CDC simulés OK (sans perso / option A4 / mapping A3 / variante manquante→erreur). **NON testé en vrai sur Shopify** (connecteur non authentifié en session). | **moyen** (touche addToCart + nécessite création des variantes Shopify côté marchand) |
| 2026-06-15 | Claude (push Alan) | `5f260c8` | **Redesign premium dark** studio (glassmorphism, glow ambre, profondeur). Markup : barre du bas sans formats A3-A6 ni Snap (« Supprimer l'arrière-plan » en clair), badge dims **informatif** (lecture seule), segmented control **Clair/Sombre** (`setTheme()` additif, `toggleTheme()` conservé), QR **sans étapes 1/2/3/4**, bouton « **+ Ajouter ce QR code** », biblio images **4 colonnes**. **CSS/markup uniquement** — fabric.js, coords, `addToCart()`, `setFormat()`/prix, routes, Shopify, auth, DB **intacts**. JS inline validé `node --check`. Phase 2 (vCard + gating panier) **en attente GO Alan**. | faible |
| 2026-06-15 | Claude | `2421f5d` | Exempte `/api/shopify/fee-variant` du middleware abonnement (302→panier sans surcharge) | faible |
| 2026-06-15 | Claude (push Alan) | `5d6e53b` | Surcharge format → ligne « Frais d'impression » + scope `write_products` | **moyen** (approche tarif remise en cause, voir §6) |
| 2026-06-14 | Claude (push Alan) | `805f847` | Restaure modal + aperçu panier (proxy + frame-ancestors) | faible — **validé OK par Alan** |
| 2026-06-14 | Claude | `145a3e7` | Unifie l'échelle mm↔px (resize manuel == bouton format) | faible |

---

## 2. Contexte projet (résumé — détail dans CDC + AUDIT)

- **TextileLab Studio (TSL)** = app Shopify **publique multi-marchands**, cible **App Store**, vendue en **abonnement** (essai 15 j puis ~19 €/mois). Personnalisation de textile (studio canvas Fabric.js, mockups, bibliothèque, IA, QR).
- **Déploiement actuel :** 2 services Railway sur le même repo.
  - App **publique** (en review Shopify) : `textile-studio-production.up.railway.app` (config `shopify.app.toml`).
  - App **Custom WinShirt** (pour tourner en prod tout de suite, sans attendre la review) : `valiant-benevolence-production.up.railway.app` (config `shopify.app.winshirt.toml`, client_id `de57cadb…`).
- **Boutique live de test :** WinShirt — domaine myshopify `rwx2tc-iv.myshopify.com`, domaine principal `winshirt.fr`. **Plan : NON-Plus** (à confirmer formellement).
- **Source de vérité technique :** le code. Pas la mémoire, pas ce fichier seul.

---

## 3. État courant (vérifié dans le code/journal au 2026-10-04)

> Détail complet de chaque option livrée depuis juin : `docs/ROADMAP-DEV.md` §1 (« Options livrées »). Section volontairement résumée ici pour éviter la duplication.

**Ce qui marche (vérifié) :**
- Install OAuth + token exchange multi-marchand ; admin embed par session token ; 2 déploiements Railway (app publique en review App Store + app Custom WinShirt en prod immédiate via `shopify.app.winshirt.toml`).
- Storefront : bouton « Personnaliser » gaté par liaison produit↔mockup en admin (fail-open si l'API échoue) → studio en modal → ajout au panier → aperçu du design dans le drawer.
- **Tarification impression : résolue et en prod** (modèle montant cumulé recto/verso, variantes pré-tarifées auto-créées côté Shopify) — voir §6 ; T4/T5 ci-dessous et l'« OUVERT — tarification » historique sont désormais **clos**.
- Templates produit (metafield Shopify), IA Photo→Illustration (styles activables par boutique + quota par identité + généralisation du prompt pour les photos sans visage le 04/10), rate-limit IPv6-safe (01/10), bandeau de réassurance + barre de prix sticky mobile (01/10, flag désactivé par défaut pour la barre), preuve sociale visuelle « Ils l'ont fait » (03/10, flag désactivé par défaut), Upsell V2 étape 1 — table + CRUD `upsell_candidates` (02/10, backend-only), webhook `orders/paid` corrigé (03/10). Détail de chaque point : `docs/ROADMAP-DEV.md` §1.

**Ce qui reste ouvert :**
- Plan WinShirt Plus ou non (T6 ci-dessous, aussi backlog item 15 de `ROADMAP-DEV.md`) — point ouvert de longue date, toujours sans réponse d'Alan.
- Upsell V2 étape 2 (extraction du rendu headless Fabric.js) **en pause** : le chantier manuel parallèle « Bibliothèque de designs » (voir ci-dessus, `docs/CHANTIER-BIBLIOTHEQUE-DESIGNS.md`) construit un moteur de rendu partagé (`tsl-engine.js`/`utils/composition.js`) sur le même terrain, pas encore raccordé au studio — attaquer l'extraction maintenant risquerait un double travail/conflit de fusion. À trancher avec Alan (détail dans `docs/ROADMAP-DEV.md` §2).
- Le trou « paiement commencé → commande » (6 → 0 en France sur 30 j, backlog P0 de `ROADMAP-DEV.md`) — diagnostic pas encore fait, nécessite une lecture des logs Railway (hors de portée de cette routine, pas d'accès Railway dans cet environnement).

---

## 4. Tâches (backlog partagé)

> Statuts : ⬜ à faire · 🔄 en cours · ✅ fait · ⏸ en attente d'Alan
> « Owner » = qui s'en occupe (Claude / Codex / Alan).

| # | Tâche | Owner | Statut |
|---|-------|-------|--------|
| T1 | Reconstruire + faire VALIDER le CDC (`CDC_TEXTILELAB.md`) | Claude | 🔄 (rédigé, à valider par Alan) |
| T2 | Audit profond vs CDC (`AUDIT_TSL_2026-06-15.md`) | Claude | 🔄 (1ʳᵉ passe) |
| T3 | Analyse fonction par fonction (`ANALYSE_FONCTIONS.md`) | Claude+Codex | 🔄 (backend fait, studio à finir) |
| T4 | Choisir l'approche tarifaire (`PROPOSITION_TARIFICATION.md`) | Alan décide | ✅ fait (modèle montant cumulé recto/verso, variantes pré-tarifées en prod — voir §1 `ROADMAP-DEV.md`) |
| T5 | Corriger le cumul recto+verso (après T4 + audit) | — | ✅ fait (résolu par le même modèle montant) |
| T6 | Confirmer le plan WinShirt (Plus ou non) + re-consent write_products | Alan | ⬜ (toujours ouvert, voir aussi backlog item 15 de `ROADMAP-DEV.md`) |

---

## 5. Verrous fichiers (qui édite quoi maintenant)

| Fichier | Pris par | Depuis |
|---------|----------|--------|
| _(aucun)_ | — | — |

---

## 6. Décisions & points ouverts

- **DÉCIDÉ (2026-06-15) :** stop au codage tant que CDC + audit + analyse fonctions ne sont pas posés (demande d'Alan). *(levé depuis : le codage a repris sur `dev`, voir §1 et `docs/ROADMAP-DEV.md`.)*
- **DÉCIDÉ ET LIVRÉ — tarification :** modèle montant cumulé recto/verso, variantes pré-tarifées auto-créées, en prod. Voir §3 et `docs/ROADMAP-DEV.md` §1.
- **DÉCIDÉ ET LIVRÉ — cumul recto/verso :** résolu par le même modèle montant. Voir §3.
- **OUVERT — plan WinShirt :** Plus ou non ? Détermine si on peut un jour fondre la surcharge dans la ligne produit (Cart Transform = Plus only). Seul point encore ouvert parmi les décisions tarifaires de cette section.
- **OUVERT — CDC :** Alan doit confirmer/corriger `CDC_TEXTILELAB.md` (reconstruit de mémoire, pas le document d'origine).

---

## 7. Comment mettre à jour ce fichier (rappel)

À chaque push :
1. Ajouter une ligne en haut de `## 1. Journal des push`.
2. Mettre à jour `## 3. État courant` si un comportement a changé.
3. Mettre à jour `## 4. Tâches` (statuts) et `## 5. Verrous` (libérer).
4. Changer l'en-tête (date + auteur + dernier commit).
