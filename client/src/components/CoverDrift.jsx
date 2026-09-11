import { useEffect, useState } from "react";
import { loadPublicStats } from "../lib/publicStats";

// ======================================================================
//  Le fond : des jaquettes inclinées qui défilent
// ======================================================================
// C'est le seul décor des pages publiques (accueil visiteur, connexion,
// inscription). Quatre rangées penchées qui glissent lentement, en sens
// contraires, et qui couvrent TOUTE la page.
//
// ⚠️ TOUTE LA PAGE, ET C'EST LA LEÇON DE LA VERSION PRÉCÉDENTE. On avait
// essayé de les mettre en bandeaux — deux rangées en haut, deux en bas — pour
// les rendre plus visibles ; ça laissait au milieu une bande vide qui se lisait
// comme une barre noire en travers de l'écran. Un décor, ça couvre : ce sont
// les FONDUS (sur les bords, et au centre sous le texte) qui décident de ce
// qu'on voit, pas des trous dans la grille.
//
// ⚠️ CE SONT DE VRAIES JAQUETTES, PAS UNE IMAGE DE STOCK. Elles viennent de
// GET /api/stats — les jeux les plus présents dans les bibliothèques du site.
// Un visiteur reconnaît donc ce qu'il y a dedans avant d'avoir lu une ligne, et
// le décor se renouvelle tout seul à mesure que les gens ajoutent des jeux.
//
// ⚠️ ET ÇA RESTE UN DÉCOR. `aria-hidden` (rien à annoncer), `pointer-events:
// none` (rien à cliquer), et une animation qui s'arrête d'elle-même pour qui a
// demandé moins de mouvement (cf. la feuille de style).

// Quatre rangées, chacune avec sa vitesse et son sens. Les vitesses sont
// volontairement PREMIÈRES entre elles : sans ça, les rangées se réalignent
// périodiquement et la boucle se voit.
const ROWS = [
  { speed: 61 },
  { speed: 97, reverse: true },
  { speed: 71 },
  { speed: 83, reverse: true },
];

// ⚠️ UNE RANGÉE DOIT ÊTRE PLUS LARGE QUE L'ÉCRAN, SINON LA BOUCLE LAISSE UN
// TROU. La suite est écrite deux fois et l'animation la décale de la moitié :
// si cette moitié est plus courte que la fenêtre, on voit le vide arriver par
// la droite juste avant le raccord. Le bloc penché déborde en plus de 30 % de
// chaque côté, d'où le compte généreux.
const PER_ROW = 20;

export default function CoverDrift() {
  const [covers, setCovers] = useState(null);

  // La page d'accueil demande les mêmes chiffres pour ses totaux :
  // `loadPublicStats` garde la promesse, donc le second arrivant n'appelle pas
  // une deuxième fois.
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
        // Chaque rangée part à un endroit différent du lot : quatre fois les
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
