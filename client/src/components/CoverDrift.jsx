import { useEffect, useState } from "react";
import { loadPublicStats } from "../lib/publicStats";

// ======================================================================
//  Le fond : des jaquettes qui défilent
// ======================================================================
// C'est le seul décor des pages publiques (accueil visiteur, connexion,
// inscription). Deux formes, pour deux besoins :
//
//   • `bands` — l'accueil visiteur : deux bandeaux, un EN HAUT et un EN BAS,
//     de deux rangées chacun, qui glissent en sens contraires. Le texte tient
//     au milieu, dans le vide qu'ils laissent. C'est la mise en page d'une
//     marquise de cinéma : ça bouge sur les bords, ça se lit au centre.
//   • par défaut — les pages de compte : trois rangées penchées derrière le
//     panneau de gauche, très en retrait.
//
// ⚠️ CE SONT DE VRAIES JAQUETTES, PAS UNE IMAGE DE STOCK. Elles viennent de
// GET /api/stats — les jeux les plus présents dans les bibliothèques du site.
// Un visiteur reconnaît donc ce qu'il y a dedans avant d'avoir lu une ligne, et
// le décor se renouvelle tout seul à mesure que les gens ajoutent des jeux.
//
// ⚠️ ET ÇA RESTE UN DÉCOR. `aria-hidden` (rien à annoncer), `pointer-events:
// none` (rien à cliquer), et une animation qui s'arrête d'elle-même pour qui a
// demandé moins de mouvement (cf. la feuille de style).

// Les vitesses sont volontairement PREMIÈRES entre elles : sans ça, les rangées
// se réalignent périodiquement et la boucle se voit.
const BANDS = [
  { rows: [{ speed: 61 }, { speed: 97, reverse: true }], where: "top" },
  { rows: [{ speed: 83, reverse: true }, { speed: 71 }], where: "bottom" },
];

const TILTED = [
  { speed: 71 },
  { speed: 97, reverse: true },
  { speed: 83 },
];

// ⚠️ UNE RANGÉE DOIT ÊTRE PLUS LARGE QUE L'ÉCRAN, SINON LA BOUCLE LAISSE UN
// TROU. La suite est écrite deux fois et l'animation la décale de la moitié :
// si cette moitié est plus courte que la fenêtre, on voit le vide arriver par
// la droite juste avant le raccord. Vingt-deux jaquettes couvrent un écran de
// 2560 px à la taille maximale.
const BAND_PER_ROW = 22;
const TILT_PER_ROW = 12;

function Row({ pool, seed, count, speed, reverse }) {
  // Chaque rangée part à un endroit différent du lot : quatre fois les mêmes
  // jaquettes dans le même ordre, ça se voit tout de suite.
  const slice = Array.from(
    { length: count },
    (_, n) => pool[(seed * 7 + n * 3) % pool.length]
  );
  return (
    <div className="drift-row">
      <div
        className={`drift-track ${reverse ? "rev" : ""}`}
        style={{ animationDuration: `${speed}s` }}
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
}

export default function CoverDrift({ bands = false }) {
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

  if (bands) {
    return (
      <div className="drift bands" aria-hidden="true">
        {BANDS.map((band, b) => (
          <div className={`drift-band ${band.where}`} key={band.where}>
            {band.rows.map((row, i) => (
              <Row
                key={i}
                pool={pool}
                seed={b * 2 + i}
                count={BAND_PER_ROW}
                speed={row.speed}
                reverse={row.reverse}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="drift" aria-hidden="true">
      {TILTED.map((row, i) => (
        <Row
          key={i}
          pool={pool}
          seed={i}
          count={TILT_PER_ROW}
          speed={row.speed}
          reverse={row.reverse}
        />
      ))}
    </div>
  );
}
