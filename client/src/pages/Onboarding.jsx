import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Loader2,
  MousePointerClick,
  Search,
  Shuffle,
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
import DiscordIcon from "../components/DiscordIcon";
import GoogleIcon from "../components/GoogleIcon";
import SteamIcon from "../components/SteamIcon";
import SteamImportModal from "../components/SteamImportModal";

// ======================================================================
//  LE TOUR DU PROPRIÉTAIRE
// ======================================================================
//
// Cinq écrans, une minute, et on peut partir à n'importe lequel. Ce n'est pas
// un formulaire d'inscription bis — le compte existe déjà quand on arrive ici.
// C'est le moment où l'app cesse d'être vide, parce qu'une app de bibliothèque
// OUVERTE SUR DU VIDE ne se comprend pas, et ne se garde pas.
//
// ⚠️ PAS UN SEUL ÉCRAN QUI NE SE FAIT QUE LIRE. Il y a eu un « Bienvenue » et
// un « C'est prêt » : deux pages de prose où l'on ne pouvait rien faire que
// cliquer sur Suivant. Une intro se TRAVERSE en faisant des choses ; chaque
// écran demande donc un geste, et le seul qui n'en demande pas (les trois
// astuces) est aussi le dernier, celui qu'on lit en partant.
//
// ⚠️ DEUX QUESTIONS, DEUX ÉCRANS. « Coche ce que tu as joué OU ce que tu veux
// jouer » sur le même écran, avec un interrupteur entre les deux, obligeait à
// tenir deux intentions à la fois — et personne ne vérifiait dans quel mode il
// cochait. On demande donc l'envie d'abord, le passé ensuite, et chaque écran
// ne sait faire qu'une chose.
//
// ⚠️ ET IL NE S'ÉCRIT QU'À LA FIN DE CHAQUE ÉTAPE, jamais à chaque clic. On
// attrape huit jaquettes en trois secondes : envoyer huit requêtes pendant
// qu'on hésite, c'est huit occasions de désynchroniser l'écran et la base pour
// un choix pas encore arrêté.

const STEPS = ["avatar", "wishlist", "played", "import", "tips"];

// Les deux écrans de choix. `need` est le minimum pour passer — et il se
// compte SUR LA BIBLIOTHÈQUE, pas seulement sur ce qu'on vient d'attraper
// (voir `have` plus bas) : quelqu'un qui arrive avec trente jeux n'a rien à
// prouver.
const PICKS = {
  wishlist: {
    status: "wishlist",
    need: 3,
    Icon: Bookmark,
    n: "2",
    title: "Qu'est-ce qui te tente ?",
    sub: "Choisis au moins trois jeux que tu as envie de faire.",
  },
  played: {
    status: "finished",
    need: 1,
    Icon: Trophy,
    n: "3",
    title: "Et un jeu que tu as déjà fait ?",
    sub: "Un seul suffit pour lancer ta bibliothèque.",
  },
};

