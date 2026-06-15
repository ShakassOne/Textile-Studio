# 💶 Proposition — facturer produit + surcharge proprement

> Rédigé le 2026-06-15 par Claude. **Aucune ligne de code écrite.** Document de décision.
> Objectif : tarifer `prix produit + surcharge par face`, cumulé, **sans effet « marchand de tapis »**.

---

## 1. Le problème, clairement

Le panier Shopify facture **le prix de la variante** d'un produit. On ne peut pas, côté app,
« ajouter X € » au prix d'une ligne au moment du checkout… **sauf sur Shopify Plus**
(fonction *Cart Transform* avec opération `lineUpdate` — réservée à Plus/dev stores).

WinShirt étant *a priori* **non-Plus**, il faut que la surcharge passe par **une vraie variante
achetable**. D'où la « ligne en plus » dans le panier. La question n'est donc pas *si* on a une
ligne, mais **comment la rendre propre** (et pas « Frais d'impression × 6 à 0,50 € »).

### Deux défauts de la version actuelle (commit `5d6e53b`)
1. **Présentation** : ligne « Frais d'impression » à 0,50 € avec une **quantité bizarre** (×6, ×8…). Effet bazar.
2. **Bug de cumul** : le calcul ne **somme pas** recto + verso, il prend la **dernière face visible**
   (recto A3 → +4, verso A5 → +2, jamais +6). À corriger quel que soit l'approche retenue.

---

## 2. Options (de la plus simple à la plus lourde)

### ✅ Option A — Produit « Personnalisation » à variantes par paliers *(recommandée)*
Un **seul produit caché** « Personnalisation TextileLab » avec **une variante par montant**
de surcoût total, par paliers de 0,50 € : `1,50 € / 2 € / 2,50 € / 3 € / … / 8 €` (≈ 14–20 variantes,
créées **une fois** automatiquement).
Le studio calcule le **total** (somme des faces) et ajoute **UNE seule ligne, quantité 1**,
à la variante qui correspond au montant, libellée par ex. **« Personnalisation — recto A3 + verso A5 »**.

- **Panier :** `T-Shirt 29 €` + `Personnalisation 6,00 €` = **35 €**. Deux lignes, mais la 2ᵉ est
  propre : montant exact, quantité 1, nom clair. Rien de louche.
- **Avantages :** simple, robuste, **tous plans**, prix exact, pas de quantité absurde, général
  (auto-créé chez chaque marchand via `write_products`).
- **Limite :** ça reste 2 lignes au checkout natif. Acceptable et honnête (le client voit ce qu'il paie).
- **Effort :** faible. On réutilise 90 % du code déjà écrit (on change juste : créer N variantes au lieu d'1, et choisir la variante = montant au lieu de quantité × 0,50).

### 🟡 Option B — Tout fondu dans la ligne produit *(si WinShirt passe Plus un jour)*
Fonction **Cart Transform `lineUpdate`** : la surcharge est intégrée au prix du T-Shirt,
**une seule ligne**, invisible pour le client.
- **Avantages :** le plus élégant, zéro ligne en plus.
- **Bloquant :** **Shopify Plus uniquement.** Inutilisable sur WinShirt non-Plus et chez la
  majorité des marchands App Store. → à garder comme **évolution** activée automatiquement
  *si* la boutique est Plus (détection `shop.plan.shopifyPlus`).

### 🟡 Option C — Draft Order au prix exact
L'app crée une **commande brouillon** avec une ligne « custom » au prix `produit + surcharge`
et redirige le client vers l'invoice.
- **Avantages :** une ligne, prix exact, nom propre, tous plans.
- **Inconvénients :** **change le flux** (on quitte le panier natif), le client ne peut pas mixer
  facilement avec d'autres articles, nécessite le scope sensible `write_draft_orders`,
  et complique les apps de paiement (Shop Pay/PayPal du thème). Lourd pour du B2C. ❌ pour l'instant.

### ❌ Option D — Variantes Taille × Format sur chaque produit
Explosion combinatoire (tailles × formats × faces), ingérable et non général. Écartée.

---

## 3. Recommandation

> **Option A maintenant** (variantes par paliers = une ligne « Personnalisation » propre),
> **+ Option B en automatique plus tard** *si* la boutique est Plus.

Ça donne tout de suite un panier honnête et lisible, ça marche chez tout marchand non-Plus,
et ça laisse la porte ouverte au « 100 % fondu » pour les boutiques Plus sans refonte.

---

## 4. Règles de surcharge à **confirmer par Alan** (avant de recoder)

Le calcul a besoin de règles non ambiguës. Voici ce que je propose — **dis-moi si c'est ça** :

1. **Une face avec du contenu = une surcharge**, égale au **format de cette face**.
2. **Cumul entre faces** : recto + verso = surcharge(recto) + surcharge(verso). *(c'est le bug actuel à corriger)*
3. **Plusieurs éléments sur une même face** (3 logos, ou texte + image + IA) = **une seule surcharge**.
   → Reste à définir **le format de cette face** quand il y a plusieurs éléments :
   - (a) le format choisi manuellement pour la face *(comportement actuel)*, ou
   - (b) le **plus grand format** parmi les éléments, ou
   - (c) le format du **rectangle englobant** tous les éléments (le plus « juste » techniquement).
   **Ma reco : (c)** — on facture selon la taille réellement imprimée. Mais (a) est le plus simple.
4. **Pas de contenu = pas de surcharge** (prix produit seul).

---

## 5. Ce qui ne change pas

- Le **prix affiché dans le studio** (badge) doit refléter exactement la même règle que le panier.
- Les **surcharges par format** restent réglables par marchand (admin → « Surcharges d'impression »),
  désormais **persistées par boutique** (fait, commit `5d6e53b`).
- L'**aperçu du design** dans le drawer (déjà OK) est indépendant de tout ça.

---

## 6. Prochaine étape (après ta validation, pas avant)

1. Tu choisis l'option (A recommandée) et tu confirmes les règles du §4.
2. On corrige d'abord le **bug de cumul des faces** (audit → cause exacte).
3. On bascule la facturation sur l'option choisie.
4. Test de bout en bout : 1 face / 2 faces / multi-éléments, badge studio == panier == total.
