import { useEffect, useState } from "react";
import {
  Loader2,
  Swords,
  RefreshCw,
  Trophy,
  Crown,
  Gamepad2,
  Clock,
  Target,
  Sword,
  ExternalLink,
  ChevronDown,
  Flame,
  Users,
  X,
  History,
  TrendingUp,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { timeAgo } from "../lib/lists";

// Onglet « Tracking » du profil — vue League of Legends. Données officielles
// Riot (rang Solo/Flex, champions maîtrisés, dernières parties), synchronisées
// automatiquement côté serveur. Consultable publiquement (profils partageables).
// Le propriétaire peut forcer une actualisation, mais ce n'est pas nécessaire.

const C_GREEN = "#1b9d55";
const C_GOLD = "#eaa908";
const C_RED = "#d8524a";
const winColor = (pct) => (pct >= 55 ? C_GREEN : pct >= 45 ? C_GOLD : C_RED);
const kdaColor = (k) => (k >= 4 ? C_GREEN : k >= 2.5 ? C_GOLD : C_RED);

// K/D/A coloré par position : éliminations (vert), morts (rouge), assists (bleu).
function KDA({ k, d, a }) {
  return (
    <span className="lol-kda-parts">
      <b className="k">{k}</b>
      <i>/</i>
      <b className="d">{d}</b>
      <i>/</i>
      <b className="a">{a}</b>
    </span>
  );
}

// Ordinal FR d'un classement (1 -> « 1er », 2 -> « 2e »…).
const ordinal = (n) => (n === 1 ? "1er" : `${n}e`);

// Pastille de perf : MVP (meilleur gagnant) / ACE (meilleur perdant) / classement.
function PerfBadge({ badge, place, className = "" }) {
  if (badge === "mvp")
    return <span className={`lol-perf mvp ${className}`}>MVP</span>;
  if (badge === "ace")
    return <span className={`lol-perf ace ${className}`}>ACE</span>;
  if (place) return <span className={`lol-perf place ${className}`}>{ordinal(place)}</span>;
  return null;
}

// Classe de couleur du badge de file (aligne LoL sur les variantes Marvel).
function queueClass(mode) {
  const m = String(mode || "");
  if (/^Class/i.test(m)) return "comp";
  if (/ARAM/i.test(m)) return "arcade";
  if (/URF|One for All|Nexus|Arena/i.test(m)) return "event";
  if (/Normale|Rapide|Draft|Aveugle/i.test(m)) return "quick";
  return "custom";
}

// Emblème de rang avec repli propre si l'image (Community Dragon) échoue.
function RankEmblem({ src, size = 54 }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className="lol-rank-emblem fb" style={{ width: size, height: size }}>
        <Crown size={size * 0.5} />
      </span>
    );
  }
  // Les PNG Community Dragon sont en 1280×720 avec le blason minuscule (~25 %)
  // centré dans un cadre vide : on recadre via un conteneur `overflow:hidden`
  // et on agrandit l'image pour que le blason remplisse la pastille.
  return (
    <span className="lol-rank-emblem" style={{ width: size, height: size }}>
      <img
        className="lol-rank-emblem-img"
        src={src}
        alt=""
        onError={() => setBroken(true)}
      />
    </span>
  );
}

// Jauge circulaire (identique à la vue Marvel pour la cohérence visuelle).
function Ring({ pct, color, size = 108, stroke = 9, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pct / 100)));
  const mid = size / 2;
  return (
    <div className="trk-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle className="trk-ring-bg" cx={mid} cy={mid} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="trk-ring-fg"
          cx={mid}
          cy={mid}
          r={r}
          strokeWidth={stroke}
          fill="none"
          stroke={color}
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          transform={`rotate(-90 ${mid} ${mid})`}
        />
      </svg>
      <div className="trk-ring-center">{children}</div>
    </div>
  );
}

