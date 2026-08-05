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
  Headphones,
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
  // La playlist est-elle celle en cours d'écoute ? (via la source du lecteur)
  const isActive = player.source?.href === `/lists/${list.id}`;
  const spinning = isActive && player.playing;

  // Les disques affichés.
  //  · En écoute : on suit la file du lecteur — le disque de tête est la piste
  //    en cours. À chaque changement de piste, le disque de tête glisse dans la
  //    pochette, les suivants avancent d'un cran et un nouveau apparaît au fond
  //    (toujours 3 disques visibles). Chaque disque est clé par son rang dans la
  //    file → React réutilise le nœud et les positions s'animent en CSS.
  //  · Sinon : aperçu statique des pochettes distinctes (max 3).
  const playingStack = isActive && player.queue.length > 0;
  let discs;
  if (playingStack) {
    const idx = player.index;
    discs = [];
    for (let qi = idx - 1; qi <= idx + 3; qi++) {
      if (qi < 0 || qi >= player.queue.length) continue;
      const off = qi - idx;
      const slot = off <= -1 ? "tuck" : off >= 3 ? "wait" : String(off);
      discs.push({
        key: `q${qi}`,
        art: player.queue[qi]?.artwork || null,
        slot,
        front: off === 0,
      });
    }
  } else {
    const imgs = [...new Set(list.preview || [])].slice(0, 3);
    discs = (imgs.length ? imgs : [null]).map((art, i) => ({
      key: `p${i}`,
      art,
      i,
      front: i === 0,
    }));
  }

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
        <span className={`plc-cds ${playingStack ? "playing" : ""}`}>
          {discs.map((d) => (
            <span
              key={d.key}
              className={`plc-cd ${d.front && spinning ? "spinning" : ""} ${
                d.slot ? `s-${d.slot}` : ""
              }`}
              style={d.slot ? undefined : { "--i": d.i }}
            >
              <span className="plc-cd-face">
                {d.art ? (
                  <img src={d.art} alt="" loading="lazy" draggable="false" />
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
          {list.author ? (
            <span className="list-card-author">
              <span className="list-author-pp" aria-hidden="true">
                {list.author.avatar ? (
                  <img src={list.author.avatar} alt="" loading="lazy" draggable="false" />
                ) : (
                  list.author.username?.[0]?.toUpperCase() || "?"
                )}
              </span>
              {list.author.username}
            </span>
          ) : (
            <span className="list-card-author">—</span>
          )}
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
          {list.listenCount > 0 && (
            <span className="list-stat" title={`${list.listenCount} écoute${list.listenCount > 1 ? "s" : ""}`}>
              <Headphones size={14} /> {list.listenCount}
            </span>
          )}
          <span className="list-stat time">màj {timeAgo(list.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}
