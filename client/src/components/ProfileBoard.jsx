import { useNavigate } from "react-router-dom";
import { IdCard, Sparkles } from "lucide-react";

import PlayerCard from "./board/PlayerCard";
import { apiFetch } from "../lib/api";
import { DEFAULT_BOARD, openMyBoard } from "../lib/boards";

// ======================================================================
//  La carte de joueur, en tête du profil
// ======================================================================
// Un jeu par case — préféré, meilleure histoire, pas mon style mais… — c'est
// le portrait le plus rapide d'un joueur : elle ouvre donc son profil, en
// compact (deux rangées de dix). Sur SON profil, sans carte, une invitation à
// la faire à la place ; sur celui d'un autre, rien — pas plus qu'une carte
// encore vide.

export default function ProfileBoard({ lists, isMe, token }) {
  const navigate = useNavigate();
  const list = (lists || []).find((l) => l.board === DEFAULT_BOARD);
  const items = list?.boardItems || [];

  if (!list || (!items.length && !isMe)) {
    if (!isMe) return null;
    return (
      <section className="profile-section pf-block pf-board-cta">
        <span className="pf-board-cta-ic" aria-hidden="true">
          <IdCard size={20} />
        </span>
        <div>
          <b>Ta carte de joueur</b>
        </div>
        <button
          className="btn btn-primary clickable"
          onClick={() => openMyBoard({ token, navigate, apiFetch })}
        >
          <Sparkles size={16} /> La remplir
        </button>
      </section>
    );
  }

  return (
    <section className="profile-section pf-block pf-board">
      <PlayerCard list={list} items={items} author={list.author} compact link={`/lists/${list.id}`} />
    </section>
  );
}
