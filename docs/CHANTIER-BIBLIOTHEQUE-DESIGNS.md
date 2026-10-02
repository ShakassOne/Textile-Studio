# Chantier « Bibliothèque de designs » — état d'avancement

> Fichier d'état partagé entre les sessions. **À relire au début de chaque
> session et à mettre à jour à la fin.** Branche de travail : `dev`.

## Pourquoi ce chantier

WinShirt va passer de quelques produits à une cinquantaine de références
Toptex. Décliner chaque produit par visuel dans Shopify donnerait 10 000
combinaisons ingérables (et dépasserait les plafonds Shopify : 3 options,
2 000 variantes par produit).

On sépare donc le **support** (produit Shopify, avec ses vraies variantes :
taille, couleur) du **visuel** (bibliothèque TSL, indépendante du support).
La fiche produit affiche une section « Choisissez un design » alimentée par la
bibliothèque ; le client sélectionne, voit l'aperçu sur le mockup, et part dans
le studio pour personnaliser s'il le souhaite.

## Décisions arbitrées (ne pas les rouvrir sans Alan)

1. **TSL reste la source de vérité.** Pas de deuxième app, pas de catalogue
   dupliqué à maintenir à la main. On commence SANS synchronisation vers des
   metaobjects Shopify : le thème lit la bibliothèque via l'App Proxy. Le
   modèle de données est prévu pour permettre les metaobjects plus tard si
   l'affichage s'avère trop lent.
2. **Une seule taille de visuel par produit**, celle par défaut de la zone de
   son mockup (A4 sur un t-shirt, A6 sur une casquette). Ce coût d'impression
   est inclus dans le prix Shopify du produit. Le client qui veut déplacer ou
   agrandir passe par le studio, où la tarification existante (`extraDue`)
   s'applique au-delà de cette référence.
3. **Le `slug` est figé à la création.** Il part dans l'URL publique
   (`?design=money-control`) : le modifier casserait les liens partagés. Seule
   exception, un slug encore provisoire se recalcule au premier vrai renommage
   (cf. `isPlaceholderSlug`).
4. **Les incompatibilités support se notent en EXCLUSIONS, jamais en
   autorisations.** Une liste d'autorisations obligerait à repasser sur les
   200 visuels à chaque nouvelle référence Toptex. Par défaut un visuel est
   disponible partout ; une règle automatique sur la taille de zone filtre en
   amont, et on ne saisit à la main que les exceptions. L'exclusion porte sur
   le **mockup**, pas sur le produit : tous les produits liés au même mockup
   partagent la contrainte.
5. **`?design=` sert au partage, pas au référencement.** On pose un canonical
   vers la fiche produit de base pour ne pas créer des milliers de pages
   quasi identiques. Les designs qui méritent vraiment du SEO deviennent des
   produits templatés (mécanisme `custom.tsl_template`, déjà en production).

## Lots

| Lot | Contenu | Estimation | État |
|-----|---------|-----------|------|
| A | Modèle bibliothèque enrichi (slug, nom affiché, ordre, actif/inactif, tags, exclusions) + écran admin | 1 j | **fait** |
| B | `GET` public « quels visuels pour ce produit » : règle de compatibilité par la zone, exclusions, cache | 0,5 j | **suivant** |
| C | Block de thème « Sélecteur de design » : grille, catégories, recherche, `?design=`, mobile | 2–3 j | à faire |
| D | Aperçu : vignettes en superposition, grand visuel via le pipeline sharp, cache | 1 j | à faire |
| E | Panier sans passer par le studio : propriété de ligne, référence de prix par produit, fichier d'impression à la commande | 1,5–2 j | à faire |
| F | Ouverture du studio avec le visuel déjà placé (`?product_id=…&visual=…`) | 0,5 j | à faire |
| G | Tests, recette, passage dev puis prod | 1 j | à faire |

Première version utilisable = lots A + B + C + F. Les lots D et E viennent
ensuite ; E est le plus risqué (il touche à l'argent et à la production).

## Journal

### 2026-10-02 — Lot A entamé

Fait :
- `utils/design-library.js` (nouveau, module pur) : `slugify`, `uniqueSlug`,
  `displayNameFromFilename`, `isPlaceholderSlug`, `normalizeTags`,
  `normalizeExclusions`, `parseJsonArray`.
- `db/database.js` : migrations `library` → `slug`, `display_name`,
  `sort_order`, `is_active`, `tags`, `excluded_mockups` + index
  `(shop_id, slug)` + `backfillLibraryMetadata()` (idempotent, remplit les
  lignes existantes au démarrage).
- `routes/library.js` : `GET /` trié par `sort_order` et masquant les visuels
  désactivés (`?all=1` pour le back-office), slug + nom posés à la création
  (upload local et Shopify Files), `PATCH /:id` étendu, `POST /reorder`.
- `public/textilelab-admin.html` : nom affiché et état masqué dans la grille,
  glisser-déposer pour réordonner.

- `public/textilelab-admin.html` : modale d'édition enrichie (nom affiché,
  catégorie, étiquettes, « proposé à la vente », supports exclus, adresse
  publique en lecture seule).
- `tests/design-library.test.js` : 9 tests. Suite complète : 57 tests, 56
  passent, 1 ignoré (better-sqlite3 natif indisponible sur le Mac d'Alan).

Vérifié dans un vrai navigateur, thèmes sombre ET clair :
- la grille affiche le nom commercial, la catégorie, un badge MASQUÉ ;
- la modale lit et réécrit tous les champs, le PATCH arrive bien au serveur ;
- le glisser-déposer réordonne, y compris dans une vue filtrée par catégorie
  (l'élément déplacé se recale à côté de sa cible dans l'ordre global, et la
  liste complète est renvoyée au serveur).

**Lot A terminé.**

### Outillage de vérification visuelle

better-sqlite3 ne compile pas sur le Mac d'Alan (macOS 12 / Node 24) : le
serveur ne démarre pas en local, et `npm test` ignore proprement le seul test
qui en dépend. Le navigateur intégré refuse `localhost` et l'extension Chrome
n'est pas connectée.

Contournement utilisé, à reprendre pour les lots suivants (fichiers dans le
dossier scratchpad de la session, à recréer si besoin) :
- `stub.js` — serveur Node sans dépendance qui sert `public/` sur le port 3001
  et bouchonne les endpoints nécessaires ;
- `cdp.js` — pilote Chrome headless via le protocole DevTools (Node 24 fournit
  `WebSocket` nativement, donc aucune dépendance npm). Options : `--eval`,
  `--shot`, `--pre` (script injecté avant chargement, pour poser le jeton
  admin dans localStorage), `--w/--h`, `--dark`.

### Prochain pas — lot B

`GET /api/products/:productId/designs` (public, via App Proxy) :
produit → mockup lié → zone de la vue par défaut → visuels actifs dont le
ratio tient dans la zone, moins les `excluded_mockups`. Prévoir un cache court
comme `_templateIdsCache` dans `routes/product-templates.js`, et ne jamais
renvoyer une liste vide sur erreur sans le signaler explicitement.

## Contraintes permanentes d'Alan

- Répondre en français.
- Ne jamais pousser (`git push`) sans accord explicite. Commits locaux sur
  `dev` autorisés pour ce chantier, à chaque lot terminé.
- Pas de nouvelle dépendance npm sans demander.
- Ne toucher aucun fichier hors de ceux strictement nécessaires.
- Ne rien refactorer au passage, même si le code voisin est laid.
- En cas de doute sur un choix d'implémentation, poser la question plutôt que
  deviner.
