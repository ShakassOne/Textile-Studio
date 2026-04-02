# TextileLab Studio — Guide de déploiement Shopify App Store

## Prérequis
- Compte Shopify Partners : https://partners.shopify.com
- Compte Railway : https://railway.app
- Boutique de test Shopify (development store)
- Git (le code doit être dans un repo GitHub)

---

## ÉTAPE 1 — Créer l'app sur Shopify Partners

1. Aller sur https://partners.shopify.com → **Apps** → **Create app**
2. Choisir **Create app manually**
3. Renseigner :
   - **App name** : TextileLab Studio
   - **App URL** : `https://textilelab.up.railway.app` *(à mettre à jour après Railway deploy)*
   - **Allowed redirection URLs** : `https://textilelab.up.railway.app/oauth/callback`
4. Copier **Client ID** (`SHOPIFY_API_KEY`) et **Client Secret** (`SHOPIFY_API_SECRET`)

---

## ÉTAPE 2 — Déployer sur Railway

### 2a. Nouveau projet Railway
1. https://railway.app → **New Project** → **Deploy from GitHub repo**
2. Sélectionner le repo `textilelab-backend`
3. Railway détecte automatiquement le **Dockerfile**

### 2b. Volume persistant (SQLite + uploads)
1. Dashboard Railway → ton service → **Volumes**
2. **Add Volume** → Mount Path : `/data`
3. Size : 5 GB minimum

### 2c. Variables d'environnement
Dans Railway → ton service → **Variables**, ajouter :

```
NODE_ENV=production
PORT=3001
DATA_DIR=/data

# Auth admin TextileLab
JWT_SECRET=<générer avec: node -e "require('crypto').randomBytes(32).toString('hex')">
ADMIN_USER=admin
ADMIN_PASSWORD=<mot de passe fort>

# Shopify OAuth
SHOPIFY_API_KEY=<depuis Partners Dashboard>
SHOPIFY_API_SECRET=<depuis Partners Dashboard>
SHOPIFY_APP_URL=https://<ton-subdomain>.up.railway.app
SHOPIFY_APP_HANDLE=textilelab
SHOPIFY_SCOPES=read_products,write_products,read_orders,write_orders,read_customers

# Shopify Storefront (optionnel — pour checkout natif)
SHOPIFY_STORE_DOMAIN=<ta-boutique>.myshopify.com
SHOPIFY_STOREFRONT_TOKEN=<token storefront>

# FTP imprimeur (optionnel)
FTP_HOST=
FTP_USER=
FTP_PASSWORD=
FTP_PATH=/

# Email (optionnel)
RESEND_API_KEY=
FROM_EMAIL=noreply@textilelab.studio
```

### 2d. Domaine Railway
1. Railway → Service → **Settings** → **Networking** → Generate Domain
2. Copier l'URL (ex: `textilelab-production.up.railway.app`)
3. Mettre à jour `SHOPIFY_APP_URL` avec cette URL

---

## ÉTAPE 3 — Configurer l'app Shopify (Partners Dashboard)

### 3a. URLs principales
1. Partners → Apps → TextileLab Studio → **App setup**
2. **App URL** : `https://<url-railway>/`
3. **Allowed redirection URLs** : `https://<url-railway>/oauth/callback`

### 3b. Webhooks GDPR (OBLIGATOIRES)
Dans **App setup** → **GDPR webhooks** :
- **Customer data request** : `https://<url-railway>/shopify/gdpr/customers/data_request`
- **Customer redact** : `https://<url-railway>/shopify/gdpr/customers/redact`
- **Shop redact** : `https://<url-railway>/shopify/gdpr/shop/redact`

### 3c. App Proxy
Dans **App setup** → **App Proxy** :
- **Subpath prefix** : `apps`
- **Subpath** : `textilelab`
- **Proxy URL** : `https://<url-railway>/proxy`

### 3d. Privacy Policy URL
- `https://<url-railway>/privacy`

---

## ÉTAPE 4 — Tester l'installation

1. Partners → Apps → TextileLab Studio → **Test on development store**
2. Sélectionner ta boutique de test
3. URL d'installation : `https://<url-railway>/oauth/install?shop=<ta-boutique>.myshopify.com`
4. Vérifier :
   - ✅ Redirection vers Shopify pour autorisation
   - ✅ Callback reçu avec `code`
   - ✅ `access_token` stocké en DB (`/health` doit retourner 200)
   - ✅ App visible dans l'admin Shopify sous `/admin/apps/textilelab`

---

