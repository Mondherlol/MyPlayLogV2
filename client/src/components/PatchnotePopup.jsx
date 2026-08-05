import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Sparkles,
  Smartphone,
  BarChart3,
  Gamepad2,
  Zap,
  Palette,
  Bug,
  Heart,
  Music,
  ListChecks,
  Bell,
  Rocket,
  Star,
  Wand2,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// Icônes disponibles pour illustrer une nouveauté (choisies dans l'éditeur admin).
export const PN_ICONS = {
  Sparkles,
  Smartphone,
  BarChart3,
  Gamepad2,
  Zap,
  Palette,
  Bug,
  Heart,
  Music,
  ListChecks,
  Bell,
  Rocket,
  Star,
  Wand2,
};

// Pop-up des nouveautés : s'affiche UNE SEULE fois par version, à la première
// ouverture du site après publication d'un patch note. Montée dans AppLayout.
export default function PatchnotePopup() {
  const { token } = useAuth();
  const [note, setNote] = useState(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch("/patchnotes/latest", { token })
      .then((d) => alive && d.patchnote && setNote(d.patchnote))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (!note) return;
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);

  function dismiss() {
    if (!note) return;
    // On marque comme vu tout de suite : même si l'appel échoue, l'utilisateur
    // ne sera pas re-spammé dans la même session (l'état local disparaît).
    apiFetch("/patchnotes/seen", {
      method: "POST",
      token,
      body: { version: note.version },
    }).catch(() => {});
    setClosing(true);
    setTimeout(() => setNote(null), 180);
  }

  if (!note) return null;

  return createPortal(
    <div
      className={`modal-overlay patchnote-overlay ${closing ? "closing" : ""}`}
      onMouseDown={dismiss}
    >
      <div className="patchnote-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={dismiss} aria-label="Fermer">
          <X size={20} />
        </button>

        {/* Bandeau doré avec la version */}
        <div className="pn-hero">
          <span className="pn-spark pn-spark-1">
            <Sparkles size={16} />
          </span>
          <span className="pn-spark pn-spark-2">
            <Star size={13} />
          </span>
          <span className="pn-badge">
            <Rocket size={14} /> Version {note.version}
          </span>
          <h2 className="pn-title">{note.title}</h2>
          {note.intro && <p className="pn-intro">{note.intro}</p>}
        </div>

        <div className="pn-items">
          {note.items.map((it, i) => {
            const Icon = PN_ICONS[it.icon] || Sparkles;
            return (
              <div className="pn-item" key={i}>
                <span className="pn-item-icon">
                  <Icon size={20} />
                </span>
                <div className="pn-item-body">
                  <h3 className="pn-item-title">{it.title}</h3>
                  {it.description && (
                    <p className="pn-item-desc">{it.description}</p>
                  )}
                  {it.images?.length > 0 && (
                    <div
                      className={`pn-shots ${it.images.length > 1 ? "duo" : ""}`}
                    >
                      {it.images.map((src, j) => (
                        <img key={j} src={src} alt="" loading="lazy" />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <button className="btn btn-primary pn-cta clickable" onClick={dismiss}>
          <Heart size={16} /> C'est parti
        </button>
      </div>
    </div>,
    document.body
  );
}
