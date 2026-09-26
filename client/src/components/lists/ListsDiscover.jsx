import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";

import Section from "../home/Rail";
import NineRail from "../home/NineRail";
import TierIdea from "./TierIdea";
import { apiFetch } from "../../lib/api";
import { apiCached, peekApi } from "../../lib/query";
import { DEFAULT_BOARD, boardOf } from "../../lib/boards";

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

// Une carte de joueur sans une seule image n'a rien à montrer dans un rayon.
const hasImages = (l) => (l.boardItems || []).some((it) => it.image);

/**
 * Charge un rayon de listes ; `null` tant que ça charge. Le cache s'affiche
 * tout de suite, mais on redemande toujours : une liste modifiée (image
 * retirée, titre changé) ne doit pas revenir dans son ancien état.
 */
function useRail(path, token) {
  const [lists, setLists] = useState(() => peekApi(path)?.lists ?? null);
  useEffect(() => {
    let alive = true;
    apiCached(path, { token, force: true })
      .then((d) => alive && setLists(d?.lists || []))
      .catch(() => alive && setLists([]));
    return () => {
      alive = false;
    };
  }, [path, token]);
  return lists;
}

/** Un rayon de listes ; rien à l'écran s'il est vide. */
function ListRail({ path, token, title, moreTo, render, lead = null, skipId = null, keep = null }) {
  const lists = (useRail(path, token) || []).filter(
    (l) => l.id !== skipId && (!keep || keep(l))
  );
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

/**
 * Le rayon des tier lists. Vide — ou tant que le joueur n'en a fait aucune —,
 * il propose d'en faire à partir de ses sagas : « Tier list des jeux Zelda ».
 */
function TierRail({ token, render }) {
  const path = "/lists?type=tier&sort=likes&limit=14";
  const lists = useRail(path, token) || [];
  const [ideas, setIdeas] = useState(null);
  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    apiFetch("/lists/suggest/tiers", { token })
      .then((d) => alive && setIdeas(d))
      .catch(() => alive && setIdeas(null));
    return () => {
      alive = false;
    };
  }, [token]);

  const shown = ideas && (!lists.length || !ideas.hasOwnTier) ? ideas.suggestions : [];
  if (!lists.length && !shown.length) return null;
  return (
    <Section title="Tier lists" moreTo={lists.length ? "/lists?type=tier&sort=likes" : null} className="lx-sec">
      {lists.map((l) => (
        <div key={l.id} className="lx-rail-item">
          {render(l)}
        </div>
      ))}
      {shown.map((idea) => (
        <div key={idea.saga} className="lx-rail-item">
          <TierIdea idea={idea} token={token} />
        </div>
      ))}
    </Section>
  );
}

export default function ListsDiscover({ token, renderCard }) {
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

  // Ma carte ouvre le rayon des cartes de joueur — seulement si elle montre
  // déjà quelque chose : les cartes vides n'y ont pas leur place.
  const lead = mine && hasImages(mine) ? <BoardCard l={mine} mine /> : null;

  return (
    <div className="lx">
      <ListRail
        path="/lists?scope=tops&limit=14"
        token={token}
        title="Tops"
        moreTo="/lists?sc=tops"
        render={renderCard}
      />
      <TierRail token={token} render={renderCard} />
      <ListRail
        path={`/lists?board=${board.key}&sort=likes&limit=16`}
        token={token}
        title="Cartes de joueur"
        lead={lead}
        skipId={mine?.id}
        keep={hasImages}
        render={(l) => <BoardCard l={l} />}
      />
      <ListRail
        path="/lists?scope=events&limit=14"
        token={token}
        title="Conférences"
        moreTo="/lists?sc=events"
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
