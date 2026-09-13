import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Camera,
  Check,
  Compass,
  Gamepad2,
  Heart,
  Loader2,
  MousePointerClick,
  PartyPopper,
  Plus,
  Search,
  Sparkles,
  Trophy,
  Upload,
  UserRound,
  X,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { API_BASE, apiFetch, apiUpload } from "../lib/api";
import BackloggdImportModal from "../components/BackloggdImportModal";
import CoverDrift from "../components/CoverDrift";
import DiscordIcon from "../components/DiscordIcon";
import GoogleIcon from "../components/GoogleIcon";
import SteamIcon from "../components/SteamIcon";
import SteamImportModal from "../components/SteamImportModal";

// ======================================================================
//  LE TOUR DU PROPRIÉTAIRE
// ======================================================================
//
// Cinq écrans, une minute, et on peut partir à n'importe lequel. Ce n'est pas
// un formulaire d'inscription bis : le compte existe déjà quand on arrive ici.
// C'est le moment où l'app cesse d'être vide — une photo, quelques jaquettes,
// une bibliothèque importée — parce qu'une app de bibliothèque OUVERTE SUR DU
// VIDE ne se comprend pas, et ne se garde pas.
//
// ⚠️ CHAQUE ÉTAPE DOIT POUVOIR ÊTRE SAUTÉE, ET LE BOUTON DOIT SE VOIR. Un
// parcours qu'on subit est pire que pas de parcours : on le traverse en
// cliquant n'importe où pour en sortir, et ce qu'il a récolté ne veut rien
// dire. Ici tout est optionnel, « Passer » est visible en permanence en haut à
// droite, et « Passer, c'est terminer » — sinon on le remontrerait à la
// prochaine ouverture, ce qui est exactement ce que le geste demande d'éviter.
//
// ⚠️ ET IL NE S'ÉCRIT QU'À LA FIN DE CHAQUE ÉTAPE, jamais à chaque clic. On
// coche huit jaquettes en trois secondes : envoyer huit requêtes pendant qu'on
// hésite, c'est huit occasions de désynchroniser l'écran et la base, pour un
// résultat que l'utilisateur va de toute façon modifier avant de valider.

const STEPS = ["welcome", "avatar", "taste", "import", "tips", "done"];

// Les deux façons de ranger un jeu pendant l'étape des goûts. Volontairement
// DEUX, et pas les six statuts de la bibliothèque : on répond ici à « tu l'as
// fait ou tu veux le faire ? », le reste se règle plus tard sur la fiche.
const MODES = {
  played: {
    key: "played",
    status: "finished",
    label: "Déjà joué",
    hint: "Faits",
    Icon: Trophy,
  },
  wishlist: {
    key: "wishlist",
    status: "wishlist",
    label: "À jouer",
    hint: "En attente",
    Icon: Bookmark,
  },
};

// Combien d'écritures en parallèle au moment de valider les jaquettes cochées.
// Trois : assez pour que trente jeux partent en une seconde, assez peu pour ne
// pas ouvrir trente connexions d'un coup depuis un onglet.
const FLUSH_PARALLEL = 3;

async function pool(items, size, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await worker(item);
      } catch {
        /* best-effort : un jeu qui échoue ne doit pas retenir les autres */
      }
    }
  });
  await Promise.all(runners);
}

