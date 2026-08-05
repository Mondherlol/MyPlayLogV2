import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import {
  Loader2,
  ArrowLeft,
  Building2,
  Globe,
  CalendarDays,
  Search,
  Gamepad2,
  Users,
  BookOpen,
  Trophy,
  Sparkles,
  ExternalLink,
  Clapperboard,
  Layers,
  Library,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Star as StarIcon,
  X,
  TrendingUp,
  Cpu,
  CircleDot,
  Bookmark,
  PieChart as PieIcon,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { apiFetch } from "../lib/api";
import { makeCache } from "../lib/cache";
import GameAddFan from "../components/GameAddFan";

// Cache stale-while-revalidate du profil studio (par nom), comme les stats.
const companyCache = makeCache("mpl_company_", 30 * 60 * 1000);

const nf = new Intl.NumberFormat("fr-FR");

// Carte de jeu du catalogue studio — reprise des vignettes de la page Sorties
// (.relc) : jaquette épurée, « + » d'ajout rapide qui n'apparaît qu'au survol,
// liseré doré + marque-page si le jeu est en wishlist. Un clic ouvre la fiche.
function CompanyGameCard({ g }) {
  const navigate = useNavigate();
  const { map } = useLibrary();
  const inWish = map[g.gameId]?.status === "wishlist";
  const sub = [g.franchise, g.year].filter(Boolean).join(" · ");
  return (
    <div
      className={`relc clickable ${inWish ? "is-wish" : ""}`}
      onClick={() => navigate(`/game/${g.gameId}`)}
      title={g.name}
    >
      <span className="relc-cover">
        {g.cover ? (
          <img src={g.cover} alt="" loading="lazy" draggable="false" />
        ) : (
          <span className="relc-ph">
            <Gamepad2 size={22} />
          </span>
        )}
        {g.rating != null && (
          <span className="relc-hype" title="Note critique">
            <StarIcon size={11} fill="currentColor" strokeWidth={0} /> {g.rating}
          </span>
        )}
        {inWish && (
          <span className="relc-wishtag" title="Dans ta liste de souhaits">
            <Bookmark size={11} fill="currentColor" strokeWidth={0} />
          </span>
        )}
        <GameAddFan game={{ id: g.gameId, name: g.name, cover: g.cover }} hoverOnly />
      </span>
      <span className="relc-name">{g.name}</span>
      {sub && <span className="relc-plats">{sub}</span>}
    </div>
  );
}

// Anneau d'affinité : conic-gradient doré rempli à `value` %. Cliquable pour
// ouvrir le détail du calcul.
function AffinityRing({ value, onClick, size }) {
  const pct = value == null ? 0 : value;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      className={`cp-ring ${onClick ? "clickable" : ""} ${size === "lg" ? "lg" : ""}`}
      style={{ "--pct": pct }}
      onClick={onClick}
      title={onClick ? "Voir le détail du calcul" : undefined}
      aria-label={value == null ? "Affinité indisponible" : `${pct} % d'affinité`}
    >
      <span className="cp-ring-hole">
        {value == null ? (
          <span className="cp-ring-empty">—</span>
        ) : (
          <span className="cp-ring-val">
            <span className="cp-ring-num">{pct}</span>
            <span className="cp-ring-pct">%</span>
          </span>
        )}
      </span>
    </Tag>
  );
}

// Modale « nerd stats » : décompose le score d'affinité en ses trois
// ingrédients (couverture du catalogue, licences explorées, coups de cœur).
function AffinityModal({ detail, name, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal cp-aff-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">
          <TrendingUp size={20} /> Ton affinité avec {name}
        </h2>
        <div className="cp-aff-hero">
          <AffinityRing value={detail.score} size="lg" />
          <p className="cp-aff-intro">
            Ton score mélange trois signaux : la part de leur catalogue que tu
            possèdes, le nombre de leurs sagas que tu as touchées, et tes coups de
            cœur. Explorer plusieurs licences compte plus que finir l'une d'elles.
          </p>
        </div>
        <ul className="cp-aff-parts">
          {detail.parts.map((p) => (
            <li key={p.key}>
              <div className="cp-aff-part-head">
                <span className="cp-aff-part-label">{p.label}</span>
                <span className="cp-aff-part-pts">+{p.points}</span>
              </div>
              <div className="cp-aff-bar">
                <span style={{ width: `${Math.round(p.ratio * 100)}%` }} />
              </div>
              <div className="cp-aff-part-detail">
                {p.detail} · {Math.round(p.ratio * 100)} % × poids{" "}
                {Math.round(p.weight * 100)} %
              </div>
            </li>
          ))}
        </ul>
        <p className="cp-aff-total">
          <strong>{detail.score ?? "—"} %</strong> = somme des contributions
          ci-dessus (plafonnée à 100).
        </p>
      </div>
    </div>,
    document.body
  );
}

// Palette catégorielle (doré en tête, puis teintes distinctes lisibles clair/sombre)
const GENRE_COLORS = [
  "#c8920b",
  "#4e79a7",
  "#e15759",
  "#59a14f",
  "#b07aa1",
  "#ef8e3b",
  "#4ba6a2",
  "#9c755f",
];

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

