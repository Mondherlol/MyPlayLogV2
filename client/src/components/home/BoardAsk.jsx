import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, IdCard, X } from "lucide-react";

import { apiFetch } from "../../lib/api";
import { apiCached } from "../../lib/query";
import { DEFAULT_BOARD, boardOf, openMyBoard } from "../../lib/boards";

// ======================================================================
//  « Remplis ta carte de joueur » — la proposition de l'accueil
// ======================================================================
// Tant que la carte de joueur est vide (pas créée, ou créée sans un seul jeu),
// l'accueil la propose dans sa colonne d'actions. Sans insister :
//
//   · une seule carte, compacte, pas de bandeau en travers de la page ;
//   · une croix, et elle ne revient plus — le choix est gardé par compte ;
//   · dès que la carte porte un jeu, la proposition disparaît d'elle-même.

const OFF_KEY = (scope) => `mpl_board_ask_off:${scope}`;

function readOff(scope) {
  try {
    return localStorage.getItem(OFF_KEY(scope)) === "1";
  } catch {
    return false;
  }
}

export default function BoardAsk({ token, scope }) {
  const navigate = useNavigate();
  const board = boardOf(DEFAULT_BOARD);
  const [off, setOff] = useState(() => readOff(scope));
  // `undefined` : on ne sait pas encore — rien ne s'affiche, pour ne pas
  // proposer une carte à quelqu'un qui l'a déjà remplie.
  const [empty, setEmpty] = useState(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token || off) return undefined;
    let alive = true;
    apiCached(`/lists?scope=mine&board=${board.key}&limit=1`, { token, scope, maxAge: 60000 })
      .then((d) => {
        if (!alive) return;
        const mine = d?.lists?.[0];
        setEmpty(!mine || !(mine.boardItems || []).some((it) => it.image));
      })
      .catch(() => alive && setEmpty(false));
    return () => {
      alive = false;
    };
  }, [token, scope, off, board.key]);

  if (off || !empty) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(OFF_KEY(scope), "1");
    } catch {
      /* stockage indisponible : elle reviendra à la prochaine visite */
    }
    setOff(true);
  };

  const open = async () => {
    if (busy) return;
    setBusy(true);
    await openMyBoard({ token, navigate, apiFetch, boardKey: board.key });
    setBusy(false);
  };

  // Les premières cases de la grille, vides, avec leur icône : on voit ce
  // qu'on va remplir avant d'avoir lu quoi que ce soit.
  const slots = board.slots.slice(0, 10);

  return (
    <section className="mh-board-ask">
      <button
        type="button"
        className="mh-board-ask-x clickable"
        onClick={dismiss}
        aria-label="Ne plus proposer"
        title="Ne plus proposer"
      >
        <X size={15} />
      </button>

      <button type="button" className="mh-board-ask-main clickable" onClick={open} disabled={busy}>
        <span className="mh-board-ask-grid" aria-hidden="true">
          {slots.map((s, i) => (
            <span key={s.key} className={i === 0 ? "on" : ""}>
              <s.Icon size={13} strokeWidth={2.2} />
            </span>
          ))}
        </span>
        <span className="mh-board-ask-txt">
          <IdCard size={16} className="mh-board-ask-ic" />
          <b>Remplis ta carte de joueur</b>
          <ArrowRight size={16} className="mh-board-ask-go" />
        </span>
      </button>
    </section>
  );
}
