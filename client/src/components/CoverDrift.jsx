import { useEffect, useState } from "react";
import { loadPublicStats } from "../lib/publicStats";

// ======================================================================
//  Le fond : des jaquettes inclinées qui défilent
// ======================================================================
// C'est le seul décor des pages publiques (accueil visiteur, connexion,
// inscription). Trois rangées penchées, qui glissent lentement et en sens
// contraire, très en retrait derrière le texte.
//
// ⚠️ CE SONT DE VRAIES JAQUETTES, PAS UNE IMAGE DE STOCK. Elles viennent de
// GET /api/stats — les jeux les plus présents dans les bibliothèques du site.
// Un visiteur reconnaît donc ce qu'il y a dedans avant d'avoir lu une ligne, et
// le décor se renouvelle tout seul à mesure que les gens ajoutent des jeux.
//
// ⚠️ ET ÇA RESTE UN DÉCOR. `aria-hidden` (rien à annoncer), `pointer-events:
// none` (rien à cliquer), et une animation qui s'arrête d'elle-même pour qui a
// demandé moins de mouvement (cf. la feuille de style).

// Trois rangées, chacune avec son inclinaison, sa vitesse et son sens. Les
// vitesses sont volontairement PREMIÈRES entre elles : sans ça, les trois
// rangées se réalignent périodiquement et la boucle se voit.
const ROWS = [
  { speed: 71, reverse: false },
  { speed: 97, reverse: true },
  { speed: 83, reverse: false },
];

const PER_ROW = 10;

export default function CoverDrift() {
  const [covers, setCovers] = useState(null);

  // La page d'accueil demande les mêmes chiffres pour ses totaux : `loadPublicStats`
  // garde la promesse, donc le second arrivant n'appelle pas une deuxième fois.
  useEffect(() => {
    let alive = true;
    loadPublicStats().then((d) => alive && setCovers(d.covers || []));
    return () => {
      alive = false;
    };
  }, []);

  // Pas encore de jaquettes (ou base vide) : on garde le cadre et ses cases
  // vides plutôt que d'attendre. Un fond qui apparaît d'un coup une seconde
  // après la page se remarque plus que des rectangles sourds.
  const pool = covers?.length ? covers : Array.from({ length: 18 }, () => null);

  return (
    <div className="drift" aria-hidden="true">
      {ROWS.map((row, i) => {
        // Chaque rangée part à un endroit différent du lot : trois fois les
        // mêmes jaquettes dans le même ordre, ça se voit tout de suite.
        const slice = Array.from(
          { length: PER_ROW },
          (_, n) => pool[(i * 7 + n * 3) % pool.length]
        );
        return (
          <div className="drift-row" key={i}>
            <div
              className={`drift-track ${row.reverse ? "rev" : ""}`}
              style={{ animationDuration: `${row.speed}s` }}
            >
              {/* Deux fois la même suite, bout à bout : c'est ce qui permet de
                  revenir au début sans que la boucle se voie. */}
              {[...slice, ...slice].map((src, n) =>
                src?.cover ? (
                  <img
                    className="drift-card"
                    key={n}
                    src={src.cover}
                    alt=""
                    loading="lazy"
                    draggable="false"
                  />
                ) : (
                  <span className="drift-card blank" key={n} />
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