// Combien d'écritures en parallèle au moment de valider ce qui a été attrapé.
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
  const { token, updateUser } = useAuth();
  const { map: library } = useLibrary();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const replay = params.get("replay") === "1";

  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const step = STEPS[index];

  // Ce que les écrans de choix ont attrapé, écrit à leur sortie.
  // gameId -> { status, name, cover }
  const [picked, setPicked] = useState({});
  // ⚠️ CE QUI EST DÉJÀ PARTI NE REPART PAS. Revenir en arrière puis repartir
  // est un geste ordinaire ; sans cette mémoire, il réécrirait trente entrées
  // identiques à chaque aller-retour. Les cartes, elles, restent choisies —
  // les décocher après enregistrement ferait croire que rien n'a été gardé.
  const flushed = useRef(new Set());
  const pending = useCallback(
    () => Object.entries(picked).filter(([id]) => !flushed.current.has(id)),
    [picked]
  );

  // ⚠️ CE QU'IL A DÉJÀ COMPTE AUTANT QUE CE QU'IL ATTRAPE. Quelqu'un qui vient
  // d'importer Steam, ou qui rejoue l'intro depuis les réglages, a déjà tout ce
  // qu'on lui demande : lui redemander trois envies, ce serait lui faire
  // remplir un formulaire dont on connaît la réponse.
  const have = useMemo(() => {
    let wishlist = 0;
    let played = 0;
    for (const e of Object.values(library || {})) {
      if (!e?.status) continue;
      if (e.status === "wishlist") wishlist += 1;
      else played += 1;
    }
    return { wishlist, played };
  }, [library]);

  // ⚠️ ON PRÉCHARGE LE CATALOGUE DÈS LE PREMIER ÉCRAN. Les jaquettes viennent
  // d'IGDB : demandées à l'ouverture de l'étape, elles arriveraient pendant
  // qu'on la regarde, et le tapis se remplirait sous les yeux. Demandées
  // pendant qu'on choisit sa photo, elles sont déjà là.
  const [picks, setPicks] = useState(null);
  useEffect(() => {
    if (!token) return;
    apiFetch("/onboarding/picks", { token })
      .then(setPicks)
      .catch(() => setPicks({ franchises: [], games: [], degraded: true }));
  }, [token]);

  const go = useCallback((delta) => {
    setIndex((i) => Math.min(STEPS.length - 1, Math.max(0, i + delta)));
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  // Sortir : « passer, c'est terminer » — sinon on remontrerait le parcours à
  // la prochaine ouverture, ce qui est exactement ce que le geste demande
  // d'éviter. Ce qui restait attrapé part quand même : c'est un choix fait.
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

  const conf = PICKS[step] || null;
  const chosen = conf
    ? Object.values(picked).filter((p) => p.status === conf.status).length
    : 0;
  const total = conf ? chosen + have[step] : 0;
  const blocked = conf ? total < conf.need : false;

  return (
    <div className="onb">
      {/* ⚠️ LE DÉCOR NE DOIT RIEN DISPUTER AUX CARTES. Il y a eu une aurore
          dorée, puis des jaquettes qui défilaient derrière tout : deux fois
          trop. Sur cet écran, les jaquettes SONT le contenu — un fond qui en
          montre d'autres, même à 9 %, met du bruit exactement là où l'œil
          cherche à reconnaître un jeu, et les titres passent par-dessus.
          Il ne reste donc qu'un plan technique, immobile, ET ÉTEINT AU CENTRE
          (cf. le masque en feuille de style) : la trame tient les bords, le
          milieu où tout se passe reste un fond propre. */}
      <div className="onb-bg" aria-hidden="true">
        <span className="onb-blueprint" />
        <span className="onb-vignette" />
      </div>

      <header className="onb-head">
        <span className="onb-brand">
          MyPlay<span className="onb-brand-gold">Log</span>
        </span>

        <div
          className="onb-progress"
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
        >
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`onb-pip ${i < index ? "done" : ""} ${i === index ? "now" : ""}`}
            />
          ))}
        </div>

        {/* ⚠️ « PASSER » RESTE OUVERT MÊME QUAND « CONTINUER » EST FERMÉ. Le
            minimum de trois jeux est une INVITATION, pas un péage : quelqu'un
            qui ne veut rien donner doit pouvoir entrer quand même, sinon on
            l'a juste bloqué à la porte de son propre compte. */}
        <button
          className="onb-skip clickable"
          onClick={() => finish(pending())}
          disabled={leaving}
        >
          Passer <X size={15} />
        </button>
      </header>

      <main className="onb-stage">
        {/* La clé force le remontage : c'est elle qui rejoue l'animation
            d'entrée à chaque étape, sans un seul état d'animation à tenir. */}
        <div className="onb-slide" key={step}>
          {step === "avatar" && <StepAvatar replay={replay} />}
          {conf && (
            <StepPick
              conf={conf}
              stepKey={step}
              picks={picks}
              picked={picked}
              onPicked={setPicked}
              library={library}
              have={have[step]}
              token={token}
            />
          )}
          {step === "import" && <StepImport />}
          {step === "tips" && <StepTips />}
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

        {conf ? (
          <p className="onb-quota" data-ok={!blocked}>
            {blocked ? (
              `${total} / ${conf.need}`
            ) : (
              <>
                <Check size={14} strokeWidth={3} /> {total}
              </>
            )}
          </p>
        ) : (
          <span />
        )}

        {step === "tips" ? (
          <button className="onb-next clickable" onClick={() => finish()} disabled={leaving}>
            {leaving ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
            Entrer
          </button>
        ) : (
          <NextButton
            pending={pending}
            flushed={flushed}
            token={token}
            onDone={() => go(1)}
            disabled={leaving || blocked}
          />
        )}
      </footer>
    </div>
  );
}

