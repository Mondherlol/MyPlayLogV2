import { Check, Plus } from "lucide-react";
import { cellFilled, winningIndexes } from "../../lib/bingo";

// ======================================================================
//  La grille, telle qu'on la voit
// ======================================================================
// UN SEUL COMPOSANT POUR LES TROIS ÉTATS, parce que c'est le même objet : on la
// compose, on la coche, on la regarde. Trois dessins séparés auraient divergé
// au premier réglage — et une grille qu'on vient de composer doit ressembler
// EXACTEMENT à celle qu'on cochera le soir venu, sinon on ne la reconnaît pas.
//
//   • `onCell` absent  → lecture seule ;
//   • `mode="check"`   → un clic coche (pendant l'émission) ;
//   • `mode="edit"`    → un clic ouvre l'éditeur de case (avant l'émission).
//
// ⚠️ LES LIGNES COMPLÈTES S'ALLUMENT. C'est tout l'intérêt d'un bingo : voir
// arriver la ligne. Le calcul ne compte que les cases REMPLIES (cf. lib/bingo)
// — une grille clairsemée peut donc gagner, une grille vide non.

export default function BingoGrid({
  cells,
  size,
  mode = "view",
  onCell,
  className = "",
  compact = false,
  // La case en cours d'édition, dans le composer : elle porte un anneau doré
  // pour qu'on sache à laquelle s'appliquent les réglages de droite.
  activeIndex = null,
}) {
  const winning = winningIndexes(cells, size);

  return (
    <div
      className={`bg-grid ${compact ? "compact" : ""} ${className}`}
      style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
    >
      {cells.map((c, i) => {
        const filled = cellFilled(c);
        const clickable = !!onCell && (mode === "edit" || (mode === "check" && filled));
        const Tag = clickable ? "button" : "div";
        return (
          <Tag
            key={i}
            className={[
              "bg-cell",
              i === activeIndex ? "sel" : "",
              c.checked ? "on" : "",
              c.free ? "free" : "",
              winning.has(i) ? "win" : "",
              filled ? "" : "empty",
              clickable ? "clickable" : "",
              c.image ? "has-img" : "",
              c.textStyle === "overlay" ? "overlay" : "banner",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={clickable ? () => onCell(i) : undefined}
            title={c.text || c.gameName || (mode === "edit" ? "Remplir cette case" : "")}
          >
            {!!c.image && (
              <img
                className="bg-cell-img"
                src={c.image}
                alt=""
                loading="lazy"
                draggable="false"
                style={c.pos ? { objectPosition: c.pos } : undefined}
              />
            )}

            {c.free && !c.text ? (
              <span className="bg-cell-free">FREE</span>
            ) : c.text ? (
              <span className="bg-cell-text">{c.text}</span>
            ) : mode === "edit" ? (
              <span className="bg-cell-add">
                <Plus size={16} />
              </span>
            ) : null}

            {/* La coche est posée par-dessus tout le reste : sur une case à
                image, un simple voile ne se verrait pas d'un coup d'œil, et
                c'est justement l'information qu'on cherche en balayant la
                grille pendant l'émission. */}
            {c.checked && (
              <span className="bg-cell-check">
                <Check size={compact ? 12 : 20} strokeWidth={3} />
              </span>
            )}
          </Tag>
        );
      })}
    </div>
  );
}
