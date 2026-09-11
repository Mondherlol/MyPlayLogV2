// Le logo d'une boutique, en SVG monochrome (il hérite de `currentColor`).
// Les tracés vivent dans lib/storeIcons.js, partagés avec la rangée de choix.

import { STORES } from "../lib/storeIcons";

export default function StoreIcon({ store, size = 14, ...props }) {
  const brand = STORES[store];
  if (!brand) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox={brand.viewBox}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d={brand.d} />
    </svg>
  );
}
