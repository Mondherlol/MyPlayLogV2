import { useId } from "react";

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
// ------------------------------------------- POURQUOI LE TRAIT SE ROMPT
// Le graphique donnait l'impression de tracer n'importe quoi — « ça monte dans
// les silences, ça descend là où je parle » — et c'était vrai. Les instants sans
// hauteur mesurable (silence, souffle, consonne) sont comblés par interpolation
// côté serveur, parce que le barème a besoin d'une série continue ; on les
// dessinait ensuite exactement comme des notes mesurées. Le tracé montrait donc
// du remplissage avec l'aplomb d'une mesure.
//
// Désormais le masque `voiced` accompagne chaque contour et le trait plein
// s'arrête où la mesure s'arrête : les bouts interpolés restent en filet
// fantôme. Et l'aire de fond n'est plus l'aire sous la courbe de hauteur (qui ne
// voulait rien dire : la hauteur est relative, son « sous » est arbitraire) mais
// L'ENVELOPPE DE VOLUME DE L'ORIGINAL. On voit d'un coup d'œil où le son est
// fort, où il se tait, et pourquoi le trait s'interrompt là.
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

// Les intervalles d'indices où il y a VRAIMENT une hauteur. On passe la moitié
// comme seuil : les valeurs intermédiaires du masque sont des frontières de
// silence (le contour est ré-échantillonné à 64 points, une frontière tombe
// rarement pile sur un point).
//
// Les tronçons d'un seul point sont jetés : un trait de zéro pixel ne se voit
// pas, il ne fait que trouer la courbe pour rien.
function voicedSpans(mask, n) {
  if (!mask?.length) return [[0, n - 1]];
  const spans = [];
  let start = -1;
  for (let i = 0; i < n; i += 1) {
    const on = (mask[i] ?? 1) >= 0.5;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - 1 > start) spans.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0 && n - 1 > start) spans.push([start, n - 1]);
  return spans;
}

export default function ContourChart({
  target,
  attempt,
  // Les enveloppes et les masques de voisement, quand on les a. Le composant
  // fonctionne sans (vignettes, contours d'avant leur existence) : il retombe
  // alors sur deux traits pleins, l'ancien comportement.
  targetEnergy = null,
  targetVoiced = null,
  attemptVoiced = null,
  compact = false,
  name,
  progress = null,
  // Quelle courbe se dessine : celle du son joué. Pendant qu'on écoute
  // l'original c'est la sienne qui doit courir, sinon on regarde une ligne qui
  // avance sur un son qu'on n'entend pas.
  progressOn = "attempt",
  band,
}) {
  // Les identifiants des clips doivent être uniques par instance : le versus
  // affiche jusqu'à sept graphiques sur le même écran, et deux `clipPath` de
  // même id feraient tous porter le découpage du premier.
  const uid = useId().replace(/:/g, "");
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

  const xOf = (i, n) => pad + (i / (n - 1)) * (W - pad * 2);
  const toPoints = (serie) =>
    serie.map((v, i) => ({
      x: xOf(i, serie.length),
      y: H - pad - ((v - lo) / span) * (H - pad * 2),
    }));

  const targetPts = toPoints(target);
  const attemptPts = toPoints(attempt);
  const alt = name
    ? `La mélodie de ${name} comparée à l'originale`
    : "Ta mélodie comparée à l'originale";

  // Un rectangle par tronçon mesuré, débordant d'un demi-pas de chaque côté pour
  // que la coupe tombe entre deux points et non sur l'un d'eux.
  const clipRects = (mask, n) => {
    const half = (W - pad * 2) / (n - 1) / 2;
    return voicedSpans(mask, n).map(([a, b], k) => (
      <rect
        key={k}
        x={xOf(a, n) - half}
        y={-H}
        width={xOf(b, n) - xOf(a, n) + half * 2}
        height={H * 3}
      />
    ));
  };

  const clips = (
    <defs>
      <clipPath id={`pqv-t-${uid}`}>{clipRects(targetVoiced, target.length)}</clipPath>
      <clipPath id={`pqv-a-${uid}`}>{clipRects(attemptVoiced, attempt.length)}</clipPath>
    </defs>
  );

  if (compact)
    return (
      <svg
        className="pq-chart-mini"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={alt}
        preserveAspectRatio="none"
      >
        {clips}
        <path
          className="pq-curve target"
          d={smoothPath(targetPts)}
          clipPath={`url(#pqv-t-${uid})`}
        />
        <path
          className="pq-curve attempt"
          d={smoothPath(attemptPts)}
          clipPath={`url(#pqv-a-${uid})`}
        />
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
  // Le filet fantôme suit le MÊME dévoilement que le trait plein : sinon la
  // forme entière du son serait déjà visible avant qu'on l'ait entendu.
  const revealProps = (which) =>
    liveOn(which) ? { pathLength: 1, style: dash } : {};

  // L'enveloppe de volume de l'original, en fond. C'est elle qui rend le reste
  // lisible : les creux sont les silences, et c'est là que les traits se
  // rompent. Son échelle est la sienne (0 en bas, le pic à mi-hauteur) — elle ne
  // se lit pas sur l'axe des hauteurs, elle situe le son dans le temps.
  const envPath = (() => {
    if (!targetEnergy?.length) return "";
    const n = targetEnergy.length;
    const base = H - pad * 0.4;
    const tall = (H - pad * 2) * 0.55;
    const pts = targetEnergy.map((v, i) => ({
      x: xOf(i, n),
      y: base - Math.min(1, Math.max(0, v)) * tall,
    }));
    return `${smoothPath(pts)} L${pts[n - 1].x.toFixed(1)} ${base} L${pts[0].x.toFixed(1)} ${base} Z`;
  })();

  return (
    <figure className={`pq-chart ${band ? `band-${band}` : ""} ${at != null ? "live" : ""}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={alt}>
        {clips}
        {envPath && <path className="pq-curve-env" d={envPath} />}

        <path
          className="pq-curve ghost target"
          d={smoothPath(targetPts)}
          {...revealProps("target")}
        />
        <path
          className={`pq-curve target ${liveOn("target") ? "on" : ""}`}
          d={smoothPath(targetPts)}
          clipPath={`url(#pqv-t-${uid})`}
          {...revealProps("target")}
        />

        <path
          className="pq-curve ghost attempt"
          d={smoothPath(attemptPts)}
          {...revealProps("attempt")}
        />
        <path
          className={`pq-curve attempt ${liveOn("attempt") ? "on" : ""}`}
          d={smoothPath(attemptPts)}
          clipPath={`url(#pqv-a-${uid})`}
          {...revealProps("attempt")}
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
        {(targetVoiced || attemptVoiced) && (
          <span className="pq-key mute">sans hauteur</span>
        )}
      </figcaption>
    </figure>
  );
}
