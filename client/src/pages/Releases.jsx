import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  Bookmark,
  Loader2,
  AlertTriangle,
  CalendarX,
  ChevronDown,
  Sparkles,
  Check,
  Minus,
  Search,
  X,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { makeCache } from "../lib/cache";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { useClickOutside } from "../hooks/useClickOutside";
import GameCard from "../components/GameCard";

// Menu déroulant multi-sélection tri-état (Console / Genre) avec recherche.
// `selected` = objet { valeur: "include" | "exclude" }. Un clic fait défiler
// neutre → inclure → exclure → neutre.
function MultiDropdown({ label, options, selected, onCycle, onClear }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);

  const count = Object.keys(selected).length;
  const term = q.trim().toLowerCase();
  const shown = term
    ? options.filter((o) => o.toLowerCase().includes(term))
    : options;

  return (
    <div className="rel-dd" ref={ref}>
      <button
        className={`rel-dd-btn clickable ${count ? "active" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {count > 0 && <span className="rel-dd-count">{count}</span>}
        <ChevronDown size={15} className={`rel-dd-caret ${open ? "up" : ""}`} />
      </button>
      {open && (
        <div className="rel-dd-menu card">
          <div className="rel-dd-search">
            <Search size={14} />
            <input
              autoFocus
              placeholder="Rechercher…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button
                className="rel-dd-search-clear clickable"
                onClick={() => setQ("")}
                aria-label="Effacer"
              >
                <X size={13} />
              </button>
            )}
          </div>
          {shown.length === 0 ? (
            <div className="rel-dd-empty">Aucun résultat</div>
          ) : (
            <div className="rel-dd-list">
              {shown.map((o) => {
                const state = selected[o]; // "include" | "exclude" | undefined
                return (
                  <button
                    key={o}
                    className={`rel-dd-item clickable ${state || ""}`}
                    onClick={() => onCycle(o)}
                    title={
                      state === "include"
                        ? "Inclus — cliquer pour exclure"
                        : state === "exclude"
                        ? "Exclu — cliquer pour retirer"
                        : "Cliquer pour inclure"
                    }
                  >
                    <span className="rel-dd-box">
                      {state === "include" && <Check size={13} />}
                      {state === "exclude" && <Minus size={13} />}
                    </span>
                    {o}
                  </button>
                );
              })}
            </div>
          )}
          {count > 0 && (
            <button className="rel-dd-clear clickable" onClick={onClear}>
              Tout réinitialiser
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Le calendrier des sorties change peu d'un jour à l'autre : on garde le
// résultat 24h (mémoire + localStorage) pour un affichage instantané et une
// seule requête par jour, quel que soit le filtre choisi.
const releasesCache = makeCache("mpl_releases_", 24 * 60 * 60 * 1000);
const CACHE_KEY = "upcoming";

// Fenêtres de temps proposées en haut de la page.
const PERIODS = [
  { value: "today", label: "Aujourd'hui" },
  { value: "week", label: "Cette semaine" },
  { value: "month", label: "Ce mois-ci" },
  { value: "all", label: "À venir" },
];

const MS_DAY = 86400000;

// Minuit local d'une date (repère pour compter les jours pleins).
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Bornes [début, fin] (timestamps unix, en secondes) d'une période donnée.
function periodRange(period) {
  const today = startOfDay(new Date());
  const from = Math.floor(today.getTime() / 1000);
  if (period === "all") return { from, to: Infinity };

  const end = new Date(today);
  if (period === "today") {
    end.setDate(end.getDate() + 1);
  } else if (period === "week") {
    // Jusqu'à la fin de la semaine courante (dimanche soir).
    const dow = (today.getDay() + 6) % 7; // 0 = lundi
    end.setDate(end.getDate() + (7 - dow));
  } else {
    // month : jusqu'à la fin du mois courant.
    end.setMonth(end.getMonth() + 1, 1);
  }
  return { from, to: Math.floor(end.getTime() / 1000) };
}

// Libellé du compte à rebours pour un jour donné.
function countdownLabel(dayStart) {
  const diff = Math.round((dayStart - startOfDay(new Date())) / MS_DAY);
  if (diff <= 0) return "Aujourd'hui";
  if (diff === 1) return "Demain";
  if (diff < 7) return `Dans ${diff} jours`;
  if (diff < 30) return `Dans ${Math.round(diff / 7)} sem.`;
  return `Dans ${Math.round(diff / 30)} mois`;
}

// (Dé)sérialisation d'une sélection tri-état pour l'URL : "PS5,-PC" =
// inclure PS5, exclure PC (préfixe "-" = exclu).
function serializeSel(sel) {
  return Object.entries(sel)
    .map(([k, st]) => (st === "exclude" ? `-${k}` : k))
    .join(",");
}
function parseSel(str) {
  const out = {};
  for (const raw of (str || "").split(",")) {
    if (!raw) continue;
    if (raw[0] === "-") out[raw.slice(1)] = "exclude";
    else out[raw] = "include";
  }
  return out;
}

// Applique une sélection tri-état à la liste de valeurs d'un jeu (plateformes
// ou genres). Passe si : aucun exclu présent ET (aucun inclus défini OU au
// moins un inclus présent).
function passSelection(sel, values) {
  let hasInclude = false;
  let matchesInclude = false;
  for (const [key, state] of Object.entries(sel)) {
    const present = values.includes(key);
    if (state === "exclude") {
      if (present) return false;
    } else {
      hasInclude = true;
      if (present) matchesInclude = true;
    }
  }
  return !hasInclude || matchesInclude;
}

const fmtWeekday = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const fmtMonth = new Intl.DateTimeFormat("fr-FR", { month: "short" });

export default function Releases() {
  const { token } = useAuth();
  const { map } = useLibrary();
  const [searchParams, setSearchParams] = useSearchParams();

  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // État initialisé depuis l'URL : le retour arrière (après avoir ouvert un
  // jeu) restaure les filtres tels quels.
  const [period, setPeriod] = useState(
    () => searchParams.get("period") || "month"
  );
  const [wishlistOnly, setWishlistOnly] = useState(
    () => searchParams.get("wish") === "1"
  );
  // Filtres tri-état (côté client) : { valeur: "include" | "exclude" }.
  const [platformSel, setPlatformSel] = useState(() =>
    parseSel(searchParams.get("console"))
  );
  const [genreSel, setGenreSel] = useState(() =>
    parseSel(searchParams.get("genre"))
  );
  const [excludeAi, setExcludeAi] = useState(
    () => searchParams.get("ai") === "1"
  );

  // Reflète les filtres dans l'URL (remplace l'entrée courante, sans polluer
  // l'historique). Seules les valeurs non par défaut sont écrites.
  useEffect(() => {
    const next = new URLSearchParams();
    if (period !== "month") next.set("period", period);
    if (wishlistOnly) next.set("wish", "1");
    if (excludeAi) next.set("ai", "1");
    const c = serializeSel(platformSel);
    if (c) next.set("console", c);
    const g = serializeSel(genreSel);
    if (g) next.set("genre", g);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, wishlistOnly, excludeAi, platformSel, genreSel]);

  // Cycle au clic : neutre → inclure → exclure → neutre.
  const cycleIn = (setter) => (val) =>
    setter((cur) => {
      const next = { ...cur };
      if (!next[val]) next[val] = "include";
      else if (next[val] === "include") next[val] = "exclude";
      else delete next[val];
      return next;
    });

  // Une seule requête, mise en cache 24h. Le filtre wishlist se fait ensuite
  // côté client sur ces mêmes données (aucune requête supplémentaire).
  useEffect(() => {
    if (!token) return;
    let alive = true;

    // Cache présent → affichage instantané (sans spinner). Périmé → on
    // revalide en silence en arrière-plan.
    const cached = releasesCache.get(CACHE_KEY);
    if (cached) {
      setGames(cached.data);
      setLoading(false);
      if (cached.fresh) return;
    } else {
      setLoading(true);
    }
    setError(null);

    apiFetch("/games/releases", { token })
      .then((d) => {
        if (!alive) return;
        setGames(d.games || []);
        releasesCache.set(CACHE_KEY, d.games || []);
      })
      .catch((err) => alive && !cached && setError(err.message))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [token]);

  // Options de filtres dérivées des jeux chargés (uniquement les valeurs
  // réellement présentes dans le calendrier, triées).
  const platformOpts = useMemo(() => {
    const set = new Set();
    for (const g of games) for (const p of g.platforms || []) set.add(p);
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [games]);
  const genreOpts = useMemo(() => {
    const set = new Set();
    for (const g of games) for (const gg of g.genres || []) set.add(gg);
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [games]);

  const hasFilters =
    Object.keys(platformSel).length ||
    Object.keys(genreSel).length ||
    excludeAi;
  function resetFilters() {
    setPlatformSel({});
    setGenreSel({});
    setExcludeAi(false);
  }

  // Tous les filtres (wishlist, console, genre, IA) + période, puis
  // regroupement par jour de sortie.
  const groups = useMemo(() => {
    const { from, to } = periodRange(period);
    const byDay = new Map();
    for (const g of games) {
      if (!g.releaseDate) continue;
      if (g.releaseDate < from || g.releaseDate >= to) continue;
      if (wishlistOnly && map[g.id]?.status !== "wishlist") continue;
      if (excludeAi && g.ai) continue;
      if (!passSelection(platformSel, g.platforms || [])) continue;
      if (!passSelection(genreSel, g.genres || [])) continue;
      const dayStart = startOfDay(new Date(g.releaseDate * 1000)).getTime();
      if (!byDay.has(dayStart)) byDay.set(dayStart, []);
      byDay.get(dayStart).push(g);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dayStart, items]) => ({
        dayStart,
        // Les plus attendus en tête au sein d'une même journée.
        items: items.sort((a, b) => (b.hypes || 0) - (a.hypes || 0)),
      }));
  }, [games, period, wishlistOnly, map, excludeAi, platformSel, genreSel]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="releases">
      <header className="rel-hero">
        <span className="rel-hero-icon">
          <CalendarDays size={26} strokeWidth={2.2} />
        </span>
        <div>
          <h1 className="rel-title">
            Calendrier des <span className="grad-text">sorties</span>
          </h1>
          <p className="rel-sub">
            Les jeux à venir, jour après jour. Ne rate plus aucune sortie.
          </p>
        </div>
      </header>

      <div className="rel-toolbar">
        <div className="rel-periods" role="group" aria-label="Période">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              className={`rel-period clickable ${period === p.value ? "active" : ""}`}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="rel-actions">
          {hasFilters ? (
            <button className="rel-filter-clear clickable" onClick={resetFilters}>
              Effacer
            </button>
          ) : null}
          <MultiDropdown
            label="Console"
            options={platformOpts}
            selected={platformSel}
            onCycle={cycleIn(setPlatformSel)}
            onClear={() => setPlatformSel({})}
          />
          <MultiDropdown
            label="Genre"
            options={genreOpts}
            selected={genreSel}
            onCycle={cycleIn(setGenreSel)}
            onClear={() => setGenreSel({})}
          />
          <button
            className={`rel-ai-toggle clickable ${excludeAi ? "active" : ""}`}
            onClick={() => setExcludeAi((v) => !v)}
            title="Masquer les jeux utilisant du contenu généré par IA"
          >
            <span className="rel-ai-box">{excludeAi && <Check size={13} />}</span>
            Exclure AI Slop
          </button>
          <button
            className={`rel-wish clickable ${wishlistOnly ? "active" : ""}`}
            onClick={() => setWishlistOnly((v) => !v)}
            title="N'afficher que ma liste de souhaits"
          >
            <Bookmark size={16} fill={wishlistOnly ? "currentColor" : "none"} />
            Ma liste de souhaits
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rel-state">
          <Loader2 size={22} className="spin" /> Chargement des sorties…
        </div>
      ) : error ? (
        <div className="rel-state rel-error card">
          <AlertTriangle size={26} />
          <h3>Impossible de charger le calendrier</h3>
          <p>{error}</p>
        </div>
      ) : total === 0 ? (
        <div className="rel-state rel-empty">
          <CalendarX size={34} />
          <h3>
            {wishlistOnly
              ? "Aucune sortie prévue dans ta liste de souhaits"
              : "Aucune sortie sur cette période"}
          </h3>
          <p className="font-fun">
            {wishlistOnly
              ? "Ajoute des jeux à ta liste de souhaits pour les suivre ici."
              : "Essaie une autre période, comme « À venir »."}
          </p>
        </div>
      ) : (
        <div className="rel-timeline">
          {groups.map(({ dayStart, items }) => {
            const date = new Date(dayStart);
            const isToday = dayStart === startOfDay(new Date()).getTime();
            return (
              <section className="rel-day" key={dayStart}>
                <div className={`rel-day-badge ${isToday ? "today" : ""}`}>
                  <span className="rel-weekday">{fmtWeekday.format(date)}</span>
                  <span className="rel-daynum">{date.getDate()}</span>
                  <span className="rel-month">{fmtMonth.format(date)}</span>
                  <span className="rel-count">{countdownLabel(dayStart)}</span>
                </div>
                <div className="rel-grid">
                  {items.map((g) => (
                    <div
                      key={g.id}
                      className={`rel-card ${
                        map[g.id]?.status === "wishlist" ? "is-wish" : ""
                      }`}
                    >
                      {g.ai && (
                        <span className="rel-ai-tag" title="Contenu généré par IA">
                          <Sparkles size={11} /> IA
                        </span>
                      )}
                      <GameCard game={g} />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
