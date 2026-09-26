import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, Loader2, Plus, Search, Trash2, X } from "lucide-react";

import { apiFetch } from "../../lib/api";
import { apiCached } from "../../lib/query";
import { boardSlot } from "../../lib/boards";

// ======================================================================
//  Choisir le jeu d'UNE case de la carte de joueur
// ======================================================================
// La fenêtre s'ouvre sur le rayon propre à la case (« Mon jeu préféré » → tes
// coups de cœur, « Meilleur jeu rétro » → tes jeux de plus de vingt ans, cf.
// server lib/nineSuggest), puis les rayons de toujours et la recherche. Pour
// le protagoniste et l'antagoniste, le jeu choisi ouvre ses personnages.
//
// Le choix est rendu à l'appelant (`onPick`), qui l'enregistre aussitôt : la
// fenêtre, elle, ne garde rien.

const SHELVES = [
  {
    key: "favorites",
    label: "Coups de cœur",
    pick: (e) => e.favorite,
    sort: (a, b) => (b.rating ?? -1) - (a.rating ?? -1),
  },
  { key: "rated", label: "Mieux notés", pick: (e) => e.rating != null, sort: (a, b) => b.rating - a.rating },
  {
    key: "played",
    label: "Plus joués",
    pick: (e) => (e.playtimeHours || 0) > 0,
    sort: (a, b) => (b.playtimeHours || 0) - (a.playtimeHours || 0),
  },
  {
    key: "recent",
    label: "Récents",
    pick: () => true,
    sort: (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0),
  },
];

const asGame = (e) => ({
  id: Number(e.gameId ?? e.refId ?? e.id),
  name: e.name,
  cover: e.cover || e.image || null,
  year: e.year || null,
});

