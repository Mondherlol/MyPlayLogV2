import { Check } from "lucide-react";
import { cardCover } from "../../lib/cards";
import { BINDER_COLORS } from "./Binders";

// ======================================================================
//  La vitrine des classeurs d'un joueur
// ======================================================================
// Sur la page d'un autre joueur : ses classeurs posés comme des albums, la
// tranche à sa couleur, trois jaquettes en éventail, et où il en est. Un clic
// ouvre le classeur dans la grille en dessous.

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

export default function BinderShowcase({ binders, onOpen }) {
  if (!binders?.length) return null;
  return (
    <section className="bsc">
      <h2 className="bsc-title">
        Classeurs <small>{binders.length}</small>
      </h2>
      <div className="bsc-row">
        {binders.map((b) => {
          const done = b.total > 0 && b.owned === b.total;
          const pct = b.total ? b.owned / b.total : 0;
          return (
            <button
              key={b.id}
              className={`bsc-album clickable ${done ? "done" : ""}`}
              style={{ "--bc": BINDER_COLORS[b.color] || BINDER_COLORS.gold }}
              onClick={() => onOpen(b.id)}
              title={`${b.name} — ${fmt(b.owned)}/${fmt(b.total)}`}
            >
              <span className="bsc-spine" aria-hidden="true" />
              <span className="bsc-fan" aria-hidden="true">
                {[0, 1, 2].map((i) =>
                  b.covers[i] ? (
                    <img
                      key={i}
                      className={`bsc-c c${i}`}
                      src={cardCover(b.covers[i], "t_cover_big")}
                      alt=""
                      loading="lazy"
                      draggable="false"
                    />
                  ) : (
                    <span key={i} className={`bsc-c c${i} empty`} />
                  )
                )}
              </span>
              <span className="bsc-foot">
                <span className="bsc-name">{b.name}</span>
                <span className="bsc-prog">
                  <i style={{ "--p": pct }} />
                </span>
                <span className="bsc-count">
                  {done ? (
                    <>
                      <Check size={13} strokeWidth={3} /> Complet
                    </>
                  ) : (
                    `${fmt(b.owned)}/${fmt(b.total)}`
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
