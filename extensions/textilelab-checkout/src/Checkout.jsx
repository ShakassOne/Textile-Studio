/**
 * Checkout UI Extension — TextileLab
 * ──────────────────────────────────────────────────────────────────────────
 * Cible : purchase.checkout.cart-line-item.render-after
 *   Cette extension s'insère APRÈS le rendu natif de chaque ligne de panier
 *   sur la page checkout. Pour chaque ligne :
 *
 *     1. Si la propriété "Voir mon design" contient une URL https://, on
 *        affiche un bouton cliquable "👁  Voir mon design" qui ouvre l'URL
 *        dans un nouvel onglet (target externe).
 *     2. Si la propriété "_preview_img" contient une URL d'image, on affiche
 *        la miniature à côté du lien (image carrée 64×64, fond blanc).
 *     3. Les autres propriétés préfixées '_' restent masquées par Shopify
 *        natif (convention).
 *
 * Limitation Shopify : on ne peut pas REMPLACER l'image native du variant
 * affichée par le checkout (le rendu de la ligne natale est verrouillé).
 * On ajoute donc un bloc complémentaire APRÈS la ligne pour afficher la
 * miniature custom + le lien.
 */

import {
  reactExtension,
  BlockStack,
  InlineStack,
  Image,
  Link,
  Text,
  useTarget,
} from '@shopify/ui-extensions-react/checkout';

export default reactExtension(
  'purchase.checkout.cart-line-item.render-after',
  () => <LineItemDesignPreview />,
);

function LineItemDesignPreview() {
  // useTarget() retourne la cart-line en cours de rendu
  const cartLine = useTarget();
  const attributes = cartLine?.attributes || [];

  // Recherche les properties pertinentes (case-insensitive sur la clé)
  const findAttr = (keys) => {
    const lcKeys = keys.map((k) => k.toLowerCase());
    return attributes.find((a) => lcKeys.includes((a.key || '').toLowerCase()))
      ?.value;
  };

  const designUrl = findAttr(['Voir mon design', 'voir_mon_design']);
  const previewImg = findAttr(['_preview_img', '_design_preview']);

  // Pas de propriété design → ne rien rendre (ligne classique sans personnalisation)
  if (!designUrl && !previewImg) return null;

  const isHttp = (s) =>
    typeof s === 'string' && /^https?:\/\//i.test(s.trim());

  return (
    <BlockStack spacing="tight" padding={['tight', 'none', 'none', 'none']}>
      <InlineStack spacing="tight" blockAlignment="center">
        {/*
          Miniature design — fallback gracieux si previewImg absent ou cassé.
          accessibilityDescription pour les lecteurs d'écran.
        */}
        {isHttp(previewImg) && (
          <Image
            source={previewImg}
            accessibilityDescription="Aperçu du design personnalisé"
            aspectRatio={1}
            fit="contain"
            cornerRadius="base"
          />
        )}

        {/*
          Lien "Voir mon design" — cliquable, ouvre dans un nouvel onglet via
          le composant Link officiel Shopify (gère target="_blank" en interne
          quand `external` est true).
        */}
        {isHttp(designUrl) && (
          <Link to={designUrl} external>
            <Text size="small" emphasis="bold">
              👁 Voir mon design
            </Text>
          </Link>
        )}
      </InlineStack>
    </BlockStack>
  );
}
