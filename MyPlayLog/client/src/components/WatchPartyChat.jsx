import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, SmilePlus, LogIn, LogOut, Clapperboard } from "lucide-react";
import ChatComposer from "./ChatComposer";
import { renderMessage } from "./ListComments";
import ChatLightbox from "./ChatLightbox";

// ======================================================================
//  Le salon — la conversation qui accompagne l'image
// ======================================================================
// Les codes de la messagerie, sans son poids : mêmes bulles, mêmes émojis
// twemoji, même composeur (`ChatComposer` — donc GIF, images collées, sélecteur
// d'émojis, tout ce qui existe déjà, gratuitement). Ce qui change vient de ce
// qu'un salon de séance n'est pas une discussion qu'on retrouve :
//
//   • PAS DE RÉPONSE CITÉE, PAS D'ÉDITION, PAS DE SUPPRESSION. Un commentaire de
//     film est jetable, il vaut pour la minute où il s'écrit ; l'appareillage de
//     la messagerie n'a rien à y faire ;
//   • PAS D'ACCUSÉS DE LECTURE : tout le monde est devant l'écran, c'est le
//     principe ;
//   • LES LIGNES DE SERVICE (« a rejoint », « on regarde maintenant… ») font
//     partie du fil : c'est le journal de la soirée autant que la conversation.
//
// Le fil colle au bas de lui-même TANT QU'ON Y EST DÉJÀ. Remonter lire ce qui
// s'est dit ne doit pas être annulé par le message suivant — d'où la mesure de
// la distance au bas avant chaque ajout.

const QUICK = ["😂", "🔥", "❤️", "😱", "👏", "🍿"];
const STICK_PX = 120;
const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
// Deux messages du même auteur à moins de trois minutes d'écart forment un
// bloc : un seul pseudo, une seule photo.
const GROUP_MS = 3 * 60 * 1000;

export default function WatchPartyChat({ pt, compact, onClose }) {
  const { messages, chat, me, party, typingNames, members } = pt;
  const scroller = useRef(null);
  const stick = useRef(true);
  const [zoom, setZoom] = useState(null);

  // DEUX FORMES DU MÊME ANNUAIRE, et ce n'est pas de la duplication : le calque
  // de frappe interroge un ensemble EN MINUSCULES (il colore « @Toto » comme
  // « @toto »), tandis que le rendu d'un message a besoin des pseudos DANS LEUR
  // CASSE — c'est avec eux qu'il fabrique le lien vers le profil. Un seul des
  // deux, et l'on perd soit la coloration, soit le lien.
  //
  // Les mentions ne sont pas résolues côté serveur pour un salon de séance : on
  // prend les gens présents. C'est exactement ceux qu'on interpelle pendant un
  // film.
  const names = useMemo(() => (members || []).map((m) => m.username), [members]);
  const mentionKeys = useMemo(
    () => new Set(names.map((n) => n.toLowerCase())),
    [names]
  );

  // Avant chaque peinture : est-on assez près du bas pour suivre ?
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, typingNames.length]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      stick.current = gap < STICK_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section className={`wp-chat ${compact ? "is-compact" : ""}`}>
      <header className="wp-chat-head">
        <span className="wp-chat-title">
          <MessageCircle size={15} /> Salon
          <em>
            {members.length} {members.length > 1 ? "spectateurs" : "spectateur"}
          </em>
        </span>
        {onClose && (
          <button className="wp-chat-x clickable" onClick={onClose} aria-label="Fermer le salon">
            ×
          </button>
        )}
      </header>

      <div className="wp-chat-scroll" ref={scroller}>
        {messages.length === 0 && (
          <p className="wp-chat-empty">
            Le salon est vide. Lance la conversation — ou une poignée d'émojis
            par-dessus l'image.
          </p>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const grouped =
            !m.system &&
            prev &&
            !prev.system &&
            prev.authorId === m.authorId &&
            new Date(m.at) - new Date(prev.at) < GROUP_MS;
          return (
            <Row
              key={m.id}
              m={m}
              grouped={grouped}
              mine={String(m.authorId) === String(me?.id)}
              meId={me?.id}
              names={names}
              party={party}
              onReact={(emoji) => chat.react(m.id, emoji)}
              onZoom={setZoom}
            />
          );
        })}
      </div>

      {typingNames.length > 0 && (
        <p className="wp-chat-typing">
          <i />
          <i />
          <i />
          {typingNames.slice(0, 2).join(", ")}
          {typingNames.length > 2 ? " et d'autres" : ""} écri
          {typingNames.length > 1 ? "vent" : "t"}…
        </p>
      )}

      <ChatComposer
        token={pt.token}
        conversationId={party?.code}
        onSend={chat.send}
        onTyping={chat.typing}
        mentionNames={mentionKeys}
      />

      {zoom && <ChatLightbox url={zoom} onClose={() => setZoom(null)} />}
    </section>
  );
}

