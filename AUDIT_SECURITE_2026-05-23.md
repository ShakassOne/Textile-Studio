# Audit sécurité & code — Textile Studio Lab

**Date :** 2026-05-23
**Périmètre :** backend Node/Express (`textilelab-backend`, ~7 550 lignes JS), routes API, intégration Shopify (OAuth, webhooks, App Proxy, session token, billing), DB SQLite multi-tenant.
**Objectif :** revue avant soumission App Store Shopify.
**Branche auditée :** `daily-roadmap-2026-05-21` (= contenu de `origin/main`).

> Verdict global : **base saine et bien construite.** Aucune faille critique (pas de RCE, pas d'injection SQL, pas de secret en dur, pas de bypass d'auth admin). Les points à traiter avant soumission concernent surtout la **cohérence Shopify multi-marchand** (scopes, billing, auth par session token) et quelques durcissements.

---

## 1. Ce qui est déjà bien fait (à conserver)

- **Auth admin solide** : hachage **argon2id** (paramètres OWASP 2024), rate-limit login (10/15 min), comparaison username **timing-safe**, aucun mot de passe de secours en dur, rehash opportuniste.
- **SQL 100 % paramétré** : tous les `db.prepare(...).run/get/all` utilisent des placeholders `?`. Les deux requêtes « dynamiques » (`ai.js`, `orders.js`) construisent le `SET` à partir de **colonnes hardcodées / whitelist** (`['status','notes','render_url','shopify_id']`) → pas d'injection possible.
- **HMAC partout en timing-safe** : OAuth callback (hex), webhooks + GDPR (base64), App Proxy (hex), tous via `crypto.timingSafeEqual`.
- **Session token Shopify** : JWT HS256 vérifié à la main avec **contrôle de l'algorithme** (`alg === 'HS256'` → bloque l'attaque `alg=none`), signature timing-safe, `exp` vérifié, `dest` comparé au shop, shop confirmé installé en DB.
- **OAuth** : nonce/state anti-CSRF (usage unique, TTL 10 min, lié au shop), validation stricte du domaine `*.myshopify.com`.
- **Multi-tenant** : scoping `shop_id` appliqué sur les requêtes (designs, orders, mockups, library, stats…).
- **CORS strict** : regex d'ancrage `\.(myshopify|shopify)\.com$` (corrige le contournement `evil.shopify.com.attacker.com`).
- **Secrets** : `.env` correctement gitignoré et **non suivi** par git. Aucun secret en dur détecté dans le code.
- **Robustesse** : `frame-ancestors` CSP pour l'embed, graceful shutdown (SIGTERM), limites JSON par route, logger structuré.

---

## 2. Points MAJEURS à traiter avant soumission

### A1 — Incohérence des scopes OAuth (review Shopify + moindre privilège)
- `shopify.app.toml` déclare `scopes = "read_products,read_orders"` (réduction B7).
- Mais `routes/oauth.js` (`DEFAULT_SCOPES`) demande encore **`read_products,write_products,read_orders,write_orders,read_customers`**.
- **Conséquence :** le flow OAuth maison réclame plus de scopes que ceux déclarés → incohérence qui sera relevée à la review, et sur-privilège (`write_*`, `read_customers`) non justifié par le code.
- **Action :** aligner `DEFAULT_SCOPES` sur le `.toml` (`read_products,read_orders`), ou réintroduire dans le `.toml` ce qui est réellement nécessaire. Choisir UNE source de vérité.

### A2 — Billing non multi-tenant (token global)
- `/billing/subscribe` et `/billing/callback` (server.js) utilisent `process.env.SHOPIFY_ACCESS_TOKEN || SHOPIFY_BOOTSTRAP_TOKEN` — **un seul token d'environnement** au lieu du token de la boutique concernée.
- **Conséquence :** la souscription/vérification de charge ne fonctionne que pour la boutique « bootstrap ». Pour tout autre marchand, le billing appelle l'API Admin avec le mauvais token → échec. **Bloquant pour une app publique multi-marchands.**
- **Action :** récupérer l'`access_token` de la boutique depuis la table `shops` (`getShop(shop).access_token`) au lieu de l'env.

### A3 — Auth marchand par session token non câblée
- `requireShopifySession` (shopify-session.js) est **complet mais utilisé nulle part** (référencé seulement en commentaires).
- Les routes d'écriture admin (`POST /api/mockups`, `/api/library`, `/api/product-links`, settings IA…) sont protégées par **`requireAuth` = un mot de passe admin GLOBAL** (super-admin TextileLab), pas par marchand.
- **Conséquence :** tel quel, c'est une app **mono-boutique** (seul le détenteur du mot de passe admin peut configurer). Pour une app **publique**, chaque marchand doit gérer SES données, authentifié par SON session token.
- **Action (si soumission publique) :** câbler `requireShopifySession` sur les routes marchand, ou clarifier que l'app est distribuée en **custom app** (une boutique). À trancher selon l'objectif de distribution.

