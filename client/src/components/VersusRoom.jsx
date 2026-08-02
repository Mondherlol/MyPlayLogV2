import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, UserPlus, Users, X } from "lucide-react";
import { apiFetch } from "../lib/api";

// ======================================================================
//  Les pièces communes d'un salon « versus »
// ======================================================================
// Partagées par GeoGamer (pages/GeoVersus.jsx) et le blind test
// (pages/BlindTestVersus.jsx). Comme pour lib/versusRoom.js côté serveur, on n'y
// met que ce qui est VRAIMENT identique et dont une divergence serait une
// incohérence visible : les têtes des joueurs, le rail qui dit où en est chacun,
// et la modale d'invitation.
//
// Le reste — le plateau, le chrono, la révélation — appartient à chaque jeu :
// un panorama plein écran et un vinyle qui tourne n'ont pas à se ressembler.

// Les couleurs des joueurs, dans l'ordre du salon. Elles les suivent partout
// (rail, épingles de carte, tableau final) pour qu'on les reconnaisse sans lire
// les noms — dans une manche de quinze secondes, on n'a pas le temps de lire.
export const HUES = [200, 280, 40, 330, 160];
export const hueOf = (i) => HUES[i % HUES.length];

// ---------- Une tête ----------
export function VersusFace({ user, size = 28, hue, title }) {
  const style = { width: size, height: size };
  if (hue != null) style["--hue"] = hue;
  return user?.avatar ? (
    <img
      className="gv-face"
      src={user.avatar}
      alt={user.username}
      title={title || user.username}
      style={style}
      loading="lazy"
      draggable="false"
    />
  ) : (
    <span
      className="gv-face letters"
      title={title || user?.username}
      style={{ ...style, fontSize: size * 0.4 }}
    >
      {(user?.username || "?")[0].toUpperCase()}
    </span>
  );
}

// ---------- Le rail des joueurs ----------
// L'objet le plus regardé de l'écran après le chrono : à tout instant, où en
// est chacun. Il porte trois informations et pas une de plus — a trouvé (et à
// quelle place), combien de cœurs il lui reste, ou qu'il est sorti.
//
// CE QU'IL NE MONTRE JAMAIS : ce que les autres ont tapé. Voir un adversaire
// perdre un cœur rend la course lisible ; savoir qu'il a répondu « Zelda »
// donnerait une piste sur la réponse. (Le mode buzzer de GeoGamer fait
// exception et affiche la frappe en direct — il passe alors son propre contenu
// via `renderSub`.)
//
// `row` : disposition horizontale, pour les pages où le rail est en tête de
// colonne plutôt que collé dans un coin.
export function VersusRail({
  players,
  found = [],
  out = [],
  livesById = {},
  hueById,
  missed = {},
  lives: maxLives = 3,
  row = false,
  renderSub = null,
}) {
  return (
    <ul className={`gv-rail ${row ? "row" : ""}`}>
      {players
        .filter((p) => !p.left)
        .map((p) => {
          const hit = found.find((f) => f.userId === p.id);
          const left = livesById[p.id] ?? maxLives;
          const dead = out.includes(p.id);
          const custom = renderSub?.(p, { hit, left, dead });
          return (
            <li
              key={p.id}
              className={`gv-rail-row ${hit ? "found" : ""} ${dead ? "out" : ""} ${
                p.isMe ? "me" : ""
              } ${!p.online ? "away" : ""} ${missed[p.id] ? "missed" : ""}`}
              style={{ "--hue": hueById.get(p.id) }}
            >
              <VersusFace user={p} size={26} hue={hueById.get(p.id)} />
              <span className="gv-rail-id">
                <b>{p.username}</b>
                {custom || (
                  <>
                    {hit ? (
                      <em className="gv-rail-ok">
                        <Check size={11} /> trouvé{" "}
                        {hit.order === 1 ? "en premier" : `${hit.order}ᵉ`}
                      </em>
                    ) : dead ? (
                      <em className="gv-rail-out">plus de vies</em>
                    ) : (
                      <em className="gv-rail-hearts" aria-label={`${left} vies`}>
                        {Array.from({ length: maxLives }).map((_, i) => (
                          <i key={i} className={i < left ? "on" : "off"} />
                        ))}
                      </em>
                    )}
                  </>
                )}
              </span>
              <span className="gv-rail-score">{p.score}</span>
            </li>
          );
        })}
    </ul>
  );
}

