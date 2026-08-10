// ======================================================================
//  Les deux courbes superposées
// ======================================================================
// La justification visuelle du score, partagée par le solo et le versus.
//
// C'est la pièce d'interface la plus importante du Perroquet, et pas un
// ornement : le barème (server/src/lib/soundContour.js) compare des voix
// humaines à des sons synthétisés, il est donc forcément approximatif. Un
// nombre nu se conteste ; un nombre à côté du dessin de l'écart s'accepte —
// « ah oui, je suis parti trop haut ».
//
// Les deux séries sont des hauteurs en demi-tons RELATIFS à la médiane de
// chaque son : elles sont directement comparables quelle que soit la voix.
//
// L'ÉCHELLE VERTICALE EST COMMUNE, calculée sur les deux courbes réunies. Les
// normaliser séparément ferait coïncider n'importe quoi avec n'importe quoi :
// une imitation ratée aurait l'air juste, et le dessin mentirait sur le score
// qu'il est précisément là pour expliquer.
//
// ---------------------------------------------------------------- `progress`
// De 0 à 1 : la courbe se DESSINE au rythme de la lecture, et un point la suit
// en tête de tracé. C'est ce qui relie enfin le dessin au son — avant, on
// entendait un cri pendant qu'un graphique fini restait immobile à côté, et
// rien ne disait quel bout de la courbe correspondait à quel moment. Laisser
// `progress` à `null` rend la courbe entière, d'un coup (récap, vignettes).

// Un tracé lissé : les 64 points bruts donnent une ligne en dents de scie qui a
// l'air d'une erreur de mesure. La courbe de Catmull-Rom passe EXACTEMENT par
// les points (elle n'invente aucune hauteur), elle arrondit seulement les
// angles entre eux.
function smoothPath(pts) {
  if (pts.length < 2) return "";
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export default function ContourChart({
  target,
  attempt,
  compact = false,
  name,
  progress = null,
  // Quelle courbe se dessine : celle du son joué. Pendant qu'on écoute
  // l'original c'est la sienne qui doit courir, sinon on regarde une ligne qui
  // avance sur un son qu'on n'entend pas.
  progressOn = "attempt",
  band,
}) {
  if (!target?.length || !attempt?.length) return null;

  const W = compact ? 90 : 320;
  const H = compact ? 26 : 104;
  const pad = compact ? 2 : 10;
  const all = [...target, ...attempt];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  // Plancher sur l'amplitude : sans lui, deux lignes quasi plates seraient
  // étirées sur toute la hauteur et un écart d'un quart de ton ressemblerait à
  // un gouffre.
  const span = Math.max(4, hi - lo);

  const toPoints = (serie) =>
    serie.map((v, i) => ({
      x: pad + (i / (serie.length - 1)) * (W - pad * 2),
      y: H - pad - ((v - lo) / span) * (H - pad * 2),
    }));

  const targetPts = toPoints(target);
  const attemptPts = toPoints(attempt);
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
        <path className="pq-curve target" d={smoothPath(targetPts)} />
        <path className="pq-curve attempt" d={smoothPath(attemptPts)} />
      </svg>
    );

  // La tête de lecture : le point qui court sur la courbe. Interpolé entre deux
  // points de mesure, sinon il avancerait par saccades de 1/64e.
  const at = progress == null ? null : Math.min(1, Math.max(0, progress));
  const livePts = progressOn === "target" ? targetPts : attemptPts;
  let head = null;
  if (at != null) {
    const f = at * (livePts.length - 1);
    const i = Math.min(livePts.length - 2, Math.floor(f));
    const t = f - i;
    const a = livePts[i];
    const b = livePts[i + 1] || a;
    head = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  const dash = { strokeDasharray: 1, strokeDashoffset: 1 - (at ?? 1) };
  const liveOn = (which) => at != null && progressOn === which;

  return (
    <figure className={`pq-chart ${band ? `band-${band}` : ""} ${at != null ? "live" : ""}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={alt}>
        {/* L'aire sous l'original : elle donne du corps à la référence sans
            ajouter une deuxième ligne à lire. */}
        <path
          className="pq-curve-area"
          d={`${smoothPath(targetPts)} L${W - pad} ${H} L${pad} ${H} Z`}
        />
        <path
          className={`pq-curve target ${liveOn("target") ? "on" : ""}`}
          d={smoothPath(targetPts)}
          pathLength={liveOn("target") ? 1 : undefined}
          style={liveOn("target") ? dash : undefined}
        />
        <path
          className={`pq-curve attempt ${liveOn("attempt") ? "on" : ""}`}
          d={smoothPath(attemptPts)}
          pathLength={liveOn("attempt") ? 1 : undefined}
          style={liveOn("attempt") ? dash : undefined}
        />
        {head && (
          <circle
            className={`pq-curve-head ${progressOn}`}
            cx={head.x}
            cy={head.y}
            r="4.5"
          />
        )}
      </svg>
      <figcaption>
        <span className="pq-key target">l'original</span>
        <span className="pq-key attempt">{name || "toi"}</span>
      </figcaption>
    </figure>
  );
}
