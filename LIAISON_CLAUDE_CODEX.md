# 🔗 Fichier de liaison — Claude ↔ Codex

> **But :** Alan travaille en binôme avec deux assistants (Claude/Cowork et Codex/ChatGPT)
> et ne peut pas faire une session toutes les 4 h. Ce fichier est la **mémoire partagée**
> du projet TextileLab. Il est dans le repo et **doit être mis à jour à chaque push**
> par celui qui pousse (Claude ou Codex).

**Dernière mise à jour :** 2026-06-15 — par **Claude** (redesign studio)
**Branche :** `main` · **Dernier commit poussé connu :** `5f260c8`

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

## 3. État courant (vérifié dans le code au 2026-06-15)

**Ce qui marche (vérifié) :**
- Install OAuth + token exchange multi-marchand ; admin embed par session token.
- Storefront : bouton « Personnaliser » (app block) → studio en **modal** → ajout au panier → **aperçu du design dans le drawer** (général, tous thèmes). ✅ confirmé par Alan.
- Migration du contenu dev → WinShirt (bibliothèque, mockups, catégories, styles IA, QR).
- Studio : resize manuel == bouton format (échelle mm↔px unifiée).

**Ce qui est CASSÉ ou douteux (à traiter) :**
- 🔴 **Tarification surcharge** : approche « ligne Frais d'impression 0,50 € × N » jugée *marchand de tapis* par Alan → **à remplacer** (voir `PROPOSITION_TARIFICATION.md` et §6).
- 🔴 **Cumul des faces** : le surcoût ne somme pas recto + verso ; il prend la **dernière face visible** (recto seul → +4, verso seul → +2, jamais +6). Cause probable : recto/verso = **mockups séparés**, pas des `views` d'un même mockup → `_computeSurcharge()` ne scanne qu'une face. **À confirmer dans l'audit avant de recoder.**
- 🟠 **Surcharge multi-éléments même face** : 3 visuels A4 sur une face = 1 surcharge (par design). Règle exacte à confirmer avec Alan (format de la face = manuel ? = plus grand élément ? = bounding box ?).
- 🟠 Scope `write_products` ajouté à `winshirt.toml` mais **re-consentement non confirmé** → la création auto du produit de frais peut échouer (needs_setup).

---

## 4. Tâches (backlog partagé)

> Statuts : ⬜ à faire · 🔄 en cours · ✅ fait · ⏸ en attente d'Alan
> « Owner » = qui s'en occupe (Claude / Codex / Alan).

| # | Tâche | Owner | Statut |
|---|-------|-------|--------|
| T1 | Reconstruire + faire VALIDER le CDC (`CDC_TEXTILELAB.md`) | Claude | 🔄 (rédigé, à valider par Alan) |
| T2 | Audit profond vs CDC (`AUDIT_TSL_2026-06-15.md`) | Claude | 🔄 (1ʳᵉ passe) |
| T3 | Analyse fonction par fonction (`ANALYSE_FONCTIONS.md`) | Claude+Codex | 🔄 (backend fait, studio à finir) |
| T4 | Choisir l'approche tarifaire (`PROPOSITION_TARIFICATION.md`) | Alan décide | ⏸ |
| T5 | Corriger le cumul recto+verso (après T4 + audit) | — | ⬜ |
| T6 | Confirmer le plan WinShirt (Plus ou non) + re-consent write_products | Alan | ⬜ |

---

## 5. Verrous fichiers (qui édite quoi maintenant)

| Fichier | Pris par | Depuis |
|---------|----------|--------|
| _(aucun)_ | — | — |

---

## 6. Décisions & points ouverts

- **DÉCIDÉ (2026-06-15) :** stop au codage tant que CDC + audit + analyse fonctions ne sont pas posés (demande d'Alan).
- **OUVERT — tarification :** la ligne « Frais d'impression » est rejetée. Voir 3 options dans `PROPOSITION_TARIFICATION.md`. **Alan doit trancher.** Recommandation Claude : produit « Personnalisation » à variantes par paliers (1 ligne propre, prix exact).
- **OUVERT — plan WinShirt :** Plus ou non ? Détermine si on peut un jour fondre la surcharge dans la ligne produit (Cart Transform = Plus only).
- **OUVERT — CDC :** Alan doit confirmer/corriger `CDC_TEXTILELAB.md` (reconstruit de mémoire, pas le document d'origine).

---

## 7. Comment mettre à jour ce fichier (rappel)

À chaque push :
1. Ajouter une ligne en haut de `## 1. Journal des push`.
2. Mettre à jour `## 3. État courant` si un comportement a changé.
3. Mettre à jour `## 4. Tâches` (statuts) et `## 5. Verrous` (libérer).
4. Changer l'en-tête (date + auteur + dernier commit).
