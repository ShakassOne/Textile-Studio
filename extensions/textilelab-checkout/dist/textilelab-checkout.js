// src/Checkout.jsx
import {
  reactExtension,
  BlockStack,
  InlineStack,
  Image,
  Link,
  Button,
  Text,
  useCartLineTarget
} from "@shopify/ui-extensions-react/checkout";
import { jsx, jsxs } from "react/jsx-runtime";
var Checkout_default = reactExtension(
  "purchase.checkout.cart-line-item.render-after",
  () => /* @__PURE__ */ jsx(LineItemDesignPreview, {})
);
function LineItemDesignPreview() {
  const cartLine = useCartLineTarget();
  const attributes = cartLine && cartLine.attributes || [];
  const findAttr = (keys) => {
    const lcKeys = keys.map((k) => k.toLowerCase());
    const found = attributes.find(
      (a) => lcKeys.includes((a.key || "").toLowerCase())
    );
    return found ? found.value : null;
  };
  const designUrl = findAttr(["_voir_mon_design"]);
  const previewImg = findAttr(["_preview_img", "_design_preview"]);
  if (!designUrl && !previewImg) return null;
  const isHttp = (s) => typeof s === "string" && /^https?:\/\//i.test(s.trim());
  return /* @__PURE__ */ jsx(BlockStack, { spacing: "tight", padding: ["tight", "none", "none", "none"], children: /* @__PURE__ */ jsxs(InlineStack, { spacing: "base", blockAlignment: "center", children: [
    isHttp(previewImg) ? /* @__PURE__ */ jsx(
      Image,
      {
        source: previewImg,
        accessibilityDescription: "Aper\xE7u du design personnalis\xE9",
        aspectRatio: 1,
        fit: "contain",
        cornerRadius: "base"
      }
    ) : null,
    isHttp(designUrl) ? /* @__PURE__ */ jsx(Link, { to: designUrl, external: true, children: /* @__PURE__ */ jsx(Text, { size: "small", emphasis: "bold", children: "\u{1F441} Voir mon design" }) }) : null
  ] }) });
}
export {
  Checkout_default as default
};
//# sourceMappingURL=textilelab-checkout.js.map
