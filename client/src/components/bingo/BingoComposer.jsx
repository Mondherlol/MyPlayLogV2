import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Gamepad2,
  ImageIcon,
  Loader2,
  Lock,
  PenLine,
  Search,
  Shuffle,
  X,
} from "lucide-react";
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
// ⚠️ C'EST UN ÉDITEUR, PAS UN FORMULAIRE. La première version empilait une
// grille, un champ titre et une case à cocher dans une boîte : on remplissait
// des champs. Ce qu'on fait vraiment, c'est COMPOSER UN OBJET — la grille —
// et elle doit occuper la scène. D'où la mise en page d'un éditeur :
//
//   • la barre du haut : de quoi il s'agit, la taille, le mélange ;
//   • la scène : la grille, en grand, sur un fond pointillé d'atelier ;
//   • l'inspecteur à droite : les réglages de la grille, ou de LA case qu'on
//     vient de toucher ;
//   • le pied : la progression et l'enregistrement.
//
// ⚠️ ON COMPOSE AVANT, JAMAIS PENDANT. Le serveur refuse tout enregistrement
// une fois l'émission commencée (cf. server/routes/bingo.js) : cet écran ne
// s'ouvre donc que tant que c'est permis, et la page du rendez-vous le sait.

const MAX_TEXT = 120;

export default function BingoComposer({ eventId, eventName, token, initial, onClose, onSaved }) {
  const [size, setSize] = useState(initial?.size || 3);
  const [cells, setCells] = useState(initial?.cells?.length ? initial.cells : blankCells(3));
  const [title, setTitle] = useState(initial?.title || "");
  const [published, setPublished] = useState(initial?.published ?? true);
  const [active, setActive] = useState(null); // index de la case en cours d'édition
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const total = size * size;
  const filled = filledCount(cells);

  // Échap referme D'ABORD la case, puis la fenêtre. Sinon, sortir d'un champ au
  // clavier jetait toute la grille en cours de composition.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (active != null) setActive(null);
      else onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);

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

  // Passer d'une case à l'autre en boucle : on compose une grille d'une traite,
  // pas neuf fois « cliquer, écrire, fermer ».
  const step = (dir) => setActive((i) => ((i ?? 0) + dir + total) % total);

  async function save() {
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
        className="bgc"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Composer ma grille de bingo"
      >
        {/* --- La barre du haut ----------------------------------------- */}
        <header className="bgc-bar">
          <div className="bgc-bar-title">
            <span className="bgc-eyebrow">Mon bingo</span>
            <h2>{eventName}</h2>
          </div>

          <div className="bgc-seg" role="radiogroup" aria-label="Taille de la grille">
            {SIZES.map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={s === size}
                className={`bgc-seg-btn clickable ${s === size ? "on" : ""}`}
                onClick={() => changeSize(s)}
              >
                {s}×{s}
              </button>
            ))}
          </div>

          <button
            className="bgc-icon clickable"
            onClick={() => setCells((c) => shuffleCells(c))}
            title="Mélanger les cases"
            aria-label="Mélanger les cases"
          >
            <Shuffle size={16} />
          </button>
          <button className="bgc-icon clickable" onClick={onClose} aria-label="Fermer">
            <X size={17} />
          </button>
        </header>

        <div className="bgc-main">
          {/* --- La scène ----------------------------------------------- */}
          <div
            className="bgc-stage"
            // Un clic dans le vide autour de la grille désélectionne : c'est
            // le geste de tous les éditeurs, et le seul moyen évident de
            // revenir aux réglages de la grille sans bouton dédié.
            onClick={(e) => e.target === e.currentTarget && setActive(null)}
          >
            <BingoGrid
              cells={cells}
              size={size}
              mode="edit"
              activeIndex={active}
              onCell={(i) => setActive(i)}
              className="bgc-grid"
            />
          </div>

          {/* --- L'inspecteur ------------------------------------------- */}
          <aside className="bgc-inspector">
            {cell ? (
              <CellInspector
                key={active}
                cell={cell}
                index={active}
                total={total}
                token={token}
                onPatch={(patch) => patchCell(active, patch)}
                onPrev={() => step(-1)}
                onNext={() => step(1)}
                onDone={() => setActive(null)}
              />
            ) : (
              <GridInspector
                title={title}
                setTitle={setTitle}
                published={published}
                setPublished={setPublished}
              />
            )}
          </aside>
        </div>

        {/* --- Le pied ------------------------------------------------- */}
        <footer className="bgc-foot">
          <div className="bgc-progress" aria-label={`${filled} cases remplies sur ${total}`}>
            <span className="bgc-progress-bar">
              <span style={{ width: `${(filled / total) * 100}%` }} />
            </span>
            <span className="bgc-progress-txt">
              <b>{filled}</b> / {total} cases
            </span>
          </div>

          {!!error && <span className="bgc-error">{error}</span>}

          <button className="bgc-btn ghost clickable" onClick={onClose}>
            Annuler
          </button>
          <button className="bgc-btn gold clickable" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
            Enregistrer ma grille
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

