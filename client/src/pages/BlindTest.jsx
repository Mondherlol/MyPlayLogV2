import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Music2,
  Play,
  Pause,
  Search,
  Trophy,
  ArrowLeft,
  RotateCcw,
  Share2,
  Check,
  X,
  Gamepad2,
  Crown,
  Loader2,
  Swords,
  Volume1,
  Volume2,
  VolumeX,
  SkipForward,
  Lock,
  Calendar,
  Building2,
  Tag,
  Timer,
  Home,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { usePlayer } from "../context/PlayerContext";
import { apiFetch } from "../lib/api";
import { loadYT } from "../lib/youtube";

// ============================================================
//  Blind test musical — devine le jeu à partir d'un extrait d'OST
// ============================================================

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Version « collée » (sans espaces) : rend la recherche tolérante à la
// ponctuation et aux espaces mal placés — « assassins creed » et
// « assassin's creed » donnent tous deux « assassinscreed ».
const squish = (s) => norm(s).replace(/\s+/g, "");

// Suffixes d'édition / portage / remaster à ignorer : deviner « BOTW » quand
// la réponse est « BOTW - Switch 2 Edition », c'est le même jeu → bonne
// réponse. Miroir EXACT de canonName()/sameGame() côté serveur.
const EDITION_RE =
  /\b(nintendo switch 2 edition|nintendo switch edition|definitive edition|deluxe edition|complete edition|game of the year edition|goty edition|goty|enhanced edition|special edition|anniversary edition|legacy edition|collector s edition|ultimate edition|royal edition|directors cut|director s cut|remastered|remaster|remake|intergrade|redux|vr edition|hd)\b/g;
const canonName = (s) => norm(s).replace(EDITION_RE, " ").replace(/\s+/g, " ").trim();

function sameGame(r, guessGameId, guessName) {
  if (guessGameId != null && Number(guessGameId) === Number(r.gameId)) return true;
  const a = canonName(guessName);
  return !!a && a === canonName(r.gameName);
}

// Acronymes d'un titre pour la recherche (« gta » → Grand Theft Auto,
// « botw » → Breath of the Wild, « ff7 » → Final Fantasy VII…). On génère les
// initiales du titre complet ET de chaque segment (avant/après « : » ou « - »),
// les nombres et chiffres romains étant gardés entiers (+ variante en chiffres).
const ROMAN = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8,
  ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16,
};
function acronymsOf(rawName) {
  const out = new Set();
  const addFor = (words) => {
    if (words.length < 2) return;
    let a = ""; // « gtav », « ffvii »
    let b = ""; // variante chiffres : « gta5 », « ff7 »
    for (const w of words) {
      if (/^\d+$/.test(w)) {
        a += w;
        b += w;
      } else if (ROMAN[w]) {
        a += w;
        b += String(ROMAN[w]);
      } else {
        a += w[0];
        b += w[0];
      }
    }
    out.add(a);
    if (b !== a) out.add(b);
  };
  const allWords = norm(rawName).split(" ").filter(Boolean);
  addFor(allWords);
  for (const seg of String(rawName || "").split(/[:\-–—]/)) {
    const ws = norm(seg).split(" ").filter(Boolean);
    if (ws.length && ws.length !== allWords.length) addFor(ws);
  }
  return [...out];
}

// Miroir EXACT de scoreRound() côté serveur (routes/blindtest.js) : le client
// affiche des points « en direct », le serveur recalcule la vérité au /finish.
function estimatePoints(r, guessGameId, guessName, timeMs, durationSec) {
  const correct = sameGame(r, guessGameId, guessName);
  const dur = durationSec * 1000;
  const t = timeMs == null ? dur : Math.min(Math.max(timeMs, 0), dur);
  const frac = dur > 0 ? (dur - t) / dur : 0;
  const fam = r.owned
    ? Math.max(
        Math.min((r.playtimeHours || 0) / 40, 1),
        r.rating != null ? Math.max(0, (r.rating - 60) / 40) : 0
      )
    : 0;
  if (correct) {
    let pts = 200 + Math.round(600 * frac);
    if (!r.owned) pts += 250 + Math.round(150 * frac);
    else pts += Math.round(120 * fam);
    return pts;
  }
  if (r.owned) return -Math.round(60 + 240 * fam);
  return -40;
}

// Fractions de l'extrait auxquelles les indices se dévoilent.
const HINT_FRACS = [0.35, 0.55, 0.75];

