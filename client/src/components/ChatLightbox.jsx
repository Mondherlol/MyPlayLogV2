import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useImageZoom } from "../hooks/useImageZoom";
import { useScrollLock } from "../hooks/useScrollLock";
import { useBackClose } from "../hooks/useBackClose";

// Visionneuse plein écran d'une image du chat.
// L'image est bornée aux dimensions de l'ÉCRAN (elle ne déborde jamais), et se
// zoome au pincement sur mobile / à la molette sur PC (cf. useImageZoom, dont
// la logique vient d'ici et sert désormais aussi aux visionneuses de la fiche
// de jeu et des listes). Double-tap ou double-clic : normal ↔ 2×.
export default function ChatLightbox({ url, onClose }) {
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

      {zoom.zoomed && (
        <span className="chat-lightbox-hint">
          {Math.round(zoom.scale * 100)} % · double-tap pour réinitialiser
        </span>
      )}
    </div>,
    document.body
  );
}
