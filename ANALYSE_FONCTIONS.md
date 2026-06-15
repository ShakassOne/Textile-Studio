# 🧭 Analyse fonction par fonction — TextileLab

> Cartographie : rôle, emplacement, et **liens** (DB / API Shopify / front) de chaque module.
> **Itératif** — le backend (22 routes) est cartographié ; le studio (10 343 lignes, ~600 fonctions)
> est découpé par **zones** avec les fonctions clés, à compléter avec Codex (voir backlog en bas).
> Dernière maj : 2026-06-15 par Claude.

---

## PARTIE 1 — BACKEND (Express, `routes/`)

> Format : `MÉTHODE /chemin` (fichier:ligne) — rôle — relié à.

### `server.js` — bootstrap
- Monte tous les routers (l.498-529), sert les statiques (`public/`), CORS, JSON, logger.
- `checkSubscription` (l.444-462) : **gate billing** — si `?shop=` présent et pas d'abo actif → redirige `/billing/subscribe`. Liste d'exemptions l.468-492. → DB `subscriptions`.
- Handler `/textilelab-studio.html` (l.138) : CSP dynamique `frame-ancestors` (+ `?parent_domain=`).
- `/billing/subscribe` (l.351) : crée l'abo (mutation `appSubscriptionCreate`). → API Shopify Admin.

### `routes/_shop-context.js` — résolution du marchand
- `attachShopId` / `attachShopIdSoft` : pose `req.shopId`/`req.shopDomain` (session token > ?shop > X-Shop-Domain > bootstrap). → DB `shops`. **Pilier multi-tenant.**

### `routes/oauth.js` — installation
- `GET /install` (l.140) : démarre OAuth. `GET /callback` (l.173) : échange code→token, persiste `shops`, enregistre webhooks (`app/uninstalled`, `orders/paid`). → API Shopify + DB.

### `routes/shopify-session.js` — admin embed (token exchange)
- `POST /verify` (l.210) : valide le session token, token exchange → access_token, `_provisionShop`. → DB `shops`. `verifyJWT` exporté (utilisé par `_shop-context`).

### `routes/shopify.js` — webhooks
- `POST /webhook` (l.63) : app/uninstalled (désactive shop). GDPR : `customers/data_request`, `customers/redact`, `shop/redact`. **Obligatoires review.** → DB.

### `routes/auth.js` — admin TextileLab (super-admin, legacy)
- `POST /login` `/logout` `/me` `/change-password` `GET /sessions`. → `admin_settings` (hash mdp). ⚠️ legacy mono-admin — à confirmer vs modèle multi-marchand (cf F-audit).

### `routes/storefront.js` — Shopify côté boutique (mount `/api/shopify`)
- `GET /products` (l.50) : liste produits — **OAuth par shop** (Admin REST). → DB `shops.access_token`.
- `GET /product-variant` (l.337) : résout la variante d'un produit (pour /cart/add).
- `GET /fee-variant` (l.410) **[NOUVEAU]** : renvoie/auto-crée le produit « Frais d'impression » (write_products). `POST /fee-variant` (l.477) : config manuelle du variant_id. → DB `settings.fee_variant_id`.
- `POST /cart/create|add`, `GET /cart/:id`, `POST /checkout` : Storefront API (cartCreate…). → `SHOPIFY_STOREFRONT_TOKEN` (env).
- `GET /variants`, `POST /variants`, `GET /status`.

### `routes/pricing.js` — tarification (mount `/api/pricing`)
- `GET /` (l.58, `attachShopId`) : renvoie produits + **surcharges format scopées shop** (`settings.print_surcharges`, défauts sinon).
- `PUT /` (l.87, `requireAuth`+`attachShopId`) : sauve les surcharges par shop. → DB `settings`.
- Exporte `getProductPrice`, `getFormatExtra` (utilisés par `orders.js`).

