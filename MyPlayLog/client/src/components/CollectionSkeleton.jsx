// ======================================================================
//  Squelettes de la collection
// ======================================================================
// L'attente garde la FORME de ce qui arrive — une rangée de tranches debout
// sur sa planche, une grille de boîtiers — mais rien de son DÉCOR. Pas de
// capuchon sombre, pas d'étiquette de pied, pas d'ombre portée, pas de
// balayage brillant : un squelette qui imite l'objet fini n'en est qu'une
// mauvaise copie, et la copie saute aux yeux au moment où le vrai arrive.
// Ici ce sont des aplats neutres qui respirent en vague, de gauche à droite.
//
// Tout est décoratif : `aria-hidden`, et l'attente est annoncée en toutes
// lettres par le libellé passé à côté.

// Hauteurs des tranches, en % de la rangée. Irrégulières à dessein : des
// boîtiers alignés au millimètre font un graphique, pas une étagère.
const SPINES = [98, 100, 96, 99, 94, 100, 97, 100, 95, 99, 93, 100, 96, 98];

// L'étagère en attente : la rangée respire d'un bout à l'autre.
//
// `progress` (0 → 1) n'est PAS décoratif : l'étagère ne se montre qu'une fois
// toutes ses jaquettes peintes (voir CollectionShelf), donc l'attente peut durer
// une seconde ou deux sur une grande collection encore froide. Sans jauge, elle
// n'a pas de fin annoncée ; avec, on voit qu'elle avance. Nul = pas de jauge du
// tout, plutôt qu'un rail vide qui ne bougera jamais.
export function ShelfSkeleton({
  label = "Chargement de la collection…",
  count = 14,
  progress = null,
}) {
  return (
    <div className="coll-shelf-skel" role="status" aria-label={label}>
      <div className="coll-shelf-skel-row" aria-hidden="true">
        {SPINES.slice(0, count).map((h, i) => (
          <span
            key={i}
            className="coll-skel-spine"
            style={{ "--h": `${h}%`, "--d": `${i * 90}ms` }}
          />
        ))}
      </div>
      <span className="coll-shelf-skel-plank" aria-hidden="true" />
      <span className="coll-shelf-skel-label">
        {label}
        {progress != null && (
          <span className="coll-shelf-skel-gauge" aria-hidden="true">
            <i style={{ width: `${Math.round(Math.min(1, progress) * 100)}%` }} />
          </span>
        )}
      </span>
    </div>
  );
}

// La grille en attente : la silhouette des boîtiers, et rien d'autre.
export function GridSkeleton({ count = 10 }) {
  return (
    <div className="coll-grid" role="status" aria-label="Chargement de la collection">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="coll-skel-case"
          style={{ "--d": `${i * 90}ms` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export default ShelfSkeleton;
