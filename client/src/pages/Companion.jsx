// ======================================================================
//  Compagnon PC — ce qu'il a trouvé, ce qu'il a envoyé
// ======================================================================
//
// Le compagnon (application Windows) signale les jeux du PC, leurs succès et
// leur temps de jeu. RIEN n'arrive sur le profil sans passer par ici :
//
//   À valider    les jeux jamais vus (le jeu reconnu se corrige), et ce qui
//                attend pour les jeux déjà validés (mode manuel) ;
//   Historique   chaque envoi, appliqué, annulé ou refusé — tout s'annule et
//                tout se rétablit ;
//   Suivis       les jeux validés : corriger le jeu, ou tout retirer ;
//   Écartés      « pas un jeu » / « ne plus suivre » : se repropose.
//
// Le serveur fait foi (routes/companion.js, lib/companion.js) : chaque action
// recharge la page entière plutôt que de deviner l'état localement.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Clock,
  EyeOff,
  FolderOpen,
  Gamepad2,
  History,
  Inbox,
  Library,
  Loader2,
  Monitor,
  RefreshCw,
  RotateCcw,
  Trash2,
  Trophy,
  Undo2,
  X,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { GameSearchPicker } from "../components/PsnImportModal";

const STATUSES = [
  { key: "playing", label: "En cours" },
  { key: "finished", label: "Terminé" },
  { key: "paused", label: "En pause" },
  { key: "dropped", label: "Abandonné" },
  { key: "endless", label: "Sans fin" },
];

const TABS = [
  { key: "review", label: "À valider", Icon: Inbox },
  { key: "history", label: "Historique", Icon: History },
  { key: "tracked", label: "Suivis", Icon: Library },
  { key: "ignored", label: "Écartés", Icon: EyeOff },
];

