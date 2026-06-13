# Mettre Textile Studio Lab sur WinShirt sans attendre l'App Store

But : installer l'app sur **WinShirt (vraie boutique de prod)** pour le lancement /
la com de la semaine prochaine, sans dépendre de la validation App Store (bloquée
jusqu'au 26 juin + délai de review).

Statut au 13 juin : préparé par Claude pendant ton absence. Les 2 dernières étapes
(déploiement + install) t'attendent — on les fait ensemble, 5–10 min.

---

## 1. Ce qui est déjà fait

- **App Custom créée** dans le Dev Dashboard (org Shakass Communication) :
  - Nom : `TSL WinShirt Custom`
  - App id (dashboard) : `382029660161`
  - **Client ID : `de57cadb7f27bc5e9f742ff01a2f0e42`**
  - Secret : généré, **masqué** — je ne l'ai pas récupéré (interdit côté secrets).
    Tu le récupères dans : Dev Dashboard → TSL WinShirt Custom → **Paramètres → Secret**.
  - Scopes déjà saisis : `read_products,read_orders`.
- **Config prête** : `shopify.app.winshirt.toml` (à la racine du repo).
- **Correctif backend fait** (requis pour l'Option A) : la clé App Bridge
  (`shopify-api-key`) est désormais pilotée par l'env `SHOPIFY_API_KEY` dans
  `server.js` (route `/` et `/textilelab-admin.html`), avec **repli sur le client_id
  public** si l'env est absent. → Sur le déploiement public, sortie **strictement
  identique** (aucun impact). Sur le 2e déploiement, `SHOPIFY_API_KEY` = client_id
  Custom → App Bridge charge la bonne clé → **pas de page blanche**. Modif non
  commitée (lock git) — à committer + pousser sur les DEUX déploiements (même repo).
- **Fix format** du studio commité en local (`310e043`) — à pousser quand tu veux
  (`git push origin main`), indépendant de tout ça.

---

## 2. Le verrou technique à comprendre (important)

Une app embarquée déclare sa **clé API (client_id)** à App Bridge dans le `<head>`
de la page admin. Si deux apps (la publique + la custom) **partagent la même URL
d'application** (le même service Railway), la page servie ne contient qu'**une seule**
clé → l'une des deux apps reçoit la mauvaise clé → **page blanche** (exactement le bug
qui a fait suspendre l'app).

➡️ **Conclusion : l'app Custom doit tourner sur un déploiement séparé** (sa propre
URL), avec ses propres `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`. C'est l'option A
ci-dessous, recommandée.

Bonne nouvelle qui rend ça indolore : le contenu de l'app (mockups, bibliothèque,
designs, styles IA, réglages) est **stocké par boutique** (`shop_id` en base). Donc
WinShirt aurait de toute façon son propre contenu à configurer, quel que soit le
montage. **Un 2e déploiement ne fait donc rien perdre.**

---

## 3. Décision d'archi (le seul vrai choix à faire)

