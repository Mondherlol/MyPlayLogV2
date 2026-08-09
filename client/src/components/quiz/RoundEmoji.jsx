import { useEffect, useMemo, useState } from "react";
import { Heart } from "lucide-react";
import GameSearch from "./GameSearch";
import { maskCells, hiddenCount } from "../../lib/quizGame";

// ======================================================================
//  Épreuve « Emojis » — devine le jeu, lettre après lettre
// ======================================================================
// Quatre emojis, un titre masqué qui se dévoile peu à peu, et un champ de
// recherche. Le premier qui trouve rafle la manche en versus.
//
// LE MASQUE EST LA MOITIÉ DU JEU. Sans lui, une suite d'emojis qu'on ne « voit »
// pas laisse quarante secondes de blocage complet — et une manche bloquée
// n'est pas difficile, elle est morte. Les cases vides disent déjà beaucoup
// (la longueur, le nombre de mots, la ponctuation), et les lettres qui
// tombent transforment l'attente en compte à rebours.
//
// Le calendrier des révélations vient du serveur (`reveals`). En versus il est
// déjà filtré à l'instant présent, en solo il arrive complet et c'est
// `maskCells` qui applique le temps : un seul composant pour les deux modes.
export default function RoundEmoji({
  round,
  elapsedMs,
  locked,
  reveal,
  lives,
  candidates,
  onAttempt,
  sfx,
}) {
  const [tries, setTries] = useState(0);
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTries(0);
    setFlash(null);
  }, [round?.index]);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  // À la révélation, le vrai titre remplace le masque : c'est le moment où
  // l'on comprend enfin les emojis, il doit être lisible d'un coup d'œil.
  const cells = useMemo(
    () =>
      reveal && round.gameName
        ? [...round.gameName].map((c) => ({ kind: /\s/.test(c) ? "sep" : "shown", char: c }))
        : maskCells(round.pattern, round.reveals, elapsedMs),
    [round, elapsedMs, reveal]
  );
  const left = hiddenCount(cells);

  async function submit(cand) {
    if (locked || busy) return;
    setBusy(true);
    try {
      const out = await onAttempt({ ...cand, misses: tries });
      if (!out?.correct) {
        setTries((t) => t + 1);
        setFlash(cand.name);
        sfx?.play?.("wrong");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="qz-emoji">
      {/* Les emojis, en très grand. Ils arrivent l'un après l'autre au montage
          (animation CSS échelonnée) : c'est un petit théâtre, et ça laisse le
          temps de lire chaque symbole au lieu d'encaisser un bloc. */}
      <div className="qz-emoji-row" aria-label="Indice en emojis">
        {(round.emojis || []).map((e, i) => (
          <span key={i} className="qz-emoji-one" style={{ animationDelay: `${i * 140}ms` }}>
            {e}
          </span>
        ))}
      </div>

      <div className={`qz-mask ${reveal ? "revealed" : ""}`}>
        {cells.map((c, i) =>
          c.kind === "sep" ? (
            <i key={i} className="qz-mask-sep" aria-hidden="true">
              {c.char === " " ? "" : c.char}
            </i>
          ) : (
            <span key={i} className={`qz-mask-cell ${c.kind}`}>
              {c.char}
            </span>
          )
        )}
      </div>

      {!reveal && (
        <span className="qz-mask-hint">
          {left > 0 ? `${left} lettre${left > 1 ? "s" : ""} à trouver` : "Tout est là !"}
        </span>
      )}

      {!reveal && (
        <>
          <div className="qz-lives-row">
            <div className="qz-lives" aria-label={`${lives} essais restants`}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Heart
                  key={i}
                  size={17}
                  className={i < lives ? "on" : "off"}
                  fill={i < lives ? "currentColor" : "none"}
                />
              ))}
            </div>
            {flash && (
              <span className="qz-wrong" key={flash}>
                Raté — <s>{flash}</s>
              </span>
            )}
          </div>

          <GameSearch
            candidates={candidates}
            onSubmit={submit}
            disabled={locked || busy}
            resetKey={`${round.index}-${tries}`}
            placeholder="Quel jeu se cache là-dessous ?"
          />
        </>
      )}
    </div>
  );
}
