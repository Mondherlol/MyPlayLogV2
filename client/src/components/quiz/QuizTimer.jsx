// ======================================================================
//  Le chrono
// ======================================================================
// C'était une barre pleine largeur qui se vidait de droite à gauche, avec le
// chiffre au milieu. Deux problèmes, et le second est le vrai :
//
//   • ça ne se LISAIT pas comme un chrono. Une barre horizontale qui se vide,
//     c'est le vocabulaire d'une barre de progression — sauf qu'ici elle allait
//     à l'envers, ce qui donnait exactement l'impression d'une jauge cassée ;
//   • le chiffre était AU CENTRE de la zone qui se remplit, donc tantôt sur le
//     remplissage, tantôt sur la piste. Aucune couleur de texte ne tient sur les
//     deux.
//
// Un anneau règle les deux d'un coup : c'est la forme universelle du compte à
// rebours, le chiffre est au centre d'un disque de fond stable, et il se pose
// naturellement dans un coin du bandeau d'état au lieu de manger une ligne
// entière.
//
// Le tracé part de midi et tourne dans le sens des aiguilles (`rotate(-90)` sur
// le cercle) : c'est ce qu'on attend d'un chronomètre, et l'inverse de ce que
// SVG fait par défaut.
const R = 20;
const C = 2 * Math.PI * R;

export default function QuizTimer({ seconds, total, hot }) {
  // Part de temps qu'il reste, bornée : l'anneau ne doit jamais déborder ni
  // repasser dans le négatif entre deux tics.
  const frac = total > 0 ? Math.max(0, Math.min(1, seconds / total)) : 0;

  return (
    <div
      className={`qz-ring ${hot ? "hot" : ""}`}
      role="timer"
      aria-label={`${seconds} secondes restantes`}
    >
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle className="qz-ring-bg" cx="24" cy="24" r={R} />
        <circle
          className="qz-ring-fg"
          cx="24"
          cy="24"
          r={R}
          transform="rotate(-90 24 24)"
          style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }}
        />
      </svg>
      <span className="qz-ring-num">{seconds}</span>
    </div>
  );
}
