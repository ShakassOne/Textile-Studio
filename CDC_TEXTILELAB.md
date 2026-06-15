# 📋 Cahier des charges — TextileLab Studio (reconstruit)

> ⚠️ **À VALIDER PAR ALAN.** Le CDC d'origine n'est pas dans le repo. Ce document est
> **reconstruit** à partir de la mémoire projet et du comportement attendu observé.
> Alan doit **confirmer, corriger ou compléter** chaque point. Tant que ce n'est pas validé,
> l'audit s'appuie sur cette version « best effort ».

---

## 1. Nature du produit

- **App Shopify PUBLIQUE multi-marchands**, destinée à l'**App Store**.
- Modèle économique : **abonnement** — essai **15 jours** puis **~19 €/mois** (à confirmer).
- Parcours de mise sur le marché : installée d'abord sur la vraie boutique d'Alan **WinShirt**,
  puis **soumise à Shopify** pour validation et distribution payante.
- En parallèle, une **app Custom** (même code) tourne déjà sur WinShirt sans attendre la review.

## 2. Multi-tenant (non négociable)

- Chaque marchand gère **ses** données (mockups, bibliothèque, designs, styles IA, QR, réglages).
- Authentification marchand = **session token Shopify** de SA boutique (pas un mot de passe admin global).
- Isolation stricte par `shop_id` partout (DB scopée).
- Le **billing** utilise le token de **chaque** boutique.

## 3. Fonctionnalités studio (personnalisation)

À confirmer/préciser par Alan — proposition de liste :
- Canvas de personnalisation (Fabric.js) avec **mockups** par produit (T-Shirt, Sweat, Casquette, Tote Bag…).
- **Faces** multiples (recto/verso, voire +).
- Outils : **Texte** (polices, déformations, contour, ombre), **Image** (upload + bibliothèque), **Couleur** textile, **IA** (génération/transformation), **QR code** habillé.
- **Formats d'impression** A3/A4/A5/A6 avec **zone d'impression** par face, configurable par l'admin (printWidthMm).
- **Vue 2D et 3D** (model-viewer).
- Génération de **fichiers d'impression HD (DTF)** + **aperçus** mockup recto/verso.

## 4. Tarification (point chaud — voir PROPOSITION_TARIFICATION.md)

- Prix = **prix du produit Shopify** + **surcharge par face** selon le **format** de la face.
- **Cumul** entre faces (recto petit + verso grand = somme).
- Plusieurs éléments sur une même face = **une seule** surcharge (règle exacte à confirmer).
- Surcharges par format **réglables par marchand**.
- **Contrainte technique :** sans Shopify Plus, la surcharge passe par une variante achetable
  (pas de modification du prix de ligne au checkout). Présentation à rendre propre.

## 5. Storefront (côté client)

- Bouton **« Personnaliser »** sur la fiche produit (app block de thème), pour **n'importe quel marchand**.
- Studio ouvert en **modal** (overlay), pas en pleine page.
- Ajout au panier avec **aperçu du design** dans le drawer, **sur tous les thèmes**.
- Les propriétés techniques (design, format…) **masquées** côté client mais lisibles par le marchand (admin/commande).

## 6. Back-office marchand (admin embed)

- Dashboard, Designs, Catégories mockups, Mockups & Zones, Bibliothèque, Produits & Mockups
  (liaison produit Shopify ↔ mockup + surcharges), Styles IA, Créations IA, Frames QR, Paramètres.
- Liaison **produit Shopify → mockup** pour afficher le bon visuel.

## 7. Commandes & production

- À la commande : génération/stockage du **fichier d'impression HD** par face.
- E-mails (confirmation, expédition) — snippet Liquid fourni par Alan, **à ne pas réécrire**.
- Webhooks **GDPR** (customers/data_request, customers/redact, shop/redact) + **app/uninstalled**.

## 8. Conformité review Shopify (bloquants connus)

- Page embed **non blanche** à l'install à froid (policy 2.1.1) — déjà corrigé, à re-vérifier.
- App Bridge chargé statiquement, token exchange (Managed Installation).
- Scopes **minimaux et justifiés** (actuellement `read_orders, read_products` ; `write_products`
  ajouté côté Custom pour le produit de personnalisation — à justifier pour la version publique).
- Webhooks GDPR obligatoires présents et signés.

---

## ✍️ À remplir par Alan

- [ ] Prix de l'abonnement / durée d'essai exacts : ______
- [ ] Liste produits supportés au lancement : ______
- [ ] Règle exacte « format d'une face avec plusieurs éléments » (manuel / plus grand / englobant) : ______
- [ ] Fonctionnalités « must-have » vs « plus tard » pour la 1ʳᵉ soumission : ______
- [ ] Autre point du CDC d'origine que j'aurais oublié : ______
