import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Radio,
  Headphones,
  Play,
  Square,
  LogOut,
  Link2,
  Check,
  Search,
  Send,
  Loader2,
  Users,
  Music,
  UserRound,
  ListEnd,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { usePlayer } from "../context/PlayerContext";
import { useListenParty } from "../context/ListenPartyContext";

// ======================================================================
//  Le panneau de la séance d'écoute
// ======================================================================
// LE BOUTON RADIO OUVRAIT DIRECTEMENT LA SÉANCE, sans rien demander ni rien
// montrer. C'est une bonne façon de faire quand il n'y a qu'un geste possible ;
// il y en a quatre — ouvrir, fermer, inviter, partager le lien — et surtout
// AUCUN d'entre eux n'avait de réponse visible (« c'est parti, et maintenant,
// comment je préviens quelqu'un ? »).
//
// D'où ce panneau, ancré au bouton plutôt qu'une modale plein écran : on écoute
// pendant qu'on l'utilise, il ne doit pas prendre la place de ce qu'on lisait.
//
// TROIS BLOCS, DANS L'ORDRE DES QUESTIONS QU'ON SE POSE :
//   1. où j'en suis (ma séance, celle de quelqu'un, aucune) et le bouton qui va
//      avec ;
//   2. qui écoute avec moi ;
//   3. comment en faire venir d'autres — par message privé (dedans) ou par lien
//      (dehors).

