import { useCallback, useEffect, useState } from "react";
import { CornerDownLeft, Delete, Lightbulb } from "lucide-react";

// ======================================================================
//  Épreuve « Le mot » — à la Motus
// ======================================================================
// Un titre de jeu à trouver en cinq essais. Chaque proposition se colore :
// vert = bonne lettre au bon endroit, orange = bonne lettre ailleurs, gris =
// lettre absente du titre.
//
// ------------------------------------------- qui colore, et pourquoi ça change
// C'EST TOUJOURS LE PARENT QUI TRANCHE, jamais ce composant. Il envoie la
// proposition par `onAttempt` et récupère le pavage dans `detail.marks`.
//
// En solo, le parent corrige sur place (il a la réponse). En versus, il poste
// au serveur — qui ne renvoie QUE les couleurs, jamais le mot. C'est ce qui
// permet à la même grille de fonctionner dans les deux modes sans que le
// navigateur ait jamais connu la solution ; et ce que les couleurs révèlent,
// le joueur vient de le gagner en dépensant un essai.
//
// La première lettre n'est PAS offerte : cumulée à l'indice, elle ne laissait
// plus grand-chose à trouver. La grille se mérite en entier.
//
// ------------------------------------------------------------- le clavier
// On saisit au clavier physique, mais un pavé de lettres est affiché en
// dessous : il sert de saisie tactile ET de mémoire des lettres déjà éliminées,
// ce qui est la moitié de l'intérêt du genre. Sans lui, il faut relire toute la
// grille à chaque essai pour se rappeler qu'on a déjà écarté le S.
const ROWS = ["AZERTYUIOP", "QSDFGHJKLM", "WXCVBN"];

