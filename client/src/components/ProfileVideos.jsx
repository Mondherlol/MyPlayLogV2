import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ThumbsUp,
  Clock,
  Loader2,
  Play,
  X,
  Trash2,
  Gamepad2,
  Film,
} from "lucide-react";
import { apiFetch } from "../lib/api";

// Onglet « Vidéos » du profil : documentaires recommandés (public) et
// « à regarder plus tard » (privé, visible seulement par le propriétaire).
export default function ProfileVideos({ username, isMe, token }) {
  const TABS = [
    { key: "recommended", label: "Recommandations", Icon: ThumbsUp },
    ...(isMe ? [{ key: "later", label: "Regarder plus tard", Icon: Clock }] : []),
  ];
  const [sub, setSub] = useState("recommended");
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(null); // vidéo en lecture (lightbox)

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`/videos/user/${username}?type=${sub}`, { token })
      .then((d) => alive && setVideos(d.videos || []))
      .catch(() => alive && setVideos([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [username, sub, token]);

  async function remove(v) {
    setVideos((list) => list.filter((x) => x.id !== v.id));
    try {
      await apiFetch(`/videos/${v.id}?type=${sub}`, { method: "DELETE", token });
    } catch {
      /* best-effort */
    }
  }

  return (
    <section className="profile-section">
      <div className="act-head">
        <div className="act-subtabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`act-subtab clickable ${sub === t.key ? "active" : ""}`}
              onClick={() => setSub(t.key)}
            >
              <t.Icon size={16} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="doc-state">
          <Loader2 size={22} className="spin" />
        </div>
      ) : videos.length === 0 ? (
        <div className="profile-empty font-fun">
          <Film size={26} style={{ marginBottom: 8 }} />
          <div>
            {sub === "recommended"
              ? isMe
                ? "Tu n'as recommandé aucun documentaire. Lance-en depuis l'accueil !"
                : "Aucun documentaire recommandé pour l'instant."
              : "Aucune vidéo à regarder plus tard."}
          </div>
        </div>
      ) : (
        <div className="doc-grid">
          {videos.map((v) => (
            <div className="doc-card" key={v.id}>
              <button
                className="doc-card-thumb clickable"
                onClick={() => setPlaying(v)}
                title={v.title}
              >
                <img src={v.thumb} alt="" loading="lazy" />
                <span className="doc-card-play">
                  <Play size={22} fill="currentColor" />
                </span>
                {v.duration && <span className="doc-card-dur">{v.duration}</span>}
              </button>
              <div className="doc-card-body">
                <h4 className="doc-card-title" title={v.title}>
                  {v.title}
                </h4>
                <div className="doc-card-meta">
                  {v.author && <span className="doc-card-chan">{v.author}</span>}
                  {v.game && (
                    <span className="doc-card-game">
                      <Gamepad2 size={12} /> {v.game.name}
                    </span>
                  )}
                </div>
              </div>
              {isMe && (
                <button
                  className="doc-card-del clickable"
                  onClick={() => remove(v)}
                  title="Retirer"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {playing &&
        createPortal(
          <div className="modal-overlay doc-overlay" onMouseDown={() => setPlaying(null)}>
            <div className="doc-lightbox" onMouseDown={(e) => e.stopPropagation()}>
              <button
                className="modal-close clickable"
                onClick={() => setPlaying(null)}
                aria-label="Fermer"
              >
                <X size={20} />
              </button>
              <div className="doc-stage">
                <iframe
                  className="doc-player"
                  src={`https://www.youtube.com/embed/${playing.videoId}?autoplay=1&rel=0&modestbranding=1`}
                  title={playing.title}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              </div>
              <div className="doc-info">
                <h3 className="doc-video-title">{playing.title}</h3>
                {playing.author && <span className="doc-chan">{playing.author}</span>}
              </div>
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}
