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
| H | **Rendu sur la photo produit** : zone à 4 coins par produit vierge, admin de calibration, composition sur l'image commerciale | 2–3 j | **en cours** |
| E | Panier sans passer par le studio : propriété de ligne, référence de prix par produit, fichier d'impression à la commande | 1,5–2 j | à faire |
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

## Contraintes permanentes d'Alan

- Répondre en français.
- Ne jamais pousser (`git push`) sans accord explicite. Commits locaux sur
  `dev` autorisés pour ce chantier, à chaque lot terminé.
- Pas de nouvelle dépendance npm sans demander.
- Ne toucher aucun fichier hors de ceux strictement nécessaires.
- Ne rien refactorer au passage, même si le code voisin est laid.
- En cas de doute sur un choix d'implémentation, poser la question plutôt que
  deviner.
