import { Globe } from "lucide-react";
import StoreIcon from "./StoreIcon";
import DiscordIcon from "./DiscordIcon";
import { STORES } from "../lib/storeIcons";
import { SITE_BRANDS } from "../lib/siteIcons";

// ======================================================================
//  Le logo d'un lien de la fiche de jeu
// ======================================================================
// Les liens d'IGDB arrivent sous forme de catégories (`steam`, `official`,
// `reddit`…). Une rangée d'étiquettes en toutes lettres se LIT ; une rangée de
// logos se RECONNAÎT — et c'est bien tout ce qu'on demande à « Steam ».
//
// Trois réservoirs de tracés, tous monochromes et teintés par `currentColor` :
// les boutiques (lib/storeIcons), les sites que lucide v1 ne dessine plus
// (lib/siteIcons) et Discord, qui avait déjà son composant. Le site officiel
// d'un jeu n'a par définition pas de logo commun : une planète, et c'est juste.
export default function GameSiteIcon({ kind, size = 17 }) {
  if (STORES[kind]) return <StoreIcon store={kind} size={size} />;
  if (kind === "discord") return <DiscordIcon size={size} />;

  const brand = SITE_BRANDS[kind];
  if (brand) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={brand.viewBox}
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={brand.d} />
      </svg>
    );
  }

  return <Globe size={size} />;
}
