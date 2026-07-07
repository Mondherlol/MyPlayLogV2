import { useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { useClickOutside } from "../hooks/useClickOutside";
import { renderMessage } from "./ListComments";

// Bulle d'annotation cliquable, posée sur une card de liste (jeu ou perso).
// Affiche le commentaire de l'auteur (texte + emojis + médias) dans un popover.
export default function AnnotationBubble({ note, media }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);

  const hasMedia = media && media.length > 0;
  if (!note && !hasMedia) return null;

  return (
    <div className="lg-note-wrap" ref={ref}>
      <button
        className={`lg-note-btn clickable ${open ? "on" : ""}`}
        title="Voir l'annotation"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <MessageCircle size={15} />
      </button>
      {open && (
        <div className="lg-note-pop" onClick={(e) => e.stopPropagation()}>
          <button
            className="lg-note-close clickable"
            onClick={() => setOpen(false)}
            aria-label="Fermer"
          >
            <X size={13} />
          </button>
          {note && <p className="lg-note-text">{renderMessage(note, [])}</p>}
          {hasMedia && (
            <div className={`lg-note-media n-${media.length}`}>
              {media.map((m, i) => (
                <img key={i} src={m.url} alt="" loading="lazy" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
