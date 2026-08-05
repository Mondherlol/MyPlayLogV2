import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Search,
  Loader2,
  Check,
  Plus,
  Gamepad2,
  User,
  UserPlus,
  Users,
  ArrowLeft,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { loadPopularGames } from "../lib/popularGames";
import AddCharacterModal from "./AddCharacterModal";

// Modal d'ajout d'éléments à une liste.
// Le "kind" est fixé par la liste : "game" (recherche IGDB, clic = ajout/retrait)
// ou "character" (par jeu OU par nom de personnage). Pas de mélange.
export default function AddItemsModal({
  kind = "game", // "game" | "character"
  existing, // Set de refId déjà dans la liste
  onToggle, // (item) => void  (ajoute si absent, retire si présent)
  onClose,
}) {
  const { token } = useAuth();
  const isChar = kind === "character";

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal additems-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        <h2 className="modal-title">
          {isChar ? <User size={20} /> : <Gamepad2 size={20} />}
          {isChar ? "Ajouter des personnages" : "Ajouter des jeux"}
        </h2>

        {isChar ? (
          <CharacterSearch token={token} existing={existing} onToggle={onToggle} />
        ) : (
          <GameSearch token={token} existing={existing} onToggle={onToggle} />
        )}

        <div className="additems-foot">
          <span className="additems-count">
            {existing.size} élément{existing.size > 1 ? "s" : ""} dans la liste
          </span>
          <button className="btn btn-primary" onClick={onClose}>
            <Check size={18} /> Terminé
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// --- Barre de recherche de jeux (form : Entrée / bouton) ---
function SearchBar({ value, onChange, loading, placeholder, children }) {
  return (
    <>
      <Search size={18} />
      <input
        autoFocus
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {loading && <Loader2 size={16} className="spin" />}
      {children}
    </>
  );
}

// --- Recherche de jeux (onglet Jeux) ---
function GameSearch({ token, existing, onToggle }) {
  const [q, setQ] = useState("");
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  // La recherche ne part qu'à la validation (Entrée / bouton), jamais à la
  // frappe. La recherche vide (jeux populaires) est mise en cache 24h.
  const runSearch = useCallback(
    (term) => {
      const t = term.trim();
      const id = ++reqRef.current;
      setLoading(true);
      const done = (list) => {
        if (id === reqRef.current) {
          setGames(list);
          setLoading(false);
        }
      };
      if (!t) {
        loadPopularGames(token).then(done).catch(() => done([]));
        return;
      }
      const params = new URLSearchParams({ limit: 24, sort: "popularity" });
      params.set("search", t);
      apiFetch(`/games?${params}`, { token })
        .then((d) => done(d.games || []))
        .catch(() => done([]));
    },
    [token]
  );

  useEffect(() => {
    runSearch("");
  }, [runSearch]);

  function submit(e) {
    e.preventDefault();
    runSearch(q);
  }

  return (
    <>
      <form className="additems-search" onSubmit={submit}>
        <SearchBar value={q} onChange={setQ} loading={loading} placeholder="Rechercher un jeu…">
          <button type="submit" className="additems-search-btn clickable">
            Rechercher
          </button>
        </SearchBar>
      </form>
      <div className="additems-grid">
        {games.map((g) => {
          const refId = String(g.id);
          const added = existing.has(refId);
          return (
            <GameCardPick
              key={g.id}
              game={g}
              added={added}
              onClick={() =>
                onToggle({
                  kind: "game",
                  refId,
                  gameId: g.id,
                  name: g.name,
                  image: g.cover,
                })
              }
            />
          );
        })}
      </div>
      {!loading && games.length === 0 && (
        <p className="additems-hint font-fun">Aucun jeu trouvé.</p>
      )}
    </>
  );
}

// --- Recherche de personnages : par jeu OU par nom ---
function CharacterSearch({ token, existing, onToggle }) {
  const [mode, setMode] = useState("byGame"); // byGame | byName

  return (
    <>
      <div className="additems-modes">
        <button
          className={`additems-mode clickable ${mode === "byGame" ? "active" : ""}`}
          onClick={() => setMode("byGame")}
        >
          <Gamepad2 size={15} /> Chercher un jeu
        </button>
        <button
          className={`additems-mode clickable ${mode === "byName" ? "active" : ""}`}
          onClick={() => setMode("byName")}
        >
          <User size={15} /> Chercher un personnage
        </button>
      </div>

      {mode === "byGame" ? (
        <CharByGame token={token} existing={existing} onToggle={onToggle} />
      ) : (
        <CharByName token={token} existing={existing} onToggle={onToggle} />
      )}
    </>
  );
}

// --- Mode "par jeu" : on cherche un jeu, puis ses personnages ---
function CharByGame({ token, existing, onToggle }) {
  const [game, setGame] = useState(null);
  const [q, setQ] = useState("");
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [withChars, setWithChars] = useState(new Set()); // ids de jeux avec persos
  const [onlyWith, setOnlyWith] = useState(false);
  const reqRef = useRef(0);

  const runSearch = useCallback(
    (term) => {
      const t = term.trim();
      const id = ++reqRef.current;
      setLoading(true);
      const done = (list) => {
        if (id !== reqRef.current) return;
        setGames(list);
        setLoading(false);
        // Signale les jeux ayant des personnages (IGDB ou communauté).
        const ids = list.map((g) => g.id);
        if (ids.length) {
          apiFetch(`/games/characters-availability?ids=${ids.join(",")}`, { token })
            .then((d) => id === reqRef.current && setWithChars(new Set(d.ids || [])))
            .catch(() => {});
        } else {
          setWithChars(new Set());
        }
      };
      if (!t) {
        loadPopularGames(token).then(done).catch(() => done([]));
        return;
      }
      const params = new URLSearchParams({ limit: 24, sort: "popularity" });
      params.set("search", t);
      apiFetch(`/games?${params}`, { token })
        .then((d) => done(d.games || []))
        .catch(() => done([]));
    },
    [token]
  );

  // Chargement initial (jeux populaires) une seule fois. On NE relance PAS au
  // retour depuis un jeu, sinon on écraserait les résultats de recherche.
  useEffect(() => {
    runSearch("");
  }, [runSearch]);

  function submit(e) {
    e.preventDefault();
    runSearch(q);
  }

  if (game) {
    return (
      <CharsOfGame
        game={game}
        token={token}
        existing={existing}
        onToggle={onToggle}
        onBack={() => setGame(null)}
      />
    );
  }

  const shown = onlyWith ? games.filter((g) => withChars.has(g.id)) : games;

  return (
    <>
      <form className="additems-search" onSubmit={submit}>
        <SearchBar value={q} onChange={setQ} loading={loading} placeholder="Rechercher un jeu…">
          <button type="submit" className="additems-search-btn clickable">
            Rechercher
          </button>
        </SearchBar>
      </form>
      <div className="additems-filterrow">
        <button
          type="button"
          className={`additems-toggle clickable ${onlyWith ? "on" : ""}`}
          onClick={() => setOnlyWith((v) => !v)}
        >
          <Users size={14} /> Avec personnages
          <span className="additems-toggle-track" aria-hidden="true">
            <span className="additems-toggle-knob" />
          </span>
        </button>
      </div>
      <div className="additems-grid">
        {shown.map((g) => (
          <GameCardPick
            key={g.id}
            game={g}
            hasChars={withChars.has(g.id)}
            arrow
            onClick={() => setGame(g)}
          />
        ))}
      </div>
      {!loading && shown.length === 0 && (
        <p className="additems-hint font-fun">
          {onlyWith ? "Aucun jeu avec personnages ici." : "Aucun jeu trouvé."}
        </p>
      )}
    </>
  );
}

// --- Personnages d'un jeu (IGDB + communauté), avec ajout perso custom ---
function CharsOfGame({ game, token, existing, onToggle, onBack }) {
  const [chars, setChars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`/games/${game.id}/details`, { token })
      .then((d) => alive && setChars(d.characters || []))
      .catch(() => alive && setChars([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [game.id, token]);

  return (
    <>
      <div className="additems-crumb">
        <button className="crumb-back clickable" onClick={onBack}>
          <ArrowLeft size={16} /> Jeux
        </button>
        <span className="crumb-current">{game.name}</span>
      </div>

      {loading ? (
        <div className="additems-loading">
          <Loader2 size={18} className="spin" /> Chargement des personnages…
        </div>
      ) : (
        <>
          {chars.length === 0 && (
            <p className="additems-hint font-fun" style={{ padding: "1rem 0" }}>
              Aucun personnage connu pour ce jeu — ajoute le tien&nbsp;!
            </p>
          )}
          <div className="additems-grid chars">
            {chars.map((c) => {
              const refId = String(c.id);
              return (
                <CharCardPick
                  key={c.id}
                  char={c}
                  added={existing.has(refId)}
                  onClick={() =>
                    onToggle({
                      kind: "character",
                      refId,
                      gameId: game.id,
                      gameName: game.name,
                      name: c.name,
                      image: c.image,
                    })
                  }
                />
              );
            })}
            {/* Ajouter mon propre personnage */}
            <button className="pick-card char add clickable" onClick={() => setAdding(true)}>
              <div className="pick-cover char add">
                <UserPlus size={22} />
              </div>
              <span className="pick-name">Ajouter</span>
            </button>
          </div>
        </>
      )}

      {adding && (
        <AddCharacterModal
          gameId={game.id}
          onClose={() => setAdding(false)}
          onAdded={(c) => setChars((prev) => [c, ...prev])}
        />
      )}
    </>
  );
}

// --- Mode "par nom" : recherche directe de personnages ---
function CharByName({ token, existing, onToggle }) {
  const [q, setQ] = useState("");
  const [chars, setChars] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const reqRef = useRef(0);

  function submit(e) {
    e.preventDefault();
    const t = q.trim();
    if (!t) return;
    const id = ++reqRef.current;
    setLoading(true);
    setSearched(true);
    apiFetch(`/games/characters-search?q=${encodeURIComponent(t)}`, { token })
      .then((d) => id === reqRef.current && setChars(d.characters || []))
      .catch(() => id === reqRef.current && setChars([]))
      .finally(() => id === reqRef.current && setLoading(false));
  }

  return (
    <>
      <form className="additems-search" onSubmit={submit}>
        <SearchBar
          value={q}
          onChange={setQ}
          loading={loading}
          placeholder="Nom du personnage…"
        >
          <button type="submit" className="additems-search-btn clickable">
            Rechercher
          </button>
        </SearchBar>
      </form>
      <div className="additems-grid chars">
        {chars.map((c) => {
          const refId = String(c.id);
          return (
            <CharCardPick
              key={c.id}
              char={c}
              withGame
              added={existing.has(refId)}
              onClick={() =>
                onToggle({
                  kind: "character",
                  refId,
                  gameId: c.gameId,
                  gameName: c.gameName,
                  name: c.name,
                  image: c.image,
                })
              }
            />
          );
        })}
      </div>
      {!loading && searched && chars.length === 0 && (
        <p className="additems-hint font-fun">Aucun personnage trouvé.</p>
      )}
      {!searched && (
        <p className="additems-hint font-fun">Tape un nom de personnage et valide.</p>
      )}
    </>
  );
}

// --- Carte jeu (recherche) ---
function GameCardPick({ game, added, hasChars, arrow, onClick }) {
  return (
    <button
      className={`pick-card clickable ${added ? "added" : ""}`}
      onClick={onClick}
      title={game.name}
    >
      <div className="pick-cover">
        {game.cover ? (
          <img src={game.cover} alt={game.name} loading="lazy" draggable="false" />
        ) : (
          <Gamepad2 size={24} />
        )}
        {hasChars && (
          <span className="pick-flag" title="Ce jeu a des personnages">
            <Users size={12} />
          </span>
        )}
        <span className={`pick-check ${arrow ? "arrow" : ""}`}>
          {arrow ? (
            <ArrowLeft size={16} style={{ transform: "rotate(180deg)" }} />
          ) : added ? (
            <Check size={16} />
          ) : (
            <Plus size={16} />
          )}
        </span>
      </div>
      <span className="pick-name">{game.name}</span>
    </button>
  );
}

// --- Carte personnage (recherche / liste) ---
function CharCardPick({ char, added, withGame, onClick }) {
  return (
    <button
      className={`pick-card char clickable ${added ? "added" : ""}`}
      onClick={onClick}
      title={char.name}
    >
      <div className="pick-cover char">
        {char.image ? (
          <img src={char.image} alt={char.name} loading="lazy" draggable="false" />
        ) : (
          <User size={24} />
        )}
        <span className="pick-check">
          {added ? <Check size={16} /> : <Plus size={16} />}
        </span>
      </div>
      <span className="pick-name">{char.name}</span>
      {withGame && char.gameName && (
        <span className="pick-sub">{char.gameName}</span>
      )}
    </button>
  );
}
