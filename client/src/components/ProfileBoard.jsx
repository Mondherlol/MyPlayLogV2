import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, IdCard, Sparkles } from "lucide-react";

import BoardGrid from "./BoardGrid";
import BoardModal from "./BoardModal";
import { DEFAULT_BOARD, boardOf } from "../lib/boards";

// ======================================================================
//  La carte de joueur, en tête du profil
// ======================================================================
// Un jeu par case — préféré, meilleure histoire, pas mon style mais… — c'est
// le portrait le plus rapide d'un joueur : elle ouvre donc son profil, en
// compact (deux rangées de dix). Sur SON profil, sans carte, une invitation à
// la faire à la place ; sur celui d'un autre, rien.

export default function ProfileBoard({ lists, isMe, username }) {
  const navigate = useNavigate();
  const [making, setMaking] = useState(false);
  const list = (lists || []).find((l) => l.board === DEFAULT_BOARD);
  const board = boardOf(DEFAULT_BOARD);

  if (!list) {
    if (!isMe) return null;
    return (
      <section className="profile-section pf-block pf-board-cta">
        <span className="pf-board-cta-ic" aria-hidden="true">
          <IdCard size={20} />
        </span>
        <div>
          <b>Ta carte de joueur</b>
          <span>Un jeu par case : ton préféré, la meilleure histoire, pas ton style mais…</span>
        </div>
        <button className="btn btn-primary clickable" onClick={() => setMaking(true)}>
          <Sparkles size={16} /> La remplir
        </button>
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
      </section>
    );
  }

  return (
    <section className="profile-section pf-block pf-board">
      <div className="pf-board-head">
        <h3>
          <IdCard size={16} /> {isMe ? board.title : `La carte de joueur de ${username}`}
        </h3>
        <Link to={`/lists/${list.id}`} className="pf-board-more clickable">
          Voir en grand <ChevronRight size={15} />
        </Link>
      </div>
      <BoardGrid board={board.key} items={list.boardItems || []} compact />
    </section>
  );
}
