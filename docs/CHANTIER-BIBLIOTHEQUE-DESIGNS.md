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
| B | `GET` public « quels visuels pour ce produit » : règle de compatibilité par la zone, exclusions, cache | 0,5 j | **fait** |
| C | Block de thème « Sélecteur de design » : grille, catégories, recherche, `?design=`, mobile | 2–3 j | **fait** |
| D | Aperçu : vignettes en superposition, grand visuel via le pipeline sharp, cache | 1 j | **fait** |
| H | **Rendu sur la photo produit** : zone à 4 coins par produit vierge, admin de calibration, composition sur l'image commerciale | 2–3 j | **fait** |
| E | Panier sans passer par le studio : propriété de ligne, référence de prix par produit, fichier d'impression à la commande | 1,5–2 j | **câblé, à valider sur une vraie commande** |
| F | Ouverture du studio avec le visuel déjà placé (`?product_id=…&visual=…`) | 0,5 j | **fait** |
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

### Prochain pas — lot B, et un obstacle repéré

`GET /api/products/:productId/designs` (public, via App Proxy) :
produit → `product_mockup_links` → mockup → `views_json[0]` → zone →
visuels actifs du shop, moins ceux dont `excluded_mockups` contient l'id du
mockup, moins ceux que la règle automatique écarte. Cache court sur le modèle
de `_templateIdsCache` dans `routes/product-templates.js`.

**Obstacle : la table `library` ne stocke pas les dimensions des images.**
Sans largeur/hauteur en pixels, la règle automatique de compatibilité est
impossible à écrire. Il faut donc, avant le reste du lot B :

1. deux colonnes `width` / `height` sur `library` (migrations du même style) ;
2. les remplir à la création :
   - upload local → `sharp(chemin).metadata()` (sharp est déjà une dépendance,
     utilisée par `utils/compositeMockup.js`) ;
   - Shopify Files → la requête GraphQL de `utils/shopify-files.js` demande
     `... on MediaImage { id image { url } }` ; il suffit d'ajouter
     `width height` dans le bloc `image` ;
3. un rattrapage paresseux pour les lignes existantes (lire les dimensions à
   la première demande, puis les écrire), ou laisser à `null`.

**Dimensions inconnues = visuel considéré comme compatible.** On n'écarte
jamais un visuel faute de données : au pire le client voit une proposition
imparfaite, au mieux il ne manque rien au catalogue.

Règle de compatibilité proposée, deux critères, seuils à constantes nommées et
documentées (surtout pas de valeurs magiques dispersées) :

- **Résolution** — une fois le visuel mis à l'échelle de la zone, le DPI
  effectif doit rester au-dessus d'un plancher (défaut 100 DPI). La zone donne
  sa largeur physique par `views[i].printWidthMm` ; sa hauteur s'en déduit par
  le rapport `zone.h / zone.w`.
- **Occupation** — le visuel doit remplir une fraction décente de la zone
  (défaut 45 % de sa surface). C'est ce critère qui écarte tout seul un grand
  visuel vertical sur une casquette, sans que personne n'ait rien coché.

À valider avec Alan APRÈS l'avoir vu tourner sur ses vrais mockups : ces deux
seuils ne doivent pas être devinés depuis un bureau, ils se règlent en
regardant le résultat sur un t-shirt, une casquette et un tote bag.

### 2026-10-02 — Lot B fait

Dimensions des images (le préalable repéré plus haut) :
- colonnes `width` / `height` sur `library` ;
- renseignées à la création — `sharp` pour les uploads locaux, champs
  `image { width height }` ajoutés à la requête Shopify Files de la modale ;
- rattrapage au démarrage pour les lignes locales existantes, par lecture
  d'en-tête seulement, 4 s après le boot pour ne pas le ralentir.

Règle de compatibilité (`utils/design-library.js`, fonctions pures) :
- `zoneEnMm(view)` — dimensions physiques de la zone, même convention et
  même repli que `_getPrintWidthMm` dans le studio ;
- `evaluerCompatibilite(visuel, zoneMm)` — deux critères, **résolution**
  (DPI effectif ≥ `COMPAT.DPI_MIN`, 100) et **remplissage** (part de la zone
  couverte ≥ `COMPAT.REMPLISSAGE_MIN`, 0,45).

C'est le second critère qui écarte tout seul un grand visuel vertical d'une
casquette, sans que personne n'ait rien coché : contenu dans une zone large
et basse, il n'en couvre que 31 %.

`routes/product-designs.js` — `GET /api/products/:productId/designs` :
produit → mockup → zone → visuels actifs, moins les exclusions manuelles,
moins les incompatibles. Cache 2 min purgé par toute écriture sur la
bibliothèque. Renvoie aussi `ecartes` (id, nom, raison, dpi, remplissage) :
ce n'est pas du débogage de luxe, c'est ce qui permettra de régler les seuils
sur de vrais mockups.

Tests : 12 sur la route (base et contexte shop remplacés dans le cache de
modules, donc sans SQLite), 4 de plus sur les fonctions pures. Suite : 73
tests, 72 passent, 1 ignoré.

**Question en attente pour Alan.** La règle évalue le visuel contre la zone
d'impression COMPLÈTE du mockup, c'est-à-dire la plus grande taille que le
support autorise. Or la décision n°2 dit « une seule taille par produit,
celle par défaut de son mockup » — et cette taille par défaut n'existe
nulle part dans les données aujourd'hui. C'est la même valeur qui servira de
référence de prix au lot E. Deux options :
  (a) l'admin la règle par mockup (un champ « format par défaut » à côté de
      `printWidthMm`) ;
  (b) on la déduit de la zone (le plus grand format standard qui y tient).
À trancher avant le lot E. En attendant, évaluer contre la zone complète est
le choix conservateur et explicable.

### 2026-10-02 — Lot B corrigé sur données réelles

Deux défauts trouvés en interrogeant le store de dev, aucun des deux
visible en relisant le code.

**1. La liaison produit ne se trouvait jamais.** `product_mockup_links`
mélange des identifiants numériques et des GID complets
(`gid://shopify/Product/10787150004551`) ; la route cherchait les chiffres
seuls. Sans mockup trouvé, aucune zone, donc aucun filtrage : tout le
catalogue ressortait partout, en silence. On interroge désormais les deux
écritures.

