import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadYT, extractVideoId } from "../lib/youtube";
import { API_BASE } from "../lib/api";

// Lecteur audio global de l'app, monté une fois (dans AppLayout), qui survit
// aux changements de page. Deux moteurs :
//  - "yt" : l'iframe YouTube cachée. Démarre instantanément (YouTube streame
//    sans attendre), mais coupée par les navigateurs mobiles dès que la page
//    passe en arrière-plan (lecture en arrière-plan = YouTube Premium).
//  - "audio" : un <audio> unique sur le flux m4a extrait côté serveur
//    (/api/audio/:videoId). Continue écran verrouillé, contrôles sur l'écran
//    de verrouillage via l'API Media Session.
// Sur PC l'arrière-plan n'est pas un problème → iframe seule, zéro extraction.
// Sur mobile : l'iframe démarre tout de suite, et on bascule vers le flux
// extrait dès qu'il est lisible (position reprise, transition transparente).
// Si l'extraction échoue pour une piste, on reste simplement en iframe.

const PlayerContext = createContext(null);
// La position de lecture change 2 à 4 fois par SECONDE. Laissée dans le
// contexte principal, elle re-rendait tous ses abonnés au même rythme (fil
// d'actualité, grille d'OST d'une page jeu, widgets de l'accueil…) pour une
// info que seul le mini-lecteur affiche. Elle a donc son propre contexte : le
// reste de l'app ne re-rend plus que sur un vrai changement d'état (piste,
// play/pause, file).
const PlayerProgressContext = createContext({ current: 0, duration: 0 });

// Sur PC, l'iframe suffit ; la bascule vers le flux extrait ne sert que sur
// mobile. (iPadOS se présente comme un Mac de bureau, d'où le test tactile.)
const IS_MOBILE =
  typeof navigator !== "undefined" &&
  (navigator.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/i.test(navigator.platform || "")));

// Mini wav silencieux : joué (muet) pendant le clic de lancement pour
// « déverrouiller » l'élément <audio> sur iOS — ensuite, les play()
// programmatiques (bascule, enchaînement auto) sont autorisés sur cet élément.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

// Normalise une piste (OST de jeu OU favoriteOst de profil) en piste jouable.
// Tout est YouTube désormais : on exige un videoId (sinon injouable → null).
function toPlayable(raw, meta = {}) {
  if (!raw) return null;
  const videoId = raw.videoId || extractVideoId(raw.url || "");
  if (!videoId) return null;
  return {
    id: raw.id || `v-${videoId}`,
    videoId,
    name: raw.name || "Sans titre",
    artist: raw.artist && raw.artist !== "YouTube" ? raw.artist : "",
    artwork: raw.artwork || null,
    gameId: meta.gameId ?? raw.gameId ?? null,
    gameName: meta.gameName ?? raw.gameName ?? null,
  };
}