export default function Onboarding() {
  const { user, token, updateUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const replay = params.get("replay") === "1";

  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const step = STEPS[index];

  // Ce que l'étape des goûts a coché, et qui n'est écrit qu'à sa sortie.
  // gameId -> { status, name, cover }
  const [picked, setPicked] = useState({});
  // ⚠️ CE QUI EST DÉJÀ PARTI NE REPART PAS. Revenir en arrière puis repartir
  // est un geste ordinaire ; sans cette mémoire, il réécrirait trente entrées
  // identiques à chaque aller-retour. Les cases, elles, restent cochées — les
  // décocher après enregistrement ferait croire que rien n'a été gardé.
  const flushed = useRef(new Set());
  const pending = useCallback(
    () => Object.entries(picked).filter(([id]) => !flushed.current.has(id)),
    [picked]
  );

  // ⚠️ ON PRÉCHARGE LE CATALOGUE DÈS LE PREMIER ÉCRAN. La liste des jaquettes
  // vient d'IGDB : demandée à l'ouverture de l'étape, elle arriverait pendant
  // qu'on la regarde, et la grille se remplirait sous les yeux. Demandée
  // pendant qu'on lit « Bienvenue », elle est déjà là quand on arrive.
  const [picks, setPicks] = useState(null);
  useEffect(() => {
    if (!token) return;
    apiFetch("/onboarding/picks", { token })
      .then(setPicks)
      .catch(() => setPicks({ franchises: [], games: [], degraded: true }));
  }, [token]);

  const go = useCallback((delta) => {
    setIndex((i) => Math.min(STEPS.length - 1, Math.max(0, i + delta)));
    // La fenêtre du parcours défile toute seule d'une étape à l'autre : on
    // remonte, sinon l'étape suivante s'ouvrirait à mi-hauteur.
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  // Sortir : on marque le parcours fait (« passer, c'est terminer »), on
  // envoie ce qui reste à écrire, puis on entre dans l'app.
  const finish = useCallback(
    async (rest = null) => {
      setLeaving(true);
      try {
        if (rest?.length) await flushPicks(rest, token);
        const { user: fresh } = await apiFetch("/users/me/onboarding", {
          method: "POST",
          token,
          body: { done: true },
        });
        updateUser(fresh);
      } catch {
        // ⚠️ ON ENTRE QUAND MÊME. Le drapeau se remettra au prochain passage
        // (le parcours se rejoue, ce n'est pas une perte) ; laisser quelqu'un
        // coincé sur l'écran d'accueil parce que le réseau a hoqueté, si.
        updateUser({ onboarded: true });
      }
      navigate("/app", { replace: true });
    },
    [navigate, token, updateUser]
  );

  return (
    <div className="onb">
      {/* ⚠️ LE DÉCOR EST UN PLAN, PAS UNE LUEUR. Une aurore dorée en fond
          donnait un écran de bienvenue de banque en ligne ; ici on veut la
          table de travail — un quadrillage technique gris, et derrière lui les
          jaquettes du site qui glissent, à peine lisibles. Le doré ne sert
          plus qu'aux choses qui se touchent. */}
      <div className="onb-bg" aria-hidden="true">
        <CoverDrift />
        <span className="onb-blueprint" />
        <span className="onb-vignette" />
      </div>

      <header className="onb-head">
        <span className="onb-brand">
          MyPlay<span className="onb-brand-gold">Log</span>
        </span>

        <div className="onb-progress" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`onb-pip ${i < index ? "done" : ""} ${i === index ? "now" : ""}`}
            />
          ))}
        </div>

        {step === "done" ? (
          <span className="onb-skip-ghost" />
        ) : (
          <button className="onb-skip clickable" onClick={() => finish(pending())} disabled={leaving}>
            Passer <X size={15} />
          </button>
        )}
      </header>

      <main className="onb-stage">
        {/* La clé force le remontage : c'est elle qui rejoue l'animation
            d'entrée à chaque étape, sans un seul état d'animation à tenir. */}
        <div className="onb-slide" key={step}>
          {step === "welcome" && <StepWelcome user={user} replay={replay} />}
          {step === "avatar" && <StepAvatar />}
          {step === "taste" && (
            <StepTaste picks={picks} picked={picked} onPicked={setPicked} token={token} />
          )}
          {step === "import" && <StepImport />}
          {step === "tips" && <StepTips />}
          {step === "done" && <StepDone user={user} picked={picked} />}
        </div>
      </main>

      <footer className="onb-foot">
        <button
          className="onb-back clickable"
          onClick={() => go(-1)}
          disabled={index === 0 || leaving}
        >
          <ArrowLeft size={16} /> Retour
        </button>

        {step === "done" ? (
          <button className="onb-next clickable" onClick={() => finish()} disabled={leaving}>
            {leaving ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
            Entrer
          </button>
        ) : (
          <NextButton
            step={step}
            picked={picked}
            pending={pending}
            flushed={flushed}
            token={token}
            onDone={() => go(1)}
            disabled={leaving}
          />
        )}
      </footer>
    </div>
  );
}

