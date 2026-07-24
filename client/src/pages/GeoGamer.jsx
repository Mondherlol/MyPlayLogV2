import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Globe2,
  Play,
  Search,
  ArrowLeft,
  RotateCcw,
  Check,
  X,
  Gamepad2,
  Crown,
  Loader2,
  Swords,
  Volume2,
  VolumeX,
  HelpCircle,
  Home,
  Coins,
  MapPin,
  Plus,
  Minus,
  Maximize2,
  Ruler,
  Heart,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import {
  dedupeCandidates,
  estimateGeoPoints,
  estimateMapPoints,
  MAP_MAX_POINTS,
  sameGame,
  searchCandidates,
} from "../lib/guessGame";
import { useGameSfx } from "../lib/useGameSfx";

// ============================================================
//  GeoGamer — devine le jeu depuis un panorama 360°
// ============================================================
// On est lâché quelque part dans un monde de jeu. Impossible de bouger : on
// tourne la tête, on cherche le détail qui trahit le titre, et on répond.
//
// PARTI PRIS D'INTERFACE : le panorama n'est pas une illustration posée dans
// une page, c'est L'ÉCRAN. Tout le reste flotte par-dessus en verre sombre —
// aucun cadre, aucune marge, aucune carte. La page réclame donc le repli de la
// barre latérale et la suppression des marges du gabarit le temps de la partie
// (cf. la classe `geo-immersive` posée sur <body>).
//
// C'est aussi pour ça qu'on ne réutilise AUCUNE classe .bt-* : le blind test
// est une page-document centrée sur un vinyle, celle-ci est un cockpit.
const PanoViewer = lazy(() => import("../components/PanoViewer"));

// Décompte avant passage automatique à la manche suivante (la barre CSS
// .geo-rv-bar dure aussi 5 s — garder synchro).
const AUTO_NEXT_MS = 5000;
// Quand une manche carte suit, on n'attend pas : le joueur a trouvé, il veut
// enchaîner sur la carte, pas contempler cinq secondes de bandeau.
const AUTO_MAP_MS = 900;

// Seuil d'alerte du chrono : en dessous, tout le HUD vire au rouge.
const HOT_SEC = 10;

// Vies par lieu : trois tentatives avant de perdre la manche. Une mauvaise
// réponse coûte un cœur mais ne verrouille pas — on continue à chercher tant
// qu'il reste un cœur ET du temps.
const LIVES = 3;

// ============================================================
//  Le chrono — l'objet le plus regardé de l'écran
// ============================================================
// Un anneau SVG qui se vide, le nombre de secondes au centre. Rien d'autre en
// haut de l'écran ne doit lui disputer l'attention : c'est la seule information
// qui change en continu et qui coûte des points.
const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;

function TimerRing({ seconds, progress, hot, idle }) {
  return (
    <div className={`geo-timer ${hot ? "hot" : ""} ${idle ? "idle" : ""}`}>
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle className="geo-timer-track" cx="36" cy="36" r={RING_R} />
        <circle
          className="geo-timer-fill"
          cx="36"
          cy="36"
          r={RING_R}
          strokeDasharray={RING_C}
          // On décompte : l'anneau est plein au départ et se vide.
          strokeDashoffset={RING_C * progress}
        />
      </svg>
      <span className="geo-timer-num">{idle ? "—" : seconds}</span>
    </div>
  );
}

// ============================================================
//  La manche bonus — « où sur la carte ? »
// ============================================================
// 712 lieux du catalogue savent aussi OÙ ils se situent sur une carte du jeu.
// On ne la propose QUE si le jeu a été trouvé : c'est une récompense pour ceux
// qui le connaissent vraiment, pas une seconde chance.
//
// Toutes les coordonnées circulent dans le repère de la carte D'ORIGINE (celui
// du point de réponse). L'affichage n'est qu'une mise à l'échelle : le
// conteneur porte le `aspect-ratio` exact de l'image, donc un pourcentage de
// largeur correspond au même pourcentage de pixels, et la conversion tient en
// une règle de trois — quelle que soit la taille de l'écran.
const MAP_SEC = 25;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

// Contraint la translation pour que la carte couvre toujours le cadre : on ne
// doit jamais pouvoir la faire sortir et se retrouver devant du vide.
function clampView(v, box) {
  const w = box.width * v.z;
  const h = box.height * v.z;
  return {
    z: v.z,
    x: w <= box.width ? (box.width - w) / 2 : Math.min(0, Math.max(box.width - w, v.x)),
    y: h <= box.height ? (box.height - h) / 2 : Math.min(0, Math.max(box.height - h, v.y)),
  };
}

