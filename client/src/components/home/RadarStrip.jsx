import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, ChevronRight, Gamepad2, Gift, Radar } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { shortDate } from "../../lib/homeEvents";

// Croise la liste « à jouer » avec les dates de sortie IGDB : les jeux voulus
// sortis ces 30 derniers jours (toujours pas lancés) et ceux qui sortent dans
// les 30 jours. Masqué s'il n'y a rien à signaler.
const WINDOW = 30 * 86400;

/** « il y a 5 j » — le recul depuis la sortie d'un jeu déjà dispo. */
function agoDays(ts) {
  const d = Math.max(0, Math.floor((Date.now() - ts * 1000) / 86400000));
  if (d === 0) return "aujourd'hui";
  if (d === 1) return "hier";
  return `il y a ${d} j`;
}

/** Compte à rebours en direct jusqu'à un timestamp unix : « J-13 · 07:42:19 ». */
function LiveCountdown({ ts }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  let left = Math.max(0, Math.floor(ts - Date.now() / 1000));
  const days = Math.floor(left / 86400);
  left -= days * 86400;
  const two = (n) => String(n).padStart(2, "0");
  const clock = `${two(Math.floor(left / 3600))}:${two(Math.floor((left % 3600) / 60))}:${two(left % 60)}`;
  return (
    <span className="mh-radar-when cd" title="Temps restant avant la sortie">
      {days > 0 ? `J-${days} · ${clock}` : clock}
    </span>
  );
}

function Row({ game, badge }) {
  return (
    <Link to={`/game/${game.id}`} className="mh-radar-row clickable" title={game.name}>
      {game.cover ? (
        <img src={game.cover} alt="" loading="lazy" draggable="false" />
      ) : (
        <span className="mh-radar-ph">
          <Gamepad2 size={14} />
        </span>
      )}
      <span className="mh-radar-info">
        <span className="mh-radar-name">{game.name}</span>
        <span className="mh-radar-sub">
          {game.releaseDate > Date.now() / 1000
            ? shortDate(game.releaseDate)
            : `sorti ${agoDays(game.releaseDate)}`}
        </span>
      </span>
      {badge}
    </Link>
  );
}

/**
 * « Sur ton radar » — la liste d'envies, croisée avec le calendrier.
 *
 * ⚠️ CE N'EST PAS UN RAYON DE DÉCOUVERTE. Tout ce qui est là, on l'a mis
 * soi-même dans ses envies : la seule information ajoutée, c'est le TEMPS —
 * « c'est sorti et tu ne l'as toujours pas lancé », « c'est dans neuf jours ».
 * D'où sa place tout en haut, avec les rayons qui parlent de moi.
 */
export default function RadarStrip({ wishIds, token }) {
  const [radar, setRadar] = useState(null);
  const key = (wishIds || []).join(",");

  useEffect(() => {
    if (!key) {
      setRadar(null);
      return undefined;
    }
    let alive = true;
    const from = Math.floor(Date.now() / 1000) - WINDOW;
    apiFetch(`/games/releases?ids=${key}&from=${from}`, { token })
      .then((d) => {
        if (!alive) return;
        const now = Math.floor(Date.now() / 1000);
        const soon = [];
        const out = [];
        for (const g of d.games || []) {
          if (!g.releaseDate) continue;
          if (g.releaseDate <= now) out.push(g);
          else if (g.releaseDate <= now + WINDOW) soon.push(g);
        }
        soon.sort((a, b) => a.releaseDate - b.releaseDate);
        out.sort((a, b) => b.releaseDate - a.releaseDate);
        setRadar({ soon, out });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, token]);

  if (!radar || (!radar.soon.length && !radar.out.length)) return null;
  const { soon, out } = radar;

  return (
    <section className="mh-radar">
      <div className="mh-radar-head">
        <span className="mh-kicker">
          <Radar size={12} /> Sur ton radar
        </span>
        <Link to="/releases?wish=1" className="mh-head-more clickable">
          Calendrier <ChevronRight size={15} />
        </Link>
      </div>

      <div className="mh-radar-cols">
        {out.length > 0 && (
          <div className="mh-radar-col">
            <p className="mh-radar-title gold">
              <Gift size={12} /> Déjà dispo — toujours pas lancé…
            </p>
            {out.slice(0, 3).map((g) => (
              <Row key={g.id} game={g} badge={<span className="mh-radar-when out">Dispo !</span>} />
            ))}
          </div>
        )}

        {soon.length > 0 && (
          <div className="mh-radar-col">
            <p className="mh-radar-title">
              <CalendarClock size={12} /> Sorties imminentes
            </p>
            {soon.slice(0, 3).map((g, i) => (
              <Row
                key={g.id}
                game={g}
                badge={
                  i === 0 ? (
                    <LiveCountdown ts={g.releaseDate} />
                  ) : (
                    <span className="mh-radar-when">
                      J-{Math.ceil((g.releaseDate * 1000 - Date.now()) / 86400000)}
                    </span>
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
