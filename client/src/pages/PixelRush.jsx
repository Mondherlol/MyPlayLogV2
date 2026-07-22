import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Grid2x2,
  Play,
  Pause,
  Search,
  Trophy,
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
  SkipForward,
  Lock,
  Calendar,
  Building2,
  Tag,
  Timer,
  Home,
  Coins,
  Maximize2,
  Minimize2,
  Scan,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import PixelCanvas from "../components/PixelCanvas";
import {
  dedupeCandidates,
  estimatePoints,
  sameGame,
  searchCandidates,
} from "../lib/guessGame";
import { useGameSfx } from "../lib/useGameSfx";

// ============================================================
//  Pixel Rush — devine le jeu derrière des screenshots pixelisés
// ============================================================
// Toutes les captures de la manche sont posées d'emblée en grille (2 par
// ligne) : rien à faire défiler, on embrasse l'ensemble d'un coup d'œil et on
// clique pour zoomer sur l'une d'elles. Pendant la manche (`durationSec`) :
//   • la définition remonte un peu (PIX_START → PIX_END blocs de large), sans
//     jamais devenir lisible : le rendu net est réservé à la révélation ;
//   • chaque seconde écoulée coûte des points (cf. lib/guessGame).

// Largeur de l'image en « blocs ». On reste volontairement TRÈS grossier : à
// 24 blocs on lit des masses de couleur et une ambiance, jamais une scène.
const PIX_START = 9;
const PIX_END = 24;

// Décompte avant le passage automatique à la manche suivante après la
// révélation (la barre CSS .bt-reveal-progress dure aussi 5 s — garder synchro).
const AUTO_NEXT_MS = 5000;

// Fractions de la manche auxquelles les indices se dévoilent.
const HINT_FRACS = [0.35, 0.55, 0.75];

// Une capture de la révélation : elle arrive dans son état pixelisé de fin de
// manche, puis se « développe » comme une photo — les blocs fondent jusqu'à
// l'image nette. Chaque capture démarre un peu après la précédente (`delay`),
// ce qui donne la cascade.
const REVEAL_ANIM_MS = 700;

