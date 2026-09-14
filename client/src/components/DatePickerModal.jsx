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
//
// ⚠️ CHOISIR N'EST PAS VALIDER. La feuille se refermait au premier clic : un
// raccourci effleuré ou un jour mal visé, et il fallait tout rouvrir. On
// travaille maintenant sur un BROUILLON, et seul « Valider » l'écrit.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, ChevronDown, Check, CalendarDays } from "lucide-react";
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

const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1, 12);

export default function DatePickerModal({
  title,
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
  const [draft, setDraft] = useState(value || "");
  const selected = draft ? new Date(`${draft}T12:00:00`) : null;
  const [month, setMonth] = useState(() => firstOfMonth(day(selected || anchor || new Date())));

  const cells = useMemo(() => gridOf(month), [month]);
  const today = day(new Date());
  const minD = min ? day(min) : null;
  const maxD = max ? day(max) : null;

  // On ne commence pas un jeu avant sa sortie, et on ne le finit pas demain.
  const disabled = (d) =>
    !d || d > today || (minD && d < minD) || (maxD && d > maxD);

  // Les années du menu : de la borne basse (la sortie du jeu) à aujourd'hui.
  const years = useMemo(() => {
    const from = minD ? minD.getFullYear() : today.getFullYear() - 50;
    const out = [];
    for (let y = today.getFullYear(); y >= from; y--) out.push(y);
    return out;
  }, [minD?.getTime(), today.getFullYear()]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(d) {
    setDraft(toInputValue(d));
    setMonth(firstOfMonth(d));
  }

  function confirm() {
    if (draft) onPick(draft);
    else onClear();
    onClose();
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "Enter") confirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // relit le brouillon courant à chaque rendu

  const atCurrentMonth =
    month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();
  const atMinMonth =
    !!minD && month.getFullYear() === minD.getFullYear() && month.getMonth() === minD.getMonth();

  return createPortal(
    <div
      className="modal-overlay sub dp-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dp-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dp-head">
          <h3>{title}</h3>
          <button className="dp-x clickable" onClick={onClose} aria-label="Fermer">
            <X size={17} />
          </button>
        </div>

        {/* La date retenue, en clair — c'est elle que « Valider » écrira. */}
        <div className={`dp-display ${selected ? "" : "empty"}`}>
          <CalendarDays size={18} />
          <span className="dp-display-val">{selected ? dateLabel(selected) : "Aucune date"}</span>
          {selected && (
            <button type="button" className="dp-display-clear clickable" onClick={() => setDraft("")}>
              <X size={13} /> Effacer
            </button>
          )}
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
                  className={`dp-chip clickable ${sameDay(it.date, selected) ? "active" : ""}`}
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
              disabled={atMinMonth}
            >
              <ChevronLeft size={16} />
            </button>

            {/* Mois et année en menus : remonter à 2011 se fait en un choix,
                pas en cent-soixante clics sur la flèche. */}
            <div className="dp-cal-selects">
              <label className="dp-select">
                <select
                  value={month.getMonth()}
                  onChange={(e) => setMonth(new Date(month.getFullYear(), Number(e.target.value), 1, 12))}
                  aria-label="Mois"
                >
                  {MOIS.map((m, i) => (
                    <option key={m} value={i}>
                      {m}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </label>
              <label className="dp-select">
                <select
                  value={month.getFullYear()}
                  onChange={(e) => setMonth(new Date(Number(e.target.value), month.getMonth(), 1, 12))}
                  aria-label="Année"
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </label>
            </div>

            <button
              type="button"
              className="dp-nav clickable"
              onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1, 12))}
              aria-label="Mois suivant"
              disabled={atCurrentMonth}
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
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={confirm}
            disabled={(draft || "") === (value || "")}
          >
            <Check size={16} /> Valider
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
