import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Check, Send, User, Users, BookOpen } from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// ======================================================================
//  « Regarde ça » — envoyer un passage de bouquin
// ======================================================================
// LA CAPTURE EST DÉJÀ PRISE quand cette fenêtre s'ouvre : le lecteur la lui
// tend en clair (une URL de données), et elle s'affiche donc TOUT DE SUITE,
// pendant que l'image monte au serveur en tâche de fond. C'est le bon ordre —
// on vient de voir quelque chose, on veut le montrer, et l'attente d'un envoi
// n'a pas sa place entre les deux.
//
// DEUX DESTINATIONS D'UN SEUL GESTE, comme les invitations de versus : des
// personnes (la carte arrive en message privé) et des groupes de discussion
// (elle arrive dans le fil commun). On ne peut écrire qu'à ses abonnés — c'est
// la règle de la messagerie, pas une règle de cette fenêtre.
//
// CE QUI PART N'EST PAS QU'UNE IMAGE. La carte porte le volume et le numéro de
// planche : celui qui la reçoit peut ouvrir le bouquin PILE LÀ, ou le prendre
// depuis le début si le passage lui a donné envie de tout lire (voir la carte
// côté messagerie, ChatThread).
export default function ShareBookShot({ media, shot, page, onClose }) {
  const { token, user } = useAuth();
  const [people, setPeople] = useState(null);
  const [groups, setGroups] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState("");
  // L'URL de la capture UNE FOIS CHEZ NOUS. Elle monte une seule fois, quel que
  // soit le nombre de destinataires : c'est la même image pour tout le monde.
  const hosted = useRef(null);
  const [upload, setUpload] = useState("wait"); // wait | ok | fail

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Les gens à qui l'on peut écrire, et les groupes où l'on est déjà.
  useEffect(() => {
    apiFetch("/chat/contacts", { token })
      .then((d) => setPeople(d.contacts || []))
      .catch(() => setPeople([]));
    apiFetch("/chat/conversations", { token })
      .then((d) => setGroups((d.conversations || []).filter((c) => c.isGroup && !c.virtual)))
      .catch(() => setGroups([]));
  }, [token]);

  // L'envoi de l'image, dès l'ouverture : le temps qu'on choisisse à qui, elle
  // est arrivée. Une capture de 1400 px pèse quelques centaines de kilooctets,
  // c'est l'affaire d'un instant — mais pas d'un instant qu'on veut passer à
  // regarder un bouton tourner après avoir cliqué sur « Envoyer ».
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const blob = await (await fetch(shot)).blob();
        const fd = new FormData();
        fd.append("media", blob, "planche.jpg");
        const d = await apiUpload("/chat/media", fd, token);
        if (!alive) return;
        hosted.current = d.media?.url || null;
        setUpload(hosted.current ? "ok" : "fail");
      } catch {
        if (alive) setUpload("fail");
      }
    })();
    return () => {
      alive = false;
    };
  }, [shot, token]);

  function toggle(key) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function send() {
    if (!picked.size || sending || upload !== "ok") return;
    setSending(true);
    setDone("");
    try {
      const keys = [...picked];
      const d = await apiFetch("/chat/share-book", {
        method: "POST",
        token,
        body: {
          userIds: keys.filter((k) => k.startsWith("u:")).map((k) => k.slice(2)),
          conversationIds: keys.filter((k) => k.startsWith("g:")).map((k) => k.slice(2)),
          message: message.trim() || undefined,
          book: {
            slug: media.slug,
            title: media.title,
            franchise: media.franchise || "",
            page,
            pages: media.pages?.length || media.pageCount || 0,
            shot: hosted.current,
            color: media.color || null,
          },
        },
      });
      const bits = [];
      if (d.sent?.length) bits.push(`${d.sent.length} personne${d.sent.length > 1 ? "s" : ""}`);
      if (d.groups?.length) bits.push(`${d.groups.length} groupe${d.groups.length > 1 ? "s" : ""}`);
      setDone(bits.length ? `Envoyé à ${bits.join(" et ")}.` : "Personne n'a pu recevoir le passage.");
      setPicked(new Set());
    } catch (e) {
      setDone(e.message);
    } finally {
      setSending(false);
    }
  }

  const list = people || [];

  return createPortal(
    <div
      className="modal-overlay bshot-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bshot">
        <header className="bshot-head">
          <span>
            <b>Partager ce passage</b>
            <em>
              {media.title} · planche {page + 1}
            </em>
          </span>
          <button className="bshot-x clickable" onClick={onClose} aria-label="Fermer">
            <X size={17} />
          </button>
        </header>

        {/* LA CAPTURE, EN GRAND ET EN PREMIER. C'est elle qu'on envoie, elle
            doit donc être ce qu'on voit — et telle qu'elle partira, pas
            rognée dans une vignette de la taille d'un timbre. */}
        <figure className="bshot-shot">
          <img src={shot} alt="" />
          {upload === "wait" && (
            <figcaption>
              <Loader2 size={13} className="spin" /> On prépare l'image…
            </figcaption>
          )}
          {upload === "fail" && (
            <figcaption className="bad">L'image n'a pas pu être envoyée.</figcaption>
          )}
        </figure>

        <textarea
          className="bshot-msg"
          placeholder="Un mot avec ? (« regarde la tête du mec »…)"
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 280))}
          rows={2}
        />

        <div className="bshot-list">
          {people === null ? (
            <div className="bshot-wait">
              <Loader2 size={18} className="spin" />
            </div>
          ) : (
            <>
              {groups.length > 0 && (
                <>
                  <h3>Groupes</h3>
                  <ul>
                    {groups.map((g) => {
                      const key = `g:${g.id}`;
                      return (
                        <li key={key}>
                          <button
                            className={`bshot-row clickable ${picked.has(key) ? "on" : ""}`}
                            onClick={() => toggle(key)}
                          >
                            <span className="bshot-av group">
                              <Users size={15} />
                            </span>
                            <span className="bshot-name">{g.title || "Groupe"}</span>
                            {picked.has(key) && <Check size={15} />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              <h3>Tes abonnés</h3>
              <ul>
                {list
                  .filter((u) => String(u.id) !== String(user?.id))
                  .map((u) => {
                    const key = `u:${u.id}`;
                    return (
                      <li key={key}>
                        <button
                          className={`bshot-row clickable ${picked.has(key) ? "on" : ""}`}
                          onClick={() => toggle(key)}
                        >
                          <span className="bshot-av">
                            {u.avatar ? <img src={u.avatar} alt="" /> : <User size={15} />}
                          </span>
                          <span className="bshot-name">{u.username}</span>
                          {picked.has(key) && <Check size={15} />}
                        </button>
                      </li>
                    );
                  })}
              </ul>

              {!list.length && !groups.length && (
                <p className="bshot-empty">
                  Seuls tes abonnés peuvent recevoir un partage — personne pour
                  l'instant.
                </p>
              )}
            </>
          )}
        </div>

        <footer className="bshot-foot">
          {done && <span className="bshot-done">{done}</span>}
          <button
            className="btn btn-primary clickable"
            onClick={send}
            disabled={!picked.size || sending || upload !== "ok"}
          >
            {sending ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Send size={15} />
            )}
            Envoyer
            {picked.size > 0 && <em> ({picked.size})</em>}
          </button>
        </footer>

        <p className="bshot-note">
          <BookOpen size={12} />
          La personne pourra ouvrir le volume à cette planche — ou depuis le
          début.
        </p>
      </div>
    </div>,
    document.body
  );
}