### ✅ Option A — 2e déploiement Railway dédié (RECOMMANDÉE)
- Un 2e service Railway, **même repo / même code**, mais ses propres variables d'env
  (dont la clé/secret de l'app Custom).
- **Un seul petit correctif de code, déjà fait** (clé App Bridge via env, voir §1) —
  **rétro-compatible**, aucun impact sur l'app publique.
- Sa propre base SQLite (contenu WinShirt à configurer — normal, c'est par-shop).
- Inconvénient : un 2e service à maintenir le temps que la publique soit validée.

### Option B — un seul déploiement, routage par chemin d'URL
- Garder un seul service Railway et router selon le chemin (`/` = app publique,
  ex. `/win` = app custom), en injectant la bonne clé API et le bon secret selon
  l'app.
- Avantage : une seule infra, une seule base (WinShirt = juste un autre `shop_id`).
- Inconvénient : **modifie le code d'auth partagé** (session token, OAuth, webhooks,
  app proxy) → risque de casser l'app publique. À ne faire que si tu tiens à une
  seule infra, et avec tests.

**Reco : Option A.** Plus rapide, plus sûr, et on ne touche pas à la prod publique.

---

## 4. Go-live Option A — checklist (à faire ensemble)

0. **Committer + pousser le correctif backend** (clé App Bridge via env, déjà écrit
   dans `server.js`). Lève d'abord le lock git :
   `rm -f .git/*.lock`, puis `git add server.js && git commit && git push origin main`.
   → l'app publique redéploie sans changement de comportement ; le code est prêt pour
   le 2e déploiement.
1. **Créer le 2e service Railway** depuis le même repo GitHub (`Textile-Studio`),
   branche `main`. Lui attacher un **Volume** monté sur `/data` (comme la prod
   actuelle) pour la base SQLite.
2. **Variables d'env** du nouveau service. Copier celles de la prod actuelle, en
   changeant uniquement les identifiants Shopify :
   - `SHOPIFY_API_KEY = de57cadb7f27bc5e9f742ff01a2f0e42`
   - `SHOPIFY_API_SECRET = <secret de l'app Custom, depuis Paramètres>`  ← **toi**
   - `SHOPIFY_APP_URL` / `APP_URL = https://<nouveau-domaine-railway>`
   - `NODE_ENV = production`, `DATA_DIR = /data`
   - Reprendre à l'identique : `OPENAI_API_KEY`, `RESEND_API_KEY`/SMTP, `JWT_SECRET`,
     `ADMIN_USER`, `ADMIN_PASSWORD`, `ALLOWED_ORIGIN` (ajouter le nouveau domaine),
     et les autres clés déjà en prod (Cloudinary/AWS/FTP si utilisées).
   - ⚠️ Ne JAMAIS réutiliser la clé/secret de l'app publique ici.
3. **Pointer l'app Custom sur ce domaine.** Dans `shopify.app.winshirt.toml`,
   remplacer tous les `https://CHANGE-ME-winshirt.up.railway.app` par le vrai
   domaine, puis :
   ```
   shopify app config link      # lier le toml à l'app TSL WinShirt Custom
   shopify app deploy           # pousser URLs, scopes, webhooks, app proxy
   ```
   (ou saisir les mêmes valeurs à la main dans Dev Dashboard → Versions → publier.)
4. **Distribution personnalisée → lien d'install :** Dev Dashboard →
   TSL WinShirt Custom → Distribution → **Custom distribution** → cibler
   `winshirt-2.myshopify.com` → générer le **lien d'installation**.
5. **Installer sur WinShirt** via ce lien (bouton Installer actif, car app Custom =
   pas soumise à review). Vérifier que l'admin embarqué s'ouvre (pas de page blanche).
6. **Configurer le contenu WinShirt** : mockups, zones, bibliothèque, styles IA,
   produits ↔ mockups (c'est une nouvelle base, donc à peupler).
7. **Vérifier le storefront** : page produit WinShirt → customizer → ajout panier →
   commande de test.

---

## 5. Si tu choisis l'Option B (plan code, à valider d'abord)

À implémenter dans le backend (commit local, puis ton push) :
- `utils/shopifyApps.js` : registre `{ key, secret }` pour l'app publique + la custom
  (via `SHOPIFY_API_KEY_2` / `SHOPIFY_API_SECRET_2`). Helpers : `appForAud(aud)`,
  `secretForClientId(id)`, `verifyHmacAny(msg, hmac)`.
- `routes/shopify-session.js` : vérifier le JWT en essayant le secret correspondant
  à l'`aud` du token ; token exchange avec la bonne paire clé/secret.
- `routes/oauth.js`, `routes/shopify.js` (webhooks), `routes/app-proxy.js` :
  accepter l'un OU l'autre secret pour les vérifs HMAC.
- `server.js` : servir l'admin avec la **clé API correspondant à l'app** (selon le
  chemin d'URL), au lieu de la clé publique hardcodée.
- Comportement **rétro-compatible** : si `SHOPIFY_API_KEY_2` absent → comportement
  identique à aujourd'hui (zéro impact prod).

Je ne l'ai pas codé pour ne pas risquer l'app publique sans ton choix d'archi.
Dis « go Option B » et je le fais (commit local, tu pousses).

---

## 6. Limites à connaître

- **Facturation marchande** : le Billing API de Shopify est restreint sur les apps
  Custom. OK si WinShirt est ta boutique (tu ne te factures pas). Si un jour un
  collab paie un abo via l'app, il faudra l'app publique validée.
- **1 boutique par app Custom** : cette app Custom = WinShirt uniquement. Autre
  boutique réelle = autre app Custom, ou attendre la validation publique.

---

## 7. Rappels

- Pousser le fix format studio : `git push origin main` (commit `310e043`).
- App publique : resoumission possible **après le 26 juin**, le bug page blanche est
  déjà corrigé en prod (testé OK sur store neuf).
- Secret de l'app Custom : à récupérer par toi (Paramètres → Secret).
