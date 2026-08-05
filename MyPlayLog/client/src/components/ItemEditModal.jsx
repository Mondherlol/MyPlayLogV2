import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Gamepad2, User } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Composer } from "./ListComments";

// Modal d'édition de l'annotation d'un élément de liste : un texte riche
// (emoji + GIF/images, comme les commentaires). Plus de note chiffrée.
export default function ItemEditModal({ item, onSave, onClose }) {
  const { token } = useAuth();
  const isChar = item.kind === "character";
  // État vivant du composer (remonté via onLiveChange).
  const draft = useRef({ text: item.note || "", media: item.media || [] });
  const [, force] = useState(0);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const empty =
    !draft.current.text.trim() && draft.current.media.length === 0;

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
          <label>Ton annotation</label>
          <Composer
            token={token}
            big
            initialText={item.note || ""}
            initialMedia={item.media || []}
            placeholder="Un mot, un GIF, une réaction…"
            onLiveChange={({ text, media }) => {
              draft.current = { text, media };
              force((n) => n + 1);
            }}
          />
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            onClick={() =>
              onSave({ note: draft.current.text.trim(), media: draft.current.media })
            }
          >
            <Check size={18} /> {empty ? "Retirer l'annotation" : "Valider"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