// Le bouton « Continuer ». Il ÉCRIT avant d'avancer quand l'écran qu'on quitte
// a laissé des choix en attente — le seul moment du parcours où quelque chose
// pourrait se perdre, et donc le seul qui a le droit de faire patienter.
function NextButton({ pending, flushed, token, onDone, disabled }) {
  const { upsertLocal } = useLibrary();
  const [busy, setBusy] = useState(false);

  async function next() {
    const rest = pending();
    if (!rest.length) return onDone();
    setBusy(true);
    await flushPicks(rest, token, upsertLocal);
    for (const [id] of rest) flushed.current.add(id);
    setBusy(false);
    onDone();
  }

  return (
    <button className="onb-next clickable" onClick={next} disabled={busy || disabled}>
      {busy ? <Loader2 className="spin" size={17} /> : null}
      Continuer
      {!busy && <ArrowRight size={17} />}
    </button>
  );
}

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
//  1 — La photo de profil
// ======================================================================
// ⚠️ LA PREMIÈRE PROPOSITION EST CELLE QU'ON A DÉJÀ. Quelqu'un qui vient
// d'ouvrir son compte avec Discord ou Google a une photo chez eux, et la
// meilleure façon de lui demander la sienne est de la lui MONTRER : un clic,
// c'est fini. Lui présenter un champ « choisir un fichier » alors qu'on a son
// portrait sous la main, c'est lui faire chercher ce qu'on tient déjà.
function StepAvatar({ replay }) {
  const { user, token, updateUser } = useAuth();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const current = user?.avatar || null;

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

  const name = user?.username || "";
  const initial = (name || "?")[0].toUpperCase();

  return (
    <section className="onb-step">
      <StepHead
        n="1"
        title={replay ? `Rebonjour, ${name}` : `Salut ${name}`}
        sub="Une photo pour commencer. Elle ira à côté de tes avis."
      />

      <div className="onb-avatar-row">
        <div className="onb-avatar-big">
          {current ? <img src={current} alt="" /> : <span>{initial}</span>}
          {busy && (
            <span className="onb-avatar-busy">
              <Loader2 className="spin" size={22} />
            </span>
          )}
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
//  2 et 3 — Les jeux, en cartes jetées sur la table
// ======================================================================
// Le même écran sert deux fois : une fois pour l'envie, une fois pour le
// passé. Seuls le titre, le statut écrit et le minimum changent.
//
// ⚠️ LA RANGÉE DE SAGAS N'EST PAS UNE DÉCORATION, C'EST CE QUI CHANGE LA
// DONNE. Un tapis de « jeux populaires » est le même pour tout le monde et ne
// ressemble à personne : au bout de vingt cartes, celui qui ne joue qu'à Zelda
// et Pokémon n'a rien trouvé. Ouvrir une saga REMPLACE le paquet par ses jeux
// à elle — deux clics pour attraper trois Final Fantasy.
//
// ⚠️ ET ON RETIRE CE QU'IL A DÉJÀ. Poser sur la table un jeu qui est déjà dans
// sa bibliothèque, c'est lui demander de refaire un choix qu'il a déjà fait —
// il n'y a rien à répondre à une carte cochée d'avance.
function StepPick({ conf, stepKey, picks, picked, onPicked, library, have, token }) {
  const [saga, setSaga] = useState(null);
  const [sagaGames, setSagaGames] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      apiFetch(`/games?search=${encodeURIComponent(q)}&limit=36`, { token })
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
      setSagaGames((d.games || []).filter((g) => g.cover).slice(0, 40));
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
      if (next[id]) delete next[id];
      else next[id] = { status: conf.status, name: game.name, cover: game.cover || null };
      return next;
    });
  }

  const deck = useMemo(() => {
    const source = results ?? sagaGames ?? picks?.games ?? null;
    if (!source) return null;
    return source.filter((g) => g.cover && !library?.[g.id]);
  }, [results, sagaGames, picks, library]);

  return (
    <section className="onb-step onb-step-wide">
      <StepHead n={conf.n} title={conf.title} sub={conf.sub} />

      {have > 0 && (
        <p className="onb-have">
          <Check size={13} strokeWidth={3} />
          {stepKey === "wishlist"
            ? `${have} déjà dans tes envies. Tu peux passer directement.`
            : `${have} déjà dans ta bibliothèque. Tu peux passer directement.`}
        </p>
      )}

      {picks?.franchises?.length > 0 && (
        <div className="onb-sagas" role="tablist">
          {picks.franchises.map((s) => {
            const on = saga?.id === s.id && saga?.kind === s.kind;
            return (
              <button
                key={`${s.kind}:${s.id}`}
                role="tab"
                aria-selected={on}
                className={`onb-saga clickable ${on ? "active" : ""}`}
                onClick={() => openSaga(s)}
                title={s.name}
              >
                <img src={s.cover} alt="" loading="lazy" />
                <span>{s.name}</span>
              </button>
            );
          })}
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
          <button
            className="onb-search-clear clickable"
            onClick={() => setQuery("")}
            aria-label="Effacer"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {(saga || results) && (
        <div className="onb-scope">
          <span>{results ? `« ${query.trim()} »` : `Saga ${saga.name}`}</span>
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

      <ScatterDeck
        games={deck}
        picked={picked}
        onToggle={toggle}
        accent={conf.status === "wishlist" ? "wishlist" : "played"}
        loading={loading}
      />
    </section>
  );
}

// ======================================================================
//  Le tapis de cartes
// ======================================================================
// Des jaquettes jetées à plat, penchées, qui se chevauchent — un paquet qu'on
// vient de faire tomber par terre, pas une grille de produits. C'est tout le
// propos : dans une grille on LIT une liste, sur un tapis on ATTRAPE ce qu'on
// reconnaît.
//
// ⚠️ LES INCLINAISONS NE SONT PAS TIRÉES AU HASARD À CHAQUE RENDU, elles sont
// CALCULÉES À PARTIR DE L'IDENTIFIANT DU JEU. Un `Math.random()` ici, et tout
// le tapis se redistribue au moindre clic : on attraperait une carte et les
// onze autres sauteraient. Le même jeu doit retomber au même endroit, toujours.
//
// ⚠️ ET LE GESTE PRINCIPAL EST LE GLISSÉ : on tire le tapis sur le côté, les
// cartes pivotent et retombent avec une autre main. Les deux flèches sont là
// pour la souris et le clavier — un geste qui n'existe qu'au doigt n'existe pas
// sur un ordinateur.

const HAND = 12; // combien de cartes sur la table à la fois
const SWIPE_MIN = 55; // au-delà de quoi un glissé change de main

// Les emplacements, en pourcentage du tapis. Volontairement IRRÉGULIERS et
// débordant les uns sur les autres : une grille déguisée se voit tout de
// suite, et c'est le chevauchement qui fait « posé là » plutôt que « rangé ».
const SLOTS = [
  { x: 9, y: 20 },
  { x: 27, y: 11 },
  { x: 45, y: 23 },
  { x: 63, y: 10 },
  { x: 81, y: 20 },
  { x: 92, y: 46 },
  { x: 17, y: 52 },
  { x: 35, y: 61 },
  { x: 54, y: 54 },
  { x: 72, y: 62 },
  { x: 88, y: 78 },
  { x: 25, y: 86 },
];

// Un bruit STABLE : le même identifiant donne toujours la même valeur.
function jitter(id, salt) {
  const n = Math.abs(Math.sin((Number(id) || 1) * (salt + 1) * 12.9898) * 43758.5453);
  return n - Math.floor(n); // 0 → 1
}

function ScatterDeck({ games, picked, onToggle, accent, loading }) {
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState(1);
  const drag = useRef(null);

  // Un nouveau paquet (saga ouverte, recherche) repart de sa première main :
  // rester à la page 4 d'un paquet qui n'en a que deux montrerait du vide.
  useEffect(() => {
    setPage(0);
  }, [games]);

  const pages = games ? Math.max(1, Math.ceil(games.length / HAND)) : 1;
  const safePage = Math.min(page, pages - 1);
  const hand = games ? games.slice(safePage * HAND, safePage * HAND + HAND) : null;

  const turn = useCallback(
    (delta) => {
      if (pages < 2) return;
      setDir(delta);
      setPage((p) => (p + delta + pages) % pages);
    },
    [pages]
  );

  // Le glissé, à la souris comme au doigt : les Pointer Events couvrent les
  // deux, et `setPointerCapture` garde le geste même si le curseur sort du
  // tapis en cours de route.
  function onDown(e) {
    if (e.button > 0) return;
    drag.current = { x: e.clientX, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onMove(e) {
    if (!drag.current) return;
    if (Math.abs(e.clientX - drag.current.x) > 8) drag.current.moved = true;
  }
  function onUp(e) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    // ⚠️ ON RELÂCHE APRÈS LE CLIC, PAS AVANT. Le `click` d'une carte part une
    // fraction de seconde après ce `pointerup` : effacer `drag` tout de suite
    // ferait passer la fin d'un glissé pour un clic, et on cocherait un jeu à
    // chaque fois qu'on tire le tapis.
    setTimeout(() => {
      drag.current = null;
    }, 0);
    if (Math.abs(dx) >= SWIPE_MIN) turn(dx < 0 ? 1 : -1);
  }

  if (!hand) {
    return (
      <div className="onb-scatter is-loading">
        {SLOTS.slice(0, 8).map((s, i) => (
          <span
            key={i}
            className="onb-card onb-card-skel"
            style={{ left: `${s.x}%`, top: `${s.y}%`, "--rot": `${(i % 5) - 2}deg` }}
          />
        ))}
      </div>
    );
  }

  if (!hand.length) {
    return (
      <p className="onb-note">
        {loading ? "Recherche…" : "Rien à proposer ici. Cherche un titre, ou passe."}
      </p>
    );
  }

  return (
    <>
      <div
        className="onb-scatter"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        {/* La clé porte la page : les cartes se remontent, donc l'animation de
            chute se rejoue, et chacune tombe avec son propre retard. */}
        <div className={`onb-hand ${dir > 0 ? "from-right" : "from-left"}`} key={safePage}>
          {hand.map((g, i) => {
            const slot = SLOTS[i % SLOTS.length];
            const on = !!picked[String(g.id)];
            return (
              <button
                key={g.id}
                className={`onb-card clickable ${on ? `picked ${accent}` : ""}`}
                onClick={() => {
                  if (drag.current?.moved) return;
                  onToggle(g);
                }}
                title={g.name}
                style={{
                  left: `${slot.x}%`,
                  top: `${slot.y}%`,
                  "--rot": `${(jitter(g.id, 1) - 0.5) * 26}deg`,
                  "--z": Math.round(jitter(g.id, 2) * 10),
                  "--d": `${i * 32}ms`,
                }}
              >
                <img src={g.cover} alt="" loading="lazy" draggable="false" />
                <span className="onb-card-mark">
                  {on ? <Check size={15} strokeWidth={3.2} /> : <span className="onb-card-dot" />}
                </span>
                <span className="onb-card-name">{g.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {pages > 1 && (
        <div className="onb-deal">
          <button
            className="onb-deal-btn clickable"
            onClick={() => turn(-1)}
            aria-label="Main précédente"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="onb-deal-hint">
            <Shuffle size={13} /> Glisse pour d'autres jeux
          </span>
          <button
            className="onb-deal-btn clickable"
            onClick={() => turn(1)}
            aria-label="Main suivante"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </>
  );
}

// ======================================================================
//  4 — L'import
// ======================================================================
// Les modales d'import existent déjà et sont bien meilleures que tout ce qu'on
// referait ici en petit : on les OUVRE, on ne les réécrit pas. Cette étape
// n'est qu'une vitrine — quelles portes existent, lesquelles sont ouvertes.
const SOON = ["PlayStation", "Xbox", "Nintendo", "Epic Games", "GOG"];

function StepImport() {
  const { user, token, updateUser } = useAuth();
  const { refresh } = useLibrary();
  const [status, setStatus] = useState(null);
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
        n="4"
        title={"Une bibliothèque ailleurs ?"}
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
          <span key={s} className="onb-soon-chip">
            {s}
          </span>
        ))}
      </div>

      {steamOpen && (
        <SteamImportModal onClose={() => setSteamOpen(false)} onDone={() => refresh?.()} />
      )}
      {backloggdOpen && (
        <BackloggdImportModal onClose={() => setBackloggdOpen(false)} onDone={() => refresh?.()} />
      )}
    </section>
  );
}

// ======================================================================
//  5 — Les gestes
// ======================================================================
// ⚠️ TROIS, ET SEULEMENT DES GESTES QUI EXISTENT VRAIMENT. Une astuce fausse
// est pire qu'aucune astuce : on la cherche ensuite pendant dix minutes. C'est
// aussi le SEUL écran du parcours qu'on ne fait que lire — d'où sa place, tout
// à la fin, quand il ne reste plus qu'à entrer.
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
      <StepHead n="5" title="Trois gestes" sub="Le reste s'apprend tout seul." />
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
