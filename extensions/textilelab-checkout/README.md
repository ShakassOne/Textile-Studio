# TextileLab — Checkout UI Extension

Cette extension Shopify Checkout UI ajoute après chaque ligne du panier sur la
page checkout :

- un bouton cliquable **« 👁 Voir mon design »** qui ouvre la page d'aperçu
  HD dans un nouvel onglet (lecture de la propriété `Voir mon design`),
- la miniature du design (lecture de la propriété `_preview_img`).

L'image native du variant Shopify reste affichée par le checkout (pas de
remplacement possible côté API), mais notre bloc complémentaire apparaît
juste en dessous de la ligne.

## Déploiement

L'extension est déclarée dans `shopify.app.toml` à la racine du projet (via le
mécanisme automatique de Shopify CLI : toute extension dans `extensions/` est
détectée). Pour la déployer :

```bash
cd ~/Downloads/TextileLab/textilelab-backend
npx @shopify/cli@latest app deploy
```

Ou en mode développement live :

```bash
npx @shopify/cli@latest app dev
```

La première fois, la commande demandera de se connecter au compte Partner et
de sélectionner l'app `Textile Studio Lab`.

## Activation par le marchand

Une fois l'extension déployée, le marchand l'active dans son admin Shopify :

```
Settings → Checkout → Customize → Add app block
```

Le bloc apparaît dans la liste sous le nom **« TextileLab — Aperçu design
checkout »**. Il peut être placé dans la section *Order summary*.

## Properties consommées

| Property                | Source                                | Usage                              |
|-------------------------|---------------------------------------|------------------------------------|
| `Voir mon design`       | `propsObj['Voir mon design']` du studio | URL HTTP du lien cliquable        |
| `_preview_img`          | `propsObj['_preview_img']` du studio    | URL CDN de la miniature           |

Si aucune des deux n'est présente sur la ligne, l'extension ne rend rien
(ligne classique sans personnalisation TextileLab).

## Limitations

- Shopify ne permet **pas** de remplacer l'image native du variant dans le
  checkout (verrouillage Checkout Extensibility). On affiche donc la
  miniature en bloc complémentaire.
- L'extension fonctionne uniquement avec **Checkout Extensibility**
  (boutiques avec `checkout.liquid` ne sont pas supportées par les UI
  Extensions). Cela couvre toutes les nouvelles boutiques Shopify créées
  après 2024 et toutes les boutiques Shopify Plus migrées.
