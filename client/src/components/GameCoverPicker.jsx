import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Upload, X } from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";

// Sélecteur de jaquette (ouvert en cliquant la cover sur la page) : mêmes
// jaquettes que la modale (IGDB + covers custom) + upload d'une image perso.
export default function GameCoverPicker({
  gameId,
  token,
  currentCover,
  onPick,
  onClose,
  title = "Choisir une jaquette",
  // `wide` : on choisit une PHOTO DE COUVERTURE, pas une jaquette — que du
  // paysage (artworks, captures), comme sur l'app mobile.
  wide = false,
  extraImages = [],
}) {
  const [covers, setCovers] = useState(null);
  const [uploading, setUploading] = useState(false);
  // ⚠️ LES JAQUETTES (PORTRAIT) SONT ÉCARTÉES EN MODE PAYSAGE : une image 3/4
  // posée en fond d'une page large ne montre qu'un bout de ciel. On y ajoute
  // les captures et artworks que la fiche a déjà chargés, et on dédoublonne —
  // les mêmes artworks arrivent des deux côtés.
  const seen = new Set();
  const shown = (wide
    ? [
        ...extraImages.map((url) => ({ id: url, url })),
        ...(covers || []).filter((c) => !String(c.url).includes("/t_cover_big/")),
      ]
    : covers || []
  ).filter((c) => c.url && !seen.has(c.url) && seen.add(c.url));
  const fileRef = useRef(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    let alive = true;
    apiFetch(`/games/${gameId}/details`, { token })
      .then((d) => alive && setCovers(d.covers || []))
      .catch(() => alive && setCovers([]));
    return () => {
      alive = false;
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [gameId, token, onClose]);

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("cover", file);
      const data = await apiUpload(`/games/${gameId}/cover`, fd, token);
      onPick(data.cover.url);
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
    }
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose} onClick={(e) => e.stopPropagation()}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
        <div className="cover-picker">
          <h3 className="picker-title">{title}</h3>
          {covers === null ? (
            <div style={{ display: "grid", placeItems: "center", padding: "2.5rem" }}>
              <Loader2 size={24} className="spin" />
            </div>
          ) : (
            <div className={`picker-grid ${wide ? "wide" : ""}`}>
              <button
                className="picker-upload clickable"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 size={22} className="spin" />
                ) : (
                  <>
                    <Upload size={22} />
                    <span>Uploader</span>
                  </>
                )}
              </button>
              {shown.map((c) => (
                <button
                  key={c.id}
                  className={`picker-item clickable ${currentCover === c.url ? "active" : ""}`}
                  onClick={() => {
                    onPick(c.url);
                    onClose();
                  }}
                >
                  <img src={c.url} alt="" loading="lazy" />
                  {c.custom && <span className="picker-badge">custom</span>}
                  {currentCover === c.url && (
                    <span className="picker-check">
                      <Check size={16} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
        </div>
      </div>
    </div>,
    document.body
  );
}
