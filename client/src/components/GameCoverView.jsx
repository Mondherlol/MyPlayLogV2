import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ImageOff, ImagePlus, X } from "lucide-react";
import { useScrollLock } from "../hooks/useScrollLock";
import { useBackClose } from "../hooks/useBackClose";
import { coverAtSize } from "../lib/gameCover";

// ======================================================================
//  La jaquette, en grand
// ======================================================================
// ⚠️ CLIQUER UNE IMAGE VEUT DIRE « MONTRE-LA-MOI », PAS « REMPLACE-LA ». La
// fiche ouvrait le sélecteur de jaquettes au premier clic : le geste le plus
// naturel de la page déclenchait son action la plus destructrice, et on ne
// pouvait simplement REGARDER la jaquette d'un jeu — ce pour quoi on est venu.
// Ce clic ouvre donc cette vue ; changer la jaquette reste à un geste, mais un
// geste qu'on choisit (le bandeau « Modifier », ou le clic droit sur la fiche).
//
// L'image est demandée à la plus grande taille qu'IGDB serve (cf. coverAtSize)
// et bornée à la hauteur de l'écran : une jaquette 3/4 y tient entière, sans
// défilement et sans jamais dépasser sa taille native.
export default function GameCoverView({ cover, name, onEdit, onClose }) {
  useScrollLock();
  useBackClose(onClose, "gameCoverView");

  // Échap ferme, comme partout ailleurs dans l'app.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="gcv" onMouseDown={onClose} role="presentation">
      <button className="gcv-x clickable" onClick={onClose} aria-label="Fermer">
        <X size={18} />
      </button>

      <figure className="gcv-stage" onMouseDown={(e) => e.stopPropagation()}>
        {cover ? (
          <img src={coverAtSize(cover, "t_1080p")} alt={name} draggable="false" />
        ) : (
          <div className="gcv-empty">
            <ImageOff size={40} />
            <span>Pas de jaquette</span>
          </div>
        )}
        <figcaption className="gcv-foot">
          <span className="gcv-name">{name}</span>
          <button className="gcv-edit clickable" onClick={onEdit}>
            <ImagePlus size={15} /> Modifier la jaquette
          </button>
        </figcaption>
      </figure>
    </div>,
    document.body
  );
}
