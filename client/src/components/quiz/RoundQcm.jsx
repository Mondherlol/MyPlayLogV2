import { useCallback, useEffect, useState } from "react";
import { Check, X, Wand2 } from "lucide-react";

// ======================================================================
//  Épreuve « Question » — le QCM
// ======================================================================
// Le cœur du jeu, et le seul écran qui doit ressembler à un plateau de quiz
// télé : l'énoncé en grand sur un bandeau, quatre pupitres de réponse A/B/C/D
// en dessous, et rien d'autre.
//
// UN SEUL ESSAI, toujours. Avec quatre propositions, un deuxième essai revient
// à offrir la réponse. La conséquence d'interface est importante : on ne
// demande PAS de confirmation. Cliquer, c'est répondre — et le bouton se
// verrouille dans la seconde. C'est ce qui donne à l'épreuve son côté buzzer.
const LETTERS = ["A", "B", "C", "D", "E", "F"];

export default function RoundQcm({ round, locked, reveal, onAttempt, jokers, onJoker, sfx }) {
  const [chosen, setChosen] = useState(null);
  // Propositions éteintes par le joker (50/50). Le serveur décide lesquelles :
  // lui seul connaît la bonne réponse (cf. POST /:code/joker).
  const [removed, setRemoved] = useState([]);
  const [busy, setBusy] = useState(false);
  // La proposition survolée au clavier. `-1` = personne, tant qu'on n'a pas
  // touché aux flèches : on ne veut pas préselectionner une réponse au hasard,
  // ça inciterait à valider sans lire.
  const [cursor, setCursor] = useState(-1);

  useEffect(() => {
    setChosen(null);
    setRemoved([]);
    setBusy(false);
    setCursor(-1);
  }, [round?.index, round?.text]);

  const pick = useCallback(
    async (i) => {
      if (locked || busy || chosen != null || removed.includes(i)) return;
      setBusy(true);
      setChosen(i);
      sfx?.play?.("start");
      try {
        await onAttempt({ choice: i });
      } finally {
        setBusy(false);
      }
    },
    [locked, busy, chosen, removed, onAttempt, sfx]
  );

  // ---------------------------------------------------------------- clavier
  // Les quatre flèches déplacent la sélection, Entrée valide. Les propositions
  // sont sur DEUX colonnes : ← → sautent d'une colonne, ↑ ↓ d'une ligne, ce qui
  // suit ce qu'on voit à l'écran. On boucle aux extrémités plutôt que de buter
  // — sur quatre entrées, buter n'apprend rien à personne.
  //
  // Les propositions éteintes par le joker sont sautées : la sélection ne doit
  // pas pouvoir se poser sur une case morte.
  useEffect(() => {
    if (locked || reveal || chosen != null) return undefined;
    const n = (round.choices || []).length;
    if (!n) return undefined;

    const step = (from, delta) => {
      let i = from;
      for (let k = 0; k < n; k += 1) {
        i = (i + delta + n) % n;
        if (!removed.includes(i)) return i;
      }
      return from;
    };

    function onKey(e) {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const cur = cursor < 0 ? -1 : cursor;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        setCursor(cur < 0 ? 0 : step(cur, e.key === "ArrowDown" ? 2 : 1));
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        setCursor(cur < 0 ? 0 : step(cur, e.key === "ArrowUp" ? -2 : -1));
      } else if (e.key === "Enter" && cur >= 0) {
        e.preventDefault();
        pick(cur);
      } else if (/^[1-9]$/.test(e.key)) {
        // Le numéro de la proposition : le geste le plus rapide de tous, et
        // celui qu'on fait spontanément devant un QCM numéroté.
        const i = Number(e.key) - 1;
        if (i < n && !removed.includes(i)) {
          e.preventDefault();
          pick(i);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor, removed, round.choices, locked, reveal, chosen, pick]);

  async function useJoker() {
    if (!onJoker || locked || chosen != null || !jokers) return;
    const out = await onJoker();
    if (Array.isArray(out?.removed)) {
      setRemoved(out.removed);
      sfx?.play?.("hint");
    }
  }

  const answerIndex = reveal ? round.answerIndex : null;

  return (
    <div className="qz-qcm">
      {round.theme && <span className="qz-theme">{round.theme}</span>}

      {/* L'énoncé. Sur un plateau, la question est LE mobilier principal :
          elle occupe la largeur et ne partage l'espace avec rien. */}
      <div className="qz-question">
        <p>{round.text}</p>
      </div>

      <div className={`qz-choices n${round.choices?.length || 4}`}>
        {(round.choices || []).map((c, i) => {
          const out = removed.includes(i);
          const good = reveal && i === answerIndex;
          const bad = reveal && chosen === i && i !== answerIndex;
          return (
            <button
              key={i}
              type="button"
              className={`qz-choice clickable ${chosen === i ? "picked" : ""} ${
                good ? "good" : ""
              } ${bad ? "bad" : ""} ${out ? "out" : ""} ${
                cursor === i && chosen == null && !reveal ? "cursor" : ""
              }`}
              onClick={() => pick(i)}
              onMouseEnter={() => setCursor(i)}
              disabled={locked || out || chosen != null}
            >
              <span className="qz-choice-letter">{LETTERS[i] || i + 1}</span>
              <span className="qz-choice-txt">{c}</span>
              {good && <Check size={18} className="qz-choice-mark" />}
              {bad && <X size={18} className="qz-choice-mark" />}
            </button>
          );
        })}
      </div>

      {/* Le joker n'existe qu'en versus (le parent ne passe `onJoker` que là) :
          en solo, il n'y a personne à qui prendre de l'avance. */}
      {onJoker && (
        <button
          type="button"
          className="qz-joker clickable"
          onClick={useJoker}
          disabled={!jokers || locked || chosen != null || removed.length > 0}
          title="Retire deux mauvaises réponses"
        >
          <Wand2 size={15} /> 50/50
          <em>{jokers}</em>
        </button>
      )}

      {/* LA RÉPONSE, en clair et illustrée. Le surlignage vert sur la bonne case
          suffisait à dire « c'était celle-là », mais pas à retenir quoi que ce
          soit — et quand la question porte sur un jeu, sa jaquette vaut mieux
          qu'une ligne de texte pour l'ancrer. */}
      {reveal && (
        <div className="qz-qcm-answer">
          {round.cover && (
            <img src={round.cover} alt="" loading="lazy" draggable="false" />
          )}
          <span>
            <em>La réponse</em>
            <b>{round.choices?.[round.answerIndex]}</b>
            {round.explain && <i>{round.explain}</i>}
          </span>
        </div>
      )}
    </div>
  );
}
