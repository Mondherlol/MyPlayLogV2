import { useId } from "react";

// ======================================================================
//  Les drapeaux
// ======================================================================
// De VRAIS drapeaux, dessinés en SVG. Ils étaient faits de dégradés CSS : le
// tricolore passait encore, mais « English » n'était qu'un rectangle bleu uni —
// le drapeau d'aucun pays. Un carré de couleur ne se reconnaît pas ; un drapeau,
// si, et c'est tout ce qu'on lui demande dans un sélecteur de langue.
//
// ⚠️ SVG PLUTÔT QU'ÉMOJI. 🇬🇧 ne s'affiche pas sous Windows (le système ne
// fournit pas les drapeaux régionaux) : on y verrait « GB » en petites lettres.
// Dessiné, c'est le même rendu partout.
//
// Les proportions sont celles des vrais pavillons (3:2 pour la France, 2:1 pour
// le Royaume-Uni), mais la boîte affichée est commune (`.flag`) pour que les
// deux lignes du menu s'alignent.

export function FlagFR({ size = 18, className = "" }) {
  return (
    <svg
      className={`flag flag-svg ${className}`}
      width={size}
      height={size * (2 / 3)}
      viewBox="0 0 9 6"
      role="img"
      aria-label="Français"
    >
      <rect width="3" height="6" x="0" fill="#002654" />
      <rect width="3" height="6" x="3" fill="#ffffff" />
      <rect width="3" height="6" x="6" fill="#ce1126" />
    </svg>
  );
}

/**
 * L'Union Jack, à la construction officielle : le champ bleu, le sautoir blanc
 * de saint André, la contre-écharpe rouge de saint Patrick (décalée — c'est ce
 * décalage qui distingue un vrai drapeau britannique d'une croix approximative),
 * puis la croix de saint Georges par-dessus.
 */
export function FlagEN({ size = 18, className = "" }) {
  // Deux menus ouverts dans la même page partageraient sinon le même `id` de
  // masque, et le second drapeau perdrait ses diagonales rouges.
  const clip = `uj-${useId()}`;
  return (
    <svg
      className={`flag flag-svg ${className}`}
      width={size}
      height={size / 2}
      viewBox="0 0 60 30"
      role="img"
      aria-label="English"
    >
      <clipPath id={clip}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#ffffff" strokeWidth="6" />
      <path
        d="M0,0 L60,30 M60,0 L0,30"
        clipPath={`url(#${clip})`}
        stroke="#c8102e"
        strokeWidth="4"
      />
      <path d="M30,0 v30 M0,15 h60" stroke="#ffffff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
    </svg>
  );
}
