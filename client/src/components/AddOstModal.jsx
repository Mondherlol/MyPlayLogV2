import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Check, Music2, ListPlus } from "lucide-react";
import { apiFetch } from "../lib/api";
import { extractVideoId, extractPlaylistId } from "../lib/youtube";

// Ajouter une OST YouTube : titre auto depuis le lien, ou import de playlist.
export default function AddOstModal({ gameId, token, onClose, onAdded }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingTitle, setFetchingTitle] = useState(false);
  const debounce = useRef(null);

  const videoId = useMemo(() => extractVideoId(url), [url]);
  const playlistId = useMemo(() => extractPlaylistId(url), [url]);
  const playlistOnly = playlistId && !videoId;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const k = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", k);
    };
  }, [onClose]);

  // Titre auto depuis le lien vidéo (si pas édité à la main)
  useEffect(() => {
    if (!videoId || nameEdited) return;
    clearTimeout(debounce.current);
    setFetchingTitle(true);
    debounce.current = setTimeout(() => {
      apiFetch(`/games/yt-info?url=${encodeURIComponent(url)}`, { token })
        .then((d) => {
          if (!nameEdited && d.title) setName(d.title);
        })
        .catch(() => {})
        .finally(() => setFetchingTitle(false));
    }, 350);
    return () => clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  async function addSingle() {
    if (!videoId || saving) return;
    setSaving(true);
    try {
      const d = await apiFetch(`/games/${gameId}/ost`, {
        method: "POST",
        token,
        body: { url, name: name.trim() || undefined },
      });
      onAdded([d.track]);
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function importPlaylist() {
    if (!playlistId || saving) return;
    setSaving(true);
    try {
      const d = await apiFetch(`/games/${gameId}/ost/playlist`, {
        method: "POST",
        token,
        body: { url },
      });
      onAdded(d.tracks || []);
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-overlay sub" onMouseDown={onClose}>
      <div className="modal add-ost-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
        <h2 className="modal-title">
          <Music2 size={22} className="yt-icon" /> Ajouter une OST YouTube
        </h2>
        <p className="review-sub">
          
          Colle un lien d'une vidéo ou d'une playlist entière.
        </p>

        <label className="field-label">Lien YouTube</label>
        <input
          className="modal-input"
          placeholder="Vidéo ou playlist YouTube…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
        />

        {playlistOnly ? (
          <div className="playlist-note">
            <ListPlus size={16} /> Toute la playlist sera importée comme OST de ce jeu.
          </div>
        ) : videoId ? (
          <>
            <label className="field-label">
              Titre {fetchingTitle && <Loader2 size={12} className="spin" />}
            </label>
            <input
              className="modal-input"
              placeholder="Titre de la piste"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameEdited(true);
              }}
              onKeyDown={(e) => e.key === "Enter" && addSingle()}
            />
            {playlistId && (
              <button
                className="playlist-link clickable"
                onClick={importPlaylist}
                disabled={saving}
              >
                <ListPlus size={14} /> ou importer toute la playlist
              </button>
            )}
          </>
        ) : (
          url.trim() && <div className="ost-none">Lien YouTube non reconnu.</div>
        )}

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Annuler
          </button>
          {playlistOnly ? (
            <button
              className="btn btn-primary"
              onClick={importPlaylist}
              disabled={saving || !playlistId}
            >
              {saving ? <Loader2 size={16} className="spin" /> : <ListPlus size={16} />}
              Importer la playlist
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={addSingle}
              disabled={saving || !videoId}
            >
              {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              Ajouter
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