// Décompte avant le passage automatique à la manche suivante après la
// révélation (la barre CSS .bt-reveal-progress dure aussi 5 s — garder synchro).
const AUTO_NEXT_MS = 5000;

// Temps supplémentaire APRÈS la fin de l'extrait pour finir de taper sa
// réponse (le son est coupé, le chrono devient rouge).
const GRACE_MS = 10000;

// --- Bruitages synthétisés (WebAudio, zéro asset externe) ---
function useSfx() {
  const ctxRef = useRef(null);
  const mutedRef = useRef(false);
  const levelRef = useRef(1); // suit le slider de volume

  const resume = useCallback(() => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctxRef.current = new AC();
    }
    ctxRef.current?.resume?.();
  }, []);

  const tone = useCallback((freq, dur, type = "sine", gain = 0.14, when = 0) => {
    const ctx = ctxRef.current;
    if (!ctx || mutedRef.current) return;
    const g0 = Math.max(0.0001, gain * levelRef.current);
    if (g0 <= 0.0001) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(g0, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }, []);

  const play = useCallback(
    (name) => {
      if (!ctxRef.current) return;
      switch (name) {
        case "start":
          tone(320, 0.12, "sawtooth", 0.06);
          tone(640, 0.16, "sine", 0.05, 0.05);
          break;
        case "tick":
          tone(880, 0.05, "square", 0.045);
          break;
        case "tick-hot":
          tone(1180, 0.06, "square", 0.06);
          break;
        case "hint":
          tone(740, 0.09, "triangle", 0.07);
          tone(1100, 0.12, "triangle", 0.06, 0.06);
          break;
        case "correct":
          [523, 659, 784, 1046].forEach((f, i) =>
            tone(f, 0.2, "triangle", 0.13, i * 0.07)
          );
          break;
        case "wrong":
          tone(196, 0.32, "sawtooth", 0.11);
          tone(146, 0.36, "sawtooth", 0.09, 0.05);
          break;
        case "finish":
          [523, 659, 784, 1046, 1318].forEach((f, i) =>
            tone(f, 0.3, "triangle", 0.13, i * 0.1)
          );
          break;
        default:
          break;
      }
    },
    [tone]
  );

  const setMuted = useCallback((v) => {
    mutedRef.current = v;
  }, []);
  const setLevel = useCallback((v) => {
    levelRef.current = v;
  }, []);

  return { resume, play, setMuted, setLevel };
}

