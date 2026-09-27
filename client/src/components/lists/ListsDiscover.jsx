import { useEffect, useState } from "react";

import Section from "../home/Rail";
import NineRail from "../home/NineRail";
import TierIdea from "./TierIdea";
import { ListTileSkeleton } from "./ListTile";
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

/** Un rayon en attente : son titre et quatre cartes squelettes. */
function SkeletonRail({ title }) {
  return (
    <Section title={title} className="lx-sec">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="lx-rail-item">
          <ListTileSkeleton />
        </div>
      ))}
    </Section>
  );
}

/** Un rayon de listes ; rien à l'écran s'il est vide. */
function ListRail({ path, token, title, moreTo, render, lead = null, skipId = null, keep = null, order = null }) {
  const raw = useRail(path, token);
  // Pas encore de réponse : le rayon s'affiche déjà, avec des cartes en
  // attente — au lieu d'apparaître d'un coup en poussant la page.
  if (raw === null) return <SkeletonRail title={title} />;
  const lists = raw.filter((l) => l.id !== skipId && (!keep || keep(l)));
  if (order) lists.sort(order);
  if (!lead && !lists.length) return null;
  return (
    <Section title={title} moreTo={moreTo} className="lx-sec">
      {lead && <div className="lx-rail-item">{lead}</div>}
      {lists.map((l) => (
        <div key={l.id} className="lx-rail-item">
          {render(l)}
        </div>
      ))}
    </Section>
  );
}

/**
 * Le rayon des tier lists. Il s'ouvre sur celles à faire, tirées des sagas du
 * joueur (« Tier list des jeux Zelda »), puis les plus aimées des autres.
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

  // ⚠️ TOUJOURS, ET EN TÊTE. Les idées disparaissaient dès qu'on avait fait
  // UNE tier list, et passaient sinon derrière quatorze listes, hors de vue.
  // Le serveur ne repropose déjà pas une saga qu'on a classée.
  const shown = ideas?.suggestions || [];
  if (!lists.length && !shown.length) return null;
  return (
    <Section title="Tier lists" moreTo={lists.length ? "/lists?type=tier&sort=likes" : null} className="lx-sec">
      {shown.map((idea) => (
        <div key={idea.saga} className="lx-rail-item">
          <TierIdea idea={idea} token={token} />
        </div>
      ))}
      {lists.map((l) => (
        <div key={l.id} className="lx-rail-item">
          {render(l)}
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
  const lead = mine && hasImages(mine) ? renderCard(mine) : null;

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
        render={renderCard}
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
        // La dernière cérémonie en tête (le serveur les rend déjà ainsi).
        order={(a, b) => (b.event?.startTime || 0) - (a.event?.startTime || 0)}
        render={renderCard}
      />
      {token && <NineRail token={token} kicker="" title="Neuf jeux, un thème" />}
    </div>
  );
}
