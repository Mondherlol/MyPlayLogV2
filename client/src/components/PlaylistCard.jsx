import { Link } from "react-router-dom";
import {
  Heart,
  MessageCircle,
  Lock,
  Loader2,
  Trash2,
  Play,
  Pause,
  Music,
} from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { usePlayPlaylist } from "../lib/usePlayPlaylist";
import { timeAgo, fmtDuration } from "../lib/lists";
import CoverArt from "./CoverArt";

// Card PlayList (page Listes, onglet Playlists du profil) : une pochette
// compacte d'où dépasse un petit éventail de CD (un par artwork d'OST, max 3)
// qui s'écarte au survol. Le CD de tête tourne si la playlist est en écoute.
export default function PlaylistCard({ list, onDelete }) {
  const { launching, playPlaylist } = usePlayPlaylist(list);
  const player = usePlayer();
  // Pochette : l'image choisie par l'auteur si elle existe, sinon une pochette
  // générée (jamais un artwork de piste).
  const sleeveArt = list.cover || null;
  // Un disque par artwork distinct (max 3) — plusieurs sons, plusieurs CD.
  const discs = [...new Set(list.preview || [])].slice(0, 3);
  // La playlist est-elle celle en cours d'écoute ? (via la source du lecteur)
  const isActive = player.source?.href === `/lists/${list.id}`;
  const spinning = isActive && player.playing;

  return (
    <Link to={`/lists/${list.id}`} className="plc-card clickable">
      {list.mine && onDelete && (
        <button
          className="list-card-del clickable"
          title="Supprimer la playlist"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(list);
          }}
        >
          <Trash2 size={15} />
        </button>
      )}

      <div className="plc-visual">
        {/* L'éventail de CD (rendu de l'arrière vers l'avant) */}
        <span className="plc-cds">
          {(discs.length ? discs : [null]).map((art, i) => (
            <span
              key={i}
              className={`plc-cd ${i === 0 && spinning ? "spinning" : ""}`}
              style={{ "--i": i }}
            >
              <span className="plc-cd-face">
                {art ? (
                  <img src={art} alt="" loading="lazy" draggable="false" />
                ) : (
                  <Music size={16} />
                )}
                <span className="plc-cd-grooves" />
                <span className="plc-cd-hole" />
              </span>
            </span>
          ))}
        </span>

        <span className="plc-sleeve">
          {sleeveArt ? (
            <img src={sleeveArt} alt="" loading="lazy" draggable="false" />
          ) : (
            <CoverArt design={list.coverDesign} title={list.title} />
          )}
          <span className="plc-sleeve-spine" />
          {list.visibility === "private" && (
            <span className="list-tag-priv" title="Privée">
              <Lock size={12} />
            </span>
          )}
        </span>

        {list.itemCount > 0 && (
          <button
            className="plc-play clickable"
            title={spinning ? "Pause" : "Écouter la playlist"}
            aria-label="Écouter la playlist"
            onClick={
              isActive
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    player.toggle();
                  }
                : playPlaylist
            }
          >
            {launching ? (
              <Loader2 size={16} className="spin" />
            ) : spinning ? (
              <Pause size={16} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={16} fill="currentColor" strokeWidth={0} />
            )}
          </button>
        )}
      </div>

      <div className="plc-body">
        <h3 className="plc-title">
          {isActive && (
            <span className={`pld-eq ${player.playing ? "" : "paused"}`} aria-hidden="true">
              <i /><i /><i />
            </span>
          )}
          {list.title}
        </h3>
        <div className="plc-meta">
          <span className="list-card-author">
            {list.author ? `@${list.author.username}` : "—"}
          </span>
          <span className="dot">·</span>
          <span>{list.itemCount} piste{list.itemCount > 1 ? "s" : ""}</span>
          {list.durationSec > 0 && (
            <>
              <span className="dot">·</span>
              <span>
                {list.durationEstimated ? "≈ " : ""}
                {fmtDuration(list.durationSec)}
              </span>
            </>
          )}
        </div>
        <div className="list-card-foot">
          <span className={`list-stat ${list.liked ? "liked" : ""}`}>
            <Heart size={14} fill={list.liked ? "currentColor" : "none"} />
            {list.likeCount}
          </span>
          <span className="list-stat">
            <MessageCircle size={14} /> {list.commentCount}
          </span>
          <span className="list-stat time">màj {timeAgo(list.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}
