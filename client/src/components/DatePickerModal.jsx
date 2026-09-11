// ======================================================================
//  Choisir une date — les raccourcis d'abord, le calendrier ensuite
// ======================================================================
//
// L'ORDRE N'EST PAS ANODIN. Une date de jeu se dit presque toujours par rapport
// à quelque chose : « à la sortie », « un mois après l'avoir commencé », « il y
// a un an ». On répond donc d'abord par un raccourci, et le calendrier reste là
// pour ceux qui connaissent leur date au jour près.
//
// C'est la même feuille que sur mobile (components/DateSheet.jsx), et pour la
// même raison qu'elle existe là-bas : dans la modale de suivi, deux champs date
// nus au milieu du formulaire noyaient tout le reste. Ici ils se replient
// derrière un bouton, et tout ce qui les entoure redevient lisible.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Check, Trash2 } from "lucide-react";
import { day, dateLabel, toInputValue } from "../lib/dateQuick";

const JOURS = ["L", "M", "M", "J", "V", "S", "D"];
const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

// Les cases d'un mois : les vides du début (lundi en tête), puis les jours.
function gridOf(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  // `getDay()` met dimanche à 0 ; notre semaine commence lundi.
  const blanks = (first.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: blanks }, () => null);
  for (let i = 1; i <= days; i++) cells.push(new Date(month.getFullYear(), month.getMonth(), i, 12));
  return cells;
}

const sameDay = (a, b) =>
  !!a && !!b && new Date(a).toDateString() === new Date(b).toDateString();

export default function DatePickerModal({
  title,
  subtitle = null,
  // "AAAA-MM-JJ" ou "" — la valeur du champ qu'on modifie.
  value,
  rows = [],
  // Le mois sur lequel s'ouvrir quand rien n'est choisi : celui de la date de
  // référence. ⚠️ Ouvrir sur le mois COURANT pour un jeu de 2011 imposerait de
  // reculer cent-soixante-dix fois.
  anchor = null,
  min = null,
  max = null,
  onPick,
  onClear,
  onClose,
}) {
  const selected = value ? new Date(`${value}T12:00:00`) : null;
  const [month, setMonth] = useState(() =>
    day(selected || anchor || new Date())
  );

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cells = useMemo(() => gridOf(month), [month]);
  const today = day(new Date());
  const minD = min ? day(min) : null;
  const maxD = max ? day(max) : null;

  // On ne commence pas un jeu avant sa sortie, et on ne le finit pas demain.
  const disabled = (d) =>
    !d || d > today || (minD && d < minD) || (maxD && d > maxD);

  function choose(d) {
    onPick(toInputValue(d));
    onClose();
  }

  return createPortal(
    <div
      className="modal-overlay sub dp-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dp-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dp-head">
          <div className="dp-titles">
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="dp-x clickable" onClick={onClose} aria-label="Fermer">
            <X size={17} />
          </button>
        </div>

        {/* --- Les raccourcis, une rangée par origine --- */}
        {rows.map((row) => (
          <div key={row.key} className="dp-row">
            <span className="dp-row-label">{row.label}</span>
            <div className="dp-chips">
              {row.items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  className={`dp-chip clickable ${
                    sameDay(it.date, selected) ? "active" : ""
                  }`}
                  onClick={() => choose(it.date)}
                >
                  <span className="dp-chip-label">{it.label}</span>
                  {it.hint && <span className="dp-chip-hint">{it.hint}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* --- Le calendrier, pour ceux qui savent leur date --- */}
        <div className="dp-cal">
          <div className="dp-cal-head">
            <button
              type="button"
              className="dp-nav clickable"
              onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1, 12))}
              aria-label="Mois précédent"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="dp-month">
              {MOIS[month.getMonth()]} {month.getFullYear()}
            </span>
            <button
              type="button"
              className="dp-nav clickable"
              onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1, 12))}
              aria-label="Mois suivant"
              disabled={
                month.getFullYear() === today.getFullYear() &&
                month.getMonth() === today.getMonth()
              }
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="dp-grid">
            {JOURS.map((j, i) => (
              <span key={i} className="dp-dow">
                {j}
              </span>
            ))}
            {cells.map((d, i) =>
              d ? (
                <button
                  key={i}
                  type="button"
                  className={`dp-day clickable ${sameDay(d, selected) ? "on" : ""} ${
                    sameDay(d, today) ? "today" : ""
                  }`}
                  onClick={() => choose(d)}
                  disabled={disabled(d)}
                >
                  {d.getDate()}
                </button>
              ) : (
                <span key={i} className="dp-blank" />
              )
            )}
          </div>
        </div>

        <div className="dp-foot">
          {value && (
            <button
              type="button"
              className="dp-clear clickable"
              onClick={() => {
                onClear();
                onClose();
              }}
            >
              <Trash2 size={14} /> Effacer
            </button>
          )}
          <span className="dp-current">
            {selected ? (
              <>
                <Check size={14} /> {dateLabel(selected)}
              </>
            ) : (
              "Aucune date"
            )}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
