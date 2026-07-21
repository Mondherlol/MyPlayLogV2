import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Loader2,
  Plus,
  Send,
  Inbox,
  Flame,
  User,
  Gamepad2,
  Calendar,
  Search,
  MessageCircle,
  CornerDownRight,
  Trash2,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { timeAgo } from "../lib/lists";

const SUBTABS = [
  { key: "received", label: "Reçues", Icon: Inbox },
  { key: "sent", label: "Envoyées", Icon: Send },
];

const SORTS = [
  { key: "top", label: "Plus recommandés" },
  { key: "recent", label: "Plus récentes" },
  { key: "az", label: "A → Z" },
];

// Ligne de méta d'un jeu (année · genre · plateformes).
function GameMeta({ rec }) {
  const chips = (rec.platforms || []).slice(0, 4);
  const genre = rec.genres?.[0];
  return (
    <div className="reco-metaline">
      {rec.year != null && (
        <span className="reco-meta-item">
          <Calendar size={12} /> {rec.year}
        </span>
      )}
      {genre && <span className="reco-meta-item">{genre}</span>}
      {chips.length > 0 && (
        <span className="reco-plats">
          {chips.map((p) => (
            <span className="reco-plat" key={p}>
              {p}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

// Carte d'une recommandation reçue.
function RecoCard({ rec, token, onBoost, onCommentAdded }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const names = rec.recommenders.map((r) => r.user?.username).filter(Boolean);
  const withMsg = rec.recommenders.find((r) => r.message);

  async function addComment() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const { comment } = await apiFetch(`/recommendations/${rec.id}/comments`, {
        method: "POST",
        token,
        body: { text: t },
      });
      onCommentAdded(rec.id, comment);
      setText("");
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <article className="reco-card">
      <Link to={`/game/${rec.gameId}`} className="reco-cover clickable">
        {rec.cover ? (
          <img src={rec.cover} alt={rec.name} loading="lazy" />
        ) : (
          <span className="reco-cover-ph">
            <Gamepad2 size={24} />
          </span>
        )}
      </Link>

      <div className="reco-body">
        <div className="reco-top">
          <Link to={`/game/${rec.gameId}`} className="reco-name clickable">
            {rec.name}
          </Link>
          <button
            className={`reco-plus clickable ${rec.iBoosted ? "on" : ""} ${rec.iRecommended ? "mine" : ""}`}
            onClick={() => !rec.iRecommended && onBoost(rec.id)}
            disabled={rec.iRecommended}
            title={
              rec.iRecommended
                ? "Tu as recommandé ce jeu"
                : rec.iBoosted
                ? "Retirer ton +1"
                : "Faire +1"
            }
          >
            {rec.iRecommended ? <Flame size={14} /> : <Plus size={14} />}
            <b>{rec.count}</b>
          </button>
        </div>

        <GameMeta rec={rec} />

        {/* Recommandeurs : leurs têtes + noms */}
        <div className="reco-by">
          <div className="reco-by-avs">
            {rec.recommenders.slice(0, 5).map((r, i) => (
              <Link
                to={r.user ? `/u/${r.user.username}` : "#"}
                className="reco-by-av clickable"
                key={i}
                title={r.user?.username}
              >
                {r.user?.avatar ? (
                  <img src={r.user.avatar} alt="" loading="lazy" />
                ) : (
                  <User size={13} />
                )}
              </Link>
            ))}
          </div>
          <span className="reco-by-txt">
            Recommandé par{" "}
            <strong>{names.slice(0, 2).join(", ")}</strong>
            {names.length > 2 && ` et ${names.length - 2} autre${names.length - 2 > 1 ? "s" : ""}`}
          </span>
        </div>

        {withMsg && <p className="reco-msg">« {withMsg.message} »</p>}

        {/* Commentaires */}
        <div className="reco-comments">
          <button className="reco-comments-toggle clickable" onClick={() => setOpen((v) => !v)}>
            <MessageCircle size={14} />
            {rec.comments.length > 0
              ? `${rec.comments.length} commentaire${rec.comments.length > 1 ? "s" : ""}`
              : "Répondre"}
          </button>

          {open && (
            <div className="reco-comments-body">
              {rec.comments.map((c) => (
                <div className="reco-comment" key={c.id}>
                  <Link to={c.user ? `/u/${c.user.username}` : "#"} className="reco-comment-av clickable">
                    {c.user?.avatar ? <img src={c.user.avatar} alt="" /> : <User size={12} />}
                  </Link>
                  <div className="reco-comment-body">
                    <span className="reco-comment-head">
                      <Link to={c.user ? `/u/${c.user.username}` : "#"} className="reco-comment-name clickable">
                        {c.user?.username || "?"}
                      </Link>
                      <span className="reco-comment-time">{timeAgo(c.createdAt)}</span>
                    </span>
                    <span className="reco-comment-text">{c.text}</span>
                  </div>
                </div>
              ))}

              <div className="reco-comment-composer">
                <CornerDownRight size={14} className="reco-comment-icon" />
                <input
                  type="text"
                  placeholder="Écrire un commentaire…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addComment()}
                />
                <button className="reco-comment-send clickable" onClick={addComment} disabled={sending || !text.trim()}>
                  {sending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function ProfileRecommendations({ username, token, isMe }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sub, setSub] = useState("received");
  const [sort, setSort] = useState("top");
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    apiFetch(`/users/${username}/recommendations`, { token })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [username, token]);

  async function boost(recId) {
    setData((d) => ({
      ...d,
      received: d.received.map((r) =>
        r.id !== recId ? r : { ...r, iBoosted: !r.iBoosted, count: r.count + (r.iBoosted ? -1 : 1) }
      ),
    }));
    try {
      await apiFetch(`/recommendations/${recId}/boost`, { method: "POST", token });
    } catch {
      /* état optimiste conservé */
    }
  }

  // Retirer une recommandation que J'AI faite. Côté serveur je suis simplement
  // sorti des recommandeurs (la carte survit si quelqu'un d'autre l'a aussi
  // recommandée) ; ici elle quitte ma liste « Envoyées » dans tous les cas.
  // Retrait optimiste, remis en place si l'appel échoue.
  async function removeSent(rec) {
    if (!window.confirm(`Retirer ta recommandation de « ${rec.name} » ?`)) return;
    const prev = data.sent;
    setData((d) => ({ ...d, sent: d.sent.filter((r) => r.id !== rec.id) }));
    try {
      await apiFetch(`/recommendations/${rec.id}`, { method: "DELETE", token });
    } catch (err) {
      setData((d) => ({ ...d, sent: prev }));
      alert(err.message);
    }
  }

  function onCommentAdded(recId, comment) {
    setData((d) => ({
      ...d,
      received: d.received.map((r) =>
        r.id !== recId ? r : { ...r, comments: [...r.comments, comment] }
      ),
    }));
  }

  const received = useMemo(() => {
    if (!data?.received) return [];
    let arr = data.received;
    const term = q.trim().toLowerCase();
    if (term) arr = arr.filter((r) => r.name.toLowerCase().includes(term));
    arr = [...arr];
    if (sort === "recent") arr.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    else if (sort === "az") arr.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    else arr.sort((a, b) => b.count - a.count);
    return arr;
  }, [data, sort, q]);

  const sent = useMemo(() => {
    if (!data?.sent) return [];
    const term = q.trim().toLowerCase();
    return term ? data.sent.filter((r) => r.name.toLowerCase().includes(term)) : data.sent;
  }, [data, q]);

  if (loading)
    return (
      <div className="act-loading">
        <Loader2 size={20} className="spin" /> Chargement des recommandations…
      </div>
    );
  if (error) return <div className="profile-empty font-fun">{error}</div>;

  return (
    <div className="act reco">
      <div className="act-head">
        <div className="act-subtabs">
          {SUBTABS.map((s) => (
            <button
              key={s.key}
              className={`act-subtab clickable ${sub === s.key ? "active" : ""}`}
              onClick={() => setSub(s.key)}
            >
              <s.Icon size={16} /> {s.label}
              <span className="act-subtab-count">
                {s.key === "received" ? data.received.length : data.sent.length}
              </span>
            </button>
          ))}
        </div>

        <div className="act-head-tools">
          <div className="reco-search">
            <Search size={15} />
            <input placeholder="Filtrer un jeu…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {sub === "received" && (
            <label className="act-sort">
              <span className="act-sort-label">Trier</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {sub === "received" &&
        (received.length === 0 ? (
          <div className="profile-empty font-fun">
            {q.trim()
              ? "Aucun jeu ne correspond."
              : isMe
              ? "Personne ne t'a encore recommandé de jeu."
              : "Ce joueur n'a pas encore reçu de recommandation."}
          </div>
        ) : (
          <div className="reco-list">
            {received.map((r) => (
              <RecoCard
                key={r.id}
                rec={r}
                token={token}
                onBoost={boost}
                onCommentAdded={onCommentAdded}
              />
            ))}
          </div>
        ))}

      {sub === "sent" &&
        (sent.length === 0 ? (
          <div className="profile-empty font-fun">
            {q.trim()
              ? "Aucun jeu ne correspond."
              : isMe
              ? "Tu n'as encore recommandé aucun jeu."
              : "Aucune recommandation envoyée."}
          </div>
        ) : (
          <div className="reco-sent-list">
            {sent.map((r) => (
              <article className="reco-sent" key={r.id}>
                <Link to={`/game/${r.gameId}`} className="reco-sent-cover clickable">
                  {r.cover ? <img src={r.cover} alt={r.name} loading="lazy" /> : <Gamepad2 size={20} />}
                </Link>
                <div className="reco-sent-body">
                  <Link to={`/game/${r.gameId}`} className="reco-sent-name clickable">
                    {r.name}
                  </Link>
                  <span className="reco-sent-to">
                    à{" "}
                    <Link to={r.to ? `/u/${r.to.username}` : "#"} className="reco-sent-user clickable">
                      @{r.to?.username || "?"}
                    </Link>
                    {r.message && <span className="reco-sent-msg"> · « {r.message} »</span>}
                  </span>
                </div>
                <span className="reco-sent-up" title="+1 au total">
                  <Flame size={13} /> {r.count}
                </span>
                {/* On ne retire que SES propres recommandations. */}
                {isMe && (
                  <button
                    className="reco-sent-del clickable"
                    onClick={() => removeSent(r)}
                    title="Retirer cette recommandation"
                    aria-label={`Retirer la recommandation de ${r.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </article>
            ))}
          </div>
        ))}
    </div>
  );
}
