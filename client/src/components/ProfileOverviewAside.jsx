import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Hourglass,
  Joystick,
  Play,
  Pause,
  Disc3,
  Music,
  Film,
  ListMusic,
  MessageSquareText,
  Star,
  ArrowRight,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { typeMeta, timeAgo } from "../lib/lists";

const nf = new Intl.NumberFormat("fr-FR");

function fmtHours(h) {
  if (!h) return "0 h";
  if (h >= 1000) return `${nf.format(Math.round(h / 100) / 10)} k h`;
  return `${nf.format(Math.round(h))} h`;
}

// Petite carte titrée réutilisée par tous les blocs de l'aside.
function AsideCard({ Icon, title, more, children }) {
  return (
    <section className="pf-aside-card">
      <header className="pf-aside-head">
        <span className="pf-aside-title">
          <Icon size={14} /> {title}
        </span>
        {more}
      </header>
      {children}
    </section>
  );
}

// Colonne latérale de l'onglet « Aperçu » (PC) : condensé de stats + derniers
// contenus du joueur (vidéo reco, listes publiques, OST likée, review).
export default function ProfileOverviewAside({ username, token, library, lists, onOpenTab }) {
  // --- Dérivé de la bibliothèque déjà chargée (aucune requête) ---
  const totalHours = useMemo(
    () => library.reduce((s, e) => s + (e.playtimeHours || 0), 0),
    [library]
  );
  const topPlat = useMemo(() => {
    const m = new Map();
    for (const e of library) {
      if (!e.platform) continue;
      const cur = m.get(e.platform) || { count: 0, hours: 0 };
      cur.count += 1;
      cur.hours += e.playtimeHours || 0;
      m.set(e.platform, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count)[0] || null;
  }, [library]);

  const publicLists = useMemo(
    () => lists.filter((l) => l.visibility === "public").slice(0, 3),
    [lists]
  );

  const lastOst = useMemo(() => {
    const withOst = library.filter((e) => e.favoriteOst?.name);
    withOst.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return withOst[0] || null;
  }, [library]);

  // --- Contenus qui nécessitent une requête (best-effort) ---
  const [video, setVideo] = useState(undefined);
  const [review, setReview] = useState(undefined);

  useEffect(() => {
    let alive = true;
    apiFetch(`/videos/user/${username}?type=recommended`, { token })
      .then((d) => alive && setVideo(d.videos?.[0] || null))
      .catch(() => alive && setVideo(null));
    apiFetch(`/users/${username}/activity`, { token })
      .then((d) => alive && setReview(d.reviews?.[0] || null))
      .catch(() => alive && setReview(null));
    return () => {
      alive = false;
    };
  }, [username, token]);

  // --- Lecture de l'extrait de la dernière OST (iTunes) ---
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const ost = lastOst?.favoriteOst;
  const canPlayOst = !!(ost && (ost.preview || (ost.youtube && ost.url)));

  useEffect(() => {
    const a = audioRef.current;
    return () => a?.pause();
  }, []);

  function toggleOst() {
    if (!ost) return;
    if (ost.preview) {
      const a = audioRef.current;
      if (!a) return;
      if (playing) {
        a.pause();
        setPlaying(false);
      } else {
        a.src = ost.preview;
        a.play().catch(() => {});
        setPlaying(true);
      }
    } else if (ost.youtube && ost.url) {
      window.open(ost.url, "_blank", "noopener");
    }
  }

  return (
    <aside className="pf-overview-aside">
      <audio ref={audioRef} onEnded={() => setPlaying(false)} hidden />

      {/* ---------- Temps de jeu + console fétiche ---------- */}
      <AsideCard Icon={Hourglass} title="Temps de jeu">
        <div className="pfa-stat">
          <span className="pfa-stat-value">{fmtHours(totalHours)}</span>
          <span className="pfa-stat-label">passées manette en main</span>
        </div>
        {topPlat && (
          <div className="pfa-stat-plat">
            <span className="pfa-stat-plat-ic">
              <Joystick size={15} />
            </span>
            <span className="pfa-stat-plat-body">
              <span className="pfa-stat-plat-name">{topPlat[0]}</span>
              <span className="pfa-stat-plat-sub">
                console la plus jouée · {nf.format(topPlat[1].count)} jeu
                {topPlat[1].count > 1 ? "x" : ""}
              </span>
            </span>
          </div>
        )}
      </AsideCard>

      {/* ---------- Dernière vidéo recommandée ---------- */}
      {video && (
        <AsideCard
          Icon={Film}
          title="Dernière reco vidéo"
          more={
            <button className="pf-aside-more clickable" onClick={() => onOpenTab("videos")}>
              Tout voir <ArrowRight size={12} />
            </button>
          }
        >
          <a
            className="pfa-video clickable"
            href={`https://www.youtube.com/watch?v=${video.videoId}`}
            target="_blank"
            rel="noreferrer"
            title={video.title}
          >
            <span className="pfa-video-thumb">
              <img src={video.thumb} alt="" loading="lazy" />
              <span className="pfa-video-play">
                <Play size={18} fill="currentColor" strokeWidth={0} />
              </span>
              {video.duration && <span className="pfa-video-dur">{video.duration}</span>}
            </span>
            <span className="pfa-video-body">
              <span className="pfa-video-title">{video.title}</span>
              {video.author && <span className="pfa-video-chan">{video.author}</span>}
            </span>
          </a>
        </AsideCard>
      )}

      {/* ---------- Dernière OST likée ---------- */}
      {lastOst && (
        <AsideCard
          Icon={Music}
          title="Dernière OST likée"
          more={
            <button className="pf-aside-more clickable" onClick={() => onOpenTab("ost")}>
              Tout voir <ArrowRight size={12} />
            </button>
          }
        >
          <div className="pfa-ost">
            <button
              className={`pfa-ost-disc clickable ${playing ? "spin" : ""} ${
                canPlayOst ? "" : "mute"
              }`}
              onClick={canPlayOst ? toggleOst : undefined}
              disabled={!canPlayOst}
              title={canPlayOst ? (playing ? "Pause" : "Écouter") : "Extrait indisponible"}
            >
              <span className="pfa-ost-art">
                {ost.artwork ? (
                  <img src={ost.artwork} alt="" loading="lazy" />
                ) : (
                  <Disc3 size={22} />
                )}
              </span>
              <span className="pfa-ost-hole" />
              <span className="pfa-ost-btn">
                {playing ? (
                  <Pause size={16} />
                ) : (
                  <Play size={16} fill="currentColor" strokeWidth={0} />
                )}
              </span>
            </button>
            <div className="pfa-ost-body">
              <span className="pfa-ost-name" title={ost.name}>
                {ost.name}
              </span>
              {ost.artist && <span className="pfa-ost-artist">{ost.artist}</span>}
              <Link to={`/game/${lastOst.gameId}`} className="pfa-ost-game clickable">
                <Disc3 size={12} /> {lastOst.name}
              </Link>
            </div>
          </div>
        </AsideCard>
      )}

      {/* ---------- Dernières listes publiques ---------- */}
      {publicLists.length > 0 && (
        <AsideCard
          Icon={ListMusic}
          title="Dernières listes"
          more={
            <button className="pf-aside-more clickable" onClick={() => onOpenTab("lists")}>
              Tout voir <ArrowRight size={12} />
            </button>
          }
        >
          <div className="pfa-lists">
            {publicLists.map((l) => {
              const meta = typeMeta(l.type);
              return (
                <Link key={l.id} to={`/lists/${l.id}`} className="pfa-list-row clickable">
                  <span className="pfa-list-thumb">
                    {l.cover ? (
                      <img src={l.cover} alt="" loading="lazy" />
                    ) : l.preview?.[0] ? (
                      <img src={l.preview[0]} alt="" loading="lazy" />
                    ) : (
                      <meta.Icon size={16} />
                    )}
                  </span>
                  <span className="pfa-list-body">
                    <span className="pfa-list-title">{l.title}</span>
                    <span className="pfa-list-sub">
                      <meta.Icon size={11} /> {meta.label} · màj {timeAgo(l.updatedAt)}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </AsideCard>
      )}

      {/* ---------- Dernière review ---------- */}
      {review && (review.review?.trim() || review.rating != null) && (
        <AsideCard
          Icon={MessageSquareText}
          title="Dernière review"
          more={
            <button className="pf-aside-more clickable" onClick={() => onOpenTab("activity")}>
              Tout voir <ArrowRight size={12} />
            </button>
          }
        >
          <div className="pfa-review clickable" onClick={() => onOpenTab("activity")}>
            <span className="pfa-review-cover">
              {review.cover ? (
                <img src={review.cover} alt="" loading="lazy" />
              ) : (
                <Disc3 size={18} />
              )}
              {review.rating != null && (
                <span className="pfa-review-note">
                  <Star size={9} fill="currentColor" strokeWidth={0} /> {review.rating}
                </span>
              )}
            </span>
            <span className="pfa-review-body">
              <span className="pfa-review-game">{review.name}</span>
              {review.review?.trim() && (
                <span className="pfa-review-text">{review.review.trim()}</span>
              )}
            </span>
          </div>
        </AsideCard>
      )}
    </aside>
  );
}
