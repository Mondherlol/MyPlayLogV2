import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X } from "lucide-react";

// Visionneuse des captures d'une manche de Pixel Rush : l'image en grand, les
// autres en pellicule dessous (flèches et Échap au clavier).
//
// Ouverte depuis le récap de fin de partie ET depuis la modale de résultats du
// fil — d'où le composant partagé. Styles : .px-viewer* (app-22-pixel.css).
export default function ShotViewer({ round, onClose }) {
  const [i, setI] = useState(0);
  const shots = round.shots || [];

  useEffect(() => {
    // On RESTAURE la valeur précédente au lieu de vider : la visionneuse
    // s'ouvre parfois par-dessus une modale qui avait déjà bloqué le scroll,
    // et la remettre à "" laisserait la page défiler derrière elle.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
      else if (e.key === "ArrowRight") setI((n) => Math.min(shots.length - 1, n + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, shots.length]);

  return createPortal(
    <div className="px-viewer" onClick={onClose}>
      <button className="px-viewer-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>
      <figure className="px-viewer-body" onClick={(e) => e.stopPropagation()}>
        <img className="px-viewer-img" src={shots[i]} alt="" draggable="false" />
        <figcaption className="px-viewer-bar">
          <Link to={`/game/${round.gameId}`} className="px-viewer-game clickable">
            {round.cover && <img src={round.cover} alt="" draggable="false" />}
            <span>{round.gameName}</span>
          </Link>
          {shots.length > 1 && (
            <span className="px-viewer-thumbs">
              {shots.map((s, n) => (
                <button
                  key={s}
                  className={`px-viewer-thumb clickable ${n === i ? "on" : ""}`}
                  onClick={() => setI(n)}
                  aria-label={`Capture ${n + 1}`}
                >
                  <img src={s} alt="" loading="lazy" draggable="false" />
                </button>
              ))}
            </span>
          )}
        </figcaption>
      </figure>
    </div>,
    document.body
  );
}