// ---------- Inviter ----------
// Deux destinations d'un seul geste, comme le mot du jour : des personnes
// (carte en message privé) et des groupes de discussion (carte dans le fil
// commun). On ne peut écrire qu'à ses abonnés — c'est la règle de la
// messagerie ; pour les autres, il y a le lien.
export function VersusInvite({ token, meId, room, endpoint, title, onClose }) {
  const [people, setPeople] = useState(null);
  const [groups, setGroups] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState("");

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const already = new Set(room.players.filter((p) => !p.left).map((p) => p.id));
    if (meId) {
      apiFetch(`/users/${meId}/followers`, { token })
        .then((d) => setPeople((d.users || []).filter((u) => !already.has(String(u.id)))))
        .catch(() => setPeople([]));
      apiFetch("/chat/conversations", { token })
        .then((d) => setGroups((d.conversations || []).filter((c) => c.isGroup && !c.virtual)))
        .catch(() => setGroups([]));
    } else setPeople([]);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, token, meId, room.players]);

  function toggle(key) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function send() {
    if (!picked.size || sending) return;
    setSending(true);
    try {
      const keys = [...picked];
      const d = await apiFetch(endpoint, {
        method: "POST",
        token,
        body: {
          userIds: keys.filter((k) => k.startsWith("u:")).map((k) => k.slice(2)),
          conversationIds: keys.filter((k) => k.startsWith("g:")).map((k) => k.slice(2)),
        },
      });
      const bits = [];
      if (d.sent?.length) bits.push(`${d.sent.length} joueur${d.sent.length > 1 ? "s" : ""}`);
      if (d.groups?.length) bits.push(`${d.groups.length} groupe${d.groups.length > 1 ? "s" : ""}`);
      // Parti est parti : la modale a fini son travail, on la referme au lieu
      // d'afficher un accusé de réception que personne ne lit — c'est le salon
      // derrière, avec les places qui se remplissent, qui dit que ça a marché.
      if (bits.length) {
        onClose();
        return;
      }
      // Rien n'est parti, en revanche, ça se dit : on reste ouvert.
      setDone("Personne n'a pu être prévenu — partage le lien.");
      setPicked(new Set());
    } catch (e) {
      setDone(e.message);
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gv-inv">
        <header className="gv-inv-head">
          <span>
            <b>{title || "Inviter au versus"}</b>
            <em>Salon {room.code.toUpperCase()}</em>
          </span>
          <button className="geo-icon-btn clickable" onClick={onClose} aria-label="Fermer">
            <X size={17} />
          </button>
        </header>

        <div className="gv-inv-body">
          {people === null ? (
            <div className="gv-inv-wait">
              <Loader2 size={20} className="spin" />
            </div>
          ) : (
            <>
              {groups.length > 0 && (
                <>
                  <h3 className="gv-inv-h">Groupes</h3>
                  <ul className="gv-inv-list">
                    {groups.map((g) => {
                      const key = `g:${g.id}`;
                      return (
                        <li key={key}>
                          <button
                            className={`gv-inv-row clickable ${picked.has(key) ? "on" : ""}`}
                            onClick={() => toggle(key)}
                          >
                            <span className="gv-inv-av group">
                              <Users size={15} />
                            </span>
                            <span className="gv-inv-name">{g.title || "Groupe"}</span>
                            {picked.has(key) && <Check size={15} />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              <h3 className="gv-inv-h">Joueurs</h3>
              {people.length === 0 ? (
                <p className="gv-inv-empty">
                  Personne à inviter pour l'instant — partage le lien du salon.
                </p>
              ) : (
                <ul className="gv-inv-list">
                  {people.map((u) => {
                    const key = `u:${u.id}`;
                    return (
                      <li key={key}>
                        <button
                          className={`gv-inv-row clickable ${picked.has(key) ? "on" : ""}`}
                          onClick={() => toggle(key)}
                        >
                          <VersusFace user={u} size={30} />
                          <span className="gv-inv-name">{u.username}</span>
                          {picked.has(key) && <Check size={15} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>

        <footer className="gv-inv-foot">
          {done && <p className="gv-inv-done">{done}</p>}
          <button className="geo-cta sm clickable" onClick={send} disabled={!picked.size || sending}>
            {sending ? <Loader2 size={15} className="spin" /> : <UserPlus size={15} />}
            Envoyer {picked.size > 0 && `(${picked.size})`}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
