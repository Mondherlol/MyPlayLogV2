import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Heart, Plus } from "lucide-react";

import Section from "../home/Rail";
import NineRail from "../home/NineRail";
import { apiFetch } from "../../lib/api";
import { apiCached } from "../../lib/query";
import { DEFAULT_BOARD, boardOf, openMyBoard } from "../../lib/boards";

// ======================================================================
//  La page Listes, onglet « Découvrir » : des rayons d'images
// ======================================================================
// Pas d'étiquettes au-dessus des titres, pas de paragraphe d'explication, pas
// de tuiles « Créer » (le bouton de l'en-tête ouvre déjà le choix du type) :
// que des rangées de cartes, de la plus visuelle à la plus textuelle.
//
// La grille complète, avec sa recherche et ses filtres, suit en dessous (cf.
// pages/Lists).

/** Une carte de joueur en miniature : sa grille 5 × 4 et son auteur. */
function BoardCard({ l, mine }) {
  const board = boardOf(l.board);
  const by = Object.fromEntries((l.boardItems || []).map((it) => [it.slot, it]));
  return (
    <Link to={`/lists/${l.id}`} className={`lx-board clickable ${mine ? "is-mine" : ""}`}>
      <span className="lx-board-grid">
        {board.slots.map((s) =>
          by[s.key]?.image ? <img key={s.key} src={by[s.key].image} alt="" loading="lazy" /> : <span key={s.key} />
        )}
      </span>
      <span className="lx-board-by">
        {l.author?.avatar ? (
          <img src={l.author.avatar} alt="" />
        ) : (
          <span className="lx-board-letter">{(l.author?.username || "?")[0].toUpperCase()}</span>
        )}
        <span className="lx-board-name">{mine ? "Ma carte" : l.author?.username}</span>
        {l.likeCount > 0 && (
          <span className="lx-board-likes">
            <Heart size={11} /> {l.likeCount}
          </span>
        )}
      </span>
    </Link>
  );
}

/** Le premier emplacement du rayon quand on n'a pas encore sa carte. */
function FillMyBoard({ board, onFill }) {
  return (
    <button type="button" className="lx-board lx-board-new clickable" onClick={onFill}>
      <span className="lx-board-grid">
        {board.slots.map((s) => (
          <span key={s.key} />
        ))}
      </span>
      <span className="lx-board-by">
        <span className="lx-board-plus">
          <Plus size={13} />
        </span>
        <span className="lx-board-name">Remplir ma carte</span>
      </span>
    </button>
  );
}

/** Charge un rayon de listes ; `null` tant que ça charge. */
function useRail(path, token) {
  const [lists, setLists] = useState(null);
  useEffect(() => {
    let alive = true;
    apiCached(path, { token, maxAge: 5 * 60000 })
      .then((d) => alive && setLists(d?.lists || []))
      .catch(() => alive && setLists([]));
    return () => {
      alive = false;
    };
  }, [path, token]);
  return lists;
}

/** Un rayon de listes ; rien à l'écran s'il est vide. */
function ListRail({ path, token, title, moreTo, render, lead = null, skipId = null }) {
  const lists = (useRail(path, token) || []).filter((l) => l.id !== skipId);
  if (!lead && !lists.length) return null;
  return (
    <Section title={title} moreTo={moreTo} className="lx-sec">
      {lead && <div className="lx-rail-item is-board">{lead}</div>}
      {lists.map((l) => (
        <div key={l.id} className={`lx-rail-item ${l.board ? "is-board" : ""}`}>
          {render(l)}
        </div>
      ))}
    </Section>
  );
}

export default function ListsDiscover({ token, renderCard }) {
  const navigate = useNavigate();
  const board = boardOf(DEFAULT_BOARD);
  const [mine, setMine] = useState(undefined); // ma carte : undefined = en cours

  useEffect(() => {
    if (!token) {
      setMine(null);
      return undefined;
    }
    let alive = true;
    apiCached(`/lists?scope=mine&board=${board.key}&limit=1`, { token, maxAge: 60000 })
      .then((d) => alive && setMine(d?.lists?.[0] || null))
      .catch(() => alive && setMine(null));
    return () => {
      alive = false;
    };
  }, [token, board.key]);

  // Ma carte ouvre le rayon des cartes de joueur : remplie, elle s'y montre
  // comme les autres ; vide, c'est l'emplacement pour la commencer.
  const lead = !token || mine === undefined ? null : mine ? (
    <BoardCard l={mine} mine />
  ) : (
    <FillMyBoard board={board} onFill={() => openMyBoard({ token, navigate, apiFetch, boardKey: board.key })} />
  );

  return (
    <div className="lx">
      <ListRail
        path="/lists?scope=events&limit=14"
        token={token}
        title="Conférences"
        moreTo="/lists?sc=events"
        render={renderCard}
      />
      <ListRail
        path={`/lists?board=${board.key}&sort=likes&limit=16`}
        token={token}
        title="Cartes de joueur"
        lead={lead}
        skipId={mine?.id}
        render={(l) => <BoardCard l={l} />}
      />
      <ListRail
        path="/lists?type=tier&sort=likes&limit=14"
        token={token}
        title="Tier lists"
        moreTo="/lists?type=tier&sort=likes"
        render={renderCard}
      />
      <ListRail
        path="/lists?scope=tops&limit=14"
        token={token}
        title="Tops"
        moreTo="/lists?sc=tops"
        render={renderCard}
      />
      <ListRail
        path="/lists?scope=awards&limit=14"
        token={token}
        title="Palmarès"
        render={renderCard}
      />
      {token && <NineRail token={token} kicker="" title="Neuf jeux, un thème" />}
    </div>
  );
}
