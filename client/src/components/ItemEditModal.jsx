import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Gamepad2, User, Star, Trash2 } from "lucide-react";

// Modal d'édition d'un élément de liste : commentaire de l'auteur + note.
export default function ItemEditModal({ item, onSave, onClose }) {
  const [note, setNote] = useState(item.note || "");
  const [rating, setRating] = useState(item.rating);
  const isChar = item.kind === "character";

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const color =
    rating == null ? "var(--border-strong)" : rating < 40 ? "#e0483f" : rating < 70 ? "#f2b70b" : "#22a35a";

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal item-edit-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        <div className="ie-head">
          <div className="ie-cover">
            {item.image ? (
              <img src={item.image} alt={item.name} draggable="false" />
            ) : isChar ? (
              <User size={26} />
            ) : (
              <Gamepad2 size={26} />
            )}
          </div>
          <div>
            <h2 className="ie-name">{item.name}</h2>
            {isChar && item.gameName && <p className="ie-sub">{item.gameName}</p>}
          </div>
        </div>

        <div className="field">
          <label>
            Note {rating != null && <strong style={{ color }}>{rating}/100</strong>}
          </label>
          <div className="ie-rating">
            <input
              type="range"
              min="0"
              max="100"
              value={rating ?? 0}
              onChange={(e) => setRating(Number(e.target.value))}
              style={{ accentColor: color }}
            />
            {rating != null ? (
              <button
                className="ie-rating-clear clickable"
                onClick={() => setRating(null)}
                title="Retirer la note"
              >
                <Trash2 size={14} />
              </button>
            ) : (
              <button
                className="ie-rating-clear clickable"
                onClick={() => setRating(75)}
                title="Noter"
              >
                <Star size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor="ie-note">Ton commentaire</label>
          <textarea
            id="ie-note"
            className="modal-textarea"
            placeholder="Pourquoi ce jeu à cette place ?"
            value={note}
            maxLength={500}
            rows={4}
            autoFocus
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onSave({ note: note.trim(), rating })}
          >
            <Check size={18} /> Valider
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
