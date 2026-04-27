/**
 * Checkout UI Extension — TextileLab
 * ──────────────────────────────────────────────────────────────────────────
 * Cible : purchase.checkout.cart-line-item.render-after
 *   Cette extension s'insère APRÈS le rendu natif de chaque ligne de panier
 *   sur la page checkout. Pour chaque ligne personnalisée :
 *
 *     1. Si la propriété "_preview_img" contient une URL https://, on
 *        affiche la miniature du design (64×64) — le client voit son visuel.
 *     2. Si la propriété "_voir_mon_design" contient une URL https://, on
 *        affiche un bouton cliquable "👁 Voir mon design" qui ouvre l'URL
 *        dans un nouvel onglet.
 *
 * Pourquoi "_voir_mon_design" et non "Voir mon design" ?
 *   Shopify affiche nativement toutes les line item properties NON préfixées
 *   par '_' sous forme de texte brut dans le checkout. En préfixant avec '_',
 *   Shopify masque la propriété de son rendu natif — l'extension prend la main
 *   et affiche un lien cliquable à la place.
 *
 * Limitation Shopify : on ne peut pas REMPLACER l'image native du variant
 * affichée par le checkout (le rendu de la ligne native est verrouillé).
 * On ajoute donc un bloc complémentaire APRÈS la ligne pour afficher le
 * visuel du design + le lien.
 */

import {
  reactExtension,
  BlockStack,
  InlineStack,
  Image,
  Link,
  Button,
  Text,
  useCartLineTarget,
} from '@shopify/ui-extensions-react/checkout';

export default reactExtension(
  'purchase.checkout.cart-line-item.render-after',
  () => <LineItemDesignPreview />,
);

function LineItemDesignPreview() {
  // useCartLineTarget retourne la cart-line spécifique en cours de rendu,
  // avec ses attributes (line item properties).
  const cartLine = useCartLineTarget();
  const attributes = (cartLine && cartLine.attributes) || [];

  // Recherche une property par clé (case-insensitive)
  const findAttr = (keys) => {
    const lcKeys = keys.map((k) => k.toLowerCase());
    const found = attributes.find(
      (a) => lcKeys.includes((a.key || '').toLowerCase()),
    );
    return found ? found.value : null;
  };

  const designUrl = findAttr(['_voir_mon_design']);
  const previewImg = findAttr(['_preview_img', '_design_preview']);

  // Pas de propriété design → ne rien rendre (ligne classique sans personnalisation)
  if (!designUrl && !previewImg) return null;

  const isHttp = (s) =>
    typeof s === 'string' && /^https?:\/\//i.test(s.trim());

  return (
    <BlockStack spacing="tight" padding={['tight', 'none', 'none', 'none']}>
      <InlineStack spacing="base" blockAlignment="center">

        {/* Miniature du design personnalisé */}
        {isHttp(previewImg) ? (
          <Image
            source={previewImg}
            accessibilityDescription="Aperçu du design personnalisé"
            aspectRatio={1}
            fit="contain"
            cornerRadius="base"
          />
        ) : null}

        {/* Lien cliquable — remplace l'URL brute qui s'affichait nativement */}
        {isHttp(designUrl) ? (
          <Link to={designUrl} external>
            <Text size="small" emphasis="bold">
              👁 Voir mon design
            </Text>
          </Link>
        ) : null}

      </InlineStack>
    </BlockStack>
  );
}
