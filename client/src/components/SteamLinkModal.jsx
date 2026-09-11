// ======================================================================
//  « J'ai le lien Steam » — ajouter un jeu que la recherche ne trouve pas
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

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, X, Sparkles, ExternalLink } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import SteamIcon from "./SteamIcon";

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
        if (/store\.steampowered\.com\/app\/\d+/.test(t || "")) setUrl(t.trim());
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
            <SteamIcon size={22} />
            <span>Ajouter par lien Steam</span>
          </div>
        </div>

        {!made ? (
          <form className="steam-link-body" onSubmit={submit}>
            <p className="steam-link-intro">
              Le jeu est introuvable dans la recherche&nbsp;? Colle l'adresse de sa page
              Steam&nbsp;: on le retrouve par son identifiant, quelle que soit la langue
              d'affichage de sa page.
            </p>

            <div className="steam-link-field">
              <SteamIcon size={18} className="steam-link-field-icon" />
              <input
                ref={inputRef}
                type="text"
                inputMode="url"
                placeholder="https://store.steampowered.com/app/3101040/…"
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
              Steam, et elle se rattachera toute seule à la vraie fiche le jour où elle
              existera.
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
                  {[made.developers?.[0], made.comingSoon ? "Bientôt disponible" : made.releaseHuman]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>

            <p className="steam-link-intro">
              Ce jeu n'est pas encore au catalogue IGDB, la source de nos fiches. En
              attendant, voilà une fiche tirée de sa page Steam&nbsp;: tu peux l'ajouter à
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
              href={made.steamUrl}
              target="_blank"
              rel="noreferrer"
            >
              Voir sur Steam <ExternalLink size={13} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
