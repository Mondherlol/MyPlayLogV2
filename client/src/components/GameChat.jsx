import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { MessageCircle, LogIn, LogOut, Send, ChevronDown } from "lucide-react";
import { useChat } from "../context/ChatContext";
import { apiFetch } from "../lib/api";
import { renderMessage } from "./ListComments";
import { HUES } from "./VersusRoom";

// ======================================================================
//  Le chat d'un salon de jeu
// ======================================================================
// La conversation qui accompagne la partie, pour les salons où se parler ne
// donne pas la réponse : blind test, Pixel Rush, Grand Quiz, Le Perroquet.
// (GeoGamer et L'Imposteur n'en ont pas — voir lib/gameChat.js côté serveur,
// qui explique pourquoi.)
//
// ------------------------------------------------------------ un tiroir, pas
// une colonne. Le plateau de ces quatre jeux occupe déjà tout l'écran et se
// regarde à la seconde près : une colonne permanente lui prendrait sa place
// pour un fil qui ne bouge que par intermittence. D'où le tiroir en bas à
// gauche — le coin le plus vide des quatre salons, et surtout PAS le bas droit,
// occupé par les fenêtres de la messagerie et ses bulles.
//
// Il s'ouvre tout seul sur grand écran (dans un salon d'attente, la
// conversation EST ce qui se passe) et reste replié sur téléphone, où il
// couvrirait la moitié du jeu. Replié, il compte les messages non lus.
//
// ------------------------------------------------------------------ le direct
// Rien de neuf côté transport : le serveur rediffuse sous le nom d'évènement DU
// SALON (« pxversus », « quizversus »…) avec `kind: "chat"`. Aucun écouteur à
// ajouter dans context/ChatContext.jsx — c'est justement le piège que cette
// page-là documente en long, et qu'on évite en n'inventant pas de nom.

const QUICK = ["😂", "🔥", "😱", "👏", "😭", "🫡"];
const STICK_PX = 90;
const GROUP_MS = 3 * 60 * 1000;
const MAX_LEN = 300;
const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