// Tooltip du donut des genres
function GenreTip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="cp-genre-tip">
      <span className="cp-dot" style={{ background: d.payload.fill }} />
      {d.name} : <strong>{d.value}</strong> ·{" "}
      {Math.round((d.value / total) * 100)} %
    </div>
  );
}

// Donut « genres développés par le studio » (recharts) + légende.
function GenreDonut({ genres }) {
  const total = genres.reduce((s, g) => s + g.count, 0) || 1;
  const data = genres.map((g, i) => ({
    name: g.name,
    value: g.count,
    fill: GENRE_COLORS[i % GENRE_COLORS.length],
  }));
  return (
    <div className="cp-genre-wrap">
      <div className="cp-genre-donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<GenreTip total={total} />} cursor={false} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="60%"
              outerRadius="98%"
              paddingAngle={2}
              cornerRadius={3}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="cp-genre-center">
          <span className="cp-genre-total">{nf.format(total)}</span>
          <span className="cp-genre-cap">jeux</span>
        </div>
      </div>
      <ul className="cp-genre-legend">
        {data.map((d) => (
          <li key={d.name}>
            <span className="cp-dot" style={{ background: d.fill }} />
            {d.name}
            <strong>{Math.round((d.value / total) * 100)} %</strong>
          </li>
        ))}
      </ul>
    </div>
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
  // Favori studio + bio dépliable + modale d'affinité
  const [fav, setFav] = useState(false);
  const [favBusy, setFavBusy] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const [affOpen, setAffOpen] = useState(false);

  // Filtres de l'onglet Jeux
  const [q, setQ] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [roleF, setRoleF] = useState(
    params.get("role") === "pub" ? "publisher" : "all"
  );
  const [sort, setSort] = useState("popularity");

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
    if (data?.profile) setFav(!!data.profile.isFavorite);
  }, [data]);

  async function toggleFavorite() {
    if (favBusy) return;
    setFavBusy(true);
    setFav((v) => !v); // optimiste
    try {
      const r = await apiFetch(
        `/companies/${encodeURIComponent(decoded)}/favorite`,
        { method: "POST", token }
      );
      setFav(r.favorited);
      // Met à jour le cache local du profil studio
      if (data) {
        const next = { ...data, profile: { ...data.profile, isFavorite: r.favorited } };
        setData(next);
        companyCache.set(decoded, next);
      }
    } catch {
      setFav((v) => !v); // rollback
    } finally {
      setFavBusy(false);
    }
  }

  const games = data?.games || [];

  // Jeux phares = les plus populaires (nb d'avis) qu'ils ont DÉVELOPPÉS —
  // un jeu seulement édité au Japon ne fait pas l'identité du studio.
  const flagship = useMemo(
    () =>
      [...games]
        .filter((g) => g.role !== "publisher")
        .sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0)),
    [games]
  );
  const latest = useMemo(
    () => [...games].filter((g) => g.year).sort((a, b) => b.year - a.year),
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
    if (sort === "popularity")
      arr.sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0));
    else if (sort === "rating")
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
            <AffinityRing
              value={stats.affinity}
              onClick={stats.affinityDetail ? () => setAffOpen(true) : undefined}
            />
            <div className="cp-affinity-legend">
              <span className="cp-affinity-title">
                Ton affinité
                {stats.affinityDetail && (
                  <button
                    className="cp-affinity-info clickable"
                    onClick={() => setAffOpen(true)}
                    title="Détail du calcul"
                  >
                    <TrendingUp size={12} />
                  </button>
                )}
              </span>
              <span className="cp-affinity-sub">
                {stats.inLibrary
                  ? `${nf.format(stats.inLibrary)} jeu${stats.inLibrary > 1 ? "x" : ""} · ${nf.format(stats.affinityDetail?.franchisesTouched || 0)} licence${(stats.affinityDetail?.franchisesTouched || 0) > 1 ? "s" : ""}${stats.liked ? ` · ${nf.format(stats.liked)} favori${stats.liked > 1 ? "s" : ""}` : ""}`
                  : "Aucun de leurs jeux dans ta biblio"}
              </span>
              <button
                className={`cp-fav-btn clickable ${fav ? "on" : ""}`}
                onClick={toggleFavorite}
                disabled={favBusy}
                title={fav ? "Retirer des studios favoris" : "Ajouter aux studios favoris"}
              >
                <StarIcon size={15} fill={fav ? "currentColor" : "none"} />
                {fav ? "Favori" : "Suivre ce studio"}
              </button>
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
              <p className={`cp-bio-text ${bioOpen ? "open" : ""}`}>
                {profile.description}
              </p>
              {profile.description.length > 240 && (
                <button
                  className="cp-see-more clickable"
                  onClick={() => setBioOpen((v) => !v)}
                >
                  {bioOpen ? (
                    <>
                      Voir moins <ChevronUp size={14} />
                    </>
                  ) : (
                    <>
                      Voir plus <ChevronDown size={14} />
                    </>
                  )}
                </button>
              )}
            </section>
          )}

          <div className="cp-overview-side">
            <section className="cp-panel cp-facts">
              <h2 className="cp-panel-title">
                <Building2 size={16} /> Fiche
              </h2>
              <ul className="cp-fact-list">
                {profile.statusActive != null && (
                  <li>
                    <span className="cp-fact-key">
                      <CircleDot size={13} /> Statut
                    </span>
                    <span
                      className={`cp-fact-val cp-status ${profile.statusActive ? "on" : "off"}`}
                    >
                      <span className="cp-status-dot" />
                      {profile.statusActive ? "En activité" : "Plus en activité"}
                    </span>
                  </li>
                )}
                {(profile.startDate || profile.startYear) && (
                  <li>
                    <span className="cp-fact-key">
                      <CalendarDays size={13} /> Création
                    </span>
                    <span className="cp-fact-val">
                      {profile.startDate ? fmtDate(profile.startDate) : profile.startYear}
                    </span>
                  </li>
                )}
                {profile.country && (
                  <li>
                    <span className="cp-fact-key">
                      <Globe size={13} /> Pays
                    </span>
                    <span className="cp-fact-val">{profile.country}</span>
                  </li>
                )}
                {profile.employees && (
                  <li>
                    <span className="cp-fact-key">
                      <Users size={13} /> Effectif
                    </span>
                    <span className="cp-fact-val">
                      ≈ {nf.format(profile.employees)} employés
                      {profile.employeesYear ? ` (${profile.employeesYear})` : ""}
                    </span>
                  </li>
                )}
                {profile.engines?.length > 0 && (
                  <li className="cp-fact-engines">
                    <span className="cp-fact-key">
                      <Cpu size={13} /> Moteurs
                    </span>
                    <span className="cp-engine-chips">
                      {profile.engines.map((e) => (
                        <span className="cp-engine" key={e}>
                          {e}
                        </span>
                      ))}
                    </span>
                  </li>
                )}
              </ul>
            </section>
          </div>

          {profile.genres?.length > 1 && (
            <section className="cp-panel cp-wide">
              <h2 className="cp-panel-title">
                <PieIcon size={16} /> Genres de prédilection
              </h2>
              <GenreDonut genres={profile.genres} />
            </section>
          )}

          {profile.franchises?.length > 0 && (
            <section className="cp-panel cp-wide">
              <h2 className="cp-panel-title">
                <Layers size={16} /> Licences phares
              </h2>
              <div className="cp-lic-grid">
                {profile.franchises.map((f) => (
                  <button
                    key={f.name}
                    className="cp-lic clickable"
                    title={`${f.name} — ${f.count} jeux · filtrer`}
                    onClick={() => {
                      setQ(f.name);
                      setRoleF("all");
                      setTab("games");
                    }}
                  >
                    <span className="cp-lic-cover">
                      {f.cover ? (
                        <img src={f.cover} alt={f.name} loading="lazy" />
                      ) : (
                        <Layers size={22} />
                      )}
                    </span>
                    <span className="cp-lic-name">{f.name}</span>
                    <span className="cp-lic-count">
                      {nf.format(f.count)} jeu{f.count > 1 ? "x" : ""}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {flagship.length > 0 && (
            <section className="cp-panel cp-wide">
              <h2 className="cp-panel-title">
                <Trophy size={16} /> Jeux phares
                {flagship.length > 6 && (
                  <button
                    className="cp-panel-more clickable"
                    onClick={() => {
                      setRoleF("developer");
                      setSort("popularity");
                      setTab("games");
                    }}
                  >
                    Tout voir <ChevronRight size={14} />
                  </button>
                )}
              </h2>
              <div className="cp-cards">
                {flagship.slice(0, 6).map((g) => (
                  <CompanyGameCard key={g.gameId} g={g} />
                ))}
              </div>
            </section>
          )}

          {latest.length > 0 && (
            <section className="cp-panel cp-wide">
              <h2 className="cp-panel-title">
                <Clapperboard size={16} /> Dernières sorties
                {latest.length > 6 && (
                  <button
                    className="cp-panel-more clickable"
                    onClick={() => {
                      setRoleF("all");
                      setSort("year");
                      setTab("games");
                    }}
                  >
                    Tout voir <ChevronRight size={14} />
                  </button>
                )}
              </h2>
              <div className="cp-cards">
                {latest.slice(0, 6).map((g) => (
                  <CompanyGameCard key={g.gameId} g={g} />
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
              <option value="popularity">Populaires</option>
              <option value="rating">Mieux notés</option>
              <option value="year">Plus récents</option>
              <option value="name">A → Z</option>
            </select>
          </div>

          {filtered.length ? (
            <div className="cp-cards">
              {filtered.map((g) => (
                <CompanyGameCard key={g.gameId} g={g} />
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

      {affOpen && stats.affinityDetail && (
        <AffinityModal
          detail={stats.affinityDetail}
          name={profile.name}
          onClose={() => setAffOpen(false)}
        />
      )}
    </div>
  );
}
