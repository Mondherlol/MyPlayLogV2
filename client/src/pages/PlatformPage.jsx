import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import {
  Loader2,
  ArrowLeft,
  Cpu,
  Gamepad2,
  Search,
  Trophy,
  Sparkles,
  ExternalLink,
  Layers,
  Library,
  ChevronRight,
  Star as StarIcon,
  CalendarDays,
  CalendarX,
  Factory,
  Boxes,
  Package,
  Building2,
  HardDrive,
  MemoryStick,
  MonitorPlay,
  Bookmark,
  Medal,
  Gem,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { apiFetch } from "../lib/api";
import { makeCache } from "../lib/cache";
import GameAddFan from "../components/GameAddFan";

// Cache stale-while-revalidate du profil console (par id).
const platformCache = makeCache("mpl_platform_", 30 * 60 * 1000);

const nf = new Intl.NumberFormat("fr-FR");

// Ventes en format compact : 117 200 000 → « 117 M ».
function fmtUnits(n) {
  if (n == null) return null;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",")} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
  return nf.format(n);
}

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

// Carte de jeu (vignette .relc standard de l'app).
function GameCard({ g }) {
  const navigate = useNavigate();
  const { map } = useLibrary();
  const inWish = map[g.gameId]?.status === "wishlist";
  const sub = [g.publisher, g.year].filter(Boolean).join(" · ");
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

function GenreTip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="pv-genre-tip">
      <span className="pv-dot" style={{ background: d.payload.fill }} />
      {d.name} · <strong>{Math.round((d.value / total) * 100)} %</strong>
    </div>
  );
}