export default function BlindTest() {
  const { token } = useAuth();
  const player = usePlayer();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const challengeId = params.get("challenge");
  const sfx = useSfx();

  // phase : intro | loading | playing | done | error
  const [phase, setPhase] = useState("intro");
  const [error, setError] = useState("");
  const [roundCount, setRoundCount] = useState(10);
  const [muted, setMutedState] = useState(false);
  const [volume, setVolume] = useState(() => {
    // getItem() renvoie null quand rien n'est stocké → Number(null) vaut 0 (et
    // passe le test >= 0), d'où un volume à 0 au tout premier lancement. On
    // teste donc l'ABSENCE de valeur explicitement, et on démarre à fond.
    const raw = localStorage.getItem("bt_volume");
    const v = raw == null ? NaN : Number(raw);
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 100;
  });
  const [paused, setPaused] = useState(false);

  // Données de la partie
  const [sessionId, setSessionId] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [challengeInfo, setChallengeInfo] = useState(null);

  // Déroulé
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [timeLeftMs, setTimeLeftMs] = useState(0);
  const [reveal, setReveal] = useState(null); // { correct, points, round, guessName }
  const [nextIn, setNextIn] = useState(5); // secondes avant l'auto-avance
  const [replayOn, setReplayOn] = useState(false); // réécoute depuis la card résultat
  const [clipLoading, setClipLoading] = useState(false); // le son charge encore
  const [final, setFinal] = useState(null);
  const [copied, setCopied] = useState(false);

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
  const mutedRef = useRef(false); // miroir du mute pour les closures du player
  const volumeRef = useRef(volume);
  const pausedRef = useRef(false);
  const pauseStartRef = useRef(0);
  const prevUnlockRef = useRef(0);
  const replayRef = useRef(false); // miroir de replayOn pour les timers
  const clipStartRef = useRef(0); // position (s) du début de l'extrait dans la vidéo
  const revealAtRef = useRef(0); // instant de la révélation (anti Entrée « en retard »)
  const loadingRef = useRef(false); // miroir de clipLoading pour le timer de manche
  const graceRef = useRef(false); // l'extrait est fini, on est dans le temps bonus

  // --- Player YouTube caché, propre à la page (indépendant du mini-lecteur) ---
  const ytHostRef = useRef(null);
  const ytRef = useRef(null);
  const readyRef = useRef(false);
  const pollRef = useRef(null);
  const seekDoneRef = useRef(false);

  useEffect(() => {
    let destroyed = false;
    loadYT().then((YT) => {
      if (destroyed || !ytHostRef.current) return;
      const host = document.createElement("div");
      ytHostRef.current.appendChild(host);
      ytRef.current = new YT.Player(host, {
        height: "0",
        width: "0",
        playerVars: {
          autoplay: 0,
          playsinline: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
          },
        },
      });
    });
    return () => {
      destroyed = true;
      if (pollRef.current) clearInterval(pollRef.current);
      try {
        ytRef.current?.destroy();
      } catch {
        /* ignore */
      }
      ytRef.current = null;
      readyRef.current = false;
      if (ytHostRef.current) ytHostRef.current.innerHTML = "";
    };
  }, []);

  const stopClip = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    try {
      ytRef.current?.pauseVideo?.();
    } catch {
      /* ignore */
    }
  }, []);

  // Charge un extrait : démarre muet, attend la durée, se cale au bon endroit,
  // puis démasque le son (l'appli est lancée sur un clic → l'audio est autorisé).
  // Pendant le chargement, un spinner s'affiche sur le vinyle et le chrono de la
  // manche est réarmé au moment où le son démarre réellement.
  const playClip = useCallback(
    (round) => {
      const p = ytRef.current;
      if (!p) return;
      seekDoneRef.current = false;
      loadingRef.current = true;
      setClipLoading(true);
      try {
        p.loadVideoById(round.videoId);
        p.mute?.();
      } catch {
        /* ignore */
      }
      if (pollRef.current) clearInterval(pollRef.current);
      const pollStart = Date.now();
      pollRef.current = setInterval(() => {
        const pl = ytRef.current;
        if (!pl?.getDuration || seekDoneRef.current) return;
        let dur = 0;
        try {
          dur = pl.getDuration() || 0;
        } catch {
          /* ignore */
        }
        if (dur > 0) {
          seekDoneRef.current = true;
          const clip = round.durationSec;
          const maxStart = Math.max(0, dur - clip - 1);
          const startAt = Math.min((round.startFrac || 0) * dur, maxStart);
          clipStartRef.current = startAt;
          try {
            pl.seekTo(startAt, true);
            if (!mutedRef.current) {
              pl.unMute?.();
              pl.setVolume?.(volumeRef.current);
            }
            if (!pausedRef.current) pl.playVideo?.();
          } catch {
            /* ignore */
          }
          // Le vrai départ de la manche : le chrono repart quand le son joue.
          if (!lockedRef.current && !pausedRef.current) roundStartRef.current = Date.now();
          loadingRef.current = false;
          setClipLoading(false);
          clearInterval(pollRef.current);
          pollRef.current = null;
        } else if (Date.now() - pollStart > 8000) {
          // Vidéo qui ne répond pas : on retire le spinner, la manche continue.
          if (!lockedRef.current && !pausedRef.current) roundStartRef.current = Date.now();
          loadingRef.current = false;
          setClipLoading(false);
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 120);
    },
    []
  );

  // Applique le mute au player + aux bruitages.
  useEffect(() => {
    mutedRef.current = muted;
    sfx.setMuted(muted);
    try {
      if (muted) ytRef.current?.mute?.();
      else if (readyRef.current) {
        ytRef.current?.unMute?.();
        ytRef.current?.setVolume?.(volumeRef.current);
      }
    } catch {
      /* ignore */
    }
  }, [muted, sfx]);

  // Applique le volume au player + aux bruitages, et le retient pour la
  // prochaine session.
  useEffect(() => {
    volumeRef.current = volume;
    localStorage.setItem("bt_volume", String(volume));
    sfx.setLevel(volume / 100);
    try {
      ytRef.current?.setVolume?.(volume);
    } catch {
      /* ignore */
    }
  }, [volume, sfx]);

  // Met en pause le mini-lecteur global si quelque chose y jouait.
  useEffect(() => {
    player?.pause?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mode immersif : sur mobile, masque la bottom bar de navigation le temps de
  // la partie (sinon elle chevauche le champ quand le clavier virtuel s'ouvre).
  useEffect(() => {
    document.body.classList.add("bt-immersive");
    return () => document.body.classList.remove("bt-immersive");
  }, []);

  // --- Pause / reprise : fige le chrono (décale l'origine de la manche du
  //     temps passé en pause) et suspend l'extrait. ---
  const togglePause = useCallback(() => {
    if (lockedRef.current) return;
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    if (next) {
      pauseStartRef.current = Date.now();
      try {
        ytRef.current?.pauseVideo?.();
      } catch {
        /* ignore */
      }
    } else {
      roundStartRef.current += Date.now() - pauseStartRef.current;
      // Pas de reprise du son si l'extrait était déjà terminé (temps bonus).
      if (!graceRef.current) {
        try {
          ytRef.current?.playVideo?.();
        } catch {
          /* ignore */
        }
      }
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, []);

  // --- Réécoute de l'extrait depuis la card de résultat (toggle) ---
  const toggleReplay = useCallback(() => {
    const p = ytRef.current;
    if (!p) return;
    const next = !replayRef.current;
    replayRef.current = next;
    setReplayOn(next);
    try {
      if (next) {
        p.seekTo?.(clipStartRef.current || 0, true);
        if (!mutedRef.current) {
          p.unMute?.();
          p.setVolume?.(volumeRef.current);
        }
        p.playVideo?.();
      } else {
        p.pauseVideo?.();
      }
    } catch {
      /* ignore */
    }
  }, []);

  // --- Démarrage d'une partie ---
  async function startGame() {
    sfx.resume(); // crée/réveille l'AudioContext dans le geste utilisateur
    player?.pause?.(); // coupe le mini-lecteur global (ex. OST des résultats)
    setError("");
    setPhase("loading");
    setFinal(null);
    setReveal(null);
    setIdx(0);
    setScore(0);
    guessesRef.current = [];
    try {
      const d = challengeId
        ? await apiFetch(`/blindtest/challenge/${challengeId}`, { token })
        : await apiFetch("/blindtest/start", {
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
      setError(e.message || "Impossible de lancer le blind test.");
      setPhase("error");
    }
  }

  // --- Verrouille la réponse de la manche courante (guess ou timeout) ---
  // L'extrait est coupé : place aux bruitages + au résultat (bouton de
  // réécoute dans la card pour qui veut réentendre le morceau).
  const lockGuess = useCallback(
    (cand) => {
      if (lockedRef.current) return;
      lockedRef.current = true;
      stopClip();
      loadingRef.current = false;
      setClipLoading(false);
      const round = rounds[idx];
      if (!round) return;
      const timeMs = cand ? Date.now() - roundStartRef.current : null;
      const guessId = cand ? cand.id : null;
      const guessName = cand ? cand.name : "";
      const points = estimatePoints(round, guessId, guessName, timeMs, round.durationSec);
      const correct = sameGame(round, guessId, guessName);
      guessesRef.current[idx] = {
        id: round.id,
        gameId: guessId,
        name: cand ? cand.name : "",
        timeMs,
      };
      setScore((s) => s + points);
      sfx.play(correct ? "correct" : "wrong");
      revealAtRef.current = Date.now();
      replayRef.current = false;
      setReplayOn(false);
      setReveal({ correct, points, round, guessName: cand ? cand.name : null });
    },
    [rounds, idx, stopClip, sfx]
  );

  // --- Timer d'une manche ---
  useEffect(() => {
    if (phase !== "playing") return;
    const round = rounds[idx];
    if (!round) return;
    setReveal(null);
    setInput("");
    setHighlight(0);
    lockedRef.current = false;
    lastTickRef.current = -1;
    pausedRef.current = false;
    setPaused(false);
    prevUnlockRef.current = 0;
    graceRef.current = false;
    roundStartRef.current = Date.now();
    // La manche dure : extrait (durationSec) + temps bonus pour taper (GRACE_MS).
    const total = round.durationSec * 1000 + GRACE_MS;
    setTimeLeftMs(total);
    playClip(round);
    sfx.play("start");
    // Focus le champ de recherche pour taper tout de suite.
    setTimeout(() => inputRef.current?.focus(), 60);

    const iv = setInterval(() => {
      // Réponse déjà donnée : on fige le chrono (plus de tic-tac ni d'anneau
      // qui bouge derrière la correction).
      if (lockedRef.current) {
        clearInterval(iv);
        return;
      }
      if (pausedRef.current) return; // chrono gelé pendant la pause
      // Chrono gelé tant que le son charge (playClip réarme roundStartRef au
      // vrai départ) — évite le compteur qui descend puis remonte.
      if (loadingRef.current) return;
      const left = Math.max(0, total - (Date.now() - roundStartRef.current));
      setTimeLeftMs(left);
      // Fin de l'extrait → on coupe le son, place au temps bonus (une fois).
      if (left <= GRACE_MS && !graceRef.current) {
        graceRef.current = true;
        stopClip();
      }
      if (left <= GRACE_MS && left > 0) {
        const sec = Math.ceil(left / 1000);
        if (sec !== lastTickRef.current) {
          lastTickRef.current = sec;
          sfx.play(sec <= 3 ? "tick-hot" : "tick");
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

  // --- Envoi final ---
  const finishGame = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    stopClip();
    setPhase("loading");
    try {
      const res = await apiFetch("/blindtest/finish", {
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
          ostName: r.ostName,
          videoId: r.videoId,
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
      setFinal({
        blindTestId: null,
        score: Math.max(0, localRounds.reduce((a, r) => a + r.points, 0)),
        correctCount: localRounds.filter((r) => r.correct).length,
        roundCount: localRounds.length,
        challenge: challengeInfo
          ? {
              username: challengeInfo.user?.username,
              score: challengeInfo.score,
              beaten:
                Math.max(0, localRounds.reduce((a, r) => a + r.points, 0)) >
                (challengeInfo.score ?? 0),
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
  }, [sessionId, token, rounds, stopClip, sfx, challengeInfo]);

  // --- Passage à la manche suivante (ou fin) ---
  const goNext = useCallback(() => {
    replayRef.current = false;
    setReplayOn(false);
    setReveal(null);
    if (idx + 1 < rounds.length) setIdx((i) => i + 1);
    else finishGame();
  }, [idx, rounds.length, finishGame]);
  advanceRef.current = goNext;

  // Décompte visible de 5 s après la révélation, puis auto-avance (le bouton
  // « Suivant », Entrée ou Espace court-circuitent). Le décompte est SUSPENDU
  // pendant la réécoute de l'extrait (la barre CSS se met en pause aussi).
  useEffect(() => {
    if (!reveal) return;
    let left = AUTO_NEXT_MS;
    let last = Date.now();
    setNextIn(Math.ceil(AUTO_NEXT_MS / 1000));
    const iv = setInterval(() => {
      const now = Date.now();
      if (!replayRef.current) left -= now - last;
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

  // --- Raccourcis clavier (PC) : Entrée lance la partie / passe à la manche
  //     suivante, Échap met en pause. Re-liés à chaque rendu → closures à jour.
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
        // Petit délai de grâce : une Entrée tapée « en retard » (pour valider
        // une réponse) ne doit pas zapper le résultat qui vient d'apparaître.
        if (Date.now() - revealAtRef.current < 400) return;
        if (k === "Enter" || k === " " || k === "ArrowRight") {
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

  // Une seule entrée par jeu « canonique » dans la recherche : pas de doublons
  // éditions / versions / remasters (le nom le plus court = le jeu de base, et
  // deviner l'un vaut l'autre grâce à sameGame).
  const uniqueCandidates = useMemo(() => {
    const byCanon = new Map();
    for (const c of candidates) {
      const key = canonName(c.name) || norm(c.name);
      const prev = byCanon.get(key);
      if (!prev) {
        byCanon.set(key, c);
      } else {
        // On fusionne : on garde le nom le plus court comme libellé, mais on
        // cumule les noms alternatifs (FR, etc.) des deux entrées.
        const better = c.name.length < prev.name.length ? c : prev;
        byCanon.set(key, {
          ...better,
          cover: better.cover || prev.cover || c.cover,
          alt: [...(prev.alt || []), ...(c.alt || [])],
        });
      }
    }
    // Précalcule, une fois, tout ce qui sert à la recherche : acronymes, et le
    // corpus de noms cherchables (nom principal + noms alternatifs / FR),
    // chacun en version normalisée ET « collée » (sans espaces).
    return [...byCanon.values()].map((c) => {
      const raw = [c.name, ...(c.alt || [])].filter(Boolean);
      const names = [...new Set(raw.map(norm))].filter(Boolean);
      const sq = [...new Set(raw.map(squish))].filter(Boolean);
      return { ...c, acr: acronymsOf(c.name), _names: names, _sq: sq };
    });
  }, [candidates]);

  // Suggestions de recherche : préfixe > acronyme (« gta », « botw », « ff7 »…)
  // > sous-chaîne. On teste le nom principal ET les noms alternatifs (FR…), en
  // version normale et « collée » — donc « another code » trouve « Trace
  // Memory », et « assassins creed » trouve « Assassin's Creed ».
  const suggestions = useMemo(() => {
    const q = norm(input);
    if (!q) return [];
    const qc = squish(input); // « gta 5 » / « assassin's » → « gta5 » / « assassins »
    const starts = [];
    const acro = [];
    const incl = [];
    for (const c of uniqueCandidates) {
      if (c._names.some((n) => n.startsWith(q)) || c._sq.some((n) => n.startsWith(qc)))
        starts.push(c);
      else if (qc.length >= 2 && c.acr.some((a) => a.startsWith(qc))) acro.push(c);
      else if (
        c._names.some((n) => n.includes(q)) ||
        (qc.length >= 2 && c._sq.some((n) => n.includes(qc)))
      )
        incl.push(c);
      if (starts.length >= 8) break;
    }
    return [...starts, ...acro, ...incl].slice(0, 8);
  }, [input, uniqueCandidates]);

  // La liste de suggestions est en position absolue sous le champ : quand le
  // champ est bas dans la page (contenu centré verticalement), elle débordait
  // sous l'écran sans qu'on puisse l'atteindre. On plafonne sa hauteur à
  // l'espace réellement dispo jusqu'au bas du viewport → elle scrolle dedans.
  useEffect(() => {
    const el = suggestRef.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top;
      const avail = window.innerHeight - top - 12;
      el.style.maxHeight = `${Math.max(140, avail)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [suggestions]);

  // Navigation clavier : garde la suggestion surlignée visible dans la liste
  // (sinon on descend « dans le vide » sans que ça scrolle jusqu'à elle).
  useEffect(() => {
    const el = suggestRef.current;
    if (!el) return;
    el.children[highlight]?.scrollIntoView({ block: "nearest" });
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
      // Entrée valide la suggestion surlignée, ou la première par défaut.
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

  function copyChallenge() {
    const id = final?.blindTestId;
    if (!id) return;
    const url = `${window.location.origin}/blindtest?challenge=${id}`;
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {}
    );
  }

  const round = rounds[idx];
  // La manche = écoute (durationSec) puis temps bonus (GRACE_MS, son coupé).
  // L'anneau montre le temps d'écoute restant, puis se remplit en rouge et
  // égrène les 5 dernières secondes.
  const listenLeftMs = Math.max(0, timeLeftMs - GRACE_MS);
  const inGrace = phase === "playing" && !!round && timeLeftMs > 0 && listenLeftMs <= 0;
  const clipFrac = round
    ? inGrace
      ? timeLeftMs / GRACE_MS
      : listenLeftMs / (round.durationSec * 1000)
    : 0;
  const secondsLeft = Math.ceil((inGrace ? timeLeftMs : listenLeftMs) / 1000);
  const elapsedMs = round ? round.durationSec * 1000 - listenLeftMs : 0;

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

  // Petit blip quand un indice se dévoile.
  useEffect(() => {
    if (phase !== "playing" || reveal) return;
    if (unlockedCount > prevUnlockRef.current) sfx.play("hint");
    prevUnlockRef.current = unlockedCount;
  }, [unlockedCount, phase, reveal, sfx]);

  const volIcon = muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;
  const VolIcon = volIcon;

  // ============================================================
  //  Rendu
  // ============================================================
  return (
    <div className="bt-page">
      <div ref={ytHostRef} style={{ position: "fixed", left: -9999, top: -9999 }} />

      <header className="bt-topbar">
        <button className="bt-back clickable" onClick={() => navigate("/app")}>
          <ArrowLeft size={17} /> <span>Retour</span>
        </button>
        <div className="bt-brand">
          <Music2 size={17} /> Blind Test
        </div>
        <div className="bt-volume">
          <button
            className="bt-vol-btn clickable"
            onClick={() => setMutedState((m) => !m)}
            title={muted ? "Réactiver le son" : "Couper le son"}
          >
            <VolIcon size={17} />
          </button>
          <input
            type="range"
            className="bt-vol-slider clickable"
            min="0"
            max="100"
            value={muted ? 0 : volume}
            style={{ "--bt-vol-pct": `${muted ? 0 : volume}%` }}
            aria-label="Volume"
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              if (muted && v > 0) setMutedState(false);
            }}
          />
        </div>
      </header>

      <div className="bt-body">
        {/* ---------- INTRO ---------- */}
        {phase === "intro" && (
          <div className="bt-intro">
            <div className="bt-hero-disc" aria-hidden="true">
              <span className="bt-disc" />
              <Music2 size={50} className="bt-hero-note" />
            </div>
            <span className="bt-kicker">
              {challengeId ? "Défi entre joueurs" : "Quiz musical"}
            </span>
            <h1 className="bt-title">
              {challengeId ? "Relève le défi" : "Blind Test"}
            </h1>
            <p className="bt-sub">
              {challengeId
                ? "Écoute les mêmes extraits qu'un autre joueur et bats son score."
                : "On te fait écouter un morceau d'OST au pif.  À toi de deviner de quel jeu il vient — plus tu réponds vite, plus tu marques."}
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
              {challengeId ? "Relever le défi" : "Lancer le blind test"}
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
            <p>{final || finishingRef.current ? "On calcule ton score…" : "On prépare tes extraits…"}</p>
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
          <div className="bt-play">
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

            <div
              className={`bt-stage ${(inGrace || secondsLeft <= 3) && !paused ? "hot" : ""} ${
                inGrace ? "grace" : ""
              } ${paused ? "paused" : ""}`}
            >
              <button
                className="bt-vinyl clickable"
                onClick={togglePause}
                title={paused ? "Reprendre" : "Mettre en pause"}
                aria-label={paused ? "Reprendre" : "Mettre en pause"}
              >
                <span className="bt-vinyl-disc" />
                <span className="bt-eq">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <i key={i} style={{ animationDelay: `${i * 0.09}s` }} />
                  ))}
                </span>
                <span className="bt-vinyl-pause" aria-hidden="true">
                  <Pause size={28} />
                </span>
              </button>
              <svg className="bt-ring" viewBox="0 0 120 120" aria-hidden="true">
                <circle className="bt-ring-bg" cx="60" cy="60" r="54" />
                <circle
                  className="bt-ring-fg"
                  cx="60"
                  cy="60"
                  r="54"
                  style={{
                    strokeDasharray: 2 * Math.PI * 54,
                    strokeDashoffset: 2 * Math.PI * 54 * (1 - clipFrac),
                  }}
                />
              </svg>
              <span className="bt-timer-num">{secondsLeft}</span>
              {clipLoading && !paused && !reveal && (
                <span className="bt-clip-loading" aria-hidden="true">
                  <Loader2 size={26} className="spin" />
                  <span>Chargement…</span>
                </span>
              )}
              {paused && (
                <button className="bt-resume clickable" onClick={togglePause}>
                  <Play size={34} />
                  <span>Reprendre</span>
                </button>
              )}
            </div>

            {inGrace && !reveal && !paused && (
              <p className="bt-grace-hint">Extrait terminé — valide ta réponse !</p>
            )}

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
                    // Mobile : remonte le champ au-dessus du clavier virtuel.
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

            {/* ---- Révélation : overlay centré plein écran ---- */}
            {reveal && (
              <div className="bt-overlay" role="dialog" aria-modal="true">
                <div className="bt-reveal-wrap">
                <div
                  className={`bt-reveal ${reveal.correct ? "good" : "bad"} ${
                    replayOn ? "replaying" : ""
                  }`}
                >
                  <i className="bt-reveal-progress" aria-hidden="true" />
                  <span className="bt-reveal-verdict">
                    {reveal.correct ? "Trouvé !" : "Raté !"}
                    <b className={`bt-reveal-pts ${reveal.points >= 0 ? "up" : "down"}`}>
                      {reveal.points >= 0 ? `+${reveal.points}` : reveal.points}
                    </b>
                  </span>
                  <div className="bt-reveal-cover">
                    {reveal.round.cover ? (
                      <img src={reveal.round.cover} alt="" draggable="false" />
                    ) : (
                      <span className="bt-reveal-ph">
                        <Gamepad2 size={34} />
                      </span>
                    )}
                    <span className="bt-reveal-badge">
                      {reveal.correct ? <Check size={22} /> : <X size={22} />}
                    </span>
                  </div>
                  {!reveal.correct && (
                    <span className="bt-reveal-anslabel">La réponse était</span>
                  )}
                  <span className="bt-reveal-game">{reveal.round.gameName}</span>
                  <button
                    className={`bt-reveal-listen clickable ${replayOn ? "on" : ""}`}
                    onClick={toggleReplay}
                  >
                    {replayOn ? <Pause size={13} /> : <Play size={13} />}
                    <span>{reveal.round.ostName || "Réécouter l'extrait"}</span>
                  </button>
                  <button className="bt-next clickable" onClick={goNext}>
                    {idx + 1 < rounds.length ? "Manche suivante" : "Voir mon score"}
                    <span className="bt-next-count">{nextIn}</span>
                  </button>
                  <span className="bt-reveal-keys">
                    <kbd className="bt-kbd">↵</kbd> ou{" "}
                    <kbd className="bt-kbd">Espace</kbd> pour continuer
                  </span>
                </div>
                {/* Ta réponse : sous la card, en pill sur le voile */}
                {!reveal.correct && (
                  <span className="bt-reveal-your">
                    {reveal.guessName ? (
                      <>
                        Ta réponse : <s>{reveal.guessName}</s>
                      </>
                    ) : (
                      "Temps écoulé, aucune réponse"
                    )}
                  </span>
                )}
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
            copied={copied}
            onCopy={copyChallenge}
            onReplay={() => {
              if (challengeId) navigate("/blindtest");
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
function Scoreboard({ final, challengeId, copied, onCopy, onReplay, token }) {
  const [board, setBoard] = useState(null);
  const player = usePlayer();
  const pct = final.roundCount ? Math.round((final.correctCount / final.roundCount) * 100) : 0;
  const ch = final.challenge;

  // Les OST de la partie, jouables dans le mini-lecteur global (file complète :
  // lancer une piste permet d'enchaîner les autres avec suivant/précédent).
  const tracks = useMemo(
    () =>
      final.rounds
        .filter((r) => r.videoId)
        .map((r) => ({
          id: `bt-${r.gameId}-${r.videoId}`,
          videoId: r.videoId,
          name: r.ostName || r.gameName,
          artist: r.gameName,
          artwork: r.cover || null,
          gameId: r.gameId,
          gameName: r.gameName,
        })),
    [final.rounds]
  );
  const trackFor = (r) => tracks.find((t) => t.videoId === r.videoId) || null;

  useEffect(() => {
    let alive = true;
    apiFetch("/blindtest/leaderboard", { token })
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
          {final.blindTestId && !challengeId && (
            <button className="bt-ghost clickable" onClick={onCopy}>
              {copied ? <Check size={16} /> : <Share2 size={16} />}
              {copied ? "Lien copié !" : "Défier un ami"}
            </button>
          )}
          <Link to="/app" className="bt-ghost clickable">
            <Home size={16} /> Accueil
          </Link>
        </div>
        {final._offline && (
          <p className="bt-offline-note">Score affiché en local (enregistrement indisponible).</p>
        )}
      </div>

      <div className="bt-done-cols">
        {/* Détail des manches */}
        <div className="bt-recap">
          <h2 className="bt-recap-title">Le détail</h2>
          <ul className="bt-recap-list">
            {final.rounds.map((r, i) => (
              <li key={i} className={`bt-recap-row ${r.correct ? "good" : "bad"}`}>
                <span className="bt-recap-cover">
                  {r.cover ? (
                    <img src={r.cover} alt="" loading="lazy" draggable="false" />
                  ) : (
                    <span className="bt-suggest-ph">
                      <Gamepad2 size={14} />
                    </span>
                  )}
                  <span className="bt-recap-verdict">
                    {r.correct ? <Check size={13} /> : <X size={13} />}
                  </span>
                </span>
                <span className="bt-recap-info">
                  <Link to={`/game/${r.gameId}`} className="bt-recap-game clickable">
                    {r.gameName}
                  </Link>
                  {r.ostName && (
                    <span className="bt-recap-ost">
                      <Music2 size={11} />
                      <span>{r.ostName}</span>
                    </span>
                  )}
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
                {r.videoId && (
                  <button
                    className={`bt-recap-play clickable ${
                      player?.isPlaying?.(trackFor(r)) ? "on" : ""
                    }`}
                    onClick={() =>
                      player?.toggleTrack?.(trackFor(r), tracks, {
                        source: { label: "Blind test — le détail" },
                      })
                    }
                    title={
                      player?.isPlaying?.(trackFor(r))
                        ? "Mettre en pause"
                        : "Écouter l'OST"
                    }
                  >
                    {player?.isPlaying?.(trackFor(r)) ? (
                      <Pause size={13} />
                    ) : (
                      <Play size={13} />
                    )}
                  </button>
                )}
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
                <li
                  key={e.blindTestId}
                  className={`bt-board-row ${e.isMe ? "me" : ""}`}
                >
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
                      to={`/blindtest?challenge=${e.blindTestId}`}
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
    </div>
  );
}
