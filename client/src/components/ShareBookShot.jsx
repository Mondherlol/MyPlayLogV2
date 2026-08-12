import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Loader2,
  Check,
  Send,
  User,
  Users,
  BookOpen,
  Crop,
  Maximize2,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// ---------------------------------------------------------------- recadrage --

// ON NE MONTRE PRESQUE JAMAIS UNE PLANCHE ENTIÈRE. Ce qu'on veut faire voir,
// c'est une case, une tête, une réplique — et l'envoyer avec les onze autres
// cases autour, c'est demander « tu as vu ? » en montrant la page d'un doigt
// flou. Le cadre par défaut reste la capture entière (c'est le cas le plus
// simple, il ne doit rien coûter), mais un glissement sur l'image en garde ce
// qu'on veut, et c'est CE morceau-là qui part.
//
// La sélection est en fractions de l'image (0 → 1), jamais en pixels : la
// capture fait 1400 px de large, l'aperçu 480, et il n'y a aucune raison que
// l'un des deux commande à l'autre.
const MIN_CROP = 0.04; // sous ce bout de tissu, c'est un clic, pas un cadre

function loadImage(src) {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = ko;
    img.src = src;
  });
}

// Le morceau choisi, redécoupé pour de vrai. Sans cadre on rend l'image telle
// quelle : re-encoder une capture pour n'en rien retirer, c'est une génération
// de JPEG perdue pour rien.
async function cutOut(src, crop) {
  if (!crop) return (await fetch(src)).blob();
  const img = await loadImage(src);
  const W = img.naturalWidth || 1;
  const H = img.naturalHeight || 1;
  const sx = Math.round(crop.x * W);
  const sy = Math.round(crop.y * H);
  const sw = Math.max(1, Math.round(crop.w * W));
  const sh = Math.max(1, Math.round(crop.h * H));
  const cv = document.createElement("canvas");
  cv.width = sw;
  cv.height = sh;
  const g = cv.getContext("2d");
  g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.9));
}

// Deux points opposés → un rectangle rangé (x,y au coin haut-gauche), borné à
// l'image : on peut donc partir du milieu et tirer dans n'importe quel sens, y
// compris en sortant du cadre par le bord.
function rectOf(a, b) {
  const x = Math.max(0, Math.min(a.x, b.x));
  const y = Math.max(0, Math.min(a.y, b.y));
  const w = Math.min(1, Math.max(a.x, b.x)) - x;
  const h = Math.min(1, Math.max(a.y, b.y)) - y;
  return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

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

  // Le cadre choisi à la main. `null` = toute la capture, et c'est le départ :
  // on n'oblige personne à recadrer pour envoyer.
  const [crop, setCrop] = useState(null);
  // Le cadre EN COURS DE TRACÉ. Séparé du précédent pour que lâcher un cadre
  // trop petit (un clic maladroit) ne détruise pas celui qu'on avait déjà.
  const [draft, setDraft] = useState(null);
  const stageRef = useRef(null);
  const from = useRef(null);
  const box = draft || crop;

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
  // ET IL REPART À CHAQUE FOIS QU'ON REDÉCOUPE, après un temps mort : recadrer,
  // c'est tirer un cadre puis le refaire trois fois, et envoyer une image à
  // chaque frémissement de la souris remplirait le dossier du chat de vingt
  // captures dont dix-neuf ne serviront jamais. Le compteur repart à zéro à
  // chaque changement — c'est le dernier cadre qui monte, et lui seul.
  useEffect(() => {
    let alive = true;
    setUpload("wait");
    hosted.current = null;
    const t = setTimeout(async () => {
      try {
        const blob = await cutOut(shot, crop);
        if (!blob) throw new Error("découpe vide");
        const fd = new FormData();
        fd.append("media", blob, "planche.jpg");
        const d = await apiUpload("/chat/media", fd, token);
        if (!alive) return;
        hosted.current = d.media?.url || null;
        setUpload(hosted.current ? "ok" : "fail");
      } catch {
        if (alive) setUpload("fail");
      }
    }, crop ? 450 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [shot, token, crop]);

  // ---- le tracé du cadre. Les coordonnées sont prises SUR L'IMAGE affichée,
  //      qui est le seul repère que le doigt connaisse, puis ramenées en
  //      fractions — l'aperçu et la capture ne partagent rien d'autre.
  const at = useCallback((e) => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }, []);

  function grab(e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    from.current = at(e);
    setDraft({ ...from.current, w: 0, h: 0 });
  }

  function drag(e) {
    if (!from.current) return;
    setDraft(rectOf(from.current, at(e)));
  }

  function drop(e) {
    if (!from.current) return;
    const r = rectOf(from.current, at(e));
    from.current = null;
    setDraft(null);
    // Un cadre minuscule est un clic : il REND la planche entière plutôt que
    // d'envoyer un timbre-poste que personne n'a voulu.
    setCrop(r.w > MIN_CROP && r.h > MIN_CROP ? r : null);
  }

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
            cover: media.poster || null,
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
          <div
            className={`bshot-stage ${box ? "cropping" : ""}`}
            ref={stageRef}
            onPointerDown={grab}
            onPointerMove={drag}
            onPointerUp={drop}
            onPointerCancel={drop}
          >
            <img src={shot} alt="" draggable="false" />
            {/* LE CADRE EST UN TROU, PAS UN RECTANGLE POSÉ DESSUS. Ce qu'on
                garde reste à sa clarté d'origine, et c'est TOUT LE RESTE qui
                s'assombrit : on voit d'un coup d'œil ce qui part, sans avoir à
                deviner de quel côté du trait on se trouve. */}
            {box && (
              <>
                <span
                  className="bshot-veil"
                  style={{
                    clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${
                      box.x * 100
                    }% ${box.y * 100}%, ${box.x * 100}% ${(box.y + box.h) * 100}%, ${
                      (box.x + box.w) * 100
                    }% ${(box.y + box.h) * 100}%, ${(box.x + box.w) * 100}% ${
                      box.y * 100
                    }%, ${box.x * 100}% ${box.y * 100}%)`,
                  }}
                />
                <span
                  className="bshot-frame"
                  style={{
                    left: `${box.x * 100}%`,
                    top: `${box.y * 100}%`,
                    width: `${box.w * 100}%`,
                    height: `${box.h * 100}%`,
                  }}
                />
              </>
            )}
          </div>
          {upload === "wait" && (
            <figcaption>
              <Loader2 size={13} className="spin" /> On prépare l'image…
            </figcaption>
          )}
          {upload === "fail" && (
            <figcaption className="bad">L'image n'a pas pu être envoyée.</figcaption>
          )}
        </figure>

        {/* La consigne ne s'affiche qu'AVANT le premier cadre : une fois qu'on
            a compris le geste, la seule chose utile est d'en sortir. */}
        <div className="bshot-crop-bar">
          {crop ? (
            <>
              <span>
                <Crop size={13} /> Cadre choisi — reglisse pour le refaire.
              </span>
              <button className="bshot-full clickable" onClick={() => setCrop(null)}>
                <Maximize2 size={13} /> Toute la planche
              </button>
            </>
          ) : (
            <span>
              <Crop size={13} /> Glisse sur l'image pour n'envoyer qu'un bout —
              sinon elle part entière.
            </span>
          )}
        </div>

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
