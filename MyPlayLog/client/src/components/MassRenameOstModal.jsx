import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Check, TextCursorInput, ArrowRight } from "lucide-react";
import { apiFetch } from "../lib/api";

// Renomme en masse les pistes d'OST : remplace un texte commun (ex: le préfixe
// "Nom du jeu OST - " répété sur chaque piste) par autre chose (ou rien).
// Persisté par piste côté serveur (overlay propre à l'utilisateur).
export default function MassRenameOstModal({ gameId, token, tracks, onClose, onApply }) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const k = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", k);
    };
  }, [onClose]);

  const preview = useMemo(() => {
    const term = find.trim();
    if (!term) return [];
    const cmp = matchCase ? term : term.toLowerCase();
    return tracks
      .map((t) => {
        const hay = matchCase ? t.name : t.name.toLowerCase();
        const idx = hay.indexOf(cmp);
        if (idx === -1) return null;
        const after = t.name.slice(0, idx) + replace + t.name.slice(idx + term.length);
        return after === t.name ? null : { id: t.id, before: t.name, after };
      })
      .filter(Boolean);
  }, [tracks, find, replace, matchCase]);

  async function apply() {
    if (!preview.length || saving) return;
    setSaving(true);
    const byId = new Map(preview.map((p) => [p.id, p.after]));
    try {
      await apiFetch(`/games/${gameId}/ost/rename`, {
        method: "POST",
        token,
        body: { renames: preview.map((p) => ({ id: p.id, name: p.after })) },
      });
      onApply(byId);
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-overlay sub" onMouseDown={onClose}>
      <div className="modal mass-rename-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
        <h2 className="modal-title">
          <TextCursorInput size={22} /> Renommer en masse
        </h2>
        <p className="review-sub">
          Remplace un texte commun dans le nom des pistes (ex : retirer un préfixe répété).
        </p>

        <label className="field-label">Rechercher</label>
        <input
          className="modal-input"
          placeholder="Texte à retirer ou remplacer…"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          autoFocus
        />

        <label className="field-label">Remplacer par</label>
        <input
          className="modal-input"
          placeholder="(laisser vide pour retirer)"
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && apply()}
        />

        <label className="mass-rename-case">
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(e) => setMatchCase(e.target.checked)}
          />
          Respecter la casse
        </label>

        {find.trim() && (
          <div className="mass-rename-preview">
            {preview.length === 0 ? (
              <div className="ost-none">Aucune piste ne correspond.</div>
            ) : (
              <>
                <div className="mass-rename-count">
                  {preview.length} piste{preview.length > 1 ? "s" : ""} seront renommée
                  {preview.length > 1 ? "s" : ""}
                </div>
                <div className="mass-rename-list">
                  {preview.map((p) => (
                    <div className="mass-rename-row" key={p.id}>
                      <span className="mass-rename-before" title={p.before}>
                        {p.before}
                      </span>
                      <ArrowRight size={13} />
                      <span className="mass-rename-after" title={p.after}>
                        {p.after || "(vide)"}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={apply} disabled={saving || !preview.length}>
            {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
            Renommer {preview.length > 0 ? `(${preview.length})` : ""}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