### A4 — GDPR : `shop/redact` incomplet + `data_request` no-op
- `/shopify/gdpr/shop/redact` supprime **uniquement la ligne `shops`** ; les `orders` (qui contiennent `customer_name`/`customer_email`), `designs`, `library`, `subscriptions` du shop **restent en base**.
- `/shopify/gdpr/customers/data_request` est un **TODO** (log + 200, aucune donnée renvoyée).
- **Conséquence :** non-conformité GDPR réelle malgré la réponse 200. Risque à la review « Protected Customer Data ».
- **Action :** dans `shop/redact`, purger toutes les tables scopées par `shop_id`. Implémenter (au moins minimalement) `data_request`.

---

## 3. Points MOYENS (durcissement recommandé)

- **M-a — Bypass HMAC/JWT si secret absent.** `verifyShopifyHMAC`, `verifyGDPRHMAC`, `verifyProxyHMAC`, `_verifyCallbackHMAC`, `requireShopifySession` font `return true` quand le secret n'est pas configuré (« dev sans secret »). En prod le secret est défini, donc OK aujourd'hui — mais une mauvaise config d'env ouvrirait **tout** sans authentification. **Action :** en `NODE_ENV === 'production'`, refuser (401/403) si le secret manque, au lieu de laisser passer.
- **M-b — Contournement billing via statut `pending`.** `checkSubscription` accepte `status IN ('active','trialing','pending')`. Une charge jamais confirmée (`pending`) donne quand même accès. **Action :** retirer `pending` de la liste des statuts « autorisés ».
- **M-c — Upload SVG servi en same-origin (XSS stocké).** `routes/library.js` autorise `.svg` et les fichiers sont servis statiquement depuis `/uploads`. Un SVG peut contenir du JS exécutable dans le contexte du domaine de l'app. Mitigé par `requireAuth` (admin only), mais reste un vecteur. **Action :** retirer `.svg` de la whitelist, OU servir les uploads avec `Content-Disposition: attachment` / `Content-Security-Policy: sandbox`, OU sanitiser (DOMPurify/svgo).
- **M-d — Dépendances : 5 vulnérabilités modérées.** `npm audit` signale `qs` (DoS) via `express`/`body-parser`, et `express-rate-limit` → `ip-address`. **Action :** `npm audit fix` puis re-tester, avant soumission.
- **M-e — État en mémoire (sessions admin, nonces OAuth).** Stockés dans des `Map` en RAM → perdus à chaque redeploy Railway et non partagés entre instances. Acceptable en mono-instance, mais déconnexions admin à chaque déploiement. **Action (optionnelle) :** persister (DB/Redis) si passage multi-instance.

---

## 4. Points MINEURS / informatifs

- **N-a — Regex `/file/:filename`** autorise `..` (`[\w.-]+`). Pas de traversée réelle (le `/` est exclu, un seul segment), mais on peut durcir en rejetant explicitement `..`.
- **N-b — Session token** : pas de vérification de `aud` (= API key) ni `nbf`. Defense-in-depth ; le secret étant propre à l'app, l'impact est faible.
- **N-c — `TOKEN_SECRET`** (auth.js) est déclaré mais **inutilisé** (les tokens sont des `randomBytes`, non signés) → code mort prêtant à confusion.
- **N-d — CORS** autorise les requêtes sans `Origin` avec `credentials: true` (curl/server-to-server). Comportement standard, à connaître.
- **N-e — Webhooks GDPR** : les 3 topics compliance ne sont pas dans le `.toml` (Shopify exige l'approbation « Protected Customer Data »). **Vérifier qu'ils sont bien déclarés dans Partners Dashboard → App setup → GDPR webhooks** vers `/shopify/gdpr/*` avant soumission.

---

## 5. Checklist de soumission App Store (déduite du code)

| Élément | État dans le code | À faire |
|---|---|---|
| OAuth + HMAC + nonce | ✅ implémenté | Aligner scopes (A1) |
| Webhook `app/uninstalled` | ✅ (toml + dynamique) | — |
| Webhooks GDPR (3) | ✅ routes + HMAC | Déclarer dans Partners (N-e), compléter (A4) |
| Billing (trial 15j / 19€) | ⚠️ mono-shop | Token par boutique (A2), retirer `pending` (M-b) |
| Auth marchand (session token) | ⚠️ non câblée | Décider mono vs multi-marchand (A3) |
| Privacy policy URL | ✅ `/privacy` servie | Vérifier contenu à jour |
| Dépendances | ⚠️ 5 vulns modérées | `npm audit fix` (M-d) |
| Assets (icône 1200×1200, screenshots) | hors code | À préparer dans Partners |

---

## 6. Priorisation suggérée

1. **A1** (scopes) — rapide, et bloquant à la review.
2. **A4** (GDPR redact complet) — conformité.
3. **M-d** (`npm audit fix`) — rapide.
4. **A2 / A3 / M-b** — selon la décision mono-boutique vs app publique multi-marchand.
5. **M-a, M-c, M-e, N-*** — durcissement.

> Aucun de ces points n'expose actuellement de données en production de façon active (secrets en place, HMAC actifs). La rotation des secrets exposés historiquement reste à faire en bloc en fin de finalisation, comme prévu.
