// ======================================================================
//  « J'ai son lien » — ajouter un jeu que la recherche ne trouve pas
// ======================================================================
//
// DEUX SITUATIONS, UN SEUL CHAMP. On colle l'adresse de la page Steam et on
// tombe sur la fiche du jeu, quoi qu'il arrive :
//
//   • le jeu est au catalogue IGDB mais sa page Steam s'affichait dans une
//     autre langue (le cas qui a motivé tout ça : un titre en japonais qu'on
//     ne retrouvait pas en le tapant) → on ouvre sa vraie fiche ;
//   • le jeu n'est pas encore au catalogue (jeu indépendant tout juste sorti)
//     → on lui fabrique une fiche provisoire à partir de sa page Steam, pour
//     qu'il puisse entrer dans une collection dès maintenant.
//
// Dans les deux cas l'app ne fait que naviguer vers `/game/<id>` : c'est le
// serveur qui décide (POST /api/steam-games/resolve).
//
// ⚠️ ITCH.IO AUSSI, PAR LE MÊME CHAMP. Un quart des jeux itch.io populaires
// n'existent pas chez IGDB (visual novels, démos, jeux de jam) : on colle le
// lien de la page itch.io, le serveur fait le reste (routes/itchGames.js).

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, X, Sparkles, ExternalLink } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { SiItchdotio } from "react-icons/si";
import SteamIcon from "./SteamIcon";

const LINK_RE = /store\.steampowered\.com\/app\/\d+|[a-z0-9-]+\.itch\.io\/[a-z0-9_-]+/i;

// Le statut d'un jeu itch.io, tel que sa page l'écrit.
export const ITCH_STATUS_FR = {
  Released: "Sorti",
  "In development": "En développement",
  Prototype: "Prototype",
  "On hold": "En pause",
  Canceled: "Annulé",
};

export default function SteamLinkModal({ onClose }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Résultat d'un lien qui a donné une fiche provisoire : on l'annonce avant
  // d'ouvrir la page, sinon l'utilisateur ne comprendrait pas pourquoi la fiche
  // est si maigre par rapport aux autres.
  const [made, setMade] = useState(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Le presse-papier contient très souvent déjà le lien : on le propose, sans
    // jamais l'envoyer tout seul. (Refusé par le navigateur hors HTTPS ou sans
    // permission : c'est sans conséquence, le champ reste vide.)
    navigator.clipboard
      ?.readText?.()
      .then((t) => {
        if (LINK_RE.test(t || "")) setUrl(t.trim());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e) {
    e?.preventDefault();
    const value = url.trim();
    if (!value || busy) return;

    setBusy(true);
    setError(null);
    try {
      const data = await apiFetch("/steam-games/resolve", {
        method: "POST",
        token,
        body: { url: value },
      });

      if (data.kind === "igdb") {
        onClose();
        navigate(`/game/${data.gameId}`);
        return;
      }
      // Fiche provisoire : on montre ce qu'on a trouvé avant d'y aller.
      setMade(data.game);
    } catch (err) {
      setError(err.message || "Impossible de lire ce lien.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="steam-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="steam-modal steam-link-modal">
        <button className="steam-modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        <div className="steam-modal-head">
          <div className="steam-modal-brand">
            <SteamIcon size={20} />
            <SiItchdotio size={19} />
            <span>Ajouter par son lien</span>
          </div>
        </div>

        {!made ? (
          <form className="steam-link-body" onSubmit={submit}>
            <p className="steam-link-intro">
              Le jeu est introuvable dans la recherche&nbsp;? Colle l'adresse de sa page
              Steam ou itch.io&nbsp;: on le retrouve par son lien, quelle que soit la
              langue d'affichage de sa page.
            </p>

            <div className="steam-link-field">
              {/itch\.io/i.test(url) ? (
                <SiItchdotio size={18} className="steam-link-field-icon" />
              ) : (
                <SteamIcon size={18} className="steam-link-field-icon" />
              )}
              <input
                ref={inputRef}
                type="text"
                inputMode="url"
                placeholder="store.steampowered.com/app/… ou auteur.itch.io/jeu"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                disabled={busy}
              />
            </div>

            {error && <p className="steam-link-error">{error}</p>}

            <button className="btn-steam-primary clickable" disabled={!url.trim() || busy}>
              {busy ? (
                <>
                  <Loader2 size={16} className="spin" /> Recherche…
                </>
              ) : (
                "Trouver le jeu"
              )}
            </button>

            <p className="steam-link-hint">
              Le jeu n'est pas encore référencé&nbsp;? On crée sa fiche à partir de sa page
              Steam ou itch.io, et elle se rattachera toute seule à la vraie fiche le jour
              où elle existera.
            </p>
          </form>
        ) : (
          <div className="steam-link-body">
            <div className="steam-link-found">
              {made.cover && <img src={made.cover} alt="" className="steam-link-cover" />}
              <div className="steam-link-found-text">
                <span className="steam-link-badge">
                  <Sparkles size={13} /> Fiche créée
                </span>
                <h3>{made.name}</h3>
                {made.nameOriginal && made.nameOriginal !== made.name && (
                  <p className="steam-link-alt">{made.nameOriginal}</p>
                )}
                <p className="steam-link-meta">
                  {[
                    made.developers?.[0],
                    made.source === "itch"
                      ? ITCH_STATUS_FR[made.status] || made.status
                      : made.comingSoon
                        ? "Bientôt disponible"
                        : made.releaseHuman,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>

            <p className="steam-link-intro">
              Ce jeu n'est pas encore au catalogue IGDB, la source de nos fiches. En
              attendant, voilà une fiche tirée de sa page{" "}
              {made.source === "itch" ? "itch.io" : "Steam"}&nbsp;: tu peux l'ajouter à
              ta collection, la noter et écrire ton avis. Le jour où IGDB l'ajoutera, tout
              ce que tu auras écrit sera repris sur la vraie fiche.
            </p>

            <button
              className="btn-steam-primary clickable"
              onClick={() => {
                onClose();
                navigate(`/game/${made.gameId}`);
              }}
            >
              Ouvrir la fiche
            </button>

            <a
              className="steam-link-store clickable"
              href={made.source === "itch" ? made.itchUrl : made.steamUrl}
              target="_blank"
              rel="noreferrer"
            >
              Voir sur {made.source === "itch" ? "itch.io" : "Steam"} <ExternalLink size={13} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
