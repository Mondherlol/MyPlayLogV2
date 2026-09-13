import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Heart,
  Image as ImageIcon,
  Loader2,
  MoveHorizontal,
  Music,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
  Search,
  Sparkles,
  Trophy,
  Upload,
  X,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { usePlayer } from "../context/PlayerContext";
import { API_BASE, apiFetch, apiUpload } from "../lib/api";
import { platformBrand } from "../lib/platformIcons";
import { SCALE_100, SCALE_STARS, setRatingScale, useRatingScale } from "../lib/ratingScale";
import { STORES } from "../lib/storeIcons";
import AddItemsModal from "../components/AddItemsModal";
import BackloggdImportModal from "../components/BackloggdImportModal";
import BackloggdIcon from "../components/BackloggdIcon";
import CoverPickerModal from "../components/CoverPickerModal";
import DiscordIcon from "../components/DiscordIcon";
import FavoritePicker from "../components/FavoritePicker";
import GoogleIcon from "../components/GoogleIcon";
import RatingGauge from "../components/RatingGauge";
import ReframeCoverModal from "../components/ReframeCoverModal";
import StarRating from "../components/StarRating";
import SteamIcon from "../components/SteamIcon";
import SteamImportModal from "../components/SteamImportModal";
import TastePickerModal from "../components/TastePickerModal";

// ======================================================================
//  LE TOUR DU PROPRIÉTAIRE
// ======================================================================
//
// Cinq écrans, chacun tient sur UNE page : pas de défilement, pas de
// paragraphe, une phrase et un geste. Photo, envies, déjà-joué, import — et
// l'arrivée sur son profil, qui est la récompense du parcours.
//
// ⚠️ UNE PHRASE PAR ÉCRAN, ET ELLE DIT QUOI FAIRE. Les mots qui comptent
// (« 3 jeux », « ta photo ») sont en couleur, et ce sont les seuls qu'on lit.
//
// ⚠️ LE BOUTON PRINCIPAL EST AUSSI LE COMPTEUR. Il se remplit à mesure qu'on
// choisit (« Encore 2 ») et devient « Continuer » une fois plein.
//
// ⚠️ ET IL NE S'ÉCRIT QU'À LA SORTIE DE CHAQUE ÉCRAN, jamais à chaque clic.

const STEPS = ["avatar", "wishlist", "played", "import", "profile"];

// ⚠️ DEUX COULEURS, ET ELLES VEULENT DIRE QUELQUE CHOSE. Le doré dit « fait »
// (terminé, validé) ; le rose dit « envie » — le cœur, les favoris. Chaque
// écran de choix prend la sienne pour ce qui est À LUI : les mots du titre,
// les cartes choisies, le bouton qui se remplit. Jamais le fond.
//
// `need` se compte SUR LA BIBLIOTHÈQUE AUSSI : qui arrive avec trente jeux n'a
// rien à prouver, le bouton est plein d'emblée. `source` : la liste de la roue
// (cf. server/src/routes/onboarding.js). `rate` : on propose de noter chaque
// jeu choisi — un jeu fini a une note, une envie n'en a pas encore.
const PICKS = {
  wishlist: {
    status: "wishlist",
    need: 3,
    source: "awaited",
    accent: "rose",
    rate: false,
    title: "Choisis *3 jeux* qui te font envie",
  },
  played: {
    status: "finished",
    need: 1,
    source: "games",
    accent: "gold",
    rate: true,
    title: "Et *1 jeu* que tu as déjà fini",
  },
};

const TITLES = {
  avatar: "Choisis ta *photo*",
  import: "Importe ta *bibliothèque*",
  profile: "Voilà *ton profil*",
};

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

async function flushPicks(entries, token, upsertLocal) {
  await pool(entries, FLUSH_PARALLEL, async ([gameId, pick]) => {
    const { entry } = await apiFetch(`/library/${gameId}`, {
      method: "PUT",
      token,
      body: {
        status: pick.status,
        name: pick.name,
        cover: pick.cover || null,
        // La note n'est envoyée QUE si elle a été posée : envoyer `null`
        // effacerait celle d'une entrée déjà notée ailleurs. Même règle pour
        // la piste et le personnage, que `PUT /library/:id` sait ranger.
        ...(pick.rating != null ? { rating: pick.rating } : {}),
        ...(pick.favoriteOst ? { favoriteOst: pick.favoriteOst } : {}),
        ...(pick.favoriteCharacter ? { favoriteCharacter: pick.favoriteCharacter } : {}),
      },
    });
    upsertLocal?.(Number(gameId), entry);
  });
}

// Une note sur 100, lue dans l'échelle de l'utilisateur.
function formatRating(value, scale) {
  if (value == null) return null;
  return scale === SCALE_STARS ? `${Number((value / 20).toFixed(1))}★` : `${value}%`;
}

