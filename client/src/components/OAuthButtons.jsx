import { useEffect, useState } from "react";
import { apiFetch, API_BASE } from "../lib/api";
import GoogleIcon from "./GoogleIcon";
import DiscordIcon from "./DiscordIcon";

// ======================================================================
//  « Continuer avec Google / Discord »
// ======================================================================
// Les deux mêmes boutons sur la connexion ET sur l'inscription, volontairement
// identiques : de ce côté-ci du rideau, se connecter et s'inscrire par un tiers
// sont le MÊME geste. Le serveur se charge de savoir si le compte existait déjà
// (et, si l'adresse correspond, il rattache la clé au compte en place plutôt
// que d'en fabriquer un second — cf. server/src/lib/oauthAccounts.js).
//
// ⚠️ UNE VRAIE NAVIGATION, PAS UN fetch(). Le point de départ est une
// redirection en cascade vers un autre domaine : `window.location.href` est le
// seul moyen d'y aller. Un `apiFetch` se ferait arrêter net par CORS.
//
// Les boutons ne s'affichent QUE si le fournisseur est branché côté serveur :
// tant que les clés ne sont pas dans server/.env, il n'y a rien à montrer.

export default function OAuthButtons({ next = "/app", remember = true, busy = false }) {
  const [providers, setProviders] = useState(null); // { google, discord }
  const [going, setGoing] = useState("");

  useEffect(() => {
    let alive = true;
    apiFetch("/auth/oauth/providers")
      .then((data) => alive && setProviders(data.providers || {}))
      // Silencieux : si l'API ne répond pas, le formulaire email/mot de passe
      // juste au-dessus reste utilisable. Une alerte de plus n'aiderait personne.
      .catch(() => alive && setProviders({}));
    return () => {
      alive = false;
    };
  }, []);

  function go(provider) {
    setGoing(provider);
    const params = new URLSearchParams({ next, remember: remember ? "1" : "0" });
    window.location.href = `${API_BASE}/auth/oauth/${provider}/start?${params}`;
  }

  // Tant qu'on ne sait pas, on ne montre rien : un bouton qui apparaît sous le
  // doigt au moment du clic fait cliquer sur autre chose que ce qu'on visait.
  if (!providers) return null;
  const any = providers.google || providers.discord;
  if (!any) return null;

  return (
    <div className="oauth-block">
      <div className="oauth-sep">
        <span>ou</span>
      </div>

      {providers.google && (
        <button
          type="button"
          className="btn-oauth google clickable"
          onClick={() => go("google")}
          disabled={busy || !!going}
        >
          <span className="btn-oauth-logo">
            <GoogleIcon size={18} />
          </span>
          {going === "google" ? "Redirection…" : "Continuer avec Google"}
        </button>
      )}

      {providers.discord && (
        <button
          type="button"
          className="btn-oauth discord clickable"
          onClick={() => go("discord")}
          disabled={busy || !!going}
        >
          <span className="btn-oauth-logo">
            <DiscordIcon size={18} />
          </span>
          {going === "discord" ? "Redirection…" : "Continuer avec Discord"}
        </button>
      )}
r
    </div>
  );
}
