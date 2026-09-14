import { Link } from "react-router-dom";
import { Trophy, Gamepad2 } from "lucide-react";

// ======================================================================
//  Palmarès d'une cérémonie (The Game Awards, Spike VGA)
// ======================================================================
// Les prix ne portent que des refId : nom et jaquette viennent des items de
// la liste, déjà chargés par la page — pas de requête en plus.

function Cover({ item, className }) {
  return (
    <span className={className}>
      {item?.image ? (
        <img src={item.image} alt="" loading="lazy" draggable="false" />
      ) : (
        <Gamepad2 size={18} />
      )}
    </span>
  );
}

export default function AwardsBoard({ awards, items }) {
  const byRef = new Map(items.map((i) => [String(i.refId), i]));
  const main = awards.find((a) => a.main);
  const goty = main && byRef.get(main.winner);
  const nominees = (main?.nominees || []).map((r) => byRef.get(r)).filter(Boolean);
  const rest = awards.filter((a) => !a.main && byRef.has(a.winner));

  return (
    <section className="aw-board" aria-label="Palmarès">
      <h2 className="aw-head">
        <Trophy size={16} /> Palmarès
        <span className="aw-count">
          {awards.length} prix
        </span>
      </h2>

      {goty && (
        <div className="aw-goty">
          <Link to={`/game/${goty.gameId}`} className="aw-goty-link clickable">
            <Cover item={goty} className="aw-goty-cover" />
            <span className="aw-goty-body">
              <span className="aw-kicker">Jeu de l'année</span>
              <strong className="aw-goty-title">{goty.name}</strong>
            </span>
          </Link>
          {nominees.length > 0 && (
            <div className="aw-nominees">
              <span className="aw-nominees-label">Nommés</span>
              <div className="aw-nominees-row">
                {nominees.map((n) => (
                  <Link
                    key={n.refId}
                    to={`/game/${n.gameId}`}
                    className="aw-nominee clickable"
                    title={n.name}
                  >
                    <Cover item={n} className="aw-nominee-cover" />
                    <span className="aw-nominee-name">{n.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {rest.length > 0 && (
        <div className="aw-grid">
          {rest.map((a) => {
            const w = byRef.get(a.winner);
            return (
              <Link
                key={a.category}
                to={`/game/${w.gameId}`}
                className="aw-cell clickable"
                title={w.name}
              >
                <Cover item={w} className="aw-cell-cover" />
                <span className="aw-cell-body">
                  <span className="aw-cat">{a.category}</span>
                  <strong className="aw-cell-title">{w.name}</strong>
                  {a.person && <span className="aw-person">{a.person}</span>}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
