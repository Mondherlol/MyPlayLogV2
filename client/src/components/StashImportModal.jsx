// ======================================================================
//  Importer sa bibliothèque Stash
// ======================================================================
//
// Le même geste que l'import Backloggd, avec une étape en plus au début : on
// tape un pseudo, et AVANT de lire quoi que ce soit on montre le profil
// trouvé — photo, nom, compteurs — pour demander « c'est toi ? ». Un pseudo
// Stash se tape de mémoire et deux joueurs peuvent se ressembler : mieux vaut
// une seconde de vérification qu'un import de la bibliothèque d'un autre.
//
// ⚠️ RIEN N'EST ÉCRIT AVANT LA VALIDATION. La lecture tourne côté serveur et
// cette fenêtre la SUIT (rayons lus, jaquettes trouvées) en reposant la même
// question toutes les 650 ms : un gros profil prend vingt secondes, et vingt
// secondes devant un rond qui tourne, c'est long.
//
// ⚠️ ET TOUT SE DÉFAIT. L'écran final propose d'annuler l'import en entier,
// et le toast qui suit la fermeture aussi (cf. routes/stash.js, /undo).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Loader2,
  Check,
  AtSign,
  ExternalLink,
  Gamepad2,
  Star,
  PenLine,
  Sparkles,
  Undo2,
  ArrowLeft,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { coverAtSize } from "../lib/gameCover";
import { formatRating, useRatingScale, SCALE_STARS } from "../lib/ratingScale";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { StashMark, StashWordmark } from "./StashIcon";

const STATUS_LABEL = {
  wishlist: "Envie",
  playing: "En cours",
  finished: "Terminé",
  paused: "En pause",
  dropped: "Abandonné",
  endless: "Sans fin",
  notInterested: "Pas intéressé",
};

// Les filtres de l'aperçu, dans l'ordre d'une vie de joueur.
const FILTERS = [
  ["wishlist", "Envies"],
  ["playing", "En cours"],
  ["paused", "En pause"],
  ["endless", "Sans fin"],
  ["finished", "Terminés"],
  ["dropped", "Abandonnés"],
  ["notInterested", "Pas intéressé"],
];

const COMPLETION = { main: "Histoire", extras: "Histoire + extras", full: "100 %" };

// Les étapes de la lecture, telles que l'écran d'attente les égrène.
const STEPS = [
  ["want", "Envies"],
  ["playing", "En cours"],
  ["beaten", "Terminés"],
  ["archived", "Archivés"],
  ["reviews", "Avis"],
];

const WALL = 24; // jaquettes sur le mur de l'écran d'attente
const POLL_MS = 650;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Pose les nouvelles jaquettes sur le mur : d'abord dans les cases vides, puis
// en remplaçant quelques cases à chaque tour, en sautant de 7 en 7 (7 et 24
// n'ont pas de diviseur commun : le mur entier finit par tourner).
//
// ⚠️ PAS TOUT LE MUR D'UN COUP. Chaque relance apporte une centaine de jeux ;
// remplacer les 24 cases toutes les 650 ms ne laissait le temps à aucune image
// d'arriver sur une connexion lente — un mur troué de cases vides.
function placeCovers(wall, fresh) {
  const slots = [...wall.slots];
  let next = wall.next;
  let budget = 4;
  for (const src of fresh.slice(-WALL)) {
    const empty = slots.indexOf(null);
    if (empty !== -1) {
      slots[empty] = src;
    } else {
      if (budget <= 0) break;
      budget -= 1;
      slots[next % WALL] = src;
      next += 7;
    }
  }
  return { slots, next };
}

// Ce qui part coché : tout ce qui changerait quelque chose. Un jeu déjà à jour
// ne ferait rien — le cocher d'avance gonflerait le compteur pour rien.
const defaultPicks = (games) =>
  Object.fromEntries(games.filter((g) => !g.upToDate).map((g) => [g.igdbId, true]));

