import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
} from "@dnd-kit/core";
import {
  CalendarDays,
  CalendarRange,
  CalendarPlus,
  CalendarX,
  Bookmark,
  Loader2,
  AlertTriangle,
  ChevronDown,
  Sparkles,
  Check,
  Minus,
  Search,
  X,
  Flame,
  Gamepad2,
  Gamepad,
  Star,
  ArrowRight,
  ArrowUp,
  Languages,
  PauseCircle,
  Skull,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { makeCache } from "../lib/cache";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { useClickOutside } from "../hooks/useClickOutside";
import GameAddFan from "../components/GameAddFan";

// ============================================================
//  Page « Sorties » : un feed vertical par jour — on descend vers le futur,
//  on remonte vers les jours passés (chargés à la volée). Une carte ouvre une
//  modale de découverte (pas la fiche du jeu directement), et un mode
//  Planning permet de répartir ses jeux par mois (« je le fais en août »).
// ============================================================

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
// v2 : le payload embarque désormais ratingCount (filtre « gros jeux ») —
// nouvelle clé pour ne pas resservir l'ancien cache pendant 24 h.
const CACHE_KEY = "upcoming2";

const MS_DAY = 86400000;
// Fenêtre chargée à chaque remontée : 7 jours SEULEMENT — IGDB plafonne à
// 500 jeux par requête et un mois de sorties dépasse ce plafond, ce qui
// tronquait silencieusement les jours les plus proches d'aujourd'hui (on se
// retrouvait avec le 23 juin collé au 10 juillet).
const PAST_CHUNK = 7 * 86400;
const PAST_MAX = 365 * 86400; // on ne remonte pas plus d'un an en arrière

// Un « gros jeu » : très attendu (hype IGDB) avant sa sortie, très noté après.
const isBig = (g) => (g.hypes || 0) >= 10 || (g.ratingCount || 0) >= 50;

// Minuit local d'une date (repère pour compter les jours pleins).
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
const todaySec = () => Math.floor(startOfDay(new Date()).getTime() / 1000);

// Libellé relatif d'un jour (passé comme futur).
function dayLabel(dayStart) {
  const diff = Math.round((dayStart - startOfDay(new Date()).getTime()) / MS_DAY);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Demain";
  if (diff === -1) return "Hier";
  if (diff > 0) {
    if (diff < 7) return `Dans ${diff} jours`;
    if (diff < 30) return `Dans ${Math.round(diff / 7)} sem.`;
    return `Dans ${Math.round(diff / 30)} mois`;
  }
  const d = -diff;
  if (d < 7) return `Il y a ${d} jours`;
  if (d < 30) return `Il y a ${Math.round(d / 7)} sem.`;
  return `Il y a ${Math.round(d / 30)} mois`;
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
const fmtLongDate = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const fmtMonthLong = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

// --- Mois de planning ("2026-08") ---
const monthKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const currentMonthKey = () => monthKeyOf(new Date());
function monthLabel(key) {
  const [y, m] = key.split("-");
  const s = fmtMonthLong.format(new Date(Number(y), Number(m) - 1, 1));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// Les 6 prochains mois (mois courant inclus) — colonnes du planning.
function nextMonths(n = 6) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    out.push(monthKeyOf(d));
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

// ============================================================
//  Compte à rebours en direct (modale) : J / h / min / s en segments
// ============================================================
function CountdownBig({ ts }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  let left = Math.max(0, Math.floor(ts - Date.now() / 1000));
  const d = Math.floor(left / 86400);
  left -= d * 86400;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const seg = (v, u) => (
    <span className="relm-cd-seg">
      <b>{String(v).padStart(2, "0")}</b>
      <i>{u}</i>
    </span>
  );
  return (
    <div className="relm-cd" title="Temps restant avant la sortie">
      {seg(d, "j")}
      {seg(h, "h")}
      {seg(m, "min")}
      {seg(s, "s")}
    </div>
  );
}

// ============================================================
//  Menu « Planifier » : choisir le mois où jouer le jeu
// ============================================================
function MonthMenu({ value, onPick, compact = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);
  const months = nextMonths(6);

  return (
    <div className="plan-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        className={`plan-menu-btn clickable ${value ? "on" : ""} ${compact ? "compact" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title={value ? `Prévu : ${monthLabel(value)}` : "Choisir le mois où y jouer"}
      >
        <CalendarPlus size={13} />
        {value ? (compact ? monthLabel(value).split(" ")[0] : monthLabel(value)) : "Planifier"}
        <ChevronDown size={12} className={open ? "up" : ""} />
      </button>
      {open && (
        <div className="plan-menu-pop card">
          {months.map((mk) => (
            <button
              key={mk}
              className={`plan-menu-item clickable ${value === mk ? "active" : ""}`}
              onClick={() => {
                setOpen(false);
                onPick(mk);
              }}
            >
              {monthLabel(mk)}
              {value === mk && <Check size={13} />}
            </button>
          ))}
          {value && (
            <button
              className="plan-menu-item clear clickable"
              onClick={() => {
                setOpen(false);
                onPick(null);
              }}
            >
              <X size={13} /> Retirer du planning
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
//  Carte d'un jeu dans le feed — ouvre la modale de découverte
// ============================================================
function RelCard({ g, inWish, onOpen }) {
  return (
    <div className={`relc clickable ${inWish ? "is-wish" : ""}`} onClick={onOpen} title={g.name}>
      <span className="relc-cover">
        {g.cover ? (
          <img src={g.cover} alt="" loading="lazy" draggable="false" />
        ) : (
          <span className="relc-ph">
            <Gamepad2 size={22} />
          </span>
        )}
        {g.ai && (
          <span className="rel-ai-tag" title="Contenu généré par IA">
            <Sparkles size={11} /> IA
          </span>
        )}
        {isBig(g) && g.hypes > 0 && (
          <span className="relc-hype" title={`${g.hypes} joueurs l'attendent`}>
            <Flame size={11} /> {g.hypes}
          </span>
        )}
        {inWish && (
          <span className="relc-wishtag" title="Dans ta liste de souhaits">
            <Bookmark size={11} fill="currentColor" strokeWidth={0} />
          </span>
        )}
        {/* Le « + » radial d'ajout rapide, comme sur l'Explorer */}
        <GameAddFan game={{ id: g.id, name: g.name, cover: g.cover }} hoverOnly />
      </span>
      <span className="relc-name">{g.name}</span>
      {g.platforms?.length > 0 && (
        <span className="relc-plats">{g.platforms.slice(0, 3).join(" · ")}</span>
      )}
    </div>
  );
}

// ============================================================
//  Modale de découverte d'un jeu : backdrop, compte à rebours, infos,
//  wishlist + planning — sans quitter le feed.
// ============================================================
function RelGameModal({ game, token, onClose }) {
  const { upsertLocal, removeLocal } = useLibrary();
  const [full, setFull] = useState(null); // fiche IGDB complète
  const [entry, setEntry] = useState(undefined); // undefined = chargement
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState(null); // capture ouverte en grand

  useEffect(() => {
    let alive = true;
    setFull(null);
    setEntry(undefined);
    apiFetch(`/games/${game.id}/full`, { token })
      .then((d) => alive && setFull(d))
      .catch(() => alive && setFull(false));
    apiFetch(`/library/${game.id}`, { token })
      .then((d) => alive && setEntry(d.entry))
      .catch(() => alive && setEntry(null));
    return () => {
      alive = false;
    };
  }, [game.id, token]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const isFuture = game.releaseDate && game.releaseDate * 1000 > Date.now();
  const inWish = entry?.status === "wishlist";
  const backdrop =
    (full && (full.backdrop || full.media?.find((m) => m.type === "screenshot")?.full)) || null;
  // Captures + artworks pour le bandeau d'images (cliquer = plein écran).
  const shots = full
    ? (full.media || []).filter((m) => m.type !== "video").slice(0, 10)
    : [];

  async function toggleWish() {
    if (busy || entry === undefined) return;
    setBusy(true);
    try {
      if (inWish) {
        await apiFetch(`/library/${game.id}`, { method: "DELETE", token });
        setEntry(null);
        removeLocal(game.id);
      } else if (!entry) {
        const d = await apiFetch(`/library/${game.id}`, {
          method: "PUT",
          token,
          body: { name: game.name, cover: game.cover, status: "wishlist" },
        });
        setEntry(d.entry);
        upsertLocal(game.id, { status: "wishlist", favorite: false });
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Planifier = choisir un mois (ajoute le jeu à la wishlist s'il n'y est pas).
  async function plan(month) {
    if (busy) return;
    setBusy(true);
    try {
      const d = await apiFetch(`/library/${game.id}`, {
        method: "PUT",
        token,
        body: { name: game.name, cover: game.cover, plannedMonth: month },
      });
      setEntry(d.entry);
      upsertLocal(game.id, { status: d.entry.status, favorite: d.entry.favorite });
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="modal-overlay relm-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relm card">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        {/* --- Bandeau : backdrop + jaquette + titre + compte à rebours --- */}
        <div className={`relm-hero ${backdrop ? "" : "plain"}`}>
          {backdrop && <img className="relm-backdrop" src={backdrop} alt="" draggable="false" />}
          <div className="relm-hero-veil" aria-hidden="true" />
          <div className="relm-hero-row">
            <span className="relm-cover">
              {game.cover ? (
                <img src={game.cover} alt="" draggable="false" />
              ) : (
                <span className="relm-cover-ph">
                  <Gamepad2 size={26} />
                </span>
              )}
            </span>
            <div className="relm-headings">
              <h2 className="relm-title">{game.name}</h2>
              <div className="relm-datebits">
                {game.releaseDate && (
                  <span className="relm-date">
                    <CalendarDays size={13} />
                    {fmtLongDate.format(new Date(game.releaseDate * 1000))}
                  </span>
                )}
                {game.hypes > 0 && (
                  <span className="relm-hypechip">
                    <Flame size={12} /> {game.hypes} l'attendent
                  </span>
                )}
              </div>
              {isFuture && <CountdownBig ts={game.releaseDate} />}
            </div>
          </div>
        </div>

        {/* --- Corps : infos IGDB --- */}
        <div className="relm-body">
          {full === null ? (
            <div className="relm-skel" aria-busy="true">
              <span className="gp-skel gp-skel-bar" style={{ width: "45%" }} />
              <span className="gp-skel gp-skel-bar" style={{ width: "95%" }} />
              <span className="gp-skel gp-skel-bar" style={{ width: "88%" }} />
              <span className="gp-skel gp-skel-bar" style={{ width: "60%" }} />
            </div>
          ) : full === false ? (
            <p className="relm-err">Impossible de charger les détails du jeu.</p>
          ) : (
            <>
              <div className="relm-chips">
                {(full.genres || []).slice(0, 4).map((x) => (
                  <span className="relm-chip" key={x}>
                    {x}
                  </span>
                ))}
                {(full.platforms || []).slice(0, 5).map((p) => (
                  <span className="relm-chip soft" key={p.id}>
                    {p.abbr}
                  </span>
                ))}
              </div>

              {(full.rating != null || full.criticRating != null) && (
                <div className="relm-ratings">
                  {full.rating != null && (
                    <span className="relm-rating">
                      <Star size={13} fill="currentColor" strokeWidth={0} />
                      {full.rating}%
                      <i>joueurs</i>
                    </span>
                  )}
                  {full.criticRating != null && (
                    <span className="relm-rating critic">
                      <Star size={13} fill="currentColor" strokeWidth={0} />
                      {full.criticRating}%
                      <i>presse</i>
                    </span>
                  )}
                  {full.developers?.[0] && (
                    <span className="relm-dev">{full.developers[0]}</span>
                  )}
                </div>
              )}

              {full.summary && <p className="relm-summary">{full.summary}</p>}

              {/* Bandeau d'images : captures & artworks, clic = plein écran */}
              {shots.length > 0 && (
                <div className="relm-shots">
                  {shots.map((m) => (
                    <button
                      key={m.id}
                      className="relm-shot clickable"
                      onClick={() => setShot(m.full)}
                      title="Voir en grand"
                    >
                      <img src={m.thumb} alt="" loading="lazy" draggable="false" />
                    </button>
                  ))}
                </div>
              )}

              {/* Langues disponibles */}
              {full.languages?.length > 0 && (
                <div className="relm-langs">
                  <span className="relm-langs-label">
                    <Languages size={13} /> Langues
                  </span>
                  {full.languages.slice(0, 8).map((l) => (
                    <span className="relm-lang" key={l.name}>
                      {l.cc && /^[a-z]{2}$/.test(l.cc) && (
                        <img
                          src={`https://flagcdn.com/20x15/${l.cc}.png`}
                          alt=""
                          loading="lazy"
                          draggable="false"
                        />
                      )}
                      {l.name}
                    </span>
                  ))}
                  {full.languages.length > 8 && (
                    <span className="relm-lang more">+{full.languages.length - 8}</span>
                  )}
                </div>
              )}
            </>
          )}

          {/* --- Actions : wishlist, planning, fiche complète --- */}
          <div className="relm-actions">
            <button
              className={`relm-wish clickable ${inWish ? "on" : ""}`}
              onClick={toggleWish}
              disabled={busy || entry === undefined || (entry && !inWish)}
              title={
                entry && !inWish
                  ? "Déjà dans ta bibliothèque"
                  : inWish
                    ? "Retirer de ma liste de souhaits"
                    : "Ajouter à ma liste de souhaits"
              }
            >
              {busy ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Bookmark size={15} fill={inWish ? "currentColor" : "none"} />
              )}
              {entry && !inWish
                ? "Dans ta bibliothèque"
                : inWish
                  ? "Dans ta wishlist"
                  : "Je le veux"}
            </button>

            <MonthMenu value={entry?.plannedMonth || null} onPick={plan} />

            <Link to={`/game/${game.id}`} className="relm-go clickable">
              Voir la fiche du jeu <ArrowRight size={15} />
            </Link>
          </div>
        </div>

        {/* Capture en plein écran, par-dessus la modale */}
        {shot && (
          <div className="relm-shot-lb" onClick={() => setShot(null)}>
            <img src={shot} alt="" draggable="false" />
            <button className="modal-close clickable" aria-label="Fermer">
              <X size={18} />
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ============================================================
//  Vue Planning : mes jeux répartis par mois (drag & drop + menus)
// ============================================================

// Statuts proposés dans le tiroir « à planifier ».
const TRAY_STATUSES = [
  { key: "wishlist", label: "À jouer", Icon: Bookmark },
  { key: "paused", label: "En pause", Icon: PauseCircle },
  { key: "dropped", label: "Abandonnés", Icon: Skull },
];

// Enveloppe déplaçable (dnd-kit) : la contrainte de distance du capteur
// laisse passer les clics (liens, menus) tant qu'on ne tire pas vraiment.
function DraggableGame({ id, entry, className, children }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { entry },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`${className} ${isDragging ? "dragging" : ""}`}
    >
      {children}
    </div>
  );
}

function PlanningView({ token }) {
  const [entries, setEntries] = useState(null);
  const [trayQ, setTrayQ] = useState(""); // recherche dans le tiroir
  const [trayStatus, setTrayStatus] = useState("wishlist");
  const [dragEntry, setDragEntry] = useState(null); // jeu en cours de glissé

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    let alive = true;
    apiFetch("/library", { token })
      .then((d) => alive && setEntries(d.entries || []))
      .catch(() => alive && setEntries([]));
    return () => {
      alive = false;
    };
  }, [token]);

  async function setPlan(entry, month) {
    const before = entry.plannedMonth || null;
    if (before === month) return;
    setEntries((list) =>
      list.map((e) => (e.gameId === entry.gameId ? { ...e, plannedMonth: month } : e))
    );
    try {
      await apiFetch(`/library/${entry.gameId}`, {
        method: "PUT",
        token,
        body: { plannedMonth: month },
      });
    } catch {
      setEntries((list) =>
        list.map((e) => (e.gameId === entry.gameId ? { ...e, plannedMonth: before } : e))
      );
    }
  }

  function onDragEnd(ev) {
    const entry = ev.active.data.current?.entry;
    setDragEntry(null);
    const over = ev.over?.id;
    if (!entry || over == null) return;
    if (over === "backlog") {
      if (entry.plannedMonth) setPlan(entry, null);
      return;
    }
    if (/^\d{4}-\d{2}$/.test(String(over))) setPlan(entry, String(over));
  }

  if (entries === null) {
    return (
      <div className="rel-state">
        <Loader2 size={22} className="spin" /> Chargement de ton planning…
      </div>
    );
  }

  const nowKey = currentMonthKey();
  // Colonnes : les 6 prochains mois + tout mois (passé ou lointain) où des
  // jeux sont déjà planifiés. Tri chronologique ("YYYY-MM" trie tout seul).
  const months = [
    ...new Set([...nextMonths(6), ...entries.map((e) => e.plannedMonth).filter(Boolean)]),
  ].sort();
  // Le mois courant embarque automatiquement les jeux « en cours » non
  // planifiés : c'est littéralement ce à quoi tu joues en ce moment.
  const monthList = (mk) => {
    const list = entries.filter((e) => e.plannedMonth === mk);
    if (mk === nowKey) {
      for (const e of entries) {
        if (e.status === "playing" && !e.plannedMonth) list.push({ ...e, auto: true });
      }
    }
    return list;
  };
  // Tiroir : le statut choisi, non planifié, filtré par la recherche.
  const term = trayQ.trim().toLowerCase();
  const backlog = entries.filter(
    (e) =>
      e.status === trayStatus &&
      !e.plannedMonth &&
      (!term || e.name.toLowerCase().includes(term))
  );
  const trayMeta = TRAY_STATUSES.find((s) => s.key === trayStatus);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(ev) => setDragEntry(ev.active.data.current?.entry || null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragEntry(null)}
    >
      <div className="plan">
        {/* --- Tiroir « à planifier » : recherche + switch de statut --- */}
        <PlanTray
          backlog={backlog}
          trayQ={trayQ}
          setTrayQ={setTrayQ}
          trayStatus={trayStatus}
          setTrayStatus={setTrayStatus}
          trayMeta={trayMeta}
          setPlan={setPlan}
        />

        {/* --- Colonnes par mois (zones de dépôt) --- */}
        <div className="plan-months">
          {months.map((mk) => (
            <PlanMonth
              key={mk}
              mk={mk}
              nowKey={nowKey}
              list={monthList(mk)}
              setPlan={setPlan}
            />
          ))}
        </div>
      </div>

      {/* Fantôme suivi par le curseur pendant le glissé */}
      <DragOverlay dropAnimation={null}>
        {dragEntry && (
          <div className="plan-ghost">
            {dragEntry.cover ? (
              <img src={dragEntry.cover} alt="" draggable="false" />
            ) : (
              <span className="plan-cover-ph">
                <Gamepad2 size={16} />
              </span>
            )}
            <span>{dragEntry.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// Tiroir « à planifier » — aussi zone de dépôt pour DÉplanifier un jeu.
function PlanTray({ backlog, trayQ, setTrayQ, trayStatus, setTrayStatus, trayMeta, setPlan }) {
  const { setNodeRef, isOver } = useDroppable({ id: "backlog" });
  return (
    <section ref={setNodeRef} className={`plan-tray card ${isOver ? "drop-over" : ""}`}>
      <div className="plan-tray-head">
        <h3 className="plan-tray-title">
          <trayMeta.Icon size={15} /> À planifier
          <span className="plan-tray-count">{backlog.length}</span>
        </h3>

        <div className="plan-tray-tools">
          {/* Mini switch : wishlist / en pause / abandonnés */}
          <div className="plan-tray-switch" role="group" aria-label="Statut">
            {TRAY_STATUSES.map((s) => (
              <button
                key={s.key}
                className={`plan-tray-st clickable ${trayStatus === s.key ? "active" : ""}`}
                onClick={() => setTrayStatus(s.key)}
                title={s.label}
              >
                <s.Icon size={13} /> {s.label}
              </button>
            ))}
          </div>
          <div className="plan-tray-search">
            <Search size={13} />
            <input
              placeholder="Chercher un jeu…"
              value={trayQ}
              onChange={(e) => setTrayQ(e.target.value)}
            />
            {trayQ && (
              <button
                className="plan-tray-search-clear clickable"
                onClick={() => setTrayQ("")}
                aria-label="Effacer"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="plan-tray-sub">
        Glisse un jeu vers un mois (ou utilise le menu) — redépose-le ici pour le déplanifier.
      </p>

      {backlog.length === 0 ? (
        <p className="plan-month-empty font-fun">
          {trayQ ? "Aucun jeu ne correspond." : "Rien à planifier dans ce statut."}
        </p>
      ) : (
        <div className="plan-tray-row">
          {backlog.map((e) => (
            <DraggableGame
              key={e.gameId}
              id={`tray-${e.gameId}`}
              entry={e}
              className="plan-tray-item"
            >
              <Link to={`/game/${e.gameId}`} className="plan-tray-cover clickable" title={e.name}>
                {e.cover ? (
                  <img src={e.cover} alt="" loading="lazy" draggable="false" />
                ) : (
                  <span className="plan-cover-ph">
                    <Gamepad2 size={16} />
                  </span>
                )}
              </Link>
              <span className="plan-tray-name" title={e.name}>
                {e.name}
              </span>
              <MonthMenu value={null} onPick={(mk) => setPlan(e, mk)} compact />
            </DraggableGame>
          ))}
        </div>
      )}
    </section>
  );
}

// Une colonne mois — zone de dépôt du drag & drop.
function PlanMonth({ mk, nowKey, list, setPlan }) {
  const { setNodeRef, isOver } = useDroppable({ id: mk });
  const isPast = mk < nowKey;
  const isNow = mk === nowKey;
  return (
    <section
      ref={setNodeRef}
      className={`plan-month card ${isNow ? "now" : ""} ${isPast ? "late" : ""} ${
        isOver ? "drop-over" : ""
      }`}
    >
      <h3 className="plan-month-head">
        {monthLabel(mk)}
        {isNow && <span className="plan-month-now">en ce moment</span>}
        {isPast && list.length > 0 && <span className="plan-month-late">à rattraper</span>}
        {list.length > 0 && <span className="plan-month-count">{list.length}</span>}
      </h3>
      {list.length === 0 ? (
        <p className="plan-month-empty font-fun">
          {isOver ? "Dépose-le ici !" : "Rien de prévu — glisse un jeu ici."}
        </p>
      ) : (
        <ul className="plan-list">
          {list.map((e) => (
            <li key={e.gameId}>
              <DraggableGame id={`${mk}-${e.gameId}`} entry={e} className="plan-item">
                <Link to={`/game/${e.gameId}`} className="plan-item-cover clickable">
                  {e.cover ? (
                    <img src={e.cover} alt="" loading="lazy" draggable="false" />
                  ) : (
                    <span className="plan-cover-ph">
                      <Gamepad2 size={14} />
                    </span>
                  )}
                </Link>
                <div className="plan-item-info">
                  <Link to={`/game/${e.gameId}`} className="plan-item-name clickable">
                    {e.name}
                  </Link>
                  {e.auto ? (
                    <span className="plan-item-auto" title="Tu y joues en ce moment">
                      <Gamepad size={12} /> en cours
                    </span>
                  ) : (
                    <MonthMenu value={mk} onPick={(m) => setPlan(e, m)} compact />
                  )}
                </div>
              </DraggableGame>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ============================================================
//  Page
// ============================================================
export default function Releases() {
  const { token } = useAuth();
  const { map } = useLibrary();
  const [searchParams, setSearchParams] = useSearchParams();

  const [games, setGames] = useState([]); // aujourd'hui → futur (cache 24 h)
  const [pastGames, setPastGames] = useState([]); // jours passés, chargés en remontant
  const [pastCursor, setPastCursor] = useState(todaySec); // borne basse déjà chargée
  const [pastLoading, setPastLoading] = useState(false);
  const [pastDone, setPastDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalGame, setModalGame] = useState(null);

  // État initialisé depuis l'URL : le retour arrière restaure la vue/les filtres.
  const [view, setView] = useState(() =>
    searchParams.get("view") === "plan" ? "plan" : "feed"
  );
  const [bigOnly, setBigOnly] = useState(() => searchParams.get("big") === "1");
  const [wishlistOnly, setWishlistOnly] = useState(
    () => searchParams.get("wish") === "1"
  );
  const [platformSel, setPlatformSel] = useState(() =>
    parseSel(searchParams.get("console"))
  );
  const [genreSel, setGenreSel] = useState(() => parseSel(searchParams.get("genre")));
  const [excludeAi, setExcludeAi] = useState(() => searchParams.get("ai") === "1");

  useEffect(() => {
    const next = new URLSearchParams();
    if (view === "plan") next.set("view", "plan");
    if (bigOnly) next.set("big", "1");
    if (wishlistOnly) next.set("wish", "1");
    if (excludeAi) next.set("ai", "1");
    const c = serializeSel(platformSel);
    if (c) next.set("console", c);
    const g = serializeSel(genreSel);
    if (g) next.set("genre", g);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, bigOnly, wishlistOnly, excludeAi, platformSel, genreSel]);

  const cycleIn = (setter) => (val) =>
    setter((cur) => {
      const next = { ...cur };
      if (!next[val]) next[val] = "include";
      else if (next[val] === "include") next[val] = "exclude";
      else delete next[val];
      return next;
    });

  // --- Sorties à venir : une requête, cache 24 h ---
  useEffect(() => {
    if (!token) return;
    let alive = true;

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

  // --- Jours passés : chargés par fenêtres de 30 jours en remontant le feed.
  // Avant d'insérer, on mémorise la hauteur de page pour compenser le scroll
  // (sinon tout le contenu saute vers le bas sous les yeux du lecteur). ---
  const compRef = useRef(null);
  async function loadPast() {
    if (pastLoading || pastDone || !token) return;
    setPastLoading(true);
    const to = pastCursor - 1; // borne haute exclue (déjà couverte)
    const from = pastCursor - PAST_CHUNK;
    try {
      const d = await apiFetch(`/games/releases?from=${from}&to=${to}`, { token });
      compRef.current = {
        h: document.documentElement.scrollHeight,
        y: window.scrollY,
      };
      setPastGames((prev) => [...(d.games || []), ...prev]);
      setPastCursor(from);
      if (from <= todaySec() - PAST_MAX) setPastDone(true);
    } catch {
      /* on retentera au prochain passage */
    } finally {
      setPastLoading(false);
    }
  }
  const loadPastRef = useRef(loadPast);
  loadPastRef.current = loadPast;

  useLayoutEffect(() => {
    if (!compRef.current) return;
    const { h, y } = compRef.current;
    compRef.current = null;
    const delta = document.documentElement.scrollHeight - h;
    if (delta > 0) window.scrollTo(0, y + delta);
  }, [pastGames]);

  // --- Jour « au focus » : le jour sous la ligne de lecture (≈ 35 % du
  // viewport) reste net, les autres sont grisés — on voit d'un coup d'œil où
  // on en est dans la timeline. Recalculé au scroll (throttlé par rAF). ---
  const timelineRef = useRef(null);
  const [activeDay, setActiveDay] = useState(null);
  const scanRef = useRef(() => {});
  useEffect(() => {
    let raf = 0;
    const scan = () => {
      raf = 0;
      const root = timelineRef.current;
      if (!root) return;
      const focus = window.innerHeight * 0.35;
      let best = null;
      for (const el of root.querySelectorAll("[data-day]")) {
        const r = el.getBoundingClientRect();
        if (r.top <= focus && r.bottom >= focus) {
          best = el.dataset.day;
          break;
        }
        // Ligne dans un « trou » entre deux jours : le premier jour en dessous.
        if (r.top > focus) {
          best = el.dataset.day;
          break;
        }
      }
      setActiveDay(best);
    };
    scanRef.current = scan;
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(scan);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Sentinelle en haut du feed : s'en approcher charge les jours d'avant.
  const topRef = useRef(null);
  const ioStateRef = useRef({});
  ioStateRef.current = {
    ready: !loading && view === "feed",
    busy: pastLoading,
    done: pastDone,
  };
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        const s = ioStateRef.current;
        if (s.ready && !s.busy && !s.done) loadPastRef.current();
      },
      { rootMargin: "300px 0px 0px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loading, view]);

  // --- Filtres + regroupement par jour (passé et futur mélangés, triés) ---
  const allGames = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const g of [...pastGames, ...games]) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push(g);
    }
    return out;
  }, [pastGames, games]);

  const platformOpts = useMemo(() => {
    const set = new Set();
    for (const g of allGames) for (const p of g.platforms || []) set.add(p);
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [allGames]);
  const genreOpts = useMemo(() => {
    const set = new Set();
    for (const g of allGames) for (const gg of g.genres || []) set.add(gg);
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [allGames]);

  const hasFilters =
    Object.keys(platformSel).length || Object.keys(genreSel).length || excludeAi;
  function resetFilters() {
    setPlatformSel({});
    setGenreSel({});
    setExcludeAi(false);
  }

  const groups = useMemo(() => {
    const byDay = new Map();
    for (const g of allGames) {
      if (!g.releaseDate) continue;
      if (wishlistOnly && map[g.id]?.status !== "wishlist") continue;
      if (bigOnly && !isBig(g)) continue;
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
        // Les plus attendus / joués en tête au sein d'une même journée.
        items: items.sort(
          (a, b) => (b.hypes || 0) + (b.ratingCount || 0) - (a.hypes || 0) - (a.ratingCount || 0)
        ),
      }));
  }, [allGames, wishlistOnly, bigOnly, map, excludeAi, platformSel, genreSel]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const todayStart = startOfDay(new Date()).getTime();

  // Regroupement changé (chargement passé, filtres…) → re-scan du jour au focus.
  useEffect(() => {
    scanRef.current();
  }, [groups]);

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
            Remonte le fil pour revoir les sorties passées, descends vers celles à venir.
          </p>
        </div>
      </header>

      <div className="rel-toolbar">
        {/* Vue : feed des sorties / mon planning */}
        <div className="rel-views" role="group" aria-label="Vue">
          <button
            className={`rel-view clickable ${view === "feed" ? "active" : ""}`}
            onClick={() => setView("feed")}
          >
            <CalendarDays size={15} /> Sorties
          </button>
          <button
            className={`rel-view clickable ${view === "plan" ? "active" : ""}`}
            onClick={() => setView("plan")}
          >
            <CalendarRange size={15} /> Mon planning
          </button>
        </div>

        {view === "feed" && (
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
              className={`rel-big clickable ${bigOnly ? "active" : ""}`}
              onClick={() => setBigOnly((v) => !v)}
              title="Ne montrer que les grosses sorties (jeux très attendus)"
            >
              <Flame size={15} fill={bigOnly ? "currentColor" : "none"} />
              Gros jeux
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
        )}
      </div>

      {view === "plan" ? (
        <PlanningView token={token} />
      ) : loading ? (
        <div className="rel-state">
          <Loader2 size={22} className="spin" /> Chargement des sorties…
        </div>
      ) : error ? (
        <div className="rel-state rel-error card">
          <AlertTriangle size={26} />
          <h3>Impossible de charger le calendrier</h3>
          <p>{error}</p>
        </div>
      ) : (
        <div className="rel-timeline" ref={timelineRef}>
          {/* Haut du feed : les jours d'avant se chargent en remontant */}
          <div ref={topRef} className="rel-past-top" aria-hidden="true" />
          {pastDone ? (
            <p className="rel-past-end font-fun">
              Tu es remonté un an en arrière — ça suffit, non ?
            </p>
          ) : (
            <div className="rel-past-hint">
              {pastLoading ? (
                <>
                  <Loader2 size={15} className="spin" /> Chargement des jours précédents…
                </>
              ) : (
                <>
                  <ArrowUp size={14} /> Remonte pour voir les sorties passées
                </>
              )}
            </div>
          )}

          {total === 0 ? (
            <div className="rel-state rel-empty">
              <CalendarX size={34} />
              <h3>
                {wishlistOnly
                  ? "Aucune sortie dans ta liste de souhaits"
                  : "Aucune sortie avec ces filtres"}
              </h3>
              <p className="font-fun">
                {wishlistOnly
                  ? "Ajoute des jeux à ta liste de souhaits pour les suivre ici."
                  : "Assouplis les filtres pour voir plus de jeux."}
              </p>
            </div>
          ) : (
            groups.map(({ dayStart, items }) => {
              const date = new Date(dayStart);
              const isToday = dayStart === todayStart;
              const isPast = dayStart < todayStart;
              const dim = activeDay != null && activeDay !== String(dayStart);
              return (
                <section
                  className={`rel-day ${dim ? "dim" : ""}`}
                  data-day={dayStart}
                  key={dayStart}
                >
                  <div
                    className={`rel-day-badge ${isToday ? "today" : ""} ${
                      isPast ? "past" : ""
                    }`}
                  >
                    <span className="rel-weekday">{fmtWeekday.format(date)}</span>
                    <span className="rel-daynum">{date.getDate()}</span>
                    <span className="rel-month">
                      {fmtMonth.format(date)}
                      {date.getFullYear() !== new Date().getFullYear()
                        ? ` ${date.getFullYear()}`
                        : ""}
                    </span>
                    <span className="rel-count">{dayLabel(dayStart)}</span>
                  </div>
                  <div className="rel-grid">
                    {items.map((g) => (
                      <RelCard
                        key={g.id}
                        g={g}
                        inWish={map[g.id]?.status === "wishlist"}
                        onOpen={() => setModalGame(g)}
                      />
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>
      )}

      {modalGame && (
        <RelGameModal game={modalGame} token={token} onClose={() => setModalGame(null)} />
      )}
    </div>
  );
}
