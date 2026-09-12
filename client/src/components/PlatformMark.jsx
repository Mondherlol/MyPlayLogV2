import { Gamepad2 } from "lucide-react";
import { platformBrand } from "../lib/platformIcons";

/**
 * Le logo d'une plateforme ou d'une marque, à la taille qu'on lui donne.
 *
 * Port web de myplaylog-mobile/src/components/game/PlatformIcon.jsx — les
 * tracés viennent du même fichier (`lib/platformIcons.js`, copié à l'identique),
 * pour qu'un rendez-vous Xbox porte le MÊME logo sur le site et sur le
 * téléphone.
 *
 * ⚠️ C'EST LUI QUI MANQUAIT AUX CARTES D'ÉVÉNEMENT. Un Direct sans affiche
 * (le « Xbox Tokyo Game Show Broadcast », par exemple : ni image ni logo en
 * base, seulement `brand: "xbox"`) affichait sur le site une icône de télé
 * générique, là où l'app dessinait le logo Xbox sur le dégradé vert. Même
 * donnée, deux rendus : sur le site, on croyait l'image cassée.
 *
 * Monochrome et teinté par `color`. LARGEUR CALCULÉE, PAS FIXÉE : certains
 * tracés sont des carrés (PlayStation, Xbox), d'autres des mots (Sega,
 * Nintendo) — on garde la hauteur et la largeur suit les proportions.
 *
 * Marque inconnue : une manette générique. Un symbole neutre vaut mieux qu'un
 * logo faux.
 */
export default function PlatformMark({ name, abbr, size = 13, color = "currentColor", className = "" }) {
  const brand = platformBrand(name, abbr);
  if (!brand) {
    return <Gamepad2 size={size} color={color} strokeWidth={2} className={className} aria-hidden="true" />;
  }

  const [, , w, h] = brand.viewBox.split(" ").map(Number);
  const ratio = w && h ? w / h : 1;

  return (
    <svg
      className={className}
      width={Math.round(size * ratio)}
      height={size}
      viewBox={brand.viewBox}
      aria-hidden="true"
    >
      <path d={brand.d} fill={color} />
    </svg>
  );
}
