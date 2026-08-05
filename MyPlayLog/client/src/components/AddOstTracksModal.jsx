import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Search,
  Loader2,
  Check,
  Plus,
  Gamepad2,
  Music,
  Disc3,
  ArrowLeft,
  Play,
  Pause,
  Pencil,
  Trash2,
  RotateCcw,
  TextCursorInput,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { usePlayer } from "../context/PlayerContext";
import { loadPopularGames } from "../lib/popularGames";
import AddOstModal from "./AddOstModal";
import MassRenameOstModal from "./MassRenameOstModal";
import { ostCache, normalizeOstCache } from "./GameOst";

// Modal d'ajout de pistes à une PlayList : on cherche un jeu, puis on pioche
// dans son OST. Mêmes pouvoirs que l'onglet OST de la page jeu : ajout YouTube
// (piste ou playlist), retrait/corbeille, renommage (à l'unité ou en masse) —
// de quoi corriger une OST bancale sans quitter la playlist. Cliquer sur une
// piste l'ajoute/retire ; la vignette sert de pré-écoute.
export default function AddOstTracksModal({ existing, onToggle, onClose }) {
  const { token } = useAuth();
  const [game, setGame] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal additems-modal aost-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        <h2 className="modal-title">
          <Disc3 size={20} /> Ajouter des OST
        </h2>

        {game ? (
          <TracksOfGame
            game={game}
            token={token}
            existing={existing}
            onToggle={onToggle}
            onBack={() => setGame(null)}
          />
        ) : (
          <GamePick token={token} onPick={setGame} />
        )}

        <div className="additems-foot">
          <span className="additems-count">
            {existing.size} piste{existing.size > 1 ? "s" : ""} dans la playlist
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

// --- Étape 1 : choisir un jeu (recherche IGDB, populaires par défaut) ---
function GamePick({ token, onPick }) {
  const [q, setQ] = useState("");
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

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

  return (
    <>
      <form
        className="additems-search"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(q);
        }}
      >
        <Search size={18} />
        <input
          autoFocus
          placeholder="Rechercher un jeu…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {loading && <Loader2 size={16} className="spin" />}
        <button type="submit" className="additems-search-btn clickable">
          Rechercher
        </button>
      </form>
      <div className="additems-grid">
        {games.map((g) => (
          <button
            key={g.id}
            className="pick-card clickable"
            onClick={() => onPick(g)}
            title={g.name}
          >
            <div className="pick-cover">
              {g.cover ? (
                <img src={g.cover} alt={g.name} loading="lazy" draggable="false" />
              ) : (
                <Gamepad2 size={24} />
              )}
              <span className="pick-check arrow">
                <ArrowLeft size={16} style={{ transform: "rotate(180deg)" }} />
              </span>
            </div>
            <span className="pick-name">{g.name}</span>
          </button>
        ))}
      </div>
      {!loading && games.length === 0 && (
        <p className="additems-hint font-fun">Aucun jeu trouvé.</p>
      )}
    </>
  );
}