// Le bouton « Suivant ». Sur l'étape des goûts il ÉCRIT avant d'avancer : c'est
// le seul endroit du parcours qui a des choses en attente, et les laisser filer
// vers l'écran suivant sans repère (« est-ce que c'est enregistré ? ») serait la
// seule vraie source d'inquiétude du parcours.
function NextButton({ step, picked, pending, flushed, token, onDone, disabled }) {
  const { upsertLocal } = useLibrary();
  const [busy, setBusy] = useState(false);
  const entries = Object.entries(picked);

  async function next() {
    const rest = step === "taste" ? pending() : [];
    if (!rest.length) return onDone();
    setBusy(true);
    await flushPicks(rest, token, upsertLocal);
    for (const [id] of rest) flushed.current.add(id);
    setBusy(false);
    onDone();
  }

  const label =
    step === "taste" && entries.length
      ? `Ajouter ${entries.length} jeu${entries.length > 1 ? "x" : ""}`
      : step === "welcome"
        ? "C'est parti"
        : "Continuer";

  return (
    <button className="onb-next clickable" onClick={next} disabled={busy || disabled}>
      {busy ? <Loader2 className="spin" size={17} /> : null}
      {label}
      {!busy && <ArrowRight size={17} />}
    </button>
  );
}

// Écrit les jaquettes cochées dans la bibliothèque. `upsertLocal` est facultatif
// (absent quand on sort du parcours en catastrophe) : la bibliothèque se
// rechargera d'elle-même à la première page qui la lit.
async function flushPicks(entries, token, upsertLocal) {
  await pool(entries, FLUSH_PARALLEL, async ([gameId, pick]) => {
    const { entry } = await apiFetch(`/library/${gameId}`, {
      method: "PUT",
      token,
      body: { status: pick.status, name: pick.name, cover: pick.cover || null },
    });
    upsertLocal?.(Number(gameId), entry);
  });
}