/** Les réglages de la grille entière — ce qu'on voit quand aucune case n'est prise. */
function GridInspector({ title, setTitle, published, setPublished }) {
  return (
    <div className="bgc-panel">
      <label className="bgc-label" htmlFor="bgc-title">
        Titre
      </label>
      <input
        id="bgc-title"
        className="bgc-input"
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 80))}
        placeholder="Mes pronostics"
      />

      {/* Un vrai interrupteur, pas une case à cocher : c'est un ÉTAT de la
          grille (visible ou non), pas une option qu'on valide. */}
      <button
        type="button"
        role="switch"
        aria-checked={published}
        className={`bgc-switch clickable ${published ? "on" : ""}`}
        onClick={() => setPublished((v) => !v)}
      >
        <span className="bgc-switch-txt">
          <b>Visible par les autres</b>
          <i>{published ? "Elle apparaîtra sur la page du rendez-vous" : "Brouillon, rien que pour toi"}</i>
        </span>
        <span className="bgc-switch-track">
          <span className="bgc-switch-knob" />
        </span>
      </button>

      <div className="bgc-howto">
        <span className="bgc-label">Comment ça marche</span>
        <p>
          <PenLine size={15} /> Clique une case et écris ce que tu espères voir.
        </p>
        <p>
          <ImageIcon size={15} /> Colle-lui l'image d'un jeu pour qu'elle se reconnaisse d'un coup
          d'œil.
        </p>
        <p>
          <Lock size={15} /> Tout reste modifiable jusqu'au début de l'émission — ensuite, on coche.
        </p>
      </div>
    </div>
  );
}

/**
 * Les réglages d'UNE case.
 *
 * Le texte d'abord : c'est lui le pronostic. L'image est un bonus — on va la
 * chercher dans le catalogue, parce qu'une case « Metroid Prime 4 » avec sa
 * jaquette se reconnaît d'un coup d'œil sur une grille de vingt-cinq.
 */
function CellInspector({ cell, index, total, token, onPatch, onPrev, onNext, onDone }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef(null);
  const text = cell.text || "";

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
      apiFetch(`/games?search=${encodeURIComponent(term)}&limit=9`, { token })
        .then((d) => setResults(d.games || []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 320);
    return () => clearTimeout(timer.current);
  }, [q, token]);

  return (
    <div className="bgc-panel">
      <div className="bgc-cellhead">
        <button className="bgc-icon small clickable" onClick={onPrev} aria-label="Case précédente">
          <ChevronLeft size={15} />
        </button>
        <span className="bgc-cellhead-txt">
          Case <b>{index + 1}</b> sur {total}
          {cell.free && <em>offerte</em>}
        </span>
        <button className="bgc-icon small clickable" onClick={onNext} aria-label="Case suivante">
          <ChevronRight size={15} />
        </button>
        <button className="bgc-done clickable" onClick={onDone}>
          <Check size={14} /> OK
        </button>
      </div>

      <label className="bgc-label" htmlFor="bgc-text">
        Ton pronostic
      </label>
      <div className="bgc-textwrap">
        <textarea
          id="bgc-text"
          className="bgc-input bgc-textarea"
          autoFocus
          rows={3}
          value={text}
          onChange={(e) => onPatch({ text: e.target.value.slice(0, MAX_TEXT) })}
          // Entrée passe à la case suivante : on remplit une grille d'une
          // traite. Maj + Entrée garde le saut de ligne pour qui en veut un.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onNext();
            }
          }}
          placeholder={cell.free ? "FREE — ou ce que tu veux" : "Un nouveau F-ZERO…"}
        />
        <span className="bgc-count">
          {text.length}/{MAX_TEXT}
        </span>
      </div>
      <p className="bgc-hint">Entrée pour passer à la case suivante.</p>

      <span className="bgc-label">Image</span>
      {cell.image ? (
        <div className="bgc-picked">
          <img src={cell.image} alt="" />
          <div className="bgc-picked-side">
            <b title={cell.gameName}>{cell.gameName || "Image"}</b>
            <div className="bgc-seg small" role="radiogroup" aria-label="Place du texte">
              <button
                role="radio"
                aria-checked={cell.textStyle !== "overlay"}
                className={`bgc-seg-btn clickable ${cell.textStyle !== "overlay" ? "on" : ""}`}
                onClick={() => onPatch({ textStyle: "banner" })}
              >
                Bandeau
              </button>
              <button
                role="radio"
                aria-checked={cell.textStyle === "overlay"}
                className={`bgc-seg-btn clickable ${cell.textStyle === "overlay" ? "on" : ""}`}
                onClick={() => onPatch({ textStyle: "overlay" })}
              >
                Sur l'image
              </button>
            </div>
            <button
              className="bgc-link clickable"
              onClick={() => onPatch({ image: null, gameId: null, gameName: "" })}
            >
              Changer d'image
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="bgc-search">
            <Search size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Chercher un jeu…"
              aria-label="Chercher un jeu"
            />
            {searching && <Loader2 size={14} className="spin" />}
          </div>

          {results.length > 0 ? (
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
                      ...(text.trim() ? null : { text: g.name.slice(0, MAX_TEXT) }),
                    });
                    setQ("");
                    setResults([]);
                  }}
                >
                  <span className="bgc-result-art">
                    {g.cover ? (
                      <img src={g.cover} alt="" loading="lazy" />
                    ) : (
                      <Gamepad2 size={18} />
                    )}
                  </span>
                  <span className="bgc-result-name">{g.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="bgc-hint">
              {q.trim().length >= 2 && !searching
                ? "Aucun jeu trouvé."
                : "Facultatif — tape au moins deux lettres."}
            </p>
          )}
        </>
      )}

      {!cell.free && (text || cell.image) && (
        <button
          className="bgc-link danger clickable"
          onClick={() => onPatch({ text: "", image: null, gameId: null, gameName: "", saga: null })}
        >
          <Eraser size={13} /> Vider la case
        </button>
      )}
    </div>
  );
}
