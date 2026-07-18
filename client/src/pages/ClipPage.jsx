import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, Heart, MessageCircle, Clapperboard, ArrowRight } from "lucide-react";
import { apiFetch } from "../lib/api";
import { timeAgo } from "../lib/lists";
import { useAuth } from "../context/AuthContext";
import GameVideoPlayer from "../components/GameVideoPlayer";
import {
  MediaGrid,
  PostText,
  PostEmbed,
  extractEmbeds,
  SharePostButton,
} from "../components/GameMediaWall";

// Page publique /clip/:id : un post du mur média ouvert « en grand », pensée
// pour les liens partagés (Discord & co reçoivent les balises OG côté serveur,
// cf. server/src/routes/share.js — les humains arrivent ici). Consultable sans
// compte (coquille publique), like réservé aux connectés.
export default function ClipPage() {
  const { id } = useParams();
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    apiFetch(`/game-media/post/${id}`, { token })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id, token]);

  const post = data?.post;
  const game = data?.game;

  useEffect(() => {
    if (!post) return;
    const who = post.author?.username ? `@${post.author.username}` : "un joueur";
    document.title = `Clip de ${who}${game?.name ? ` sur ${game.name}` : ""} · MyPlayLog`;
    return () => {
      document.title = "MyPlayLog";
    };
  }, [post, game]);

  const { embeds, hide } = useMemo(
    () => extractEmbeds(post?.text),
    [post?.text]
  );

  // Le clip principal en grand, le reste des médias en grille dessous.
  const media = post?.media || [];
  const mainIndex = media.findIndex((m) => m.kind === "video");
  const main = mainIndex >= 0 ? media[mainIndex] : null;
  const others = media.filter((_, i) => i !== mainIndex);

  async function toggleLike() {
    if (!user) return navigate("/login");
    const was = { liked: post.liked, likeCount: post.likeCount };
    setData((d) => ({
      ...d,
      post: {
        ...d.post,
        liked: !was.liked,
        likeCount: was.likeCount + (was.liked ? -1 : 1),
      },
    }));
    try {
      const r = await apiFetch(`/game-media/${post.id}/like`, { method: "POST", token });
      setData((d) => ({ ...d, post: { ...d.post, liked: r.liked, likeCount: r.likeCount } }));
    } catch {
      setData((d) => ({ ...d, post: { ...d.post, ...was } }));
    }
  }

  if (error)
    return (
      <div className="clip-page">
        <div className="clip-missing">
          <Clapperboard size={34} />
          <p className="font-fun">Ce clip n'existe plus (ou le lien est cassé).</p>
          <Link to="/" className="clip-missing-link clickable">
            Découvrir MyPlayLog <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    );

  if (!post)
    return (
      <div className="clip-page">
        <div className="clip-loading">
          <Loader2 size={26} className="spin" />
        </div>
      </div>
    );

  const gameLink = game?.id ? `/game/${game.id}?tab=feed` : null;

  return (
    <div className="clip-page">
      <article className="clip-card">
        <header className="clip-head">
          <div className="clip-av">
            {post.author?.username ? (
              <Link to={`/u/${post.author.username}`}>
                {post.author.avatar ? (
                  <img src={post.author.avatar} alt="" />
                ) : (
                  (post.author.username[0] || "?").toUpperCase()
                )}
              </Link>
            ) : (
              "?"
            )}
          </div>
          <div className="clip-who">
            {post.author?.username ? (
              <Link to={`/u/${post.author.username}`} className="clip-name">
                {post.author.username}
              </Link>
            ) : (
              <span className="clip-name">—</span>
            )}
            <span className="clip-sub">
              a partagé un clip · {timeAgo(post.createdAt)}
            </span>
          </div>
          {gameLink && (
            <Link to={gameLink} className="clip-game clickable" title={game.name}>
              {game.cover && <img src={game.cover} alt="" loading="lazy" />}
              <span>{game.name}</span>
            </Link>
          )}
        </header>

        {main && (
          <div className="clip-main">
            <GameVideoPlayer src={main.url} poster={main.thumbnail || undefined} autoPlay />
          </div>
        )}

        <div className="clip-body">
          <PostText text={post.text} hide={hide} />
          {others.length > 0 && (
            <MediaGrid
              media={others}
              forceReveal={false}
              onOpen={(i) => window.open(others[i]?.url, "_blank", "noopener")}
            />
          )}
          {embeds.map((e, i) => (
            <PostEmbed key={i} embed={e} />
          ))}
        </div>

        <footer className="clip-actions">
          <button
            className={`gm-act clickable ${post.liked ? "liked" : ""}`}
            onClick={toggleLike}
            title="J'aime"
          >
            <Heart size={17} fill={post.liked ? "currentColor" : "none"} />
            {post.likeCount > 0 && <span>{post.likeCount}</span>}
          </button>
          {gameLink && (
            <Link to={gameLink} className="gm-act clickable" title="Voir la discussion">
              <MessageCircle size={17} />
              {post.commentCount > 0 && <span>{post.commentCount}</span>}
            </Link>
          )}
          <SharePostButton post={post} />
          {gameLink && (
            <Link to={gameLink} className="clip-cta clickable">
              Rejoindre la discussion <ArrowRight size={14} />
            </Link>
          )}
        </footer>
      </article>
    </div>
  );
}
