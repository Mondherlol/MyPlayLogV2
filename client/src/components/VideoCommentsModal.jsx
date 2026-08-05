import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import VideoCommentsPanel from "./VideoCommentsPanel";

// Modale de commentaires d'une vidéo recommandée : coquille modale autour du
// fil réutilisable (VideoCommentsPanel), aussi embarqué dans le lecteur.
export default function VideoCommentsModal({
  video, // { id, videoId, title, author, thumb }
  token,
  onCountChange,
  onClose,
}) {
  // Un calque (lightbox média / historique) ouvert au-dessus : Échap ne doit
  // fermer que lui, pas la modale.
  const overlayOpen = useRef(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && !overlayOpen.current && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal thread-modal rp-cmodal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
        <VideoCommentsPanel
          video={video}
          token={token}
          onCountChange={onCountChange}
          onOverlayChange={(open) => (overlayOpen.current = open)}
        />
      </div>
    </div>,
    document.body
  );
}
