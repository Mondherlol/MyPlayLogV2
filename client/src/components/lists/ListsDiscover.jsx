import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Heart, IdCard, Sparkles } from "lucide-react";

import Section from "../home/Rail";
import NineRail from "../home/NineRail";
import BoardModal from "../BoardModal";
import { apiCached } from "../../lib/query";
import { LIST_TYPES } from "../../lib/lists";
import { DEFAULT_BOARD, boardOf } from "../../lib/boards";

// ======================================================================
//  La page Listes, onglet « Découvrir » : une vitrine, pas un tas
// ======================================================================
// La page n'était qu'une grille de cartes toutes pareilles, le Top 100 Switch
// entre deux listes de trois jeux. Elle s'ouvre maintenant comme l'accueil,
// en rayons, du plus personnel au plus général :
//
//   1. TA carte de joueur (ou l'invitation à la faire) et les types de listes
//      à créer, en tuiles ;
//   2. le principe des 9, ses thèmes ;
//   3. les cartes de joueur des autres, les tier lists qui plaisent ;
//   4. ce que le site publie : palmarès, conférences, tops.
//
// La grille complète, avec sa recherche et ses filtres, suit en dessous (cf.
// pages/Lists) : on ne perd rien, on commence juste par le meilleur.

const CREATE_TYPES = ["ranked", "tier", "classic", "playlist"];

/** Une carte de joueur d'un autre, en miniature : sa grille 5 × 4 et son auteur. */
function BoardCard({ l }) {
  const board = boardOf(l.board);
  const by = Object.fromEntries((l.boardItems || []).map((it) => [it.slot, it]));
  return (
    <Link to={`/lists/${l.id}`} className="lx-board clickable">
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
        <span className="lx-board-name">{l.author?.username}</span>
        {l.likeCount > 0 && (
          <span className="lx-board-likes">
            <Heart size={11} /> {l.likeCount}
          </span>
        )}
      </span>
    </Link>
  );
}

/** Un rayon de listes chargé à la demande ; rien à l'écran s'il est vide. */
function ListRail({ path, token, kicker, title, moreTo, moreLabel, render }) {
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
  if (!lists?.length) return null;
  return (
    <Section kicker={kicker} title={title} moreTo={moreTo} moreLabel={moreLabel} className="lx-sec">
      {lists.map((l) => (
        <div key={l.id} className="lx-rail-item">
          {render(l)}
        </div>
      ))}
    </Section>
  );
}

export default function ListsDiscover({ token, onCreate, renderCard }) {
  const navigate = useNavigate();
  const board = boardOf(DEFAULT_BOARD);
  const [mine, setMine] = useState(undefined); // ma carte : undefined = en cours
  const [making, setMaking] = useState(false);

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

  const by = Object.fromEntries((mine?.boardItems || []).map((it) => [it.slot, it]));

  return (
    <div className="lx">
      {/* --- 1. Ta carte, et de quoi créer ------------------------------ */}
      <div className="lx-top">
        <div className="lx-mycard">
          <div className="lx-mycard-text">
            <span className="mh-kicker">Ta liste spéciale</span>
            <h2>
              <IdCard size={22} /> {board.title}
            </h2>
            <p>
              Un jeu par case : ton préféré, la meilleure histoire, celui qui mérite un remake, ton
              méchant favori… Elle s'affiche en tête de ton profil.
            </p>
            {mine ? (
              <Link to={`/lists/${mine.id}`} className="btn btn-primary clickable">
                Voir ma carte <ArrowRight size={16} />
              </Link>
            ) : (
              token &&
              mine === null && (
                <button className="btn btn-primary clickable" onClick={() => setMaking(true)}>
                  <Sparkles size={16} /> Remplir ma carte
                </button>
              )
            )}
          </div>
          <span className={`lx-mycard-grid ${mine ? "" : "is-empty"}`} aria-hidden="true">
            {board.slots.map((s) =>
              by[s.key]?.image ? (
                <img key={s.key} src={by[s.key].image} alt="" loading="lazy" />
              ) : (
                <span key={s.key}>
                  <s.Icon size={14} />
                </span>
              )
            )}
          </span>
        </div>

        <div className="lx-create">
          <span className="mh-kicker">Créer</span>
          <div className="lx-create-grid">
            {CREATE_TYPES.map((t) => {
              const meta = LIST_TYPES[t];
              return (
                <button key={t} type="button" className="lx-type clickable" onClick={() => onCreate(t)}>
                  <meta.Icon size={20} />
                  <b>{meta.long}</b>
                  <span>{meta.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* --- 2. Le principe des 9 --------------------------------------- */}
      {token && <NineRail token={token} kicker="Le principe des 9" title="Neuf jeux, un thème" />}

      {/* --- 3. Ce que font les autres ---------------------------------- */}
      <ListRail
        path={`/lists?board=${board.key}&sort=likes&limit=16`}
        token={token}
        kicker="Leurs cartes"
        title="Les cartes de joueur"
        render={(l) => <BoardCard l={l} />}
      />
      <ListRail
        path="/lists?type=tier&sort=likes&limit=14"
        token={token}
        kicker="Ça classe"
        title="Les tier lists du moment"
        moreTo="/lists?type=tier&sort=likes"
        render={renderCard}
      />

      {/* --- 4. Ce que publie le site ----------------------------------- */}
      <ListRail
        path="/lists?scope=awards&limit=14"
        token={token}
        kicker="Les palmarès"
        title="The Game Awards et les autres"
        render={renderCard}
      />
      <ListRail
        path="/lists?scope=events&limit=14"
        token={token}
        kicker="Ce qui a été annoncé"
        title="Les dernières conférences"
        moreTo="/lists?sc=events"
        render={renderCard}
      />
      <ListRail
        path="/lists?scope=tops&limit=14"
        token={token}
        kicker="Classements officiels"
        title="Les tops"
        moreTo="/lists?sc=tops"
        render={renderCard}
      />

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
