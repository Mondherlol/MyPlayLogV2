import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Globe, Heart, IdCard, Lock, PenLine, Sparkles, Trash2 } from "lucide-react";

import BoardGrid from "../components/BoardGrid";
import BoardModal from "../components/BoardModal";
import ListComments from "../components/ListComments";
import { apiFetch } from "../lib/api";
import { boardOf } from "../lib/boards";

// ======================================================================
//  La page d'une carte de joueur
// ======================================================================
// Comme la page d'une liste des 9 : une affiche, pas une liste. Le titre et
// son auteur, la grille entière — qui tient dans l'écran, sans défiler —, et
// « Fais la tienne » pour qui passe par là.

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";

export default function BoardDetail({ list, items, token, onLike, onDelete, onChanged }) {
  const navigate = useNavigate();
  const board = boardOf(list.board);
  const [editing, setEditing] = useState(false);
  const [editSlot, setEditSlot] = useState(null);
  const [making, setMaking] = useState(false);
  const [mine, setMine] = useState(null); // ma propre carte, si j'en ai une

  useEffect(() => {
    if (!token || list.mine) return undefined;
    let alive = true;
    apiFetch(`/lists?scope=mine&board=${board.key}&limit=1`, { token })
      .then((d) => alive && setMine(d.lists?.[0] || null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token, list.mine, board.key]);

  const filled = items.filter((i) => i.slot).length;

  return (
    <div className="bd-page">
      <div className="nd-top">
        <button className="nd-back clickable" onClick={() => navigate(-1)}>
          <ArrowLeft size={17} /> Retour
        </button>
        {list.mine && (
          <div className="nd-tools">
            <span className="nd-vis" title={list.visibility === "private" ? "Privée" : "Publique"}>
              {list.visibility === "private" ? <Lock size={14} /> : <Globe size={14} />}
            </span>
            <button className="nd-tool danger clickable" onClick={onDelete} title="Supprimer">
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>

      <header className="bd-hero">
        <div className="bd-hero-main">
          <span className="bd-hero-ic" aria-hidden="true">
            <IdCard size={20} />
          </span>
          <div>
            <h1 className="bd-title">
              {list.mine ? board.title : `La carte de joueur de ${list.author?.username || "?"}`}
            </h1>
            <div className="nd-by">
              <Link to={`/u/${list.author?.username}`} className="nd-author clickable">
                {list.author?.avatar ? (
                  <img src={list.author.avatar} alt="" />
                ) : (
                  <span className="nd-author-letter">{(list.author?.username || "?")[0].toUpperCase()}</span>
                )}
                <span>{list.author?.username}</span>
              </Link>
              <span className="nd-date">
                {filled}/{board.slots.length} cases · {fmtDate(list.updatedAt || list.createdAt)}
              </span>
            </div>
          </div>
        </div>

        <div className="nd-actions">
          {list.mine ? (
            <button className="btn btn-primary nd-cta clickable" onClick={() => setEditing(true)}>
              <PenLine size={17} /> Modifier ma carte
            </button>
          ) : mine ? (
            <Link to={`/lists/${mine.id}`} className="btn btn-primary nd-cta clickable">
              Voir la mienne <ArrowRight size={17} />
            </Link>
          ) : (
            token && (
              <button className="btn btn-primary nd-cta clickable" onClick={() => setMaking(true)}>
                <Sparkles size={17} /> Fais la tienne
              </button>
            )
          )}
          {token && (
            <button
              className={`nd-like clickable ${list.liked ? "on" : ""}`}
              onClick={onLike}
              aria-pressed={!!list.liked}
              title={list.liked ? "Je n'aime plus" : "J'aime"}
            >
              <Heart size={17} fill={list.liked ? "currentColor" : "none"} />
              {list.likeCount > 0 && <span>{list.likeCount}</span>}
            </button>
          )}
        </div>
      </header>

      <BoardGrid
        board={board.key}
        items={items}
        onFill={
          list.mine
            ? (slot) => {
                setEditSlot(slot);
                setEditing(true);
              }
            : undefined
        }
      />

      <ListComments listId={list.id} list={list} token={token} />

      {editing && (
        <BoardModal
          boardKey={board.key}
          list={{ ...list, items }}
          startSlot={editSlot}
          onClose={() => {
            setEditing(false);
            setEditSlot(null);
          }}
          onPublished={(updated) => {
            setEditing(false);
            setEditSlot(null);
            if (updated) onChanged(updated);
          }}
        />
      )}
      {making && (
        <BoardModal
          boardKey={board.key}
          onClose={() => setMaking(false)}
          onPublished={(created) => {
            setMaking(false);
            navigate(`/lists/${created.id}`);
          }}
        />
      )}
    </div>
  );
}