## ÉTAPE 5 — Assets App Store (requis pour la soumission)

### Icône (obligatoire)
- Format : PNG ou JPG
- Taille : **1200×1200 px** (ratio 1:1)
- Source SVG : `public/assets/app-icon.svg`
- Convertir : `npx sharp-cli public/assets/app-icon.svg -o app-icon-1200.png -w 1200 -h 1200`

### Screenshots (minimum 3, recommandé 5-8)
Tailles acceptées par Shopify : 1600×900 px ou 1280×800 px (ratio 16:9)

| # | Écran à capturer | Description |
|---|---|---|
| 1 | Éditeur principal — canvas avec mockup T-shirt | "Éditeur de design intuitif" |
| 2 | Palette couleurs + vues multi-faces (Recto/Verso) | "Personnalisation multi-faces" |
| 3 | Bibliothèque d'images + glisser-déposer | "Bibliothèque d'assets" |
| 4 | Panier avec prix par face + checkout Shopify | "Intégration checkout native" |
| 5 | Vue mobile (responsive) | "Compatible mobile" |

### Screencast (fortement recommandé)
- Durée : 30-90 secondes
- Format : MP4, 1280×720 minimum
- Scénario :
  1. Ouvrir l'app depuis l'admin Shopify (App Bridge)
  2. Choisir un mockup T-shirt
  3. Ajouter une image, changer la couleur du textile
  4. Switcher entre Recto et Verso
  5. Ajouter au panier → redirection checkout Shopify

---

## ÉTAPE 6 — Checklist avant soumission App Store

### Technique (18 points obligatoires)
- [x] OAuth 2.0 (`/oauth/install` + `/oauth/callback`)
- [x] HMAC vérifié sur tous les webhooks
- [x] 3 webhooks GDPR enregistrés dans Partners Dashboard
- [x] `app/uninstalled` webhook (auto-enregistré au callback OAuth)
- [x] `shop/redact` supprime les données du shop
- [x] `customers/redact` anonymise les données client
- [x] Page Privacy Policy publique (`/privacy`)
- [x] App Bridge 4 (embed dans iFrame admin)
- [x] Pas de REST Admin API legacy (GraphQL seulement)
- [x] HTTPS uniquement (Railway fournit HTTPS automatique)
- [ ] Tester sur Development Store → aucune erreur JS console
- [ ] Icône 1200×1200 px
- [ ] Minimum 3 screenshots 1600×900 px
- [ ] Description courte (< 160 caractères)
- [ ] Description longue (< 2800 caractères)
- [ ] Catégorie : **Design & Photography** ou **Store design**
- [ ] Pricing model déclaré (gratuit ou payant)
- [ ] Support email valide

### Contenu obligatoire dans Partners Dashboard
- [ ] App name : TextileLab Studio
- [ ] Tagline : "Créez et personnalisez vos designs textiles depuis Shopify"
- [ ] Description longue (voir ci-dessous)
- [ ] Privacy Policy URL : `https://<url>/privacy`
- [ ] Support URL ou email : `support@textilelab.studio`
- [ ] Icon 1200×1200 px (PNG)
- [ ] 3+ screenshots 1600×900 px
- [ ] Pricing : Free / Freemium / Paid (à définir)

---

## Description longue (template — à adapter)

**TextileLab Studio** est un éditeur de design textile intégré directement dans votre interface d'administration Shopify. Créez, personnalisez et gérez vos designs de marquage textile sans quitter votre boutique.

**Fonctionnalités principales :**
• Éditeur canvas complet — textes, images, formes, QR codes
• Mockups multi-vues (Recto, Verso, Manches) avec tarification par face
• Bibliothèque d'assets personnalisable
• Export haute définition PNG 300 DPI
• Génération d'images par IA (GPT-Image-1)
• Intégration native au checkout Shopify
• Compatible mobile et tablette

**Pourquoi TextileLab Studio ?**
Conçu spécifiquement pour les boutiques de personnalisation textile, TextileLab Studio s'intègre dans votre workflow Shopify sans friction. Vos clients personnalisent, commandent, vous imprimez.

---

## URLs de référence

| Service | URL |
|---|---|
| App Store | https://apps.shopify.com/textilelab-studio |
| Partners Dashboard | https://partners.shopify.com |
| Railway | https://railway.app/dashboard |
| Privacy Policy | https://\<url-railway\>/privacy |
| Health check | https://\<url-railway\>/health |
| OAuth install | https://\<url-railway\>/oauth/install?shop=\<boutique\>.myshopify.com |
