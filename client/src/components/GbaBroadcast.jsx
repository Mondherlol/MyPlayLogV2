import { useState } from "react";
import {
  Radio,
  Users,
  Gamepad2,
  Link2,
  Check,
  X,
  Loader2,
  VolumeX,
  Hand,
  Loader,
  AlertTriangle,
} from "lucide-react";

// ======================================================================
//  Le panneau de diffusion — ce que voit celui qui joue
// ======================================================================
// TROIS CHOSES, ET RIEN D'AUTRE : le lien à envoyer, qui regarde, et à qui l'on
// passe la manette. Une diffusion n'a pas de réglages — l'image est celle de la
// console, le son celui du jeu ; tout ce qu'on peut décider tient dans ces trois
// lignes.
//
// L'ÉTAT DE CHAQUE CONNEXION EST MONTRÉ, et ce n'est pas du détail technique :
// une image qui ne part pas est le seul incident possible ici (réseau fermé des
// deux côtés, pas de relais TURN). Sans ce voyant, l'hôte croit diffuser dans le
// vide et referme tout ; avec, il voit « connexion impossible » et sait que ça
// ne vient pas de lui.

const STATES = {
  new: { label: "Connexion…", tone: "wait" },
  connecting: { label: "Connexion…", tone: "wait" },
  connected: { label: "Reçoit l'image", tone: "ok" },
  disconnected: { label: "Coupé", tone: "bad" },
  failed: { label: "Connexion impossible", tone: "bad" },
  closed: { label: "Parti", tone: "bad" },
};

export default function GbaBroadcast({
  room,
  links,
  error,
  hasAudio,
  max,
  onGrant,
  onStop,
  onClose,
}) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/gba/${room.code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* presse-papiers refusé : le lien reste lisible et sélectionnable */
    }
  }

  const viewers = room.viewers || [];
  const holder = viewers.find((v) => v.pad);

  return (
    <div className="gbx-panel" role="dialog" aria-label="Diffusion">
      <header>
        <div>
          <strong>
            <span className="gbx-live-dot" aria-hidden="true" /> En direct
          </strong>
          <em>
            {viewers.length
              ? `${viewers.length} personne${viewers.length > 1 ? "s" : ""} te regarde${
                  viewers.length > 1 ? "nt" : ""
                } jouer.`
              : "Envoie le lien : ils verront ta partie en direct."}
          </em>
        </div>
        <button className="clickable" onClick={onClose} aria-label="Fermer">
          <X size={15} />
        </button>
      </header>

      {error && (
        <p className="gbx-warn">
          <AlertTriangle size={13} /> {error}
        </p>
      )}

      {/* LE LIEN EST LA PREMIÈRE CHOSE : sans lui, il n'y a personne à
          regarder, et tout le reste du panneau est vide. */}
      <button className="gbx-share clickable" onClick={copy}>
        <span className="gbx-share-ic">
          {copied ? <Check size={15} /> : <Link2 size={15} />}
        </span>
        <span className="gbx-share-txt">
          <strong>{copied ? "Lien copié" : "Copier le lien"}</strong>
          <em>{url.replace(/^https?:\/\//, "")}</em>
        </span>
      </button>

      {!hasAudio && (
        <p className="gbx-warn soft">
          <VolumeX size={13} /> Ce cœur ne laisse pas capter son son : la
          diffusion part en image seule.
        </p>
      )}

      <p className="gbx-panel-title">
        <Users size={12} /> Spectateurs · {viewers.length} / {max}
      </p>

      {!viewers.length ? (
        <p className="gbx-panel-note">
          Personne pour l'instant. Le lien s'ouvre dans un navigateur, sans rien
          installer — et ceux qui te suivent voient déjà « en direct » dans leur
          onglet Activité.
        </p>
      ) : (
        viewers.map((v) => {
          const state = STATES[links?.[v.peerId]] || STATES.new;
          return (
            <div key={v.peerId} className={`gbx-row watcher ${v.pad ? "on" : ""}`}>
              <span className="gbx-row-icon">
                {v.avatar ? (
                  <img src={v.avatar} alt="" loading="lazy" />
                ) : (
                  v.username[0].toUpperCase()
                )}
              </span>
              <span>
                <strong>
                  {v.username}
                  {/* La main levée est la demande, pas un statut : elle doit se
                      voir à côté du nom, là où l'on décide. */}
                  {v.hand && !v.pad && (
                    <i className="gbx-hand" title="Demande la manette">
                      <Hand size={12} />
                    </i>
                  )}
                </strong>
                <em className={`gbx-link-${state.tone}`}>
                  {state.tone === "wait" && <Loader size={10} className="spin" />}{" "}
                  {v.pad ? "Tient la manette" : state.label}
                </em>
              </span>
              <button
                className={`gbx-pad-btn clickable ${v.pad ? "on" : ""}`}
                onClick={() => onGrant(v.pad ? null : v.peerId)}
                title={v.pad ? "Reprendre la manette" : `Passer la manette à ${v.username}`}
              >
                <Gamepad2 size={14} />
                {v.pad ? "Reprendre" : "Passer"}
              </button>
            </div>
          );
        })
      )}

      {holder && (
        <p className="gbx-panel-note">
          <strong>{holder.username}</strong> joue à ta place. Ton clavier
          fonctionne toujours — reprends la manette quand tu veux.
        </p>
      )}

      <button className="gbx-stop clickable" onClick={onStop}>
        <Radio size={15} /> Arrêter la diffusion
      </button>
    </div>
  );
}

// Le bandeau « EN DIRECT » de la barre du haut : c'est le seul rappel permanent
// que d'autres yeux sont sur l'écran. Il compte, il ne détaille pas.
export function LiveBadge({ room, onClick }) {
  const n = room.viewers?.length || 0;
  return (
    <button className="gbx-live clickable" onClick={onClick} title="Diffusion en cours">
      <span className="gbx-live-dot" aria-hidden="true" />
      EN DIRECT
      <em>
        <Users size={11} /> {n}
      </em>
    </button>
  );
}

export function StartingBadge() {
  return (
    <span className="gbx-live starting">
      <Loader2 size={12} className="spin" /> Ouverture…
    </span>
  );
}
