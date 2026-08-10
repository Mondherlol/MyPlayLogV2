// ======================================================================
//  Le décor du Perroquet
// ======================================================================
// Des notes qui montent lentement, très sourdes, derrière la page — sans halo
// ni dégradé : les deux blobs dorés lavaient la page d'un jaune qui la coupait
// du reste du site et virait au sale, ils ont été retirés.
// Purement décoratif (`aria-hidden`), et coupé sous 760 px par le CSS : sur
// téléphone il n'y a pas la place, et un ornement qui passe derrière le bouton
// principal est pire que pas d'ornement du tout.
//
// Partagé par le solo et le versus pour une raison simple : ce sont deux
// écrans du même jeu, et deux décors différents les feraient lire comme deux
// jeux distincts.
const NOTES = [
  { left: "6%", delay: 0, dur: 15, size: 26, glyph: "♪" },
  { left: "17%", delay: 5.5, dur: 19, size: 18, glyph: "♫" },
  { left: "31%", delay: 9, dur: 17, size: 22, glyph: "♩" },
  { left: "68%", delay: 2.5, dur: 20, size: 20, glyph: "♫" },
  { left: "81%", delay: 7, dur: 16, size: 28, glyph: "♪" },
  { left: "93%", delay: 12, dur: 21, size: 16, glyph: "♬" },
];

export default function PerroquetDecor() {
  return (
    <div className="pq-decor" aria-hidden="true">
      {NOTES.map((n, i) => (
        <span
          key={i}
          className="pq-note"
          style={{
            left: n.left,
            fontSize: `${n.size}px`,
            animationDelay: `${n.delay}s`,
            animationDuration: `${n.dur}s`,
          }}
        >
          {n.glyph}
        </span>
      ))}
    </div>
  );
}
