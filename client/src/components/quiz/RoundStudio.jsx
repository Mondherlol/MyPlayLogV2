import { useEffect, useState } from "react";
import { Building2, Check, Gamepad2, X } from "lucide-react";
import GameSearch from "./GameSearch";

// ======================================================================
//  Épreuve « Le studio » — cite trois de ses jeux
// ======================================================================
// Un nom de studio s'affiche, trois emplacements vides attendent. On tape des
// titres, et chacun se range ou se refuse IMMÉDIATEMENT.
//
// LE RETOUR IMMÉDIAT EST NON NÉGOCIABLE. Sans lui, on tape trois noms à
// l'aveugle et on découvre le résultat à la sonnerie : ce n'est plus une
// épreuve, c'est un pari. C'est pour ça que le versus autorise ici SIX envois
// successifs (là où les autres épreuves parallèles n'en acceptent qu'un) et
// que chaque envoi porte la liste complète accumulée — voir le tableau
// `attemptsAllowed` dans routes/quizVersus.js.
//
// La liste d'acceptation, elle, est très large : tout ce qu'IGDB attribue au
// studio. Refuser « Okami » à quelqu'un qui répond Capcom serait la pire chose
// que cette épreuve puisse faire.
export default function RoundStudio({
  round,
  locked,
  reveal,
  lives,
  candidates,
  onAttempt,
  onProgress,
  sfx,
}) {
  // Les jeux acceptés jusqu'ici, dans l'ordre où on les a trouvés.
  const [found, setFound] = useState([]);
  // Les propositions refusées, gardées à l'écran pour ne pas les retenter.
  const [rejected, setRejected] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFound([]);
    setRejected([]);
    setBusy(false);
  }, [round?.index]);

  const need = round.need || 3;
  const done = found.length >= need;

  async function submit(cand) {
    if (locked || busy || done) return;
    // Déjà proposé : on ne gaspille pas un envoi (et en versus, ils sont
    // comptés — six en tout).
    const already = [...found, ...rejected].some(
      (g) => (g.name || "").toLowerCase() === (cand.name || "").toLowerCase()
    );
    if (already) return;

    setBusy(true);
    // On envoie TOUTE la liste, pas seulement le dernier nom : c'est ce qui
    // permet au serveur de recalculer un `ratio` cumulatif sans avoir à se
    // souvenir des envois précédents.
    const answers = [...found.map((g) => ({ gameId: g.gameId, name: g.name })), cand];
    try {
      const out = await onAttempt({ answers });
      // Le serveur (ou la correction locale en solo) renvoie la liste acceptée :
      // c'est elle qui fait foi, pas ce qu'on croyait avoir trouvé.
      const hit = out?.detail?.hit;
      if (Array.isArray(hit)) {
        const gained = hit.length > found.length;
        setFound(hit);
        if (gained) sfx?.play?.("correct");
        else {
          setRejected((r) => [...r, cand]);
          sfx?.play?.("wrong");
        }
        onProgress?.(hit.length, "");
      } else if (out?.correct) {
        setFound((f) => [...f, cand]);
        sfx?.play?.("correct");
      } else {
        setRejected((r) => [...r, cand]);
        sfx?.play?.("wrong");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="qz-studio">
      <div className="qz-studio-head">
        <Building2 size={22} />
        <b>{round.studio}</b>
        <em>
          Cite {need} jeux de ce studio
          {!reveal && lives != null ? ` · ${lives} essai${lives > 1 ? "s" : ""}` : ""}
        </em>
      </div>

      {/* Les trois emplacements. Vides, ils disent ce qu'il reste à faire ;
          remplis, ils donnent la satisfaction de voir le tableau se compléter. */}
      <div className="qz-slots">
        {Array.from({ length: need }).map((_, i) => {
          const g = found[i];
          return (
            <div key={i} className={`qz-slot ${g ? "filled" : ""}`}>
              {g ? (
                <>
                  {g.cover ? (
                    <img src={g.cover} alt="" loading="lazy" draggable="false" />
                  ) : (
                    <span className="qz-slot-ph">
                      <Gamepad2 size={16} />
                    </span>
                  )}
                  <span className="qz-slot-name">{g.name}</span>
                  <Check size={15} className="qz-slot-ok" />
                </>
              ) : (
                <span className="qz-slot-empty">{i + 1}</span>
              )}
            </div>
          );
        })}
      </div>

      {rejected.length > 0 && !reveal && (
        <div className="qz-rejects">
          {rejected.map((g, i) => (
            <span key={i} className="qz-reject">
              <X size={11} /> {g.name}
            </span>
          ))}
        </div>
      )}

      {!reveal && !done && (
        <GameSearch
          candidates={candidates}
          onSubmit={submit}
          disabled={locked || busy}
          resetKey={`${round.index}-${found.length}-${rejected.length}`}
          placeholder={`Un jeu de ${round.studio}…`}
        />
      )}

      {done && !reveal && <p className="qz-studio-done">Les trois y sont. Beau boulot.</p>}

      {/* À la révélation : quelques titres qu'on aurait pu citer. C'est le
          moment où l'épreuve apprend quelque chose. */}
      {reveal && round.examples?.length > 0 && (
        <div className="qz-studio-examples">
          <span className="qz-studio-examples-h">Il y avait aussi…</span>
          <div className="qz-studio-examples-row">
            {round.examples.slice(0, 6).map((g) => (
              <span key={g.gameId} className="qz-ex">
                {g.cover ? (
                  <img src={g.cover} alt="" loading="lazy" draggable="false" />
                ) : (
                  <span className="qz-slot-ph">
                    <Gamepad2 size={14} />
                  </span>
                )}
                <em>{g.name}</em>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