// Donut des genres du catalogue.
function GenreDonut({ genres }) {
  const total = genres.reduce((s, g) => s + g.count, 0) || 1;
  const data = genres.map((g, i) => ({
    name: g.name,
    value: g.count,
    fill: GENRE_COLORS[i % GENRE_COLORS.length],
  }));
  return (
    <div className="pv-genre">
      <div className="pv-genre-donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<GenreTip total={total} />} cursor={false} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={2}
              cornerRadius={4}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pv-genre-center">
          <span className="pv-genre-cap">Genre nº1</span>
          <span className="pv-genre-top">{data[0]?.name}</span>
        </div>
      </div>
      <ul className="pv-genre-legend">
        {data.map((d) => (
          <li key={d.name}>
            <span className="pv-dot" style={{ background: d.fill }} />
            <span className="pv-genre-name">{d.name}</span>
            <strong>{Math.round((d.value / total) * 100)} %</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Tuile de statistique du bandeau (grand chiffre + label).
function Stat({ Icon, value, label, sub, title }) {
  if (value == null) return null;
  return (
    <div className="pv-stat" title={title}>
      <Icon size={16} className="pv-stat-ic" />
      <span className="pv-stat-val">{value}</span>
      <span className="pv-stat-lbl">{label}</span>
      {sub && <span className="pv-stat-sub">{sub}</span>}
    </div>
  );
}

export default function PlatformPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");
  const [logoBroken, setLogoBroken] = useState(false);
  const [shotBroken, setShotBroken] = useState(false);

  // Filtres de l'onglet Jeux
  const { map } = useLibrary();
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState(""); // recherche débattue (envoyée à IGDB)
  const [onlyMine, setOnlyMine] = useState(false);
  const [sort, setSort] = useState("popularity");

  // Grille de jeux paginée server-side (recherche + tri + scroll infini via IGDB,
  // au-delà des 500 du profil).
  const GPAGE = 48;
  const [gList, setGList] = useState([]);
  const [gOffset, setGOffset] = useState(0);
  const [gHasMore, setGHasMore] = useState(false);
  const [gLoading, setGLoading] = useState(false);
  const [gError, setGError] = useState(null);

  // Scroll infini : la sentinelle appelle la dernière version de loadMore (via
  // ref pour garder l'observer stable malgré les changements de dépendances).
  const observerRef = useRef(null);
  const loadMoreRef = useRef(() => {});
  const sentinelRef = useCallback((node) => {
    if (observerRef.current) observerRef.current.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && loadMoreRef.current(),
      { rootMargin: "800px" }
    );
    observerRef.current.observe(node);
  }, []);

  useEffect(() => {
    let alive = true;
    const cached = platformCache.get(String(id));
    if (cached) {
      setData(cached.data);
      setLoading(false);
    } else {
      // Pas de cache : on purge la console précédente pour que le loader plein
      // écran s'affiche (sinon on resterait figé sur l'ancienne fiche).
      setData(null);
      setLoading(true);
    }
    setError(null);
    setTab("overview");
    setLogoBroken(false);
    setShotBroken(false);
    window.scrollTo({ top: 0 });
    apiFetch(`/platforms/${id}/profile`, { token })
      .then((d) => {
        if (!alive) return;
        setData(d);
        platformCache.set(String(id), d);
      })
      .catch((e) => alive && !cached && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, token]);

  useEffect(() => {
    document.title = data?.profile?.name
      ? `${data.profile.name} — MyPlayLog`
      : "Console — MyPlayLog";
  }, [data]);

  // Débounce de la barre de recherche (évite une requête IGDB par frappe).
  useEffect(() => {
    const t = setTimeout(() => setQDeb(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  // (Re)charge la première page dès qu'on entre dans l'onglet Jeux ou qu'un
  // filtre change (console, recherche, tri, « Ma biblio »).
  useEffect(() => {
    if (tab !== "games") return;
    let alive = true;
    setGList([]);
    setGOffset(0);
    setGHasMore(false);
    setGError(null);
    setGLoading(true);
    // « Ma biblio » : on envoie les ids possédés (la map biblio du client) pour
    // que le serveur intersecte, plutôt que de filtrer une page partielle.
    const mineIds = onlyMine ? Object.keys(map).map(Number) : undefined;
    apiFetch(`/platforms/${id}/games`, {
      method: "POST",
      token,
      body: { q: qDeb, sort, offset: 0, limit: GPAGE, mineIds },
    })
      .then((d) => {
        if (!alive) return;
        setGList(d.games || []);
        setGOffset(d.games?.length || 0);
        setGHasMore(!!d.hasMore);
      })
      .catch((e) => alive && setGError(e.message))
      .finally(() => alive && setGLoading(false));
    return () => {
      alive = false;
    };
    // `map` volontairement hors deps : on capte les ids au moment du fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tab, qDeb, sort, onlyMine, token]);

  // Page suivante (scroll infini). Inactif en mode « Ma biblio » (tout est déjà là).
  const loadMore = useCallback(() => {
    if (gLoading || !gHasMore || onlyMine) return;
    setGLoading(true);
    apiFetch(`/platforms/${id}/games`, {
      method: "POST",
      token,
      body: { q: qDeb, sort, offset: gOffset, limit: GPAGE },
    })
      .then((d) => {
        setGList((prev) => [...prev, ...(d.games || [])]);
        setGOffset((o) => o + (d.games?.length || 0));
        setGHasMore(!!d.hasMore);
      })
      .catch(() => {})
      .finally(() => setGLoading(false));
  }, [id, token, qDeb, sort, gOffset, gLoading, gHasMore, onlyMine]);
  loadMoreRef.current = loadMore;

  const games = data?.games || [];

  // Jeux phares = les EXCLUSIVITÉS (sorties uniquement ici), classées par
  // popularité — c'est ce qui définit vraiment la console. Repli sur les jeux
  // « débutés ici » puis la popularité brute si trop peu d'exclus.
  const byPop = (a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0);
  // Un jeu « notable » laisse une trace critique/publique. IGDB compte comme
  // mono-plateforme quantité de homebrew / titres eShop obscurs (sans note ni
  // avis) : sans ce filtre ils polluent les « exclus » et évincent les vrais
  // jeux emblématiques de la console.
  const isNotable = (g) => g.rating != null || (g.ratingCount ?? 0) >= 5;
  const exclusives = useMemo(
    () => games.filter((g) => g.exclusive && isNotable(g)).sort(byPop),
    [games]
  );
  const debuts = useMemo(
    () => games.filter((g) => g.debut && isNotable(g)).sort(byPop),
    [games]
  );
  const flagship = useMemo(() => {
    if (exclusives.length >= 3) return exclusives;
    if (debuts.length >= 3) return debuts;
    // Repli : les jeux les plus populaires de la console, tout court.
    return [...games].sort(byPop);
  }, [games, exclusives, debuts]);
  const flagshipKind =
    exclusives.length >= 3 ? "exclu" : debuts.length >= 3 ? "debut" : null;
  const topRated = useMemo(
    () =>
      [...games]
        .filter((g) => g.rating != null && (g.ratingCount ?? 0) >= 5)
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
        .slice(0, 8),
    [games]
  );

  if (loading && !data)
    return (
      <div className="pv-loading">
        <Loader2 size={22} className="spin" /> Chargement de la console…
      </div>
    );
  if (error)
    return (
      <div className="pv">
        <button className="pv-back clickable" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Retour
        </button>
        <div className="profile-empty font-fun">{error}</div>
      </div>
    );
  if (!data) return null;

  const { profile, stats } = data;
  const units = fmtUnits(profile.unitsSold);
  const heroImg = profile.image;
  const mosaic = flagship.slice(0, 8).map((g) => g.cover).filter(Boolean);

  return (
    <div className="pv">
      <button className="pv-back clickable" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} /> Retour
      </button>

      {/* ---------- Hero cinématique ---------- */}
      <header className="pv-hero">
        <div className="pv-hero-bg">
          {heroImg ? (
            <img src={heroImg} alt="" aria-hidden="true" />
          ) : (
            <div className="pv-hero-mosaic">
              {mosaic.map((c, i) => (
                <img src={c} alt="" key={i} aria-hidden="true" />
              ))}
            </div>
          )}
          <div className="pv-hero-veil" />
        </div>

        <div className="pv-hero-inner">
          <div className="pv-hero-text">
            <span className="pv-badge">
              {[profile.family, profile.generation && `${profile.generation}ᵉ génération`]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {profile.logo && !logoBroken ? (
              <>
                {/* Plaque claire : les logos plateforme IGDB sont souvent noirs
                    détourés (illisibles sur le hero sombre sinon). */}
                <span className="pv-hero-logo-plate">
                  <img
                    className="pv-hero-logo"
                    src={profile.logo}
                    alt={profile.name}
                    onError={() => setLogoBroken(true)}
                  />
                </span>
                <h1 className="pv-hero-name sr">{profile.name}</h1>
              </>
            ) : (
              <h1 className="pv-hero-name">{profile.name}</h1>
            )}
            {profile.manufacturer && (
              <span className="pv-hero-maker">
                <Factory size={14} /> {profile.manufacturer}
              </span>
            )}
            <div className="pv-hero-actions">
              {profile.wikiUrl && (
                <a
                  className="pv-wiki clickable"
                  href={profile.wikiUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} /> Wikipédia
                </a>
              )}
            </div>
          </div>

          {heroImg && !shotBroken && (
            <div className="pv-hero-shot">
              <span className="pv-hero-glow" aria-hidden="true" />
              <img src={heroImg} alt="" onError={() => setShotBroken(true)} />
            </div>
          )}
        </div>
      </header>

      {/* ---------- Bandeau de stats ---------- */}
      <div className="pv-statband">
        <Stat Icon={CalendarDays} value={profile.releaseYear} label="Sortie" />
        <Stat Icon={Boxes} value={profile.generation ? `${profile.generation}ᵉ` : null} label="Génération" />
        <Stat Icon={Package} value={units} label="Unités vendues" sub={profile.unitsSoldYear || null} />
        <Stat Icon={Gamepad2} value={nf.format(stats.total)} label="Jeux répertoriés" />
        <Stat
          Icon={CalendarX}
          value={profile.discontinuedDate ? new Date(profile.discontinuedDate).getFullYear() : null}
          label="Fin de production"
        />
        <Stat
          Icon={Gem}
          value={stats.exclusives ? nf.format(stats.exclusives) : null}
          label="Exclusivités"
          title="Jeux sortis uniquement sur cette plateforme (total IGDB)"
        />
      </div>

      {/* ---------- Onglets ---------- */}
      <nav className="pv-tabs">
        <button
          className={`pv-tab clickable ${tab === "overview" ? "active" : ""}`}
          onClick={() => setTab("overview")}
        >
          Aperçu
        </button>
        <button
          className={`pv-tab clickable ${tab === "games" ? "active" : ""}`}
          onClick={() => setTab("games")}
        >
          Jeux <span className="pv-tab-count">{nf.format(stats.total)}</span>
        </button>
      </nav>

      {/* ---------- Aperçu ---------- */}
      {tab === "overview" && (
        <div className="pv-overview">
          {flagship.length > 0 && (
            <section className="pv-section">
              <div className="pv-sec-head">
                <h2>
                  <Trophy size={15} /> Jeux phares
                  {flagshipKind === "exclu" && <span className="pv-sec-hint">exclusivités</span>}
                  {flagshipKind === "debut" && (
                    <span className="pv-sec-hint">sortis d'abord ici</span>
                  )}
                </h2>
                <button className="pv-more clickable" onClick={() => setTab("games")}>
                  Tout voir <ChevronRight size={14} />
                </button>
              </div>
              <div className="pv-strip">
                {flagship.slice(0, 12).map((g) => (
                  <GameCard key={g.gameId} g={g} />
                ))}
              </div>
            </section>
          )}

          <div className="pv-cols">
            {profile.genres?.length > 1 && (
              <section className="pv-section pv-panel">
                <h2 className="pv-panel-h">Genres phares</h2>
                <GenreDonut genres={profile.genres} />
              </section>
            )}

            {profile.publishers?.length > 0 && (
              <section className="pv-section pv-panel">
                <h2 className="pv-panel-h">
                  <Building2 size={14} /> Gros éditeurs
                </h2>
                <div className="pv-pub-grid">
                  {profile.publishers.slice(0, 8).map((p) => (
                    <button
                      key={p.name}
                      className="pv-pub-card clickable"
                      onClick={() => navigate(`/company/${encodeURIComponent(p.name)}`)}
                      title={`${p.name} · ${nf.format(p.count)} jeu${p.count > 1 ? "x" : ""}`}
                    >
                      <span className="pv-pub-logo">
                        {p.logo ? (
                          <img src={p.logo} alt={p.name} loading="lazy" />
                        ) : (
                          <span className="pv-pub-initial">{p.name}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          {profile.versions?.length > 0 && (
            <section className="pv-section">
              <div className="pv-sec-head">
                <h2>
                  <Boxes size={15} /> Modèles & révisions
                </h2>
              </div>
              <div className="pv-strip pv-ver-strip">
                {profile.versions.map((v) => {
                  const specs = [
                    v.cpu && { Icon: Cpu, label: "CPU", value: v.cpu },
                    v.memory && { Icon: MemoryStick, label: "RAM", value: v.memory },
                    v.storage && { Icon: HardDrive, label: "Stockage", value: v.storage },
                    v.os && { Icon: MonitorPlay, label: "Système", value: v.os },
                  ].filter(Boolean);
                  // Photo du modèle (Commons) ; repli sur la photo canonique de
                  // la console (Wikipedia) pour le modèle de base.
                  const vimg = v.image || (heroImg && !shotBroken ? heroImg : null);
                  return (
                    <div className={`pv-ver ${specs.length ? "has-specs" : ""}`} key={v.name}>
                      <div className="pv-ver-vis">
                        {vimg ? (
                          <img className="pv-ver-photo" src={vimg} alt={v.name} loading="lazy" />
                        ) : v.logo ? (
                          <span className="pv-ver-logo-plate">
                            <img className="pv-ver-logo-big" src={v.logo} alt={v.name} loading="lazy" />
                          </span>
                        ) : (
                          <Cpu size={38} className="pv-ver-fallback" />
                        )}
                        {v.logo && vimg && (
                          <span className="pv-ver-badge">
                            <img src={v.logo} alt="" loading="lazy" />
                          </span>
                        )}
                        {v.base && <span className="pv-ver-def">Par défaut</span>}
                        {specs.length > 0 && (
                          <div className="pv-ver-specs">
                            {specs.map((s) => (
                              <span key={s.label}>
                                <s.Icon size={13} />
                                <em>{s.label}</em>
                                {s.value}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="pv-ver-foot">
                        <b>{v.name}</b>
                        {v.year && <span>{v.year}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {topRated.length > 0 && (
            <section className="pv-section">
              <div className="pv-sec-head">
                <h2>
                  <Medal size={15} /> Les mieux notés
                </h2>
              </div>
              <ol className="pv-lead">
                {topRated.map((g, i) => (
                  <li
                    key={g.gameId}
                    className={`pv-lead-row clickable ${i < 3 ? "top3" : ""}`}
                    onClick={() => navigate(`/game/${g.gameId}`)}
                  >
                    <span className="pv-lead-rank">{i + 1}</span>
                    <span className="pv-lead-cover">
                      {g.cover ? (
                        <img src={g.cover} alt="" loading="lazy" />
                      ) : (
                        <Gamepad2 size={18} />
                      )}
                    </span>
                    <span className="pv-lead-info">
                      <span className="pv-lead-name">{g.name}</span>
                      {g.year && <span className="pv-lead-year">{g.year}</span>}
                    </span>
                    <span className="pv-lead-note" style={{ "--c": noteColor(g.rating) }}>
                      <svg viewBox="0 0 40 40" className="pv-lead-ring">
                        <circle cx="20" cy="20" r="16" className="pv-lead-track" />
                        <circle
                          cx="20"
                          cy="20"
                          r="16"
                          className="pv-lead-arc"
                          strokeDasharray={2 * Math.PI * 16}
                          strokeDashoffset={2 * Math.PI * 16 * (1 - g.rating / 100)}
                        />
                      </svg>
                      <b>{g.rating}</b>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {profile.related?.length > 0 && (
            <section className="pv-section">
              <div className="pv-sec-head">
                <h2>
                  <Layers size={15} /> Même famille
                </h2>
              </div>
              <div className="pv-fam">
                {profile.related.map((r) => (
                  <button
                    key={r.platformId}
                    className="pv-fam-item clickable"
                    onClick={() => navigate(`/platform/${r.platformId}`)}
                    title={r.name}
                  >
                    <span className="pv-fam-logo">
                      {r.logo ? <img src={r.logo} alt="" loading="lazy" /> : <Cpu size={20} />}
                    </span>
                    <span className="pv-fam-name">{r.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ---------- Jeux ---------- */}
      {tab === "games" && (
        <div className="pv-games">
          <div className="pv-filters">
            <div className="pv-search">
              <Search size={15} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher un jeu…"
              />
            </div>
            <button
              className={`pv-toggle clickable ${onlyMine ? "active" : ""}`}
              onClick={() => setOnlyMine((v) => !v)}
            >
              <Library size={14} /> Ma biblio
            </button>
            <select
              className="pv-sort clickable"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="popularity">Populaires</option>
              <option value="rating">Mieux notés</option>
              <option value="year">Plus récents</option>
              <option value="name">A → Z</option>
            </select>
          </div>

          {!onlyMine && !qDeb && stats.total > 0 && (
            <p className="pv-games-note">
              {nf.format(stats.total)} jeux au catalogue.
            </p>
          )}

          {gError ? (
            <p className="pv-empty font-fun">{gError}</p>
          ) : gList.length ? (
            <>
              <div className="pv-grid">
                {gList.map((g) => (
                  <GameCard key={g.gameId} g={g} />
                ))}
              </div>
              {gHasMore && (
                <div ref={sentinelRef} className="pv-sentinel">
                  <Loader2 size={18} className="spin" />
                </div>
              )}
            </>
          ) : gLoading ? (
            <div className="pv-sentinel">
              <Loader2 size={18} className="spin" />
            </div>
          ) : (
            <p className="pv-empty font-fun">
              <Sparkles size={16} /> Aucun jeu ne correspond à ces filtres.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Couleur de la note critique (rouge → ambre → vert).
function noteColor(v) {
  if (v == null) return "var(--text-soft)";
  return v < 60 ? "#e0483f" : v < 80 ? "#f2b70b" : "#22a35a";
}
