import {
  Fragment,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  CalendarX,
  Bookmark,
  Loader2,
  AlertTriangle,
  ChevronDown,
  Sparkles,
  Check,
  Minus,
  Search,
  Flame,
  Gamepad2,
  Star,
  ArrowRight,
  ArrowUp,
  Languages,
  X,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { makeCache } from "../lib/cache";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { useClickOutside } from "../hooks/useClickOutside";
import GameAddFan from "../components/GameAddFan";
import MediaLightbox from "../components/MediaLightbox";

// ============================================================
//  Page « Sorties » : un feed vertical par jour — on descend vers le futur,
//  on remonte vers les jours passés (chargés à la volée). Une carte ouvre une
//  modale de découverte plutôt que la fiche du jeu directement.
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

// Hauteur occupée en haut de l'écran par ce qui est collant (barre de l'app +
// barre d'outils de la page) : c'est de ça qu'il faut décaler un scroll ciblé,
// sinon la cible se range DERRIÈRE ces barres. Les deux sont mesurées plutôt
// que devinées — `--topbar-h` change selon la taille d'écran, et la barre
// d'outils passe sur deux rangées en mobile.
function stickyOffset() {
  const host = document.querySelector(".app-content, .public-shell");
  const topbar = host
    ? parseFloat(getComputedStyle(host).getPropertyValue("--topbar-h"))
    : NaN;
  const bar = document.querySelector(".rel-toolbar");
  return (
    (Number.isFinite(topbar) ? topbar : 60) +
    (bar ? bar.getBoundingClientRect().height : 0) +
    12
  );
}

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
//  Carte d'un jeu dans le feed — ouvre la modale de découverte
// ============================================================
// Mémoïsée, et `onOpen` reçoit le jeu plutôt qu'une fermeture recréée à chaque
// rendu : la page entière se re-rend à chaque changement de jour au focus (donc
// en continu pendant le défilement), et sans ça toutes les cartes — avec leur
// menu radial d'ajout, quatre boutons chacune — étaient repeintes avec elle.
const RelCard = memo(function RelCard({ g, inWish, onOpen }) {
  return (
    <div
      className={`relc clickable ${inWish ? "is-wish" : ""}`}
      onClick={() => onOpen(g)}
      title={g.name}
    >
      <span className="relc-cover">
        {g.cover ? (
          <img
            src={g.cover}
            alt=""
            loading="lazy"
            decoding="async"
            draggable="false"
          />
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
});

// ============================================================
//  Le repère « aujourd'hui » de la timeline
// ============================================================
// Posé entre le dernier jour passé et le premier jour à venir, il existe même
// quand aucun jeu ne sort aujourd'hui : c'est la cible du calage initial et du
// bouton « Aujourd'hui », qui ne peuvent donc jamais tomber à côté.
const NowMarker = forwardRef(function NowMarker(_props, ref) {
  return (
    <div className="rel-now" ref={ref}>
      <span className="rel-now-dot" aria-hidden="true" />
      <span className="rel-now-label">Aujourd'hui</span>
      <span className="rel-now-line" aria-hidden="true" />
    </div>
  );
});

// ============================================================
//  Modale de découverte d'un jeu : backdrop, compte à rebours, infos,
//  wishlist + planning — sans quitter le feed.
// ============================================================
function RelGameModal({ game, token, onClose }) {
  const { upsertLocal, removeLocal } = useLibrary();
  const [full, setFull] = useState(null); // fiche IGDB complète
  const [entry, setEntry] = useState(undefined); // undefined = chargement
  const [busy, setBusy] = useState(false);
  const [shotIdx, setShotIdx] = useState(null); // index de la capture ouverte en grand

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
                {(full.genres || []).slice(0, 4).map((x) => {
                  // `genres` du /full = { id, name } (chaîne pour un cache ancien).
                  const name = typeof x === "string" ? x : x.name;
                  return (
                    <span className="relm-chip" key={name}>
                      {name}
                    </span>
                  );
                })}
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
                  {shots.map((m, i) => (
                    <button
                      key={m.id}
                      className="relm-shot clickable"
                      onClick={() => setShotIdx(i)}
                      title="Voir en grand"
                    >
                      <img
                        src={m.thumb}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable="false"
                      />
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

            <Link to={`/game/${game.id}`} className="relm-go clickable">
              Voir la fiche du jeu <ArrowRight size={15} />
            </Link>
          </div>
        </div>

      </div>

      {/* Visionneuse plein écran. Hors de .relm : posée dedans, elle restait
          bornée à la carte de la modale (« plein écran » grand comme une
          fenêtre). Elle se portalise elle-même sur <body>. */}
      {shotIdx !== null && (
        <MediaLightbox
          items={shots}
          index={shotIdx}
          onIndex={setShotIdx}
          onClose={() => setShotIdx(null)}
          title={game.name}
        />
      )}
    </div>,
    document.body
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

  // État initialisé depuis l'URL : le retour arrière restaure les filtres.
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
    if (bigOnly) next.set("big", "1");
    if (wishlistOnly) next.set("wish", "1");
    if (excludeAi) next.set("ai", "1");
    const c = serializeSel(platformSel);
    if (c) next.set("console", c);
    const g = serializeSel(genreSel);
    if (g) next.set("genre", g);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bigOnly, wishlistOnly, excludeAi, platformSel, genreSel]);

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

  // --- Jours passés : chargés par fenêtres de 7 jours en remontant le feed.
  // Insérer du contenu AU-DESSUS de ce qu'on regarde pousse tout vers le bas :
  // il faut compenser le scroll d'autant. On s'ancre sur le premier jour déjà
  // affiché et on rétablit sa position exacte à l'écran — mesurer la hauteur
  // totale du document (l'ancienne méthode) était approximatif, car les images
  // qui finissent de charger la font bouger en même temps, ce qui décalait le
  // repère d'un jour ou deux. ---
  const anchorRef = useRef(null);
  async function loadPast() {
    if (pastLoading || pastDone || !token) return;
    setPastLoading(true);
    const to = pastCursor - 1; // borne haute exclue (déjà couverte)
    const from = pastCursor - PAST_CHUNK;
    try {
      const d = await apiFetch(`/games/releases?from=${from}&to=${to}`, { token });
      const first = timelineRef.current?.querySelector("[data-day]");
      anchorRef.current = first
        ? { day: first.dataset.day, top: first.getBoundingClientRect().top }
        : null;
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
    const a = anchorRef.current;
    if (!a) return;
    anchorRef.current = null;
    const el = timelineRef.current?.querySelector(`[data-day="${a.day}"]`);
    if (!el) return;
    const delta = el.getBoundingClientRect().top - a.top;
    if (delta) window.scrollBy(0, delta);
  }, [pastGames]);

  // --- Jour « au focus » : le jour traversé par la ligne de lecture (≈ 35 % du
  // viewport) reste net, les autres sont grisés — on voit d'un coup d'œil où on
  // en est dans la timeline.
  //
  // Un IntersectionObserver, et non un scan au scroll : l'ancienne version
  // relisait la position de CHAQUE section à chaque frame, soit des centaines
  // de mesures de layout par seconde une fois plusieurs mois chargés — de loin
  // le premier poste de saccade de la page sur mobile. Ici le navigateur ne
  // nous réveille qu'aux rares entrées/sorties de la bande de lecture. ---
  const timelineRef = useRef(null);
  const [activeDay, setActiveDay] = useState(null);

  // Sentinelle en haut du feed : s'en approcher charge les jours d'avant.
  const topRef = useRef(null);
  const ioStateRef = useRef({});
  ioStateRef.current = {
    ready: !loading,
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
  }, [loading]);

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
  // Où poser le repère « aujourd'hui » : juste avant le premier jour qui n'est
  // pas passé. -1 (aucun) = tout est derrière nous, le repère ferme la marche.
  const nowIndex = groups.findIndex((g) => g.dayStart >= todayStart);

  // Le jour traversé par la ligne de lecture (≈ 35 % de la hauteur) reste net,
  // les autres sont grisés — on voit d'un coup d'œil où on en est.
  //
  // Un IntersectionObserver, et non un scan au scroll : l'ancienne version
  // relisait la position de CHAQUE section à chaque frame, soit des centaines
  // de mesures de layout par seconde une fois plusieurs mois chargés — de loin
  // le premier poste de saccade de la page sur mobile. Ici le navigateur ne
  // nous réveille qu'aux rares entrées/sorties de la bande de lecture.
  // Ré-observé à chaque changement de regroupement (filtres, jours chargés).
  useEffect(() => {
    const root = timelineRef.current;
    if (!root) return;
    const days = root.querySelectorAll("[data-day]");
    if (!days.length) return;

    const inBand = new Set();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inBand.add(e.target.dataset.day);
          else inBand.delete(e.target.dataset.day);
        }
        // Une poignée d'éléments au plus dans la bande : on relit leur position
        // pour garder le plus haut, le coût reste négligeable.
        let best = null;
        let bestTop = Infinity;
        for (const day of inBand) {
          const el = root.querySelector(`[data-day="${day}"]`);
          if (!el) continue;
          const top = el.getBoundingClientRect().top;
          if (top < bestTop) {
            bestTop = top;
            best = day;
          }
        }
        setActiveDay(best);
      },
      // Bande fine à 35 % de la hauteur : ce qui la traverse est « au focus ».
      // Un peu d'épaisseur (10 %) pour qu'aucun interstice entre deux jours ne
      // laisse la bande vide, ce qui ferait clignoter tout le feed.
      { rootMargin: "-35% 0px -55% 0px" }
    );
    for (const el of days) io.observe(el);
    return () => io.disconnect();
  }, [groups]);

  // --- « Aujourd'hui » : le repère de la timeline ---
  // Le feed s'ouvrait simplement en haut de page en espérant qu'aujourd'hui s'y
  // trouve — mais les jours passés se chargent aussitôt au-dessus, et la moindre
  // approximation de compensation faisait atterrir sur la veille. On pose donc
  // un repère explicite (toujours présent, même sans sortie ce jour-là) et on
  // s'y cale nous-mêmes.
  const nowRef = useRef(null);
  const jumpedRef = useRef(false);
  const [showJump, setShowJump] = useState(false);

  const jumpToToday = useCallback((smooth = true) => {
    const el = nowRef.current;
    if (!el) return false;
    // Sous la barre du haut ET la barre d'outils collante, sinon le repère
    // atterrit dessous.
    const top = window.scrollY + el.getBoundingClientRect().top - stickyOffset();
    window.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
    return true;
  }, []);

  // Calage initial, une seule fois, dès que le feed a de quoi s'afficher.
  useLayoutEffect(() => {
    if (jumpedRef.current || loading || total === 0) return;
    if (jumpToToday(false)) jumpedRef.current = true;
  }, [loading, total, jumpToToday]);

  // Bouton flottant « Aujourd'hui » : proposé seulement quand le repère est
  // sorti de l'écran (sinon il n'aurait rien à faire).
  useEffect(() => {
    const el = nowRef.current;
    if (!el) {
      setShowJump(false);
      return;
    }
    const io = new IntersectionObserver(([e]) => setShowJump(!e.isIntersecting), {
      rootMargin: "-15% 0px -15% 0px",
    });
    io.observe(el);
    return () => io.disconnect();
    // `nowIndex` : le repère change de place dans la liste quand des jours
    // passés arrivent — il faut alors observer le nouvel élément.
  }, [loading, total, nowIndex]);

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
            groups.map(({ dayStart, items }, i) => {
              const date = new Date(dayStart);
              const isToday = dayStart === todayStart;
              const isPast = dayStart < todayStart;
              const dim = activeDay != null && activeDay !== String(dayStart);
              return (
                <Fragment key={dayStart}>
                  {i === nowIndex && <NowMarker ref={nowRef} />}
                  <section className={`rel-day ${dim ? "dim" : ""}`} data-day={dayStart}>
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
                          onOpen={setModalGame}
                        />
                      ))}
                    </div>
                  </section>
                </Fragment>
              );
            })
          )}
          {/* Plus rien à venir : le repère ferme la timeline. */}
          {total > 0 && nowIndex === -1 && <NowMarker ref={nowRef} />}
        </div>
      )}

      {/* Retour au présent, quand on s'est perdu dans le passé ou le futur. */}
      {showJump && (
        <button
          className="rel-jump clickable"
          onClick={() => jumpToToday(true)}
          title="Revenir à aujourd'hui"
        >
          <CalendarDays size={15} /> Aujourd'hui
        </button>
      )}

      {modalGame && (
        <RelGameModal game={modalGame} token={token} onClose={() => setModalGame(null)} />
      )}
    </div>
  );
}
