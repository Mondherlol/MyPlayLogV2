import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Medal, ShieldCheck, X, Loader2 } from "lucide-react";
import { apiFetch } from "../lib/api";

// ============================================================
//  Avis de recherche « One Piece » — composant réutilisable
//  (profil : rail latéral → mini + modale ; fil de piratage : modale)
// ============================================================

// Hash déterministe d'une chaîne → épithète + inclinaison uniques par joueur.
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Épithètes façon One Piece, version pirate du téléchargement.
const WANTED_EPITHETS = [
  "Doigts Collants",
  "l'Écumeur de Repacks",
  "le Flibustier du Wi-Fi",
  "Main Leste",
  "le Corsaire Cheap",
  "Poucave des Torrents",
  "le Sans-le-Sou",
  "le Roi du Seedbox",
  "Radin le Terrible",
  "le Boucanier du Bitrate",
];

// Paliers de dangerosité : plus il télécharge, plus l'avis est diabolique.
function wantedTier(count) {
  if (count < 5) return { key: "petit", rank: "Petit resquilleur", dead: "MORT OU VIF" };
  if (count < 15) return { key: "hors", rank: "Hors-la-loi", dead: "MORT OU VIF" };
  if (count < 50) return { key: "pirate", rank: "Pirate notoire", dead: "MORT OU VIF" };
  return { key: "demon", rank: "Seigneur du crime", dead: "MORT OU VIF" };
}

// Casier vierge (0 délit) : pas d'avis de recherche, mais une médaille de
// citoyen modèle — PP dans un médaillon doré, ruban et sceau de bonne conduite.
export function CitizenBadge({ username, avatar }) {
  return (
    <div className="pff-citizen">
      <div className="pff-citizen-medal">
        {avatar ? (
          <img src={avatar} alt={username} draggable="false" />
        ) : (
          <span className="pff-citizen-fb">{(username || "?")[0].toUpperCase()}</span>
        )}
        <span className="pff-citizen-seal">
          <ShieldCheck size={16} />
        </span>
      </div>
      <div className="pff-citizen-txt">
        <span className="pff-citizen-title">
          <Medal size={15} /> Citoyen modèle
        </span>
        <span className="pff-citizen-sub">Casier vierge — aucun délit de téléchargement</span>
      </div>
    </div>
  );
}

// Avis de recherche « One Piece » : PP en médaillon, rançon = somme des jeux
// téléchargés (60 $ pièce), nombre de méfaits, épithète unique. Le style se
// corse avec le palier (cornes de démon au sommet du barème). Casier vierge →
// médaille de bonne conduite plutôt qu'un avis de recherche.
export function WantedPosterCard({ username, wanted }) {
  if (!wanted) return null;
  const count = wanted.count || 0;
  const value = wanted.value ?? count * 60;
  if (count <= 0) return <CitizenBadge username={username} avatar={wanted.avatar} />;
  const tier = wantedTier(count);
  const epithet = WANTED_EPITHETS[hashStr(username) % WANTED_EPITHETS.length];
  const tilt = ((hashStr(username + "seed") % 5) - 2) * 0.55; // -1.1°..+1.1°

  return (
    <div className={`pff-wanted wp-${tier.key}`} style={{ "--wp-tilt": `${tilt}deg` }}>
      <div className="pff-wanted-top">AVIS DE RECHERCHE</div>
      <div className="pff-wanted-photo">
        {wanted.avatar ? (
          <img src={wanted.avatar} alt={username} draggable="false" />
        ) : (
          <span className="pff-wanted-photo-fb">{(username || "?")[0].toUpperCase()}</span>
        )}
      </div>
      <div className="pff-wanted-dead">{tier.dead}</div>
      <div className="pff-wanted-name">{username}</div>
      <div className="pff-wanted-epithet">« {epithet} »</div>
      <div className="pff-wanted-bounty">
        <span className="pff-wanted-berry">$</span>
        {value.toLocaleString("fr-FR")}
      </div>
      <div className="pff-wanted-foot">
        <span className="pff-wanted-rank">{tier.rank}</span>
        <span className="pff-wanted-crimes">
          {count} méfait{count > 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

// Modale « stylée » : l'avis de recherche punaisé, en grand, sur un fond assombri.
// Si `wanted` n'est pas fourni, on le récupère depuis le serveur via le pseudo
// (utilisé depuis le fil de piratage, où seul le pseudo est connu).
export function WantedModal({ username, wanted: wantedProp = null, token, onClose }) {
  const [wanted, setWanted] = useState(wantedProp);
  const [loading, setLoading] = useState(!wantedProp);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (wantedProp || !username) return;
    let alive = true;
    setLoading(true);
    apiFetch(`/feed/wanted/${encodeURIComponent(username)}`, { token })
      .then((d) => alive && setWanted(d))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [username, wantedProp, token]);

  return createPortal(
    <div className="wanted-modal" onClick={onClose}>
      <button className="wanted-modal-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>
      <div className="wanted-modal-stage" onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <div className="wanted-modal-loading">
            <Loader2 size={22} className="spin" />
          </div>
        ) : (
          <WantedPosterCard username={username} wanted={wanted} />
        )}
      </div>
    </div>,
    document.body
  );
}
