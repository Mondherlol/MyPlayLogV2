import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Play,
  Pause,
  Star,
  Music,
  Search,
  Plus,
  X,
  Trash2,
  Disc3,
  RotateCcw,
  TextCursorInput,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { makeCache } from "../lib/cache";
import { usePlayer } from "../context/PlayerContext";
import AddOstModal from "./AddOstModal";
import MassRenameOstModal from "./MassRenameOstModal";

// OST du jeu affichée sous forme de vinyles qui tournent pendant la lecture.
// Même fonctionnement que l'OstPicker de la modale (extraits iTunes + pistes
// YouTube inline, ajout, masquage clic droit, choix d'un favori) mais présenté
// pour l'onglet OST de la page jeu.

// Cache mémoire + localStorage : évite de relancer la recherche d'OST quand on
// quitte l'onglet puis qu'on y revient (TTL 30 min). Mis à jour après ajout/masquage.
const ostCache = makeCache("mpl_ost_", 30 * 60 * 1000);

// Normalise la donnée en cache : ancien format (tableau de pistes) ou nouveau
// format { tracks, trash }. Garantit toujours les deux listes.
function normalize(d) {
  if (!d) return { tracks: [], trash: [] };
  if (Array.isArray(d)) return { tracks: d, trash: [] };
  return { tracks: d.tracks || [], trash: d.trash || [] };
}