export default function StashImportModal({ onClose, onDone }) {
  const { token } = useAuth();
  const { refresh } = useLibrary();
  const toast = useToast();
  const scale = useRatingScale();

  // ask | finding | confirm | scan | review | importing | done | undone
  const [phase, setPhase] = useState("ask");
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);
  const [profile, setProfile] = useState(null);
  const [progress, setProgress] = useState(null);
  const [data, setData] = useState(null); // { username, counts, games, unmatched }
  const [picked, setPicked] = useState({}); // igdbId -> bool
  const [filter, setFilter] = useState("all");
  const [overwriteRatings, setOverwriteRatings] = useState(false);
  const [overwriteReviews, setOverwriteReviews] = useState(false);
  const [result, setResult] = useState(null);
  const [undoing, setUndoing] = useState(false);

  // ⚠️ REMIS À VRAI DANS LE CORPS DE L'EFFET : en développement, StrictMode
  // démonte puis remonte la fenêtre ; un drapeau posé une seule fois resterait
  // faux après le premier démontage et la lecture ne s'afficherait jamais.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const busy = phase === "importing" || phase === "finding";

  // --- Fermer : depuis l'écran final, le toast garde l'« Annuler » ---
  function close() {
    if (busy) return;
    if (phase === "done" && result?.batchId && (result.added || result.updated || result.notInterested)) {
      const batchId = result.batchId;
      const first = data?.games.find((g) => picked[g.igdbId] && g.cover);
      toast.show({
        title: "Import Stash",
        cover: first?.cover || null,
        text: `${plural(result.added + result.updated, "jeu importé", "jeux importés")}`,
        undo: async () => {
          await apiFetch("/stash/undo", { method: "POST", token, body: { batchId } });
          refresh?.();
          onDone?.();
        },
      });
    }
    onClose();
  }

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- 1. Le pseudo → le profil ---
  async function find(e) {
    e?.preventDefault();
    const u = input.trim();
    if (!u) return;
    setPhase("finding");
    setError(null);
    try {
      const d = await apiFetch(`/stash/profile?u=${encodeURIComponent(u)}`, { token });
      if (!alive.current) return;
      setProfile(d.profile);
      setPhase("confirm");
    } catch (err) {
      if (!alive.current) return;
      setError(err.message);
      setPhase("ask");
    }
  }

  // --- 2. C'est lui : la lecture, suivie en direct ---
  async function scan() {
    setPhase("scan");
    setError(null);
    setProgress(null);
    try {
      for (;;) {
        const d = await apiFetch("/stash/preview", {
          method: "POST",
          token,
          body: { username: profile.username },
        });
        if (!alive.current) return;
        if (d.state === "done") {
          setData(d);
          setPicked(defaultPicks(d.games));
          setFilter("all");
          setPhase("review");
          return;
        }
        setProgress(d.progress);
        await sleep(POLL_MS);
        if (!alive.current) return;
      }
    } catch (err) {
      if (!alive.current) return;
      setError(err.message);
      setPhase("confirm");
    }
  }

  const chosen = useMemo(
    () => (data?.games || []).filter((g) => picked[g.igdbId]),
    [data, picked]
  );
  const shown = useMemo(
    () => (data?.games || []).filter((g) => filter === "all" || g.status === filter),
    [data, filter]
  );
  const byStatus = data?.counts?.byStatus || {};
  const allShownOn = shown.length > 0 && shown.every((g) => picked[g.igdbId]);

  function toggleShown() {
    setPicked((p) => {
      const next = { ...p };
      for (const g of shown) next[g.igdbId] = !allShownOn;
      return next;
    });
  }

  // --- 3. L'import ---
  async function run() {
    setPhase("importing");
    setError(null);
    try {
      const r = await apiFetch("/stash/import", {
        method: "POST",
        token,
        body: { items: chosen, overwriteRatings, overwriteReviews },
      });
      if (!alive.current) return;
      setResult(r);
      refresh?.();
      onDone?.();
      setPhase("done");
    } catch (err) {
      if (!alive.current) return;
      setError(err.message);
      setPhase("review");
    }
  }

  // --- 4. Tout défaire ---
  async function undo() {
    if (!result?.batchId || undoing) return;
    setUndoing(true);
    try {
      await apiFetch("/stash/undo", { method: "POST", token, body: { batchId: result.batchId } });
      if (!alive.current) return;
      refresh?.();
      onDone?.();
      setResult(null);
      setPhase("undone");
    } catch (err) {
      if (!alive.current) return;
      setError(err.message);
    } finally {
      if (alive.current) setUndoing(false);
    }
  }

  return createPortal(
    <div
      className="steam-modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="steam-modal stash-modal">
        {!busy && (
          <button className="steam-modal-close clickable" onClick={close} aria-label="Fermer">
            <X size={18} />
          </button>
        )}

        <div className="steam-modal-head stash-head">
          <StashWordmark height={22} />
        </div>

        {/* --- 1. Le pseudo --- */}
        {(phase === "ask" || phase === "finding") && (
          <form className="stash-body" onSubmit={find}>
            <div className="stash-field">
              <AtSign size={18} />
              <input
                type="text"
                placeholder="Ton pseudo Stash"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setError(null);
                }}
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={phase === "finding"}
              />
            </div>
            {error && <p className="bl-error">{error}</p>}
            <button className="stash-btn clickable" disabled={!input.trim() || phase === "finding"}>
              {phase === "finding" ? <Loader2 size={16} className="spin" /> : "Continuer"}
            </button>
          </form>
        )}

        {/* --- 2. C'est toi ? --- */}
        {phase === "confirm" && profile && (
          <div className="stash-who">
            <h3 className="stash-who-q">C'est toi ?</h3>
            <div className="stash-avatar">
              {profile.avatar ? (
                <img src={profile.avatar} alt="" draggable="false" />
              ) : (
                <span className="stash-avatar-letter">{profile.name.slice(0, 1).toUpperCase()}</span>
              )}
              <span className="stash-avatar-badge">
                <StashMark size={16} />
              </span>
            </div>
            <div className="stash-who-name">{profile.name}</div>
            <a className="stash-who-user" href={profile.url} target="_blank" rel="noreferrer">
              @{profile.username} <ExternalLink size={12} />
            </a>
            <div className="stash-who-stats">
              <span>
                <b>{profile.games}</b> jeux
              </span>
              <span>
                <b>{profile.reviews}</b> avis
              </span>
              {profile.followers > 0 && (
                <span>
                  <b>{profile.followers}</b> abonnés
                </span>
              )}
            </div>
            {error && <p className="bl-error">{error}</p>}
            <div className="stash-who-actions">
              <button
                className="stash-btn ghost clickable"
                onClick={() => {
                  setError(null);
                  setPhase("ask");
                }}
              >
                Non
              </button>
              <button className="stash-btn clickable" onClick={scan} disabled={!profile.games}>
                <Check size={16} strokeWidth={3} /> Oui, c'est moi
              </button>
            </div>
          </div>
        )}

        {/* --- 3. La lecture, en direct --- */}
        {phase === "scan" && <ScanView profile={profile} progress={progress} />}

        {/* --- 4. Ce qu'on a trouvé --- */}
        {phase === "review" && data && (
          <>
            <div className="stash-summary">
              {profile?.avatar && <img className="stash-summary-av" src={profile.avatar} alt="" />}
              <span className="stash-summary-user">@{data.username}</span>
              <span>
                <b>{data.counts.total}</b> jeux
              </span>
              <span>
                <Star size={13} /> <b>{data.counts.rated}</b>
              </span>
              <span>
                <PenLine size={13} /> <b>{data.counts.reviewed}</b>
              </span>
              {data.counts.alreadyHere > 0 && (
                <span className="bl-already">
                  <Check size={13} /> {data.counts.alreadyHere} déjà chez toi
                </span>
              )}
            </div>

            {error && <p className="bl-error px">{error}</p>}

            <div className="stash-filters">
              <button
                className={`stash-chip clickable ${filter === "all" ? "on" : ""}`}
                onClick={() => setFilter("all")}
              >
                Tout <span>{data.counts.total}</span>
              </button>
              {FILTERS.filter(([k]) => byStatus[k]).map(([k, label]) => (
                <button
                  key={k}
                  className={`stash-chip clickable ${filter === k ? "on" : ""}`}
                  onClick={() => setFilter(k)}
                >
                  {label} <span>{byStatus[k]}</span>
                </button>
              ))}
            </div>

            <div className="bl-tools">
              <button className="bl-all clickable" onClick={toggleShown}>
                {allShownOn ? "Tout décocher" : "Tout cocher"}
              </button>
              <span className="bl-count">{chosen.length} sélectionné(s)</span>
            </div>

            <div className="bl-list stash-list">
              {shown.map((g) => (
                <Row
                  key={g.igdbId}
                  game={g}
                  on={!!picked[g.igdbId]}
                  scale={scale}
                  onToggle={() => setPicked((p) => ({ ...p, [g.igdbId]: !p[g.igdbId] }))}
                />
              ))}
              {data.unmatched?.length > 0 && filter === "all" && (
                <p className="stash-unmatched">
                  {plural(data.unmatched.length, "jeu introuvable", "jeux introuvables")} dans le
                  catalogue : {data.unmatched.slice(0, 4).map((u) => u.title).join(", ")}
                  {data.unmatched.length > 4 ? "…" : ""}
                </p>
              )}
            </div>

            {/* Les écrasements se demandent, ils ne se supposent pas (cf.
                l'import Backloggd) : on complète les cases vides par défaut. */}
            {(data.games.some((g) => g.wouldOverwriteRating && picked[g.igdbId]) ||
              data.games.some((g) => g.wouldOverwriteReview && picked[g.igdbId])) && (
              <div className="bl-overwrite">
                {data.games.some((g) => g.wouldOverwriteRating && picked[g.igdbId]) && (
                  <label className="bl-check">
                    <input
                      type="checkbox"
                      checked={overwriteRatings}
                      onChange={(e) => setOverwriteRatings(e.target.checked)}
                    />
                    Remplacer mes notes existantes par celles de Stash
                  </label>
                )}
                {data.games.some((g) => g.wouldOverwriteReview && picked[g.igdbId]) && (
                  <label className="bl-check">
                    <input
                      type="checkbox"
                      checked={overwriteReviews}
                      onChange={(e) => setOverwriteReviews(e.target.checked)}
                    />
                    Remplacer mes avis existants par ceux de Stash
                  </label>
                )}
              </div>
            )}

            <div className="bl-foot">
              <button
                className="bl-link stash-back clickable"
                onClick={() => {
                  setError(null);
                  setPhase("confirm");
                }}
              >
                <ArrowLeft size={13} /> Autre profil
              </button>
              <button className="stash-btn clickable" onClick={run} disabled={!chosen.length}>
                <Sparkles size={15} /> Importer {plural(chosen.length, "jeu", "jeux")}
              </button>
            </div>
          </>
        )}

        {phase === "importing" && (
          <div className="steam-center">
            <Loader2 size={44} className="spin stash-spin" />
            <h3>Import en cours…</h3>
          </div>
        )}

        {phase === "done" && result && (
          <div className="steam-center stash-done">
            <span className="stash-done-check">
              <Check size={34} strokeWidth={3} />
            </span>
            <h3>C'est fait</h3>
            <div className="stash-done-stats">
              {result.added > 0 && (
                <span>
                  <b>{result.added}</b> {result.added > 1 ? "ajoutés" : "ajouté"}
                </span>
              )}
              {result.updated > 0 && (
                <span>
                  <b>{result.updated}</b> mis à jour
                </span>
              )}
              {result.notInterested > 0 && (
                <span>
                  <b>{result.notInterested}</b> pas intéressé
                </span>
              )}
              {!result.added && !result.updated && !result.notInterested && (
                <span>Rien de neuf : tout était déjà là.</span>
              )}
            </div>
            {error && <p className="bl-error">{error}</p>}
            <div className="stash-who-actions">
              {(result.added > 0 || result.updated > 0 || result.notInterested > 0) && (
                <button className="stash-btn ghost clickable" onClick={undo} disabled={undoing}>
                  {undoing ? <Loader2 size={15} className="spin" /> : <Undo2 size={15} />}
                  Annuler l'import
                </button>
              )}
              <button className="stash-btn clickable" onClick={close}>
                Fermer
              </button>
            </div>
          </div>
        )}

        {phase === "undone" && (
          <div className="steam-center stash-done">
            <span className="stash-done-check muted">
              <Undo2 size={30} />
            </span>
            <h3>Import annulé</h3>
            <p>Ta bibliothèque est revenue comme avant.</p>
            <div className="stash-who-actions">
              <button className="stash-btn ghost clickable" onClick={() => setPhase("review")}>
                Revoir la sélection
              </button>
              <button className="stash-btn clickable" onClick={close}>
                Fermer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ----------------------------------------------------------------------
//  L'écran d'attente : un mur de jaquettes qui se remplit, et les rayons
// ----------------------------------------------------------------------
function ScanView({ profile, progress }) {
  const shelves = progress?.shelves || {};
  const step = progress?.step || "shelves";
  const current = step === "shelves" ? progress?.shelf || "want" : step;
  const order = STEPS.map(([k]) => k);
  const at = step === "matching" ? order.length : order.indexOf(current);

  // La part lue : rayons + avis, rapportés aux compteurs du profil. Le
  // rapprochement final (quelques requêtes IGDB) prend les derniers pourcents.
  const read = Object.values(shelves).reduce((a, n) => a + (n || 0), 0) + (progress?.reviews || 0);
  const expected = Math.max(1, (profile?.games || 0) + (profile?.reviews || 0));
  const pct = step === "matching" ? 97 : Math.max(3, Math.min(94, (read / expected) * 94));

  const [wall, setWall] = useState(() => ({ slots: Array(WALL).fill(null), next: 0 }));
  // Les jaquettes déjà posées une fois : une image remplacée ne revient pas.
  const seen = useRef(new Set());
  const incoming = progress?.covers;
  useEffect(() => {
    const fresh = (incoming || []).filter((c) => !seen.current.has(c));
    if (!fresh.length) return;
    for (const c of fresh) seen.current.add(c);
    setWall((w) => placeCovers(w, fresh));
  }, [incoming]);

  return (
    <div className="stash-scan">
      <div className="stash-wall" aria-hidden="true">
        {wall.slots.map((src, i) => (
          <span key={i} className="stash-tile">
            {src && <img key={src} src={coverAtSize(src, "t_cover_small")} alt="" draggable="false" />}
          </span>
        ))}
      </div>

      <div className="stash-bar">
        <span style={{ width: `${pct}%` }} />
      </div>

      <ul className="stash-steps">
        {STEPS.map(([k, label], i) => {
          const n = k === "reviews" ? progress?.reviews || 0 : shelves[k] || 0;
          const state = i < at ? "done" : i === at ? "active" : "todo";
          return (
            <li key={k} className={`stash-step ${state}`}>
              <span className="stash-step-ico">
                {state === "done" ? (
                  <Check size={13} strokeWidth={3} />
                ) : state === "active" ? (
                  <Loader2 size={13} className="spin" />
                ) : null}
              </span>
              <span className="stash-step-label">{label}</span>
              <span className="stash-step-n">{state === "todo" ? "" : n}</span>
            </li>
          );
        })}
        <li className={`stash-step ${step === "matching" ? "active" : "todo"}`}>
          <span className="stash-step-ico">
            {step === "matching" && <Loader2 size={13} className="spin" />}
          </span>
          <span className="stash-step-label">Correspondances</span>
          <span className="stash-step-n" />
        </li>
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------------
//  Une ligne de l'aperçu
// ----------------------------------------------------------------------
function Row({ game: g, on, scale, onToggle }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      className={`bl-row stash-row clickable ${on ? "on" : ""}`}
      onClick={onToggle}
    >
      <span className="bl-cover">
        {g.cover ? (
          <img src={coverAtSize(g.cover, "t_cover_small")} alt="" loading="lazy" draggable="false" />
        ) : (
          <Gamepad2 size={15} />
        )}
      </span>
      <span className="bl-text">
        <span className="bl-name">{g.title || `Jeu #${g.igdbId}`}</span>
        <span className="bl-meta">
          <span className={`bl-status st-${g.status}`}>{STATUS_LABEL[g.status]}</span>
          {g.completion && ` · ${COMPLETION[g.completion]}`}
          {g.rating != null &&
            (scale === SCALE_STARS ? (
              <>
                {" · "}
                <Star size={11} className="stash-star" /> {formatRating(g.rating, scale)}
              </>
            ) : (
              ` · ${formatRating(g.rating, scale)}/100`
            ))}
          {g.review && " · avis"}
          {g.inLibrary && (
            <span className="bl-here">
              {g.upToDate
                ? "à jour"
                : g.currentStatus && g.currentStatus !== g.status && g.status !== "notInterested"
                  ? `${STATUS_LABEL[g.currentStatus]} → ${STATUS_LABEL[g.status]}`
                  : "déjà chez toi"}
            </span>
          )}
          {!g.inLibrary && g.upToDate && <span className="bl-here">déjà écarté</span>}
        </span>
      </span>
      <span className="bl-box">{on && <Check size={13} strokeWidth={3} />}</span>
    </button>
  );
}
