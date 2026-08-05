import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Gift, Clock, ExternalLink, X } from "lucide-react";
import { apiFetch } from "../lib/api";

// Slug de magasin → couleur de la pastille (identité de la boutique).
// Partagé avec le carrousel « Jeux gratuits à récupérer » de l'accueil.
export const STORE_COLORS = {
  epic: "#2a2a2a",
  steam: "#1b2838",
  gog: "#7a3ff2",
  ubisoft: "#0a6cff",
  ea: "#e0403f",
  battlenet: "#1486e8",
  prime: "#00a8e1",
  itchio: "#fa5c5c",
  "drm-free": "#5a6472",
  pc: "#5a6472",
};

// « Encore 3 j » / « Dernier jour » — combien de temps reste-t-il pour récupérer.
export function freeEndsLabel(endsAt) {
  if (!endsAt) return null;
  const days = Math.ceil((Date.parse(endsAt) - Date.now()) / 86400000);
  if (days < 0) return null;
  if (days === 0) return { text: "Dernier jour", urgent: true };
  if (days === 1) return { text: "Encore 1 j", urgent: true };
  return { text: `Encore ${days} j`, urgent: days <= 2 };
}

// Banderole flottante de la fiche de jeu : ce jeu fait partie des giveaways en
// cours (Epic / Steam / GOG / Prime…, voir lib/freeGames.js côté serveur) →
// on propose de le récupérer sans quitter la page. C'est le pendant des cartes
// « Jeux gratuits à récupérer » de l'accueil, qui mènent désormais ici plutôt
// qu'au magasin. Refermable pour la session ; masquée si rien en cours.
export default function FreeGameBanner({ gameId, token }) {
  const [offer, setOffer] = useState(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    let alive = true;
    setOffer(null);
    setClosed(false);
    apiFetch(`/free-games/for/${gameId}`, { token })
      .then((d) => alive && setOffer(d.game || null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [gameId, token]);

  if (!offer || closed) return null;
  const ends = freeEndsLabel(offer.endsAt);
  const color = STORE_COLORS[offer.store.slug] || STORE_COLORS.pc;

  return createPortal(
    <div className="gp-free-banner" role="status">
      <span className="gp-free-gift">
        <Gift size={18} />
      </span>
      <div className="gp-free-txt">
        <strong className="gp-free-head">
          Gratuit sur
          <span className="gp-free-store" style={{ background: color }}>
            {offer.store.label}
          </span>
        </strong>
        <span className="gp-free-sub">
          {ends ? (
            <>
              <Clock size={11} /> {ends.text} pour l'ajouter à ta bibliothèque —
              c'est à toi pour toujours.
            </>
          ) : (
            <>Offre en cours — récupère-le, c'est à toi pour toujours.</>
          )}
        </span>
      </div>
      <a
        className="gp-free-cta clickable"
        href={offer.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        Récupérer <ExternalLink size={14} />
      </a>
      <button
        className="gp-free-close clickable"
        onClick={() => setClosed(true)}
        aria-label="Masquer la banderole"
      >
        <X size={15} />
      </button>
    </div>,
    document.body
  );
}