**2. Le critère de résolution s'appuyait sur une valeur non calibrée.**
Premier appel réel : 16 visuels sur 18 refusés pour pixellisation.
`printWidthMm` vaut 420 sur TOUS les mockups de WinShirt — la valeur par
défaut, jamais changée. Le studio s'en sert comme d'une échelle relative
pour classer les formats (`_pxToFormat` plafonne à A3), pas comme d'une
mesure physique. La règle croyait donc imprimer sur 42 × 72 cm.

Correction : les deux critères s'adossent maintenant à deux sources
distinctes, chacune fiable pour ce qu'elle mesure.

| Critère | Source | Pourquoi elle est fiable |
|---|---|---|
| Résolution | le format d'impression retenu (A4 par défaut) | taille physique certaine, indépendante de toute calibration |
| Remplissage | les proportions de la zone | géométrie réelle, aucune unité en jeu |

Après correction, sur les mêmes données : les visuels réels passent entre
112 et 300 DPI, une image de 300 × 300 px reste écartée à 36 DPI, et un
grand vertical sur une casquette reste écarté sur ses proportions.

Vérifié en production sur dev après déploiement : **16 visuels sur 18
retenus** sur les deux mockups t-shirt, 6 catégories remontées. Les deux
écartés sont défendables — « Visuel 7 » à 69 DPI, et « Visuel 1 » à 41 % de
remplissage, juste sous le seuil de 45 %. Ce dernier est exactement le cas
limite à soumettre à Alan quand il verra la grille.

Le format se lit dans `views[i].defaultFormat` s'il existe, sinon A4. **Ce
champ n'existe pas encore dans l'écran Mockups & Zones** : c'est le réglage
à ajouter, et c'est la même valeur qui servira de référence de prix au lot
E. La question posée plus haut est donc tranchée par les faits — il faut un
champ explicite, parce que `printWidthMm` ne peut pas en tenir lieu.

### 2026-10-02 — Lots F et C

**Lot F — le studio s'ouvre sur le design choisi.**
`GET /api/library/by-ref/:ref` résout un visuel par son slug ou son id, et
refuse un visuel retiré de la vente : un lien partagé vers un design
dépublié doit se comporter comme un lien mort. Côté studio,
`_tlChargerVisuelDemande` pose le visuel dans la zone d'impression ;
`_tlQuandCadrePret` attend que la zone existe (le PNG du mockup doit être
chargé) et abandonne au bout de 8 s en posant quand même — mieux vaut un
visuel mal centré, déplaçable, qu'un studio vide. Un produit templaté garde
la priorité.

**Lot C — le sélecteur sur la fiche produit.**
- `public/tl-designs.js` (281 lignes, ES5, sans dépendance, comme
  tl-modal.js) : titre, filtres par catégorie, recherche, défilement
  horizontal ou grille, sélection, `?design=<slug>` dans l'URL, évènement
  `tsl:design` pour que l'aperçu du lot D puisse s'y brancher sans couplage.
- Servi par l'App Proxy avec la même réécriture d'origin que tl-modal.js,
  exempté de la vérification d'abonnement, CORS ouvert en statique.
- `extensions/textilelab-button/blocks/design-picker.liquid` : block de
  section avec ses réglages (titre, disposition, filtres, recherche).
- `tl-modal.js` transmet le design choisi au studio (`data-tsl-visual` →
  `&visual=`).

Le bloc se masque complètement si le serveur ne répond pas ou si aucun
design ne convient : une section « Choisissez un design » vide ferait croire
à une boutique cassée.

Vérifié dans un navigateur sur une fausse fiche produit, en 430 px et en
1100 px, thème clair et sombre — et contre le VRAI backend de dev, donc avec
les vrais visuels WinShirt : filtre par catégorie, recherche, sélection,
désélection au second clic, `?design=` restitué au rechargement, lien vers
un design inexistant sans effet, aucun débordement horizontal.

### 2026-10-02 — Lot C : correction du défilement horizontal

Signalé par Alan après mise en ligne sur le dev store : en mode défilement
horizontal, toute la fiche produit explose — colonne image écrasée à zéro,
page qui déborde latéralement. En mode grille, rien.

Cause : un défileur en `grid-auto-flow:column` a une largeur intrinsèque
égale à la somme de ses colonnes, soit ~2 000 px pour 17 vignettes. Placé
dans une colonne de thème dimensionnée par son contenu, il l'élargit
d'autant. `overflow-x:auto` ne protège de rien ici : il gère le débordement
une fois la largeur connue, il n'empêche pas de la réclamer.

Correctif : `width:0; min-width:100%` sur les deux défileurs (vignettes et
puces de catégorie). `width:0` annule leur contribution au calcul de largeur
du parent ; `min-width:100%` rétablit la largeur réelle une fois le parent
dimensionné sans eux. Plus `min-width:0; max-width:100%` sur le conteneur.

Reproduit d'abord dans une fausse fiche à deux colonnes (colonne infos à
2132 px, colonne image à 0), puis vérifié corrigé : 600/600, défileur borné
à 600 px avec 2132 px de contenu défilable. Mode grille et mobile 430 px
inchangés, aucun débordement de page.

### 2026-10-02 — Lot D : aperçu sur le vêtement

`GET /api/products/:productId/preview?design=<slug>&view=0` compose le
visuel sur le mockup et redirige vers le PNG produit.

Réemploi du moteur du back-office (`routes/mockup-gen.js`), donc displacement
map et plis du tissu compris. Trois aménagements :
- `generateMockup` accepte une taille de sortie — 900 px pour l'aperçu,
  2000 px inchangé pour le fichier d'impression ;
- la conversion zone back-office → image de sortie est extraite en
  `zoneVersSortie`, comportement identique, pour être réutilisable ;
- le visuel est posé « contenu » au centre de la zone à la marge 0,9, la même
  que `centerObjectInPrintFrame` dans le studio. `generateMockup` étire ce
  qu'on lui donne : lui passer le visuel brut le déformerait. Et reprendre la
  marge du studio garantit que l'aperçu montre ce que le client verra en
  cliquant Personnaliser.

Cache disque + registre des compositions en cours (deux visiteurs simultanés
ne paient pas deux fois). Mesuré sur dev : **1,1 s au premier appel, 0,15 s
ensuite**.

