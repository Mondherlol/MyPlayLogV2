import { EDITIONS, cardCover } from "../../lib/cards";

// ======================================================================
//  Le booster : un sachet d'alu, soudé en haut et en bas
// ======================================================================
// Aucune jaquette en vedette : le fond est une MOSAÏQUE de jaquettes fondue
// dans la couleur de l'édition, et le centre un ÉVENTAIL de cartes — on voit
// « plein de jeux », jamais « un jeu ». Par-dessus, le nom du site en gros
// lettrage, et le ruban de l'édition.
//
// Purement visuel. Pour la déchirure, la scène d'ouverture le dessine DEUX
// fois — le rabat du haut et le corps — découpés le long de la même ligne
// dentelée (`TEAR_Y`, `tearClip`).

// Hauteur de la ligne de déchirure, en % de la hauteur du sachet : juste sous
// la soudure du haut, comme un vrai sachet qu'on ouvre.
export const TEAR_Y = 9;

// Une ligne de papier arraché : des points irréguliers autour de TEAR_Y.
// Tirée UNE fois par sachet (sinon la déchirure tremblerait à chaque rendu).
export function makeTearLine() {
  const pts = [];
  for (let x = 0; x <= 100; x += 2.5) {
    const y = TEAR_Y + (Math.random() - 0.5) * 1.4;
    pts.push([x, y]);
  }
  return pts;
}
export function tearClip(line, part) {
  const edge = line.map(([x, y]) => `${x}% ${y}%`).join(", ");
  return part === "top"
    ? `polygon(0% 0%, 100% 0%, ${[...line].reverse().map(([x, y]) => `${x}% ${y}%`).join(", ")})`
    : `polygon(${edge}, 100% 100%, 0% 100%)`;
}

// L'éventail : cinq cartes, du centre vers les bords.
const FAN = [
  { r: -26, y: 7 },
  { r: -13, y: 2 },
  { r: 0, y: 0 },
  { r: 13, y: 2 },
  { r: 26, y: 7 },
];

export default function BoosterPack({
  edition = "origines",
  covers = [],
  golden = false,
  className = "",
  style,
  children,
}) {
  const ed = EDITIONS.find((e) => e.key === edition) || EDITIONS[0];
  const k = EDITIONS.indexOf(ed);
  const n = covers.length;
  // Chaque édition pioche ses propres jaquettes dans la même poignée.
  const fan = FAN.map((f, i) => ({ ...f, cover: n ? covers[(k * 5 + i) % n] : null }));
  const tiles = n ? Array.from({ length: 30 }, (_, i) => covers[(i * 7 + k * 3) % n]) : [];

  return (
    <div className={`bst ed-${ed.key} ${golden ? "golden" : ""} ${className}`} style={style}>
      <div className="bst-foil">
        <div className="bst-bg" />
        {tiles.length > 0 && (
          <div className="bst-mosaic" aria-hidden="true">
            {tiles.map((c, i) => (
              <img key={i} src={cardCover(c, "t_cover_small")} alt="" loading="lazy" draggable="false" />
            ))}
          </div>
        )}
        <div className="bst-burst" />

        <div className="bst-fan">
          {fan.map((f, i) => (
            <span
              key={i}
              className="bst-fan-card"
              style={{ "--r": `${f.r}deg`, "--y": `${f.y}cqw`, zIndex: i === 2 ? 3 : i === 1 || i === 3 ? 2 : 1 }}
            >
              {f.cover && (
                <img src={cardCover(f.cover, "t_cover_big")} alt="" loading="lazy" draggable="false" />
              )}
            </span>
          ))}
        </div>

        <div className="bst-brand">
          <span className="bst-word">
            My<b>PlayLog</b>
          </span>
          <span className="bst-tag">Jeu de cartes</span>
        </div>

        <div className="bst-ribbon">
          <small>Édition {ed.no}</small>
          <span>{golden ? "Dorée" : ed.name}</span>
        </div>

        <span className="bst-set">Set 01</span>
        <span className="bst-count">
          <b>5</b>
          <small>cartes</small>
        </span>

        <span className="bst-crimp top" />
        <span className="bst-crimp bottom" />
        <span className="bst-pillow" />
        <span className="bst-sheen" />
      </div>
      {children}
    </div>
  );
}
