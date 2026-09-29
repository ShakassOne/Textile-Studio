# Roadmap Dev — TSL (Textile Studio Lab / WinShirt)

> Document vivant, mis à jour par les routines automatisées (voir en bas) et par les sessions manuelles.
> Portée : uniquement l'app TSL Shopify (Node/Express/SQLite/Fabric.js, Railway). Pas TSL 2.0, pas Shakass.com, pas Shakabot.
> Règle du dépôt : tout se fait sur `dev`, rien ne part sur `main` sans validation explicite d'Alan.

_Dernière mise à jour : 2026-09-29_

---

## 1. Options livrées (état actuel, vérifié dans le code/l'historique)

Fonctionnalités en place au 2026-09-29 (branche `dev`) :

- **Studio de personnalisation** (Fabric.js 5.3) : upload logo/visuel, bibliothèque d'images (hébergée Shopify Files/CDN), nuancier de couleurs par mockup, formats A3→A6, QR codes avec habillages, texte (Arc/Wave), redesign premium dark/clair.
- **Tarification impression** : modèle « montant cumulé recto/verso » avec variantes pré-tarifées créées automatiquement côté Shopify (plus de ligne « Frais d'impression » séparée). Option « Impression » masquée sur la fiche produit.
- **Multi-tenant Shopify** : OAuth + token exchange, admin embed par session token, 2 déploiements Railway (app publique en review App Store + app Custom WinShirt en prod immédiate via `shopify.app.winshirt.toml`).
- **Gating du bouton « Personnaliser »** : visible uniquement sur les produits explicitement liés à un mockup en admin (fail-open si l'API de liaison échoue).
- **Templates produit** : système de templates avec sauvegarde en metafield Shopify, surcoût relatif au template, onglet admin dédié.
- **IA — Photo → Illustration** : styles activables/désactivables par boutique (flag `ai_photo_styles_enabled`), génération depuis une photo de départ.
- **Quota IA** : quota de générations par identité (client connecté reconnu, sinon visiteur/IP), rechargé à l'achat, consultation/remise à zéro par l'admin, message d'attente lisible côté studio.
- **Suivi qualité** : `node --test` sur `tests/*.test.js` (ai-quota, customer-token, pricing-source-sync, print-tiers, template-pricing).

Documents de contexte existants (à ne pas dupliquer) : `LIAISON_CLAUDE_CODEX.md` (journal de push partagé Claude/Codex — **daté du 2026-06-24, à remettre à jour**), `CDC_TEXTILELAB.md`, `AUDIT_TSL_2026-06-15.md`, `PROPOSITION_TARIFICATION.md`.

---

## 2. Backlog priorisé

Priorité donnée aux options qui aident directement à **vendre** : simplicité, mobile, confiance, rapidité jusqu'au panier. Rappel des idées **déjà rejetées par Alan** (ne pas reproposer) : assistant « décris ton design » à 3 propositions, design en pack sur toute la gamme, personnalisation en un seul champ, commande groupée, galerie « remix » de créations clients.

### P0 — Signal fort à investiguer en premier
1. **Comprendre le trou paiement commencé → commande (6 → 0 en France sur 30 j).** Ce n'est pas une nouvelle fonctionnalité mais un diagnostic : vérifier les logs Railway autour de `/cart/add`, `resolve-variant`, et le checkout Shopify hébergé pour une erreur silencieuse (variante manquante, JS bloquant, prix qui saute). Tant que cette fuite n'est pas comprise, toute autre option est moins prioritaire.

### P1 — Simplicité / confiance / mobile (candidats pour la Routine A, 1 option par jour, sous flag)
2. Bandeau de réassurance visible sur la page produit et dans le studio (délais de production, réexpédition/retour, paiement sécurisé) — la confiance est identifiée comme un frein (0 commande malgré des paniers).
3. Indicateur de prix qui reste visible et stable pendant toute la personnalisation (éviter tout saut de prix perçu comme trompeur au moment du panier).
4. Passage studio → panier en un minimum de clics sur mobile (audit tactile : taille des boutons, drawer, clavier qui masque un champ) — la majorité du trafic est probablement mobile, à confirmer.
5. État de chargement clair partout où une action réseau peut sembler bloquée (sur le modèle du fix récent sur l'attente IA).
6. Mise à jour de `LIAISON_CLAUDE_CODEX.md` pour refléter l'état réel (dernier changement documenté remonte à juin, alors que le quota IA de septembre n'y figure pas) — hygiène qui évite les régressions par méconnaissance de l'état réel.

### P1ter — Simplifier le studio (comparatif Spreadshirt, test manuel d'Alan le 2026-09-29)
Constat d'Alan après test réel sur spreadshirt.fr/personnaliser-soi-meme : TSL fait **plus** que Spreadshirt (aucun complexe à avoir sur le fond), mais leur configurateur **paraît** plus simple/intuitif. Écarts concrets identifiés (à vérifier dans `public/textilelab-studio.html`) :
- Popup de démarrage léger (« Concevez maintenant » : 4 icônes Images/Téléchargements/Texte/Design IA) au lieu d'exposer tous les onglets en permanence — à évaluer comme alternative/complément aux tabs actuels (`data-tab` : texte/image/couleur/ia/qr).
- Barre d'outils contextuelle d'un objet sélectionné réduite à une seule ligne compacte, icônes courtes (Supprimer arrière-plan, Forme, Effets, Couleur, IA, Flip, Dupliquer, Supprimer) — TSL a déjà `#ctx-toolbar` + `#print-bar`, à auditer pour voir si le nombre d'actions visibles simultanément peut être réduit/regroupé.
- **Bandeau de réassurance en bas de page** (paiement sécurisé, garantie satisfaction, livraison) — confirme et renforce l'item 2 déjà en backlog.
- ~~Filtres visuels déterministes~~ → **corrigé par Alan (2026-09-29) : on a déjà l'équivalent avec Photo IA.** Pas une nouvelle feature — voir bug/fix ci-dessous (item 16).
- **Upsell après ajout au panier : validé par Alan (2026-09-29), « vraiment efficace ».** Voir item 17 ci-dessous, promu en tête du backlog P1.

### P1 — Validé par Alan, prêt à spécifier/coder
16. **[BUG/QUALITÉ] Généraliser le prompt Photo IA à n'importe quelle photo.** `routes/ai.js` `buildTransformPrompt()` (~l.243-293) construit un prompt qui impose systématiquement *« Preserve each person's likeness: face, glasses, beard, hairstyle and hair length, and smile/expression »*, quel que soit le style choisi ou le contenu de la photo. Si le client envoie une photo sans visage (animal, objet, logo, paysage), cette consigne peut dégrader le résultat. **Action :** rendre cette instruction conditionnelle (ou plus générique — « preserve the subject's key identifying features » plutôt que visage/barbe/coiffure) et tester sur un échantillon de photos non-portrait avant d'activer plus largement. C'est un correctif ciblé, pas un redesign du pipeline IA.
17. **Upsell post-ajout au panier** : après un ajout réussi depuis le studio, proposer 2-4 produits déjà liés (système `product-links` existant) avec le **même visuel uploadé pré-chargé**, en un clic vers leur studio respectif. **Différent de l'idée rejetée** « pack sur toute la gamme » : ici c'est un clic optionnel post-action, pas un design imposé sur toute la gamme au moment de la personnalisation.
    - **V1 lean proposée** (pas de rendu mockup serveur) : clic sur un produit suggéré → ouvre ce produit dans le studio avec le visuel déjà en bibliothèque de session, prêt à repositionner — pas d'ajout au panier instantané ni de mockup pré-rendu.
    - **V2 (plus tard, plus coûteuse)** : vignette mockup réellement rendue avec le design dessus + ajout au panier en un clic direct, nécessite un rendu serveur ou client du mockup alternatif.
    - À spécifier avant de coder : où le popup s'affiche (dans le drawer panier existant ou modal dédiée), quels produits proposer (tous les liés ? les plus vendus ?), comportement si le produit suggéré n'a pas de zone d'impression compatible avec le visuel actuel.

### P1bis — Bibliothèque d'images (issu de la veille du 2026-09-29, voir §3)
11. **Corriger la technique de rendu avant de rajouter du contenu.** L'échec des précédentes « compositions » vient très probablement du collage à plat (overlay simple) plutôt que d'un rendu qui épouse les plis du textile (displacement map). Un bug connu et déjà partiellement corrigé (`applyColorOverlay` écrasait les plis sur le noir pur, fix `#222222` plancher) touche le même mécanisme — à vérifier s'il affecte aussi les éléments sombres d'une composition uploadée, pas seulement le nuancier. Sans ce correctif, toute nouvelle image ajoutée à la bibliothèque rendra aussi mal que les précédentes.
12. **Curer une bibliothèque réduite mais réellement licenciée**, plutôt que des visuels Pinterest ⚠️ (droits d'auteur non vérifiés, risque juridique réel en cas de revente sur produit imprimé). Creative Fabrica (licence POD incluse dans l'abonnement) est mieux adapté que Vecteezy seul pour ce cas d'usage ; Vecteezy reste utile en complément mais son quota gratuit (500 téléchargements/mois) est une limite **partagée par toute la boutique**, pas par client — à ne pas brancher tel quel derrière un flux à fort trafic.
13. **Ne pas lancer un assistant IA "génère le visuel fini sur tout le catalogue sans reprise" maintenant** — voir recommandation détaillée §3. Piste plus modeste : étendre l'IA Photo→Style existante pour qu'elle propose automatiquement une mise en page/couleur cohérente avec les assets déjà en bibliothèque, sans generation from scratch.

### P2 — Dépend d'une décision d'Alan ou d'un audit plus long
14. Fonctionnalités manquantes vs configurateurs qui convertissent (hors bibliothèque, déjà couvert ci-dessus) — sujet de la Routine B (c), alimente ce backlog au fil de l'eau.
16bis. Popup de démarrage léger + barre d'outils contextuelle en une ligne (items 1-2 du comparatif Spreadshirt, §P1ter) — utile mais moins prioritaire que 16 et 17, à reprendre une fois ceux-ci livrés.
15. Vérifier si le plan WinShirt est Plus ou non (conditionne des options de tarification/Cart Transform) — point ouvert de longue date dans `LIAISON_CLAUDE_CODEX.md` §6.

### Hors périmètre (rappel)
- Trafic (SEO, réseaux sociaux, redirections vers `/password`) : mesuré mais traité **après** la validation de TSL, pas d'action ici.
- Jeu-concours Ducati : jamais utilisé comme argument.

---

## 3. Conclusions de veille (Routine B)

_Rien à date — cette section est remplie chaque jour à 12h par la Routine B (« Veille qui tranche »), qui ajoute une conclusion tranchée (oui/non/comment) sur l'une des trois questions en rotation (assistant IA, banque d'images, fonctionnalités manquantes), avec ses sources. Les conclusions alimentent la section 2._

| Date | Question | Conclusion | Sources |
|------|----------|------------|---------|
| 2026-09-29 | Bibliothèque d'images + assistant IA générateur de visuel (question (b)+(c) combinées, sur demande d'Alan) | **Ne pas construire un assistant "génère le visuel fini sur tout le catalogue sans reprise" maintenant** — en 2026 aucun outil du marché (Nano Banana 2/Pro, GPT Image 2, FashionMAC…) ne garantit la cohérence sur un catalogue entier sans retouches ; c'est un problème non résolu à l'échelle du secteur, pas une limite de TSL. **Prioriser d'abord la technique de rendu** (displacement map façon Dizzzign/Photoshop au lieu du collage à plat) — c'est la cause la plus probable de l'échec des « compositions » passées, indépendamment du nombre d'images. **Ensuite seulement**, curer une bibliothèque réduite et réellement licenciée POD (Creative Fabrica plutôt que des visuels Pinterest ⚠️ risque de droits) — les concurrents directs (Customily, Teeinblue) gagnent avec des bibliothèques de templates/cliparts curées, pas avec de la génération IA from-scratch. Revisiter l'assistant IA plein-catalogue dans 6-12 mois si la cohérence multi-image progresse (à surveiller : Nano Banana Pro, GPT Image 2). | [Kittl vs Placeit](https://blog.tshirt-factory.com/placeit-vs-kittl.html), [Creative Fabrica licence POD](https://www.creativefabrica.com/font-graphics-subscription-license/), [Vecteezy plans](https://www.vecteezy.com/), [Displacement map mockup (Medialoot)](https://medialoot.com/blog/how-to-create-a-photo-realistic-mockup/), [Dizzzign](https://dizzzign.com/), [Customily](https://www.customily.com/post/the-art-of-personalization-print-on-demand-simplified), [Consistance IA multi-catalogue (Creatsy)](https://creatsy.com/blog/1752128853-we-tested-every-ai-mockup-generator-in-2026-heres-what-actually-works-and-what-doesnt), [Coût génération image 2026 (Atlas Cloud)](https://www.atlascloud.ai/blog/guides/cheapest-ai-image-generation-api-2026), [Configurateurs et taux de conversion (Kickflip)](https://gokickflip.com/blog/ecommerce-product-configuration) |

---

## 4. Journal des routines

_Chaque passage des Routines A/B/C ajoute une ligne ici (date, routine, résumé, lien commit)._

| Date | Routine | Résumé | Commit |
|------|---------|--------|--------|
| 2026-09-29 | Bootstrap | Création de cette roadmap + exploration initiale du dépôt (dev). 3 routines proposées, en attente de validation d'Alan avant création effective (voir rapport de session). | *(ce commit)* |
