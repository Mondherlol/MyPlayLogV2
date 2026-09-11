// ======================================================================
//  « Cette fiche vient de Steam » — et comment la faire devenir une vraie
// ======================================================================
//
// Un jeu ajouté par lien Steam alors qu'IGDB ne le connaît pas encore a une
// fiche PROVISOIRE (identifiant négatif, cf. server/src/lib/localGame.js). Elle
// n'a ni notes de la presse, ni OST, ni personnages, ni saga — et la fiche doit
// LE DIRE, sinon on croit que l'app est cassée.
//
// ⚠️ ET NON, ON NE SOUMET PAS LE JEU À IGDB À LA PLACE DE L'UTILISATEUR.
// L'API d'IGDB est en lecture seule : il n'existe aucun moyen programmatique de
// contribuer, l'ajout passe par leur formulaire web avec un compte connecté et
// une modération humaine. Ce qu'on fait — et c'est l'essentiel du travail — est
// de préparer le dossier COMPLET, dans l'ordre du formulaire, prêt à coller.
// Le rattachement, lui, est bien automatique : dès qu'IGDB connaît le jeu, la
// synchro recolle collection, avis et listes sur la vraie fiche.

import { useState } from "react";
import { Copy, Check, ExternalLink, RefreshCw, Sparkles, Loader2 } from "lucide-react";
import { apiFetch } from "../lib/api";
import SteamIcon from "./SteamIcon";

export default function LocalGameBanner({ game, token, onRefreshed }) {
  const [sheet, setSheet] = useState(null); // le dossier prêt à coller
  const [busy, setBusy] = useState(null); // "sheet" | "refresh" | "submitted"
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(!!game.submittedToIgdb);
  const appid = game.steamAppId;

  async function openSheet() {
    if (sheet) return setSheet(null);
    setBusy("sheet");
    try {
      setSheet(await apiFetch(`/steam-games/${appid}/submission`, { token }));
    } catch {
      /* le bloc ne s'ouvre pas : le lien Steam reste là, c'est l'essentiel */
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(sheet.clipboard);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* presse-papier refusé : le texte reste sélectionnable à la main */
    }
  }

  async function refresh() {
    setBusy("refresh");
    try {
      await apiFetch(`/steam-games/${appid}/refresh`, { method: "POST", token });
      onRefreshed?.();
    } catch {
      /* sans conséquence : la fiche affichée reste celle d'avant */
    } finally {
      setBusy(null);
    }
  }

  async function markSubmitted() {
    setBusy("submitted");
    try {
      await apiFetch(`/steam-games/${appid}/submitted`, { method: "POST", token });
      setSubmitted(true);
    } catch {
      /* déjà signalée par quelqu'un d'autre : rien à faire */
      setSubmitted(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="local-game-banner">
      <SteamIcon size={20} className="local-game-banner-icon" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <h4>Fiche provisoire, tirée de Steam</h4>
        <p>
          Ce jeu n'est pas encore au catalogue IGDB, d'où viennent nos fiches. Celle-ci a
          été construite à partir de sa page Steam&nbsp;: tu peux l'ajouter à ta
          collection, la noter et écrire ton avis normalement. Le jour où IGDB
          l'ajoutera, tout sera repris automatiquement sur la vraie fiche —{" "}
          <b>rien de ce que tu écris ici n'est perdu</b>.
        </p>

        <div className="local-game-actions">
          {game.steamUrl && (
            <a className="local-game-btn" href={game.steamUrl} target="_blank" rel="noreferrer">
              <SteamIcon size={14} /> Voir sur Steam <ExternalLink size={12} />
            </a>
          )}

          {token && (
            <button className="local-game-btn clickable" onClick={openSheet} disabled={busy === "sheet"}>
              {busy === "sheet" ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
              {sheet ? "Masquer le dossier IGDB" : "Aider : l'ajouter à IGDB"}
            </button>
          )}

          {token && (
            <button
              className="local-game-btn clickable"
              onClick={refresh}
              disabled={busy === "refresh"}
              title="Relire la page Steam (jaquette, description, date)"
            >
              <RefreshCw size={13} className={busy === "refresh" ? "spin" : ""} /> Actualiser
            </button>
          )}
        </div>

        {sheet && (
          <div className="igdb-submit-sheet">
            <ol>
              <li>
                Copie le dossier ci-dessous (tout est déjà rempli à partir de Steam).
              </li>
              <li>
                Ouvre le formulaire d'IGDB —{" "}
                <b>il faut être connecté à un compte IGDB/Twitch</b> pour y accéder.
              </li>
              <li>
                Colle champ par champ, envoie. La modération d'IGDB valide en général en
                quelques jours.
              </li>
              <li>
                Reviens cliquer sur « C'est soumis »&nbsp;: on vérifie ensuite tout seuls,
                et la fiche se rattachera dès que le jeu apparaîtra.
              </li>
            </ol>

            <pre className="igdb-submit-pre">{sheet.clipboard}</pre>

            <div className="local-game-actions">
              <button className="local-game-btn clickable" onClick={copy}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "Copié" : "Copier le dossier"}
              </button>
              <a
                className="local-game-btn"
                href={sheet.formUrl}
                target="_blank"
                rel="noreferrer"
              >
                Ouvrir le formulaire IGDB <ExternalLink size={12} />
              </a>
              {submitted ? (
                <span className="local-game-btn done">
                  <Check size={13} /> Déjà soumis à IGDB
                </span>
              ) : (
                <button
                  className="local-game-btn clickable"
                  onClick={markSubmitted}
                  disabled={busy === "submitted"}
                >
                  <Check size={13} /> C'est soumis
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