export default function BoardPicker({ boardKey, slotKey, current, token, onPick, onClear, onClose }) {
  const slot = boardSlot(boardKey, slotKey);
  const [charFor, setCharFor] = useState(null);
  const [library, setLibrary] = useState(null);
  const [slotShelf, setSlotShelf] = useState(null);
  const [shelfKey, setShelfKey] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    apiCached("/library", { token, maxAge: 60000 })
      .then((d) => alive && setLibrary(d?.entries || []))
      .catch(() => alive && setLibrary([]));
    apiCached(`/lists/boards/${boardKey}/suggest/${slotKey}`, { token, maxAge: 5 * 60000 })
      .then((d) => alive && d?.shelf?.games?.length && setSlotShelf(d.shelf))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [boardKey, slotKey, token]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      setSearching(false);
      return undefined;
    }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(() => {
      apiFetch(`/games?search=${encodeURIComponent(term)}&limit=30`, { token })
        .then((d) => alive && setResults((d.games || []).map(asGame)))
        .catch(() => alive && setResults([]))
        .finally(() => alive && setSearching(false));
    }, 320);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, token]);

  const shelves = useMemo(() => {
    const owned = (library || []).filter((e) => e.status !== "wishlist");
    const base = SHELVES.map((s) => ({
      ...s,
      games: owned.filter(s.pick).sort(s.sort).slice(0, 90).map(asGame),
    })).filter((s) => s.games.length);
    return slotShelf
      ? [{ key: "slot", label: slotShelf.label, games: slotShelf.games, theme: true }, ...base]
      : base;
  }, [library, slotShelf]);
  const shelf = shelves.find((s) => s.key === shelfKey) || shelves[0];
  const grid = results ?? shelf?.games ?? [];

  const pickGame = (g) => {
    if (!g.id) return;
    if (slot?.char) setCharFor(g);
    else onPick(g, null);
  };

  if (!slot) return null;

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal bp-modal">
        <header className="bp-head">
          <span className="bp-head-ic">
            <slot.Icon size={20} />
          </span>
          <h2>{slot.label}</h2>
          {current && onClear && (
            <button type="button" className="bp-clear clickable" onClick={onClear} title="Vider la case">
              <Trash2 size={15} />
            </button>
          )}
          <button type="button" className="bp-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </header>

        {charFor ? (
          <CharPicker
            game={charFor}
            prompt={slot.char}
            token={token}
            onBack={() => setCharFor(null)}
            onPick={(c) => onPick(charFor, c)}
          />
        ) : (
          <>
            <div className="nine-m-search">
              <Search size={16} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Chercher un jeu"
              />
              {searching && <Loader2 size={15} className="spin" />}
              {!!query && !searching && (
                <button type="button" className="clickable" onClick={() => setQuery("")} aria-label="Effacer">
                  <X size={15} />
                </button>
              )}
            </div>

            {!results && shelves.length > 0 && (
              <div className="nine-m-shelves" role="tablist">
                {shelves.map((s) => (
                  <button
                    key={s.key}
                    role="tab"
                    aria-selected={s.key === shelf?.key}
                    className={`nine-m-shelf clickable ${s.key === shelf?.key ? "on" : ""} ${
                      s.theme ? "is-theme" : ""
                    }`}
                    onClick={() => setShelfKey(s.key)}
                  >
                    {s.label}
                    <span>{s.games.length}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="nine-m-grid bp-grid">
              {library === null && !results ? (
                <div className="nine-m-empty">
                  <Loader2 size={18} className="spin" />
                </div>
              ) : (
                grid.map((g) => {
                  const here = Number(current?.gameId ?? current?.refId) === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      className={`nine-m-game clickable ${here ? "on" : ""}`}
                      onClick={() => pickGame(g)}
                      title={g.name}
                    >
                      <span className="nine-m-game-art">
                        {g.cover ? (
                          <img src={g.cover} alt="" loading="lazy" />
                        ) : (
                          <span className="nine-m-noart">{g.name}</span>
                        )}
                        <span className="nine-m-game-mark">
                          {here ? <Check size={15} strokeWidth={3} /> : <Plus size={15} strokeWidth={3} />}
                        </span>
                      </span>
                      <span className="nine-m-game-name">{g.name}</span>
                    </button>
                  );
                })
              )}
              {library !== null && !grid.length && (
                <p className="nine-m-empty">{results ? "Aucun jeu trouvé." : "Cherche un jeu juste au-dessus."}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// Les personnages d'un jeu, pour le médaillon du protagoniste / antagoniste.
function CharPicker({ game, prompt, token, onBack, onPick }) {
  const [chars, setChars] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    apiFetch(`/games/${game.id}/details`, { token })
      .then((d) => alive && setChars((d.characters || []).filter((c) => c.name)))
      .catch(() => alive && setChars([]));
    return () => {
      alive = false;
    };
  }, [game.id, token]);

  const shown = q ? (chars || []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : chars || [];

  return (
    <>
      <div className="bd-char-head">
        <button type="button" className="bd-char-back clickable" onClick={onBack} aria-label="Changer de jeu">
          <ArrowLeft size={16} />
        </button>
        {game.cover && <img src={game.cover} alt="" />}
        <div>
          <b>{game.name}</b>
          <span>{prompt}</span>
        </div>
        <button type="button" className="btn btn-ghost bd-char-skip clickable" onClick={() => onPick(null)}>
          Sans perso
        </button>
      </div>

      {chars && chars.length > 8 && (
        <div className="nine-m-search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un personnage" />
        </div>
      )}

      <div className="nine-m-grid bd-char-grid">
        {chars === null ? (
          <div className="nine-m-empty">
            <Loader2 size={18} className="spin" />
          </div>
        ) : !shown.length ? (
          <p className="nine-m-empty">Aucun personnage connu pour ce jeu.</p>
        ) : (
          shown.map((c) => (
            <button
              key={c.id || c.name}
              type="button"
              className="bd-char-opt clickable"
              onClick={() => onPick({ name: c.name, image: c.image || null })}
              title={c.name}
            >
              <span className="bd-char-face">
                {c.image ? <img src={c.image} alt="" loading="lazy" /> : <b>{c.name.charAt(0)}</b>}
              </span>
              <span className="bd-char-name">{c.name}</span>
            </button>
          ))
        )}
      </div>
    </>
  );
}
