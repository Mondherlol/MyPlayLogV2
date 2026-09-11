import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eraser, Gamepad2, Loader2, Search, Shuffle, X } from "lucide-react";
import { apiFetch } from "../../lib/api";
import {
  SIZES,
  blankCells,
  cellsForSave,
  filledCount,
  resizeCells,
  shuffleCells,
} from "../../lib/bingo";
import BingoGrid from "./BingoGrid";

// ======================================================================
//  Composer sa grille
// ======================================================================
// ⚠️ ON COMPOSE AVANT, JAMAIS PENDANT. Le serveur refuse tout enregistrement
// une fois l'émission commencée (cf. server/routes/bingo.js) : cet écran ne
// s'ouvre donc que tant que c'est permis, et la page du rendez-vous le sait.
//
// Deux panneaux : la grille telle qu'elle sera, et l'éditeur de la case qu'on
// vient de cliquer. La grille reste visible pendant qu'on écrit — c'est elle
// qu'on compose, pas un formulaire de vingt-cinq lignes.

export default function BingoComposer({ eventId, eventName, token, initial, onClose, onSaved }) {
  const [size, setSize] = useState(initial?.size || 3);
  const [cells, setCells] = useState(initial?.cells?.length ? initial.cells : blankCells(3));
  const [title, setTitle] = useState(initial?.title || "");
  const [published, setPublished] = useState(initial?.published ?? true);
  const [active, setActive] = useState(null); // index de la case en cours d'édition
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function changeSize(next) {
    if (next === size) return;
    // ⚠️ ON GARDE CE QU'ON PEUT, PAR POSITION (cf. lib/bingo) : passer de 3×3 à
    // 4×4 ne doit pas envoyer le texte de la case du milieu dans un coin.
    setCells((c) => resizeCells(c, size, next));
    setSize(next);
    setActive(null);
  }

  function patchCell(index, patch) {
    setCells((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  async function save() {
    const filled = filledCount(cells);
    if (!filled) {
      setError("Écris au moins une case avant d'enregistrer.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const d = await apiFetch(`/bingo/event/${eventId}`, {
        method: "PUT",
        token,
        body: { size, title: title.trim(), published, cells: cellsForSave(cells) },
      });
      onSaved?.(d.grid);
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const cell = active == null ? null : cells[active];

  return createPortal(
    <div className="bgc-back" onClick={onClose} role="presentation">
      <div
        className="bgc card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Composer ma grille de bingo"
      >
        <header className="bgc-head">
          <div>
            <span className="mh-kicker">Mon bingo</span>
            <h2>{eventName}</h2>
          </div>
          <button className="bgc-x clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </header>

        <div className="bgc-body">
          <div className="bgc-left">
            <div className="bgc-tools">
              <div className="bgc-sizes" role="group" aria-label="Taille de la grille">
                {SIZES.map((s) => (
                  <button
                    key={s}
                    className={`bgc-size clickable ${s === size ? "on" : ""}`}
                    onClick={() => changeSize(s)}
                  >
                    {s}×{s}
                  </button>
                ))}
              </div>
              <button
                className="mh-round small clickable"
                onClick={() => setCells((c) => shuffleCells(c))}
                title="Mélanger les cases"
                aria-label="Mélanger les cases"
              >
                <Shuffle size={15} />
              </button>
            </div>

            <BingoGrid
              cells={cells}
              size={size}
              mode="edit"
              onCell={(i) => setActive(i)}
              className={`bgc-grid ${active != null ? "editing" : ""}`}
            />

            <p className="bgc-count">
              {filledCount(cells)} / {size * size} cases remplies
            </p>
          </div>

          <div className="bgc-right">
            {cell ? (
              <CellEditor
                cell={cell}
                token={token}
                onPatch={(patch) => patchCell(active, patch)}
                onDone={() => setActive(null)}
              />
            ) : (
              <div className="bgc-panel">
                <label className="field">
                  <span>Titre (facultatif)</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                    placeholder="Mes pronostics"
                  />
                </label>

                <label className="bgc-check clickable">
                  <input
                    type="checkbox"
                    checked={published}
                    onChange={(e) => setPublished(e.target.checked)}
                  />
                  <span>
                    <b>Montrer ma grille</b>
                    <i>Les autres pourront la voir sur la page du rendez-vous.</i>
                  </span>
                </label>

                <p className="bgc-hint">
                  Clique une case pour écrire ton pronostic. Tu peux lui coller
                  l'image d'un jeu — et tout rester modifiable jusqu'au début de
                  l'émission.
                </p>
              </div>
            )}
          </div>
        </div>

        {!!error && <div className="alert alert-error">{error}</div>}

        <footer className="bgc-foot">
          <button className="mh-pill ghost clickable" onClick={onClose}>
            Annuler
          </button>
          <button className="mh-pill gold solid clickable" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={14} className="spin" /> : "Enregistrer"}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

/**
 * L'éditeur d'UNE case.
 *
 * Le texte d'abord : c'est lui le pronostic. L'image est un bonus — on va la
 * chercher dans le catalogue, parce qu'une case « Metroid Prime 4 » avec sa
 * jaquette se reconnaît d'un coup d'œil sur une grille de vingt-cinq.
 */
function CellEditor({ cell, token, onPatch, onDone }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return undefined;
    }
    // Une frappe par lettre ferait une requête IGDB par lettre : on attend que
    // les doigts s'arrêtent.
    timer.current = setTimeout(() => {
      setSearching(true);
      apiFetch(`/games?search=${encodeURIComponent(term)}&limit=12`, { token })
        .then((d) => setResults(d.games || []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 320);
    return () => clearTimeout(timer.current);
  }, [q, token]);

  return (
    <div className="bgc-panel">
      <div className="bgc-panel-head">
        <span className="mh-kicker">Case {cell.index + 1}</span>
        <button className="bgc-done clickable" onClick={onDone}>
          Terminé
        </button>
      </div>

      <label className="field">
        <span>Ton pronostic</span>
        <input
          autoFocus
          value={cell.text || ""}
          onChange={(e) => onPatch({ text: e.target.value.slice(0, 120) })}
          placeholder="Un nouveau F-ZERO…"
        />
      </label>

      {cell.image ? (
        <div className="bgc-img">
          <img src={cell.image} alt="" />
          <div className="bgc-img-side">
            <b>{cell.gameName || "Image"}</b>
            <div className="bgc-img-acts">
              <button
                className={`bgc-style clickable ${cell.textStyle !== "overlay" ? "on" : ""}`}
                onClick={() => onPatch({ textStyle: "banner" })}
              >
                Bandeau
              </button>
              <button
                className={`bgc-style clickable ${cell.textStyle === "overlay" ? "on" : ""}`}
                onClick={() => onPatch({ textStyle: "overlay" })}
              >
                Sur l'image
              </button>
            </div>
            <button
              className="bgc-clear clickable"
              onClick={() => onPatch({ image: null, gameId: null, gameName: "" })}
            >
              <Eraser size={13} /> Retirer l'image
            </button>
          </div>
        </div>
      ) : (
        <>
          <label className="field">
            <span>Image d'un jeu (facultatif)</span>
            <span className="bgc-search">
              <Search size={15} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Chercher un jeu…"
              />
              {searching && <Loader2 size={14} className="spin" />}
            </span>
          </label>

          {results.length > 0 && (
            <div className="bgc-results">
              {results.map((g) => (
                <button
                  key={g.id}
                  className="bgc-result clickable"
                  title={g.name}
                  onClick={() => {
                    onPatch({
                      image: g.cover || null,
                      gameId: g.id,
                      gameName: g.name,
                      // Le texte suit le jeu quand la case est encore vide :
                      // neuf fois sur dix, c'est le nom du jeu qu'on allait
                      // écrire à la main.
                      ...(cell.text?.trim() ? null : { text: g.name.slice(0, 120) }),
                    });
                    setQ("");
                    setResults([]);
                  }}
                >
                  {g.cover ? (
                    <img src={g.cover} alt="" loading="lazy" />
                  ) : (
                    <span className="bgc-result-ph">
                      <Gamepad2 size={16} />
                    </span>
                  )}
                  <span>{g.name}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {!cell.free && (
        <button
          className="bgc-clear clickable"
          onClick={() =>
            onPatch({ text: "", image: null, gameId: null, gameName: "", saga: null })
          }
        >
          <Eraser size={13} /> Vider la case
        </button>
      )}
    </div>
  );
}
