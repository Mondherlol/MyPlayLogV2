import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  Loader2,
  ArrowLeft,
  Building2,
  Globe,
  CalendarDays,
  Heart,
  Star,
  Search,
  Gamepad2,
  Users,
  BookOpen,
  Trophy,
  Sparkles,
  ExternalLink,
  Library,
  Clapperboard,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { makeCache } from "../lib/cache";

// Cache stale-while-revalidate du profil studio (par nom), comme les stats.
const companyCache = makeCache("mpl_company_", 30 * 60 * 1000);

const nf = new Intl.NumberFormat("fr-FR");

const STATUS_LABEL = {
  playing: "En cours",
  finished: "Terminé",
  paused: "En pause",
  dropped: "Abandonné",
  endless: "Sans fin",
  wishlist: "À jouer",
};

// Anneau d'affinité : conic-gradient doré rempli à `value` %.
function AffinityRing({ value }) {
  const pct = value == null ? 0 : value;
  return (
    <div
      className="cp-ring"
      style={{ "--pct": `${pct}` }}
      role="img"
      aria-label={value == null ? "Affinité indisponible" : `${pct} % d'affinité`}
    >
      <div className="cp-ring-hole">
        {value == null ? (
          <span className="cp-ring-empty">—</span>
        ) : (
          <>
            <span className="cp-ring-num">{pct}</span>
            <span className="cp-ring-pct">%</span>
          </>
        )}
      </div>
    </div>
  );
}

// Carte de jeu (onglet Jeux + jeux phares) : jaquette + badges biblio.
function GameCard({ g }) {
  return (
    <Link to={`/game/${g.gameId}`} className="cp-game" title={g.name}>
      <div className="cp-game-cover">
        {g.cover ? (
          <img src={g.cover} alt={g.name} loading="lazy" />
        ) : (
          <span className="cp-game-ph">{g.name}</span>
        )}
        {g.rating != null && (
          <span className="cp-game-rating" title="Note critique">
            <Star size={10} fill="currentColor" /> {g.rating}
          </span>
        )}
        {g.mine?.favorite && (
          <span className="cp-game-fav" title="Coup de cœur">
            <Heart size={11} fill="currentColor" />
          </span>
        )}
        {g.mine && !g.mine.favorite && (
          <span className="cp-game-owned" title={STATUS_LABEL[g.mine.status]}>
            <Library size={11} />
          </span>
        )}
      </div>
      <span className="cp-game-name">{g.name}</span>
      <span className="cp-game-meta">
        {g.year || "—"}
        {g.mine?.rating != null && (
          <span className="cp-game-mynote" title="Ta note">
            · {g.mine.rating}
          </span>
        )}
      </span>
    </Link>
  );
}

