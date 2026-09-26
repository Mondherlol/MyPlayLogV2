import { Link } from "react-router-dom";
import { Plus } from "lucide-react";

import { boardOf, itemsBySlot } from "../lib/boards";

// ======================================================================
//  La grille d'une carte de joueur — un jeu par case
// ======================================================================
// La même grille sur la page de la carte (`compact` faux) et sur le profil
// (`compact`) : cinq colonnes, la case écrite sous la jaquette, et pour le
// protagoniste / l'antagoniste, le personnage choisi en médaillon, posé à
// cheval sur le coin de la jaquette.
//
// Une case vide reste à sa place, en pointillés : une grille à trous se lit
// encore comme une grille. Chez son propriétaire, elle se remplit d'un clic
// (`onFill`).

export default function BoardGrid({ board: boardKey, items, compact = false, linkGames = true, onFill }) {
  const board = boardOf(boardKey);
  const by = itemsBySlot(items);

  return (
    <ol className={`bd-grid ${compact ? "is-compact" : ""}`}>
      {board.slots.map((s, i) => {
        const it = by[s.key];
        if (!it) {
          const Tag = onFill ? "button" : "span";
          return (
            <li key={s.key} className="bd-cell empty" style={{ animationDelay: `${i * 25}ms` }}>
              <Tag
                type={onFill ? "button" : undefined}
                className={`bd-cell-art ${onFill ? "clickable" : ""}`}
                onClick={onFill ? () => onFill(s.key) : undefined}
                title={onFill ? `Remplir « ${s.label} »` : s.label}
              >
                {onFill ? <Plus size={compact ? 14 : 20} /> : <s.Icon size={compact ? 14 : 20} />}
              </Tag>
              <span className="bd-cell-label">{s.label}</span>
            </li>
          );
        }
        const gid = it.gameId ?? it.refId;
        const art = (
          <span className="bd-cell-art">
            {it.image ? <img src={it.image} alt="" loading="lazy" /> : <span className="bd-noart">{it.name}</span>}
            {it.charImage && (
              <span className="bd-medal" title={it.charName || ""}>
                <img src={it.charImage} alt={it.charName || ""} loading="lazy" />
              </span>
            )}
          </span>
        );
        return (
          <li key={s.key} className="bd-cell" style={{ animationDelay: `${i * 25}ms` }}>
            {linkGames && gid ? (
              <Link to={`/game/${gid}`} className="bd-cell-link clickable" title={`${s.label} : ${it.name}`}>
                {art}
              </Link>
            ) : (
              <span className="bd-cell-link" title={`${s.label} : ${it.name}`}>
                {art}
              </span>
            )}
            <span className="bd-cell-label">{s.label}</span>
            {!compact && (
              <span className="bd-cell-name">
                {it.charName ? `${it.charName} · ${it.name}` : it.name}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
