import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Check, Loader2, Disc3, Music } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import CreateListModal from "./CreateListModal";

// Modale « Ajouter à une playlist » (depuis l'onglet OST d'un jeu).
// Même mécanique que AddToListModal (quick-add) mais pour une piste d'OST :
// montre mes playlists, permet d'y ajouter/retirer la piste, et d'en créer
// une à la volée qui contiendra directement la piste.
export default function AddToPlaylistModal({ track, gameId, gameName, onClose }) {
  const { token } = useAuth();
  const refId = String(track.id);
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // id de playlist en cours de bascule
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`/lists/mine/for-item?refId=${encodeURIComponent(refId)}&kind=ost`, {
      token,
    })
      .then((d) => alive && setLists(d.lists || []))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [refId, token]);

  const itemBody = {
    kind: "track",
    refId,
    gameId,
    gameName,
    name: track.name,
    image: track.artwork || null,
    videoId: track.videoId || null,
    url: track.url || null,
    artist: track.artist && track.artist !== "YouTube" ? track.artist : null,
  };

  async function toggle(list) {
    if (busy) return;
    setBusy(list.id);
    const willAdd = !list.contains;
    // Optimiste
    setLists((prev) =>
      prev.map((l) =>
        l.id === list.id
          ? { ...l, contains: willAdd, itemCount: l.itemCount + (willAdd ? 1 : -1) }
          : l
      )
    );
    try {
      if (willAdd) {
        await apiFetch(`/lists/${list.id}/items`, {
          method: "POST",
          token,
          body: itemBody,
        });
      } else {
        await apiFetch(`/lists/${list.id}/items/${encodeURIComponent(refId)}`, {
          method: "DELETE",
          token,
        });
      }
    } catch (e) {
      // Rollback
      setLists((prev) =>
        prev.map((l) =>
          l.id === list.id
            ? { ...l, contains: !willAdd, itemCount: l.itemCount + (willAdd ? -1 : 1) }
            : l
        )
      );
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  // Nouvelle playlist créée : on y ajoute la piste, puis on l'affiche en tête.
  async function onCreated(list) {
    setCreating(false);
    let added = false;
    try {
      const d = await apiFetch(`/lists/${list.id}/items`, {
        method: "POST",
        token,
        body: itemBody,
      });
      added = !!d.added;
    } catch (e) {
      setError(e.message);
    }
    setLists((prev) => [
      {
        id: list.id,
        title: list.title,
        cover: list.cover || null,
        type: "playlist",
        itemKind: "ost",
        visibility: list.visibility,
        itemCount: added ? 1 : 0,
        preview: added && track.artwork ? [track.artwork] : [],
        contains: added,
      },
      ...prev.filter((l) => l.id !== list.id),
    ]);
  }

  return createPortal(
    <>
      <div
        className="modal-overlay"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal addtolist-modal">
          <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>

          <h2 className="modal-title">
            <Disc3 size={20} /> Ajouter à une playlist
          </h2>
          <p className="atl-game">{track.name}</p>

          <button className="atl-create clickable" onClick={() => setCreating(true)}>
            <Plus size={16} /> Créer une nouvelle playlist
          </button>

          {error && <div className="alert alert-error">{error}</div>}

          {loading ? (
            <div className="atl-loading">
              <Loader2 size={20} className="spin" /> Chargement…
            </div>
          ) : lists.length === 0 ? (
            <p className="atl-empty font-fun">
              Tu n'as pas encore de playlist. Crées-en une !
            </p>
          ) : (
            <div className="atl-list">
              {lists.map((l) => (
                <button
                  key={l.id}
                  className={`atl-row clickable ${l.contains ? "on" : ""}`}
                  onClick={() => toggle(l)}
                  disabled={busy === l.id}
                >
                  <span className="atl-thumb">
                    {l.cover ? (
                      <img src={l.cover} alt="" draggable="false" />
                    ) : l.preview?.[0] ? (
                      <img src={l.preview[0]} alt="" draggable="false" />
                    ) : (
                      <Music size={18} />
                    )}
                  </span>
                  <span className="atl-info">
                    <span className="atl-title">{l.title}</span>
                    <span className="atl-meta">
                      <Disc3 size={12} /> PlayList · {l.itemCount} piste
                      {l.itemCount > 1 ? "s" : ""}
                    </span>
                  </span>
                  <span className="atl-toggle">
                    {busy === l.id ? (
                      <Loader2 size={16} className="spin" />
                    ) : l.contains ? (
                      <Check size={16} />
                    ) : (
                      <Plus size={16} />
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {creating && (
        <CreateListModal
          fixedType="playlist"
          onClose={() => setCreating(false)}
          onCreated={onCreated}
        />
      )}
    </>,
    document.body
  );
}