export default function GameOst({ gameId, gameName, token, favorite, onFavorite }) {
  const cached = normalize(ostCache.get(String(gameId))?.data);
  const [tracks, setTracks] = useState(cached.tracks);
  const [trash, setTrash] = useState(cached.trash); // pistes retirées (corbeille)
  const [loading, setLoading] = useState(!ostCache.get(String(gameId)));
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [query, setQuery] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [menu, setMenu] = useState(null); // { x, y, track }

  // Lecture déléguée au mini-lecteur global.
  const player = usePlayer();

  // Garde le cache à jour à chaque changement de liste (ajout/masquage/restauration).
  function commit(nextTracks, nextTrash) {
    setTracks(nextTracks);
    setTrash(nextTrash);
    ostCache.set(String(gameId), { tracks: nextTracks, trash: nextTrash });
  }

  useEffect(() => {
    const c = ostCache.get(String(gameId));
    if (c?.fresh) {
      const n = normalize(c.data);
      setTracks(n.tracks);
      setTrash(n.trash);
      setLoading(false);
      return;
    }
    let alive = true;
    if (!c) setLoading(true);
    apiFetch(`/games/${gameId}/ost?q=${encodeURIComponent(gameName)}`, { token })
      .then((d) => {
        if (!alive) return;
        const list = d.tracks || [];
        const hiddenList = d.hiddenTracks || [];
        setTracks(list);
        setTrash(hiddenList);
        ostCache.set(String(gameId), { tracks: list, trash: hiddenList });
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [gameId, gameName, token]);

  // Lance/bascule une piste dans le mini-lecteur global (file = pistes visibles).
  function toggle(t) {
    player.toggleTrack(t, filtered, { gameId, gameName });
  }

  async function hide(ids) {
    setMenu(null);
    const idset = new Set(ids);
    const removed = tracks.filter((t) => idset.has(t.id));
    // On déplace les pistes vers la corbeille (récupérables) plutôt que de les perdre.
    commit(
      tracks.filter((t) => !idset.has(t.id)),
      [...removed, ...trash]
    );
    // Si on retire la piste en cours de lecture, on ferme le mini-lecteur.
    if (removed.some((t) => player.isCurrent(t))) player.close();
    try {
      await apiFetch(`/games/${gameId}/ost/hide`, {
        method: "POST",
        token,
        body: { ids },
      });
    } catch {
      /* best-effort */
    }
  }

  // Restaure des pistes depuis la corbeille (les remet dans la liste).
  async function restore(ids) {
    const idset = new Set(ids);
    const back = trash.filter((t) => idset.has(t.id));
    if (!back.length) return;
    commit([...tracks, ...back], trash.filter((t) => !idset.has(t.id)));
    if (trash.length === back.length) setShowTrash(false);
    try {
      await apiFetch(`/games/${gameId}/ost/unhide`, {
        method: "POST",
        token,
        body: { ids },
      });
    } catch {
      /* best-effort */
    }
  }

  // Applique un renommage en masse (déjà persisté côté serveur par la modale).
  function applyRenames(byId) {
    commit(
      tracks.map((t) => (byId.has(t.id) ? { ...t, name: byId.get(t.id) } : t)),
      trash
    );
  }

  const isFav = (t) =>
    favorite && favorite.name === t.name && favorite.artist === t.artist;

  const filtered = query
    ? tracks.filter((t) =>
        `${t.name} ${t.artist}`.toLowerCase().includes(query.toLowerCase())
      )
    : tracks;

  return (
    <div className="gp-ost">
      <div className="gp-ost-head">
        <div className="gp-ost-title">
          <Disc3 size={18} />
          <span>Bande originale</span>
          {!loading && tracks.length > 0 && (
            <span className="gp-ost-count">{tracks.length}</span>
          )}
        </div>
        <div className="gp-ost-tools">
          <div className="gp-ost-search">
            <Search size={15} />
            <input
              className="gp-ost-search-input"
              placeholder="Filtrer les pistes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                className="gp-ost-search-clear clickable"
                onClick={() => setQuery("")}
                aria-label="Effacer"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {tracks.length > 0 && (
            <button
              className="gp-ost-trash-btn clickable"
              onClick={() => setRenaming(true)}
              title="Renommer en masse"
            >
              <TextCursorInput size={15} />
            </button>
          )}
          {trash.length > 0 && (
            <button
              className={`gp-ost-trash-btn clickable ${showTrash ? "active" : ""}`}
              onClick={() => setShowTrash((v) => !v)}
              title="Pistes retirées"
            >
              <Trash2 size={15} />
              <span className="gp-ost-count">{trash.length}</span>
            </button>
          )}
        </div>
      </div>

      {showTrash && trash.length > 0 && (
        <div className="gp-ost-trash">
          <div className="gp-ost-trash-head">
            <span className="gp-ost-trash-title">
              <Trash2 size={14} /> Pistes retirées
            </span>
            <button
              className="gp-ost-trash-all clickable"
              onClick={() => restore(trash.map((t) => t.id))}
            >
              <RotateCcw size={13} /> Tout restaurer
            </button>
          </div>
          <div className="gp-ost-trash-list">
            {trash.map((t) => (
              <div className="gp-ost-trash-item" key={t.id}>
                <div className="gp-ost-trash-art">
                  {t.artwork ? (
                    <img src={t.artwork} alt="" loading="lazy" draggable="false" />
                  ) : (
                    <Music size={16} />
                  )}
                </div>
                <div className="gp-ost-trash-txt">
                  <span className="gp-ost-trash-name" title={t.name}>
                    {t.name}
                  </span>
                  <span className="gp-ost-trash-artist" title={t.artist}>
                    {t.artist}
                  </span>
                </div>
                <button
                  className="gp-ost-trash-restore clickable"
                  onClick={() => restore([t.id])}
                  title="Restaurer cette piste"
                >
                  <RotateCcw size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="gp-ost-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div className="gp-ost-item" key={i}>
              <div className="gp-vinyl gp-vinyl-skel">
                <div className="gp-vinyl-disc" />
              </div>
              <div className="gp-ost-meta">
                <span className="gp-skel gp-skel-bar" style={{ width: "80%" }} />
                <span className="gp-skel gp-skel-bar sm" style={{ width: "55%" }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="gp-ost-grid">
            {filtered.map((t) => {
              const fav = isFav(t);
              const playing = player.isPlaying(t);
              return (
                <div className="gp-ost-item" key={t.id}>
                  <div
                    className={`gp-vinyl ${playing ? "playing" : ""} ${fav ? "fav" : ""}`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, track: t });
                    }}
                  >
                    {/* Le disque (grooves + étiquette artwork) tourne pendant la lecture */}
                    <div className="gp-vinyl-disc">
                      <div className="gp-vinyl-label">
                        {t.artwork ? (
                          <img src={t.artwork} alt="" loading="lazy" draggable="false" />
                        ) : (
                          <Music size={26} />
                        )}
                        <span className="gp-vinyl-hole" />
                      </div>
                    </div>
                    {/* Reflet fixe par-dessus le disque */}
                    <span className="gp-vinyl-sheen" />

                    <button
                      className="gp-vinyl-play clickable"
                      onClick={() => toggle(t)}
                      title={playing ? "Pause" : "Écouter"}
                      aria-label={playing ? "Pause" : "Écouter"}
                    >
                      {playing ? <Pause size={20} /> : <Play size={20} />}
                    </button>

                    <button
                      className="gp-vinyl-star clickable"
                      onClick={() => onFavorite?.(fav ? null : t)}
                      title={fav ? "Retirer des favoris" : "OST favorite"}
                    >
                      <Star size={14} fill={fav ? "currentColor" : "none"} />
                    </button>
                  </div>

                  <div className="gp-ost-meta">
                    <span className="gp-vinyl-name" title={t.name}>
                      {t.name}
                    </span>
                    <span className="gp-vinyl-artist" title={t.artist}>
                      {t.artist}
                    </span>
                  </div>
                </div>
              );
            })}

            <button
              className="gp-ost-item gp-ost-add clickable"
              onClick={() => setAdding(true)}
              title="Ajouter une OST YouTube"
            >
              <div className="gp-vinyl gp-vinyl-add">
                <div className="gp-vinyl-disc" />
                <span className="gp-vinyl-add-icon">
                  <Plus size={26} />
                </span>
              </div>
              <div className="gp-ost-meta">
                <span className="gp-vinyl-name">Ajouter</span>
                <span className="gp-vinyl-artist">depuis YouTube</span>
              </div>
            </button>
          </div>

          {filtered.length === 0 && query && (
            <div className="gp-ost-none">Aucune piste pour « {query} ».</div>
          )}
          {tracks.length === 0 && !query && (
            <div className="gp-ost-none">
              Aucune OST trouvée pour ce jeu — ajoute-en une depuis YouTube.
            </div>
          )}
        </>
      )}

      {/* Menu clic droit : masquer une piste / tout masquer */}
      {menu &&
        createPortal(
          <>
            <div
              className="ctx-backdrop"
              onClick={() => setMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu(null);
              }}
            />
            <div className="ctx-menu" style={{ top: menu.y, left: menu.x }}>
              <button className="ctx-item clickable" onClick={() => hide([menu.track.id])}>
                <Trash2 size={15} /> Retirer cette OST
              </button>
              <button
                className="ctx-item danger clickable"
                onClick={() => hide(filtered.map((t) => t.id))}
              >
                <Trash2 size={15} /> Tout retirer
              </button>
            </div>
          </>,
          document.body
        )}

      {adding && (
        <AddOstModal
          gameId={gameId}
          token={token}
          onClose={() => setAdding(false)}
          onAdded={(arr) => commit([...arr, ...tracks], trash)}
        />
      )}

      {renaming && (
        <MassRenameOstModal
          gameId={gameId}
          token={token}
          tracks={tracks}
          onClose={() => setRenaming(false)}
          onApply={applyRenames}
        />
      )}
    </div>
  );
}
