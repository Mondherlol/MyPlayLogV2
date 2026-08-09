import { useEffect, useState } from "react";
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

  useEffect(() => {
    setChosen(null);
    setRemoved([]);
    setBusy(false);
  }, [round?.index, round?.text]);

  async function pick(i) {
    if (locked || busy || chosen != null || removed.includes(i)) return;
    setBusy(true);
    setChosen(i);
    sfx?.play?.("start");
    try {
      await onAttempt({ choice: i });
    } finally {
      setBusy(false);
    }
  }

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
              } ${bad ? "bad" : ""} ${out ? "out" : ""}`}
              onClick={() => pick(i)}
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

      {reveal && round.explain && <p className="qz-explain">{round.explain}</p>}
    </div>
  );
}
