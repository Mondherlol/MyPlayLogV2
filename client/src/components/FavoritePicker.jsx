import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Star } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";

// Choisir ses jeux favoris parmi ceux de sa bibliothèque.
export default function FavoritePicker({ entries, onClose }) {
  const { token } = useAuth();
  const { map, upsertLocal } = useLibrary();

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function toggle(e) {
    const next = !(map[e.gameId]?.favorite ?? e.favorite);
    upsertLocal(e.gameId, { favorite: next }); // retour visuel immédiat
    try {
      await apiFetch(`/library/${e.gameId}`, {
        method: "PUT",
        token,
        body: { favorite: next, name: e.name, cover: e.cover },
      });
    } catch (err) {
      upsertLocal(e.gameId, { favorite: !next }); // rollback
      alert(err.message);
    }
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal fav-picker" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
        <h2 className="modal-title">Choisir mes favoris</h2>
        <p className="review-sub">
          Clique sur une jaquette pour l'ajouter/retirer des favoris.
        </p>

        {entries.length === 0 ? (
          <div className="profile-empty">
            Aucun jeu dans ta bibliothèque pour l'instant.
          </div>
        ) : (
          <div className="favpick-grid">
            {entries.map((e) => {
              const fav = map[e.gameId]?.favorite ?? e.favorite;
              return (
                <button
                  key={e.gameId}
                  className={`favpick-item clickable ${fav ? "active" : ""}`}
                  onClick={() => toggle(e)}
                  title={e.name}
                >
                  {e.cover ? (
                    <img src={e.cover} alt={e.name} loading="lazy" />
                  ) : (
                    <div className="cover-ph">{e.name}</div>
                  )}
                  <span className="favpick-star">
                    <Star size={14} fill={fav ? "currentColor" : "none"} />
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>
            Terminé
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