export default function GameChat({ token, code, event, endpoint, players = [], meId }) {
  const { subscribe } = useChat();
  const [messages, setMessages] = useState([]);
  const [open, setOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 1100
  );
  const [unread, setUnread] = useState(0);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const scroller = useRef(null);
  const stick = useRef(true);
  const openRef = useRef(open);
  openRef.current = open;

  // Les couleurs des joueurs, dérivées comme dans le rail (components/
  // VersusRoom.jsx) : c'est LE repère du salon, un même joueur ne peut pas être
  // bleu dans le rail et vert dans le fil.
  const hueById = useMemo(() => {
    const m = new Map();
    players.forEach((p, i) => m.set(String(p.id), HUES[i % HUES.length]));
    return m;
  }, [players]);
  const names = useMemo(() => players.map((p) => p.username).filter(Boolean), [players]);

  // Un message peut arriver DEUX FOIS : par la diffusion (l'auteur en fait
  // partie) et par la réponse à son propre POST. On dédoublonne sur l'id plutôt
  // que de choisir l'une des deux sources — le direct peut sauter, la réponse
  // peut arriver après.
  const addMessage = useCallback((m) => {
    if (!m?.id) return;
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    if (!openRef.current) setUnread((n) => n + 1);
  }, []);

  // ---------- Le fil depuis le début ----------
  // Pour qui actualise ou rejoint en cours de route : le serveur garde la
  // conversation en mémoire le temps de la partie.
  useEffect(() => {
    if (!token || !code) return undefined;
    let alive = true;
    apiFetch(`${endpoint}/${code}/chat`, { token })
      .then((d) => alive && setMessages(d.messages || []))
      .catch(() => {
        /* le fil se remplira avec le direct */
      });
    return () => {
      alive = false;
    };
  }, [token, code, endpoint]);

  // ---------- Le direct ----------
  useEffect(() => {
    if (!subscribe || !code) return undefined;
    return subscribe((name, data) => {
      if (name !== event || data?.code !== code || data.kind !== "chat") return;
      addMessage(data.message);
    });
  }, [subscribe, code, event, addMessage]);

  // Le fil colle au bas TANT QU'ON Y EST DÉJÀ : remonter lire ne doit pas être
  // annulé par le message suivant.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current || !open) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    if (open) setUnread(0);
  }, [open, messages]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [open]);

  async function send(value) {
    const body = String(value ?? text).trim();
    if (!body || sending) return;
    setSending(true);
    setText("");
    try {
      const d = await apiFetch(`${endpoint}/${code}/chat`, {
        method: "POST",
        token,
        body: { text: body.slice(0, MAX_LEN) },
      });
      addMessage(d.message);
      stick.current = true;
    } catch {
      // Le message n'est pas parti : on le rend à celui qui l'a écrit plutôt
      // que d'afficher une erreur qu'il ne peut de toute façon pas corriger.
      setText((t) => t || body);
    } finally {
      setSending(false);
    }
  }

  if (!code) return null;

  // RENDU DANS UN PORTAIL, et ce n'est pas un détail : les salons empilent des
  // calques animés (l'éclaboussure de Pixel Rush, le plateau du Quiz), et un
  // ancêtre porteur d'un `transform` ou d'un `filter` re-ancre tout `position:
  // fixed` sur lui-même. Le tiroir se retrouverait alors collé au coin d'un
  // plateau qui bouge au lieu du coin de l'écran.
  return createPortal(
    <section className={`gc-dock ${open ? "open" : ""}`}>
      <button
        className="gc-tab clickable"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <MessageCircle size={15} />
        <span>Chat</span>
        {open ? (
          <ChevronDown size={15} className="gc-tab-caret" />
        ) : (
          unread > 0 && <em className="gc-tab-badge">{unread > 99 ? "99+" : unread}</em>
        )}
      </button>

      {open && (
        <>
          <div className="gc-scroll" ref={scroller}>
            {messages.length === 0 ? (
              <p className="gc-empty">
                Personne n'a encore rien dit. Charrie tes adversaires — ça compte
                pour du beurre, mais ça compte.
              </p>
            ) : (
              messages.map((m, i) => {
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
                    mine={String(m.authorId) === String(meId)}
                    hue={hueById.get(String(m.authorId))}
                    names={names}
                  />
                );
              })
            )}
          </div>

          <div className="gc-quick">
            {QUICK.map((e) => (
              <button
                key={e}
                className="gc-quick-btn clickable"
                onClick={() => send(e)}
                disabled={sending}
                aria-label={`Envoyer ${e}`}
              >
                {e}
              </button>
            ))}
          </div>

          <form
            className="gc-form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              className="gc-input"
              value={text}
              maxLength={MAX_LEN}
              placeholder="Un mot pour la table…"
              onChange={(e) => setText(e.target.value)}
              // La touche Entrée envoie le message et RIEN D'AUTRE : les salons
              // écoutent le clavier pour leur propre champ de réponse, il ne
              // faut pas qu'une vanne parte aussi en proposition de jeu.
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button
              className="gc-send clickable"
              type="submit"
              disabled={!text.trim() || sending}
              aria-label="Envoyer"
            >
              <Send size={15} />
            </button>
          </form>
        </>
      )}
    </section>,
    document.body
  );
}

function Row({ m, grouped, mine, hue, names }) {
  if (m.system) {
    const Icon = m.system === "leave" ? LogOut : LogIn;
    return (
      <p className={`gc-sys ${m.system}`}>
        <Icon size={11} />
        {m.system === "leave"
          ? `${m.name} a quitté le salon`
          : `${m.name} a rejoint le salon`}
      </p>
    );
  }
  return (
    <div
      className={`gc-msg ${mine ? "mine" : ""} ${grouped ? "grouped" : ""}`}
      style={hue != null ? { "--hue": hue } : undefined}
    >
      {!grouped && (
        <p className="gc-msg-who">
          <Link to={`/u/${m.author?.username || ""}`} className="gc-msg-face clickable">
            {m.author?.avatar ? (
              <img src={m.author.avatar} alt="" loading="lazy" draggable="false" />
            ) : (
              <i>{(m.author?.username || "?").slice(0, 1).toUpperCase()}</i>
            )}
          </Link>
          <strong>{m.author?.username || "…"}</strong>
          <em>{timeFmt.format(new Date(m.at))}</em>
        </p>
      )}
      <p className="gc-msg-bubble">{renderMessage(m.text, names)}</p>
    </div>
  );
}