export default function ListenPartyPanel({ onClose }) {
  const { token } = useAuth();
  const player = usePlayer();
  const listen = useListenParty();
  const { conversations } = useChat();
  const boxRef = useRef(null);

  const party = listen.party;
  const following = listen.following;
  const listeners = party?.listeners || [];

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    // On se ferme au clic à côté : un panneau ancré n'a pas de fond noir pour
    // l'absorber, et rester ouvert derrière la page serait plus déroutant
    // qu'utile.
    const onDown = (e) => {
      // Le bouton qui nous a ouverts est EXCLU : sans ça, le clic qui doit nous
      // refermer nous fermerait ici puis nous rouvrirait dans son `onClick`
      // — le panneau clignoterait au lieu de se fermer.
      if (e.target.closest?.(".mp-party")) return;
      if (boxRef.current && !boxRef.current.contains(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const track = player.current;

  return createPortal(
    <div className="lpp" ref={boxRef} role="dialog" aria-label="Séance d'écoute">
      <header className="lpp-head">
        <span className="lpp-head-icon">
          <Headphones size={16} />
        </span>
        <div className="lpp-head-txt">
          <strong>Écoute en groupe</strong>
          <span>
            {following
              ? `Tu suis ${party.host?.username || "quelqu'un"}`
              : party
                ? listeners.length
                  ? `${listeners.length} personne${listeners.length > 1 ? "s" : ""} avec toi`
                  : "Séance ouverte — personne encore"
                : "Fais écouter ce que tu écoutes"}
          </span>
        </div>
        <button className="lpp-x clickable" onClick={onClose} aria-label="Fermer">
          <X size={15} />
        </button>
      </header>

      {/* ---------------- 1. Ce qui passe, et le bouton principal ------- */}
      {track && (
        <div className="lpp-track">
          <span className="lpp-track-art">
            {track.artwork ? <img src={track.artwork} alt="" /> : <Music size={16} />}
          </span>
          <span className="lpp-track-txt">
            <strong>{track.name}</strong>
            {(track.artist || track.gameName) && (
              <em>{track.artist || track.gameName}</em>
            )}
          </span>
        </div>
      )}

      {listen.error && <p className="lpp-error">{listen.error}</p>}

      <div className="lpp-main">
        {following ? (
          <>
            {/* Le rattrapage manuel : un navigateur qui a refusé de démarrer le
                son ne changera d'avis que sur un vrai clic. C'est la porte de
                sortie du « je n'entends rien » — et elle sert aussi après une
                longue veille, où l'on se réveille loin derrière. */}
            <button className="lpp-btn ghost clickable" onClick={listen.resync}>
              <Play size={15} /> Me resynchroniser
            </button>
            <button className="lpp-btn danger clickable" onClick={listen.stop}>
              <LogOut size={15} /> Quitter la séance
            </button>
          </>
        ) : party ? (
          <button className="lpp-btn danger clickable" onClick={listen.stop}>
            <Square size={14} /> Arrêter la séance
          </button>
        ) : (
          <button
            className="lpp-btn primary clickable"
            onClick={listen.start}
            disabled={!track || listen.busy}
            title={track ? undefined : "Lance d'abord une piste"}
          >
            {listen.busy ? <Loader2 size={15} className="spin" /> : <Radio size={15} />}
            Démarrer une séance
          </button>
        )}
      </div>

      {/* ---------------- 1 bis. Qui tient la file ----------------
          DEUX DÉCISIONS DIFFÉRENTES, et c'est pour ça que ce réglage existe :
          ouvrir une séance, c'est accepter qu'on écoute ce que je choisis ;
          ouvrir la FILE, c'est accepter qu'on choisisse à ma place. La seconde
          se prend exprès — fermée par défaut. */}
      {party && !following && (
        <label className="lpp-switch">
          <input
            type="checkbox"
            checked={!!party.openQueue}
            onChange={(e) => listen.setOpenQueue(e.target.checked)}
          />
          <span className="lpp-switch-box" aria-hidden="true" />
          <span className="lpp-switch-txt">
            <strong>Les invités peuvent ajouter</strong>
            <em>
              {party.openQueue
                ? "Ils proposent une piste, elle arrive à la fin de ta file."
                : "Toi seul décides de la suite."}
            </em>
          </span>
        </label>
      )}

      {following && party?.openQueue && (
        <p className="lpp-note">
          <ListEnd size={13} /> {party.host?.username} a ouvert sa file : le bouton
          « à la suite » d'une OST lui proposera le morceau.
        </p>
      )}

      {/* Le dernier ajout, en passant. C'est l'accusé de réception de celui qui
          vient de proposer — et pour l'hôte, le seul moyen de savoir qui vient
          de glisser un morceau dans SA file. */}
      {listen.lastAdd && (
        <p className="lpp-add">
          <Check size={13} />
          <span>
            <strong>{listen.lastAdd.name}</strong> ajouté
            {listen.lastAdd.by ? ` par ${listen.lastAdd.by}` : ""}
          </span>
        </p>
      )}

      {/* ---------------- 2. Qui est là ---------------- */}
      {listeners.length > 0 && (
        <div className="lpp-people">
          <span className="lpp-label">
            <Users size={12} /> À l'écoute
          </span>
          <div className="lpp-faces">
            {listeners.map((l) => (
              <span key={l.id} className="lpp-face" title={l.username}>
                {l.avatar ? (
                  <img src={l.avatar} alt={l.username} loading="lazy" />
                ) : (
                  <i>{(l.username || "?")[0].toUpperCase()}</i>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- 3. Faire venir du monde ----------------
          Les deux moyens côte à côte, parce qu'ils ne servent pas au même
          monde : la messagerie pour les gens d'ici, le lien pour les autres
          (un salon Discord, un SMS). */}
      {party && (
        <>
          <ShareLink link={listen.link} />
          <InviteList
            token={token}
            conversations={conversations}
            onInvite={listen.invite}
          />
        </>
      )}
    </div>,
    document.body
  );
}

// ----------------------------------------------------------------------
//  Le lien à coller ailleurs
// ----------------------------------------------------------------------
// Il pointe vers une VRAIE page (/listen/:code) et pas vers l'app en général :
// c'est elle qui donnera l'aperçu dans Discord, et qui accueillera ceux qui
// n'ont pas encore de compte.
function ShareLink({ link }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Presse-papiers refusé (http, vieux navigateur) : on sélectionne le
      // texte pour que le Ctrl+C manuel marche quand même.
      const el = document.getElementById("lpp-link-input");
      el?.select?.();
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="lpp-link">
      <span className="lpp-label">
        <Link2 size={12} /> Lien de la séance
      </span>
      <div className="lpp-link-row">
        <input id="lpp-link-input" readOnly value={link} onFocus={(e) => e.target.select()} />
        <button className="lpp-copy clickable" onClick={copy} title="Copier le lien">
          {copied ? <Check size={14} /> : <Link2 size={14} />}
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
//  Inviter en message privé
// ----------------------------------------------------------------------
// Les contacts viennent de /chat/contacts (les gens à qui l'on a le droit
// d'écrire), et les groupes de la liste de conversations déjà chargée par la
// messagerie — aucune requête de plus pour eux.
function InviteList({ token, conversations, onInvite }) {
  const [q, setQ] = useState("");
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState({});
  const [busyId, setBusyId] = useState(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const id = ++reqRef.current;
    setLoading(true);
    const t = setTimeout(() => {
      apiFetch(`/chat/contacts${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`, {
        token,
      })
        .then((d) => id === reqRef.current && setContacts(d.contacts || []))
        .catch(() => id === reqRef.current && setContacts([]))
        .finally(() => id === reqRef.current && setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, token]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (conversations || [])
      .filter((c) => c.isGroup)
      .filter((c) => !needle || (c.title || "").toLowerCase().includes(needle))
      .slice(0, 6);
  }, [conversations, q]);

  async function send(kind, id) {
    const key = `${kind}:${id}`;
    if (busyId || done[key]) return;
    setBusyId(key);
    try {
      await onInvite(
        kind === "user" ? { userIds: [id] } : { conversationIds: [id] }
      );
      setDone((d) => ({ ...d, [key]: true }));
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="lpp-invite">
      <span className="lpp-label">
        <Send size={12} /> Inviter en message
      </span>
      <div className="lpp-search">
        <Search size={13} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Un pseudo, un groupe…"
        />
      </div>

      <div className="lpp-list">
        {groups.map((c) => {
          const key = `conv:${c.id}`;
          return (
            <button
              key={key}
              type="button"
              className="lpp-row clickable"
              onClick={() => send("conv", c.id)}
              disabled={busyId === key || done[key]}
            >
              <span className="lpp-row-av group">
                <Users size={14} />
              </span>
              <span className="lpp-row-name">{c.title || "Groupe"}</span>
              <span className="lpp-row-do">
                {done[key] ? (
                  <Check size={14} />
                ) : busyId === key ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Send size={13} />
                )}
              </span>
            </button>
          );
        })}

        {loading && !contacts.length ? (
          <div className="lpp-empty">
            <Loader2 size={15} className="spin" />
          </div>
        ) : (
          contacts.map((u) => {
            const key = `user:${u.id}`;
            return (
              <button
                key={key}
                type="button"
                className="lpp-row clickable"
                onClick={() => send("user", u.id)}
                disabled={busyId === key || done[key]}
              >
                <span className="lpp-row-av">
                  {u.avatar ? (
                    <img src={u.avatar} alt="" loading="lazy" />
                  ) : (
                    <UserRound size={14} />
                  )}
                </span>
                <span className="lpp-row-name">{u.username}</span>
                <span className="lpp-row-do">
                  {done[key] ? (
                    <Check size={14} />
                  ) : busyId === key ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Send size={13} />
                  )}
                </span>
              </button>
            );
          })
        )}

        {!loading && !contacts.length && !groups.length && (
          <p className="lpp-empty-txt">
            Personne à inviter ici. Les invitations partent en message privé, donc
            seulement aux gens qui peuvent te lire.
          </p>
        )}
      </div>
    </div>
  );
}
