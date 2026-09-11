import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, X } from "lucide-react";

// Les pas proposés. Une session de jeu se compte en heures pleines : proposer
// « +15 min » ferait passer pour de la comptabilité ce qui doit rester un geste
// de deux secondes.
const STEPS = [1, 2, 5, 10];

/**
 * « J'ai joué combien ? », en deux secondes.
 *
 * La feuille de suivi complète demande le statut, la plateforme, la note,
 * l'avis, les dates — c'est la bonne feuille quand on termine un jeu, c'est une
 * corvée quand on veut juste dire « +2 h ce soir ». Celle-ci ne pose QUE cette
 * question, et l'essentiel s'y fait sans clavier.
 */
export default function HoursModal({ entry, onClose, onSave }) {
  const [value, setValue] = useState(entry?.playtimeHours ?? 0);

  // On repart du temps enregistré à chaque ouverture : sans ça, rouvrir sur un
  // autre jeu garderait le compteur du précédent — et on lui écrirait ses heures.
  useEffect(() => setValue(entry?.playtimeHours ?? 0), [entry]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!entry) return null;

  const bump = (d) => setValue((v) => Math.max(0, Math.round((Number(v) || 0) + d)));
  const before = entry.playtimeHours ?? 0;
  const diff = Math.round((Number(value) || 0) - before);

  return createPortal(
    <div className="mh-modal-back" onClick={onClose} role="presentation">
      <div
        className="mh-modal card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Temps de jeu — ${entry.name}`}
      >
        <button className="mh-modal-x clickable" onClick={onClose} aria-label="Fermer">
          <X size={17} />
        </button>

        <div className="mh-modal-head">
          {!!entry.cover && <img src={entry.cover} alt="" loading="lazy" />}
          <div>
            <span className="mh-kicker">Temps de jeu</span>
            <h3>{entry.name}</h3>
          </div>
        </div>

        {/* Le compteur est ÉNORME parce que c'est la seule chose que la feuille
            dit — et parce qu'un chiffre qu'on modifie au clic doit se lire sans
            avoir à le chercher. */}
        <div className="mh-hours-counter">
          <button className="mh-round clickable" onClick={() => bump(-1)} aria-label="Une heure de moins">
            <Minus size={20} />
          </button>
          <div className="mh-hours-figure">
            <input
              value={String(value)}
              onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
              inputMode="numeric"
              aria-label="Heures jouées"
            />
            <span>h</span>
          </div>
          <button className="mh-round clickable" onClick={() => bump(1)} aria-label="Une heure de plus">
            <Plus size={20} />
          </button>
        </div>

        <div className="mh-hours-steps">
          {STEPS.map((s) => (
            <button key={s} className="mh-chip clickable" onClick={() => bump(s)}>
              +{s} h
            </button>
          ))}
        </div>

        <button
          className="mh-pill gold solid wide clickable"
          onClick={() => onSave?.(Number(value) || 0)}
        >
          {diff > 0 ? `Enregistrer +${diff} h` : "Enregistrer"}
        </button>
      </div>
    </div>,
    document.body
  );
}