function RevealShot({ src, from, delay = 0, label }) {
  const [blocks, setBlocks] = useState(from);
  const [sharp, setSharp] = useState(false);

  useEffect(() => {
    setBlocks(from);
    setSharp(false);
    let raf = 0;
    let start = 0;
    const step = (t) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / REVEAL_ANIM_MS);
      // Courbe douce, puis on passe au rendu net : au-delà de ~180 blocs, un
      // cran de plus ne se voit plus, autant afficher la vraie image.
      const eased = p * p;
      const v = from + (200 - from) * eased;
      // On ne repeint que si le palier bouge vraiment : sans ça, 4 canvas se
      // redessineraient 60 fois par seconde pour un écart invisible.
      setBlocks((prev) => (Math.abs(v - prev) >= 2 ? v : prev));
      if (p < 1) raf = requestAnimationFrame(step);
      else setSharp(true);
    };
    const timer = setTimeout(() => {
      raf = requestAnimationFrame(step);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [src, from, delay]);

  return (
    <span className="px-reveal-tile" style={{ animationDelay: `${delay}ms` }}>
      <PixelCanvas src={src} blocks={blocks} reveal={sharp} label={label} />
    </span>
  );
}

// ============================================================
//  La carte de l'écran d'accueil
// ============================================================
// Elle se retourne en boucle et joue une manche en miniature : d'un côté la
// jaquette d'un des jeux du joueur NOYÉE SOUS LES PIXELS avec le « ? », de
// l'autre la même jaquette nette — la réponse. On comprend la règle sans
// lire une ligne. HERO_FLIP_MS est calé sur la durée de l'animation CSS
// px-hero-flip, à garder synchro.
const HERO_FLIP_MS = 7000;
// Instant du cycle où l'on change de jeu : 95 %, c'est-à-dire pile quand la
// carte est SUR LA TRANCHE pendant son second retournement. Changer l'image
// quand une face nous regarde la ferait sauter sous les yeux.
const HERO_SWAP_AT = 0.95;
const HERO_CV_W = 300; // 3/4 : format jaquette, pas le 16/9 des captures
const HERO_CV_H = 400;

function HeroCard({ token }) {
  const [games, setGames] = useState([]);
  const [i, setI] = useState(0);

  useEffect(() => {
    let alive = true;
    apiFetch("/pixel/covers", { token })
      .then((d) => alive && setGames(d.games || []))
      .catch(() => {
        /* décoratif : on garde l'icône de repli */
      });
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (games.length < 2) return;
    const next = () => setI((n) => (n + 1) % games.length);
    let iv = 0;
    // Décalage initial pour caler les changements sur la tranche de la carte,
    // puis un tour complet entre chaque.
    const t = setTimeout(() => {
      next();
      iv = setInterval(next, HERO_FLIP_MS);
    }, HERO_FLIP_MS * HERO_SWAP_AT);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [games.length]);

  const game = games[i] || null;

  return (
    <div className="px-hero" aria-hidden="true">
      <span className="px-hero-glow" />
      <span className="px-hero-card">
        {/* La question : la jaquette noyée sous les pixels, et le « ? ». */}
        <span className="px-hero-face back">
          {game ? (
            <PixelCanvas
              src={game.cover}
              blocks={13}
              reveal={false}
              label=""
              w={HERO_CV_W}
              h={HERO_CV_H}
            />
          ) : (
            <span className="px-hero-grid" />
          )}
          <b>?</b>
        </span>
        {/* La réponse : la même jaquette, nette. */}
        <span className="px-hero-face front">
          {game ? (
            <img src={game.cover} alt="" draggable="false" />
          ) : (
            <Scan size={44} className="px-hero-ic" />
          )}
        </span>
      </span>
    </div>
  );
}

export default function PixelRush() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
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
  const [zoom, setZoom] = useState(null); // index du cliché agrandi (null = grille)
  const [reveal, setReveal] = useState(null); // { correct, points, round, guessName, shot }
  const [nextIn, setNextIn] = useState(5);
  const [paused, setPaused] = useState(false);
  const [final, setFinal] = useState(null);

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
  const pausedRef = useRef(false);
  const pauseStartRef = useRef(0);
  const prevUnlockRef = useRef(0);
  const revealAtRef = useRef(0);
  // Miroir du zoom : le timer de manche est armé une seule fois, sa closure ne
  // verrait sinon que l'état initial.
  const zoomRef = useRef(null);
  // Définition atteinte à l'instant de la réponse : la révélation repart de là.
  const blocksRef = useRef(PIX_START);

  useEffect(() => {
    sfx.setMuted(muted);
  }, [muted, sfx]);

  // Mode immersif : sur mobile, masque la bottom bar le temps de la partie
  // (sinon elle chevauche le champ quand le clavier virtuel s'ouvre).
  useEffect(() => {
    document.body.classList.add("bt-immersive");
    return () => document.body.classList.remove("bt-immersive");
  }, []);

  // Retour = on repart d'où l'on vient (l'arcade, le fil, un profil…).
  // `key === "default"` signale une page ouverte directement (lien partagé,
  // favori, rechargement) : là il n'y a rien derrière, on vise l'arcade.
  const goBack = useCallback(() => {
    if (location.key !== "default") navigate(-1);
    else navigate("/arcade");
  }, [location.key, navigate]);

  const round = rounds[idx];
  const durationMs = round ? round.durationSec * 1000 : 0;
  const progress = durationMs ? Math.min(1, elapsedMs / durationMs) : 0;
  const timeLeftMs = Math.max(0, durationMs - elapsedMs);
  const secondsLeft = Math.ceil(timeLeftMs / 1000);

  const shots = round?.shots || [];
  // Définition courante — jamais lisible, même à la dernière seconde. Arrondie
  // ici : les canvas ne se redessinent qu'au changement de palier (une quinzaine
  // de fois par manche) et pas à chaque tic de 100 ms.
  const blocks = Math.round(PIX_START + (PIX_END - PIX_START) * progress);
  blocksRef.current = blocks;

  // --- Démarrage d'une partie ---
  async function startGame() {
    sfx.resume(); // crée/réveille l'AudioContext dans le geste utilisateur
    setError("");
    setPhase("loading");
    setFinal(null);
    setReveal(null);
    setIdx(0);
    setScore(0);
    guessesRef.current = [];
    try {
      const d = challengeId
        ? await apiFetch(`/pixel/challenge/${challengeId}`, { token })
        : await apiFetch("/pixel/start", {
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
      setError(e.message || "Impossible de lancer la partie.");
      setPhase("error");
    }
  }

  // --- Verrouille la réponse de la manche courante (guess ou temps écoulé) ---
  const lockGuess = useCallback(
    (cand) => {
      if (lockedRef.current) return;
      lockedRef.current = true;
      const r = rounds[idx];
      if (!r) return;
      const timeMs = cand ? Date.now() - roundStartRef.current : null;
      const guessId = cand ? cand.id : null;
      const guessName = cand ? cand.name : "";
      const points = estimatePoints(r, guessId, guessName, timeMs, r.durationSec);
      const correct = sameGame(r, guessId, guessName);
      guessesRef.current[idx] = {
        id: r.id,
        gameId: guessId,
        name: guessName,
        timeMs,
      };
      setScore((s) => s + points);
      sfx.play(correct ? "correct" : "wrong");
      revealAtRef.current = Date.now();
      setReveal({
        correct,
        points,
        round: r,
        guessName: cand ? cand.name : null,
        // On révèle en net le cliché zoomé, sinon le premier de la grille.
        // Toutes les captures de la manche se dépixelisent dans la modale.
        shots: r.shots || [],
        blocks: blocksRef.current,
      });
    },
    [rounds, idx, sfx]
  );

  // --- Timer d'une manche ---
  useEffect(() => {
    if (phase !== "playing") return;
    const r = rounds[idx];
    if (!r) return;
    setReveal(null);
    setInput("");
    setHighlight(0);
    zoomRef.current = null;
    setZoom(null);
    setElapsedMs(0);
    lockedRef.current = false;
    lastTickRef.current = -1;
    pausedRef.current = false;
    setPaused(false);
    prevUnlockRef.current = 0;
    roundStartRef.current = Date.now();
    sfx.play("start");
    setTimeout(() => inputRef.current?.focus(), 60);

    const total = r.durationSec * 1000;
    const iv = setInterval(() => {
      if (lockedRef.current) {
        clearInterval(iv);
        return;
      }
      if (pausedRef.current) return; // chrono gelé pendant la pause
      const el = Date.now() - roundStartRef.current;
      setElapsedMs(Math.min(el, total));
      const left = Math.max(0, total - el);
      // Manche courte : on n'égrène que les 3 dernières secondes (sur 5, le
      // tic-tac couvrirait un tiers de la manche).
      if (left <= 3000 && left > 0) {
        const sec = Math.ceil(left / 1000);
        if (sec !== lastTickRef.current) {
          lastTickRef.current = sec;
          sfx.play("tick-hot");
        }
      }
      if (left <= 0) {
        clearInterval(iv);
        if (!lockedRef.current) lockGuess(null);
      }
    }, 100);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx]);

  // --- Pause / reprise : fige le chrono ---
  const togglePause = useCallback(() => {
    if (lockedRef.current) return;
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    if (next) pauseStartRef.current = Date.now();
    else {
      roundStartRef.current += Date.now() - pauseStartRef.current;
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, []);

  // --- Envoi final ---
  const finishGame = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setPhase("loading");
    try {
      const res = await apiFetch("/pixel/finish", {
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
        return {
          gameId: r.gameId,
          gameName: r.gameName,
          cover: r.cover,
          shots: r.shots || [],
          owned: r.owned,
          correct,
          guessedName: g?.name || "",
          points: estimatePoints(
            r,
            g?.gameId ?? null,
            g?.name || "",
            g?.timeMs ?? null,
            r.durationSec
          ),
          timeMs: g?.timeMs ?? null,
        };
      });
      const total = Math.max(0, localRounds.reduce((a, r) => a + r.points, 0));
      setFinal({
        pixelGameId: null,
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
  const goNext = useCallback(() => {
    setReveal(null);
    if (idx + 1 < rounds.length) setIdx((i) => i + 1);
    else finishGame();
  }, [idx, rounds.length, finishGame]);
  advanceRef.current = goNext;

  // Décompte de 5 s après la révélation, puis auto-avance.
  useEffect(() => {
    if (!reveal) return;
    let left = AUTO_NEXT_MS;
    let last = Date.now();
    setNextIn(Math.ceil(AUTO_NEXT_MS / 1000));
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
  }, [reveal]);

  // --- Zoom sur un cliché (re-clic = retour à la grille) ---
  const toggleZoom = useCallback((i) => {
    if (lockedRef.current || pausedRef.current) return;
    setZoom((z) => {
      const next = z === i ? null : i;
      zoomRef.current = next;
      return next;
    });
    sfx.play("shot");
  }, [sfx]);

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
      if (k === "Escape") {
        e.preventDefault();
        togglePause();
        return;
      }
      if (pausedRef.current && (k === "Enter" || k === " ")) {
        e.preventDefault();
        togglePause();
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

  // La liste de suggestions est en absolu autour du champ. L'écran de jeu est
  // haut : sous le champ, il ne reste souvent pas la place: on bascule alors
  // la liste AU-DESSUS, et on la borne à l'espace réellement disponible pour
  // qu'elle scrolle dedans au lieu de déborder de la page.
  useEffect(() => {
    const el = suggestRef.current;
    if (!el) return;
    const place = () => {
      const field = el.parentElement?.querySelector(".bt-search");
      if (!field) return;
      const r = field.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 16;
      const above = r.top - 16;
      const up = below < 240 && above > below;
      el.classList.toggle("up", up);
      el.style.maxHeight = `${Math.max(140, Math.min(320, up ? above : below))}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [suggestions]);

  useEffect(() => {
    suggestRef.current?.children[highlight]?.scrollIntoView({ block: "nearest" });
  }, [highlight, suggestions]);

  function onKeyDown(e) {
    if (reveal || paused) return;
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
      if (pick) lockGuess(pick);
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


  // --- Indices progressifs : année → plateformes → studio (ou genre) ---
  const hintDefs = useMemo(() => {
    const h = round?.hints;
    if (!h) return [];
    const pool = [];
    if (h.year) pool.push({ key: "year", Icon: Calendar, label: "Année", text: String(h.year) });
    if (h.platforms?.length)
      pool.push({
        key: "plat",
        Icon: Gamepad2,
        label: "Plateformes",
        text: h.platforms.slice(0, 3).join(" · "),
      });
    if (h.studio) pool.push({ key: "studio", Icon: Building2, label: "Studio", text: h.studio });
    else if (h.genre) pool.push({ key: "genre", Icon: Tag, label: "Genre", text: h.genre });
    const durMs = round.durationSec * 1000;
    return pool.slice(0, 3).map((p, i) => ({ ...p, atMs: HINT_FRACS[i] * durMs }));
  }, [round]);
  const unlockedCount = hintDefs.filter((h) => elapsedMs >= h.atMs).length;

  useEffect(() => {
    if (phase !== "playing" || reveal) return;
    if (unlockedCount > prevUnlockRef.current) sfx.play("hint");
    prevUnlockRef.current = unlockedCount;
  }, [unlockedCount, phase, reveal, sfx]);

  // ============================================================
  //  Rendu — la structure vient du blind test (.bt-topbar, .bt-search,
  //  .bt-done…) mais PAS le décor : .px-page redéfinit toute la palette
  //  et repose le plateau de quiz (projecteurs, public, cartes).
  // ============================================================
  return (
    <div className="bt-page px-page">
      {/* Le plateau : deux projecteurs croisés, la nappe de lumière au sol
          et le public en ombres chinoises. Purement décoratif. */}
      <div className="px-scene" aria-hidden="true">
        <span className="px-beam l" />
        <span className="px-beam r" />
        <span className="px-floor" />
        <span className="px-crowd" />
        <span className="px-sparks" />
      </div>

      <header className="bt-topbar">
        <button className="bt-back clickable" onClick={goBack}>
          <ArrowLeft size={17} /> <span>Retour</span>
        </button>
        <div className="bt-brand">
          <Grid2x2 size={17} /> Pixel Rush
        </div>
        <button
          className="bt-vol-btn clickable"
          onClick={() => setMuted((m) => !m)}
          title={muted ? "Réactiver les sons" : "Couper les sons"}
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
      </header>

      <div className="bt-body">
        {/* ---------- INTRO ---------- */}
        {phase === "intro" && (
          <div className="bt-intro">
            <HeroCard token={token} />
            <span className="bt-kicker">
              {challengeId ? "Défi entre joueurs" : "Quiz visuel"}
            </span>
            <h1 className="bt-title">{challengeId ? "Relève le défi" : "Pixel Rush"}</h1>
            <p className="bt-sub">
              {challengeId
                ? "Les mêmes captures qu'un autre joueur, à toi de faire mieux."
                : "Devine le jeu derrière les pixels. Plus tu réponds vite, plus tu marques."}
            </p>

            {!challengeId && (
              <div className="bt-rounds-pick">
                <span className="bt-rounds-label">Nombre de manches</span>
                <div className="bt-rounds-opts">
                  {[5, 10, 15].map((n) => (
                    <button
                      key={n}
                      className={`bt-round-opt clickable ${roundCount === n ? "on" : ""}`}
                      onClick={() => setRoundCount(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button className="bt-start clickable" onClick={startGame}>
              {challengeId ? <Swords size={20} /> : <Play size={20} />}
              {challengeId ? "Relever le défi" : "Lancer Pixel Rush"}
            </button>
            <span className="bt-kbd-hint">
              ou appuie sur <kbd>Entrée</kbd>
            </span>
          </div>
        )}

        {/* ---------- LOADING ---------- */}
        {phase === "loading" && (
          <div className="bt-loading">
            <Loader2 size={34} className="spin" />
            <p>
              {final || finishingRef.current
                ? "On calcule ton score…"
                : "On pixelise tes captures…"}
            </p>
          </div>
        )}

        {/* ---------- ERROR ---------- */}
        {phase === "error" && (
          <div className="bt-loading bt-err">
            <p>{error}</p>
            <div className="bt-err-actions">
              <button className="bt-start sm clickable" onClick={() => setPhase("intro")}>
                <RotateCcw size={16} /> Réessayer
              </button>
              <Link to="/app" className="bt-ghost clickable">
                Retour à l'accueil
              </Link>
            </div>
          </div>
        )}

        {/* ---------- PLAYING ---------- */}
        {phase === "playing" && round && (
          <div className="bt-play px-play">
            <div className="bt-pips" aria-hidden="true">
              {rounds.map((_, i) => (
                <i key={i} className={i < idx ? "done" : i === idx ? "cur" : ""} />
              ))}
            </div>
            <div className="bt-play-head">
              <span className="bt-round-count">
                Manche <b>{idx + 1}</b>
                <em>/ {rounds.length}</em>
              </span>
              <span className="bt-live-score">
                <Trophy size={14} /> {score} pts
              </span>
            </div>

            {/* ---- L'écran : toutes les captures, 2 par ligne ---- */}
            <div className={`px-stage ${secondsLeft <= 5 ? "hot" : ""} ${paused ? "paused" : ""}`}>
              <div
                className={`px-grid n-${Math.min(shots.length, 4)} ${
                  zoom != null ? "zoomed" : ""
                }`}
              >
                {shots.map((s, i) => (
                  <button
                    key={s}
                    className={`px-tile clickable ${zoom === i ? "on" : ""} ${
                      zoom != null && zoom !== i ? "off" : ""
                    }`}
                    onClick={() => toggleZoom(i)}
                    title={zoom === i ? "Revenir à la grille" : "Agrandir cette capture"}
                    aria-label={
                      zoom === i ? "Revenir à la grille" : `Agrandir la capture ${i + 1}`
                    }
                  >
                    <PixelCanvas
                      src={s}
                      blocks={blocks}
                      reveal={false}
                      label={`Capture pixelisée ${i + 1} sur ${shots.length}`}
                    />
                    <span className="px-tile-n">{i + 1}</span>
                    <span className="px-tile-zoom" aria-hidden="true">
                      {zoom === i ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                    </span>
                  </button>
                ))}
              </div>

              {/* Chrono + définition, posés sur l'écran */}
              <span className={`px-timer ${secondsLeft <= 5 ? "hot" : ""}`}>
                <Timer size={13} /> {secondsLeft}s
              </span>
              <span className="px-def" title="Définition actuelle des captures">
                {blocks}px
              </span>

              {/* Barre de progression = temps écoulé */}
              <i className="px-progress" style={{ transform: `scaleX(${progress})` }} />

              {paused && (
                <button className="px-resume clickable" onClick={togglePause}>
                  <Play size={34} />
                  <span>Reprendre</span>
                </button>
              )}
            </div>

            {/* ---- Indices progressifs ---- */}
            {hintDefs.length > 0 && !reveal && (
              <div className="bt-hints">
                {hintDefs.map((h) => {
                  const open = elapsedMs >= h.atMs;
                  const inSec = Math.max(0, Math.ceil((h.atMs - elapsedMs) / 1000));
                  return (
                    <span key={h.key} className={`bt-hint ${open ? "open" : ""}`}>
                      {open ? <h.Icon size={13} /> : <Lock size={12} />}
                      <span>{open ? h.text : h.label}</span>
                      {!open && <i className="bt-hint-t">{inSec}s</i>}
                    </span>
                  );
                })}
              </div>
            )}

            {/* ---- Recherche / réponse ---- */}
            <div className={`bt-guess ${reveal || paused ? "locked" : ""}`}>
              <div className="bt-search">
                <Search size={18} className="bt-search-ic" />
                <input
                  ref={inputRef}
                  className="bt-search-input"
                  placeholder="Tape le nom du jeu… Entrée pour valider"
                  value={input}
                  disabled={!!reveal || paused}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setHighlight(0);
                  }}
                  onKeyDown={onKeyDown}
                  onFocus={(e) => {
                    if (window.innerWidth <= 760) {
                      const el = e.target;
                      setTimeout(
                        () => el.scrollIntoView({ block: "center", behavior: "smooth" }),
                        250
                      );
                    }
                  }}
                  autoComplete="off"
                  spellCheck="false"
                />
              </div>
              {!reveal && !paused && suggestions.length > 0 && (
                <ul className="bt-suggest" ref={suggestRef}>
                  {suggestions.map((c, i) => (
                    <li key={c.id}>
                      <button
                        className={`bt-suggest-row clickable ${i === highlight ? "on" : ""}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          lockGuess(c);
                        }}
                        onMouseEnter={() => setHighlight(i)}
                      >
                        {c.cover ? (
                          <img src={c.cover} alt="" loading="lazy" draggable="false" />
                        ) : (
                          <span className="bt-suggest-ph">
                            <Gamepad2 size={14} />
                          </span>
                        )}
                        <span className="bt-suggest-name">{c.name}</span>
                        {i === highlight && <kbd className="bt-kbd">↵</kbd>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!reveal && (
              <div className="bt-actions">
                <button className="bt-chip clickable" onClick={togglePause}>
                  {paused ? <Play size={15} /> : <Pause size={15} />}
                  {paused ? "Reprendre" : "Pause"}
                </button>
                <button
                  className="bt-chip clickable"
                  onClick={() => lockGuess(null)}
                  disabled={paused}
                >
                  <SkipForward size={15} /> Je passe
                </button>
              </div>
            )}

            {/* ---- Révélation : l'image enfin nette ---- */}
            {reveal && (
              <div className="bt-overlay" role="dialog" aria-modal="true">
                <div className={`px-reveal ${reveal.correct ? "good" : "bad"}`}>
                  <i className="bt-reveal-progress" aria-hidden="true" />
                  <div
                    className={`px-reveal-shots n-${Math.min(reveal.shots.length, 4)}`}
                  >
                    {reveal.shots.map((s, i) => (
                      <RevealShot
                        key={s}
                        src={s}
                        from={reveal.blocks}
                        delay={i * 130}
                        label={`Capture de ${reveal.round.gameName}`}
                      />
                    ))}
                    <span className="px-reveal-badge">
                      {reveal.correct ? <Check size={20} /> : <X size={20} />}
                    </span>
                  </div>
                  <span className="bt-reveal-verdict">
                    {reveal.correct ? "Trouvé !" : "Raté !"}
                    <b className={`bt-reveal-pts ${reveal.points >= 0 ? "up" : "down"}`}>
                      {reveal.points >= 0 ? `+${reveal.points}` : reveal.points}
                    </b>
                  </span>
                  <div className="px-reveal-game">
                    {reveal.round.cover && (
                      <img src={reveal.round.cover} alt="" draggable="false" />
                    )}
                    <span>
                      {!reveal.correct && <em>La réponse était</em>}
                      <b>{reveal.round.gameName}</b>
                      {!reveal.correct && reveal.guessName && (
                        <i>
                          Ta réponse : <s>{reveal.guessName}</s>
                        </i>
                      )}
                      {!reveal.correct && !reveal.guessName && <i>Temps écoulé</i>}
                    </span>
                  </div>
                  <button className="bt-next clickable" onClick={goNext}>
                    {idx + 1 < rounds.length ? "Manche suivante" : "Voir mon score"}
                    <span className="bt-next-count">{nextIn}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------- SCOREBOARD ---------- */}
        {phase === "done" && final && (
          <Scoreboard
            final={final}
            challengeId={challengeId}
            onReplay={() => {
              if (challengeId) navigate("/pixel");
              setPhase("intro");
            }}
            token={token}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================
//  Tableau des scores + classement
// ============================================================
function Scoreboard({ final, challengeId, onReplay, token }) {
  const [board, setBoard] = useState(null);
  const [viewer, setViewer] = useState(null); // manche dont on revoit les captures
  const pct = final.roundCount ? Math.round((final.correctCount / final.roundCount) * 100) : 0;
  const ch = final.challenge;

  useEffect(() => {
    let alive = true;
    apiFetch("/pixel/leaderboard", { token })
      .then((d) => alive && setBoard(d.entries || []))
      .catch(() => alive && setBoard([]));
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <div className="bt-done">
      <div className="bt-done-hero">
        <div className="bt-done-badge">
          <Trophy size={34} />
        </div>
        <h1 className="bt-done-score">{final.score}</h1>
        <span className="bt-done-score-label">points</span>
        <p className="bt-done-sub">
          {final.correctCount} / {final.roundCount} trouvés · {pct}% de réussite
        </p>

        {final.pointsEarned > 0 && (
          <Link to="/app" className="bt-earned clickable">
            <Coins size={15} />
            <span>
              <b>+{final.pointsEarned}</b> points gagnés
            </span>
            <em>Ouvre une caisse depuis l'accueil →</em>
          </Link>
        )}

        {ch && (
          <div className={`bt-versus ${ch.beaten ? "win" : "lose"}`}>
            <Swords size={16} />
            {ch.beaten ? (
              <span>
                Battu&nbsp;! Tu dépasses <b>{ch.username}</b> ({ch.score} pts)
              </span>
            ) : (
              <span>
                <b>{ch.username}</b> tient bon avec {ch.score} pts — retente ta chance&nbsp;!
              </span>
            )}
          </div>
        )}

        <div className="bt-done-actions">
          <button className="bt-start sm clickable" onClick={onReplay}>
            <RotateCcw size={16} /> Rejouer
          </button>
          <Link to="/app" className="bt-ghost clickable">
            <Home size={16} /> Accueil
          </Link>
        </div>
        {final._offline && (
          <p className="bt-offline-note">
            Score affiché en local (enregistrement indisponible).
          </p>
        )}
      </div>

      <div className="bt-done-cols">
        {/* Détail des manches */}
        <div className="bt-recap">
          <h2 className="bt-recap-title">Le détail</h2>
          <ul className="bt-recap-list">
            {final.rounds.map((r, i) => (
              <li key={i} className={`bt-recap-row ${r.correct ? "good" : "bad"}`}>
                {/* La vignette rouvre TOUTES les captures de la manche en grand */}
                <button
                  className="bt-recap-cover px-recap-shot clickable"
                  onClick={() => r.shots?.length && setViewer(r)}
                  disabled={!r.shots?.length}
                  title={r.shots?.length ? `Revoir les captures de ${r.gameName}` : undefined}
                >
                  {r.shots?.[0] || r.cover ? (
                    <img
                      src={r.shots?.[0] || r.cover}
                      alt=""
                      loading="lazy"
                      draggable="false"
                    />
                  ) : (
                    <span className="bt-suggest-ph">
                      <Gamepad2 size={14} />
                    </span>
                  )}
                  <span className="bt-recap-verdict">
                    {r.correct ? <Check size={13} /> : <X size={13} />}
                  </span>
                  {r.shots?.length > 1 && (
                    <span className="px-recap-count">{r.shots.length}</span>
                  )}
                </button>
                <span className="bt-recap-info">
                  <Link to={`/game/${r.gameId}`} className="bt-recap-game clickable">
                    {r.gameName}
                  </Link>
                  {!r.correct && r.guessedName && (
                    <span className="bt-recap-your">
                      Ta réponse : <s>{r.guessedName}</s>
                    </span>
                  )}
                  <span className="bt-recap-meta">
                    {r.correct && r.timeMs != null && (
                      <span className="bt-recap-time">
                        <Timer size={11} /> trouvé en{" "}
                        {(r.timeMs / 1000).toFixed(1).replace(".", ",")} s
                      </span>
                    )}
                    {!r.owned && <span className="bt-recap-tag">Jamais joué</span>}
                  </span>
                </span>
                <span className={`bt-recap-pts ${r.points >= 0 ? "up" : "down"}`}>
                  {r.points >= 0 ? `+${r.points}` : r.points}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Classement */}
        <div className="bt-board">
          <h2 className="bt-recap-title">
            <Crown size={16} /> Classement
          </h2>
          {board === null ? (
            <div className="bt-board-loading">
              <Loader2 size={20} className="spin" />
            </div>
          ) : board.length === 0 ? (
            <p className="bt-board-empty">
              Sois le premier à marquer&nbsp;! Suis des amis pour les défier.
            </p>
          ) : (
            <ol className="bt-board-list">
              {board.map((e, i) => (
                <li key={e.gameId} className={`bt-board-row ${e.isMe ? "me" : ""}`}>
                  <span className={`bt-board-rank r${i + 1}`}>{i + 1}</span>
                  <Link to={`/u/${e.user.username}`} className="bt-board-user clickable">
                    {e.user.avatar ? (
                      <img src={e.user.avatar} alt="" loading="lazy" draggable="false" />
                    ) : (
                      <span className="bt-board-av-fb">
                        {e.user.username[0].toUpperCase()}
                      </span>
                    )}
                    <span className="bt-board-name">{e.user.username}</span>
                  </Link>
                  {!e.isMe && (
                    <Link
                      to={`/pixel?challenge=${e.gameId}`}
                      className="bt-board-challenge clickable"
                      title={`Défier ${e.user.username}`}
                    >
                      <Swords size={14} />
                    </Link>
                  )}
                  <span
                    className="bt-board-score"
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

      {viewer && <ShotViewer round={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

// Visionneuse des captures d'une manche, ouverte depuis le récap : l'image en
// grand, les autres en pellicule dessous (flèches et Échap au clavier).
function ShotViewer({ round, onClose }) {
  const [i, setI] = useState(0);
  const shots = round.shots || [];

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
      else if (e.key === "ArrowRight") setI((n) => Math.min(shots.length - 1, n + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, shots.length]);

  return createPortal(
    <div className="px-viewer" onClick={onClose}>
      <button className="px-viewer-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>
      <figure className="px-viewer-body" onClick={(e) => e.stopPropagation()}>
        <img className="px-viewer-img" src={shots[i]} alt="" draggable="false" />
        <figcaption className="px-viewer-bar">
          <Link to={`/game/${round.gameId}`} className="px-viewer-game clickable">
            {round.cover && <img src={round.cover} alt="" draggable="false" />}
            <span>{round.gameName}</span>
          </Link>
          {shots.length > 1 && (
            <span className="px-viewer-thumbs">
              {shots.map((s, n) => (
                <button
                  key={s}
                  className={`px-viewer-thumb clickable ${n === i ? "on" : ""}`}
                  onClick={() => setI(n)}
                  aria-label={`Capture ${n + 1}`}
                >
                  <img src={s} alt="" loading="lazy" draggable="false" />
                </button>
              ))}
            </span>
          )}
        </figcaption>
      </figure>
    </div>,
    document.body
  );
}
