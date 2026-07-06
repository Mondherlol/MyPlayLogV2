import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, User, Check } from "lucide-react";
import { apiUpload } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// Ajouter OU modifier un personnage (nom + image optionnelle). Partagé.
export default function AddCharacterModal({ gameId, character = null, onClose, onAdded }) {
  const { token } = useAuth();
  const editing = !!character;
  const [name, setName] = useState(character?.name || "");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(character?.image || null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const k = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", k);
    };
  }, [onClose]);

  function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      if (file) fd.append("image", file);
      const path = editing
        ? `/games/${gameId}/character/${character.id}`
        : `/games/${gameId}/character`;
      const data = await apiUpload(path, fd, token, editing ? "PUT" : "POST");
      onAdded(data.character);
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-overlay sub" onMouseDown={onClose}>
      <div className="modal add-char-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
        <h2 className="modal-title">
          {editing ? "Modifier le personnage" : "Ajouter un personnage"}
        </h2>
        <p className="review-sub">Il sera proposé aux autres joueurs pour ce jeu.</p>

        <div className="add-char-body">
          <button
            className="add-char-img clickable"
            onClick={() => fileRef.current?.click()}
            title="Changer l'image"
          >
            {preview ? (
              <img src={preview} alt="" />
            ) : (
              <>
                <User size={26} />
                <span>Image</span>
              </>
            )}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
          <input
            className="modal-input"
            placeholder="Nom du personnage"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            autoFocus
          />
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || !name.trim()}
          >
            {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
            {editing ? "Enregistrer" : "Ajouter"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
