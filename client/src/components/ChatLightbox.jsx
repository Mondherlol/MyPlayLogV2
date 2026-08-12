import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BookMarked, BookOpen, X } from "lucide-react";
import { useImageZoom } from "../hooks/useImageZoom";
import { useScrollLock } from "../hooks/useScrollLock";
import { useBackClose } from "../hooks/useBackClose";

// Visionneuse plein écran d'une image du chat.
// L'image est bornée aux dimensions de l'ÉCRAN (elle ne déborde jamais), et se
// zoome au pincement sur mobile / à la molette sur PC (cf. useImageZoom, dont
// la logique vient d'ici et sert désormais aussi aux visionneuses de la fiche
// de jeu et des listes). Double-tap ou double-clic : normal ↔ 2×.
//
// UNE PLANCHE PARTAGÉE EST UNE IMAGE COMME LES AUTRES, PLUS DEUX PORTES. Quand
// `book` est là, la capture s'ouvre, se zoome et se déplace exactement comme
// une photo — on ne lui invente pas une visionneuse à part — et une barre
// discrète apparaît en bas : d'où vient l'image (la fiche du volume), et à
// quelle planche (qui rouvre le bouquin par-dessus la conversation, sans jamais
// la quitter). C'est tout ce qu'une capture doit porter de plus.
export default function ChatLightbox({ url, book, onOpenBook, onClose }) {
  const zoom = useImageZoom();

  useScrollLock();
  // Sur mobile, « retour » ferme l'image au lieu de quitter la conversation.
  useBackClose(onClose, "chatLightbox");

  return createPortal(
    <div
      className="chat-lightbox"
      onMouseDown={(e) => {
        // Clic sur le fond = fermer (sauf zoomé : on est en train de déplacer).
        if (e.target === e.currentTarget && !zoom.zoomed) onClose();
      }}
      {...zoom.surfaceProps}
    >
      <button className="chat-lightbox-x clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>

      <div
        ref={zoom.stageRef}
        className="chat-lightbox-stage"
        style={zoom.style}
        {...zoom.stageProps}
      >
        <img src={url} alt="" draggable="false" />
      </div>

      {/* Le repère de zoom cède la place à la barre du bouquin : deux bandeaux
          au même endroit se marcheraient dessus, et savoir « 240 % » importe
          moins que savoir de quel tome sort la case qu'on regarde. */}
      {zoom.zoomed && !book && (
        <span className="chat-lightbox-hint">
          {Math.round(zoom.scale * 100)} % · double-tap pour réinitialiser
        </span>
      )}

      {book && (
        <div className="chat-lightbox-book" onMouseDown={(e) => e.stopPropagation()}>
          <Link
            to={`/collection/${book.slug}`}
            className="chat-lb-book-from clickable"
            onClick={onClose}
            title="Ouvrir la fiche du volume"
          >
            {book.cover ? (
              <img src={book.cover} alt="" />
            ) : (
              <span className="chat-lb-book-ic">
                <BookOpen size={14} />
              </span>
            )}
            <span>
              <strong>{book.title || "Ce volume"}</strong>
              {book.franchise && <em>{book.franchise}</em>}
            </span>
          </Link>

          <button
            type="button"
            className="chat-lb-book-open clickable"
            onClick={() => onOpenBook?.(book)}
          >
            <BookMarked size={14} /> Planche {(book.page || 0) + 1}
            {book.pages ? ` / ${book.pages}` : ""}
          </button>
        </div>
      )}
    </div>,
    document.body
  );
}