Côté vitrine, l'aperçu est rendu **sous** la grille. Placé au-dessus, il
repoussait la grille de sa hauteur au moment du clic et la vignette touchée
sortait de l'écran sur mobile. Vérifié après correction : déplacement de la
vignette cliquée = 0 px.

Réglage de block « Afficher l'aperçu sur le produit », activé par défaut.

### 2026-10-02 — Lot D retiré, lot H ouvert

Alan a refusé l'aperçu du lot D : il ne voulait pas d'une image de plus à
côté de la grille, mais que le design s'applique **sur l'image principale du
produit**, celle de gauche. Le panneau d'aperçu est retiré.

Le moteur de composition n'est pas perdu, mais il ne suffit pas : il compose
sur le packshot à plat, où la zone est un rectangle. Sur une photo
commerciale, le vêtement est porté de biais et la zone est un
quadrilatère — sans compter que les packshots sont blancs alors que le sac
Kimood a quatorze coloris.

**Décisions arbitrées avec Alan (ne pas les rouvrir) :**

6. Deux zones, deux tables, aucun champ ni chemin de code commun.

   | | `studio_print_zone` | `product_display_zone` |
   |---|---|---|
   | où | `mockups.views_json[i].zone` | table `product_display_zones` |
   | forme | rectangle | quadrilatère (4 coins) |
   | repère | back-office 440×340 | pourcentage de la photo |
   | sert à | le fichier d'impression | l'affichage sur la fiche |

   La zone existante n'est **pas** renommée en base : elle est lue en
   production par le studio, le générateur, les templates et les commandes.
   Le nom vit dans le code et la documentation.

7. La calibration se fait **une fois par produit**, pas par design ni par
   couleur. Alan l'accepte explicitement, y compris pour une cinquantaine de
   références Toptex.

8. Composer sur la photo réelle règle la couleur gratuitement : le design se
   pose sur le tissu bleu ou terracotta de la photo, avec ses ombres. Plus
   besoin d'un mockup par coloris.

**Point ouvert, à traiter dans le lot :** le sac Kimood a quatorze pastilles
de couleur, et Shopify change l'image principale à chaque clic. Une zone liée
à une seule image ne correspondrait plus dès la première pastille. La zone
s'appliquera donc à toutes les images du produit partageant le cadrage de
l'image de référence (mêmes dimensions) — vrai pour des déclinaisons
colorimétriques, à vérifier sur un produit aux angles de vue différents.

Fait dans cette étape :
- `utils/perspective.js` (module pur) : homographie carré → quadrilatère,
  inverse pour le rendu pixel par pixel, cadre englobant borné, conversion
  pourcentage → pixels, aire. 8 tests.
- `db/database.js` : table `product_display_zones`.
- `public/tl-designs.js` : panneau d'aperçu retiré.
- Le réglage de block devient « Appliquer le design sur la photo du produit ».

Un bug trouvé par les tests au passage : quatre coins confondus passaient par
la branche affine et rendaient une matrice dégénérée — rendu vide, sans la
moindre erreur pour l'expliquer. L'aire du quadrilatère est désormais
contrôlée en entrée.

Reste sur le lot H : écran de calibration dans l'admin, endpoint de rendu,
remplacement de l'image principale côté vitrine.

### 2026-10-02 — Lot H : écran de calibration

`routes/product-display-zones.js` — lecture et écriture de la zone, plus la
liste des photos du produit tirée de l'API Shopify pour que l'écran ait
quelque chose à afficher. Les coins sont validés en entrée : quatre
exactement, numériques, dans les bornes, et formant une vraie surface
(`homographieDepuisCarre` refuse un quadrilatère plat).

Admin → **Zones produit**, nouvelle entrée sous Catalogue, distincte de
« Mockups & Zones » pour qu'aucune confusion ne s'installe. Choix du
produit, choix de la photo parmi celles du produit, quatre poignées à
glisser, polygone de contrôle, enregistrement.

Deux détails qui comptent :
- si la photo calibrée a disparu du produit, l'écran le dit au lieu de
  garder une zone qui tomberait au mauvais endroit ;
- enregistrer ou supprimer une zone efface les rendus déjà composés pour ce
  produit — le cache est un fichier sur disque, il n'expire jamais tout
  seul, et sans cette purge un coin déplacé resterait invisible.

Bug trouvé en regardant l'écran : le polygone ne s'affichait pas. L'attribut
`points` d'un `<polygon>` SVG n'accepte pas les pourcentages, contrairement
aux propriétés CSS de position — les poignées étaient donc bien placées mais
reliées par rien. Corrigé par un `viewBox="0 0 100 100"` avec
`preserveAspectRatio="none"`, où une unité vaut un pour cent.

Vérifié dans un navigateur, thèmes sombre et clair : sélection du produit,
vignettes des photos, glissement d'une poignée, enregistrement, badge, liste
des produits calibrés.

Reste sur le lot H : l'endpoint de rendu (projeter le design dans le
quadrilatère, reprendre les ombres de la photo), puis le remplacement de
l'image principale côté vitrine.

### 2026-10-02 — Lot H : rendu et remplacement de l'image

`GET /api/products/:productId/preview?design=…&media=…` compose désormais sur
la PHOTO du produit, plus sur un packshot. Trois étapes :

1. le design est projeté dans le quadrilatère calibré, en perspective ;
2. les ombres de la photo sont reportées dessus — chaque pixel est multiplié
   par la luminance locale du tissu rapportée à sa moyenne, bornée pour qu'un
   pli n'avale pas le design ni qu'un reflet ne le délave. Sans ce report, le
   design flotte au-dessus du vêtement et l'œil voit un collage ;
3. composition, écriture sur disque, redirection vers le fichier.

`projeterDansQuadrilatere` (utils/perspective.js) fait le travail pixel par
pixel, en projection inverse et en échantillonnage bilinéaire. 5 tests de
plus, dont un qui vérifie qu'un trapèze déplace bien la matière en
descendant — c'est-à-dire que la perspective est réelle et pas un simple
cadrage.

**Le paramètre `media`** accepte un GID Shopify ou l'URL que la vitrine
affiche déjà — le DOM n'expose pas les identifiants de média, le thème ne
peut donner que l'URL. Les noms de fichier sont comparés après avoir retiré
les suffixes de taille des anciens thèmes (`sac_600x800.jpg`). La photo
demandée n'est acceptée que si elle appartient au produit ET partage les
dimensions de celle calibrée : sans ce contrôle, une vue de dos recevrait les
coins de la vue de face.