// ======================================================================
//  1 — Bienvenue
// ======================================================================
function StepWelcome({ user, replay }) {
  const name = user?.username || "toi";
  return (
    <section className="onb-step onb-hero">
      <span className="onb-kicker">
        <Sparkles size={13} /> {replay ? "Le tour, à nouveau" : "Bienvenue"}
      </span>
      <h1 className="onb-title">
        Salut <span className="onb-gold">{name}</span>,<br />
        on range tes jeux ?
      </h1>
      <p className="onb-lede">Trois questions, une minute. Tout est facultatif.</p>

      <ul className="onb-agenda">
        {[
          { Icon: Camera, t: "Ta photo", s: "Discord, Google, ou la tienne" },
          { Icon: Gamepad2, t: "Tes jeux", s: "Coche des jaquettes" },
          { Icon: Compass, t: "Ta bibliothèque", s: "Steam, Backloggd" },
        ].map(({ Icon, t, s }, i) => (
          <li key={t} className="onb-agenda-item" style={{ "--d": `${i * 90}ms` }}>
            <span className="onb-agenda-icon">
              <Icon size={19} />
            </span>
            <span>
              <strong>{t}</strong>
              <em>{s}</em>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ======================================================================
//  2 — La photo de profil
// ======================================================================
// ⚠️ LA PREMIÈRE PROPOSITION EST CELLE QU'ON A DÉJÀ. Quelqu'un qui vient
// d'ouvrir son compte avec Discord ou Google a une photo chez eux, et la
// meilleure façon de lui demander la sienne est de la lui MONTRER : un clic,
// c'est fini. Lui présenter un champ « choisir un fichier » alors qu'on a son
// portrait sous la main, c'est lui faire chercher ce qu'on tient déjà.
function StepAvatar() {
  const { user, token, updateUser } = useAuth();
  const [busy, setBusy] = useState(null); // la source en cours d'envoi
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const current = user?.avatar || null;

  // Les portraits déjà disponibles, dédoublonnés : lier Google puis Discord
  // avec la même photo ne doit pas donner deux fois la même case.
  const sources = useMemo(() => {
    const out = [];
    const seen = new Set();
    const add = (key, url, label, Badge) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      out.push({ key, url, label, Badge });
    };
    add("current", current, "Actuelle", UserRound);
    add("discord", user?.discord?.avatar, "Discord", DiscordIcon);
    add("google", user?.google?.avatar, "Google", GoogleIcon);
    add("steam", user?.steam?.avatar, "Steam", SteamIcon);
    return out;
  }, [current, user]);

  async function choose(url) {
    if (url === current) return;
    setBusy(url);
    setError(null);
    try {
      const { user: fresh } = await apiFetch("/users/me", {
        method: "PUT",
        token,
        body: { avatar: url },
      });
      updateUser(fresh);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function upload(file) {
    if (!file) return;
    setBusy("upload");
    setError(null);
    try {
      const form = new FormData();
      form.append("avatar", file);
      const data = await apiUpload("/users/me/avatar", form, token);
      updateUser(data.user || { avatar: data.avatar });
    } catch (e) {
      setError(e.message || "L'envoi a échoué.");
    } finally {
      setBusy(null);
    }
  }

  const initial = (user?.username || "?")[0].toUpperCase();

  return (
    <section className="onb-step">
      <StepHead
        n="1"
        title="Une photo ?"
        sub="Ce que les autres verront à côté de tes avis."
      />

      <div className="onb-avatar-row">
        <div className="onb-avatar-big">
          {current ? <img src={current} alt="" /> : <span>{initial}</span>}
          {busy && <span className="onb-avatar-busy"><Loader2 className="spin" size={22} /></span>}
        </div>

        <div className="onb-avatar-choices">
          {sources.map(({ key, url, label, Badge }) => (
            <button
              key={key}
              className={`onb-av clickable ${url === current ? "active" : ""}`}
              onClick={() => choose(url)}
              disabled={!!busy}
              title={label}
            >
              <img src={url} alt="" />
              <span className="onb-av-badge">
                <Badge size={13} />
              </span>
              {url === current && (
                <span className="onb-av-check">
                  <Check size={14} strokeWidth={3} />
                </span>
              )}
              <span className="onb-av-label">{label}</span>
            </button>
          ))}

          <button
            className="onb-av onb-av-upload clickable"
            onClick={() => fileRef.current?.click()}
            disabled={!!busy}
          >
            <span className="onb-av-plus">
              <Upload size={20} />
            </span>
            <span className="onb-av-label">Envoyer</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {!sources.length && (
        <p className="onb-note">Rien à récupérer : envoie une image, ou passe.</p>
      )}
      {error && <p className="onb-error">{error}</p>}
    </section>
  );
}

// ======================================================================
//  3 — Les jeux
// ======================================================================
// L'étape qui décide si le compte servira à quelque chose. Elle tient en un
// geste : un interrupteur en haut (« j'y ai joué » / « je veux y jouer »), et
// une grille de jaquettes qu'on coche.
//
// ⚠️ LA RANGÉE DE SAGAS N'EST PAS UNE DÉCORATION, C'EST LE MOTEUR DE LA GRILLE.
// Une grille de « jeux populaires » est la même pour tout le monde et ne
// ressemble à personne : au bout de vingt cases, celui qui ne joue qu'à Zelda
// et Pokémon n'a rien trouvé. Ouvrir une saga REMPLACE la grille par ses jeux à
// elle — deux clics pour cocher dix Final Fantasy, ce qu'aucun champ de
// recherche ne permet.
function StepTaste({ picks, picked, onPicked, token }) {
  const [mode, setMode] = useState("played");
  const [saga, setSaga] = useState(null); // { kind, id, name } — la saga ouverte
  const [sagaGames, setSagaGames] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  // Recherche libre : le filet pour tout ce que ni la grille ni les sagas
  // n'ont proposé. Temporisée, sinon chaque lettre part chez IGDB.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      apiFetch(`/games?search=${encodeURIComponent(q)}&limit=24`, { token })
        .then((d) => setResults(d.games || []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [query, token]);

  async function openSaga(s) {
    if (saga?.id === s.id && saga?.kind === s.kind) {
      setSaga(null);
      setSagaGames(null);
      return;
    }
    setSaga(s);
    setSagaGames(null);
    setLoading(true);
    try {
      const d = await apiFetch(`/games/franchises/${s.kind}/${s.id}`, { token });
      // Les jeux d'une saga arrivent du plus récent au plus ancien et
      // contiennent tout — y compris des sorties confidentielles. On garde
      // celles qui ont une jaquette, dans la limite d'un écran.
      setSagaGames((d.games || []).filter((g) => g.cover).slice(0, 30));
    } catch {
      setSagaGames([]);
    } finally {
      setLoading(false);
    }
  }

  function toggle(game) {
    const id = String(game.id);
    onPicked((prev) => {
      const next = { ...prev };
      const cur = next[id];
      // Un clic pose le jeu dans le mode courant ; un clic sur un jeu DÉJÀ posé
      // dans ce mode-là le retire. Recliquer dans l'autre mode le déplace,
      // sans qu'on ait à le décocher d'abord.
      if (cur && cur.status === MODES[mode].status) delete next[id];
      else next[id] = { status: MODES[mode].status, name: game.name, cover: game.cover || null };
      return next;
    });
  }

  const grid = results ?? sagaGames ?? picks?.games ?? null;
  const count = Object.keys(picked).length;

  return (
    <section className="onb-step onb-step-wide">
      <StepHead
        n="2"
        title="À quoi tu joues ?"
        sub="Coche ce que tu reconnais. Corrigeable après."
      />

      <div className="onb-modes">
        {Object.values(MODES).map((m) => (
          <button
            key={m.key}
            className={`onb-mode clickable ${mode === m.key ? "active" : ""}`}
            onClick={() => setMode(m.key)}
          >
            <m.Icon size={16} />
            <span>
              <strong>{m.label}</strong>
              <em>{m.hint}</em>
            </span>
          </button>
        ))}
      </div>

      {/* Les sagas : la rangée qui remplace la grille. */}
      {picks?.franchises?.length > 0 && (
        <div className="onb-sagas" role="tablist">
          {picks.franchises.map((s) => (
            <button
              key={`${s.kind}:${s.id}`}
              role="tab"
              aria-selected={saga?.id === s.id && saga?.kind === s.kind}
              className={`onb-saga clickable ${saga?.id === s.id && saga?.kind === s.kind ? "active" : ""}`}
              onClick={() => openSaga(s)}
              title={s.name}
            >
              <img src={s.cover} alt="" loading="lazy" />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="onb-searchbar">
        <Search size={16} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ou cherche un jeu précis…"
        />
        {query && (
          <button className="onb-search-clear clickable" onClick={() => setQuery("")} aria-label="Effacer">
            <X size={15} />
          </button>
        )}
      </div>

      {(saga || results) && (
        <div className="onb-scope">
          <span>
            {results
              ? `Résultats pour « ${query.trim()} »`
              : `Saga ${saga.name}`}
          </span>
          <button
            className="onb-scope-back clickable"
            onClick={() => {
              setQuery("");
              setResults(null);
              setSaga(null);
              setSagaGames(null);
            }}
          >
            Les incontournables
          </button>
        </div>
      )}

      {grid === null ? (
        <div className="onb-grid">
          {Array.from({ length: 18 }).map((_, i) => (
            <span key={i} className="onb-tile onb-tile-skel" />
          ))}
        </div>
      ) : grid.length === 0 ? (
        <p className="onb-note">
          {loading ? "Recherche…" : "Rien trouvé. Essaie un autre titre."}
        </p>
      ) : (
        <div className="onb-grid">
          {grid.map((g) => {
            const pick = picked[String(g.id)];
            return (
              <button
                key={g.id}
                className={`onb-tile clickable ${pick ? `picked ${pick.status}` : ""}`}
                onClick={() => toggle(g)}
                title={g.name}
              >
                {g.cover ? (
                  <img src={g.cover} alt="" loading="lazy" />
                ) : (
                  <span className="onb-tile-noart">{g.name}</span>
                )}
                <span className="onb-tile-veil" />
                <span className="onb-tile-mark">
                  {pick ? (
                    pick.status === "wishlist" ? (
                      <Bookmark size={17} fill="currentColor" />
                    ) : (
                      <Check size={18} strokeWidth={3} />
                    )
                  ) : (
                    <Plus size={17} strokeWidth={2.6} />
                  )}
                </span>
                <span className="onb-tile-name">{g.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Le compteur suit le bas de l'écran : c'est la seule récompense de
          l'étape, elle doit rester sous les yeux pendant qu'on coche. */}
      {count > 0 && (
        <div className="onb-tally">
          <Heart size={14} fill="currentColor" />
          {count} jeu{count > 1 ? "x" : ""} sélectionné{count > 1 ? "s" : ""}
        </div>
      )}
    </section>
  );
}

// ======================================================================
//  4 — L'import
// ======================================================================
// Les modales d'import existent déjà et sont bien meilleures que tout ce qu'on
// referait ici en petit : on les OUVRE, on ne les réécrit pas. Cette étape
// n'est qu'une vitrine — quelles portes existent, lesquelles sont ouvertes.
const SOON = [
  { key: "psn", label: "PlayStation" },
  { key: "xbox", label: "Xbox" },
  { key: "switch", label: "Nintendo" },
  { key: "epic", label: "Epic Games" },
  { key: "gog", label: "GOG" },
];

function StepImport() {
  const { user, token, updateUser } = useAuth();
  const { refresh } = useLibrary();
  const [status, setStatus] = useState(null); // /steam/status
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [steamOpen, setSteamOpen] = useState(false);
  const [backloggdOpen, setBackloggdOpen] = useState(false);
  const popupRef = useRef(null);

  const load = useCallback(() => {
    apiFetch("/steam/status", { token })
      .then(setStatus)
      .catch(() => setStatus({ configured: true, connected: false }));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // La pop-up OpenID de Steam prévient la page quand elle a fini (même
  // chorégraphie que les paramètres, cf. pages/Settings.jsx).
  useEffect(() => {
    function onMsg(e) {
      if (e.data?.type !== "mpl-steam") return;
      setBusy(false);
      if (e.data.ok) {
        setError(null);
        updateUser({ steamConnected: true });
        load();
      } else {
        setError(e.data.error || "La liaison Steam a échoué.");
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [load, updateUser]);

  function linkSteam() {
    setError(null);
    setBusy(true);
    const w = 720;
    const h = 720;
    const y = window.top.outerHeight / 2 + window.top.screenY - h / 2;
    const x = window.top.outerWidth / 2 + window.top.screenX - w / 2;
    popupRef.current = window.open(
      `${API_BASE}/steam/login?token=${encodeURIComponent(token)}`,
      "mpl-steam-onboarding",
      `width=${w},height=${h},left=${x},top=${y}`
    );
    const timer = setInterval(() => {
      if (popupRef.current?.closed) {
        clearInterval(timer);
        setBusy((b) => {
          if (b) load();
          return false;
        });
      }
    }, 700);
  }

  const steamLinked = !!(status?.connected || user?.steamConnected);

  return (
    <section className="onb-step onb-step-wide">
      <StepHead
        n="3"
        title="Une bibliothèque ailleurs ?"
        sub="Tu valides jeu par jeu avant que rien ne bouge."
      />

      {error && <p className="onb-error">{error}</p>}

      <div className="onb-imports">
        <article className={`onb-import ${steamLinked ? "linked" : ""}`}>
          <span className="onb-import-logo steam">
            <SteamIcon size={26} />
          </span>
          <h3>Steam</h3>
          <p>
            {steamLinked
              ? `Lié${status?.steam?.personaName ? ` : ${status.steam.personaName}` : ""}. Heures et succès compris.`
              : "Jeux, heures de jeu et succès."}
          </p>
          {steamLinked ? (
            <button className="onb-import-btn primary clickable" onClick={() => setSteamOpen(true)}>
              <Sparkles size={16} /> Importer
            </button>
          ) : (
            <button
              className="onb-import-btn clickable"
              onClick={linkSteam}
              disabled={busy || status?.configured === false}
            >
              {busy ? <Loader2 className="spin" size={16} /> : <SteamIcon size={16} />}
              Lier Steam
            </button>
          )}
        </article>

        <article className="onb-import">
          <span className="onb-import-logo backloggd">
            <Gamepad2 size={26} />
          </span>
          <h3>Backloggd</h3>
          <p>Ton pseudo suffit. Notes et avis compris.</p>
          <button className="onb-import-btn clickable" onClick={() => setBackloggdOpen(true)}>
            <ArrowRight size={16} /> Importer
          </button>
        </article>
      </div>

      <div className="onb-soon">
        <span className="onb-soon-label">Bientôt</span>
        {SOON.map((s) => (
          <span key={s.key} className="onb-soon-chip">
            {s.label}
          </span>
        ))}
      </div>

      {steamOpen && (
        <SteamImportModal
          onClose={() => setSteamOpen(false)}
          onDone={() => refresh?.()}
        />
      )}
      {backloggdOpen && (
        <BackloggdImportModal
          onClose={() => setBackloggdOpen(false)}
          onDone={() => refresh?.()}
        />
      )}
    </section>
  );
}

// ======================================================================
//  5 — Les gestes
// ======================================================================
// ⚠️ TROIS, ET SEULEMENT DES GESTES QUI EXISTENT VRAIMENT. Une page d'astuces
// se lit une fois : au-delà de trois, on la saute — et une astuce fausse est
// pire qu'aucune astuce, parce qu'on la cherche ensuite pendant dix minutes.
const TIPS = [
  {
    Icon: MousePointerClick,
    title: "Survole une jaquette",
    body: "Le « + » déplie de quoi la ranger, sans quitter la page.",
  },
  {
    Icon: Search,
    title: "La recherche, en haut",
    body: "Jeux ou joueurs : le bouton à sa gauche bascule.",
  },
  {
    Icon: UserRound,
    title: "Ton profil est ta vitrine",
    body: "Sections déplaçables à la souris, bannière à six images.",
  },
];

function StepTips() {
  return (
    <section className="onb-step">
      <StepHead
        n="4"
        title="Trois gestes"
        sub="Le reste s'apprend tout seul."
      />
      <ul className="onb-tips">
        {TIPS.map(({ Icon, title, body }, i) => (
          <li key={title} className="onb-tip" style={{ "--d": `${i * 110}ms` }}>
            <span className="onb-tip-icon">
              <Icon size={20} />
            </span>
            <div>
              <strong>{title}</strong>
              <p>{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ======================================================================
//  6 — Fini
// ======================================================================
function StepDone({ user, picked }) {
  const count = Object.keys(picked).length;
  return (
    <section className="onb-step onb-hero onb-done">
      <span className="onb-burst" aria-hidden="true">
        <PartyPopper size={34} />
      </span>
      <h1 className="onb-title">
        C'est prêt, <span className="onb-gold">{user?.username}</span>.
      </h1>
      <p className="onb-lede">
        {count > 0
          ? `${count} jeu${count > 1 ? "x" : ""} dans ta bibliothèque. À toi de jouer.`
          : "Ta bibliothèque t'attend. À toi de jouer."}
      </p>
      <p className="onb-replay-note">Rejouable dans Paramètres → Compte.</p>
    </section>
  );
}

function StepHead({ n, title, sub }) {
  return (
    <header className="onb-step-head">
      <span className="onb-step-n">{n}</span>
      <h2>{title}</h2>
      <p>{sub}</p>
    </header>
  );
}
