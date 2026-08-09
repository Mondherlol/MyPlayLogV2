import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Gamepad2 } from "lucide-react";
import { dedupeCandidates, searchCandidates } from "../../lib/guessGame";

// ======================================================================
//  Le champ « tape le nom d'un jeu »
// ======================================================================
// Trois épreuves du Grand Quiz demandent un titre au clavier : les emojis, la
// capture pixelisée et le studio. Elles partagent donc ce champ, qui reprend
// mot pour mot le comportement du blind test et de Pixel Rush — mêmes
// suggestions tolérantes (acronymes, noms alternatifs FR), même navigation aux
// flèches, même Tab pour compléter, même Entrée pour valider.
//
// C'est délibérément la MÊME ergonomie : quelqu'un qui a joué au blind test
// sait déjà s'en servir, et une variation ici serait perçue comme un bug plutôt
// que comme une nouveauté.
//
// La seule chose qu'il fait en plus : `onSubmit` reçoit aussi les saisies qui
// ne correspondent à AUCUNE suggestion. Sur l'épreuve du studio, on veut
// pouvoir tenter un titre que la liste ne propose pas — c'est le serveur (ou
// la liste d'acceptation en solo) qui tranche, pas l'autocomplétion.
export default function GameSearch({
  candidates,
  onSubmit,
  // Remonte la saisie en cours au parent. Seule l'épreuve « lettres mêlées »
  // s'en sert : elle grise les tuiles à mesure qu'on écrit, donc elle a besoin
  // de savoir ce qu'il y a dans le champ avant validation.
  onType,
  disabled,
  placeholder = "Tape le nom du jeu…",
  autoFocus = true,
  // Remis à zéro par le parent après chaque envoi accepté (une clé qui change).
  resetKey,
}) {
  const [input, setInput] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const list = useMemo(() => dedupeCandidates(candidates || []), [candidates]);
  const suggestions = useMemo(() => searchCandidates(input, list), [input, list]);

  useEffect(() => {
    setInput("");
    setHighlight(0);
    onType?.("");
    // `onType` est souvent une lambda recréée à chaque rendu du parent :
    // l'inclure ici relancerait la remise à zéro en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (autoFocus && !disabled) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [autoFocus, disabled, resetKey]);

  useEffect(() => {
    listRef.current?.children[highlight]?.scrollIntoView({ block: "nearest" });
  }, [highlight, suggestions]);

  // La liste flotte sous le champ ; sur l'écran de jeu, il n'y a pas toujours
  // la place. On la bascule au-dessus quand c'est plus confortable, et on la
  // borne à l'espace réellement disponible pour qu'elle scrolle dedans au lieu
  // de déborder de la page. (Même correctif que Pixel Rush.)
  useEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const place = () => {
      const field = el.parentElement?.querySelector(".qz-search");
      if (!field) return;
      const r = field.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 16;
      const above = r.top - 16;
      const up = below < 220 && above > below;
      el.classList.toggle("up", up);
      el.style.maxHeight = `${Math.max(140, Math.min(300, up ? above : below))}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [suggestions]);

  function commit(cand) {
    if (disabled) return;
    if (cand) {
      onSubmit({ gameId: cand.id, name: cand.name });
      return;
    }
    // Saisie libre : on envoie le texte tel quel, sans identifiant.
    const raw = input.trim();
    if (raw) onSubmit({ gameId: null, name: raw });
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (e.key === "Tab") {
      e.preventDefault();
      const pick = suggestions[highlight] || suggestions[0];
      if (pick) {
        setInput(pick.name);
        setHighlight(0);
        onType?.(pick.name);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commit(suggestions[highlight] || suggestions[0] || null);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    }
  }

  return (
    <div className={`qz-guess ${disabled ? "locked" : ""}`}>
      <div className="qz-search">
        <Search size={17} className="qz-search-ic" />
        <input
          ref={inputRef}
          className="qz-search-input"
          placeholder={placeholder}
          value={input}
          disabled={disabled}
          onChange={(e) => {
            setInput(e.target.value);
            setHighlight(0);
            onType?.(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            // Mobile : remonte le champ au-dessus du clavier virtuel.
            if (window.innerWidth <= 760) {
              const el = e.target;
              setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
            }
          }}
          autoComplete="off"
          spellCheck="false"
        />
      </div>
      {!disabled && suggestions.length > 0 && (
        <ul className="qz-suggest" ref={listRef}>
          {suggestions.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className={`qz-suggest-row clickable ${i === highlight ? "on" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(c);
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                {c.cover ? (
                  <img src={c.cover} alt="" loading="lazy" draggable="false" />
                ) : (
                  <span className="qz-suggest-ph">
                    <Gamepad2 size={13} />
                  </span>
                )}
                <span className="qz-suggest-name">{c.name}</span>
                {i === highlight && <kbd>↵</kbd>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