Côté vitrine, `tl-designs.js` remplace la source de l'image principale —
repérée comme la plus grande image de la page hors notre grille, ce qui ne
dépend d'aucun thème. Deux pièges traités :
- `srcset` est vidé, sinon le navigateur y repioche l'image d'origine et le
  remplacement reste sans effet visible ;
- un MutationObserver repose le rendu quand le thème reconstruit sa galerie,
  et en profite pour **recomposer sur la nouvelle photo** : c'est ce qui fait
  fonctionner les quatorze coloris du sac Kimood.

Si le rendu échoue, la photo d'origine reste. La fiche n'est jamais cassée
par cette fonctionnalité.

Vérifié en rejouant la chaîne hors HTTP sur un vrai design et une vraie
photo : projection correcte, trapèze visiblement incliné, transparence du PNG
conservée. **Le jugement esthétique du report d'ombres demande une photo
portée réelle** — impossible depuis ici, le store de dev est protégé par mot
de passe. À regarder avec Alan sur son premier produit calibré.

### 2026-10-02 — Lot H validé en production sur dev

Alan a calibré le t-shirt femme et le sac Kimood : **le rendu fonctionne sur
les deux**, y compris sur le coloris « Washed Green Clay » du sac, qui n'est
pas celui ayant servi à la calibration. La question « faut-il une zone par
variante de couleur » est donc tranchée par les faits : non. Les photos de
coloris Toptex sont la même prise de vue recolorée, donc mêmes dimensions,
donc même quadrilatère — le contrôle de dimensions les accepte et le
MutationObserver recompose à chaque changement de pastille.

Une zone par image ne deviendrait nécessaire que pour un produit dont les
photos ont des **cadrages différents** (vue de dos, plan serré). Dans ce cas
le contrôle de dimensions les rejette et aucun design ne s'affiche sur ces
vues-là — comportement voulu, mieux vaut rien qu'un design sur une manche.
La table est déjà prête pour cette évolution : `reference_media_id` est
stocké, il suffirait d'élargir la contrainte d'unicité.

**Défaut de manipulation corrigé.** La zone n'avait que ses quatre poignées
comme prise : la déplacer obligeait à les bouger une par une, donc à la
déformer à chaque fois. Glisser l'intérieur du quadrilatère le déplace
désormais d'un bloc, et un bouton « Redresser » rétablit un rectangle droit
dans l'encombrement courant.

Vérifié : les quatre coins se décalent du même vecteur au pixel près, et le
redressement produit un rectangle exact dont les poignées suivent.

### 2026-10-02 — Lot H : proportions et zones par photo

Deux retours d'Alan après usage réel.

**1. Le design était étiré aux dimensions de la zone.** La zone décrit la
surface imprimable disponible, pas la forme du design : y étirer le visuel
transforme un logo rond en ovale. Il est désormais inscrit dedans, centré, à
proportions conservées (`proportionsDansQuadrilatere`). C'est la hauteur qui
commande dès que le design est plus « portrait » que la zone — le cas du sac,
dont la zone est large — et la largeur reprend la main sinon, pour qu'un
bandeau ne déborde jamais du vêtement. `{ etirer: true }` reste disponible.

**2. Certains coloris du sac cadrent le produit plus haut ou plus bas.** La
zone unique tombait donc légèrement à côté sur ces photos. Modèle retenu,
celui demandé par Alan :

- une **zone de référence** (master), posée une fois, qui vaut par défaut
  pour toutes les photos du produit ;
- des **zones propres à une photo**, qui la remplacent pour celle-là
  uniquement, sans toucher aux autres ;
- un bouton « Suivre la référence » pour annuler une zone propre.

En base : la contrainte d'unicité passe à
`(shop, produit, type, reference_media_id)` et une colonne `is_master`
apparaît. SQLite ne sachant pas modifier une contrainte, la table est
reconstruite une seule fois, détectée par l'absence de la colonne ; les zones
existantes deviennent les master de leur produit.

Au rendu : une zone propre à la photo demandée l'emporte, et **sans contrôle
de dimensions** — elle y a été posée, elle est juste par construction. À
défaut, le master s'applique si le cadrage correspond. Si le cadrage diffère
et qu'aucune zone propre n'existe, aucun rendu : mieux vaut laisser la photo
intacte qu'y poser un design de travers.

Parcours vérifié de bout en bout dans un navigateur : photo 1 enregistrée en
référence, photo 2 qui en hérite comme point de départ, photo 2 corrigée sans
que le master bouge, retour sur photo 1 intacte, puis « Suivre la référence »
qui rend la photo 2 à son héritage.

### 2026-10-03 — Lot E entamé : le champ « Format par défaut » dans l'admin

Préalable posé le 2026-10-02 (question tranchée par les faits : il fallait un
champ explicite, `printWidthMm` ne pouvant pas en tenir lieu). `routes/
product-designs.js` savait déjà lire `views[i].defaultFormat` avec repli sur
A4 ; il manquait l'écran pour le régler.

Ajouté dans `public/textilelab-admin.html`, modale « Mockups & Zones » :
un sélecteur A6/A5/A4/A3 sous « Largeur réelle de la zone », par vue
(`ED.views[i].defaultFormat`, init `'A4'` sur une vue neuve,
`updateDefaultFormat()` le pose, `loadZoneCanvas()` le relit avec le même
repli que `printWidthMm`). Rien à changer côté serveur : `routes/mockups.js`
sérialise `views` tel quel, aucun filtrage de champs.

Vérifié avec un bouchon Node (`stub.js`/`cdp.js` recréés dans le scratchpad de
la session, port 3001, même méthode que les lots précédents) : champ affiché
et lisible en thème sombre et clair, changement de valeur répercuté dans
`ED.views`, `Enregistrer le mockup` envoie bien `defaultFormat` au serveur
(vérifié par relecture après écriture). Écran admin desktop, pas de volet
mobile à tester ici. `npm test` : 94 tests, 93 passent, 1 ignoré (identique,
non lié).

Reste sur le lot E : propriété de ligne de panier, référence de prix par
produit à partir de ce format, génération du fichier d'impression à la
commande (sans passer par le studio). Pas encore commencé.

### 2026-10-03 — Lot E : le moteur du fichier d'impression

