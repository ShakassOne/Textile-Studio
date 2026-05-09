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
  Text,
  View,
  useCartLineTarget,
} from '@shopify/ui-extensions-react/checkout';

export default reactExtension(
  'purchase.checkout.cart-line-item.render-after',
  () => <LineItemDesignPreview />,
);

function LineItemDesignPreview() {
  const cartLine = useCartLineTarget();
  const attributes = (cartLine && cartLine.attributes) || [];

  const findAttr = (keys) => {
    const lcKeys = keys.map((k) => k.toLowerCase());
    const found = attributes.find(
      (a) => lcKeys.includes((a.key || '').toLowerCase()),
    );
    return found ? found.value : null;
  };

  const designUrl = findAttr(['_voir_mon_design', 'voir_mon_design', 'voir mon design']);
  const previewImg = findAttr(['_preview_img', '_design_preview', 'preview_img']);

  if (!designUrl && !previewImg) return null;

  const isHttp = (s) =>
    typeof s === 'string' && /^https?:\/\//i.test(s.trim());

  return (
    <BlockStack spacing="base" padding={['base', 'none', 'none', 'none']}>
      <InlineStack spacing="base" blockAlignment="center">
        {isHttp(previewImg) ? (
          <View
            border="base"
            cornerRadius="large"
            padding="extraTight"
            background="subdued"
            inlineSize={140}
            blockSize={140}
          >
            <Image
              source={previewImg}
              accessibilityDescription="Aperçu de votre design personnalisé"
              aspectRatio={1}
              fit="contain"
              cornerRadius="base"
            />
          </View>
        ) : null}

        {isHttp(designUrl) ? (
          <BlockStack spacing="extraTight">
            <Text size="small" appearance="subdued">
              Personnalisation appliquée
            </Text>
            <Link to={designUrl} external>
              <View
                padding={['base', 'loose']}
                background="accent"
                cornerRadius="large"
                border="base"
              >
                <Text size="medium" emphasis="bold" appearance="accent">
                  👁 Voir mon design (recto / verso)
                </Text>
              </View>
            </Link>
          </BlockStack>
        ) : null}
      </InlineStack>
    </BlockStack>
  );
}
