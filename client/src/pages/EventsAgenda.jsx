import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import EventCard from "../components/home/EventCard";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { countdown, needsTicker, useSecondsTicker } from "../lib/homeEvents";

// ======================================================================
//  L'agenda complet : tout ce qui arrive
// ======================================================================
// L'accueil ne montre que les grands rendez-vous (Directs, State of Play, The
// Game Awards…). Ici, TOUT : les petits showcases d'éditeurs, les salons, les
// collectifs indés. Rangé par mois, avec un filtre pour revenir aux grands.
//
// La source est `/events/range` (le calendrier) plutôt que `/upcoming`, qui
// plafonne à trente entrées : un agenda complet qui s'arrête en novembre
// mentirait par omission. On part d'un jour en arrière pour garder le Direct
// d'hier soir, dont on vient justement voir les annonces.

const FILTERS = [
  { id: "all", label: "Tout", test: () => true },
  { id: "featured", label: "À la une", test: (e) => e.featured },
  { id: "showcase", label: "Showcases", test: (e) => e.kind === "showcase" },
  { id: "conference", label: "Salons", test: (e) => e.kind === "conference" },
];

const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;
const monthLabel = (d) => {
  const s = d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function EventsAgenda() {
  const { token } = useAuth();
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let alive = true;
    const from = new Date(Date.now() - 86400000).toISOString();
    apiFetch(`/events/range?from=${encodeURIComponent(from)}`, { token })
      .then((d) => alive && setEvents(d.events || []))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [token]);

  const tick = useSecondsTicker(useMemo(() => needsTicker(events), [events]));

  // Même geste que sur l'accueil : on envoie l'état voulu, le serveur a le
  // dernier mot sur le compte.
  const toggleInterest = useCallback(
    async (event, want) => {
      const paint = (on, count) =>
        setEvents((prev) =>
          (prev || []).map((e) =>
            e.id === event.id ? { ...e, interested: on, interestedCount: count } : e
          )
        );
      paint(want, Math.max(0, (event.interestedCount || 0) + (want ? 1 : -1)));
      try {
        const res = await apiFetch(`/events/${event.id}/interest`, {
          method: "POST",
          token,
          body: { interested: want },
        });
        paint(res.interested, res.interestedCount ?? 0);
      } catch {
        paint(event.interested, event.interestedCount || 0);
      }
    },
    [token]
  );

  const months = useMemo(() => {
    const test = FILTERS.find((f) => f.id === filter)?.test || (() => true);
    const now = Date.now();
    const out = [];
    for (const ev of events || []) {
      if (!test(ev) || countdown(ev, now).over) continue;
      const d = new Date(ev.startsAt);
      const key = monthKey(d);
      let m = out[out.length - 1];
      if (!m || m.key !== key) out.push((m = { key, label: monthLabel(d), items: [] }));
      m.items.push(ev);
    }
    return out;
  }, [events, filter]);

  return (
    <div className="agenda">
      <div className="agenda-head">
        <Link to="/app" className="agenda-back clickable" aria-label="Retour à l'accueil">
          <ArrowLeft size={18} />
        </Link>
        <h1>Tout l'agenda</h1>
      </div>

      <div className="agenda-filters" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            className={`agenda-filter clickable ${filter === f.id ? "active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="agenda-empty">{error}</p>
      ) : events === null ? (
        <div className="agenda-empty">
          <Loader2 size={22} className="spin" />
        </div>
      ) : months.length === 0 ? (
        <p className="agenda-empty">Rien de prévu pour l'instant.</p>
      ) : (
        months.map((m) => (
          <section className="agenda-month" key={m.key}>
            <h2>{m.label}</h2>
            <div className="agenda-grid">
              {m.items.map((ev) => (
                <EventCard
                  key={ev.id}
                  event={ev}
                  now={tick}
                  onToggleInterest={(want) => toggleInterest(ev, want)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
