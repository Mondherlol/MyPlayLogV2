import { Link } from "react-router-dom";
import { Plus } from "lucide-react";

import { boardOf, itemsBySlot } from "../../lib/boards";

// ======================================================================
//  La carte de joueur — vingt cases, et rien d'autre
// ======================================================================
// Sur sa page, la grille prend TOUTE la hauteur de l'écran : cinq colonnes,
// quatre rangées de jaquettes entières, sans en-tête au-dessus (les quelques
// outils vivent dans une colonne à côté, cf. pages/BoardDetail). C'est une
// grille qu'on remplit, pas une page qu'on lit.
//
// Une case vide dit ce qu'elle attend EN SON CENTRE — son icône et son
// libellé —, là où l'œil tombe. Remplie, la jaquette prend toute la place et
// le libellé se fait petit, en bas.
//
// `onCell(slot)` : la grille est éditable (chez son propriétaire), chaque case
// s'ouvre au clic. Sinon les cases remplies mènent à la fiche du jeu.
// `compact` : la version du profil, deux rangées de dix, sans libellés.

export default function PlayerCard({ list, items, compact = false, onCell }) {
  const board = boardOf(list?.board);
  const by = itemsBySlot(items);

  return (
    <ol className={`pc-grid ${compact ? "is-compact" : ""}`}>
      {board.slots.map((s) => {
        const it = by[s.key];
        const gid = it ? it.gameId ?? it.refId : null;
        const title = it ? `${s.label} — ${it.charName ? `${it.charName}, ` : ""}${it.name}` : s.label;
        const cls = `pc-cell ${it ? "filled" : "empty"}`;

        const inner = it ? (
          <>
            {it.image ? (
              <img className="pc-cover" src={it.image} alt="" loading="lazy" />
            ) : (
              <span className="pc-noart">{it.name}</span>
            )}
            {it.charImage && (
              <span className="pc-medal">
                <img src={it.charImage} alt="" loading="lazy" />
              </span>
            )}
            {!compact && <span className="pc-tag">{s.label}</span>}
          </>
        ) : (
          <span className="pc-empty">
            <s.Icon size={compact ? 15 : 22} strokeWidth={1.8} />
            {!compact && <span className="pc-empty-label">{s.label}</span>}
            {!compact && onCell && (
              <span className="pc-empty-add">
                <Plus size={13} strokeWidth={2.6} /> Choisir
              </span>
            )}
          </span>
        );

        return (
          <li key={s.key} className="pc-slot">
            {onCell ? (
              <button type="button" className={`${cls} clickable`} onClick={() => onCell(s.key)} title={title}>
                {inner}
              </button>
            ) : it && gid ? (
              <Link to={`/game/${gid}`} className={`${cls} clickable`} title={title}>
                {inner}
              </Link>
            ) : (
              <span className={cls} title={title}>
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