function Row({ m, grouped, mine, meId, names, party, onReact, onZoom }) {
  const [pick, setPick] = useState(false);

  if (m.system) return <SystemLine m={m} party={party} />;

  return (
    <div className={`wp-msg ${mine ? "mine" : ""} ${grouped ? "grouped" : ""}`}>
      {!grouped && (
        <Link to={`/u/${m.author?.username || ""}`} className="wp-msg-face clickable">
          {m.author?.avatar ? (
            <img src={m.author.avatar} alt="" loading="lazy" />
          ) : (
            <i>{(m.author?.username || "?").slice(0, 1).toUpperCase()}</i>
          )}
        </Link>
      )}
      <div className="wp-msg-body">
        {!grouped && (
          <p className="wp-msg-who">
            <strong>{m.author?.username || "…"}</strong>
            <em>{timeFmt.format(new Date(m.at))}</em>
          </p>
        )}
        <div className="wp-msg-bubble">
          {m.text && <p>{renderMessage(m.text, names)}</p>}
          {m.media?.length > 0 && (
            <div className={`wp-msg-media n-${Math.min(m.media.length, 4)}`}>
              {m.media.map((md, i) => (
                <button
                  type="button"
                  key={i}
                  className="clickable"
                  onClick={() => onZoom(md.url)}
                >
                  <img src={md.url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}

          {/* La réaction se pose au survol (et au clic sur téléphone, où il n'y a
              pas de survol) : une rangée d'émojis sous chaque bulle mangerait
              tout le salon. */}
          <div className="wp-msg-tools">
            <button
              className="wp-msg-tool clickable"
              onClick={() => setPick((v) => !v)}
              aria-label="Réagir"
            >
              <SmilePlus size={14} />
            </button>
            {pick && (
              <div className="wp-msg-pick">
                {QUICK.map((e) => (
                  <button
                    key={e}
                    className="clickable"
                    onClick={() => {
                      onReact(e);
                      setPick(false);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {m.reactions?.length > 0 && (
          <div className="wp-msg-reacts">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                className={`wp-msg-react clickable ${
                  r.users.includes(String(meId)) ? "mine" : ""
                }`}
                onClick={() => onReact(r.emoji)}
                title={r.users
                  .map((id) => party?.members?.find((x) => String(x.id) === id)?.username)
                  .filter(Boolean)
                  .join(", ")}
              >
                {r.emoji} <em>{r.count}</em>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Les lignes de service : centrées, sans bulle, avec l'icône de ce qui s'est
// passé. Elles racontent la soirée — qui est arrivé, quand on a changé de film.
function SystemLine({ m }) {
  const d = m.systemData || {};
  const name = d.name || m.author?.username || "Quelqu'un";
  const Icon = m.system === "join" ? LogIn : m.system === "leave" ? LogOut : Clapperboard;
  const text =
    m.system === "join"
      ? `${name} a rejoint la séance`
      : m.system === "leave"
        ? `${name} est parti`
        : `${name} a mis « ${d.title || "autre chose"} »`;
  return (
    <p className={`wp-sys ${m.system}`}>
      <Icon size={12} /> {text}
      <em>{timeFmt.format(new Date(m.at))}</em>
    </p>
  );
}
