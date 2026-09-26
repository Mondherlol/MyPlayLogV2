import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, Globe, Loader2, Lock, Plus, Search, X } from "lucide-react";

import { apiFetch } from "../lib/api";
import { apiCached } from "../lib/query";
import { useAuth } from "../context/AuthContext";
import { boardOf, itemsBySlot } from "../lib/boards";

// ======================================================================
//  Remplir sa carte de joueur — un jeu par case
// ======================================================================
// À gauche la grille entière, toujours sous les yeux ; à droite ce qu'on met
// dans la case sélectionnée. La colonne de droite ouvre sur le rayon PROPRE à
// la case (« Mon jeu préféré » → tes coups de cœur, « Meilleur jeu rétro » →
// tes jeux de plus de vingt ans, cf. server lib/nineSuggest), puis les rayons
// de toujours et la recherche.
//
// Un jeu choisi remplit la case et passe à la suivante encore vide : on
// enchaîne les vingt sans revenir cliquer dans la grille. Pour le protagoniste
// et l'antagoniste, le choix du jeu ouvre d'abord ses personnages — le
// médaillon posé sur la jaquette, c'est tout l'intérêt de ces deux cases.
//
// `list` : la carte déjà publiée, qu'on retouche.

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

export default function BoardModal({ boardKey = "gamer", list = null, startSlot = null, onClose, onPublished }) {
  const { token } = useAuth();
  const board = boardOf(boardKey);

  // Les cases remplies : { [slot]: { id, name, cover, charName, charImage } }.
  const [cells, setCells] = useState(() => {
    const by = itemsBySlot(list?.items);
    const out = {};
    for (const [slot, it] of Object.entries(by))
      out[slot] = {
        ...asGame(it),
        charName: it.charName || null,
        charImage: it.charImage || null,
      };
    return out;
  });
  // On ouvre sur la case demandée (clic sur une case vide de la page), sinon
  // sur la première case encore vide.
  const [active, setActive] = useState(
    () =>
      (startSlot && board.slots.some((s) => s.key === startSlot) && startSlot) ||
      board.slots.find((s) => !itemsBySlot(list?.items)[s.key])?.key ||
      board.slots[0].key
  );
  // Le jeu dont on choisit le perso (protagoniste / antagoniste), sinon null.
  const [charFor, setCharFor] = useState(null);
  const [priv, setPriv] = useState(list?.visibility === "private");
  const [library, setLibrary] = useState(null);
  const [slotShelf, setSlotShelf] = useState(null);
  const [shelfKey, setShelfKey] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const slot = board.slots.find((s) => s.key === active);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    apiCached("/library", { token, maxAge: 60000 })
      .then((d) => alive && setLibrary(d?.entries || []))
      .catch(() => alive && setLibrary([]));
    return () => {
      alive = false;
    };
  }, [token]);

  // Le rayon de la case active, à chaque changement de case.
  useEffect(() => {
    let alive = true;
    setSlotShelf(null);
    setShelfKey(null);
    apiCached(`/lists/boards/${board.key}/suggest/${active}`, { token, maxAge: 5 * 60000 })
      .then((d) => alive && d?.shelf?.games?.length && setSlotShelf(d.shelf))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [active, board.key, token]);

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

  // La case suivante encore vide, dans l'ordre de la grille, après `from`.
  const nextEmpty = (from, filled) => {
    const keys = board.slots.map((s) => s.key);
    const start = keys.indexOf(from);
    for (let i = 1; i <= keys.length; i++) {
      const k = keys[(start + i) % keys.length];
      if (!filled[k]) return k;
    }
    return from;
  };

  const place = (g, char = null) => {
    const next = {
      ...cells,
      [active]: { ...g, charName: char?.name || null, charImage: char?.image || null },
    };
    setCells(next);
    setCharFor(null);
    setQuery("");
    setActive(nextEmpty(active, next));
  };

  const pickGame = (g) => {
    if (!g.id) return;
    if (slot?.char) setCharFor(g);
    else place(g);
  };

  const clearCell = (key) =>
    setCells((c) => {
      const next = { ...c };
      delete next[key];
      return next;
    });

  const filled = board.slots.filter((s) => cells[s.key]).length;

  async function publish() {
    if (!filled || saving) return;
    setSaving(true);
    setError(null);
    const items = board.slots
      .filter((s) => cells[s.key])
      .map((s) => {
        const g = cells[s.key];
        return {
          kind: "game",
          refId: String(g.id),
          gameId: g.id,
          name: g.name,
          image: g.cover || null,
          slot: s.key,
          charName: g.charName || null,
          charImage: g.charImage || null,
        };
      });
    const body = { items, visibility: priv ? "private" : "public" };
    try {
      const res = list
        ? await apiFetch(`/lists/${list.id}`, { method: "PUT", token, body })
        : await apiFetch("/lists", {
            method: "POST",
            token,
            body: { ...body, title: board.title, board: board.key, type: "classic", itemKind: "game" },
          });
      onPublished(res.list);
    } catch (e) {
      setError(e.message || "Impossible d'enregistrer la carte.");
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal nine-modal bd-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        {/* --- À gauche : la grille entière -------------------------------- */}
        <div className="bd-m-left">
          <div className="bd-m-head">
            <h2>{board.title}</h2>
            <span>
              {filled}/{board.slots.length}
            </span>
          </div>

          <div className="bd-m-grid">
            {board.slots.map((s) => {
              const g = cells[s.key];
              return (
                <div
                  key={s.key}
                  className={`bd-m-cell ${s.key === active ? "on" : ""} ${g ? "filled" : ""}`}
                >
                  <button
                    type="button"
                    className="bd-m-cell-art clickable"
                    onClick={() => {
                      setActive(s.key);
                      setCharFor(null);
                    }}
                    title={g ? `${s.label} : ${g.name}` : s.label}
                  >
                    {g?.cover ? (
                      <img src={g.cover} alt="" />
                    ) : g ? (
                      <span className="bd-noart">{g.name}</span>
                    ) : (
                      <s.Icon size={18} />
                    )}
                    {g?.charImage && <img className="bd-char" src={g.charImage} alt="" />}
                  </button>
                  {g && (
                    <button
                      type="button"
                      className="bd-m-cell-x clickable"
                      onClick={() => clearCell(s.key)}
                      aria-label={`Vider « ${s.label} »`}
                    >
                      <X size={12} strokeWidth={3} />
                    </button>
                  )}
                  <span className="bd-m-cell-label">{s.label}</span>
                </div>
              );
            })}
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="nine-m-actions">
            <button
              type="button"
              className={`nine-m-vis clickable ${priv ? "is-private" : ""}`}
              onClick={() => setPriv((v) => !v)}
              title={priv ? "Seul toi la vois" : "Tout le monde la voit"}
            >
              {priv ? <Lock size={15} /> : <Globe size={15} />}
              {priv ? "Privée" : "Publique"}
            </button>
            <button
              type="button"
              className="btn btn-primary nine-m-publish"
              disabled={!filled || saving}
              onClick={publish}
            >
              {saving ? (
                <Loader2 size={17} className="spin" />
              ) : !filled ? (
                "Remplis une case"
              ) : (
                <>
                  <Check size={17} /> {list ? "Enregistrer" : "Publier ma carte"}
                </>
              )}
            </button>
          </div>
        </div>

        {/* --- À droite : ce qu'on met dans la case ------------------------ */}
        <div className="nine-m-right">
          <div className="bd-m-slot">
            {slot && <slot.Icon size={18} />}
            <h3>{slot?.label}</h3>
          </div>

          {charFor ? (
            <CharPicker
              game={charFor}
              prompt={slot?.char}
              token={token}
              onBack={() => setCharFor(null)}
              onPick={(c) => place(charFor, c)}
            />
          ) : (
            <>
              <div className="nine-m-search">
                <Search size={16} />
                <input
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

              <div className="nine-m-grid">
                {library === null && !results ? (
                  <div className="nine-m-empty">
                    <Loader2 size={18} className="spin" />
                  </div>
                ) : (
                  grid.map((g) => {
                    const here = cells[active]?.id === g.id;
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
                        {!!g.year && <span className="nine-m-game-year">{g.year}</span>}
                      </button>
                    );
                  })
                )}
                {library !== null && !grid.length && (
                  <p className="nine-m-empty">
                    {results ? "Aucun jeu trouvé." : "Cherche tes jeux juste au-dessus."}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// Les personnages d'un jeu, pour le médaillon du protagoniste / antagoniste.
// Un jeu sans personnages connus (ou qu'on ne veut pas illustrer) se place
// quand même : « Sans perso ».
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