### `routes/designs.js` — designs sauvegardés (mount `/api/designs`)
- `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` — CRUD scopé shop. → DB `designs`.

### `routes/render.js` — rendus & fichiers d'impression (mount `/api/render`)
- `POST /save-views` : aperçus mockup recto/verso. `POST /save` : rendu PNG. `POST /cart-set/:design_id` : génère mockup-cart + email-hero + print HD. `GET /download/:design_id`, `/file/:design_id/:filename`. `POST /ftp-retry`. → utils `compositeMockup`, `cloudStorage`, `ftp-upload`. DB `designs`, `renders`.

### `routes/orders.js` — commandes (mount `/api/orders`)
- `GET /meta/pricing`, `GET /`, `GET /:id`, `POST /` (crée + calcule prix via `pricing.getFormatExtra`), `PATCH /:id`. → DB `orders`.

### `routes/library.js` — bibliothèque d'images (mount `/api/library`)
- `GET/POST /categories`, `GET / POST /upload`, `PATCH/DELETE /:id` — scopé shop. → DB `library`, `categories` + stockage fichiers.

### `routes/mockups.js` + `mockup-gen.js` — mockups & génération
- CRUD mockups (`GET /`, `/product/:product`, `/:id`, `POST`, `PUT`, `DELETE`, `POST /:id/upload-glb`). `mockup-gen` : `POST /generate-all`, `DELETE /cleanup`. → DB `mockups`, utils `compositeMockup`, manifest.

### `routes/product-categories.js` — catégories produits (mount `/api/product-categories`)
- CRUD + `PATCH /reorder` + upload image. → DB `product_categories`. Alimente la tarification (catégories = produits).

### `routes/product-links.js` — liaison produit Shopify ↔ mockup
- `GET /`, `/public`, `/by-mockup/:id`, `/by-product/:id`, `PUT /:productId`, `DELETE`. → DB `product_links`. **Sert au storefront** pour afficher le bon mockup.

### `routes/ai.js` — IA (mount `/api/ai`, 17 routes)
- Réglages OpenAI (`settings`, chiffré), `POST /dalle`, `/transform`, `/generate`, styles IA (CRUD + `/public`), créations IA (CRUD + approve). → `settings.openai_api_key` (chiffré), API OpenAI.

### `routes/qr-frames.js` — habillages QR
- `GET /public`, CRUD. → DB `qr_frames`.

### `routes/shop-settings.js` — réglages boutique (style storefront)
- `GET/POST /style`, `GET /style/public`. → DB `settings`.

### `routes/admin-graphql.js` — proxy GraphQL admin
- `GET /products`, `POST /products/create`, `GET /orders`, `POST /graphql`, `GET /shop` — via **session token** du marchand. → API Shopify Admin.

### `routes/email.js` — e-mails
- `POST /order-confirmation`, `/shipping-update`, `/test`, `GET /config`. → SMTP/Resend (env). Snippet Liquid : `docs/shopify-order-email-snippet.liquid` (**ne pas réécrire**).

### `routes/models3d.js` — modèles 3D
- `GET /`, `/active`, `POST /`, `PATCH /:id/activate`, `DELETE`. → DB `models3d`, fichiers GLB.

