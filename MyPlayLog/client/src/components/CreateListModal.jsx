import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Globe, Lock, Loader2, Sparkles, Gamepad2, User } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { LIST_TYPES } from "../lib/lists";

// Modal de création d'une liste : type, titre, visibilité.
// (La description se saisit ensuite directement dans la liste.)
// `fixedType` : impose un type (ex. "playlist" depuis l'onglet OST d'un jeu)
// et masque le sélecteur.
export default function CreateListModal({ onClose, onCreated, fixedType = null }) {
  const { token } = useAuth();
  const [type, setType] = useState(fixedType || "classic");
  const [itemKind, setItemKind] = useState("game"); // tier list : jeux OU persos
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isPublic = visibility === "public";

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError("Donne un titre à ta liste.");
    setBusy(true);
    setError(null);
    try {
      const { list } = await apiFetch("/lists", {
        method: "POST",
        token,
        body: {
          type,
          title: title.trim(),
          visibility,
          // Une playlist contient des OST ; les autres types, jeux ou persos.
          itemKind: type === "playlist" ? "ost" : itemKind,
        },
      });
      onCreated?.(list);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="modal list-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        <form className="modal-form" onSubmit={submit}>
          <h2 className="modal-title">
            <Sparkles size={20} />{" "}
            {fixedType === "playlist" ? "Nouvelle playlist" : "Nouvelle liste"}
          </h2>

          {error && <div className="alert alert-error">{error}</div>}

          {!fixedType && (
            <div className="field">
              <label>Type de liste</label>
              <div className="type-picker">
                {Object.values(LIST_TYPES).map((t) => (
                  <button
                    type="button"
                    key={t.value}
                    className={`type-card clickable ${type === t.value ? "active" : ""}`}
                    onClick={() => setType(t.value)}
                  >
                    <span className="type-card-icon">
                      <t.Icon size={18} />
                    </span>
                    <span className="type-card-label">{t.long}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {type !== "playlist" && (
          <div className="field">
            <label>Contenu de la liste</label>
            <div className="kind-picker">
              <button
                type="button"
                className={`kind-card clickable ${itemKind === "game" ? "active" : ""}`}
                onClick={() => setItemKind("game")}
              >
                <Gamepad2 size={17} /> Des jeux
              </button>
              <button
                type="button"
                className={`kind-card clickable ${itemKind === "character" ? "active" : ""}`}
                onClick={() => setItemKind("character")}
              >
                <User size={17} /> Des personnages
              </button>
            </div>
          </div>
          )}

          <div className="field">
            <label htmlFor="list-title">Titre</label>
            <div className="title-row">
              <input
                id="list-title"
                className="modal-input"
                placeholder={
                  type === "playlist" ? "Ex : OST qui donnent des frissons" : "Ex : Mes RPG cultes"
                }
                value={title}
                maxLength={120}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
              />
              <button
                type="button"
                className={`vis-switch clickable ${isPublic ? "on" : ""}`}
                onClick={() => setVisibility(isPublic ? "private" : "public")}
                title={
                  isPublic
                    ? "Liste publique — visible par tous"
                    : "Liste privée — visible par toi seul·e"
                }
              >
                {isPublic ? <Globe size={14} /> : <Lock size={14} />}
                Publique
                <span className="vis-switch-track" aria-hidden="true">
                  <span className="vis-switch-knob" />
                </span>
              </button>
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
              {type === "playlist" ? "Créer la playlist" : "Créer la liste"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
