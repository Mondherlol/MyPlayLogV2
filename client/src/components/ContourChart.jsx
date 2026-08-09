// ======================================================================
//  Les deux courbes superposées
// ======================================================================
// La justification visuelle du score, partagée par le solo et le versus.
//
// C'est la pièce d'interface la plus importante du Perroquet, et pas un
// ornement : le barème (server/src/lib/soundContour.js) compare des voix
// humaines à des sons synthétisés, il est donc forcément approximatif. Un
// nombre nu se conteste ; un nombre à côté du dessin de l'écart s'accepte —
// « ah oui, je suis parti trop haut ». Sans ce graphique, chaque manche
// finirait en discussion sur la justesse de la note.
//
// Les deux séries sont des hauteurs en demi-tons RELATIFS à la médiane de
// chaque son : elles sont directement comparables quelle que soit la voix.
//
// L'ÉCHELLE VERTICALE EST COMMUNE, calculée sur les deux courbes réunies. Les
// normaliser séparément ferait coïncider n'importe quoi avec n'importe quoi :
// une imitation ratée aurait l'air juste, et le dessin mentirait sur le score
// qu'il est précisément là pour expliquer.
// `compact` : la même courbe en vignette, pour tenir dans une ligne de
// classement. Pas de légende, pas de pointillés — à cette taille ils
// deviendraient du bruit — mais RIGOUREUSEMENT LE MÊME CALCUL d'échelle. Une
// vignette qui normaliserait autrement que le grand graphique raconterait une
// autre histoire que lui, et c'est exactement ce qu'on ne veut pas : les deux
// sont là pour expliquer le même score.
export default function ContourChart({ target, attempt, compact = false, name }) {
  if (!target?.length || !attempt?.length) return null;

  const W = compact ? 90 : 320;
  const H = compact ? 26 : 96;
  const pad = compact ? 2 : 8;
  const all = [...target, ...attempt];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  // Plancher sur l'amplitude : sans lui, deux lignes quasi plates seraient
  // étirées sur toute la hauteur et un écart d'un quart de ton ressemblerait à
  // un gouffre.
  const span = Math.max(4, hi - lo);

  const toPath = (serie) =>
    serie
      .map((v, i) => {
        const x = pad + (i / (serie.length - 1)) * (W - pad * 2);
        const y = H - pad - ((v - lo) / span) * (H - pad * 2);
        return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");

  const alt = name
    ? `La mélodie de ${name} comparée à l'originale`
    : "Ta mélodie comparée à l'originale";

  if (compact)
    return (
      <svg
        className="pq-chart-mini"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={alt}
        preserveAspectRatio="none"
      >
        <path className="pq-curve target" d={toPath(target)} />
        <path className="pq-curve attempt" d={toPath(attempt)} />
      </svg>
    );

  return (
    <figure className="pq-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={alt}>
        <path className="pq-curve target" d={toPath(target)} />
        <path className="pq-curve attempt" d={toPath(attempt)} />
      </svg>
      <figcaption>
        <span className="pq-key target">l'original</span>
        <span className="pq-key attempt">{name || "toi"}</span>
      </figcaption>
    </figure>
  );
}
