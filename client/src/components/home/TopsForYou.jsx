import { useEffect, useState } from "react";

import Section from "./Rail";
import ListTile, { ListTileSkeleton } from "../lists/ListTile";
import { apiCached, peekApi } from "../../lib/query";

// ======================================================================
//  « Tops pour toi » — les tops officiels qui parlent au joueur
// ======================================================================
// Le serveur croise sa bibliothèque avec les tops (cf. GET /lists/tops/for-me) :
// en tête, les sagas et les thèmes dont il a déjà joué une bonne part SANS
// les avoir finis — c'est là qu'un top a quelque chose à lui apprendre.
//
// Sous chaque affiche, où il en est : « 12 joués sur 51 ».

const PATH = "/lists/tops/for-me";

export default function TopsForYou({ token, scope }) {
  // `null` : pas encore de réponse (squelettes) ; `[]` : rien à proposer.
  const [lists, setLists] = useState(() => peekApi(PATH, scope)?.lists ?? null);

  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    apiCached(PATH, { token, scope, maxAge: 10 * 60 * 1000 })
      .then((d) => alive && setLists(d?.lists || []))
      .catch(() => alive && setLists((v) => v ?? []));
    return () => {
      alive = false;
    };
  }, [token, scope]);

  if (lists && !lists.length) return null;

  return (
    <Section title="Des tops pour toi" moreTo="/lists?sc=tops" moreLabel="Tous les tops" className="s-tops">
      {lists === null
        ? Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="mh-topcard">
              <ListTileSkeleton />
            </div>
          ))
        : lists.map((l) => (
            <div key={l.id} className="mh-topcard">
              <ListTile list={l} />
              {l.played > 0 && (
                <span className="mh-topcard-played">
                  <b>{l.played}</b> joué{l.played > 1 ? "s" : ""} sur {l.itemCount}
                </span>
              )}
            </div>
          ))}
    </Section>
  );
}
