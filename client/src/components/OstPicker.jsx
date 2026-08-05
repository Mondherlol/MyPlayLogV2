import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Play, Pause, Star, Music, Loader2, Search, Plus, X, Trash2 } from "lucide-react";
import { apiFetch } from "../lib/api";
import { loadYT } from "../lib/youtube";
import { usePlayer } from "../context/PlayerContext";
import ScrollRow from "./ScrollRow";
import AddOstModal from "./AddOstModal";

// Liste l'OST du jeu (extraits iTunes + pistes YouTube jouées inline) avec
// recherche texte, ajout, masquage (clic droit) et choix d'un favori.
export default function OstPicker({ gameId, gameName, token, favorite, onSelect }) {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(null); // { x, y, track }

  const audioRef = useRef(null);
  const ytRef = useRef(null); // player YouTube
  const ytDivRef = useRef(null);
  const globalPlayer = usePlayer(); // barre audio globale (à mettre en pause)

  useEffect(() => {
    let alive = true;
    apiFetch(`/games/${gameId}/ost?q=${encodeURIComponent(gameName)}`, { token })
      .then((d) => alive && setTracks(d.tracks || []))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [gameId, gameName, token]);

  // Player YouTube caché (lecture audio inline)
  useEffect(() => {
    let destroyed = false;
    loadYT().then((YT) => {
      if (destroyed || !ytDivRef.current) return;
      ytRef.current = new YT.Player(ytDivRef.current, {
        height: "0",
        width: "0",
        playerVars: { autoplay: 0, playsinline: 1 },
        events: {
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) setPlayingId(null);
          },
        },
      });
    });
    return () => {
      destroyed = true;
      try {
        ytRef.current?.destroy();
      } catch {
        /* ignore */
      }
    };
  }, []);

  // Coupe tout à la fermeture
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio && audio.pause();
      try {
        ytRef.current?.stopVideo?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  function toggle(t) {
    if (t.youtube) {
      audioRef.current?.pause();
      if (playingId === t.id) {
        ytRef.current?.pauseVideo?.();
        setPlayingId(null);
        return;
      }
      globalPlayer?.pause?.(); // coupe la barre audio globale, on relance à la main
      ytRef.current?.loadVideoById?.(t.videoId); // autoplay
      setPlayingId(t.id);
      return;
    }
    try {
      ytRef.current?.pauseVideo?.();
    } catch {
      /* ignore */
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === t.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    globalPlayer?.pause?.(); // coupe la barre audio globale
    audio.src = t.preview;
    audio.play().catch(() => {});
    setPlayingId(t.id);
  }

  async function hide(ids) {
    setMenu(null);
    setTracks((prev) => prev.filter((t) => !ids.includes(t.id)));
    if (ids.includes(playingId)) {
      audioRef.current?.pause();
      try {
        ytRef.current?.stopVideo?.();
      } catch {
        /* ignore */
      }
      setPlayingId(null);
    }
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

  const isFav = (t) =>
    favorite && favorite.name === t.name && favorite.artist === t.artist;

  const filtered = query
    ? tracks.filter((t) =>
        `${t.name} ${t.artist}`.toLowerCase().includes(query.toLowerCase())
      )
    : tracks;

  return (
    <>
      <div ref={ytDivRef} style={{ display: "none" }} />
      <div className="ost-head">
        <span className="field-label" style={{ margin: 0 }}>
          OST favorite
        </span>
        <div className={`ost-search ${searchOpen ? "open" : ""}`}>
          <input
            className="ost-search-input"
            placeholder="Filtrer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="ost-search-btn clickable"
            onClick={() => {
              setSearchOpen((v) => !v);
              if (searchOpen) setQuery("");
            }}
            aria-label="Rechercher"
          >
            {searchOpen ? <X size={16} /> : <Search size={16} />}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="ost-loading">
          <Loader2 size={16} className="spin" /> Recherche de l'OST…
        </div>
      ) : (
        <>
          <audio ref={audioRef} onEnded={() => setPlayingId(null)} hidden />
          <ScrollRow className="ost-row">
            {filtered.map((t) => {
              const fav = isFav(t);
              const playing = playingId === t.id;
              return (
                <div
                  key={t.id}
                  className={`ost-card ${fav ? "fav" : ""}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, track: t });
                  }}
                >
                  <div className="ost-art">
                    {t.artwork ? (
                      <img src={t.artwork} alt="" loading="lazy" />
                    ) : (
                      <Music size={22} />
                    )}
                    <button
                      className={`ost-play clickable ${playing ? "playing" : ""}`}
                      onClick={() => toggle(t)}
                      title={playing ? "Pause" : "Écouter"}
                    >
                      {playing ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <button
                      className="ost-star clickable"
                      onClick={() => onSelect(fav ? null : t)}
                      title={fav ? "Retirer des favoris" : "OST favorite"}
                    >
                      <Star size={13} fill={fav ? "currentColor" : "none"} />
                    </button>
                  </div>
                  <span className="ost-name" title={t.name}>
                    {t.name}
                  </span>
                  <span className="ost-artist">{t.artist}</span>
                </div>
              );
            })}

            <button
              className="ost-card ost-add clickable"
              onClick={() => setAdding(true)}
              title="Ajouter une OST YouTube"
            >
              <div className="ost-art add">
                <Plus size={24} />
              </div>
              <span className="ost-name">Ajouter</span>
              <span className="ost-artist">YouTube</span>
            </button>
          </ScrollRow>

          {filtered.length === 0 && query && (
            <div className="ost-none">Aucun résultat pour « {query} ».</div>
          )}
        </>
      )}

      {/* Menu clic droit */}
      {menu &&
        createPortal(
          <>
            <div className="ctx-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
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
          onAdded={(arr) => setTracks((prev) => [...arr, ...prev])}
        />
      )}
    </>
  );
}