function Metric({ Icon, label, value, color }) {
  return (
    <div className="trk-metric">
      <span className="trk-metric-ic">
        <Icon size={15} />
      </span>
      <span className="trk-metric-lbl">{label}</span>
      <span className="trk-metric-val" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

// Carte d'un rang (Solo/Duo ou Flexible) façon op.gg : bandeau de file, gros
// emblème, palier + LP, bilan V/D + winrate, et une ligne « pic » (notre
// historique maison) quand le sommet dépasse le rang courant.
function RankCard({ r, peak }) {
  const total = r.wins + r.losses;
  const queueTitle =
    r.queue === "solo" ? "Classé en Solo/Duo" : "Classé en Flexible";
  const showPeak = peak && (peak.value || 0) > (r.value || 0);
  return (
    <div className={`lol-rank ${r.queue}`}>
      <div className="lol-rank-top">
        <span className="lol-rank-queue">{queueTitle}</span>
        {r.hotStreak && (
          <span className="lol-hot" title="En série de victoires">
            <Flame size={12} /> Série
          </span>
        )}
      </div>
      <div className="lol-rank-main">
        <RankEmblem src={r.emblem} size={76} />
        <div className="lol-rank-info">
          <span className="lol-rank-tier">{r.label}</span>
          <span className="lol-rank-lp">{r.lp} LP</span>
        </div>
        {total > 0 && (
          <div className="lol-rank-record">
            <span className="lol-rank-wl">
              <b className="win">{r.wins}V</b> <b className="loss">{r.losses}D</b>
            </span>
            <span className="lol-rank-wr" style={{ color: winColor(r.winRate) }}>
              {r.winRate}%
            </span>
          </div>
        )}
      </div>
      {showPeak && (
        <div className="lol-rank-peak">
          <TrendingUp size={13} />
          <span>
            Pic&nbsp;: <b>{peak.label}</b>
            {peak.lp ? ` · ${peak.lp} LP` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

// Historique des saisons passées (backfill op.gg à la liaison). Tableau compact
// : saison, emblème, palier, LP de fin de saison. Masqué si aucune donnée.
function SeasonHistory({ seasons }) {
  if (!seasons?.length) return null;
  return (
    <section className="trk-section">
      <h4 className="trk-section-title">
        <History size={15} /> Historique des saisons
      </h4>
      <div className="lol-seasons">
        {seasons.map((s) => (
          <div className="lol-season" key={s.season}>
            <span className="lol-season-name">{s.season}</span>
            <RankEmblem src={s.image} size={26} />
            <span className="lol-season-tier">{s.label}</span>
            <span className="lol-season-lp">{s.lp} LP</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// Scoreboard léger d'une partie (deux équipes de 5), déplié à la demande.
function MatchScoreboard({ teams }) {
  if (!teams?.length) return null;
  return (
    <div className="lol-sb">
      {teams.map((t) => (
        <div key={t.teamId} className={`lol-sb-team ${t.win ? "win" : "loss"}`}>
          <div className="lol-sb-head">
            <span>{t.teamId === 100 ? "Équipe bleue" : "Équipe rouge"}</span>
            <span className={t.win ? "win" : "loss"}>
              {t.win ? "Victoire" : "Défaite"}
            </span>
          </div>
          <ul className="lol-sb-list">
            {t.players.map((p, i) => (
              <li key={i} className={`lol-sb-row ${p.me ? "me" : ""}`}>
                <span className="lol-sb-champ">
                  {p.thumb ? (
                    <img src={p.thumb} alt="" loading="lazy" />
                  ) : (
                    <span className="lol-sb-champ-fb">{(p.champ || "?")[0]}</span>
                  )}
                </span>
                <span className="lol-sb-name">{p.name}</span>
                <PerfBadge badge={p.badge} place={p.place} className="sb" />
                <span className="lol-sb-kda">
                  <KDA k={p.k} d={p.d} a={p.a} />
                </span>
                <span className="lol-sb-cs">{p.cs} CS</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Carte d'une partie : en-tête cliquable + scoreboard dépliable.
function MatchCard({ m }) {
  const [open, setOpen] = useState(false);
  const mins = Math.floor((m.durationSec || 0) / 60);
  const secs = String((m.durationSec || 0) % 60).padStart(2, "0");
  const qClass = queueClass(m.mode);
  const outcome = m.remake ? "remake" : m.win ? "win" : "loss";
  return (
    <li className={`lol-match ${outcome} ${open ? "open" : ""}`}>
      <button
        className="lol-match-btn clickable"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="lol-match-champ">
          {m.hero?.thumb ? (
            <img src={m.hero.thumb} alt="" loading="lazy" />
          ) : (
            <span className="lol-match-champ-fb">{(m.champion || "?")[0]}</span>
          )}
          {m.championLevel > 0 && (
            <span className="lol-match-lvl">{m.championLevel}</span>
          )}
        </span>
        <span className="lol-match-main">
          <span className="lol-match-line1">
            <span className="lol-match-champ-name">{m.champion}</span>
            <span className={`trk-match-queue ${qClass}`}>{m.mode}</span>
            {!m.remake && <PerfBadge badge={m.myBadge} place={m.myPlace} />}
          </span>
          <span className="lol-match-line2">
            <span className="lol-match-kda">
              <KDA k={m.k} d={m.d} a={m.a} />
              <em style={{ color: kdaColor(m.kda) }}>{m.kda} KDA</em>
            </span>
            <span className="lol-match-cs">
              <Sword size={12} /> {m.cs} CS
              {m.csPerMin ? <i> ({m.csPerMin}/min)</i> : null}
            </span>
          </span>
        </span>
        <span className="lol-match-end">
          <span className={`lol-match-res ${outcome}`}>
            {m.remake ? (
              "Remake"
            ) : (
              <>
                {m.win ? <Trophy size={12} /> : <X size={12} />}
                {m.win ? "Victoire" : "Défaite"}
              </>
            )}
          </span>
          <span className="lol-match-meta">
            <span>
              {mins}:{secs}
            </span>
            <span>{timeAgo(m.playedAt)}</span>
          </span>
        </span>
        <ChevronDown size={16} className="lol-match-caret" />
      </button>
      {open && (
        <div className="lol-match-detail">
          <MatchScoreboard teams={m.teams} />
        </div>
      )}
    </li>
  );
}

// Taille d'une page « Voir plus » (le profil sert déjà les 12 récents du snapshot).
const MATCH_PAGE = 10;

export default function ProfileTrackerLoL({ username, token, isMe }) {
  const [state, setState] = useState({ loading: true });
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState(null);
  // Parties chargées EN PLUS des 12 du snapshot (pagination « Voir plus »).
  const [moreMatches, setMoreMatches] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false); // plus rien à charger

  async function load() {
    try {
      const d = await apiFetch(`/trackers/league-of-legends/${username}`, { token });
      setState({ loading: false, data: d });
    } catch (e) {
      setState({ loading: false, error: e.message });
    }
  }
  useEffect(() => {
    setState({ loading: true });
    setMoreMatches([]);
    setExhausted(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, token]);

  // Charge la page suivante de l'historique et l'ajoute (dédoublonnage par uid).
  async function loadMore() {
    if (loadingMore || exhausted) return;
    setLoadingMore(true);
    try {
      const base = state.data?.matches?.length || 0;
      const start = base + moreMatches.length;
      const d = await apiFetch(
        `/trackers/league-of-legends/${username}/matches?start=${start}&count=${MATCH_PAGE}`,
        { token }
      );
      const fresh = d.matches || [];
      if (fresh.length) {
        setMoreMatches((prev) => {
          const seen = new Set([
            ...(state.data?.matches || []),
            ...prev,
          ].map((m) => m.matchUid));
          return [...prev, ...fresh.filter((m) => !seen.has(m.matchUid))];
        });
      }
      if (fresh.length < MATCH_PAGE) setExhausted(true);
    } catch {
      setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setNote(null);
    setMoreMatches([]);
    setExhausted(false);
    try {
      const d = await apiFetch("/trackers/league-of-legends/refresh", {
        method: "POST",
        token,
      });
      if (d.cooldown) setNote("Patiente un instant avant de réactualiser.");
      setState((s) => ({ loading: false, data: { ...s.data, tracker: d.tracker } }));
      // Recharge les parties récentes (le snapshot a pu être resynchronisé).
      await load();
    } catch (e) {
      setNote(e.message || "Actualisation impossible pour le moment.");
    } finally {
      setRefreshing(false);
    }
  }

  if (state.loading) {
    return (
      <div className="lists-loading">
        <Loader2 size={20} className="spin" /> Chargement du tracking…
      </div>
    );
  }

  if (!state.data) {
    return (
      <div className="trk-note subtle" style={{ margin: "1rem 0" }}>
        Tracking momentanément indisponible — reviens dans quelques minutes.
      </div>
    );
  }

  const { tracker, matches = [], stale, game } = state.data;
  // Base (12 du snapshot) + pages « Voir plus », dédoublonnées par uid.
  const allMatches = (() => {
    const seen = new Set(matches.map((m) => m.matchUid));
    return [...matches, ...moreMatches.filter((m) => !seen.has(m.matchUid))];
  })();
  const snap = tracker?.snapshot;
  const overall = snap?.overall;
  const ranks = snap?.ranks || [];
  const champions = snap?.champions || [];
  // Historique classé : pic par file (maison) + saisons passées (op.gg).
  const rankHistory = tracker?.rankHistory || {};
  const peaks = rankHistory.peak || {};
  const seasons = rankHistory.seasons || [];

  return (
    <div className="trk">
      {/* En-tête */}
      <div className="trk-head">
        <div className="trk-head-id">
          {game?.cover ? (
            <img className="trk-head-cover" src={game.cover} alt="League of Legends" />
          ) : (
            <span className="trk-head-cover fb">
              <Swords size={22} />
            </span>
          )}
          <div className="trk-head-txt">
            <h3 className="trk-head-game">League of Legends</h3>
            <span className="trk-head-name">
              {tracker.externalName}
              {tracker.region && (
                <span className="lol-region-badge">
                  {String(tracker.region).toUpperCase()}
                </span>
              )}
              {tracker.profileUrl && (
                <a
                  href={tracker.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="trk-head-link clickable"
                  title="Voir sur op.gg"
                >
                  <ExternalLink size={13} />
                </a>
              )}
            </span>
          </div>
        </div>
        <div className="trk-head-actions">
          {isMe && (
            <button
              className="trk-refresh clickable"
              onClick={refresh}
              disabled={refreshing}
              title="Actualiser mes stats"
            >
              <RefreshCw size={15} className={refreshing ? "spin" : ""} />
              <span>Actualiser</span>
            </button>
          )}
        </div>
      </div>

      {note && <div className="trk-note">{note}</div>}
      {stale && !note && (
        <div className="trk-note subtle">
          Synchronisation automatique en cours en arrière-plan…
        </div>
      )}

      {!snap ? (
        <div className="trk-note subtle">
          Stats en cours de synchronisation — reviens dans quelques minutes.
        </div>
      ) : (
        <div className="trk-grid">
          {/* Colonne gauche */}
          <div className="trk-left">
            {/* Rangs Solo / Flex */}
            {ranks.length > 0 ? (
              <div className="lol-ranks">
                {ranks.map((r) => (
                  <RankCard key={r.queue} r={r} peak={peaks[r.queue]} />
                ))}
              </div>
            ) : (
              <div className="lol-rank unranked">
                <div className="lol-rank-main">
                  <RankEmblem src={null} size={76} />
                  <div className="lol-rank-info">
                    <span className="lol-rank-tier">Non classé</span>
                    <span className="lol-rank-lp">Aucune partie classée</span>
                  </div>
                </div>
              </div>
            )}

            {/* Historique des saisons (backfill op.gg) */}
            <SeasonHistory seasons={seasons} />

            {/* Jauges winrate + KDA (sur les parties récentes) */}
            {overall && overall.matches > 0 && (
              <div className="trk-gauges">
                <div className="trk-gauge">
                  <Ring pct={overall.winRate} color={winColor(overall.winRate)}>
                    <span className="trk-ring-val" style={{ color: winColor(overall.winRate) }}>
                      {overall.winRate}%
                    </span>
                    <span className="trk-ring-lbl">Winrate</span>
                  </Ring>
                  <span className="trk-gauge-sub">
                    <b className="win">{overall.wins}V</b> · <b className="loss">{overall.losses}D</b>
                  </span>
                </div>
                <div className="trk-gauge">
                  <Ring pct={Math.min(overall.kda / 6, 1) * 100} color={kdaColor(overall.kda)}>
                    <span className="trk-ring-val" style={{ color: kdaColor(overall.kda) }}>
                      {overall.kda}
                    </span>
                    <span className="trk-ring-lbl">KDA</span>
                  </Ring>
                  <span className="trk-gauge-sub">{overall.matches} parties</span>
                </div>
              </div>
            )}

            {/* Stats secondaires */}
            <div className="trk-metrics">
              {snap.level > 0 && (
                <Metric Icon={Gamepad2} label="Niveau d'invocateur" value={snap.level} />
              )}
              {overall?.csPerMin > 0 && (
                <Metric Icon={Sword} label="CS / min (récent)" value={overall.csPerMin} />
              )}
              {overall?.hoursRecent > 0 && (
                <Metric
                  Icon={Clock}
                  label="Temps de jeu récent"
                  value={`${overall.hoursRecent} h`}
                />
              )}
              {snap.masteryTotal > 0 && (
                <Metric
                  Icon={Trophy}
                  label="Points de maîtrise"
                  value={snap.masteryTotal.toLocaleString("fr-FR")}
                />
              )}
            </div>

            {/* Champions les plus joués */}
            {champions.length > 0 && (
              <section className="trk-section">
                <h4 className="trk-section-title">
                  <Target size={15} /> Champions les plus joués
                </h4>
                <div className="trk-heroes">
                  {champions.map((c) => (
                    <div className="trk-hero" key={c.id || c.name}>
                      <div className="trk-hero-thumb">
                        {c.thumb ? (
                          <img src={c.thumb} alt={c.name} loading="lazy" />
                        ) : (
                          <span className="trk-hero-fallback">{c.name[0]}</span>
                        )}
                      </div>
                      <div className="trk-hero-info">
                        <span className="trk-hero-name">
                          {c.name}
                          {c.mastery?.level > 0 && (
                            <span className="lol-champ-mastery" title="Niveau de maîtrise">
                              M{c.mastery.level}
                            </span>
                          )}
                          <span className="lol-champ-games">
                            {c.games} partie{c.games > 1 ? "s" : ""}
                          </span>
                        </span>
                        <span className="trk-hero-meta">
                          {c.avgK != null && (
                            <span className="lol-champ-kda">
                              <b>{c.avgK}</b> / <b className="d">{c.avgD}</b> / <b>{c.avgA}</b>
                            </span>
                          )}
                          <b style={{ color: kdaColor(c.kda) }}>{c.kda} KDA</b>
                          <span style={{ color: winColor(c.winRate) }}>{c.winRate}%</span>
                          {c.cs > 0 && <span className="lol-champ-cs">{c.cs} CS</span>}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Coéquipiers récurrents (« joué avec ») */}
            {snap.playedWith?.length > 0 && (
              <section className="trk-section">
                <h4 className="trk-section-title">
                  <Users size={15} /> Souvent avec
                </h4>
                <div className="lol-mates">
                  {snap.playedWith.map((mate) => (
                    <div className="lol-mate" key={mate.name}>
                      <span className="lol-mate-av">
                        {mate.thumb ? (
                          <img src={mate.thumb} alt="" loading="lazy" />
                        ) : (
                          (mate.name || "?")[0].toUpperCase()
                        )}
                      </span>
                      <span className="lol-mate-info">
                        <span className="lol-mate-name">{mate.name}</span>
                        <span className="lol-mate-meta">
                          {mate.games} parties ·{" "}
                          <span style={{ color: winColor(mate.winRate) }}>{mate.winRate}%</span>
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Colonne droite : dernières parties */}
          <div className="trk-right">
            <h4 className="trk-section-title">
              <Swords size={15} /> Dernières parties
            </h4>
            {allMatches.length > 0 ? (
              <>
                <ul className="lol-matches">
                  {allMatches.map((m) => (
                    <MatchCard key={m.matchUid} m={m} />
                  ))}
                </ul>
                {!exhausted && matches.length >= 12 && (
                  <button
                    className="trk-loadmore clickable"
                    onClick={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 size={15} className="spin" /> Chargement…
                      </>
                    ) : (
                      <>
                        <ChevronDown size={16} /> Voir plus de parties
                      </>
                    )}
                  </button>
                )}
              </>
            ) : (
              <div className="trk-note subtle">Aucune partie récente à afficher.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
