import { Link } from "react-router-dom";
import { Plus, X } from "lucide-react";

import { boardOf, itemsBySlot } from "../../lib/boards";

// ======================================================================
//  La carte de joueur — vingt cases, et rien d'autre
// ======================================================================
// Sur sa page, la grille prend TOUTE la hauteur de l'écran : cinq colonnes,
// quatre rangées, sans en-tête au-dessus (les outils vivent dans une colonne
// à côté, cf. pages/BoardDetail).
//
// Une case vide dit ce qu'elle attend EN SON CENTRE — son icône et son
// libellé. Remplie, la jaquette est entière et le libellé passe DESSOUS : posé
// dessus, il mangeait le bas de l'image, souvent le titre du jeu.
//
// ⚠️ LES CASES À PERSONNAGE MONTRENT LE PERSONNAGE. « Protagoniste préféré »,
// c'est Geralt, pas la jaquette du Sorceleur : son portrait remplit la case,
// et le jeu d'où il vient n'est plus qu'une vignette dans le coin.
//
// `onCell(slot)` : la grille est éditable (chez son propriétaire), chaque case
// s'ouvre au clic, et `onRemove(slot)` ajoute la croix de retrait au survol.
// Sinon les cases remplies mènent à la fiche du jeu.
// `compact` : la version du profil, deux rangées de dix, sans libellés.

export default function PlayerCard({ list, items, compact = false, onCell, onRemove }) {
  const board = boardOf(list?.board);
  const by = itemsBySlot(items);

  return (
    <ol className={`pc-grid ${compact ? "is-compact" : ""}`}>
      {board.slots.map((s) => {
        const it = by[s.key];
        const gid = it ? it.gameId ?? it.refId : null;
        const title = it ? `${s.label} — ${it.charName ? `${it.charName}, ` : ""}${it.name}` : s.label;
        const withChar = !!it?.charImage;
        const cls = `pc-cell ${it ? "filled" : "empty"} ${withChar ? "has-char" : ""}`;

        const inner = it ? (
          <>
            {withChar ? (
              <>
                <img className="pc-cover is-char" src={it.charImage} alt="" loading="lazy" />
                {it.image && <img className="pc-inset" src={it.image} alt="" loading="lazy" />}
              </>
            ) : it.image ? (
              <img className="pc-cover" src={it.image} alt="" loading="lazy" />
            ) : (
              <span className="pc-noart">{it.name}</span>
            )}
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
          <li key={s.key} className={`pc-slot ${it ? "is-filled" : ""}`}>
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
            {it && onRemove && (
              <button
                type="button"
                className="pc-x clickable"
                onClick={() => onRemove(s.key)}
                title={`Retirer de « ${s.label} »`}
                aria-label={`Retirer ${it.name}`}
              >
                <X size={14} strokeWidth={2.8} />
              </button>
            )}
            {!compact && (
              <span className="pc-label">{it ? s.label : ""}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