export default function RoundMotus({ round, elapsedMs, locked, reveal, onAttempt, sfx }) {
  // Les essais déjà joués : [{ guess, marks }].
  const [past, setPast] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const len = round.length || 5;
  const maxTries = round.tries || 5;

  useEffect(() => {
    setPast([]);
    setDraft("");
    setBusy(false);
  }, [round?.index]);

  const submit = useCallback(async () => {
    if (locked || busy || draft.length !== len) {
      // Une proposition incomplète n'est pas une erreur de jeu : on la refuse
      // sans consommer d'essai, et on le fait voir plutôt que de rester muet.
      if (draft.length !== len) {
        setShake(true);
        setTimeout(() => setShake(false), 400);
      }
      return;
    }
    setBusy(true);
    try {
      const out = await onAttempt({ guess: draft, tries: past.length + 1 });
      const marks = out?.detail?.marks;
      if (Array.isArray(marks) && marks.length) {
        setPast((p) => [...p, { guess: draft, marks }]);
        sfx?.play?.(out.correct ? "correct" : "wrong");
      }
      setDraft(out?.correct ? draft : "");
    } finally {
      setBusy(false);
    }
  }, [locked, busy, draft, len, onAttempt, past.length, sfx]);

  const push = useCallback(
    (ch) => {
      if (locked || busy) return;
      setDraft((d) => (d.length >= len ? d : d + ch));
    },
    [locked, busy, len]
  );
  const back = useCallback(() => {
    if (locked || busy) return;
    setDraft((d) => d.slice(0, -1));
  }, [locked, busy]);

  // --- Clavier physique ---
  useEffect(() => {
    if (locked || reveal) return undefined;
    function onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        back();
      } else if (/^[a-zA-Z0-9]$/.test(e.key)) {
        e.preventDefault();
        push(e.key.toUpperCase());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, back, push, locked, reveal]);

  // L'état connu de chaque lettre, pour colorer le pavé. Le meilleur état
  // l'emporte : une lettre déjà trouvée au bon endroit ne doit pas redevenir
  // « mal placée » parce qu'on l'a retentée ailleurs.
  const rank = { absent: 1, present: 2, exact: 3 };
  const known = {};
  for (const p of past) {
    p.marks.forEach((m, i) => {
      const ch = p.guess[i];
      if (!known[ch] || rank[m] > rank[known[ch]]) known[ch] = m;
    });
  }

  const rowsLeft = Math.max(0, maxTries - past.length - (reveal ? 0 : 1));

  const hintAt = round.hintAtMs ?? 0;
  const hintOpen = !!reveal || (elapsedMs ?? 0) >= hintAt;
  const hintIn = Math.max(0, Math.ceil((hintAt - (elapsedMs ?? 0)) / 1000));

  return (
    <div className="qz-motus">
      {/* L'INDICE N'ARRIVE QU'À LA MI-TEMPS.
          En versus le serveur ne l'envoie pas avant (champ vide) ; en solo il
          arrive avec la manche et c'est ce test qui le retient. Les deux
          chemins aboutissent au même moment à l'écran.

          Avant l'heure, on affiche le compte à rebours plutôt que rien : savoir
          qu'un coup de pouce arrive dans vingt secondes change la façon de
          gérer ses essais. */}
      <span className={`qz-motus-hint ${hintOpen ? "open" : "waiting"}`}>
        <Lightbulb size={13} />
        {hintOpen && round.hint ? (
          <>
            {round.hint} · {len} lettres
          </>
        ) : (
          <>
            {len} lettres · indice dans {hintIn}s
          </>
        )}
      </span>

      <div className="qz-motus-grid">
        {/* Les essais joués, avec leurs couleurs. */}
        {past.map((p, r) => (
          <div key={r} className="qz-motus-row">
            {[...p.guess].map((ch, i) => (
              <span
                key={i}
                className={`qz-motus-cell ${p.marks[i]}`}
                style={{ animationDelay: `${i * 70}ms` }}
              >
                {ch}
              </span>
            ))}
          </div>
        ))}

        {/* La ligne en cours. */}
        {!reveal && past.length < maxTries && (
          <div className={`qz-motus-row current ${shake ? "shake" : ""}`}>
            {Array.from({ length: len }).map((_, i) => (
              <span key={i} className={`qz-motus-cell ${draft[i] ? "filled" : ""}`}>
                {draft[i] || ""}
              </span>
            ))}
          </div>
        )}

        {/* Les essais restants, en creux : on voit combien il en reste. */}
        {Array.from({ length: rowsLeft }).map((_, r) => (
          <div key={`e${r}`} className="qz-motus-row empty">
            {Array.from({ length: len }).map((_, i) => (
              <span key={i} className="qz-motus-cell" />
            ))}
          </div>
        ))}
      </div>

      {reveal && round.gameName && (
        <div className="qz-anagram-answer">
          {round.cover && <img src={round.cover} alt="" draggable="false" />}
          <span>
            <em>C'était</em>
            <b>{round.gameName}</b>
          </span>
        </div>
      )}

      {!reveal && (
        <>
          <div className="qz-motus-keys">
            {ROWS.map((row, r) => (
              <div key={r} className="qz-motus-keyrow">
                {r === 2 && (
                  <button
                    type="button"
                    className="qz-motus-key wide clickable"
                    onClick={submit}
                    disabled={locked || busy || draft.length !== len}
                    aria-label="Valider"
                  >
                    <CornerDownLeft size={15} />
                  </button>
                )}
                {[...row].map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    className={`qz-motus-key clickable ${known[ch] || ""}`}
                    onClick={() => push(ch)}
                    disabled={locked || busy}
                  >
                    {ch}
                  </button>
                ))}
                {r === 2 && (
                  <button
                    type="button"
                    className="qz-motus-key wide clickable"
                    onClick={back}
                    disabled={locked || busy || !draft.length}
                    aria-label="Effacer"
                  >
                    <Delete size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <span className="qz-motus-left">
            {maxTries - past.length} essai{maxTries - past.length > 1 ? "s" : ""} restant
            {maxTries - past.length > 1 ? "s" : ""}
          </span>
        </>
      )}
    </div>
  );
}