export default function Onboarding() {
  const { user, token, updateUser } = useAuth();
  const { map: library, upsertLocal } = useLibrary();
  const navigate = useNavigate();

  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const step = STEPS[index];

  const [picked, setPicked] = useState({});
  // Ce qui est déjà parti au serveur : revenir en arrière puis repartir ne
  // réécrit pas trente entrées identiques.
  const flushed = useRef(new Set());

  // Le jeu qu'on est en train de noter (étape « déjà fini »).
  const [rateFor, setRateFor] = useState(null);

  // ⚠️ ON PRÉCHARGE LA ROUE DÈS LA PHOTO. Demandées à l'ouverture de l'étape,
  // les jaquettes arriveraient pendant qu'on la regarde tourner.
  const [picks, setPicks] = useState(null);
  useEffect(() => {
    if (!token) return;
    apiFetch("/onboarding/picks", { token })
      .then((d) => {
        if (d?.games?.length) return setPicks(d);
        throw new Error("vide");
      })
      // ⚠️ LA ROUE NE RESTE JAMAIS VIDE. `/onboarding/picks` est une route
      // neuve : un client à jour peut parler à un serveur qui ne la connaît pas
      // encore (404), et l'étape affichait « Aucun jeu trouvé » à la place des
      // jaquettes. Le catalogue trié par popularité, lui, existe depuis
      // toujours — c'est le même classement, sans le tri par saga.
      .catch(() =>
        apiFetch("/games?sort=popularity&dir=desc&limit=40", { token })
          .then((d) => {
            const games = (d.games || []).filter((g) => g.cover);
            setPicks({ games, awaited: games });
          })
          .catch(() => setPicks({ games: [], awaited: [] }))
      );
  }, [token]);

  // Ce qu'il a déjà. La carte de la bibliothèque reçoit aussi ce que le
  // parcours vient d'écrire (`upsertLocal`), donc ces nombres incluent les
  // choix déjà envoyés — et le profil de la fin les montre à jour.
  const have = useMemo(() => {
    let wishlist = 0;
    let played = 0;
    let favorites = 0;
    for (const e of Object.values(library || {})) {
      if (e?.favorite) favorites += 1;
      if (!e?.status) continue;
      if (e.status === "wishlist") wishlist += 1;
      else played += 1;
    }
    return { wishlist, played, favorites };
  }, [library]);

  const pending = () => Object.entries(picked).filter(([id]) => !flushed.current.has(id));

  async function flush() {
    const rest = pending();
    if (!rest.length) return;
    await flushPicks(rest, token, upsertLocal);
    for (const [id] of rest) flushed.current.add(id);
  }

  // « Passer, c'est terminer » — sinon on remontrerait le parcours à la
  // prochaine ouverture, ce que le geste demande précisément d'éviter.
  async function finish(to) {
    setBusy(true);
    try {
      await flush();
      const { user: fresh } = await apiFetch("/users/me/onboarding", { method: "POST", token });
      updateUser(fresh);
    } catch {
      // ⚠️ ON ENTRE QUAND MÊME : le drapeau se reposera au prochain passage,
      // alors qu'un compte coincé sur l'écran d'accueil ne se rattrape pas.
      updateUser({ onboarded: true });
    }
    navigate(to, { replace: true });
  }

  function goTo(i) {
    setRateFor(null);
    setIndex(Math.max(0, Math.min(STEPS.length - 1, i)));
  }

  async function next() {
    if (step === "profile") {
      return finish(user?.username ? `/u/${encodeURIComponent(user.username)}` : "/app");
    }
    setBusy(true);
    await flush();
    setBusy(false);
    goTo(index + 1);
  }

  // ⚠️ UNE FUSION, PAS UN REMPLACEMENT. Le panneau rend ce qu'il a récolté
  // (note, piste, personnage) : chacun est facultatif, et repasser dessus ne
  // doit pas effacer ce que le précédent avait posé.
  const setExtras = useCallback((id, patch) => {
    setPicked((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));
  }, []);

  const conf = PICKS[step] || null;
  const chosen = conf
    ? pending().filter(([, pick]) => pick.status === conf.status).length
    : 0;
  const total = conf ? chosen + have[step] : 0;
  const remaining = conf ? Math.max(0, conf.need - total) : 0;
  const fill = conf ? Math.min(1, total / conf.need) : 1;

  const label =
    step === "profile" ? "Voir mon profil" : remaining ? `Encore ${remaining}` : "Continuer";

  return (
    <div className="onb" data-accent={conf?.accent || "gold"}>
      <div className="onb-bg" aria-hidden="true" />

      <header className="onb-top">
        <div className="onb-bar" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s} className={i <= index ? "is-on" : ""} />
          ))}
        </div>
        <div className="onb-toprow">
          <span />
          {step !== "profile" && (
            <button className="onb-skip clickable" onClick={() => finish("/app")} disabled={busy}>
              Passer
            </button>
          )}
        </div>
      </header>

      {/* La clé remonte l'écran à chaque étape : c'est elle qui rejoue
          l'entrée, et qui remet la recherche à zéro. */}
      <main className="onb-main" key={step}>
        <Headline
          text={conf ? conf.title : TITLES[step]}
          sub={step === "profile" ? "Rends-le unique." : null}
        />
        <div className="onb-stage">
          {step === "avatar" && <StepAvatar />}
          {conf && (
            <PickStage
              conf={conf}
              picks={picks}
              picked={picked}
              onPicked={setPicked}
              flushed={flushed}
              library={library}
              token={token}
              onRate={setRateFor}
            />
          )}
          {step === "import" && <StepImport />}
          {step === "profile" && <StepProfile user={user} picked={picked} have={have} />}
        </div>
      </main>

      <footer className="onb-cta">
        <button
          className="onb-round clickable"
          onClick={() => goTo(index - 1)}
          disabled={index === 0 || busy}
          data-hidden={index === 0}
          aria-label="Retour"
        >
          <ArrowLeft size={20} />
        </button>
        <button
          className="onb-go clickable"
          onClick={next}
          disabled={!!remaining || busy}
          data-blocked={!!remaining}
          style={{ "--fill": fill }}
        >
          <span className="onb-go-fill" />
          <span className="onb-go-label">
            {busy ? <Loader2 className="spin" size={19} /> : label}
          </span>
        </button>
      </footer>

      {/* ⚠️ AU-DESSUS DU BOUTON DU BAS, PAS DANS LA SCÈNE. Posé dans la scène,
          le panneau restait sous « Continuer » (la scène et le bas ont chacun
          leur couche) : on notait un jeu avec un bouton en travers. */}
      {rateFor && (
        <RatePanel
          game={rateFor}
          pick={picked[String(rateFor.id)] || null}
          onSave={(patch) => setExtras(String(rateFor.id), patch)}
          onClose={() => setRateFor(null)}
        />
      )}
    </div>
  );
}

// Le titre d'un écran. Les mots entre astérisques passent en couleur : c'est
// la seule mise en forme du parcours, et elle porte l'information.
function Headline({ text, sub }) {
  const parts = String(text).split("*");
  return (
    <div className="onb-headline">
      <h1>
        {parts.map((part, i) => (i % 2 ? <em key={i}>{part}</em> : <span key={i}>{part}</span>))}
      </h1>
      {sub && <p>{sub}</p>}
    </div>
  );
}

// La loupe, qui s'ouvre en champ, curseur dedans.
function SearchPill({ open, value, onOpen, onChange, onClose }) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  return (
    <div className={`onb-search ${open ? "is-open" : ""}`}>
      <button
        className="onb-search-btn clickable"
        onClick={open ? onClose : onOpen}
        aria-label={open ? "Fermer la recherche" : "Chercher un jeu"}
      >
        {open ? <X size={18} /> : <Search size={18} />}
      </button>
      {open && (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          placeholder="Nom du jeu…"
        />
      )}
    </div>
  );
}

// ======================================================================
//  1 — La photo
// ======================================================================
// ⚠️ UNE PHOTO QU'ON A ENVOYÉE NE DISPARAÎT PAS QUAND ON EN CHOISIT UNE
// AUTRE. La rangée se déduisait de la photo EN COURS : passer à celle de Steam
// faisait donc disparaître la sienne. Les photos personnelles vivent dans une
// liste à part, qui ne fait que grandir le temps de l'écran.
//
// ⚠️ ET L'ANCIENNE PHOTO RESTE AFFICHÉE TANT QUE LA NOUVELLE N'EST PAS
// CHARGÉE — changer `src` d'un coup vidait le cercle une fraction de seconde.
function StepAvatar() {
  const { user, token, updateUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const current = user?.avatar || null;
  const providers = [
    ["discord", user?.discord?.avatar, DiscordIcon],
    ["google", user?.google?.avatar, GoogleIcon],
    ["steam", user?.steam?.avatar, SteamIcon],
  ].filter(([, url]) => url);

  const [customs, setCustoms] = useState(() =>
    current && !providers.some(([, url]) => url === current) ? [current] : []
  );

  const [shown, setShown] = useState(current);
  useEffect(() => {
    if (!current) {
      setShown(null);
      return undefined;
    }
    let alive = true;
    const img = new Image();
    img.onload = img.onerror = () => alive && setShown(current);
    img.src = current;
    return () => {
      alive = false;
    };
  }, [current]);

  async function choose(url) {
    if (url === current || busy) return;
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("avatar", file);
      const data = await apiUpload("/users/me/avatar", form, token);
      const url = data.avatar || data.user?.avatar;
      if (url) setCustoms((list) => (list.includes(url) ? list : [url, ...list]));
      updateUser(data.user || { avatar: url });
    } catch (e) {
      setError(e.message || "L'envoi a échoué.");
    } finally {
      setBusy(false);
    }
  }

  const initial = (user?.username || "?")[0].toUpperCase();

  return (
    <div className="onb-avatar">
      <div className={`onb-avatar-ring ${busy ? "is-busy" : ""}`}>
        <div className="onb-avatar-img">
          {shown ? <img src={shown} alt="" /> : <span>{initial}</span>}
        </div>
      </div>

      <div className="onb-bubbles">
        {customs.map((url) => (
          <button
            key={url}
            className={`onb-bubble clickable ${url === current ? "is-on" : ""}`}
            onClick={() => choose(url)}
            disabled={busy}
            aria-label="Ma photo"
          >
            <img src={url} alt="" />
          </button>
        ))}
        {providers.map(([key, url, Badge]) => (
          <button
            key={key}
            className={`onb-bubble clickable ${url === current ? "is-on" : ""}`}
            onClick={() => choose(url)}
            disabled={busy}
            aria-label={`Photo ${key}`}
          >
            <img src={url} alt="" />
            <span className={`onb-bubble-badge ${key}`}>
              <Badge size={12} />
            </span>
          </button>
        ))}
        <button
          className="onb-bubble onb-bubble-up clickable"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label="Envoyer une image"
        >
          <Upload size={20} />
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

      {error && <p className="onb-error">{error}</p>}
    </div>
  );
}

