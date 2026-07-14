import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Loader2,
  Swords,
  RefreshCw,
  Trophy,
  Crown,
  Target,
  ShieldHalf,
  Crosshair,
  ExternalLink,
  ChevronDown,
  Gamepad2,
  Medal,
  MapPin,
  X,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { timeAgo } from "../lib/lists";
import MatchScoreboard from "./MatchScoreboard";

// Onglet « Tracking » du profil : stats in-game d'un compte lié (Marvel Rivals
// pour l'instant). Consultable publiquement (profils partageables). Le
// propriétaire peut forcer une actualisation. Dégradation gracieuse : si l'API
// externe est en panne, on sert le dernier instantané connu.

// Couleurs sémantiques des ratios (vert = bon, doré = correct, rouge = faible).
const C_GREEN = "#1b9d55";
const C_GOLD = "#eaa908";
const C_RED = "#d8524a";
const winColor = (pct) => (pct >= 55 ? C_GREEN : pct >= 45 ? C_GOLD : C_RED);
const kdaColor = (k) => (k >= 3 ? C_GREEN : k >= 2 ? C_GOLD : C_RED);

// File de la partie -> libellé FR + classe de couleur du badge.
const QUEUE_META = {
  comp: { label: "Classée", cls: "comp" },
  quick: { label: "Rapide", cls: "quick" },
  arcade: { label: "Arcade", cls: "arcade" },
  event: { label: "Événement", cls: "event" },
  custom: { label: "Perso", cls: "custom" },
};

// Icône du rôle (duelist / strategist / vanguard).
const ROLE_META = {
  duelist: { Icon: Crosshair, label: "Duelliste" },
  strategist: { Icon: ShieldHalf, label: "Stratège" },
  vanguard: { Icon: Target, label: "Avant-garde" },
};

// Numéro de saison à partir d'un libellé (« Season 8.5 » -> « 8.5 »).
const seasonNum = (label) => String(label || "").match(/([\d.]+)/)?.[1] || null;
// Libellé de saison francisé (« Season 6 » -> « Saison 6 »).
const frSeason = (label) => String(label || "").replace(/season/i, "Saison");

// Jauge circulaire (SVG) : anneau de fond + arc coloré selon le ratio.
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