function fmtDuration(s) {
  const min = Math.round((s || 0) / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

const dayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const shortFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

function dayLabel(d) {
  const date = new Date(d);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  if (date.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (date.toDateString() === yest.toDateString()) return "Hier";
  const s = dayFmt.format(date);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function span(e) {
  const a = timeFmt.format(new Date(e.from));
  const b = timeFmt.format(new Date(e.to));
  return a === b ? a : `${a} – ${b}`;
}

// Deux noms qui ne diffèrent que par la ponctuation ou les espaces
// (« Assassins Creed » / « Assassin's Creed », « SolCesto » / « Sol Cesto »).
const bare = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Le nom de dossier, débarrassé de ce qui gêne la recherche.
function searchable(raw) {
  return String(raw || "")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[_.\-]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function Cover({ src, size = "md" }) {
  return (
    <div className={`cmp-cover cmp-cover-${size}`}>
      {src ? <img src={src} alt="" loading="lazy" /> : <Gamepad2 size={size === "sm" ? 14 : 18} />}
    </div>
  );
}

function Source({ g }) {
  return (
    <div className="cmp-source">
      {g.folder ? (
        <span className="cmp-path" title={g.folder}>
          <FolderOpen size={12} /> {g.folder}
        </span>
      ) : g.appid ? (
        <span className="cmp-path">
          <Monitor size={12} /> appid {g.appid}
        </span>
      ) : null}
      {g.emulator && <span className="cmp-chip">{g.emulator}</span>}
    </div>
  );
}

export default function Companion() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("review");
  const [busy, setBusy] = useState(null);

  async function load() {
    try {
      setData(await apiFetch("/companion/review", { token }));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Une action = un appel, puis on recharge (le serveur fait foi).
  async function act(id, method, path, body) {
    setBusy(id);
    try {
      await apiFetch(`/companion${path}`, { method, token, body });
      await load();
    } catch (e) {
      window.alert(e.message);
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(
    () => ({
      review: data?.review.length || 0,
      history: data?.history.length || 0,
      tracked: data?.tracked.length || 0,
      ignored: data?.ignored.length || 0,
    }),
    [data]
  );

  return (
    <div className="cmp-page">
      <header className="cmp-head">
        <button className="cmp-back clickable" onClick={() => navigate("/settings?tab=imports")}>
          <ArrowLeft size={16} /> Paramètres
        </button>
        <div className="cmp-title-row">
          <h1>
            <Monitor size={22} /> Compagnon PC
          </h1>
          {data && (
            <label
              className={`cmp-auto ${data.auto ? "on" : ""}`}
              title="Les jeux déjà validés reçoivent leurs nouveaux succès et leurs heures sans attendre. Un jeu jamais vu attend toujours ta validation, et tout reste annulable."
            >
              <span>Mode automatique</span>
              <input
                type="checkbox"
                checked={data.auto}
                disabled={busy === "auto"}
                onChange={(e) => act("auto", "PUT", "/settings", { auto: e.target.checked })}
              />
              <span className="cmp-switch" aria-hidden="true" />
            </label>
          )}
        </div>
        <nav className="cmp-tabs">
          {TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              className={`cmp-tab clickable ${tab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              <Icon size={15} /> {label}
              {counts[key] > 0 && key !== "history" && (
                <span className={`cmp-count ${key === "review" ? "hot" : ""}`}>{counts[key]}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      {error && <div className="cmp-error">{error}</div>}
      {!data && !error && (
        <div className="cmp-loading">
          <Loader2 className="spin" size={20} />
        </div>
      )}

      {data && tab === "review" && (
        <section className="cmp-list">
          {data.review.length === 0 ? (
            <Empty Icon={Check} text="Rien à valider." />
          ) : (
            data.review.map((g) => (
              <ReviewCard key={g.id} g={g} token={token} busy={busy === g.id} act={act} />
            ))
          )}
        </section>
      )}

      {data && tab === "history" && <HistoryList items={data.history} busy={busy} act={act} />}

      {data && tab === "tracked" && (
        <section className="cmp-list">
          {data.tracked.length === 0 ? (
            <Empty Icon={Library} text="Aucun jeu suivi pour l'instant." />
          ) : (
            data.tracked.map((g) => (
              <TrackedRow key={g.id} g={g} token={token} busy={busy === g.id} act={act} />
            ))
          )}
        </section>
      )}

      {data && tab === "ignored" && (
        <section className="cmp-list">
          {data.ignored.length === 0 ? (
            <Empty Icon={EyeOff} text="Aucun jeu écarté." />
          ) : (
            data.ignored.map((g) => (
              <div key={g.id} className="cmp-row">
                <Cover src={g.cover} size="sm" />
                <div className="cmp-row-info">
                  <div className="cmp-name">{g.name || g.rawName || g.key}</div>
                  <Source g={g} />
                </div>
                <button
                  className="cmp-btn ghost clickable"
                  disabled={busy === g.id}
                  onClick={() => act(g.id, "POST", `/games/${g.id}/restore`)}
                >
                  {busy === g.id ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
                  Reproposer
                </button>
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}

function Empty({ Icon, text }) {
  return (
    <div className="cmp-empty">
      <Icon size={22} />
      <span>{text}</span>
    </div>
  );
}

// ----------------------------------------------------------------------
//  À valider
// ----------------------------------------------------------------------
function ReviewCard({ g, token, busy, act }) {
  const isNew = g.state === "pending";
  const [sel, setSel] = useState({ gameId: g.gameId, name: g.name, cover: g.cover });
  const [picking, setPicking] = useState(!g.gameId);
  const [status, setStatus] = useState("playing");
  const events = g.pending.events;
  const unlocks = events.flatMap((e) => e.achievements);
  const sessions = events.filter((e) => e.type === "playtime");

  function validate() {
    const body = { status };
    if (sel.gameId !== g.gameId) Object.assign(body, sel);
    act(g.id, "POST", `/games/${g.id}/validate`, body);
  }

  return (
    <article className={`cmp-card ${isNew ? "is-new" : ""}`}>
      <div className="cmp-card-main">
        <Cover src={sel.cover} size="lg" />
        <div className="cmp-card-info">
          <div className="cmp-kicker">{isNew ? "Nouveau jeu détecté" : "Nouveaux envois"}</div>
          <div className="cmp-name big">{sel.name || g.rawName || `appid ${g.appid}`}</div>
          {sel.name && g.rawName && !bare(sel.name).includes(bare(searchable(g.rawName))) && (
            <div className="cmp-raw">
              Dossier : <strong>{g.rawName}</strong>
            </div>
          )}
          <Source g={g} />
          {(g.pending.seconds > 0 || unlocks.length > 0) && (
            <div className="cmp-totals">
              {g.pending.seconds > 0 && (
                <span>
                  <Clock size={13} /> {fmtDuration(g.pending.seconds)}
                  {sessions.length === 1 && (
                    <em className="cmp-when-inline">
                      {shortFmt.format(new Date(sessions[0].from))} · {span(sessions[0])}
                    </em>
                  )}
                </span>
              )}
              {unlocks.length > 0 && (
                <span>
                  <Trophy size={13} /> {unlocks.length} succès
                </span>
              )}
            </div>
          )}
        </div>
        <button
          className="cmp-icon-btn clickable"
          title={isNew ? "Pas un jeu, ou à ne pas suivre" : "Refuser ces envois"}
          disabled={busy}
          onClick={() => act(g.id, "POST", `/games/${g.id}/${isNew ? "ignore" : "reject"}`)}
        >
          <X size={16} />
        </button>
      </div>

      {unlocks.length > 0 && (
        <ul className="cmp-unlocks">
          {unlocks.slice(0, 12).map((a) => (
            <li key={a.apiName} title={a.name}>
              {a.icon ? <img src={a.icon} alt="" loading="lazy" /> : <Trophy size={14} />}
              <span>{a.name}</span>
            </li>
          ))}
          {unlocks.length > 12 && <li className="more">+{unlocks.length - 12}</li>}
        </ul>
      )}

      {/* Une seule session : sa plage horaire est déjà sur la ligne du total. */}
      {sessions.length > 1 && (
        <ul className="cmp-sessions">
          {sessions.map((e) => (
            <li key={e.id}>
              <Clock size={12} />
              <span>
                {shortFmt.format(new Date(e.from))} · {span(e)}
              </span>
              <strong>{fmtDuration(e.seconds)}</strong>
              <button
                className="cmp-mini clickable"
                title="Refuser cette session"
                onClick={() => act(g.id, "POST", `/events/${e.id}/reject`)}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {picking ? (
        <div className="cmp-picker">
          <GameSearchPicker
            query={searchable(g.rawName || sel.name || "")}
            token={token}
            onPick={(game) => {
              setSel({ gameId: game.id, name: game.name, cover: game.cover });
              setPicking(false);
            }}
          />
          <div className="cmp-picker-foot">
            {sel.gameId && (
              <button className="cmp-btn ghost small clickable" onClick={() => setPicking(false)}>
                Garder {sel.name}
              </button>
            )}
            {isNew && (
              <button
                className="cmp-btn ghost small clickable"
                disabled={busy}
                onClick={() => act(g.id, "POST", `/games/${g.id}/ignore`)}
              >
                <EyeOff size={13} /> Ce n'est pas un jeu
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="cmp-card-foot">
          {isNew && (
            <div className="cmp-status">
              {STATUSES.map((s) => (
                <button
                  key={s.key}
                  className={`cmp-seg clickable ${status === s.key ? "active" : ""}`}
                  onClick={() => setStatus(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="cmp-actions">
            {isNew && (
              <button className="cmp-btn ghost clickable" onClick={() => setPicking(true)}>
                <RefreshCw size={14} /> Pas le bon jeu
              </button>
            )}
            <button className="cmp-btn primary clickable" disabled={busy || !sel.gameId} onClick={validate}>
              {busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
              {isNew ? "Valider" : "Appliquer"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

// ----------------------------------------------------------------------
//  Historique
// ----------------------------------------------------------------------
const STATUS_LABEL = { applied: "Appliqué", undone: "Annulé", rejected: "Refusé", pending: "En attente" };

function HistoryList({ items, busy, act }) {
  const [open, setOpen] = useState(null);
  const groups = useMemo(() => {
    const out = [];
    for (const e of items) {
      const label = dayLabel(e.to);
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [items]);

  if (!items.length) return <Empty Icon={History} text="Aucun envoi pour l'instant." />;

  function describe(e) {
    if (e.type === "playtime") return `+${fmtDuration(e.seconds)} de jeu`;
    if (e.type === "library") return "Ajouté à ta bibliothèque";
    const n = e.achievements.length;
    return `${n} succès${n <= 2 ? " : " + e.achievements.map((a) => a.name).join(", ") : ""}`;
  }

  function undo(e) {
    if (
      e.type === "library" &&
      !window.confirm(
        `Retirer ${e.game?.name || "ce jeu"} de ta bibliothèque ? Ses heures et ses succès envoyés par le compagnon seront retirés aussi.`
      )
    )
      return;
    act(e.id, "POST", `/events/${e.id}/undo`);
  }

  const TypeIcon = { playtime: Clock, achievements: Trophy, library: Library };

  return (
    <section className="cmp-history">
      {groups.map((grp) => (
        <div key={grp.label} className="cmp-day">
          <div className="cmp-day-label">{grp.label}</div>
          {grp.items.map((e) => {
            const Icon = TypeIcon[e.type];
            const expandable = e.type === "achievements" && e.achievements.length > 2;
            return (
              <div key={e.id} className={`cmp-event status-${e.status}`}>
                <div className="cmp-event-row">
                  <span className={`cmp-type type-${e.type}`}>
                    <Icon size={14} />
                  </span>
                  <Cover src={e.game?.cover} size="sm" />
                  <div className="cmp-row-info">
                    <div className="cmp-name">{e.game?.name || "Jeu"}</div>
                    <div
                      className={`cmp-event-what ${expandable ? "clickable" : ""}`}
                      onClick={() => expandable && setOpen(open === e.id ? null : e.id)}
                    >
                      {describe(e)}
                      {expandable && <span className="cmp-more">{open === e.id ? "masquer" : "voir"}</span>}
                    </div>
                  </div>
                  <span className="cmp-when">{span(e)}</span>
                  <span className={`cmp-state state-${e.status}`}>{STATUS_LABEL[e.status]}</span>
                  {e.status === "applied" ? (
                    <button className="cmp-btn ghost small clickable" disabled={busy === e.id} onClick={() => undo(e)}>
                      {busy === e.id ? <Loader2 className="spin" size={13} /> : <Undo2 size={13} />} Annuler
                    </button>
                  ) : (
                    <button
                      className="cmp-btn ghost small clickable"
                      disabled={busy === e.id || e.game?.state !== "approved"}
                      title={e.game?.state !== "approved" ? "Valide d'abord le jeu" : undefined}
                      onClick={() => act(e.id, "POST", `/events/${e.id}/apply`)}
                    >
                      {busy === e.id ? <Loader2 className="spin" size={13} /> : <RotateCcw size={13} />} Rétablir
                    </button>
                  )}
                </div>
                {open === e.id && (
                  <ul className="cmp-unlocks in-history">
                    {e.achievements.map((a) => (
                      <li key={a.apiName} title={a.name}>
                        {a.icon ? <img src={a.icon} alt="" loading="lazy" /> : <Trophy size={14} />}
                        <span>{a.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

// ----------------------------------------------------------------------
//  Suivis
// ----------------------------------------------------------------------
function TrackedRow({ g, token, busy, act }) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="cmp-tracked">
      <div className="cmp-row">
        <Cover src={g.cover} size="sm" />
        <div className="cmp-row-info">
          <div className="cmp-name">{g.name || g.rawName}</div>
          <div className="cmp-meta">
            {g.seconds > 0 && (
              <span>
                <Clock size={12} /> {fmtDuration(g.seconds)}
              </span>
            )}
            {g.achievements > 0 && (
              <span>
                <Trophy size={12} /> {g.achievements} succès
              </span>
            )}
            {g.lastPlayedAt && <span>joué le {shortFmt.format(new Date(g.lastPlayedAt))}</span>}
          </div>
          <Source g={g} />
        </div>
        <button className="cmp-btn ghost small clickable" onClick={() => setPicking((v) => !v)}>
          <RefreshCw size={13} /> Pas le bon jeu
        </button>
        <button
          className="cmp-btn danger small clickable"
          disabled={busy}
          onClick={() =>
            window.confirm(
              `Tout retirer pour ${g.name || g.rawName} ? Ses heures et ses succès envoyés par le compagnon sont annulés, et il n'est plus suivi.`
            ) && act(g.id, "POST", `/games/${g.id}/remove`)
          }
        >
          {busy ? <Loader2 className="spin" size={13} /> : <Trash2 size={13} />} Tout retirer
        </button>
      </div>
      {picking && (
        <div className="cmp-picker">
          <GameSearchPicker
            query={searchable(g.rawName || g.name)}
            token={token}
            onPick={(game) => {
              setPicking(false);
              act(g.id, "POST", `/games/${g.id}/validate`, { gameId: game.id, name: game.name, cover: game.cover });
            }}
          />
        </div>
      )}
    </div>
  );
}