// --- Étape 2 : les pistes de l'OST du jeu choisi ---
function TracksOfGame({ game, token, existing, onToggle, onBack }) {
  const player = usePlayer();
  const [tracks, setTracks] = useState([]);
  const [trash, setTrash] = useState([]); // pistes retirées (corbeille)
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false); // AddOstModal (YouTube)
  const [renamingAll, setRenamingAll] = useState(false); // MassRenameOstModal
  const [showTrash, setShowTrash] = useState(false);
  const [rename, setRename] = useState(null); // { id, value } — renommage inline

  // Comme dans GameOst : chaque mutation met aussi à jour le cache partagé de
  // l'onglet OST de la page jeu (mêmes clés localStorage).
  const commit = useCallback(
    (nextTracks, nextTrash) => {
      setTracks(nextTracks);
      setTrash(nextTrash);
      ostCache.set(String(game.id), { tracks: nextTracks, trash: nextTrash });
    },
    [game.id]
  );

  useEffect(() => {
    const c = ostCache.get(String(game.id));
    if (c?.fresh) {
      const n = normalizeOstCache(c.data);
      setTracks(n.tracks);
      setTrash(n.trash);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    apiFetch(`/games/${game.id}/ost?q=${encodeURIComponent(game.name)}`, { token })
      .then((d) => {
        if (!alive) return;
        const list = d.tracks || [];
        const hiddenList = d.hiddenTracks || [];
        setTracks(list);
        setTrash(hiddenList);
        ostCache.set(String(game.id), { tracks: list, trash: hiddenList });
      })
      .catch(() => alive && setTracks([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [game.id, game.name, token]);

  // Retire des pistes (corbeille, restaurable) — best-effort côté serveur.
  async function hide(ids) {
    const idset = new Set(ids);
    const removed = tracks.filter((t) => idset.has(t.id));
    commit(tracks.filter((t) => !idset.has(t.id)), [...removed, ...trash]);
    if (removed.some((t) => player.isCurrent(t))) player.close();
    try {
      await apiFetch(`/games/${game.id}/ost/hide`, {
        method: "POST",
        token,
        body: { ids },
      });
    } catch {
      /* best-effort */
    }
  }

  async function restore(ids) {
    const idset = new Set(ids);
    const back = trash.filter((t) => idset.has(t.id));
    if (!back.length) return;
    commit([...tracks, ...back], trash.filter((t) => !idset.has(t.id)));
    if (trash.length === back.length) setShowTrash(false);
    try {
      await apiFetch(`/games/${game.id}/ost/unhide`, {
        method: "POST",
        token,
        body: { ids },
      });
    } catch {
      /* best-effort */
    }
  }

  // Renommage inline d'une seule piste (même endpoint que le renommage en masse).
  async function submitRename() {
    const r = rename;
    setRename(null);
    if (!r) return;
    const name = r.value.trim();
    const before = tracks.find((t) => t.id === r.id);
    if (!name || !before || name === before.name) return;
    commit(
      tracks.map((t) => (t.id === r.id ? { ...t, name } : t)),
      trash
    );
    try {
      await apiFetch(`/games/${game.id}/ost/rename`, {
        method: "POST",
        token,
        body: { renames: [{ id: r.id, name }] },
      });
    } catch {
      /* best-effort */
    }
  }

  function applyRenames(byId) {
    commit(
      tracks.map((t) => (byId.has(t.id) ? { ...t, name: byId.get(t.id) } : t)),
      trash
    );
  }

  const shown = filter
    ? tracks.filter((t) =>
        `${t.name} ${t.artist}`.toLowerCase().includes(filter.toLowerCase())
      )
    : tracks;

  // Piste OST (page jeu) → item de playlist (kind "track").
  const toItem = (t) => ({
    kind: "track",
    refId: t.id,
    gameId: game.id,
    gameName: game.name,
    name: t.name,
    image: t.artwork || null,
    videoId: t.videoId || null,
    url: t.url || null,
    artist: t.artist && t.artist !== "YouTube" ? t.artist : null,
  });

  return (
    <>
      <div className="additems-crumb">
        <button className="crumb-back clickable" onClick={onBack}>
          <ArrowLeft size={16} /> Jeux
        </button>
        <span className="crumb-current">{game.name}</span>
        <div className="aost-tools">
          {tracks.length > 6 && (
            <input
              className="aost-filter"
              placeholder="Filtrer…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
          <button
            className="aost-tool clickable"
            onClick={() => setAdding(true)}
            title="Ajouter une OST YouTube (piste ou playlist)"
          >
            <Plus size={15} />
          </button>
          {tracks.length > 0 && (
            <button
              className="aost-tool clickable"
              onClick={() => setRenamingAll(true)}
              title="Renommer en masse"
            >
              <TextCursorInput size={15} />
            </button>
          )}
          {trash.length > 0 && (
            <button
              className={`aost-tool clickable ${showTrash ? "active" : ""}`}
              onClick={() => setShowTrash((v) => !v)}
              title="Pistes retirées"
            >
              <RotateCcw size={15} />
              <span className="aost-tool-count">{trash.length}</span>
            </button>
          )}
          {shown.length > 0 && (
            <button
              className="aost-tool danger clickable"
              onClick={() => hide(shown.map((t) => t.id))}
              title="Tout retirer (vider l'OST du jeu)"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      {showTrash && trash.length > 0 && (
        <div className="aost-trash">
          <span className="aost-trash-title">
            <Trash2 size={13} /> Pistes retirées
          </span>
          <div className="aost-trash-list">
            {trash.map((t) => (
              <button
                key={t.id}
                className="aost-trash-item clickable"
                onClick={() => restore([t.id])}
                title="Restaurer cette piste"
              >
                <RotateCcw size={12} />
                <span>{t.name}</span>
              </button>
            ))}
          </div>
          <button
            className="aost-trash-all clickable"
            onClick={() => restore(trash.map((t) => t.id))}
          >
            <RotateCcw size={13} /> Tout restaurer
          </button>
        </div>
      )}

      {loading ? (
        <div className="additems-loading">
          <Loader2 size={18} className="spin" /> Chargement de l'OST…
        </div>
      ) : shown.length === 0 ? (
        <p className="additems-hint font-fun" style={{ padding: "1rem 0" }}>
          {filter
            ? `Aucune piste pour « ${filter} ».`
            : "Aucune OST trouvée pour ce jeu — ajoute-en une depuis YouTube (+)."}
        </p>
      ) : (
        <div className="aost-tracks">
          {shown.map((t) => {
            const added = existing.has(t.id);
            const isCurrent = player.isCurrent(t);
            const isPlaying = player.isPlaying(t);
            const isRenaming = rename?.id === t.id;
            return (
              <div
                className={`aost-track clickable ${added ? "added" : ""} ${
                  isCurrent ? "current" : ""
                }`}
                key={t.id}
                onClick={() => !isRenaming && onToggle(toItem(t))}
                title={added ? "Retirer de la playlist" : "Ajouter à la playlist"}
              >
                <button
                  className="aost-track-art clickable"
                  onClick={(e) => {
                    e.stopPropagation();
                    player.toggleTrack(t, [t], {
                      gameId: game.id,
                      gameName: game.name,
                    });
                  }}
                  title={isPlaying ? "Pause" : "Pré-écouter"}
                >
                  {t.artwork ? (
                    <img src={t.artwork} alt="" loading="lazy" draggable="false" />
                  ) : (
                    <Music size={16} />
                  )}
                  <span className={`aost-track-play ${isPlaying ? "on" : ""}`}>
                    {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                  </span>
                </button>
                <span className="aost-track-txt">
                  {isRenaming ? (
                    <input
                      className="aost-rename-input"
                      autoFocus
                      value={rename.value}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRename({ id: t.id, value: e.target.value })}
                      onBlur={submitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitRename();
                        if (e.key === "Escape") setRename(null);
                      }}
                    />
                  ) : (
                    <span className="aost-track-name" title={t.name}>
                      {isCurrent && (
                        <span
                          className={`pld-eq ${isPlaying ? "" : "paused"}`}
                          aria-hidden="true"
                        >
                          <i /><i /><i />
                        </span>
                      )}
                      {t.name}
                    </span>
                  )}
                  {t.artist && t.artist !== "YouTube" && !isRenaming && (
                    <span className="aost-track-artist">{t.artist}</span>
                  )}
                </span>
                <span className="aost-track-actions">
                  <button
                    className="aost-tool clickable"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRename({ id: t.id, value: t.name });
                    }}
                    title="Renommer cette piste"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="aost-tool danger clickable"
                    onClick={(e) => {
                      e.stopPropagation();
                      hide([t.id]);
                    }}
                    title="Retirer cette OST (corbeille)"
                  >
                    <Trash2 size={13} />
                  </button>
                  <span className={`aost-track-toggle ${added ? "on" : ""}`}>
                    {added ? <Check size={16} /> : <Plus size={16} />}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <AddOstModal
          gameId={game.id}
          token={token}
          onClose={() => setAdding(false)}
          onAdded={(arr) => commit([...arr, ...tracks], trash)}
        />
      )}

      {renamingAll && (
        <MassRenameOstModal
          gameId={game.id}
          token={token}
          tracks={tracks}
          onClose={() => setRenamingAll(false)}
          onApply={applyRenames}
        />
      )}
    </>
  );
}