// Sélecteur de saison custom : vignette de jaquette IGDB + libellé.
function SeasonPicker({ seasons, value, images, loading, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current = seasons.find((s) => s.value === value) || seasons[0];
  // Une saison « .5 » réutilise la jaquette de la saison entière (6.5 -> 6).
  const imgOf = (s) => {
    const n = seasonNum(s.label);
    if (!n) return null;
    return images?.[n] || images?.[String(Math.floor(Number(n)))] || null;
  };

  return (
    <div className="trk-season" ref={ref}>
      <button
        type="button"
        className="trk-season-btn clickable"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {loading ? (
          <Loader2 size={15} className="spin" />
        ) : imgOf(current) ? (
          <img className="trk-season-thumb" src={imgOf(current)} alt="" />
        ) : (
          <span className="trk-season-thumb fb">
            <Trophy size={13} />
          </span>
        )}
        <span className="trk-season-lbl">{frSeason(current?.label) || "Saison"}</span>
        <ChevronDown size={15} className={`trk-season-caret ${open ? "up" : ""}`} />
      </button>
      {open && (
        <ul className="trk-season-menu" role="listbox">
          {seasons.map((s) => (
            <li key={s.value}>
              <button
                type="button"
                role="option"
                aria-selected={s.value === value}
                className={`trk-season-opt clickable ${s.value === value ? "on" : ""}`}
                onClick={() => {
                  setOpen(false);
                  if (s.value !== value) onChange(s.value);
                }}
              >
                {imgOf(s) ? (
                  <img className="trk-season-thumb" src={imgOf(s)} alt="" loading="lazy" />
                ) : (
                  <span className="trk-season-thumb fb">
                    <Trophy size={12} />
                  </span>
                )}
                <span>{frSeason(s.label)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Carte d'un match : en-tête cliquable qui déplie le scoreboard EN LIGNE.
function MatchCard({ m, meUid, token }) {
  const [open, setOpen] = useState(false);
  const queue = m.queue ? QUEUE_META[m.queue] : null;
  const award = m.isMvp ? "mvp" : m.isSvp ? "svp" : null;
  // Vignette de map (125px) réutilisée en fond de carte, mais en plus grand.
  const bg = m.mapImage ? m.mapImage.replace("w_125", "w_360") : null;
  return (
    <li className={`trk-match ${m.win ? "win" : "loss"} ${open ? "open" : ""}`}>
      <button
        className={`trk-match-btn clickable ${bg ? "has-map" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={bg ? { backgroundImage: `url(${bg})` } : undefined}
      >
        <span className="trk-match-portrait">
          <span className="trk-match-cut">
            {m.hero?.thumb ? (
              <img src={m.hero.thumb} alt="" loading="lazy" />
            ) : (
              <span className="trk-match-hero-fb">{(m.hero?.name || "?")[0]}</span>
            )}
          </span>
          {award && (
            <span className={`trk-match-award ${award}`} title={award === "mvp" ? "MVP" : "SVP"}>
              {award === "mvp" ? <Crown size={11} /> : <Medal size={11} />}
              {award.toUpperCase()}
            </span>
          )}
        </span>
        <span className="trk-match-main">
          <span className="trk-match-line1">
            <span className="trk-match-hero-name">{m.hero?.name || "Héros"}</span>
            <span className={`trk-match-badge ${m.win ? "win" : "loss"}`}>
              {m.win ? <Trophy size={11} /> : <X size={11} />}
              {m.win ? "Victoire" : "Défaite"}
            </span>
          </span>
          <span className="trk-match-line2">
            <span className="trk-match-kda">
              <b className="k">{m.k}</b>
              <i>/</i>
              <b className="d">{m.d}</b>
              <i>/</i>
              <b className="a">{m.a}</b>
              <em style={{ color: kdaColor(m.kda) }}>{m.kda} KDA</em>
            </span>
            {m.map && (
              <span className="trk-match-map">
                <MapPin size={12} />
                <span>{m.map}</span>
              </span>
            )}
          </span>
        </span>
        <span className="trk-match-end">
          {m.score && (
            <span className={`trk-match-score ${m.win ? "win" : "loss"}`}>
              <b>{m.score.me}</b>
              <i>:</i>
              <span>{m.score.opp}</span>
            </span>
          )}
          <span className="trk-match-end-meta">
            {queue && <span className={`trk-match-queue ${queue.cls}`}>{queue.label}</span>}
            <span className="trk-match-time">{timeAgo(m.playedAt)}</span>
          </span>
        </span>
        <ChevronDown size={16} className="trk-match-caret" />
      </button>
      {open && (
        <div className="trk-match-detail">
          <MatchScoreboard match={m} meUid={meUid} token={token} />
        </div>
      )}
    </li>
  );
}

// Ligne de stat secondaire (icône + libellé + valeur).
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

export default function ProfileTrackers({ username, token, isMe }) {
  const [state, setState] = useState({ loading: true });
  const [season, setSeason] = useState(null); // null = saison courante (défaut serveur)
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState(null);

  async function load(seasonValue) {
    const q = seasonValue != null ? `?season=${seasonValue}` : "";
    try {
      const d = await apiFetch(`/trackers/marvel-rivals/${username}${q}`, { token });
      setState({ loading: false, data: d });
      if (season == null && d.season != null) setSeason(d.season);
    } catch (e) {
      setState({ loading: false, error: e.message, notLinked: /aucun compte/i.test(e.message) });
    }
  }
  useEffect(() => {
    setState({ loading: true });
    setSeason(null);
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, token]);

  async function changeSeason(value) {
    setSeason(value);
    setSeasonLoading(true);
    await load(value);
    setSeasonLoading(false);
  }

  async function refresh() {
    setRefreshing(true);
    setNote(null);
    try {
      const d = await apiFetch("/trackers/marvel-rivals/refresh", {
        method: "POST",
        token,
      });
      setState((s) => ({
        loading: false,
        data: { ...s.data, tracker: d.tracker, matches: d.matches || s.data?.matches },
      }));
      if (d.processing)
        setNote("Profil en cours de traitement chez Marvel Rivals — réactualise dans 2-5 min.");
      else if (d.cooldown) setNote("Patiente un instant avant de réactualiser.");
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

  // Pas de compte lié.
  if (state.notLinked || !state.data) {
    return (
      <div className="trk-empty card">
        <span className="trk-empty-ic">
          <Swords size={26} />
        </span>
        {isMe ? (
          <>
            <p className="font-fun">
              Relie ton compte Marvel Rivals pour suivre ton rang, tes héros et
              tes parties — et les partager ici.
            </p>
            <Link to="/settings" className="trk-cta clickable">
              <Swords size={16} /> Relier un compte
            </Link>
          </>
        ) : (
          <p className="font-fun">Ce joueur ne partage pas encore de tracking.</p>
        )}
      </div>
    );
  }

  const { tracker, matches = [], stale, seasons = [], game } = state.data;
  const snap = tracker?.snapshot;
  const rank = snap?.rank;
  const overall = snap?.overall;
  const heroes = snap?.heroes || [];
  const topRole = (snap?.roles || [])[0];
  const roleMeta = topRole ? ROLE_META[topRole.role] || { Icon: Swords, label: topRole.role } : null;

  return (
    <div className="trk">
      {/* En-tête : jaquette + jeu + pseudo + saison + actualiser */}
      <div className="trk-head">
        <div className="trk-head-id">
          {game?.cover ? (
            <img className="trk-head-cover" src={game.cover} alt="Marvel Rivals" />
          ) : (
            <span className="trk-head-cover fb">
              <Swords size={22} />
            </span>
          )}
          <div className="trk-head-txt">
            <h3 className="trk-head-game">Marvel Rivals</h3>
            <span className="trk-head-name">
              {tracker.externalName}
              {tracker.profileUrl && (
                <a
                  href={tracker.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="trk-head-link clickable"
                  title="Voir sur rivalsmeta"
                >
                  <ExternalLink size={13} />
                </a>
              )}
            </span>
          </div>
        </div>
        <div className="trk-head-actions">
          {seasons.length > 0 && (
            <SeasonPicker
              seasons={seasons}
              value={season ?? seasons[0]?.value}
              images={game?.seasons}
              loading={seasonLoading}
              onChange={changeSeason}
            />
          )}
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
          Stats synchronisées {snap?.updatedAt ? timeAgo(snap.updatedAt) : "récemment"}
          {" — rafraîchissement en cours en arrière-plan."}
        </div>
      )}

      {!snap ? (
        <div className="trk-note subtle">
          Stats momentanément indisponibles — reviens dans quelques minutes.
        </div>
      ) : (
        <div className="trk-grid">
          {/* Colonne gauche : rang + jauges + héros */}
          <div className="trk-left">
            {/* Carte rang */}
            <div className="trk-rankcard">
              {rank?.image ? (
                <img className="trk-rank-badge" src={rank.image} alt="" />
              ) : (
                <span className="trk-rank-badge fallback">
                  <Crown size={30} />
                </span>
              )}
              <div className="trk-rank-info">
                <span className="trk-rank-label">Rang actuel</span>
                <span className="trk-rank-tier">{rank?.tier || "Non classé"}</span>
                {rank?.score != null && (
                  <span className="trk-rank-score">
                    {rank.score.toLocaleString("fr-FR")} RS
                  </span>
                )}
                {snap.peak?.tier && (
                  <span className="trk-rank-peak">
                    {snap.peak.image ? (
                      <img className="trk-rank-peak-img" src={snap.peak.image} alt="" />
                    ) : (
                      <Trophy size={12} />
                    )}
                    Pic&nbsp;: <b>{snap.peak.tier}</b>
                  </span>
                )}
              </div>
            </div>

            {/* Jauges circulaires */}
            {overall && (
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
                  <Ring pct={Math.min(overall.kda / 5, 1) * 100} color={kdaColor(overall.kda)}>
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
            {overall && (
              <div className="trk-metrics">
                {overall.kd != null && (
                  <Metric Icon={Crosshair} label="Ratio K/D" value={overall.kd} color={kdaColor(overall.kd)} />
                )}
                {(overall.mvps > 0 || overall.svps > 0) && (
                  <Metric Icon={Medal} label="MVP / SVP" value={`${overall.mvps} / ${overall.svps}`} />
                )}
                {roleMeta && (
                  <Metric Icon={roleMeta.Icon} label="Rôle principal" value={roleMeta.label} />
                )}
                <Metric Icon={Gamepad2} label="Parties" value={overall.matches} />
              </div>
            )}

            {/* Top héros */}
            {heroes.length > 0 && (
              <section className="trk-section">
                <h4 className="trk-section-title">
                  <Crosshair size={15} /> Héros les plus joués
                </h4>
                <div className="trk-heroes">
                  {heroes.slice(0, 6).map((h) => (
                    <div className="trk-hero" key={h.id || h.name}>
                      <div className="trk-hero-thumb">
                        {h.thumb ? (
                          <img src={h.thumb} alt={h.name} loading="lazy" />
                        ) : (
                          <span className="trk-hero-fallback">{h.name[0]}</span>
                        )}
                      </div>
                      <div className="trk-hero-info">
                        <span className="trk-hero-name">{h.name}</span>
                        <span className="trk-hero-meta">
                          <b style={{ color: kdaColor(h.kda) }}>{h.kda}</b> KDA ·{" "}
                          <span style={{ color: winColor(h.winRate) }}>{h.winRate}%</span> · {h.matches} parties
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Colonne droite : dernières parties (cartes dépliables) */}
          <div className="trk-right">
            <h4 className="trk-section-title">
              <Swords size={15} /> Dernières parties
            </h4>
            {matches.length > 0 ? (
              <ul className="trk-matches">
                {matches.map((m) => (
                  <MatchCard key={m.matchUid} m={m} meUid={tracker.uid} token={token} />
                ))}
              </ul>
            ) : (
              <div className="trk-note subtle">Aucune partie récente à afficher.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