export default function CompanyPage() {
  const { name } = useParams();
  const decoded = decodeURIComponent(name || "");
  const { token } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");

  // Filtres de l'onglet Jeux
  const [q, setQ] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [roleF, setRoleF] = useState(
    params.get("role") === "pub" ? "publisher" : "all"
  );
  const [sort, setSort] = useState("rating");

  useEffect(() => {
    let alive = true;
    const cached = companyCache.get(decoded);
    if (cached) {
      setData(cached.data);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    apiFetch(`/companies/${encodeURIComponent(decoded)}/profile`, { token })
      .then((d) => {
        if (!alive) return;
        setData(d);
        companyCache.set(decoded, d);
      })
      .catch((e) => alive && !cached && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [decoded, token]);

  useEffect(() => {
    document.title = data?.profile?.name
      ? `${data.profile.name} — MyPlayLog`
      : "Studio — MyPlayLog";
  }, [data]);

  const games = data?.games || [];

  const flagship = useMemo(
    () =>
      [...games]
        .filter((g) => g.rating != null)
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 6),
    [games]
  );
  const latest = useMemo(
    () =>
      [...games]
        .filter((g) => g.year)
        .sort((a, b) => b.year - a.year)
        .slice(0, 6),
    [games]
  );

  const filtered = useMemo(() => {
    let list = games;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((g) => g.name.toLowerCase().includes(needle));
    }
    if (onlyMine) list = list.filter((g) => g.mine);
    if (roleF !== "all")
      list = list.filter((g) => g.role === roleF || g.role === "both");
    const arr = [...list];
    if (sort === "rating")
      arr.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    else if (sort === "year") arr.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    else arr.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return arr;
  }, [games, q, onlyMine, roleF, sort]);

  if (loading && !data)
    return (
      <div className="lists-loading">
        <Loader2 size={20} className="spin" /> Chargement du studio…
      </div>
    );
  if (error)
    return (
      <div className="cp-wrap">
        <button className="cp-back clickable" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Retour
        </button>
        <div className="profile-empty font-fun">{error}</div>
      </div>
    );
  if (!data) return null;

  const { profile, stats } = data;
  const hasPeople = profile.people?.length > 0;

  return (
    <div className="cp-wrap">
      <button className="cp-back clickable" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} /> Retour
      </button>

      {/* ---------- En-tête ---------- */}
      <header className="cp-hero">
        {profile.image && (
          <div
            className="cp-hero-bg"
            style={{ backgroundImage: `url(${profile.image})` }}
          />
        )}
        <div className="cp-hero-inner">
          <div className="cp-hero-logo">
            {profile.logo ? (
              <img src={profile.logo} alt={profile.name} />
            ) : (
              <Building2 size={40} />
            )}
          </div>
          <div className="cp-hero-body">
            <h1 className="cp-hero-name">{profile.name}</h1>
            <div className="cp-hero-chips">
              {profile.country && (
                <span className="cp-chip">
                  <Globe size={13} /> {profile.country}
                </span>
              )}
              {profile.startYear && (
                <span className="cp-chip">
                  <CalendarDays size={13} /> Depuis {profile.startYear}
                </span>
              )}
              <span className="cp-chip">
                <Gamepad2 size={13} /> {nf.format(stats.total)} jeux
              </span>
              {profile.wikiUrl && (
                <a
                  className="cp-chip cp-chip-link"
                  href={profile.wikiUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={13} /> Wikipédia
                </a>
              )}
            </div>
          </div>
          <div className="cp-hero-affinity">
            <AffinityRing value={stats.affinity} />
            <div className="cp-affinity-legend">
              <span className="cp-affinity-title">Ton affinité</span>
              <span className="cp-affinity-sub">
                {stats.inLibrary
                  ? `${nf.format(stats.liked)} aimé${stats.liked > 1 ? "s" : ""} sur ${nf.format(stats.played)} joué${stats.played > 1 ? "s" : ""}`
                  : "Aucun de leurs jeux dans ta biblio"}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ---------- Onglets ---------- */}
      <nav className="cp-tabs">
        <button
          className={`cp-tab clickable ${tab === "overview" ? "active" : ""}`}
          onClick={() => setTab("overview")}
        >
          <BookOpen size={15} /> Aperçu
        </button>
        <button
          className={`cp-tab clickable ${tab === "games" ? "active" : ""}`}
          onClick={() => setTab("games")}
        >
          <Gamepad2 size={15} /> Jeux
          <span className="cp-tab-count">{nf.format(stats.total)}</span>
        </button>
        {hasPeople && (
          <button
            className={`cp-tab clickable ${tab === "people" ? "active" : ""}`}
            onClick={() => setTab("people")}
          >
            <Users size={15} /> Personnalités
            <span className="cp-tab-count">{profile.people.length}</span>
          </button>
        )}
      </nav>

      {/* ---------- Onglet Aperçu ---------- */}
      {tab === "overview" && (
        <div className="cp-overview">
          {profile.description && (
            <section className="cp-panel cp-bio">
              <h2 className="cp-panel-title">
                <BookOpen size={16} /> L'histoire
              </h2>
              <p className="cp-bio-text">{profile.description}</p>
              {profile.wikiUrl && (
                <a
                  className="cp-bio-more"
                  href={profile.wikiUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Lire la suite sur Wikipédia <ExternalLink size={12} />
                </a>
              )}
            </section>
          )}

          <div className="cp-overview-side">
            <section className="cp-panel cp-mini-stats">
              <div className="cp-mini">
                <span className="cp-mini-ico">
                  <Gamepad2 size={16} />
                </span>
                <span className="cp-mini-num">{nf.format(stats.total)}</span>
                <span className="cp-mini-lbl">jeux au catalogue</span>
              </div>
              <div className="cp-mini">
                <span className="cp-mini-ico">
                  <Library size={16} />
                </span>
                <span className="cp-mini-num">{nf.format(stats.inLibrary)}</span>
                <span className="cp-mini-lbl">dans ta biblio</span>
              </div>
              <div className="cp-mini">
                <span className="cp-mini-ico">
                  <Heart size={16} />
                </span>
                <span className="cp-mini-num">{nf.format(stats.liked)}</span>
                <span className="cp-mini-lbl">que tu aimes</span>
              </div>
            </section>
          </div>

          {flagship.length > 0 && (
            <section className="cp-panel cp-wide">
              <h2 className="cp-panel-title">
                <Trophy size={16} /> Jeux phares
              </h2>
              <div className="cp-game-grid">
                {flagship.map((g) => (
                  <GameCard key={g.gameId} g={g} />
                ))}
              </div>
            </section>
          )}

          {latest.length > 0 && (
            <section className="cp-panel cp-wide">
              <h2 className="cp-panel-title">
                <Clapperboard size={16} /> Dernières sorties
              </h2>
              <div className="cp-game-grid">
                {latest.map((g) => (
                  <GameCard key={g.gameId} g={g} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ---------- Onglet Jeux ---------- */}
      {tab === "games" && (
        <div className="cp-games-tab">
          <div className="cp-filters">
            <div className="cp-search">
              <Search size={15} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher un jeu…"
              />
            </div>
            <div className="cp-seg">
              <button
                className={`clickable ${roleF === "all" ? "active" : ""}`}
                onClick={() => setRoleF("all")}
              >
                Tous
              </button>
              <button
                className={`clickable ${roleF === "developer" ? "active" : ""}`}
                onClick={() => setRoleF("developer")}
              >
                Développés
              </button>
              <button
                className={`clickable ${roleF === "publisher" ? "active" : ""}`}
                onClick={() => setRoleF("publisher")}
              >
                Édités
              </button>
            </div>
            <button
              className={`cp-toggle clickable ${onlyMine ? "active" : ""}`}
              onClick={() => setOnlyMine((v) => !v)}
            >
              <Library size={14} /> Ma biblio
            </button>
            <select
              className="cp-sort clickable"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="rating">Mieux notés</option>
              <option value="year">Plus récents</option>
              <option value="name">A → Z</option>
            </select>
          </div>

          {filtered.length ? (
            <div className="cp-game-grid">
              {filtered.map((g) => (
                <GameCard key={g.gameId} g={g} />
              ))}
            </div>
          ) : (
            <p className="cp-empty font-fun">
              <Sparkles size={16} /> Aucun jeu ne correspond à ces filtres.
            </p>
          )}
        </div>
      )}

      {/* ---------- Onglet Personnalités ---------- */}
      {tab === "people" && hasPeople && (
        <div className="cp-people">
          {profile.people.map((p, i) => {
            const inner = (
              <>
                <div className="cp-person-photo">
                  {p.image ? (
                    <img src={p.image} alt={p.name} loading="lazy" />
                  ) : (
                    <span>{p.name?.[0]?.toUpperCase() || "?"}</span>
                  )}
                </div>
                <span className="cp-person-name">{p.name}</span>
                {p.role && <span className="cp-person-role">{p.role}</span>}
              </>
            );
            return p.url ? (
              <a
                key={i}
                className="cp-person clickable"
                href={p.url}
                target="_blank"
                rel="noreferrer"
              >
                {inner}
              </a>
            ) : (
              <div key={i} className="cp-person">
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
