import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import PixelCanvas from "../PixelCanvas";
import GameSearch from "./GameSearch";

// ======================================================================
//  Épreuve « Pixels » — une capture, noyée
// ======================================================================
// C'est Pixel Rush en une manche, et c'est le composant de Pixel Rush qui
// l'affiche : même PixelCanvas, même coin laissé net, même loupe. Deux
// pixelisations légèrement différentes dans la même application seraient
// perçues comme un bug, pas comme une variante.
//
// La définition remonte avec le chrono, sans jamais devenir lisible — le rendu
// net est réservé à la révélation. Les bornes sont celles de Pixel Rush : à 24
// blocs de large on lit des masses de couleur et une ambiance, jamais une
// scène.
const PIX_START = 9;
const PIX_END = 24;

export default function RoundPixel({
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

  const progress = Math.min(1, elapsedMs / Math.max(1, (round.durationSec || 30) * 1000));
  // Arrondi : le canvas ne se redessine qu'au changement de palier (une
  // quinzaine de fois par manche) et pas à chaque tic de rendu.
  const blocks = Math.round(PIX_START + (PIX_END - PIX_START) * progress);

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
    <div className="qz-pixel">
      <div className="qz-pixel-stage">
        <PixelCanvas
          key={round.shot}
          src={round.shot}
          blocks={reveal ? 200 : blocks}
          reveal={!!reveal}
          clear={round.clearCorner}
          // La loupe se coupe à la révélation : il n'y a plus rien à fouiller.
          loupe={!reveal && !locked}
          label={reveal ? `Capture de ${round.gameName}` : "Capture pixelisée"}
        />
        {!reveal && <span className="qz-pixel-def">{blocks}px</span>}
      </div>

      {/* LA RÉPONSE, à la révélation. Elle manquait : l'image redevenait nette
          mais rien ne disait de quel jeu il s'agissait — or on peut très bien
          ne pas reconnaître une capture même en la voyant parfaitement. C'est
          d'autant plus vrai depuis qu'on peut passer une épreuve : passer sans
          jamais apprendre la réponse n'aurait aucun intérêt. */}
      {reveal && round.gameName && (
        <div className="qz-answer-card">
          {round.cover && <img src={round.cover} alt="" draggable="false" />}
          <span>
            <em>C'était</em>
            {round.gameId ? (
              <Link to={`/game/${round.gameId}`} className="clickable">
                {round.gameName}
              </Link>
            ) : (
              <b>{round.gameName}</b>
            )}
          </span>
        </div>
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
            placeholder="Quel jeu ?"
          />
        </>
      )}
    </div>
  );
}