Avant de câbler quoi que ce soit (panier, webhook), le morceau qui ne dépend
d'aucune décision d'architecture : produire le FICHIER D'IMPRESSION lui-même
à partir d'un visuel de bibliothèque, sans studio.

Ce n'est pas le moteur de mockup (`routes/mockup-gen.js`) : celui-là compose
le visuel SUR LA PHOTO du vêtement (displacement map, plis, multiply) pour
montrer un aperçu. Le fichier d'impression est le visuel nu, à la taille
physique réelle du format retenu — ce qui part en production.

`utils/print-file.js` (nouveau) :
- `canvasImpressionPx(format, paysage)` — taille du canevas en pixels à
  300 DPI, à partir de `FORMATS_MM` (utils/design-library.js, déjà utilisé
  par la règle de compatibilité du lot B). A4 portrait → 2480×3508, les mêmes
  pixels que les libellés `dpi300` de `routes/pricing.js` — vérifié par test,
  pas recopié à la main ;
- `placerContenu(visuel, cadre)` — le visuel contenu et centré dans le
  canevas, proportions conservées, même formule d'échelle que
  `evaluerCompatibilite` (mesurer vs rendre, même méthode) ;
- `genererFichierImpression({ visuelBuffer, format })` — sharp : lit les
  dimensions réelles du visuel, pose le canevas orienté comme lui (paysage
  s'il est paysage, même convention que le lot B), compose sur fond
  transparent. Pas de disque, pas de DB : retourne un buffer.

9 tests (`tests/print-file.test.js`) : tailles de canevas pour les 4 formats,
orientation paysage, repli sur A4 si format inconnu, centrage horizontal et
vertical sans étirement (fonctions pures), puis bout-en-bout avec un vrai
visuel via sharp — taille de sortie, transparence hors placement, couleur et
opacité au centre du visuel, canevas paysage pour un visuel paysage. Suite
complète : 103 tests, 102 passent, 1 ignoré (identique, non lié).

**Rien de câblé.** Ni route, ni panier, ni webhook : juste le moteur, testé
seul. La suite dépend de décisions à prendre avec Alan — voir ci-dessous.

**Questions en attente pour Alan, avant de câbler le reste du lot E.**

1. *Quand générer le fichier ?* À l'ajout au panier (le webhook `orders/paid`
   doit répondre en moins de 5 s à Shopify — composer une image dedans est
   risqué), au prix de générer un fichier pour des paniers jamais payés ; ou
   à la commande confirmée, en acceptant de composer dans le budget du
   webhook (l'opération mesurée ci-dessus prend quelques centaines de ms,
   donc probablement tenable, mais pas mesuré en charge réelle).

