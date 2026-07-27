// ======================================================================
//  Squelettes de la collection
// ======================================================================
// Une page qui charge doit déjà avoir la FORME de ce qui arrive : ici, une
// rangée de tranches debout sur leur planche, ou une grille de boîtiers. Un
// rond qui tourne ne dit rien de ce qu'on attend, et l'étagère 3D met un temps
// à se monter (chunk three.js + peinture des jaquettes) — c'est précisément le
// moment où l'on doit reconnaître le rayon.
//
// Tout est décoratif : `aria-hidden`, et l'attente est annoncée en toutes
// lettres par le libellé passé à côté.

// Hauteurs des tranches, en % de la rangée. Irrégulières à dessein : des
// boîtiers alignés au millimètre font un graphique, pas une étagère.
const SPINES = [98, 100, 96, 99, 94, 100, 97, 100, 95, 99, 93, 100, 96, 98];

function Spine({ h, i }) {
  return (
    <span
      className="coll-skel-spine"
      style={{ "--h": `${h}%`, "--d": `${i * 55}ms` }}
    >
      <i className="coll-skel-cap" />
      <i className="coll-skel-art" />
      <i className="coll-skel-body" />
      <i className="coll-skel-foot" />
    </span>
  );
}

// L'étagère en attente : les tranches poussent une à une depuis la planche.
export function ShelfSkeleton({ label = "On dépoussière l'étagère…", count = 14 }) {
  return (
    <div className="coll-shelf-skel" role="status" aria-label={label}>
      <div className="coll-shelf-skel-row" aria-hidden="true">
        {SPINES.slice(0, count).map((h, i) => (
          <Spine key={i} h={h} i={i} />
        ))}
      </div>
      <span className="coll-shelf-skel-plank" aria-hidden="true" />
      <span className="coll-shelf-skel-label">{label}</span>
    </div>
  );
}

// La grille en attente : des boîtiers fermés, tranche à gauche et plaque de
// titre en bas — la silhouette exacte de CollectionCase.
export function GridSkeleton({ count = 10 }) {
  return (
    <div className="coll-grid" role="status" aria-label="Chargement de la collection">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="coll-skel-case"
          style={{ "--d": `${i * 60}ms` }}
          aria-hidden="true"
        >
          <i className="coll-skel-case-spine" />
          <i className="coll-skel-case-art" />
        </span>
      ))}
    </div>
  );
}

export default ShelfSkeleton;