// ======================================================================
//  2 et 3 — La roue, ce qu'on a choisi, et la recherche
// ======================================================================
// ⚠️ LE PLATEAU CHANGE DE PLACE SELON L'ÉCRAN, ET C'EST TOUT L'INTÉRÊT.
// Sur ordinateur la roue est en haut de sa zone : les jeux choisis se posent
// en dessous. Sur un téléphone la roue est descendue vers le pouce, et c'est
// le HAUT qui est libre : le plateau y monte (cf. `order` en feuille de style).
// Dans les deux cas, le jeu qu'on vient d'attraper — noté ou non — atterrit
// dans l'espace vide, jamais par-dessus la roue.
//
// ⚠️ LA RECHERCHE EST EN BAS, À CÔTÉ DE « AUCUN ? » : c'est là qu'on arrive
// quand la roue n'a pas ce qu'on cherche, et là que se trouve le pouce.
//
// ⚠️ ON RETIRE CE QU'IL A DÉJÀ. Poser sur la roue un jeu déjà dans sa
// bibliothèque, c'est lui redemander un choix qu'il a déjà fait.
function PickStage({ conf, picks, picked, onPicked, flushed, library, token, onRate }) {
  const scale = useRatingScale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      apiFetch(`/games?search=${encodeURIComponent(q)}&limit=36`, { token })
        .then((d) => alive && setResults(d.games || []))
        .catch(() => alive && setResults([]))
        .finally(() => alive && setLoading(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, token]);

  const games = useMemo(() => {
    // Les attendus peuvent manquer (IGDB muet) : la roue retombe alors sur les
    // incontournables plutôt que de s'afficher vide.
    const base = picks ? (picks[conf.source]?.length ? picks[conf.source] : picks.games) : null;
    const source = results ?? base;
    if (!source) return null;
    return source.filter((g) => g.cover && !library?.[g.id]).slice(0, 40);
  }, [results, picks, conf.source, library]);

  const remove = useCallback(
    (id) => {
      // Ce qui est déjà enregistré ne se retire pas d'ici : il est dans la
      // bibliothèque, et c'est sur la fiche du jeu qu'on le défait.
      if (flushed.current.has(id)) return;
      onPicked((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [flushed, onPicked]
  );

  const toggle = useCallback(
    (game) => {
      const id = String(game.id);
      if (picked[id]) return remove(id);
      onPicked((prev) => ({
        ...prev,
        [id]: { status: conf.status, name: game.name, cover: game.cover || null },
      }));
      if (conf.rate) onRate(game);
      return undefined;
    },
    [picked, remove, onPicked, conf.status, conf.rate, onRate]
  );

  const tray = Object.entries(picked).filter(([, pick]) => pick.status === conf.status);

  return (
    <div className="onb-pick">
      {tray.length > 0 && (
        <div className="onb-tray">
          {tray.map(([id, pick]) => {
            const locked = flushed.current.has(id);
            return (
              <button
                key={id}
                className="onb-tray-item clickable"
                onClick={() => remove(id)}
                disabled={locked}
                title={pick.name}
                aria-label={locked ? pick.name : `Retirer ${pick.name}`}
              >
                {pick.cover && <img src={pick.cover} alt="" />}
                {pick.rating != null && (
                  <span className="onb-tray-rate">{formatRating(pick.rating, scale)}</span>
                )}
                {!locked && (
                  <span className="onb-tray-x">
                    <X size={14} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="onb-pick-wheel">
        {games && !games.length ? (
          <p className="onb-empty">{loading ? "Recherche…" : "Aucun jeu trouvé"}</p>
        ) : (
          <GameWheel
            key={results ? "search" : "base"}
            games={games}
            picked={picked}
            onToggle={toggle}
            rose={conf.accent === "rose"}
          />
        )}
      </div>

      {/* ⚠️ LA PHRASE D'ABORD, LA LOUPE ENSUITE. On lit « Aucun ? », et la
          recherche est là où le regard arrive : à droite, pas avant la
          question qu'elle répond. */}
      <div className="onb-findrow">
        {!open && (
          <button className="onb-find-hint clickable" onClick={() => setOpen(true)}>
            Aucun ? <b>Tape le nom d'un jeu</b>
          </button>
        )}
        <SearchPill
          open={open}
          value={query}
          onOpen={() => setOpen(true)}
          onChange={setQuery}
          onClose={() => {
            setOpen(false);
            setQuery("");
          }}
        />
      </div>
    </div>
  );
}

// ======================================================================
//  La roue de jeux
// ======================================================================
// Une grande roue dont on ne voit que le haut, les jaquettes posées sur sa
// jante et tournées avec elle. On la fait tourner à la souris, au doigt, à la
// molette ou aux flèches ; elle garde son élan, puis se cale sur une carte.
//
// ⚠️ UNE SEULE TRANSFORMATION PAR IMAGE. Les cartes sont placées une fois pour
// toutes autour du moyeu (`rotate(i·pas) translateY(-R)`), et c'est le MOYEU
// qu'on tourne — directement dans le style, hors de React.
//
// ⚠️ LA ROUE EST TOUJOURS PLEINE. Une recherche qui rend cinq jeux est
// répétée jusqu'à remplir le tour ; choisir une copie coche les autres, puisque
// le choix est rangé par identifiant de jeu.

const MIN_SLOTS = 26;

function GameWheel({ games, picked, onToggle, rose }) {
  const boxRef = useRef(null);
  const hubRef = useRef(null);
  const [size, setSize] = useState(null);
  const [focus, setFocus] = useState(0);
  const [touched, setTouched] = useState(false);

  const rot = useRef(0);
  const vel = useRef(0);
  const raf = useRef(0);
  const drag = useRef(null);
  const snapTimer = useRef(0);
  const introDone = useRef(false);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const slots = useMemo(() => {
    if (!games) return Array.from({ length: MIN_SLOTS }, (_, i) => ({ id: `skel${i}`, skel: true }));
    if (!games.length) return [];
    const rounds = Math.max(1, Math.ceil(MIN_SLOTS / games.length));
    const out = [];
    for (let r = 0; r < rounds; r++) out.push(...games);
    return out;
  }, [games]);

  const n = slots.length;
  const step = n ? 360 / n : 0;

  // La géométrie, d'après la place disponible. Le rayon est choisi pour que
  // deux cartes voisines se touchent presque : plus de cartes, plus grande roue.
  //
  // ⚠️ SUR UN ÉCRAN ÉTROIT, LA ROUE DESCEND. Sur ordinateur elle est posée en
  // haut de sa zone ; sur un téléphone, c'était le haut de l'écran — hors de
  // portée du pouce. Là, la carte du sommet se cale en bas de la zone, et elle
  // y reste quand le plateau apparaît au-dessus (la zone rétrécit par le haut).
  const geo = useMemo(() => {
    if (!size || !n) return null;
    const cw = Math.round(Math.min(150, Math.max(92, size.w * 0.12), size.h * 0.34));
    const ch = Math.round((cw * 4) / 3);
    const rad = (step * Math.PI) / 180;
    const R = Math.max((cw * 1.18) / rad, size.w * 0.6);
    const narrow = size.w < 700;
    const top = narrow
      ? Math.max(ch / 2 + 12, size.h - ch * 0.62 - 44)
      : ch / 2 + Math.max(14, size.h * 0.08);
    return { cw, ch, R, cx: size.w / 2, cy: top + R, top };
  }, [size, n, step]);

  // Des pixels de glissé aux degrés de roue : la carte sous le doigt suit le
  // doigt, ni plus vite ni moins vite.
  const dpp = geo ? 180 / (Math.PI * geo.R) : 0;

  const paint = useCallback(() => {
    if (hubRef.current) hubRef.current.style.transform = `rotate(${rot.current}deg)`;
    if (!step) return;
    const i = ((Math.round(-rot.current / step) % n) + n) % n;
    setFocus((f) => (f === i ? f : i));
  }, [step, n]);

  const animateTo = useCallback(
    (target, ms = 300) => {
      cancelAnimationFrame(raf.current);
      const from = rot.current;
      const t0 = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        const eased = 1 - Math.pow(1 - k, 3);
        rot.current = from + (target - from) * eased;
        paint();
        if (k < 1) raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    },
    [paint]
  );

  const snap = useCallback(() => Math.round(rot.current / step) * step, [step]);

  // L'élan : la vitesse du lâcher s'éteint doucement, puis la roue se cale.
  const coast = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const tick = () => {
      if (Math.abs(vel.current) < 0.04) return animateTo(snap(), 320);
      rot.current += vel.current;
      vel.current *= 0.95;
      paint();
      raf.current = requestAnimationFrame(tick);
      return undefined;
    };
    raf.current = requestAnimationFrame(tick);
  }, [animateTo, paint, snap]);

  // L'entrée : la roue arrive déjà lancée et ralentit jusqu'à sa première
  // carte. Un seul mouvement, court — c'est lui qui dit « ça tourne ».
  useEffect(() => {
    if (!geo || !step) return;
    if (introDone.current) {
      paint();
      return;
    }
    introDone.current = true;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rot.current = reduce ? 0 : step * 2.5;
    paint();
    if (!reduce) animateTo(0, 900);
  }, [geo, step, paint, animateTo]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // La molette et le pavé tactile. ⚠️ ÉCOUTEUR NON PASSIF, posé à la main :
  // React enregistre `onWheel` en passif, et un écouteur passif ne peut pas
  // empêcher la page de défiler à la place de la roue.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !geo) return undefined;
    const onWheel = (e) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      e.preventDefault();
      cancelAnimationFrame(raf.current);
      rot.current -= delta * dpp * 0.9;
      paint();
      setTouched(true);
      clearTimeout(snapTimer.current);
      snapTimer.current = setTimeout(() => animateTo(snap(), 300), 140);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      clearTimeout(snapTimer.current);
    };
  }, [geo, dpp, paint, animateTo, snap]);

  function onPointerDown(e) {
    if (e.button > 0 || !geo) return;
    cancelAnimationFrame(raf.current);
    vel.current = 0;
    drag.current = { x: e.clientX, last: e.clientX, t: performance.now(), moved: false };
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < 6) return;
      // ⚠️ ON NE CAPTURE LE POINTEUR QU'UNE FOIS LE GESTE LANCÉ. Capturé dès
      // l'appui, le clic qui suit viserait la roue et plus la carte.
      d.moved = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setTouched(true);
    }
    const now = performance.now();
    const dx = e.clientX - d.last;
    rot.current += dx * dpp;
    vel.current = dx * dpp * (16 / Math.max(1, now - d.t));
    d.last = e.clientX;
    d.t = now;
    paint();
  }

  function onPointerUp() {
    const d = drag.current;
    if (!d) return;
    // Le clic d'une carte part juste APRÈS ce relâché : on laisse `moved`
    // lisible un tour de plus, sinon la fin d'un glissé cocherait un jeu.
    setTimeout(() => {
      if (drag.current === d) drag.current = null;
    }, 0);
    if (d.moved) coast();
  }

  // Un cran dans un sens ou dans l'autre, depuis la position calée : enchaîner
  // deux clics ne dérive donc jamais d'un demi-jeu.
  const turn = useCallback(
    (dir) => {
      setTouched(true);
      animateTo(snap() + dir * step, 260);
    },
    [animateTo, snap, step]
  );

  function onKeyDown(e) {
    if (e.key === "ArrowLeft") animateTo(snap() + step, 260);
    else if (e.key === "ArrowRight") animateTo(snap() - step, 260);
    else if ((e.key === "Enter" || e.key === " ") && slots[focus] && !slots[focus].skel) {
      e.preventDefault();
      onToggle(slots[focus]);
    } else return;
    setTouched(true);
  }

  const focused = slots[focus];
  const pickedFocus = focused && !focused.skel && !!picked[String(focused.id)];

  return (
    <div
      className="onb-wheel"
      ref={boxRef}
      tabIndex={0}
      aria-label="Roue de jeux"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={onKeyDown}
    >
      {geo && (
        <div className="onb-hub" ref={hubRef} style={{ left: geo.cx, top: geo.cy }}>
          {slots.map((g, i) => {
            const on = !g.skel && !!picked[String(g.id)];
            return (
              <button
                key={`${i}:${g.id}`}
                className={`onb-wcard ${g.skel ? "is-skel" : ""} ${i === focus ? "is-focus" : ""} ${on ? "is-on" : ""}`}
                style={{
                  width: geo.cw,
                  height: geo.ch,
                  marginLeft: -geo.cw / 2,
                  marginTop: -geo.ch / 2,
                  transform: `rotate(${i * step}deg) translateY(${-geo.R}px)`,
                }}
                tabIndex={-1}
                disabled={g.skel}
                title={g.name}
                onClick={() => {
                  if (drag.current?.moved) return;
                  onToggle(g);
                }}
              >
                <span className="onb-wcard-in">
                  {!g.skel && <img src={g.cover} alt="" draggable="false" />}
                  {on && (
                    <span className="onb-wcard-check">
                      {rose ? (
                        <Heart size={15} fill="currentColor" strokeWidth={2.4} />
                      ) : (
                        <Check size={16} strokeWidth={3.2} />
                      )}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ⚠️ AVEC UNE SOURIS, ON NE FAIT PAS TOURNER UNE ROUE : ON CLIQUE.
          Le glissé reste là pour qui veut jouer avec, mais deux flèches et un
          bouton disent la même chose en un geste — et c'est ce qu'on attend
          d'un ordinateur. Sur écran tactile ils disparaissent (feuille de
          style) : le doigt fait mieux, et il cacherait la roue. */}
      {geo && focused && !focused.skel && (
        <div className="onb-nav">
          <button
            className="onb-nav-arrow clickable"
            onClick={() => turn(1)}
            aria-label="Jeu précédent"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            className={`onb-nav-pick clickable ${pickedFocus ? "is-on" : ""}`}
            onClick={() => onToggle(focused)}
          >
            {pickedFocus ? (
              <>
                {rose ? "Plus envie" : "Finalement non"}
              </>
            ) : (
              "Celui-là"
            )}
          </button>
          <button
            className="onb-nav-arrow clickable"
            onClick={() => turn(-1)}
            aria-label="Jeu suivant"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      {geo && focused && !focused.skel && (
        <p className="onb-wheel-name" style={{ top: geo.top + geo.ch * 0.57 + 16 }}>
          {focused.name}
        </p>
      )}

      {geo && !touched && games?.length > 0 && (
        <span className="onb-wheel-hint">
          <MoveHorizontal size={15} /> Fais tourner la roue
        </span>
      )}
    </div>
  );
}

// ======================================================================
//  Noter un jeu fini
// ======================================================================
// On vient de dire « je l'ai fini » : c'est le moment où la note est la plus
// facile à donner, et le seul du parcours où on la demande. En étoiles par
// défaut — et le lien pour basculer RÈGLE l'échelle du compte : qui préfère le
// % ici le préfère partout (cf. lib/ratingScale.js).
//
// ⚠️ LA PLACE VA À LA NOTE. La première version empilait petite jaquette,
// titre, étoiles grossies par une mise à l'échelle et boutons dans une carte
// étroite : tout se touchait. Désormais un bandeau large porte le jeu (sa
// jaquette, et elle-même floutée en fond), les étoiles sont dessinées GRANDES
// — pas agrandies après coup, ce qui décalait leur zone de clic — et les
// boutons ont leur propre rangée.
//
// ⚠️ ET DEUX QUESTIONS QUI N'ONT DE SENS QU'ICI, CHACUNE À SON TOUR. Sa piste
// préférée et son personnage préféré se demandent au SEUL moment où il a le
// jeu en tête — pas dans un réglage qu'il n'ouvrira jamais. Les deux
// n'apparaissent que si le jeu a une bande originale et des portraits ;
// autrement, le panneau reste ce qu'il était.
//
// Rien n'est obligatoire : « Plus tard » garde le jeu, sans rien de tout ça.
// Les vues, à l'échelle où on les lit : « 2,3 M », pas « 2 341 908 ».
function formatViews(n) {
  if (!n || n < 1000) return null;
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(n < 1e7 ? 1 : 0))} M`;
  return `${Math.round(n / 1000)} k`;
}

// Les trois barres qui sautillent sur la piste en cours. Elles disent « ça
// joue » mieux qu'une icône de pause, parce qu'elles BOUGENT.
function Bars() {
  return (
    <span className="onb-bars" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

// Le volume, en une ligne : l'icône coupe le son, la barre le règle. La barre
// est un vrai `<input type=range>` — clavier, lecteur d'écran et glisser au
// doigt viennent avec — habillé par-dessus.
function VolumeBar({ volume, muted, onChange, onMute }) {
  const level = muted ? 0 : volume;
  const Icon = level === 0 ? VolumeX : level < 0.5 ? Volume1 : Volume2;
  return (
    <div className="onb-vol">
      <button
        className="onb-vol-btn clickable"
        onClick={onMute}
        aria-label={muted ? "Réactiver le son" : "Couper le son"}
      >
        <Icon size={17} />
      </button>
      <input
        className="onb-vol-range"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={level}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Volume"
        style={{ "--v": `${Math.round(level * 100)}%` }}
      />
      <span className="onb-vol-val">{Math.round(level * 100)}</span>
    </div>
  );
}

function RatePanel({ game, pick, onSave, onClose }) {
  const { token } = useAuth();
  const scale = useRatingScale();
  const {
    toggleTrack,
    isPlaying,
    isCurrent,
    loading,
    volume,
    muted,
    setVolume,
    toggleMute,
    close: stopPlayer,
  } = usePlayer();

  // ⚠️ LA MUSIQUE S'ARRÊTE AVEC L'ÉTAPE. Lancée depuis la playlist, elle
  // continuait après « Suivant » et même la modale refermée — sans aucune
  // commande visible pour la couper, puisque le mini-lecteur n'est pas là.
  //
  // ⚠️ MAIS SEULEMENT SI C'EST NOUS QUI L'AVONS LANCÉE. Une musique qui jouait
  // déjà avant d'ouvrir le panneau ne nous regarde pas : on ne coupe que ce
  // que cette playlist a démarré.
  //
  // `close` plutôt que `pause` : la file entière part avec, sinon la bande
  // originale resterait en attente dans le lecteur de l'app.
  const startedRef = useRef(false);
  const stopRef = useRef(stopPlayer);
  stopRef.current = stopPlayer;
  const stopOurs = useCallback(() => {
    if (!startedRef.current) return;
    startedRef.current = false;
    stopRef.current();
  }, []);
  useEffect(() => stopOurs, [stopOurs]);
  const stars = scale === SCALE_STARS;
  const [draft, setDraft] = useState(pick?.rating ?? null);
  const [ost, setOst] = useState(pick?.favoriteOst || null);
  const [character, setCharacter] = useState(pick?.favoriteCharacter || null);
  const Input = stars ? StarRating : RatingGauge;

  const [tracks, setTracks] = useState(null);
  const [chars, setChars] = useState(null);
  const [si, setSi] = useState(0);

  useEffect(() => {
    let alive = true;
    setTracks(null);
    setChars(null);
    apiFetch(`/games/${game.id}/ost?q=${encodeURIComponent(game.name)}`, { token })
      .then((d) => {
        if (!alive) return;
        const list = (d.tracks || [])
          .slice()
          .sort((a, b) => (b.views || 0) - (a.views || 0))
          .slice(0, 14);
        setTracks(list);
      })
      .catch(() => alive && setTracks([]));
    apiFetch(`/games/${game.id}/details`, { token })
      .then((d) => alive && setChars((d.characters || []).filter((c) => c.image).slice(0, 18)))
      .catch(() => alive && setChars([]));
    return () => {
      alive = false;
    };
  }, [game.id, game.name, token]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = (patch) => onSave({ rating: draft, favoriteOst: ost, favoriteCharacter: character, ...patch });

  // ⚠️ UNE QUESTION À LA FOIS. Les trois tenaient dans le même panneau : on
  // ne savait plus ce qui était demandé, et il fallait faire défiler pour
  // atteindre « Valider ». La note est toujours là ; les deux autres n'existent
  // que si le jeu a de quoi les remplir.
  const steps = ["rate"];
  if (tracks?.length) steps.push("ost");
  if (chars?.length) steps.push("char");
  const at = Math.min(si, steps.length - 1);
  const step = steps[at];
  const last = at >= steps.length - 1;

  // Quitter la playlist (« Suivant », « Passer ») coupe le son ; la fermeture,
  // elle, passe par le démontage ci-dessus.
  useEffect(() => {
    if (step !== "ost") stopOurs();
  }, [step, stopOurs]);

  const done = () => {
    save({});
    onClose();
  };
  const go = () => (last ? done() : setSi(at + 1));

  const pickTrack = (tr) =>
    setOst((cur) =>
      cur?.name === tr.name
        ? null
        : {
            name: tr.name,
            artist: tr.artist || null,
            artwork: tr.artwork || null,
            youtube: !!tr.youtube,
            url: tr.url || null,
          }
    );

  const pickChar = (c) =>
    setCharacter((cur) => (cur?.name === c.name ? null : { name: c.name, image: c.image || null }));

  const HEAD = {
    rate: ["Tu lui mets", "combien", "?"],
    ost: ["Ta piste", "préférée", "?"],
    char: ["Ton perso", "préféré", "?"],
  }[step];

  return (
    <div
      className="onb-rate"
      role="dialog"
      aria-modal="true"
      aria-label={game.name}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="onb-rate-card">
        <div className="onb-rate-hero">
          {game.cover && <img className="onb-rate-bg" src={game.cover} alt="" aria-hidden="true" />}
          {game.cover && <img className="onb-rate-cover" src={game.cover} alt="" />}
          <div className="onb-rate-titles">
            <p className="onb-rate-q">
              {HEAD[0]} <em>{HEAD[1]}</em> {HEAD[2]}
            </p>
            <strong>{game.name}</strong>
            {steps.length > 1 && (
              <span className="onb-rate-dots" aria-hidden="true">
                {steps.map((k, i) => (
                  <i key={k} className={i === at ? "is-on" : ""} />
                ))}
              </span>
            )}
          </div>
        </div>

        {/* La clé relance l'entrée à chaque temps : un seul geste, et tout le
            contenu glisse. */}
        <div className="onb-rate-step" key={step}>
          {step === "rate" && (
            <div className="onb-rate-body">
              <div className="onb-rate-input">
                <Input
                  value={draft ?? 0}
                  active={draft != null}
                  onEnable={() => {}}
                  onChange={setDraft}
                  onClear={() => setDraft(null)}
                  moodTop
                />
              </div>
              <button
                className="onb-rate-switch clickable"
                onClick={() => setRatingScale(stars ? SCALE_100 : SCALE_STARS)}
              >
                {stars ? "ou plutôt en % ?" : "ou plutôt en étoiles ?"}
              </button>
            </div>
          )}

          {step === "ost" && (
            <div className="onb-tlist">
              {tracks.map((tr, i) => {
                const on = ost?.name === tr.name;
                const views = formatViews(tr.views);
                const sounding = isPlaying(tr);
                // ⚠️ UNE PISTE YOUTUBE MET UNE À DEUX SECONDES À PARTIR. Sans
                // signe, le clic semblait n'avoir rien fait et on recliquait —
                // ce qui la remettait en pause au moment où elle démarrait.
                const buffering = isCurrent(tr) && loading;
                return (
                  <div key={tr.id} className={`onb-trow ${on ? "is-on" : ""}`}>
                    <button
                      className="onb-trow-pick clickable"
                      onClick={() => pickTrack(tr)}
                      aria-pressed={on}
                    >
                      <span className="onb-trow-rank">{on ? <Check size={13} strokeWidth={3.6} /> : i + 1}</span>
                      <span className="onb-trow-art">
                        {tr.artwork ? <img src={tr.artwork} alt="" loading="lazy" /> : <Music size={18} />}
                        {sounding && !buffering && <Bars />}
                      </span>
                      <span className="onb-trow-txt">
                        <b>{tr.name}</b>
                        {views && <small>{views} vues</small>}
                      </span>
                    </button>
                    <button
                      className="onb-trow-play clickable"
                      // ⚠️ LA FILE, C'EST TOUTE LA BANDE ORIGINALE. En ne
                      // passant que la piste, elle s'arrêtait à la fin et il
                      // fallait revenir cliquer pour en entendre une autre.
                      onClick={() => {
                        startedRef.current = true;
                        toggleTrack(tr, tracks, { gameId: game.id, gameName: game.name });
                      }}
                      aria-label={sounding ? `Mettre en pause ${tr.name}` : `Écouter ${tr.name}`}
                      aria-busy={buffering}
                    >
                      {buffering ? (
                        <Loader2 size={16} className="spin" />
                      ) : sounding ? (
                        <Pause size={15} fill="currentColor" />
                      ) : (
                        <Play size={15} fill="currentColor" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {step === "char" && (
            <div className="onb-faces">
              {chars.map((c) => {
                const on = character?.name === c.name;
                return (
                  <button
                    key={c.id}
                    className={`onb-chr clickable ${on ? "is-on" : ""}`}
                    onClick={() => pickChar(c)}
                    title={c.name}
                  >
                    <span className="onb-chr-face">
                      <img src={c.image} alt="" loading="lazy" />
                      {on && (
                        <span className="onb-chr-check">
                          <Check size={13} strokeWidth={3.4} />
                        </span>
                      )}
                    </span>
                    <span className="onb-chr-name">{c.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ⚠️ LE VOLUME SE RÈGLE ICI, PAS DANS UN LECTEUR QU'ON NE VOIT PAS. Le
            mini-lecteur vit dans le layout connecté, absent du parcours : sans ce
            curseur, une piste trop forte ne se baissait qu'au clavier.
            En BAS, posé sur les boutons : c'est une commande, pas du contenu —
            au-dessus de la playlist, il passait pour la première ligne. */}
        {step === "ost" && (
          <VolumeBar volume={volume} muted={muted} onChange={setVolume} onMute={toggleMute} />
        )}

        <div className="onb-rate-actions">
          <button className="onb-rate-skip clickable" onClick={last ? onClose : go}>
            {last ? "Plus tard" : "Passer"}
          </button>
          <button
            className="onb-rate-save clickable"
            disabled={step === "rate" && draft == null && steps.length === 1}
            onClick={go}
          >
            {last ? "Terminer" : "Suivant"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ======================================================================
//  4 — L'import
// ======================================================================
// Deux tuiles carrées pour ce qui marche, une rangée grisée pour ce qui arrive.
// Une tuile déjà importée le dit : une coche, et le nombre de jeux ramenés.
// Les modales d'import existent déjà et font le tri jeu par jeu : on les
// OUVRE, on ne les réécrit pas.

const SOON = [
  { key: "psn", label: "PlayStation", brand: platformBrand("PlayStation") },
  { key: "xbox", label: "Xbox", brand: platformBrand("Xbox") },
  { key: "switch", label: "Nintendo", brand: platformBrand("Switch") },
  { key: "epic", label: "Epic Games", brand: STORES.epic },
  { key: "gog", label: "GOG", brand: STORES.gog },
];

// Un logo de marque d'après son tracé. La largeur suit les proportions du
// dessin : un carré (PlayStation) et un mot (Nintendo) n'ont pas la même.
function BrandSvg({ brand, size, evenOdd = false }) {
  if (!brand) return null;
  const [, , w, h] = brand.viewBox.split(" ").map(Number);
  return (
    <svg
      width={Math.round(size * (w && h ? w / h : 1))}
      height={size}
      viewBox={brand.viewBox}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={brand.d} fillRule={evenOdd ? "evenodd" : undefined} />
    </svg>
  );
}

function StepImport() {
  const { user, token, updateUser } = useAuth();
  const { refresh } = useLibrary();
  const [status, setStatus] = useState(null);
  const [counts, setCounts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [steamOpen, setSteamOpen] = useState(false);
  const [backloggdOpen, setBackloggdOpen] = useState(false);
  const popupRef = useRef(null);

  const load = useCallback(() => {
    apiFetch("/steam/status", { token })
      .then(setStatus)
      .catch(() => setStatus({ configured: true, connected: false }));
    apiFetch("/onboarding/imports", { token })
      .then(setCounts)
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const imported = useCallback(() => {
    refresh?.();
    load();
  }, [refresh, load]);

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

  const steamLinked = !!(status?.connected || counts?.steam?.linked || user?.steamConnected);

  return (
    <div className="onb-import">
      <div className="onb-imports">
        <ImportTile
          kind="steam"
          name="Steam"
          logo={<SteamIcon size={56} />}
          count={counts?.steam?.count || 0}
          action={busy ? <Loader2 className="spin" size={15} /> : steamLinked ? "Importer" : "Connecter"}
          onClick={steamLinked ? () => setSteamOpen(true) : linkSteam}
          disabled={busy || status?.configured === false}
        />
        <ImportTile
          kind="backloggd"
          name="Backloggd"
          logo={<BackloggdIcon size={60} />}
          count={counts?.backloggd?.count || 0}
          action="Importer"
          onClick={() => setBackloggdOpen(true)}
        />
      </div>

      <div className="onb-soon">
        {SOON.map((s) => (
          <div key={s.key} className="onb-soon-tile" title={`${s.label} — bientôt`}>
            <BrandSvg brand={s.brand} size={22} />
          </div>
        ))}
      </div>
      <p className="onb-soon-cap">Bientôt</p>

      {error && <p className="onb-error">{error}</p>}

      {/* ⚠️ LES MODALES PARTENT DANS <body>. Rendues ici, elles restaient
          prisonnières de la couche de la scène : leur z-index ne comptait que
          DEDANS, et le bouton « Continuer » passait par-dessus. */}
      {steamOpen &&
        createPortal(
          <SteamImportModal onClose={() => setSteamOpen(false)} onDone={imported} />,
          document.body
        )}
      {backloggdOpen &&
        createPortal(
          <BackloggdImportModal onClose={() => setBackloggdOpen(false)} onDone={imported} />,
          document.body
        )}
    </div>
  );
}

function ImportTile({ kind, name, logo, count, action, onClick, disabled }) {
  const done = count > 0;
  return (
    <button
      className={`onb-imp ${kind} ${done ? "is-done" : ""} clickable`}
      onClick={onClick}
      disabled={disabled}
    >
      {done && (
        <span className="onb-imp-tag" aria-label="Déjà importé">
          <Check size={14} strokeWidth={3.2} />
        </span>
      )}
      <span className="onb-imp-logo">{logo}</span>
      <span className="onb-imp-name">{name}</span>
      <span className="onb-imp-act">
        {done ? `${count} jeu${count > 1 ? "x" : ""} importé${count > 1 ? "s" : ""}` : action}
      </span>
    </button>
  );
}

// ======================================================================
//  5 — Voilà ton profil
// ======================================================================
// La fin du parcours n'est pas un « C'est prêt » : c'est le résultat. Sa
// photo, ses chiffres, ses jaquettes, posés sur une carte qui scintille — et,
// jetés tout autour, les gestes qui la rendent vraiment à lui : un favori, un
// alter ego, une photo, une console, un studio. Chacun ouvre SA modale, et la
// carte se met à jour sous les yeux dès qu'on la referme.
//
// ⚠️ UNE PASTILLE FAITE LE DIT. Elle se coche et affiche ce qu'on a choisi
// (« Nintendo Switch », « 3 favoris ») : c'est la liste de ce qu'il reste à
// faire, sans une ligne d'explication.

// Des paillettes aux positions FIXES (pas de hasard au rendu : elles ne
// doivent pas sauter à chaque redessin).
const SPARKS = Array.from({ length: 18 }, (_, i) => ({
  x: (i * 37 + 11) % 100,
  y: (i * 53 + 7) % 100,
  delay: ((i * 0.37) % 2.4).toFixed(2),
  size: 6 + ((i * 5) % 9),
  // Une sur trois en rose : les deux couleurs du parcours, mêlées.
  rose: i % 3 === 0,
}));

// Les pastilles d'action, jetées autour de la carte (positions en % de la
// scène, sur grand écran ; sur un téléphone elles se rangent sous la carte).
// ⚠️ LA BANNIÈRE EST EN HAUT À DROITE, À HAUTEUR DE LA BANNIÈRE. C'est la seule
// pastille qui modifie quelque chose qu'on VOIT sur la carte : posée à côté de
// ce qu'elle change, une flèche suffit à dire à quoi elle sert (cf. BannerArrow).
const ACTIONS = [
  { key: "fav", Icon: Heart, tone: "#ff5c8d", x: "1%", y: "8%", r: -5 },
  { key: "cover", Icon: ImageIcon, tone: "#ff9f45", x: "74%", y: "4%", r: 4 },
  { key: "char", Icon: Sparkles, tone: "#b69cff", x: "2%", y: "38%", r: -2 },
  { key: "avatar", Icon: Camera, tone: "#ffd24a", x: "0%", y: "68%", r: 3 },
  { key: "console", Icon: Gamepad2, tone: "#66c0f4", x: "77%", y: "38%", r: -3 },
  { key: "studio", Icon: Building2, tone: "#3ddc84", x: "72%", y: "74%", r: 5 },
];

// La position d'un \u00e9l\u00e9ment dans `root`, lue dans la MISE EN PAGE (offsets) et
// non \u00e0 l'\u00e9cran (getBoundingClientRect).
//
// \u26a0\ufe0f C'EST CE QUI TIENT LA FL\u00c8CHE EN PLACE. Les pastilles arrivent en grossissant
// puis flottent de quelques pixels en boucle, et la carte monte en entrant :
// mesur\u00e9es \u00e0 l'\u00e9cran, les deux extr\u00e9mit\u00e9s visaient une position de passage. Les
// offsets ignorent les transformations \u2014 la fl\u00e8che vise la position de repos.
function offsetIn(el, root) {
  let x = 0;
  let y = 0;
  let node = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent;
  }
  return node === root ? { x, y, w: el.offsetWidth, h: el.offsetHeight } : null;
}

// La fl\u00e8che qui part de la banni\u00e8re et monte jusqu'\u00e0 \u00ab Changer ma banni\u00e8re \u00bb.
// Discr\u00e8te par principe : un trait gris-blanc en pointill\u00e9, qui se dessine une
// fois les pastilles pos\u00e9es, et rien d'autre.
function BannerArrow({ rootRef, fromRef, toRef }) {
  const id = useId();
  const [geo, setGeo] = useState(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const measure = () => {
      const from = fromRef.current && offsetIn(fromRef.current, root);
      const to = toRef.current && offsetIn(toRef.current, root);
      // \u26a0\ufe0f PAS DE FL\u00c8CHE QUAND LA PASTILLE N'EST PAS \u00c0 DROITE DE LA CARTE. Sur un
      // \u00e9cran moyen, les pastilles se rangent SOUS la carte : le trait aurait
      // travers\u00e9 le profil en diagonale.
      if (!from || !to || to.x < from.x + from.w) return setGeo(null);
      // D\u00e9part : le bord droit de la banni\u00e8re, un peu au-dessus de son milieu.
      const x1 = from.x + from.w + 8;
      const y1 = from.y + from.h * 0.42;
      // Arriv\u00e9e : par le dessous de la pastille quand elle est plus haut (le cas
      // normal), sinon par son bord gauche.
      const above = to.y + to.h < y1 - 12;
      const x2 = above ? to.x + Math.min(34, to.w * 0.25) : to.x - 10;
      const y2 = above ? to.y + to.h + 10 : to.y + to.h / 2;
      const c1 = `${x1 + Math.max(28, (x2 - x1) * 0.9)} ${y1}`;
      const c2 = above ? `${x2} ${y2 + Math.max(24, (y1 - y2) * 0.6)}` : `${x2 - 30} ${y2}`;
      return setGeo({ d: `M ${x1} ${y1} C ${c1} ${c2} ${x2} ${y2}` });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [rootRef, fromRef, toRef]);

  if (!geo) return null;
  const marker = `onb-arrowhead-${id.replace(/:/g, "")}`;
  return (
    <svg className="onb-arrow" aria-hidden="true">
      <defs>
        <marker
          id={marker}
          viewBox="0 0 10 10"
          refX="7"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 1 1 L 8 5 L 1 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      <path className="onb-arrow-path" d={geo.d} markerEnd={`url(#${marker})`} />
    </svg>
  );
}

function StepProfile({ user, picked, have }) {
  const { token, updateUser } = useAuth();
  const { map: library } = useLibrary();
  const [modal, setModal] = useState(null); // fav | char | cover | console | studio
  const [entries, setEntries] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  // La bannière se choisit en deux temps, comme sur le profil : on pioche une
  // image, puis on la cadre.
  const [pendingCover, setPendingCover] = useState(null);
  const rootRef = useRef(null);
  const bannerRef = useRef(null);
  const coverActRef = useRef(null);

  // La bibliothèque complète (noms, jaquettes) : l'étagère montre les
  // favoris, et le sélecteur de favoris en a besoin.
  const loadEntries = useCallback(() => {
    apiFetch("/library", { token })
      .then((d) => setEntries(d.entries || []))
      .catch(() => {});
  }, [token]);
  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  async function upload(file) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("avatar", file);
      const data = await apiUpload("/users/me/avatar", form, token);
      updateUser(data.user || { avatar: data.avatar });
    } catch {
      /* la pastille reste décochée : on peut réessayer */
    } finally {
      setUploading(false);
    }
  }

  // ⚠️ UNE BANNIÈRE S'AJOUTE AU CARROUSEL, ELLE NE LE REMPLACE PAS. Le profil
  // en garde jusqu'à six (cf. pages/Profile.jsx) : écrire un tableau d'une
  // seule image effacerait celles d'un compte qui repasse le parcours.
  async function saveCover(url, pos) {
    const base = (user?.covers || []).filter((c) => c?.url && c.url !== url);
    const { user: fresh } = await apiFetch("/users/me", {
      method: "PUT",
      token,
      body: { covers: [...base, { url, pos }].slice(-6) },
    });
    updateUser(fresh);
  }

  const isFav = (e) => library?.[e.gameId]?.favorite ?? e.favorite;
  const favCovers = entries.filter(isFav).map((e) => e.cover).filter(Boolean);
  const pickedCovers = Object.values(picked)
    .sort((a, b) => (a.status === "wishlist") - (b.status === "wishlist"))
    .map((p) => p.cover)
    .filter(Boolean);
  const shelf = [...new Set([...favCovers, ...pickedCovers])].slice(0, 4);
  // Sa vraie bannière si elle existe ; sinon une frise de ses jaquettes, qui
  // fait déjà un décor et montre à quoi la carte ressemblera.
  const ownCover = user?.covers?.[0]?.url || user?.cover || null;
  const banner = ownCover ? [] : [...new Set([...pickedCovers, ...favCovers])].slice(0, 6);

  // Le sélecteur de favoris ne propose que ce qu'on a JOUÉ : une envie n'est
  // pas un coup de cœur. Un compte qui n'a rien joué voit tout.
  const played = entries.filter((e) => e.status && e.status !== "wishlist");
  const favEntries = played.length ? played : entries;

  const actionInfo = {
    fav: {
      label: "Choisis un favori",
      done: have.favorites > 0,
      sub: have.favorites > 0 ? `${have.favorites} favori${have.favorites > 1 ? "s" : ""}` : null,
      open: () => setModal("fav"),
    },
    char: {
      label: "Si j'étais un personnage…",
      done: !!user?.tagline,
      sub: user?.tagline || null,
      open: () => setModal("char"),
    },
    cover: {
      label: ownCover ? "Changer ma bannière" : "Ajouter une bannière",
      done: !!ownCover,
      sub: null,
      open: () => setModal("cover"),
    },
    avatar: {
      label: user?.avatar ? "Changer ma photo" : "Ajouter une photo de profil",
      done: !!user?.avatar,
      sub: null,
      open: () => fileRef.current?.click(),
    },
    console: {
      label: "Ma console favorite",
      done: !!user?.favoriteConsole?.name,
      sub: user?.favoriteConsole?.name || null,
      open: () => setModal("console"),
    },
    studio: {
      label: "Mon studio favori",
      done: !!user?.favoriteStudio?.name,
      sub: user?.favoriteStudio?.name || null,
      open: () => setModal("studio"),
    },
  };

  const initial = (user?.username || "?")[0].toUpperCase();

  return (
    <div className="onb-profile" ref={rootRef}>
      {SPARKS.map((s, i) => (
        <span
          key={i}
          className={`onb-spark ${s.rose ? "is-rose" : ""}`}
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            "--delay": `${s.delay}s`,
            "--size": `${s.size}px`,
          }}
        />
      ))}

      <article className="onb-pcard">
        <div className="onb-pcard-banner" ref={bannerRef}>
          {ownCover ? (
            <img
              src={ownCover}
              alt=""
              style={{ objectPosition: user?.covers?.[0]?.pos || user?.coverPos || "center" }}
            />
          ) : (
            banner.map((c, i) => <img key={i} src={c} alt="" />)
          )}
          <span className="onb-pcard-shine" />
        </div>

        <div className="onb-pcard-body">
          <div className={`onb-pcard-avatar ${uploading ? "is-busy" : ""}`}>
            {user?.avatar ? <img src={user.avatar} alt="" /> : <span>{initial}</span>}
          </div>
          <strong className="onb-pcard-name">{user?.username}</strong>

          <div className="onb-pcard-stats">
            <span className="is-rose">
              <Heart size={14} fill="currentColor" />
              <b>{have.wishlist}</b> envies
            </span>
            <span className="is-gold">
              <Trophy size={14} />
              <b>{have.played}</b> joués
            </span>
          </div>

          {(user?.tagline || user?.favoriteConsole?.name || user?.favoriteStudio?.name) && (
            <div className="onb-pcard-taste">
              {user?.tagline && (
                <span className="onb-ptag">
                  {user.taglineImage ? <img src={user.taglineImage} alt="" /> : <Sparkles size={12} />}
                  {user.tagline}
                </span>
              )}
              {user?.favoriteConsole?.name && (
                <span className="onb-ptag">
                  <Gamepad2 size={12} />
                  {user.favoriteConsole.name}
                </span>
              )}
              {user?.favoriteStudio?.name && (
                <span className="onb-ptag">
                  <Building2 size={12} />
                  {user.favoriteStudio.name}
                </span>
              )}
            </div>
          )}

          <div className="onb-pcard-shelf">
            {[0, 1, 2, 3].map((i) =>
              shelf[i] ? (
                <img key={i} src={shelf[i]} alt="" />
              ) : (
                <button
                  key={i}
                  className="onb-pcard-slot clickable"
                  onClick={() => setModal("fav")}
                  aria-label="Choisir un favori"
                >
                  <Heart size={16} />
                </button>
              )
            )}
          </div>
        </div>
      </article>

      <BannerArrow rootRef={rootRef} fromRef={bannerRef} toRef={coverActRef} />

      <div className="onb-acts">
        {ACTIONS.map((a, i) => {
          const info = actionInfo[a.key];
          return (
            <button
              key={a.key}
              ref={a.key === "cover" ? coverActRef : undefined}
              className={`onb-act clickable ${info.done ? "is-done" : ""}`}
              style={{
                "--x": a.x,
                "--y": a.y,
                "--r": `${a.r}deg`,
                "--d": `${250 + i * 90}ms`,
                "--tone": a.tone,
              }}
              onClick={info.open}
            >
              <span className="onb-act-icon">
                <a.Icon size={18} />
              </span>
              <span className="onb-act-text">
                {info.label}
                {info.sub && <small>{info.sub}</small>}
              </span>
              {info.done && (
                <span className="onb-act-check">
                  <Check size={11} strokeWidth={3.4} />
                </span>
              )}
            </button>
          );
        })}
      </div>

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

      {modal === "fav" && (
        <FavoritePicker
          entries={favEntries}
          onClose={() => {
            setModal(null);
            loadEntries();
          }}
        />
      )}
      {/* ⚠️ LE MÊME SÉLECTEUR QUE SUR L'APPLI : on cherchait le personnage
          dans une modale d'édition de profil entière, avec trois autres champs
          autour. Ici on ne modifie pas un profil, on DÉSIGNE quelqu'un. */}
      {modal === "char" && (
        <AddItemsModal
          kind="character"
          single
          title="Si j'étais un personnage…"
          existing={new Set()}
          onClose={() => setModal(null)}
          onToggle={async (c) => {
            setModal(null);
            try {
              const { user: fresh } = await apiFetch("/users/me", {
                method: "PUT",
                token,
                body: { tagline: c.name, taglineImage: c.image || null },
              });
              updateUser(fresh);
            } catch {
              /* la pastille reste décochée : on peut réessayer */
            }
          }}
        />
      )}
      {modal === "cover" && (
        <CoverPickerModal
          entries={entries}
          current={ownCover}
          count={user?.covers?.length || 0}
          onClose={() => setModal(null)}
          onPick={(url) => {
            setModal(null);
            if (url) setPendingCover(url);
          }}
        />
      )}
      {pendingCover && (
        <ReframeCoverModal
          cover={pendingCover}
          pos={null}
          onClose={() => setPendingCover(null)}
          onSave={async (pos) => {
            const url = pendingCover;
            setPendingCover(null);
            try {
              await saveCover(url, pos);
            } catch {
              /* idem */
            }
          }}
        />
      )}
      {(modal === "console" || modal === "studio") && (
        <TastePickerModal kind={modal} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