export function PlayerProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Piste en cours de chargement/buffering (le mini-lecteur affiche un loader
  // au lieu du bouton play, pour ne pas croire que rien n'a été lancé).
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, duration: 0 });
  // D'où vient la file en cours (ex. { href: "/lists/xx", label: "Ma playlist" }) :
  // permet au mini-lecteur de proposer un retour vers la playlist écoutée.
  const [source, setSource] = useState(null);
  // Volume global (0..1) + sourdine, appliqués aux deux moteurs. Persisté pour
  // retrouver son réglage d'une session à l'autre (contrôle PC surtout).
  const [volume, setVolumeState] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem("mpl-volume"));
      if (isFinite(v)) return Math.max(0, Math.min(1, v));
    } catch {
      /* ignore */
    }
    return 1;
  });
  const [muted, setMuted] = useState(false);

  const audioRef = useRef(null);
  // Moteur actif ("yt" | "audio"). L'iframe est toujours le point de départ.
  const engineRef = useRef("yt");
  // videoId d'une bascule iframe → audio en attente (annulée si la piste change).
  const swapIdRef = useRef(null);
  // videoIds dont l'extraction a échoué → plus de tentative de bascule.
  const failedRef = useRef(new Set());
  // Déverrouillage iOS : null (pas fait) | Promise (en cours) | "done".
  const unlockRef = useRef(null);
  const ytRef = useRef(null);
  const ytDivRef = useRef(null);
  const ytPromiseRef = useRef(null);
  const loadedRef = useRef(null); // videoId actuellement chargé
  const queueRef = useRef(queue);
  const indexRef = useRef(index);
  const playingRef = useRef(playing);
  const loadingRef = useRef(loading);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);

  queueRef.current = queue;
  indexRef.current = index;
  playingRef.current = playing;
  loadingRef.current = loading;
  volumeRef.current = volume;
  mutedRef.current = muted;

  const current = queue[index] || null;

  // Avance auto (fin de piste) : piste suivante, ou stop en fin de file.
  const advance = useCallback(() => {
    const q = queueRef.current;
    const i = indexRef.current;
    if (i < q.length - 1) setIndex(i + 1);
    else setPlaying(false);
  }, []);
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // Pousse volume/sourdine vers les deux moteurs. L'un des deux peut ne pas
  // exister encore : on le rappelle donc à la création de chacun.
  const applyVolume = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.volume = volumeRef.current;
      a.muted = mutedRef.current;
    }
    const p = ytRef.current;
    if (p) {
      try {
        p.setVolume?.(Math.round(volumeRef.current * 100));
        if (mutedRef.current) p.mute?.();
        else p.unMute?.();
      } catch {
        /* ignore */
      }
    }
  }, []);

  // --- Player YouTube caché (créé au premier besoin) ---
  const ensureYT = useCallback(() => {
    if (ytPromiseRef.current) return ytPromiseRef.current;
    ytPromiseRef.current = loadYT().then(
      (YT) =>
        new Promise((resolve) => {
          if (!ytDivRef.current) return; // provider démonté entre-temps
          // YT.Player REMPLACE le nœud fourni par une iframe. On lui donne donc
          // un div créé à la main (jamais un nœud rendu par React) : sinon, au
          // démontage (ex. déconnexion), React tente de retirer son div disparu
          // → NotFoundError removeChild → tout l'arbre React tombe (page blanche).
          const host = document.createElement("div");
          ytDivRef.current.appendChild(host);
          const p = new YT.Player(host, {
            height: "0",
            width: "0",
            playerVars: { autoplay: 0, playsinline: 1 },
            events: {
              onReady: () => {
                ytRef.current = p;
                applyVolume();
                resolve(p);
              },
              onStateChange: (e) => {
                if (engineRef.current !== "yt") return;
                const S = window.YT.PlayerState;
                if (e.data === S.ENDED) advanceRef.current();
                else if (e.data === S.PLAYING) {
                  setPlaying(true);
                  setLoading(false);
                } else if (e.data === S.PAUSED) {
                  setPlaying(false);
                  setLoading(false);
                } else if (e.data === S.BUFFERING) setLoading(true);
              },
            },
          });
        })
    );
    return ytPromiseRef.current;
  }, [applyVolume]);

  const loadInYT = useCallback(
    (videoId, startSeconds = 0) => {
      engineRef.current = "yt";
      swapIdRef.current = null;
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.removeAttribute("src");
        try {
          a.load();
        } catch {
          /* ignore */
        }
      }
      setLoading(true);
      ensureYT().then((p) => {
        // La piste a pu changer pendant le chargement de l'API iframe.
        const cur = queueRef.current[indexRef.current];
        if (engineRef.current !== "yt" || !cur || cur.videoId !== videoId) return;
        try {
          p.loadVideoById({ videoId, startSeconds }); // autoplay
        } catch {
          /* ignore */
        }
      });
    },
    [ensureYT]
  );

  // Prépare la bascule iframe → flux extrait : on charge l'<audio> pendant que
  // l'iframe joue (le serveur extrait la piste si elle n'est pas en cache), et
  // l'événement canplay fait la bascule. Attend la fin du déverrouillage iOS
  // s'il est en cours (il occupe le même élément).
  const armSwap = useCallback((videoId) => {
    swapIdRef.current = videoId;
    const start = () => {
      const a = audioRef.current;
      const cur = queueRef.current[indexRef.current];
      if (!a || swapIdRef.current !== videoId || cur?.videoId !== videoId) return;
      a.src = `${API_BASE}/audio/${videoId}`;
      a.load();
    };
    const u = unlockRef.current;
    if (u && u !== "done" && typeof u.then === "function") u.then(start);
    else start();
  }, []);

  // À appeler dans un geste utilisateur (clic) : sur iOS, un élément qui a joué
  // une fois dans un geste accepte ensuite les play() programmatiques.
  const unlockAudio = useCallback(() => {
    if (!IS_MOBILE || unlockRef.current) return;
    const a = audioRef.current;
    if (!a) return;
    a.muted = true;
    a.src = SILENT_WAV;
    unlockRef.current = a
      .play()
      .catch(() => {})
      .then(() => {
        a.pause();
        a.muted = false;
      })
      .finally(() => {
        unlockRef.current = "done";
      });
  }, []);

  // --- L'élément <audio> unique et ses événements ---
  useEffect(() => {
    const a = new Audio();
    a.preload = "auto";
    a.volume = volumeRef.current;
    audioRef.current = a;

    const onPlaying = () => {
      if (engineRef.current !== "audio") return;
      setPlaying(true);
      setLoading(false);
    };
    const onPause = () => {
      if (engineRef.current !== "audio") return;
      setPlaying(false);
    };
    const onWaiting = () => {
      if (engineRef.current !== "audio") return;
      setLoading(true);
    };
    const onEnded = () => {
      if (engineRef.current !== "audio") return;
      advanceRef.current();
    };
    const onTime = () => {
      if (engineRef.current !== "audio") return;
      const d = isFinite(a.duration) ? a.duration : 0;
      setProgress({ current: a.currentTime || 0, duration: d });
      // Barre de progression sur l'écran de verrouillage.
      if ("mediaSession" in navigator && d > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: d,
            playbackRate: a.playbackRate || 1,
            position: Math.min(a.currentTime || 0, d),
          });
        } catch {
          /* ignore */
        }
      }
    };
    // Le flux extrait est prêt → bascule : on reprend la position de l'iframe
    // et on coupe cette dernière.
    const onCanPlay = () => {
      if (engineRef.current !== "yt") return;
      const cur = queueRef.current[indexRef.current];
      if (!cur || swapIdRef.current !== cur.videoId) return;
      swapIdRef.current = null;
      // Si l'utilisateur avait mis en pause, on bascule en restant en pause.
      // (loading = l'iframe démarrait encore → l'intention est de jouer.)
      const shouldPlay = playingRef.current || loadingRef.current;
      let t = 0;
      try {
        t = ytRef.current?.getCurrentTime?.() || 0;
      } catch {
        /* ignore */
      }
      try {
        if (t > 0) a.currentTime = t;
      } catch {
        /* ignore */
      }
      engineRef.current = "audio";
      if (!shouldPlay) {
        try {
          ytRef.current?.stopVideo?.();
        } catch {
          /* ignore */
        }
        setLoading(false);
        return;
      }
      a.play()
        .then(() => {
          // On ne coupe l'iframe qu'une fois le flux réellement parti (pas de
          // trou, et pas de silence si play() avait été refusé).
          try {
            ytRef.current?.stopVideo?.();
          } catch {
            /* ignore */
          }
        })
        .catch(() => {
          // Refus d'autoplay (iOS non déverrouillé) : l'iframe continue, tant pis
          // pour l'arrière-plan sur cette piste.
          engineRef.current = "yt";
          a.removeAttribute("src");
          try {
            a.load();
          } catch {
            /* ignore */
          }
        });
    };
    const onError = () => {
      const cur = queueRef.current[indexRef.current];
      if (!cur) return;
      if (engineRef.current === "audio") {
        // Le flux lâche en cours de lecture → retour iframe, même position.
        failedRef.current.add(cur.videoId);
        loadInYT(cur.videoId, a.currentTime || 0);
      } else if (swapIdRef.current === cur.videoId) {
        // Extraction KO pendant que l'iframe joue → on reste en iframe.
        failedRef.current.add(cur.videoId);
        swapIdRef.current = null;
        a.removeAttribute("src");
        try {
          a.load();
        } catch {
          /* ignore */
        }
      }
    };

    a.addEventListener("playing", onPlaying);
    a.addEventListener("pause", onPause);
    a.addEventListener("waiting", onWaiting);
    a.addEventListener("ended", onEnded);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("durationchange", onTime);
    a.addEventListener("canplay", onCanPlay);
    a.addEventListener("error", onError);

    return () => {
      a.removeEventListener("playing", onPlaying);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("waiting", onWaiting);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("durationchange", onTime);
      a.removeEventListener("canplay", onCanPlay);
      a.removeEventListener("error", onError);
      a.pause();
      a.removeAttribute("src");
      try {
        a.load();
      } catch {
        /* ignore */
      }
      audioRef.current = null;
      try {
        ytRef.current?.destroy();
      } catch {
        /* ignore */
      }
      ytRef.current = null;
      ytPromiseRef.current = null;
      // Vide ce que YT a laissé (iframe ou div restauré) dans le wrapper.
      if (ytDivRef.current) ytDivRef.current.innerHTML = "";
    };
  }, [loadInYT]);

  // Charge la piste courante quand elle change : iframe tout de suite (départ
  // instantané), et sur mobile la bascule vers le flux extrait est armée.
  useEffect(() => {
    if (!current) return;
    if (loadedRef.current === current.videoId) return;
    loadedRef.current = current.videoId;
    setLoading(true);
    setProgress({ current: 0, duration: 0 });
    loadInYT(current.videoId);
    if (IS_MOBILE && !failedRef.current.has(current.videoId))
      armSwap(current.videoId);
  }, [current, loadInYT, armSwap]);

  // Progression du moteur iframe (l'<audio> pousse la sienne via timeupdate).
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      if (engineRef.current !== "yt") return;
      const p = ytRef.current;
      if (!p?.getCurrentTime) return;
      try {
        setProgress({
          current: p.getCurrentTime() || 0,
          duration: p.getDuration() || 0,
        });
      } catch {
        /* ignore */
      }
    }, 500);
    return () => clearInterval(id);
  }, [playing]);

  // Applique volume/sourdine dès qu'ils changent, et mémorise le volume.
  useEffect(() => {
    applyVolume();
    try {
      localStorage.setItem("mpl-volume", String(volume));
    } catch {
      /* ignore */
    }
  }, [volume, muted, applyVolume]);

  // Mobile : préchauffe l'extraction de la piste suivante côté serveur pendant
  // l'écoute en cours → sa bascule sera quasi immédiate.
  useEffect(() => {
    if (!IS_MOBILE) return;
    const nxt = queue[index + 1];
    if (!nxt || failedRef.current.has(nxt.videoId)) return;
    fetch(`${API_BASE}/audio/${nxt.videoId}/prefetch`).catch(() => {});
  }, [queue, index]);

  const isCurrent = useCallback(
    (raw) => {
      if (!current) return false;
      const vid = raw?.videoId || extractVideoId(raw?.url || "");
      return !!vid && vid === current.videoId;
    },
    [current]
  );

  const isPlaying = useCallback(
    (raw) => isCurrent(raw) && playing,
    [isCurrent, playing]
  );

  // Lance une piste en construisant une file à partir d'une liste (les pistes
  // injouables sont filtrées). L'index pointe sur la piste cliquée.
  // meta.source (optionnel) : origine de la file, affichée par le mini-lecteur.
  const playFromList = useCallback(
    (track, list, meta = {}) => {
      const items = (Array.isArray(list) && list.length ? list : [track])
        .map((t) => toPlayable(t, meta))
        .filter(Boolean);
      if (!items.length) return;
      // On est dans le clic de l'utilisateur : moment idéal pour déverrouiller
      // l'<audio> (nécessaire à la bascule automatique sur iOS).
      unlockAudio();
      const target = toPlayable(track, meta);
      let start = target
        ? items.findIndex((t) => t.videoId === target.videoId)
        : 0;
      if (start < 0) start = 0;
      setQueue(items);
      setIndex(start);
      setSource(meta.source || null);
      setProgress({ current: 0, duration: 0 });
    },
    [unlockAudio]
  );

  const playActive = useCallback(() => {
    if (engineRef.current === "audio") {
      audioRef.current?.play()?.catch(() => {});
    } else {
      try {
        ytRef.current?.playVideo?.();
      } catch {
        /* ignore */
      }
    }
  }, []);

  // Met en pause la lecture courante (sans fermer la barre) — utilisé aussi
  // quand un autre lecteur local prend la main (ex. l'aperçu OST de la modale).
  const pause = useCallback(() => {
    if (engineRef.current === "audio") {
      audioRef.current?.pause();
    } else {
      try {
        ytRef.current?.pauseVideo?.();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const toggle = useCallback(() => {
    if (engineRef.current === "audio") {
      const a = audioRef.current;
      if (!a || !a.src) return;
      if (a.paused) a.play().catch(() => {});
      else a.pause();
    } else {
      unlockAudio();
      try {
        if (playingRef.current) ytRef.current?.pauseVideo?.();
        else ytRef.current?.playVideo?.();
      } catch {
        /* ignore */
      }
    }
  }, [unlockAudio]);

  // Play/pause depuis une card : si c'est la piste courante on bascule, sinon
  // on démarre la nouvelle file.
  const toggleTrack = useCallback(
    (track, list, meta) => {
      if (isCurrent(track)) toggle();
      else playFromList(track, list, meta);
    },
    [isCurrent, toggle, playFromList]
  );

  const next = useCallback(() => {
    setIndex((i) => (i < queueRef.current.length - 1 ? i + 1 : i));
  }, []);

  const seekTo = useCallback((sec) => {
    if (engineRef.current === "audio") {
      const a = audioRef.current;
      if (!a || !isFinite(a.duration) || a.duration <= 0) return;
      a.currentTime = Math.max(0, Math.min(sec, a.duration));
    } else {
      try {
        ytRef.current?.seekTo?.(Math.max(0, sec), true);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const prev = useCallback(() => {
    // Comme un vrai lecteur : > 3 s → on revient au début de la piste.
    let t = 0;
    if (engineRef.current === "audio") {
      t = audioRef.current?.currentTime || 0;
    } else {
      try {
        t = ytRef.current?.getCurrentTime?.() || 0;
      } catch {
        /* ignore */
      }
    }
    if (t > 3) {
      seekTo(0);
      return;
    }
    setIndex((i) => (i > 0 ? i - 1 : i));
  }, [seekTo]);

  const seekFraction = useCallback((f) => {
    const clamped = Math.max(0, Math.min(1, f));
    if (engineRef.current === "audio") {
      const a = audioRef.current;
      if (!a || !isFinite(a.duration) || a.duration <= 0) return;
      a.currentTime = clamped * a.duration;
    } else {
      const p = ytRef.current;
      if (!p?.getDuration) return;
      try {
        p.seekTo(clamped * (p.getDuration() || 0), true);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const setVolume = useCallback((v) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    // Bouger le curseur rétablit le son (comportement standard des lecteurs).
    if (clamped > 0) setMuted(false);
  }, []);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const close = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      try {
        a.load();
      } catch {
        /* ignore */
      }
    }
    try {
      ytRef.current?.stopVideo?.();
    } catch {
      /* ignore */
    }
    engineRef.current = "yt";
    swapIdRef.current = null;
    loadedRef.current = null;
    setQueue([]);
    setIndex(0);
    setPlaying(false);
    setLoading(false);
    setSource(null);
    setProgress({ current: 0, duration: 0 });
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      } catch {
        /* ignore */
      }
    }
  }, []);

  // --- Media Session : métadonnées + contrôles écran de verrouillage ---
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: current.name,
        artist: current.artist || "",
        album: current.gameName || "",
        artwork: current.artwork
          ? [{ src: current.artwork, sizes: "512x512" }]
          : [],
      });
    } catch {
      /* ignore */
    }
  }, [current]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = !current
        ? "none"
        : playing
        ? "playing"
        : "paused";
    } catch {
      /* ignore */
    }
  }, [current, playing]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action, fn) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* action non supportée par ce navigateur */
      }
    };
    set("play", playActive);
    set("pause", pause);
    set("previoustrack", prev);
    set("nexttrack", next);
    set("seekto", (d) => {
      if (typeof d?.seekTime === "number") seekTo(d.seekTime);
    });
    set("stop", close);
    return () => {
      ["play", "pause", "previoustrack", "nexttrack", "seekto", "stop"].forEach(
        (action) => {
          try {
            ms.setActionHandler(action, null);
          } catch {
            /* ignore */
          }
        }
      );
    };
  }, [playActive, pause, prev, next, seekTo, close]);

  const value = useMemo(
    () => ({
      current,
      queue,
      index,
      playing,
      loading,
      source,
      volume,
      muted,
      hasNext: index < queue.length - 1,
      hasPrev: index > 0,
      isCurrent,
      isPlaying,
      playFromList,
      toggleTrack,
      toggle,
      pause,
      next,
      prev,
      seekFraction,
      setVolume,
      toggleMute,
      close,
    }),
    [
      current,
      queue,
      index,
      playing,
      loading,
      source,
      volume,
      muted,
      isCurrent,
      isPlaying,
      playFromList,
      toggleTrack,
      toggle,
      pause,
      next,
      prev,
      seekFraction,
      setVolume,
      toggleMute,
      close,
    ]
  );

  return (
    <PlayerContext.Provider value={value}>
      {/* Hôte du player YouTube caché (iframe créée au premier besoin). */}
      <div ref={ytDivRef} style={{ position: "fixed", left: -9999, top: -9999 }} />
      {/* `children` est la même référence d'un rendu à l'autre : un changement
          de position ne re-rend donc QUE les abonnés à ce contexte-ci. */}
      <PlayerProgressContext.Provider value={progress}>
        {children}
      </PlayerProgressContext.Provider>
    </PlayerContext.Provider>
  );
}

export const usePlayer = () => useContext(PlayerContext);
// Position de lecture ({ current, duration }, en secondes). À n'appeler que là
// où on l'AFFICHE : s'y abonner coûte un rendu toutes les ~250 ms.
export const usePlayerProgress = () => useContext(PlayerProgressContext);
