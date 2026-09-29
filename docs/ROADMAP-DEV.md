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

### P2 — Dépend d'une décision d'Alan ou d'un audit plus long
7. Choix de banque(s) d'images pour la bibliothèque studio (Vecteezy seul vs multi-sources) — sujet de la Routine B (b).
8. Fonctionnalités manquantes vs configurateurs qui convertissent — sujet de la Routine B (c), alimente ce backlog au fil de l'eau.
9. Version minimale d'un assistant IA WinShirt utile (pas un chatbot gadget) — sujet de la Routine B (a), à ne proposer que si la preuve d'impact est solide.
10. Vérifier si le plan WinShirt est Plus ou non (conditionne des options de tarification/Cart Transform) — point ouvert de longue date dans `LIAISON_CLAUDE_CODEX.md` §6.

### Hors périmètre (rappel)
- Trafic (SEO, réseaux sociaux, redirections vers `/password`) : mesuré mais traité **après** la validation de TSL, pas d'action ici.
- Jeu-concours Ducati : jamais utilisé comme argument.

---

## 3. Conclusions de veille (Routine B)

_Rien à date — cette section est remplie chaque jour à 12h par la Routine B (« Veille qui tranche »), qui ajoute une conclusion tranchée (oui/non/comment) sur l'une des trois questions en rotation (assistant IA, banque d'images, fonctionnalités manquantes), avec ses sources. Les conclusions alimentent la section 2._

| Date | Question | Conclusion | Sources |
|------|----------|------------|---------|
| — | — | — | — |

---

## 4. Journal des routines

_Chaque passage des Routines A/B/C ajoute une ligne ici (date, routine, résumé, lien commit)._

| Date | Routine | Résumé | Commit |
|------|---------|--------|--------|
| 2026-09-29 | Bootstrap | Création de cette roadmap + exploration initiale du dépôt (dev). 3 routines proposées, en attente de validation d'Alan avant création effective (voir rapport de session). | *(ce commit)* |
