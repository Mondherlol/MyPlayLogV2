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

// Lecteur audio global de l'app : un seul player YouTube caché, monté une fois
// (dans AppLayout), qui survit aux changements de page. Les onglets OST (jeu,
// profil, aperçu) poussent une piste + une file ; le mini-lecteur flottant lit
// cet état. Enchaînement automatique de la file en fin de piste.

const PlayerContext = createContext(null);

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

  const ytRef = useRef(null);
  const ytDivRef = useRef(null);
  const readyRef = useRef(false);
  const loadedRef = useRef(null); // videoId actuellement chargé dans le player
  const queueRef = useRef(queue);
  const indexRef = useRef(index);

  queueRef.current = queue;
  indexRef.current = index;

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

  // --- Player YouTube caché (une seule instance) ---
  useEffect(() => {
    let destroyed = false;
    loadYT().then((YT) => {
      if (destroyed || !ytDivRef.current) return;
      // YT.Player REMPLACE le nœud fourni par une iframe. On lui donne donc un
      // div créé à la main (jamais un nœud rendu par React) : sinon, au
      // démontage (ex. déconnexion), React tente de retirer son div disparu →
      // NotFoundError removeChild → tout l'arbre React tombe (page blanche).
      const host = document.createElement("div");
      ytDivRef.current.appendChild(host);
      ytRef.current = new YT.Player(host, {
        height: "0",
        width: "0",
        playerVars: { autoplay: 0, playsinline: 1 },
        events: {
          onReady: () => {
            readyRef.current = true;
            // Si une piste a été demandée avant que le player soit prêt.
            const cur = queueRef.current[indexRef.current];
            if (cur && loadedRef.current !== cur.videoId) {
              loadedRef.current = cur.videoId;
              setLoading(true);
              ytRef.current.loadVideoById(cur.videoId);
            }
          },
          onStateChange: (e) => {
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
    });
    return () => {
      destroyed = true;
      try {
        ytRef.current?.destroy();
      } catch {
        /* ignore */
      }
      ytRef.current = null;
      readyRef.current = false;
      // Vide ce que YT a laissé (iframe ou div restauré) dans le wrapper.
      if (ytDivRef.current) ytDivRef.current.innerHTML = "";
    };
  }, []);

  // Charge la piste courante dans le player quand elle change.
  useEffect(() => {
    if (!readyRef.current || !current) return;
    if (loadedRef.current === current.videoId) return;
    loadedRef.current = current.videoId;
    setLoading(true);
    try {
      ytRef.current?.loadVideoById(current.videoId); // autoplay
    } catch {
      /* ignore */
    }
  }, [current]);

  // Polling de la progression pendant la lecture.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
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
  const playFromList = useCallback((track, list, meta = {}) => {
    const items = (Array.isArray(list) && list.length ? list : [track])
      .map((t) => toPlayable(t, meta))
      .filter(Boolean);
    if (!items.length) return;
    const target = toPlayable(track, meta);
    let start = target ? items.findIndex((t) => t.videoId === target.videoId) : 0;
    if (start < 0) start = 0;
    setQueue(items);
    setIndex(start);
    setSource(meta.source || null);
    setProgress({ current: 0, duration: 0 });
  }, []);

  const toggle = useCallback(() => {
    const p = ytRef.current;
    if (!p) return;
    try {
      if (playing) p.pauseVideo();
      else p.playVideo();
    } catch {
      /* ignore */
    }
  }, [playing]);

  // Met en pause la lecture courante (sans fermer la barre) — utilisé quand un
  // autre lecteur local prend la main (ex. l'aperçu OST de la modale).
  const pause = useCallback(() => {
    if (!playing) return;
    try {
      ytRef.current?.pauseVideo?.();
    } catch {
      /* ignore */
    }
  }, [playing]);

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

  const prev = useCallback(() => {
    // Comme un vrai lecteur : > 3 s → on revient au début de la piste.
    const p = ytRef.current;
    let t = 0;
    try {
      t = p?.getCurrentTime?.() || 0;
    } catch {
      /* ignore */
    }
    if (t > 3) {
      try {
        p.seekTo(0, true);
      } catch {
        /* ignore */
      }
      return;
    }
    setIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  const seekFraction = useCallback((f) => {
    const p = ytRef.current;
    if (!p?.getDuration) return;
    try {
      const d = p.getDuration() || 0;
      p.seekTo(Math.max(0, Math.min(1, f)) * d, true);
    } catch {
      /* ignore */
    }
  }, []);

  const close = useCallback(() => {
    try {
      ytRef.current?.stopVideo?.();
    } catch {
      /* ignore */
    }
    loadedRef.current = null;
    setQueue([]);
    setIndex(0);
    setPlaying(false);
    setLoading(false);
    setSource(null);
    setProgress({ current: 0, duration: 0 });
  }, []);

  const value = useMemo(
    () => ({
      current,
      queue,
      index,
      playing,
      loading,
      progress,
      source,
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
      close,
    }),
    [
      current,
      queue,
      index,
      playing,
      loading,
      progress,
      source,
      isCurrent,
      isPlaying,
      playFromList,
      toggleTrack,
      toggle,
      pause,
      next,
      prev,
      seekFraction,
      close,
    ]
  );

  return (
    <PlayerContext.Provider value={value}>
      {/* Player YouTube caché, unique pour toute l'app. */}
      <div ref={ytDivRef} style={{ position: "fixed", left: -9999, top: -9999 }} />
      {children}
    </PlayerContext.Provider>
  );
}

export const usePlayer = () => useContext(PlayerContext);