2. *Comment la ligne de panier référence le choix, pour que la production le
   retrouve ?* Le webhook `orders/paid` (routes/shopify.js) sait déjà lire un
   `design_id`/`_design_id` depuis les propriétés de ligne — son commentaire
   anticipe même un « nouveau flow cart direct ». Mais `design_id` pointe
   vers la table `designs`, dont `layers_json`/`frame_x..h` encodent l'état
   complet d'un canvas Fabric côté studio (espace canvas du navigateur, pas
   le repère backoffice 440×340 de la zone) : une ligne `designs` créée
   côté serveur pour un ajout direct ne serait pas rejouable dans le studio,
   et je ne veux pas improviser ce format sans vérifier avec toi qu'aucun
   écran (admin, email de confirmation) ne s'attend à un vrai historique
   Fabric derrière chaque `design_id`. Alternative : un chemin séparé (une
   colonne `orders.library_id`, le fichier d'impression stocké à part) qui
   ne mélange pas les deux concepts. À trancher avant de toucher au webhook.

3. *« Référence de prix par produit » veut-elle dire quoi exactement ?* Il
   existe déjà un mécanisme `pricingReference`/`extraDue`
   (utils/print-tiers.js) pour les produits TEMPLATE
   (`custom.tsl_template`) : un montant figé sur le produit Shopify,
   recalculé si le client va plus loin dans le studio. Il dépend lui aussi du
   canvas Fabric (bounding box des calques). Pour un ajout direct sans
   studio il n'y a rien « de plus » à calculer — le prix Shopify du produit
   suffit (décision n°2). Est-ce que « référence de prix » du tableau des
   lots voulait dire ce mécanisme-là (écrire un `pricingReference` sur le
   produit), ou simplement tracer le format/prix utilisé dans `orders`
   (colonnes `format`/`format_price`, déjà lues par le webhook) pour garder
   un historique côté admin ? Les deux sont de taille très différente.

### 2026-10-03 — Deux défauts remontés par l'usage

**Le premier ajout au panier était toujours perdu.** `tl-modal.js` lisait la
réponse de `/cart/add.json` sans vérifier qu'elle avait réussi : un refus 422
passait pour un succès, le modal se fermait, le tiroir s'ouvrait vide. Cause
du 422 : au premier ajout d'une combinaison taille + impression, le backend
vient de créer la variante pré-tarifée et Shopify met un instant à la
publier. Trois tentatives espacées (0, 0,9 et 2 s), message explicite en cas
d'échec, et réactivation des boutons du studio — personne ne les réveillait,
le client restait devant un bouton mort.

**Le studio proposait 36 teintes sur un sac qui n'en vend que 14.**
`GET /api/products/:id/colors` renvoie désormais les coloris réels, et le
studio les fait passer avant le nuancier du mockup puis la palette générique.

Chemin parcouru, parce qu'il est instructif : la pastille native de Shopify
(`optionValues.swatch`) n'existe qu'à partir de l'API 2024-07 alors que le
projet est en 2024-01 — `adminGraphQL` accepte donc une version forcée pour
ce seul appel. Mais une fois la requête faite, **les quatorze valeurs
n'avaient aucune pastille**, ni native ni par la taxonomie. Le thème, lui,
en affiche : il les tient de ses propres réglages, inaccessibles sans le
scope `read_themes` — qu'on ne va pas demander au marchand pour lire une
donnée de thème.

D'où le repli retenu : **déduire la teinte de la photo de chaque variante.**
Les packshots Toptex sont sur fond blanc ; écarter les pixels quasi blancs
ne laisse que le tissu, dont on prend la médiane par canal — une ombre
portée ou un reflet tirerait la moyenne, la médiane les ignore.

Résultat sur le sac : 14 teintes sur 14, fidèles aux pastilles du thème
(#ede3d4 Naturel, #a36237 Caramel Coffee, #fcda4a Lemon Zest…). Et zéro
saisie manuelle, ce qui compte avec cinquante références Toptex à venir.

### 2026-10-03 — Session de vérification : lot E toujours bloqué sur les 3 questions

Repris le fil du journal. Arbre de travail propre, toujours sur `dev`, rien
commité par un autre agent entretemps.

Les trois questions posées à Alan dans l'entrée « Lot E : le moteur du
fichier d'impression » (quand générer le fichier, comment la ligne de panier
référence le choix, ce que recouvre « référence de prix ») sont encore sans
réponse. Les trois pièces qui restent sur le lot E — propriété de ligne de
panier, référence de prix, génération à la commande — en dépendent toutes les
trois : aucune ne se code sans trancher au moins une des trois, et ce sont
des choix qui engagent la suite (modèle de données, ce que `orders/paid`
attend, ce que verra l'admin). Conformément à la consigne, je n'ai pas deviné
et je n'ai touché aucun fichier de code.

Vérifié qu'il n'y avait rien d'indépendant de ces trois questions à avancer
dans le lot E : le moteur (`utils/print-file.js`) est déjà fait et testé ; la
lecture d'un visuel de bibliothèque qu'il soit local ou sur un CDN existe
déjà (`_octetsDuVisuel` dans `routes/product-designs.js`), rien à bâtir de ce
côté-là avant de savoir où ce fichier doit être branché. Le lot G (recette,
passage dev puis prod) vient explicitement après le lot E dans le tableau :
pas de raison de l'entamer en avance.

`npm test` : 104 tests, 102 passent, 2 ignorés — `upsell-candidates` (connu)
et `social-proof` (même cause, binaire natif better-sqlite3 absent sur cette
machine ; ce test existait déjà avant le lot E et n'a pas été touché
aujourd'hui). Aucune régression, aucun fichier modifié hors ce journal.

**Pour les prochaines sessions automatiques sur ce chantier : si les trois
questions ci-dessus sont encore sans réponse d'Alan, inutile de refaire cette
analyse — se contenter de vérifier qu'aucune réponse n'est arrivée, confirmer
que les tests passent toujours, et s'arrêter là plutôt que de deviner.**

### 2026-10-04 — Lot E câblé : panier direct, webhook, fichier d'impression

Les 3 questions bloquantes ont été tranchées avec Alan :

1. **Quand générer le fichier** → à la commande confirmée (webhook
   `orders/paid`), pas à l'ajout au panier. Alan a maintenant une boutique de
   test pour valider sans crainte de polluer de vraies ventes.
2. **Comment la ligne de panier référence le visuel** → une clé séparée,
   `_library_id`, qui ne pointe JAMAIS vers `designs` (l'historique canvas
   Fabric du studio). Le **format n'a pas besoin d'être stocké sur la
   commande** : Alan a fait remarquer qu'il n'a qu'une seule taille par
   produit (le réglage posé le 2026-10-03) — le format se retrouve via
   produit → mockup → `defaultFormat` au moment de la génération.
3. **Référence de prix** → aucun mécanisme à coder. Alan confirme que le prix
   Shopify du produit (vêtement + impression) suffit tel quel, conforme à la
   décision n°2 du chantier. L'option « prix du produit + mécanisme de
   calcul » est abandonnée.

**Demande d'Alan en plus, traitée dans ce lot :** que le visuel choisi
s'affiche dans le panier. Bonne surprise en relisant `tl-modal.js` : ce
mécanisme existe déjà, en production, pour le studio — une surcouche d'image
générique et théma-agnostique (`_preview_img` en propriété de ligne cachée,
injectée en overlay sur l'image native du panier, avec resynchronisation
permanente). Il suffisait de poser la même propriété depuis le nouveau
bouton : **zéro nouveau code d'affichage panier**.

**Fait :**
- `db/database.js` — colonne `orders.library_id` (nullable), séparée de
  `design_id`.
- `routes/product-designs.js` — deux exports nouveaux, aucune route
  existante modifiée : `resoudreFormatProduit()` (mockup → vue → format,
  même lecture que `GET /designs`, dupliquée volontairement plutôt que d'aller
  toucher la route déjà vérifiée en production) et `octetsDuVisuel()` (déjà
  interne, juste exportée — lit un visuel local ou CDN).
- `routes/shopify.js` — le webhook `orders/paid` lit `_library_id` sur la
  ligne de commande, l'enregistre à part de `design_id`, puis (async, non
  attendu, même logique que l'envoi d'email juste en dessous — Shopify veut
  un 200 rapide) génère le fichier d'impression avec le moteur du
  2026-10-03 et l'écrit dans `orders.render_url` — un champ déjà existant,
  déjà éditable à la main depuis l'admin, jamais auto-rempli jusqu'ici. Pas
  de nouvelle colonne pour cette seule idée. `orders.format` est corrigé
  avec la vraie valeur retenue une fois connue.
- `public/tl-designs.js` — bouton « Ajouter au panier », visible seulement
  quand un design est choisi. Au clic : `postMessage({type:'tl-add-to-cart',
  …})`, le même canal que le studio envoie depuis son iframe — tl-designs.js
  et tl-modal.js tournent dans la même page (pas une iframe), donc le message
  reste local à l'onglet. Propriétés posées : `Visuel` (visible, nom du
  design), `_library_id` (caché, lu par le webhook), `_preview_img` (caché,
  déclenche l'overlay panier déjà en place). Bouton désactivé pendant l'appel,
  réactivé sur l'évènement `cart:update` (avec un filet de sécurité à 3,5 s si
  l'évènement n'arrive pas).

**Vérifié :**
- `npm test` : 107 tests, 105 passent, 2 ignorés (cause d'environnement
  connue, non liée). 3 tests ajoutés sur `resoudreFormatProduit` (pas de
  mockup lié, lecture du format, repli sur A4).
- Navigateur, en conditions réelles de script (pas de lecture de code) :
  fausse fiche produit servie par un petit serveur Node local (le navigateur
  intégré refuse les fichiers locaux hors du dossier projet, d'où un serveur
  plutôt qu'un fichier ouvert directement), `tl-modal.js` et `tl-designs.js`
  chargés tels quels, `fetch` bouchonné pour les appels réseau. Vérifié en
  thème clair, sombre, et largeur mobile (375 px) : le bouton n'apparaît
  qu'après sélection d'un design, et le clic produit exactement
  `POST /cart/add.json` avec le variant_id lu dans le formulaire natif et les
  trois propriétés attendues. Bouton réactivé après coup, aucune erreur
  console.

**Pas vérifié : le trajet complet sur une vraie commande.** Je n'ai simulé ni
le webhook Shopify réel ni un vrai achat — par prudence (je ne déclenche pas
de commande, même de test, sans qu'Alan soit aux commandes), et parce que
better-sqlite3 ne tourne pas sur cette machine pour une vérification de bout
en bout en local. **À faire par Alan sur la boutique de test** : passer une
commande avec un visuel choisi directement sur la fiche produit (sans
studio), puis vérifier dans la base que `orders.library_id` et
`orders.render_url` sont bien remplis, et ouvrir le fichier généré.

**Hors scope, noté pour plus tard si besoin :** l'email de confirmation de
commande ne montre pas encore le visuel pour un achat direct de bibliothèque
(`design` reste `null`, donc aucune vignette ne s'affiche dans
`buildOrderConfirmationHTML`). Alan n'a demandé que l'affichage panier ; je
n'ai pas élargi au mail sans qu'il le demande.

### 2026-10-04 — Deux retours d'Alan après test réel sur le dev store

Premier essai réel confirmé par Alan (sac Kimood, visuel « WinshirtGraph ») :
le bouton fonctionne, la propriété `Visuel` apparaît bien dans le panier.
Deux défauts relevés sur sa capture d'écran.

**1. Deux boutons « Ajouter au panier » côte à côte** (le nôtre + celui du
thème) prêtaient à confusion — on peut recliquer le mauvais. Le bouton natif
du thème (`form[action*="/cart/add"] [name="add"]`, convention Shopify quasi
universelle) est désormais masqué tant qu'un design est choisi, et restitué à
la désélection : un seul bouton visible à la fois. Effet de bord mineur et
accepté : un sélecteur de quantité resterait affiché sans bouton à côté sur
les thèmes qui en posent un — non signalé par Alan, pas traité.

**2. Le panier affichait le visuel seul, pas le produit avec le visuel.**
`_preview_img` pointait vers la vignette brute de la bibliothèque. Corrigé :
on réutilise désormais le rendu déjà composé sur la photo principale (lot H,
`img.__tsldRendu`) — exactement ce que le client vient de voir sur la fiche.
Repli sur la vignette nue si ce rendu n'existe pas encore (produit non
calibré, ou composition pas finie de charger) : dégradation cohérente avec le
reste de `tl-designs.js`.

Vérifié en navigateur (même fixture locale) : sélection d'un design → bouton
natif disparaît, bouton TSL seul visible ; désélection → bouton natif
revient ; `__tsldRendu` simulé → `_preview_img` le reprend tel quel dans le
corps de `POST /cart/add.json`. `npm test` : 116 tests, 114 passent, 2
ignorés (inchangé).

### 2026-10-04 — Moteur partagé et circuit de commande

Trois pièces, aucune branchée au configurateur : il tourne inchangé.

**`utils/composition.js`** — le contrat commun. Faces nommées (`front`,
`back`) au lieu d'un index `<mockup>_<vue>`, positions RELATIVES à la zone
d'impression. Une composition rend identiquement à n'importe quelle taille
d'écran, ce qui supprime par construction le recalage et sa cascade de
tentatives. Les templates v1–v3 restent lisibles via leur `frame`.

**`public/tsl-engine.js`** — le canevas partagé. Propriétaire unique de la
conversion composition ⇄ canevas et de l'export. Pas d'interface : le bloc
et le configurateur ont des habillages différents et doivent pouvoir
diverger. Vérifié avec Fabric 5.3 dans un navigateur.

**`utils/print-composition.js` + `POST /api/render/from-composition/:id`** —
le fichier d'impression, reconstruit côté serveur depuis la composition
enregistrée. Un PNG fourni par le navigateur ne prouve rien ; reconstruire
garantit qu'on imprime la commande. Le placement vient de
`utils/composition.js`, la même arithmétique que l'écran.

Vérifié de bout en bout sur dev : design créé avec composition → fichier A4
2480×3508 à 300 dpi → propriétés de ligne prêtes pour le panier.

#### Le chemin des polices, parce qu'il se reproduira

Le rendu serveur n'a pas les polices du navigateur, et le premier fichier
produit en production était **entièrement en carrés** alors que tout
fonctionnait en local. Quatre formats essayés avant d'aboutir :

| source | format servi | verdict |
|---|---|---|
| User-Agent IE6 | EOT | illisible par le moteur |
| navigateur récent | WOFF2 | la version Linux ne décompresse pas le Brotli |
| dépôt GitHub Google | fonte variable | lue à la graisse 100 → tout en filet |
| **User-Agent Android 2.3** | **TrueType statique** | **✓** |

Montserrat romain et gras sont embarqués (88 Ko, OFL) pour que le texte
sorte toujours ; les trente autres familles se téléchargent à la demande et
se mettent en cache sur le volume. Trois pièges annexes valent d'être
notés : `sans-serif` n'est pas une famille enregistrée côté serveur ; le
motif `fonts/` du .gitignore écartait aussi la police embarquée ; et le
filtre « graisse ≥ 400 », ajouté pour écarter un Thin de système, rejetait
notre propre fonte variable.

`/api/version` expose désormais l'état des polices. Sans ce relevé, un
conteneur qui imprime des carrés ne se signale nulle part.

#### Une faille corrigée

La lecture des sources de calques acceptait n'importe quel chemin local.
Les compositions venant du navigateur d'un client, `../../..` dans un
calque faisait ouvrir un fichier arbitraire du serveur. Sources locales
confinées à `/uploads`, vérifié APRÈS résolution du chemin.

#### Reste à faire

Raccorder le configurateur au moteur. Tant que ce n'est pas fait, « un seul
moteur » reste une intention : deux implémentations coexistent. À faire
quand Alan peut valider sur le dev store derrière.

### 2026-10-07 — Session automatique : chantier repris en direct par Alan, rien touché

Arbre de travail propre, toujours sur `dev`. Près de 40 commits sont arrivés
depuis cette dernière entrée (04/10), mais pas via ce journal : Alan a
visiblement continué le raccordement « configurateur ↔ moteur partagé » en
direct, sur `public/tl-editor.js` et `public/tsl-engine.js` (nombreux commits
`feat(editeur)`/`fix(editeur)` les 05 et 06/10 — calibration recto/verso,
tarification, mobile, cadre d'impression), puis a basculé depuis le 06/10
après-midi sur un autre sujet (`feat(suggestions)`/`fix(panier)`, upsell et
un 422 muet sur l'ajout panier). Aucun commit sur ces fichiers depuis le
06/10 20h36 ; rien de nouveau non plus sur les 3 questions du lot E, déjà
tranchées le 04/10.

Conséquence pour cette session : le tableau des lots (ligne E : « câblé, à
valider sur une vraie commande ») et le « Reste à faire » ci-dessus sont déjà
corrects, mais ce journal ne reflétait plus l'activité réelle sur le lot E
avant cette entrée. Je n'ai touché ni `tl-editor.js`, ni `tsl-engine.js`, ni
`textilelab-studio.html` : ce sont exactement les fichiers qu'Alan vient de
retravailler à la main pendant deux jours, et m'y avancer sans lui aurait un
risque réel de double travail ou de conflit, pas une simple prudence
théorique. La validation sur une vraie commande (lot E) reste aussi hors de
portée ici : elle suppose qu'Alan passe lui-même une commande de test.

`npm test` : 147 tests, 145 passent, 2 ignorés (`social_proof_items` et
`upsell_candidates`, cause connue — binaire natif better-sqlite3 absent sur
cette machine, sans lien avec ce chantier). Aucune régression. Aucun fichier
de code modifié.

**Pour la prochaine session automatique :** si le raccordement
configurateur ↔ moteur reste non loggé ici mais que les commits montrent
qu'Alan y travaille encore (fichiers `tl-editor.js`/`tsl-engine.js`/
`textilelab-studio.html`), ne pas y toucher et se limiter à vérifier l'état
et les tests, comme ici. S'il n'y a plus eu de commit sur ces fichiers depuis
plusieurs jours, c'est probablement le bon moment pour reprendre le fil et
mettre ce journal à jour avec ce qui a réellement été fait.

### 2026-10-07 — Repassage le même jour : rien de neuf

Arbre propre, toujours sur `dev`, HEAD toujours sur `80e35e4` (le commit de
l'entrée précédente) : aucun commit n'est arrivé entre les deux passages,
d'Alan ou d'un autre agent. Dernier commit sur
`tl-editor.js`/`tsl-engine.js`/`textilelab-studio.html` toujours le
2026-10-06 20h31 — moins d'une journée d'écart, pas « plusieurs jours » :
je n'y touche donc pas, conformément à la note laissée ci-dessus.

`npm test` : 147 tests, 145 passent, 2 ignorés (`social_proof_items` et
`upsell_candidates`, cause connue, machine). Identique au dernier relevé.
Aucun fichier de code modifié.

Rien d'indépendant à avancer sur le lot E (bloqué sur la commande de test
réelle d'Alan) ni sur le lot G (vient après E dans le tableau, pas de raison
de l'entamer en avance — décision déjà prise le 2026-10-03). Même consigne
reconduite pour la suite : tant que l'écart sur les trois fichiers de
l'éditeur reste inférieur à plusieurs jours, se limiter à cette vérification.

### 2026-10-09 — Session automatique : Alan toujours actif sur l'éditeur, rien touché

Arbre de travail propre, toujours sur `dev`. Trois commits sont arrivés depuis
la dernière entrée (07/10 09h07), tous le même jour entre 09h07 et 10h10 :
`4aa956a` (bouton « Personnaliser » aux couleurs du thème), `b5aaf78`
(recoloration d'un visuel monochrome, du canevas au fichier d'impression) et
`1ffc969` (la pastille de couleur sur la fiche produit renvoie au
configurateur). Les trois touchent `tl-editor.js`, `tsl-engine.js` et/ou
`textilelab-studio.html` — exactement les fichiers qu'Alan retravaille à la
main. Dernier commit sur ce trio : **2026-10-07 10h10**, soit moins de deux
jours d'écart avec ce passage (09/10) : je n'y touche donc pas, même consigne
que le 07/10.

Rien de neuf sur les 3 questions du lot E (tranchées le 04/10) ni sur le lot
G (vient après E, pas de raison de l'entamer avant la validation d'Alan sur
une vraie commande — décision du 03/10). Aucune piste indépendante de ces
deux points à avancer dans le tableau des lots.

`npm test` : 149 tests, 147 passent, 2 ignorés (`social_proof_items` et
`upsell_candidates`, cause connue — binaire natif better-sqlite3 absent sur
cette machine). Aucune régression. Aucun fichier de code modifié.

**Pour la prochaine session automatique :** même règle — si les fichiers de
l'éditeur (`tl-editor.js`/`tsl-engine.js`/`textilelab-studio.html`) ont encore
été commités il y a moins de plusieurs jours, se limiter à cette vérification.
Sinon, c'est le moment de reprendre le fil et de documenter ici ce qu'Alan a
réellement fait sur le raccordement configurateur ↔ moteur partagé.

### 2026-10-09 — Repassage immédiat : rien de neuf

Arbre propre, toujours sur `dev`, HEAD toujours sur `78cdebf` (le commit de
l'entrée précédente, committé une minute avant ce passage) : aucun commit
n'est arrivé entre les deux. Dernier commit sur `tl-editor.js`/
`tsl-engine.js`/`textilelab-studio.html` toujours le 2026-10-07 10h10 — même
situation, même consigne : on n'y touche pas.

`npm test` : 149 tests, 147 passent, 2 ignorés (cause machine connue,
inchangée). Rien d'indépendant à avancer sur le lot E (bloqué sur la
commande de test réelle) ni sur le lot G (après E). Aucun fichier de code
modifié.

## Contraintes permanentes d'Alan

- Répondre en français.
- Ne jamais pousser (`git push`) sans accord explicite. Commits locaux sur
  `dev` autorisés pour ce chantier, à chaque lot terminé.
- Pas de nouvelle dépendance npm sans demander.
- Ne toucher aucun fichier hors de ceux strictement nécessaires.
- Ne rien refactorer au passage, même si le code voisin est laid.
- En cas de doute sur un choix d'implémentation, poser la question plutôt que
  deviner.