function MapRound({ map, gameName, onDone, sfx }) {
  const [pin, setPin] = useState(null);
  const [result, setResult] = useState(null);
  const [left, setLeft] = useState(MAP_SEC);
  // Filet de sécurité : si la carte ne se charge pas, on ne bloque pas le
  // joueur sur un cadre vide — on lui offre une sortie propre.
  const [imgError, setImgError] = useState(false);
  // Vue courante : facteur de zoom + translation EN PIXELS du cadre.
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });

  const boxRef = useRef(null);
  const pinRef = useRef(null);
  pinRef.current = pin;
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef(null);
  const validateRef = useRef(() => {});

  const validate = useCallback(() => {
    if (result) return;
    const p = pinRef.current;
    const r = estimateMapPoints(map, p);
    setResult({ ...r, guess: p });
    sfx.play(r.points > MAP_MAX_POINTS * 0.5 ? "correct" : "wrong");
  }, [map, result, sfx]);
  validateRef.current = validate;

  // Chrono : sans épingle posée à zéro, la manche vaut zéro. On ne bloque pas
  // le joueur indéfiniment sur une carte qu'il ne reconnaît pas.
  useEffect(() => {
    if (result) return;
    const end = Date.now() + MAP_SEC * 1000;
    const iv = setInterval(() => {
      const s = Math.ceil((end - Date.now()) / 1000);
      setLeft(Math.max(0, s));
      if (s <= 0) {
        clearInterval(iv);
        validateRef.current();
      }
    }, 200);
    return () => clearInterval(iv);
  }, [result]);

  // Une fois le résultat affiché, on recadre sur les deux points pour que le
  // joueur voie son erreur en entier plutôt qu'un zoom sur son seul clic.
  useEffect(() => {
    if (result) setView({ z: 1, x: 0, y: 0 });
  }, [result]);

  const applyZoom = useCallback((factor, cx, cy) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    setView((v) => {
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.z * factor));
      const k = z / v.z;
      // Point d'ancrage : ce qui est sous le curseur ne doit pas bouger.
      const ax = cx ?? box.width / 2;
      const ay = cy ?? box.height / 2;
      return clampView({ z, x: ax - k * (ax - v.x), y: ay - k * (ay - v.y) }, box);
    });
  }, []);

  function onWheel(e) {
    if (result) return;
    const box = boxRef.current.getBoundingClientRect();
    applyZoom(e.deltaY < 0 ? 1.25 : 1 / 1.25, e.clientX - box.left, e.clientY - box.top);
  }

  // Un même geste sert à déplacer ET à pointer : on ne tranche qu'au relâché,
  // selon la distance parcourue. En dessous du seuil c'est un clic, au-dessus
  // c'était un déplacement — sinon poser une épingle deviendrait impossible
  // dès qu'on bouge d'un pixel.
  function onPointerDown(e) {
    if (result) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: viewRef.current.x,
      oy: viewRef.current.y,
      moved: 0,
    };
  }

  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    d.moved = Math.max(d.moved, Math.hypot(dx, dy));
    if (d.moved < 4) return;
    const box = boxRef.current.getBoundingClientRect();
    setView((v) => clampView({ ...v, x: d.ox + dx, y: d.oy + dy }, box));
  }

  function onPointerUp(e) {
    const d = dragRef.current;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!d || d.moved >= 4 || result) return;
    // Clic franc : on convertit en FRACTION de la carte, en défaisant la vue
    // courante. C'est le repère dans lequel le point de réponse est stocké, et
    // le seul qui survive à un zoom ou à un changement d'écran.
    const box = boxRef.current.getBoundingClientRect();
    const v = viewRef.current;
    const x = (e.clientX - box.left - v.x) / (box.width * v.z);
    const y = (e.clientY - box.top - v.y) / (box.height * v.z);
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setPin({ x, y });
    sfx.play("pin");
  }

  const shown = result?.guess || pin;
  const at = (p) => ({ left: `${p.x * 100}%`, top: `${p.y * 100}%` });
  // Les épingles gardent leur taille à l'écran : on annule le zoom du calque.
  const pinScale = { transform: `translate(-50%, -100%) scale(${1 / view.z})` };

  return (
    <div className="geo-map">
      <div className="geo-map-head">
        <span className="geo-map-title">
          <MapPin size={15} />
          Où étais-tu dans <b>{gameName}</b> ?
        </span>
        {!result ? (
          <span className={`geo-map-timer ${left <= 8 ? "hot" : ""}`}>{left}s</span>
        ) : (
          <span className="geo-map-score">
            +{result.points}
            <em>pts</em>
          </span>
        )}
      </div>

      <div
        className={`geo-map-stage ${result ? "done" : ""} ${view.z > 1 ? "zoomed" : ""}`}
        ref={boxRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="geo-map-layer"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
        >
          <img
            src={map.image}
            alt=""
            draggable="false"
            onError={() => setImgError(true)}
          />

          {/* Le trait entre le clic et la vérité : c'est lui qui fait
              comprendre l'erreur d'un coup d'œil. Le viewBox est en centièmes
              et `preserveAspectRatio: none` le fait s'étirer exactement comme
              l'image. */}
          {result?.guess && (
            <svg
              className="geo-map-link"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <line
                x1={result.guess.x * 100}
                y1={result.guess.y * 100}
                x2={map.answer.x * 100}
                y2={map.answer.y * 100}
              />
            </svg>
          )}

          {result && (
            <span className="geo-map-pin truth" style={{ ...at(map.answer), ...pinScale }}>
              <i className="geo-map-halo" />
              <MapPin size={26} />
            </span>
          )}
          {shown && (
            <span className="geo-map-pin mine" style={{ ...at(shown), ...pinScale }}>
              <MapPin size={26} />
            </span>
          )}
        </div>

        {/* Commandes de vue, posées sur le cadre. */}
        <div className="geo-map-zoom">
          <button
            className="clickable"
            onClick={(e) => {
              e.stopPropagation();
              applyZoom(1.4);
            }}
            title="Zoomer"
          >
            <Plus size={15} />
          </button>
          <button
            className="clickable"
            onClick={(e) => {
              e.stopPropagation();
              applyZoom(1 / 1.4);
            }}
            title="Dézoomer"
          >
            <Minus size={15} />
          </button>
          <button
            className="clickable"
            onClick={(e) => {
              e.stopPropagation();
              setView({ z: 1, x: 0, y: 0 });
            }}
            title="Recadrer"
            disabled={view.z === 1}
          >
            <Maximize2 size={14} />
          </button>
        </div>

        {/* Carte illisible : plutôt qu'un cadre noir muet, une sortie claire. */}
        {imgError && (
          <div className="geo-map-broken">
            <MapPin size={26} />
            <span>Carte indisponible</span>
            <button className="geo-rv-next clickable" onClick={() => onDone(null)}>
              Continuer
            </button>
          </div>
        )}
      </div>

      <div className="geo-map-foot">
        {result ? (
          <>
            <span className="geo-map-verdict">
              {result.guess ? (
                <>
                  <Ruler size={14} /> à <b>{Math.round(result.distance * 100)}%</b> de la carte
                </>
              ) : (
                <>Aucune réponse</>
              )}
            </span>
            <button className="geo-rv-next clickable" onClick={() => onDone(result)}>
              Continuer
            </button>
          </>
        ) : (
          <>
            <span className="geo-map-help">
              {pin ? "Déplace ton épingle ou valide" : "Clique pour te situer"}
              <em>molette pour zoomer · glisser pour déplacer</em>
            </span>
            <button className="geo-rv-next clickable" onClick={validate} disabled={!pin}>
              Valider
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
//  L'écran d'accueil — tout se passe DANS le globe
// ============================================================
// Le menu n'est pas posé DEVANT le globe : il est DEDANS. C'est ce qui a
// dicté la technique — une sphère three.js ne peut pas héberger de DOM, donc
// le globe est en CSS. Il gagne au passage un panorama qui défile derrière lui
// et une inclinaison qui suit la souris, deux choses qui le font exister comme
// un objet plutôt que comme une image de fond.
//
// L'amplitude de bascule est volontairement faible : au-delà d'une dizaine de
// degrés le texte à l'intérieur devient pénible à lire, et l'objet cesse d'être
// un support pour devenir un gadget.
const TILT_MAX = 9;

function GlobeMenu({ children, onBack, muted, onToggleMute }) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const rafRef = useRef(0);

  // On passe par requestAnimationFrame : un mousemove tire jusqu'à plusieurs
  // centaines d'évènements par seconde, et rendre React à ce rythme ferait
  // ramer toute la page pour une inclinaison de neuf degrés.
  const onMove = useCallback((e) => {
    const { clientX, clientY } = e;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      setTilt({
        // L'axe vertical de la souris pilote la rotation X, et inversement :
        // on incline l'objet VERS le curseur.
        x: -((clientY - cy) / cy) * TILT_MAX,
        y: ((clientX - cx) / cx) * TILT_MAX,
      });
    });
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <section className="geo-menu" onMouseMove={onMove}>
      {/* Le décor : un panorama qui défile, flouté et assombri. Il ne doit
          jamais disputer l'attention au globe — juste rappeler de quoi il
          est question. */}
      <span className="geo-menu-bg" aria-hidden="true" />
      <span className="geo-menu-veil" aria-hidden="true" />

      {/* Retour à gauche, son à droite : deux commandes de page, hors du globe,
          symétriques dans les coins hauts. */}
      <button className="geo-back clickable" onClick={onBack}>
        <ArrowLeft size={16} /> Retour
      </button>
      <button
        className={`geo-menu-sound clickable ${muted ? "off" : "on"}`}
        onClick={onToggleMute}
        aria-pressed={!muted}
        title={muted ? "Réactiver les sons" : "Couper les sons"}
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>

      <div
        className="geo-orb"
        style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}
      >
        <span className="geo-orb-face" aria-hidden="true" />
        <span className="geo-orb-mer a" aria-hidden="true" />
        <span className="geo-orb-mer b" aria-hidden="true" />
        <span className="geo-orb-eq" aria-hidden="true" />
        <span className="geo-orb-gloss" aria-hidden="true" />
        <div className="geo-orb-in">{children}</div>
      </div>
    </section>
  );
}

export default function GeoGamer() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const challengeId = params.get("challenge");
  const sfx = useGameSfx();

  // phase : intro | loading | playing | done | error
  const [phase, setPhase] = useState("intro");
  const [error, setError] = useState("");
  const [roundCount, setRoundCount] = useState(10);
  const [muted, setMuted] = useState(false);

  // Données de la partie
  const [sessionId, setSessionId] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [challengeInfo, setChallengeInfo] = useState(null);

  // Déroulé
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [reveal, setReveal] = useState(null);
  // Manche bonus en cours (« où sur la carte ? »), intercalée entre la
  // révélation et la manche suivante.
  const [mapStage, setMapStage] = useState(false);
  const [nextIn, setNextIn] = useState(5);
  const [final, setFinal] = useState(null);
  // Vies restantes sur le lieu courant + brève notification de vie perdue.
  const [lives, setLives] = useState(LIVES);
  const [wrongFlash, setWrongFlash] = useState(null);
  const livesRef = useRef(LIVES);
  livesRef.current = lives;
  // Le panorama de la manche est-il affiché ? Tant qu'il charge, le chrono
  // n'est pas lancé : c'est LA différence de fond avec les deux autres
  // mini-jeux, dont les images arrivent en quelques dizaines de millisecondes.
  const [panoReady, setPanoReady] = useState(false);

  // Recherche (guess)
  const [input, setInput] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const suggestRef = useRef(null);

  // Refs de contrôle (timers / closures fraîches)
  const guessesRef = useRef([]);
  const roundStartRef = useRef(0);
  const lockedRef = useRef(false);
  const lastTickRef = useRef(-1);
  const finishingRef = useRef(false);
  const advanceRef = useRef(() => {});
  const revealAtRef = useRef(0);

  useEffect(() => {
    sfx.setMuted(muted);
  }, [muted, sfx]);

  // Mode immersif : dès le CHARGEMENT et pendant la partie. Le menu de
  // lancement, l'écran d'épuisement et le tableau final restent des pages
  // normales (avec barre latérale) ; mais « on choisit tes destinations » fait
  // déjà partie du jeu, il doit s'afficher plein écran comme le panorama qui
  // suit — sinon la barre latérale réapparaît une seconde entre les deux.
  const immersive = phase === "playing" || phase === "loading";
  useEffect(() => {
    if (!immersive) return;
    document.body.classList.add("geo-immersive");
    window.dispatchEvent(new CustomEvent("mpl:sidebar-force", { detail: true }));
    return () => {
      document.body.classList.remove("geo-immersive");
      window.dispatchEvent(new CustomEvent("mpl:sidebar-force", { detail: false }));
    };
  }, [immersive]);


  const round = rounds[idx];
  const durationMs = round ? round.durationSec * 1000 : 0;
  const progress = durationMs ? Math.min(1, elapsedMs / durationMs) : 0;
  const timeLeftMs = Math.max(0, durationMs - elapsedMs);
  const secondsLeft = Math.ceil(timeLeftMs / 1000);
  const hot = panoReady && secondsLeft <= HOT_SEC;

  // --- Démarrage d'une partie ---
  async function startGame() {
    sfx.resume(); // crée/réveille l'AudioContext dans le geste utilisateur
    sfx.play("launch");
    setError("");
    setPhase("loading");
    setFinal(null);
    setReveal(null);
    setIdx(0);
    setScore(0);
    guessesRef.current = [];
    try {
      const d = challengeId
        ? await apiFetch(`/geo/challenge/${challengeId}`, { token })
        : await apiFetch("/geo/start", {
            method: "POST",
            token,
            body: { rounds: roundCount },
          });
      setSessionId(d.sessionId);
      setRounds(d.rounds || []);
      setCandidates(d.candidates || []);
      setChallengeInfo(d.challenge || null);
      guessesRef.current = new Array((d.rounds || []).length).fill(null);
      setPhase("playing");
    } catch (e) {
      // Le joueur a fait le tour de tout le catalogue : écran dédié, pas une
      // erreur — il n'a rien fait de mal, il a juste tout exploré.
      if (e.data?.code === "EXHAUSTED") {
        setError(e.message);
        setPhase("exhausted");
        return;
      }
      setError(e.message || "Impossible de lancer la partie.");
      setPhase("error");
    }
  }

  // Verrouille la manche : plus de saisie, on passe à la révélation. Facteur
  // commun aux trois issues (trouvé, forfait/temps, dernier cœur perdu).
  const lockRound = useCallback(
    (r, cand, correct) => {
      lockedRef.current = true;
      const timeMs = cand ? Date.now() - roundStartRef.current : null;
      const points = estimateGeoPoints(
        r,
        cand?.id ?? null,
        cand?.name ?? "",
        timeMs,
        r.durationSec
      );
      guessesRef.current[idx] = {
        id: r.id,
        gameId: cand?.id ?? null,
        name: cand?.name ?? "",
        timeMs,
      };
      setScore((s) => s + points);
      sfx.play(correct ? "correct" : "wrong");
      revealAtRef.current = Date.now();
      setReveal({ correct, points, round: r, guessName: cand?.name ?? null });
    },
    [idx, sfx]
  );

  // --- Une réponse : `cand` = jeu proposé, `null` = forfait / temps écoulé ---
  // Trois vies par lieu : une mauvaise réponse coûte un cœur mais ne verrouille
  // pas la manche tant qu'il en reste un.
  const submitGuess = useCallback(
    (cand) => {
      if (lockedRef.current) return;
      const r = rounds[idx];
      if (!r) return;

      // Forfait ou temps écoulé : la manche est perdue, sans toucher aux cœurs.
      if (!cand) {
        lockRound(r, null, false);
        return;
      }
      // Bonne réponse : trouvé, quel que soit le nombre de cœurs restants.
      if (sameGame(r, cand.id, cand.name)) {
        lockRound(r, cand, true);
        return;
      }
      // Mauvaise réponse : un cœur en moins.
      const remaining = livesRef.current - 1;
      livesRef.current = remaining;
      setLives(remaining);
      setInput("");
      setHighlight(0);
      if (remaining <= 0) {
        // Plus de cœur : manche perdue, on garde la dernière réponse donnée.
        lockRound(r, cand, false);
      } else {
        sfx.play("wrong");
        setWrongFlash({ name: cand.name, left: remaining, at: Date.now() });
      }
    },
    [rounds, idx, lockRound, sfx]
  );

  // --- Timer d'une manche ---
  // Il ne démarre QU'UNE FOIS LE PANORAMA À L'ÉCRAN. Un fichier de plusieurs
  // mégaoctets met du temps à arriver : lancer le chrono à l'affichage de la
  // manche reviendrait à facturer au joueur la lenteur de son réseau.
  useEffect(() => {
    if (phase !== "playing" || !panoReady) return;
    const r = rounds[idx];
    if (!r) return;
    lockedRef.current = false;
    lastTickRef.current = -1;
    setElapsedMs(0);
    roundStartRef.current = Date.now();
    sfx.play("start");
    setTimeout(() => inputRef.current?.focus(), 60);

    const total = r.durationSec * 1000;
    const iv = setInterval(() => {
      if (lockedRef.current) {
        clearInterval(iv);
        return;
      }
      const el = Date.now() - roundStartRef.current;
      setElapsedMs(Math.min(el, total));
      const left = Math.max(0, total - el);
      if (left <= 5000 && left > 0) {
        const sec = Math.ceil(left / 1000);
        if (sec !== lastTickRef.current) {
          lastTickRef.current = sec;
          sfx.play("tick-hot");
        }
      }
      if (left <= 0) {
        clearInterval(iv);
        if (!lockedRef.current) submitGuess(null);
      }
    }, 100);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx, panoReady]);

  // Remise à zéro à chaque changement de manche : le nouveau panorama doit
  // annoncer lui-même qu'il est prêt avant que quoi que ce soit ne reparte.
  useEffect(() => {
    setPanoReady(false);
    setReveal(null);
    setMapStage(false);
    setInput("");
    setHighlight(0);
    setElapsedMs(0);
    setLives(LIVES);
    livesRef.current = LIVES;
    setWrongFlash(null);
  }, [idx]);

  // La notification « raté » s'efface d'elle-même après un court instant.
  useEffect(() => {
    if (!wrongFlash) return;
    const t = setTimeout(() => setWrongFlash(null), 1700);
    return () => clearTimeout(t);
  }, [wrongFlash]);

  // Préchargement de la manche suivante pendant qu'on joue celle-ci : le
  // fichier atterrit dans le cache HTTP, et PanoViewer le retrouvera
  // instantanément au lieu de refaire attendre le joueur.
  useEffect(() => {
    if (phase !== "playing") return;
    const next = rounds[idx + 1];
    if (!next?.image) return;
    const ac = new AbortController();
    // Même mode que le chargement réel, sinon l'entrée de cache ne serait pas
    // réutilisée.
    fetch(next.image, { signal: ac.signal, mode: "cors" })
      .then((r) => r.blob())
      .catch(() => {
        /* le préchargement est un bonus, jamais une condition */
      });
    return () => ac.abort();
  }, [phase, idx, rounds]);


  // --- Envoi final ---
  const finishGame = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setPhase("loading");
    try {
      const res = await apiFetch("/geo/finish", {
        method: "POST",
        token,
        body: { sessionId, guesses: guessesRef.current.filter(Boolean) },
      });
      setFinal(res);
      setPhase("done");
      sfx.play("finish");
    } catch (e) {
      // Repli : on montre quand même le tableau reconstruit côté client.
      const localRounds = rounds.map((r, i) => {
        const g = guessesRef.current[i];
        const correct = g ? sameGame(r, g.gameId, g.name) : false;
        // Même règle que le serveur : la manche carte ne compte que si le jeu
        // a été trouvé.
        const mapGuess = correct ? g?.mapGuess || null : null;
        const mapRes = estimateMapPoints(r.map, mapGuess);
        return {
          map: r.map
            ? { ...r.map, guess: mapGuess, distance: mapRes.distance, points: mapRes.points }
            : null,
          gameId: r.gameId,
          gameName: r.gameName,
          cover: r.cover,
          image: r.image,
          difficulty: r.difficulty,
          owned: r.owned,
          correct,
          guessedName: g?.name || "",
          points: estimateGeoPoints(
            r,
            g?.gameId ?? null,
            g?.name || "",
            g?.timeMs ?? null,
            r.durationSec
          ),
          timeMs: g?.timeMs ?? null,
        };
      });
      const total = Math.max(
        0,
        localRounds.reduce((a, r) => a + r.points + (r.map?.points || 0), 0)
      );
      setFinal({
        geoGameId: null,
        score: total,
        correctCount: localRounds.filter((r) => r.correct).length,
        roundCount: localRounds.length,
        challenge: challengeInfo
          ? {
              username: challengeInfo.user?.username,
              score: challengeInfo.score,
              beaten: total > (challengeInfo.score ?? 0),
            }
          : null,
        rounds: localRounds,
        _offline: e.message,
      });
      setPhase("done");
      sfx.play("finish");
    } finally {
      finishingRef.current = false;
    }
  }, [sessionId, token, rounds, sfx, challengeInfo]);

  // --- Passage à la manche suivante (ou fin) ---
  const advance = useCallback(() => {
    setReveal(null);
    setMapStage(false);
    if (idx + 1 < rounds.length) setIdx((i) => i + 1);
    else finishGame();
  }, [idx, rounds.length, finishGame]);

  const goNext = useCallback(() => {
    // Manche bonus : jeu trouvé + lieu cartographié → on passe par « où sur la
    // carte ? » avant de changer de décor. Sinon on enchaîne directement.
    if (!mapStage && reveal?.correct && round?.map) {
      setReveal(null);
      setMapStage(true);
      sfx.play("map-open");
      return;
    }
    advance();
  }, [mapStage, reveal, round, advance, sfx]);
  advanceRef.current = goNext;

  // Fin de la manche carte : on range le clic avec la réponse de la manche
  // (c'est /finish qui recalculera les points pour de vrai) et on enchaîne.
  const onMapDone = useCallback(
    (result) => {
      const prev = guessesRef.current[idx];
      if (prev) prev.mapGuess = result?.guess || null;
      setScore((s) => s + (result?.points || 0));
      advance();
    },
    [idx, advance]
  );

  // Décompte après la révélation, puis auto-avance. Quand une manche carte
  // suit, l'attente est réduite au minimum : le joueur a trouvé, il veut
  // enchaîner, pas regarder un bandeau pendant cinq secondes.
  useEffect(() => {
    if (!reveal) return;
    const total = reveal.correct && round?.map ? AUTO_MAP_MS : AUTO_NEXT_MS;
    let left = total;
    let last = Date.now();
    setNextIn(Math.ceil(total / 1000));
    const iv = setInterval(() => {
      const now = Date.now();
      left -= now - last;
      last = now;
      if (left <= 0) {
        clearInterval(iv);
        advanceRef.current();
        return;
      }
      setNextIn(Math.ceil(left / 1000));
    }, 100);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  // --- Raccourcis clavier (PC) ---
  useEffect(() => {
    function onKey(e) {
      if (e.repeat) return;
      const k = e.key;
      if (phase === "intro" && k === "Enter") {
        e.preventDefault();
        startGame();
        return;
      }
      if (phase !== "playing") return;
      if (reveal) {
        // Une Entrée tapée « en retard » ne doit pas zapper le résultat.
        if (Date.now() - revealAtRef.current < 400) return;
        if (k === "Enter" || k === " ") {
          e.preventDefault();
          advanceRef.current();
        }
        return;
      }
      // Entrée alors qu'on a perdu le champ (un clic sur le décor pour le faire
      // tourner suffit) : on y ramène le focus au lieu de ne rien faire. Quand
      // le champ EST déjà actif, c'est son propre gestionnaire qui valide la
      // réponse — d'où le test sur l'élément actif.
      if (k === "Enter" && !mapStage && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const uniqueCandidates = useMemo(() => dedupeCandidates(candidates), [candidates]);
  const suggestions = useMemo(
    () => searchCandidates(input, uniqueCandidates),
    [input, uniqueCandidates]
  );

  useEffect(() => {
    suggestRef.current?.children[highlight]?.scrollIntoView({ block: "nearest" });
  }, [highlight, suggestions]);

  function onKeyDown(e) {
    if (reveal) return;
    if (e.key === "Tab") {
      e.preventDefault();
      const pick = suggestions[highlight] || suggestions[0];
      if (pick) {
        setInput(pick.name);
        setHighlight(0);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const pick = suggestions[highlight] || suggestions[0];
      if (pick) submitGuess(pick);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    }
  }



  // Le panorama vient de s'afficher : petit son d'atterrissage, puis le chrono
  // démarre (cf. l'effet plus haut, qui attend `panoReady`).
  const onPanoReady = useCallback(() => {
    setPanoReady(true);
    sfx.play("land");
  }, [sfx]);
  const quit = useCallback(() => navigate("/arcade"), [navigate]);

  return (
    <div className={`geo ${phase === "playing" ? "in-game" : ""}`}>
      {/* ---------- INTRO ---------- */}
      {phase === "intro" && (
        <GlobeMenu
          onBack={quit}
          muted={muted}
          onToggleMute={() => setMuted((m) => !m)}
        >
          <h1 className="geo-title">{challengeId ? "Relève le défi" : "GeoGamer"}</h1>
          <p className="geo-lede">
            {challengeId
              ? "Les mêmes lieux qu'un autre joueur."
              : "Devine le jeu et parfois le Lieu aussi."}
          </p>

          {!challengeId && (
            <div className="geo-seg" role="group" aria-label="Nombre de manches">
              {[5, 10, 15].map((n) => (
                <button
                  key={n}
                  className={`geo-seg-opt clickable ${roundCount === n ? "on" : ""}`}
                  onClick={() => setRoundCount(n)}
                  aria-pressed={roundCount === n}
                >
                  {n}
                  <em>manches</em>
                </button>
              ))}
            </div>
          )}

          <button className="geo-cta clickable" onClick={startGame}>
            {challengeId ? <Swords size={19} /> : <Play size={19} />}
            {challengeId ? "Relever le défi" : "Lancer"}
          </button>
          <span className="geo-kbd-hint">
            ou <kbd>Entrée</kbd>
          </span>
        </GlobeMenu>
      )}

      {/* ---------- LOADING ---------- */}
      {phase === "loading" && (
        <section className="geo-wait">
          <Loader2 size={32} className="spin" />
          <p>
            {final || finishingRef.current
              ? "On calcule ton score…"
              : "On choisit tes destinations…"}
          </p>
        </section>
      )}

      {/* ---------- ERROR ---------- */}
      {phase === "error" && (
        <section className="geo-wait err">
          <p>{error}</p>
          <div className="geo-wait-actions">
            <button className="geo-cta sm clickable" onClick={() => setPhase("intro")}>
              <RotateCcw size={16} /> Réessayer
            </button>
            <Link to="/arcade" className="geo-ghost clickable">
              Retour à l'arcade
            </Link>
          </div>
        </section>
      )}

      {/* ---------- ÉPUISEMENT : le joueur a fait le tour du catalogue ---------- */}
      {phase === "exhausted" && (
        <section className="geo-exhausted">
          <span className="geo-exhausted-badge">
            <Globe2 size={40} />
          </span>
          <h1>Tu as fait le tour du monde&nbsp;!</h1>
          <p>{error}</p>
          <Link to="/arcade" className="geo-cta clickable">
            <Home size={17} /> Retour à l'arcade
          </Link>
        </section>
      )}

      {/* ---------- PARTIE ----------
          Le panorama occupe TOUT. Le HUD flotte dessus en verre sombre, et il
          est en pointer-events:none par défaut : la couche de saisie du viewer
          est en dessous, une pastille qui capterait le clic créerait une zone
          morte où le décor refuserait de tourner. Chaque élément réellement
          cliquable réactive les événements pour lui-même. */}
      {phase === "playing" && round && (
        <section className={`geo-game ${hot ? "hot" : ""}`}>
          <Suspense
            fallback={
              <div className="pano-load">
                <Loader2 size={30} className="spin" />
                <span className="pano-load-txt">Préparation du décor…</span>
              </div>
            }
          >
            <PanoViewer
              key={round.image}
              src={round.image}
              // Toujours manipulable pendant la révélation : c'est justement
              // là qu'on veut retourner voir le détail qu'on avait raté.
              interactive
              onReady={onPanoReady}
            />
          </Suspense>

          {/* Voile de lisibilité : sans lui, du texte blanc sur un panorama
              enneigé devient illisible. Deux dégradés discrets, haut et bas. */}
          <span className="geo-vignette" aria-hidden="true" />

          {/* Le cadre de visée : quatre équerres aux angles, comme dans un
              viseur d'appareil photo. Purement décoratif, mais c'est lui qui
              transforme le panorama en « prise de vue » plutôt qu'en fond
              d'écran. */}
          <span className="geo-frame" aria-hidden="true">
            <i className="tl" />
            <i className="tr" />
            <i className="bl" />
            <i className="br" />
          </span>

          {/* ---- HUD haut ----
              À gauche l'état de la partie (manche + score, dans un seul bloc
              sobre), au centre le chrono, à droite les deux seules commandes :
              fermer, puis couper le son. Tout ce qui n'était qu'informatif —
              la difficulté du lieu — a disparu : ça ne se lisait pas et ça ne
              servait à rien pendant qu'on cherche. */}
          <header className="geo-hud-top">
            <div className="geo-hud-l">
              <div className="geo-state">
                <span className="geo-state-round">
                  {idx + 1}
                  <em>/{rounds.length}</em>
                </span>
                <i className="geo-state-sep" aria-hidden="true" />
                <span className="geo-state-score">
                  {score}
                  <em>pts</em>
                </span>
              </div>
              <div className="geo-pips" aria-hidden="true">
                {rounds.map((_, i) => (
                  <i key={i} className={i < idx ? "done" : i === idx ? "cur" : ""} />
                ))}
              </div>
            </div>

            <TimerRing
              seconds={secondsLeft}
              progress={progress}
              hot={hot}
              idle={!panoReady}
            />

            <div className="geo-hud-r">
              <button className="geo-icon-btn clickable" onClick={quit} title="Quitter la partie">
                <X size={18} />
              </button>
              <button
                className="geo-icon-btn clickable"
                onClick={() => setMuted((m) => !m)}
                title={muted ? "Réactiver les sons" : "Couper les sons"}
              >
                {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
              </button>
            </div>
          </header>

          {/* ---- HUD bas : la réponse ---- */}
          {!reveal && !mapStage && (
            <div className="geo-hud-bottom">
              {/* Volet social : n'apparaît que si au moins un ami est déjà
                  tombé sur ce lieu (round.friends non nul côté serveur). */}
              {round.friends && (
                <span className={`geo-friends ${round.friends.found > 0 ? "found" : "none"}`}>
                  <Users size={13} />
                  {round.friends.found > 0
                    ? `${round.friends.found} ${
                        round.friends.found > 1 ? "amis l'ont" : "ami l'a"
                      } trouvé`
                    : "aucun de tes amis ne l'a trouvé"}
                </span>
              )}

              {/* Les trois vies + la notification de vie perdue. */}
              <div className="geo-lives-row">
                <div className="geo-lives" aria-label={`${lives} vies restantes`}>
                  {Array.from({ length: LIVES }).map((_, i) => (
                    <Heart
                      key={i}
                      size={20}
                      className={i < lives ? "on" : "off"}
                      fill={i < lives ? "currentColor" : "none"}
                    />
                  ))}
                </div>
                {wrongFlash && (
                  <span className="geo-wrong" key={wrongFlash.at}>
                    Raté&nbsp;! Encore {wrongFlash.left}{" "}
                    {wrongFlash.left > 1 ? "essais" : "essai"}
                  </span>
                )}
              </div>

              {suggestions.length > 0 && panoReady && (
                <ul className="geo-suggest" ref={suggestRef}>
                  {suggestions.map((c, i) => (
                    <li key={c.id}>
                      <button
                        className={`geo-suggest-row clickable ${i === highlight ? "on" : ""}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          submitGuess(c);
                        }}
                        onMouseEnter={() => setHighlight(i)}
                      >
                        {c.cover ? (
                          <img src={c.cover} alt="" loading="lazy" draggable="false" />
                        ) : (
                          <span className="geo-suggest-ph">
                            <Gamepad2 size={13} />
                          </span>
                        )}
                        <span className="geo-suggest-name">{c.name}</span>
                        {i === highlight && <kbd>↵</kbd>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="geo-answer">
                <div className="geo-field">
                  <Search size={17} />
                  <input
                    ref={inputRef}
                    placeholder={panoReady ? "Quel jeu ?" : "Chargement du lieu…"}
                    value={input}
                    disabled={!panoReady}
                    onChange={(e) => {
                      setInput(e.target.value);
                      setHighlight(0);
                    }}
                    onKeyDown={onKeyDown}
                    autoComplete="off"
                    spellCheck="false"
                  />
                </div>
              </div>

              {/* Sous le champ : l'aveu, en toutes lettres. Une icône « passer »
                  laissait croire à une avance rapide sans conséquence — or
                  déclarer forfait coûte des points, autant que ce soit dit. */}
              <div className="geo-answer-row">
                <button
                  className="geo-dunno clickable"
                  onClick={() => submitGuess(null)}
                  disabled={!panoReady}
                >
                  <HelpCircle size={15} /> Je ne sais pas
                </button>
              </div>
            </div>
          )}

          {/* ---- Révélation ----
              Carte posée en bas, pas une modale plein écran : le panorama reste
              visible derrière, et c'est le moment où l'on comprend le détail
              qu'on avait sous les yeux sans le voir. */}
          {reveal && (
            <div className={`geo-reveal ${reveal.correct ? "good" : "bad"}`}>
              <i className="geo-rv-bar" aria-hidden="true" />
              <span className="geo-rv-badge">
                {reveal.correct ? <Check size={19} /> : <X size={19} />}
              </span>
              {reveal.round.cover && (
                <img className="geo-rv-cover" src={reveal.round.cover} alt="" draggable="false" />
              )}
              <div className="geo-rv-txt">
                <span className="geo-rv-verdict">
                  {reveal.correct ? "Trouvé" : "Raté"}
                  <b className={reveal.points >= 0 ? "up" : "down"}>
                    {reveal.points >= 0 ? `+${reveal.points}` : reveal.points}
                  </b>
                </span>
                <b className="geo-rv-name">{reveal.round.gameName}</b>
                {!reveal.correct && reveal.guessName && (
                  <em>
                    Ta réponse : <s>{reveal.guessName}</s>
                  </em>
                )}
                {!reveal.correct && !reveal.guessName && <em>Temps écoulé</em>}
              </div>
              <button className="geo-rv-next clickable" onClick={goNext}>
                {reveal.correct && round.map
                  ? "Situer sur la carte"
                  : idx + 1 < rounds.length
                    ? "Suivant"
                    : "Mon score"}
                <span>{nextIn}</span>
              </button>
            </div>
          )}

          {/* ---- Manche bonus : où sur la carte ? ----
              Posée par-dessus le panorama, qui reste visible derrière : on peut
              encore jeter un œil au décor pour se repérer. */}
          {mapStage && round.map && (
            <div className="geo-map-veil">
              <MapRound
                map={round.map}
                gameName={round.gameName}
                onDone={onMapDone}
                sfx={sfx}
              />
            </div>
          )}
        </section>
      )}

      {/* ---------- SCOREBOARD ---------- */}
      {phase === "done" && final && (
        <Scoreboard
          final={final}
          onReplay={() => {
            if (challengeId) navigate("/geo");
            setPhase("intro");
          }}
          token={token}
        />
      )}
    </div>
  );
}

// ============================================================
//  Tableau des scores + classement
// ============================================================
function Scoreboard({ final, onReplay, token }) {
  const [board, setBoard] = useState(null);
  const [viewer, setViewer] = useState(null); // lieu qu'on revisite en grand
  const pct = final.roundCount ? Math.round((final.correctCount / final.roundCount) * 100) : 0;
  const ch = final.challenge;

  useEffect(() => {
    let alive = true;
    apiFetch("/geo/leaderboard", { token })
      .then((d) => alive && setBoard(d.entries || []))
      .catch(() => alive && setBoard([]));
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <section className="geo-done">
      {/* En-tête simple, en ligne : le score à gauche, les chiffres au milieu,
          les actions à droite. Une seule barre, pas de médaille ni d'anneau. */}
      <div className="geo-done-hero">
        <div className="geo-done-score">
          <b>{final.score}</b>
          <span>points</span>
        </div>

        <div className="geo-done-facts">
          <span className="geo-done-fact">
            <b>
              {final.correctCount}/{final.roundCount}
            </b>{" "}
            trouvés
          </span>
          <span className="geo-done-dot" aria-hidden="true" />
          <span className="geo-done-fact">
            <b>{pct}%</b> réussite
          </span>
          {final.pointsEarned > 0 && (
            <Link to="/arcade" className="geo-done-earned clickable">
              <Coins size={14} /> +{final.pointsEarned}
            </Link>
          )}
          {ch && (
            <span className={`geo-done-vs ${ch.beaten ? "win" : "lose"}`}>
              <Swords size={13} />
              {ch.beaten ? `bat ${ch.username}` : `${ch.username} tient (${ch.score})`}
            </span>
          )}
        </div>

        <div className="geo-done-actions">
          <button className="geo-cta sm clickable" onClick={onReplay}>
            <RotateCcw size={16} /> Rejouer
          </button>
          <Link to="/arcade" className="geo-ghost clickable">
            <Home size={16} /> Arcade
          </Link>
        </div>
        {final._offline && (
          <p className="geo-offline">Score affiché en local (enregistrement indisponible).</p>
        )}
      </div>

      <div className="geo-done-cols">
        <div className="geo-panel">
          <h2 className="geo-panel-h">Le détail</h2>
          <ul className="geo-recap">
            {final.rounds.map((r, i) => (
              <li key={i} className={`geo-recap-row ${r.correct ? "good" : "bad"}`}>
                {/* La vignette rouvre le lieu en 360 : c'est là qu'on comprend
                    ce qu'on avait sous les yeux sans le voir. */}
                <button
                  className="geo-recap-art clickable"
                  onClick={() => r.image && setViewer(r)}
                  disabled={!r.image}
                  title={r.image ? `Revisiter ce lieu de ${r.gameName}` : undefined}
                >
                  {r.cover ? (
                    <img src={r.cover} alt="" loading="lazy" draggable="false" />
                  ) : (
                    <span className="geo-suggest-ph">
                      <Gamepad2 size={14} />
                    </span>
                  )}
                  <span className="geo-recap-verdict">
                    {r.correct ? <Check size={12} /> : <X size={12} />}
                  </span>
                  <span className="geo-recap-360">360°</span>
                </button>
                <span className="geo-recap-info">
                  <Link to={`/game/${r.gameId}`} className="geo-recap-name clickable">
                    {r.gameName}
                  </Link>
                  {!r.correct && r.guessedName && (
                    <span className="geo-recap-your">
                      Ta réponse : <s>{r.guessedName}</s>
                    </span>
                  )}
                  <span className="geo-recap-meta">
                    {r.correct && r.timeMs != null && (
                      <span>{(r.timeMs / 1000).toFixed(1).replace(".", ",")} s</span>
                    )}
                    {r.map?.guess && (
                      <span className="geo-tag map" title="Manche carte">
                        <MapPin size={10} /> +{r.map.points}
                      </span>
                    )}
                    {!r.owned && <span className="geo-tag">Jamais joué</span>}
                  </span>
                </span>
                {/* Le total de la manche, bonus carte compris : c'est ce que le
                    joueur a réellement encaissé. */}
                <span
                  className={`geo-recap-pts ${r.points + (r.map?.points || 0) >= 0 ? "up" : "down"}`}
                >
                  {r.points + (r.map?.points || 0) >= 0 ? "+" : ""}
                  {r.points + (r.map?.points || 0)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="geo-panel">
          <h2 className="geo-panel-h">
            <Crown size={15} /> Classement
          </h2>
          {board === null ? (
            <div className="geo-panel-wait">
              <Loader2 size={20} className="spin" />
            </div>
          ) : board.length === 0 ? (
            <p className="geo-panel-empty">
              Sois le premier à marquer&nbsp;! Suis des amis pour les défier.
            </p>
          ) : (
            <ol className="geo-board">
              {board.map((e, i) => (
                <li key={e.geoGameId} className={`geo-board-row ${e.isMe ? "me" : ""}`}>
                  <span className={`geo-rank r${i + 1}`}>{i + 1}</span>
                  <Link to={`/u/${e.user.username}`} className="geo-board-user clickable">
                    {e.user.avatar ? (
                      <img src={e.user.avatar} alt="" loading="lazy" draggable="false" />
                    ) : (
                      <span className="geo-board-av">{e.user.username[0].toUpperCase()}</span>
                    )}
                    <span>{e.user.username}</span>
                  </Link>
                  {!e.isMe && (
                    <Link
                      to={`/geo?challenge=${e.geoGameId}`}
                      className="geo-board-fight clickable"
                      title={`Défier ${e.user.username}`}
                    >
                      <Swords size={13} />
                    </Link>
                  )}
                  <span
                    className="geo-board-score"
                    title={
                      e.games != null
                        ? `Total cumulé · ${e.games} partie${e.games > 1 ? "s" : ""}` +
                          (e.bestScore != null ? ` · record ${e.bestScore}` : "")
                        : undefined
                    }
                  >
                    {e.score}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {viewer && <PanoRevisit round={viewer} onClose={() => setViewer(null)} />}
    </section>
  );
}

// ---------- Revisiter un lieu depuis le récap ----------
function PanoRevisit({ round, onClose }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="geo-revisit"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="geo-revisit-box">
        <div className="geo-revisit-head">
          {round.cover && <img src={round.cover} alt="" draggable="false" />}
          <span>
            <b>{round.gameName}</b>
            <em>Difficulté {round.difficulty} / 5</em>
          </span>
          <button className="geo-icon-btn clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <div className="geo-revisit-stage">
          <Suspense
            fallback={
              <div className="pano-load">
                <Loader2 size={30} className="spin" />
              </div>
            }
          >
            <PanoViewer src={round.image} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