### `routes/app-proxy.js` — proxy storefront (mount `/proxy`)
- `GET /` (page embed), `/editor` (redirect studio), `/designs/:id` (lecture publique scopée), `/tl-modal.js` (injecte l'origin backend), `/health`. HMAC App Proxy.

### `utils/`
- `crypto.js` (AES-256-GCM secrets), `cloudStorage.js` (CDN/stockage), `compositeMockup.js` (composition mockup+design), `ftp-upload.js` (envoi imprimeur), `shopify-files.js` (upload CDN Shopify), `logger.js`.

---

## PARTIE 2 — STUDIO (`public/textilelab-studio.html`) — par zones

> ~600 fonctions. Cartographie par **zone fonctionnelle** avec les fonctions pivots.
> 🔜 = à détailler avec Codex.

### Z1. État global & init
- `STATE` (objet global : product, format, textileColor, cart, viewLayers, viewThumbs, **viewFormats** [nouveau]).
- `STATE_mockup`, `_STATE_mockupIdx` (**quel mockup** — recto/verso sont des mockups séparés !), `STATE_viewIdx` (vue dans le mockup).
- `init()` (~8230) : résout le contexte shop (`window._TL_SHOP`, `_TL_PRODUCT_HANDLE`, `_TL_VARIANT_ID`, `_TL_SHOP_URL`) **en premier**, puis charge mockups/bibliothèque/pricing.
- `apiFetch()` : wrapper fetch + header `X-Shop-Domain`.

### Z2. Mockups & faces
- `applyMockup(productKey, viewIdx, mockupIdx, userAction)` (~4793) : **fonction centrale** — sauve la vue courante, change mockup/vue, restaure le format de la face [nouveau], re-render canvas. **Liée à** F1 (cumul).
- `getMockupsForProduct()`, `_saveCurrentViewLayers()` (~4248), `_restoreViewLayers()` (~4279), `_viewKey(mockupId, viewIdx)` (~4242).
- 🔜 détailler : switch de face (drawer Vue l.2924), `updateViewSwitcher` (~5044).

### Z3. Formats & zone d'impression
- `setFormat(fmt, opts)` (~5155) : change le format, mémorise par face (`viewFormats`), redimensionne. `_ctxSetFormat` (resize du design). `_getPxPerMm`, `_pxToFormat`, `_getPrintWidthMm` (échelle mm↔px — corrigée commit 145a3e7).

### Z4. Tarification (zone à refondre — voir PROPOSITION_TARIFICATION.md)
- `_faceFormat(mockupId, viewIdx)` (~5115), `_faceHasContent(mockup, idx)` (~5122), `_computeSurcharge()` (~5135) **← bug F1**, `updatePrice()` (~5152).

### Z5. Ajout au panier
- `addToCart()` (~6960) : si shop → `_checkoutShopifyDirect()`.
- `_checkoutShopifyDirect()` (~6770) : génère aperçus + print HD, construit `propsObj` (_design_id, _format, _surcharge…), résout variante, **postMessage `tl-add-to-cart`** (+ `feeLine`) vers tl-modal, ou form POST hors iframe.
- `_generateAndSaveHDRender()`, `_canvasToCleanDataURL()`.

### Z6. Outils création
- Texte (police, déformation, contour, ombre), Image (upload + bibliothèque), Couleur textile, IA (panneau), QR (`+ Ajouter le QR Code`, habillages). 🔜 lister fonctions par outil.

### Z7. Vue 3D
- `setView('2d'|'3d')` (~5197), `loadModelViewer`, `_apply3DTexture`. → model-viewer + `/api/models3d`.

---

## PARTIE 3 — STOREFRONT (`public/tl-modal.js`)
- `openModal(editorUrl)` : iframe studio (+ `parent_domain`). `interceptLinks()` : capte `/apps/textilelab` / `[data-tl-editor]`.
- `listenMessages()` → `tl-add-to-cart` : `/cart/add.json` (items shirt **+ feeLine**), ouvre le drawer, `_tlInjectCartImage()` (aperçu design), `_tlFixAllLineItems()` (masque les props `_`).

---

## Backlog d'analyse (à répartir Claude/Codex)
- [ ] Z6 : lister toutes les fonctions des 5 outils (texte/image/couleur/IA/QR).
- [ ] Z2 : tracer précisément la gestion recto/verso (mockups vs views) — **clé pour F1**.
- [ ] Détailler `render.js` (pipeline print HD / DTF / FTP imprimeur).
- [ ] Vérifier chaque endpoint : scope shop_id appliqué ? (revue sécurité multi-tenant).
