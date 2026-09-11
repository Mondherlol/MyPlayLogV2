// ======================================================================
//  La note en étoiles — cinq étoiles qu'on règle au glissé
// ======================================================================
//
// Même contrat que la jauge sur 100 (`RatingGauge`) : les mêmes props, la même
// valeur SUR 100. Ce composant ne fait que la montrer autrement, et c'est le
// réglage d'Apparence qui décide lequel des deux s'affiche (cf. RatingInput).
//
// DEUX PRÉCISIONS, ET C'EST VOULU :
//   • à la LECTURE, le remplissage est continu — une note de 83 posée sur 100
//     remplit 4,15 étoiles. L'arrondir à 4 serait mentir sur une note qu'on n'a
//     pas saisie ici ;
//   • à la SAISIE, on tombe sur les demi-étoiles. Personne ne vise 4,15 : les
//     échelles en étoiles se pensent par crans d'une demie, et laisser glisser
//     au centième donnerait une note impossible à reproduire.

import { useRef, useState } from "react";
import { Star, X } from "lucide-react";
import { fromStars } from "../lib/ratingScale";

const STARS = 5;
const STEP = 0.5;

export default function StarRating({ value, active, onEnable, onChange, onClear }) {
  const rowRef = useRef(null);
  const draggingRef = useRef(false);
  // Ce que l'on survole avant de lâcher : l'aperçu doit suivre le doigt sans
  // écrire la note tant qu'on n'a pas choisi.
  const [hover, setHover] = useState(null);

  const stars = active ? value / 20 : 0;
  const shown = hover != null ? hover : stars;

  // Position du pointeur -> nombre d'étoiles, arrondi à la demie supérieure.
  // La plus petite note possible est donc une demi-étoile : zéro étoile se dit
  // « pas de note », et c'est le bouton « retirer » qui le fait.
  function starsFromEvent(e) {
    const row = rowRef.current;
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const raw = Math.max(0, Math.min(1, ratio)) * STARS;
    return Math.max(STEP, Math.ceil(raw / STEP) * STEP);
  }

  function onPointerDown(e) {
    if (!active) onEnable();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const s = starsFromEvent(e);
    if (s != null) {
      setHover(s);
      onChange(fromStars(s));
    }
  }
  function onPointerMove(e) {
    const s = starsFromEvent(e);
    if (s == null) return;
    setHover(s);
    if (draggingRef.current) onChange(fromStars(s));
  }
  function onPointerUp(e) {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  // Les flèches pour ceux qui n'ont pas de souris — et pour l'accessibilité :
  // un réglage qui ne s'atteint qu'au glissé n'est pas réglable au clavier.
  function onKeyDown(e) {
    if (!active) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onEnable();
      }
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(fromStars(Math.min(STARS, stars + STEP)));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(fromStars(Math.max(STEP, stars - STEP)));
    }
  }

  const label = Number.isInteger(shown) ? String(shown) : shown.toLocaleString("fr-FR");

  return (
    <div className="star-rating">
      <div
        ref={rowRef}
        className={`star-row ${active ? "on" : ""}`}
        role="slider"
        tabIndex={0}
        aria-valuemin={0.5}
        aria-valuemax={STARS}
        aria-valuenow={active ? Math.round(stars * 10) / 10 : undefined}
        aria-valuetext={active ? `${label} étoiles sur ${STARS}` : "Pas encore noté"}
        aria-label="Note en étoiles"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => !draggingRef.current && setHover(null)}
        onKeyDown={onKeyDown}
      >
        {Array.from({ length: STARS }, (_, i) => {
          // Part de CETTE étoile qui est remplie, de 0 à 1. C'est ce qui permet
          // les demies — et les 4,15 étoiles d'une note posée sur 100.
          const fill = Math.max(0, Math.min(1, shown - i));
          return (
            <span key={i} className="star-cell">
              <Star size={26} className="star-bg" />
              <span className="star-fg" style={{ width: `${fill * 100}%` }}>
                <Star size={26} fill="currentColor" strokeWidth={0} />
              </span>
            </span>
          );
        })}
      </div>

      {active ? (
        <div className="star-foot">
          <span className="star-value">
            {label}
            <span className="star-outof">/{STARS}</span>
          </span>
          <button className="gauge-clear clickable" onClick={onClear}>
            <X size={12} /> retirer la note
          </button>
        </div>
      ) : (
        <button className="gauge-noter clickable" onClick={onEnable}>
          Noter
        </button>
      )}
    </div>
  );
}
