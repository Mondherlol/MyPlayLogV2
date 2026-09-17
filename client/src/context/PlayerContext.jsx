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
import { useAuth } from "./AuthContext";

// Lecteur audio global de l'app, monté une fois (dans AppLayout), qui survit
// aux changements de page. Un seul moteur : l'iframe YouTube cachée. Elle
// démarre instantanément, mais les navigateurs mobiles la coupent dès que la
// page passe en arrière-plan (lecture en arrière-plan = YouTube Premium).

const PlayerContext = createContext(null);
// La position de lecture change 2 à 4 fois par SECONDE. Laissée dans le
// contexte principal, elle re-rendait tous ses abonnés au même rythme (fil
// d'actualité, grille d'OST d'une page jeu, widgets de l'accueil…) pour une
// info que seul le mini-lecteur affiche. Elle a donc son propre contexte : le
// reste de l'app ne re-rend plus que sur un vrai changement d'état (piste,
// play/pause, file).
const PlayerProgressContext = createContext({ current: 0, duration: 0 });

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
  // Le jeton ne sert qu'à savoir si quelqu'un est connecté : on ne précharge le
  // script YouTube que dans ce cas (voir plus bas).
  const { token } = useAuth();
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
  // Volume global (0..1) + sourdine, appliqués au lecteur. Persisté pour
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

  const ytRef = useRef(null);
  const ytDivRef = useRef(null);
  const ytPromiseRef = useRef(null);
  const loadedRef = useRef(null); // videoId actuellement chargé
  // Position de DÉPART de la prochaine piste chargée, en secondes. Sert à
  // l'écoute en groupe : celui qui se branche en cours de route doit tomber là
  // où en est l'hôte, pas au début du morceau (voir ListenPartyContext).
  const startAtRef = useRef(0);
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

  // Pousse volume/sourdine vers le lecteur. Il peut ne pas exister encore : on
  // le rappelle donc à sa création.
  const applyVolume = useCallback(() => {
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
      setLoading(true);
      ensureYT().then((p) => {
        // La piste a pu changer pendant le chargement de l'API iframe.
        const cur = queueRef.current[indexRef.current];
        if (!cur || cur.videoId !== videoId) return;
        try {
          p.loadVideoById({ videoId, startSeconds }); // autoplay
        } catch {
          /* ignore */
        }
      });
    },
    [ensureYT]
  );

  // ----------------------------------------------------------------------
  //  Préparer le terrain AVANT le clic — le geste ne se rattrape pas
  // ----------------------------------------------------------------------
  // C'EST LE BOGUE DU « PREMIER MORCEAU MUET » QUAND ON REJOINT UNE ÉCOUTE.
  //
  // L'iframe YouTube est d'un AUTRE DOMAINE : le navigateur ne l'autorise à
  // démarrer avec du son que si elle existait au moment où l'utilisateur a
  // cliqué (l'autorisation se propage aux cadres présents, elle n'est jamais
  // rétroactive). Or `ensureYT` la crée à la première lecture — c'est-à-dire
  // APRÈS le clic, une fois le script de l'API téléchargé. En lecture normale
  // ça passe inaperçu (on reclique, on relance) ; en écoute partagée, la piste
  // se chargeait et restait muette jusqu'au morceau suivant.
  //
  // On charge donc le SCRIPT tout de suite (au repos, ~50 ko), sans créer de
  // lecteur. Ainsi, quand le clic arrive, `ensureYT` fabrique l'iframe dans la
  // foulée immédiate du geste — donc avec son autorisation.
  //
  // AU REPOS ET SEULEMENT UNE FOIS CONNECTÉ : une page d'accueil visitée puis
  // quittée n'a aucune raison d'aller chercher un script chez YouTube.
  useEffect(() => {
    if (!token) return undefined;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
    const id = idle(() => {
      loadYT().catch(() => {
        /* hors ligne, ou YouTube bloqué : la lecture retentera d'elle-même */
      });
    });
    return () => window.cancelIdleCallback?.(id);
  }, [token]);

  // À appeler DANS un clic, avant toute navigation ou requête : elle réserve
  // le lecteur pendant que l'autorisation du geste est encore valable.
  // L'écoute en groupe s'en sert au moment où l'on rejoint quelqu'un.
  const prime = useCallback(() => {
    ensureYT();
  }, [ensureYT]);

  // Démontage : on détruit le lecteur YouTube.
  useEffect(
    () => () => {
      try {
        ytRef.current?.destroy();
      } catch {
        /* ignore */
      }
      ytRef.current = null;
      ytPromiseRef.current = null;
      // Vide ce que YT a laissé (iframe ou div restauré) dans le wrapper.
      if (ytDivRef.current) ytDivRef.current.innerHTML = "";
    },
    []
  );

  // Charge la piste courante quand elle change.
  useEffect(() => {
    if (!current) return;
    if (loadedRef.current === current.videoId) {
      // Relancée sur la piste DÉJÀ chargée : rien à charger, mais la position de
      // départ demandée doit être oubliée — sinon elle s'appliquerait au
      // morceau suivant, qui démarrerait mystérieusement en plein milieu.
      startAtRef.current = 0;
      return;
    }
    loadedRef.current = current.videoId;
    setLoading(true);
    const from = startAtRef.current;
    startAtRef.current = 0; // ne vaut que pour CE chargement
    setProgress({ current: from, duration: 0 });
    loadInYT(current.videoId, from);
  }, [current, loadInYT]);

  // Progression, relevée sur l'iframe (elle ne pousse rien d'elle-même).
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

  // Applique volume/sourdine dès qu'ils changent, et mémorise le volume.
  useEffect(() => {
    applyVolume();
    try {
      localStorage.setItem("mpl-volume", String(volume));
    } catch {
      /* ignore */
    }
  }, [volume, muted, applyVolume]);

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
  // meta.startAt (optionnel, secondes) : démarrer en cours de piste — l'écoute
  // en groupe s'en sert pour faire tomber l'arrivant là où en est l'hôte.
  const playFromList = useCallback(
    (track, list, meta = {}) => {
      const items = (Array.isArray(list) && list.length ? list : [track])
        .map((t) => toPlayable(t, meta))
        .filter(Boolean);
      if (!items.length) return;

      const target = toPlayable(track, meta);
      let start = target
        ? items.findIndex((t) => t.videoId === target.videoId)
        : 0;
      if (start < 0) start = 0;
      startAtRef.current = Math.max(0, Number(meta.startAt) || 0);
      setQueue(items);
      setIndex(start);
      setSource(meta.source || null);
      setProgress({ current: startAtRef.current, duration: 0 });
    },
    []
  );

  const playActive = useCallback(() => {
    try {
      ytRef.current?.playVideo?.();
    } catch {
      /* ignore */
    }
  }, []);

  // Met en pause la lecture courante (sans fermer la barre) — utilisé aussi
  // quand un autre lecteur local prend la main (ex. l'aperçu OST de la modale).
  const pause = useCallback(() => {
    try {
      ytRef.current?.pauseVideo?.();
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    try {
      if (playingRef.current) ytRef.current?.pauseVideo?.();
      else ytRef.current?.playVideo?.();
    } catch {
      /* ignore */
    }
  }, []);

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
    try {
      ytRef.current?.seekTo?.(Math.max(0, sec), true);
    } catch {
      /* ignore */
    }
  }, []);

  const prev = useCallback(() => {
    // Comme un vrai lecteur : > 3 s → on revient au début de la piste.
    let t = 0;
    try {
      t = ytRef.current?.getCurrentTime?.() || 0;
    } catch {
      /* ignore */
    }
    if (t > 3) {
      seekTo(0);
      return;
    }
    setIndex((i) => (i > 0 ? i - 1 : i));
  }, [seekTo]);

  const seekFraction = useCallback((f) => {
    const clamped = Math.max(0, Math.min(1, f));
    const p = ytRef.current;
    if (!p?.getDuration) return;
    try {
      p.seekTo(clamped * (p.getDuration() || 0), true);
    } catch {
      /* ignore */
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
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      } catch {
        /* ignore */
      }
    }
  }, []);

  // ======================================================================
  //  La file : ajouter, retirer, réordonner, vider
  // ======================================================================
  // JUSQU'ICI LA FILE ÉTAIT EN LECTURE SEULE : on la remplaçait entièrement en
  // lançant une playlist, et c'était tout. On ne pouvait ni sortir le morceau
  // qu'on ne voulait plus, ni remonter celui qu'on attendait — la seule issue
  // était de tout relancer autrement.
  //
  // TOUT PASSE PAR LES REFS, jamais par l'état : ces fonctions sont appelées
  // depuis des gestionnaires de clic qui, eux, ont capturé un `queue` d'il y a
  // trois rendus. Lire `queueRef.current` garantit qu'on modifie la file telle
  // qu'elle est à cet instant, pas telle qu'elle était à l'affichage.
  //
  // ET L'INDEX SUIT LA PISTE, pas sa position : `loadedRef` est indexé sur le
  // videoId, donc tant que la piste en cours reste la même, RIEN NE SE
  // RECHARGE. C'est ce qui permet de réordonner la file pendant l'écoute sans
  // que le morceau ne reparte à zéro.

  // Ajoute à la fin. Rend "added" | "duplicate" | "started" — l'appelant s'en
  // sert pour dire ce qui s'est passé (« déjà dans la file » est une réponse,
  // un bouton qui ne fait rien n'en est pas une).
  const enqueue = useCallback(
    (raw, meta = {}) => {
      const track = toPlayable(raw, meta);
      if (!track) return "invalid";
      const q = queueRef.current;
      // File vide = il n'y a rien à faire la queue : on lance.
      if (!q.length) {
        startAtRef.current = 0;
        setQueue([track]);
        setIndex(0);
        setSource(meta.source || null);
        setProgress({ current: 0, duration: 0 });
        return "started";
      }
      if (q.some((t) => t.videoId === track.videoId)) return "duplicate";
      setQueue([...q, track]);
      return "added";
    },
    []
  );

  // « Juste après celle-ci » — l'autre façon d'ajouter, et la seule qui compte
  // quand la file fait trente titres.
  const playNext = useCallback((raw, meta = {}) => {
    const track = toPlayable(raw, meta);
    if (!track) return "invalid";
    const q = queueRef.current;
    if (!q.length) return "empty";
    const k = indexRef.current;
    // On ne déduplique QU'EN AVAL. Un même morceau plus loin dans la file, c'est
    // le doublon qu'on veut éviter ; le même DÉJÀ ÉCOUTÉ ne gêne personne, et le
    // retirer ferait glisser l'index de la piste en cours pour rien.
    const cleaned = q.filter((t, i) => i <= k || t.videoId !== track.videoId);
    setQueue([...cleaned.slice(0, k + 1), track, ...cleaned.slice(k + 1)]);
    return "added";
  }, []);

  const removeAt = useCallback(
    (i) => {
      const q = queueRef.current;
      const k = indexRef.current;
      if (i < 0 || i >= q.length) return;
      const next = q.filter((_, j) => j !== i);
      if (!next.length) return close(); // la file vidée, c'est le lecteur fermé
      if (i < k) {
        setQueue(next);
        setIndex(k - 1);
        return;
      }
      if (i > k) {
        setQueue(next);
        return;
      }
      // ON RETIRE LA PISTE EN COURS. Si c'était la dernière, il n'y a rien
      // après : on ferme, plutôt que de repartir en arrière sur un morceau
      // qu'on venait d'écouter.
      if (k > next.length - 1) return close();
      setQueue(next);
      setIndex(k); // même index = la suivante prend sa place, et démarre
    },
    [close]
  );

  const moveTrack = useCallback((from, to) => {
    const q = [...queueRef.current];
    if (from === to || from < 0 || to < 0 || from >= q.length || to >= q.length) return;
    const current = q[indexRef.current];
    const [item] = q.splice(from, 1);
    q.splice(to, 0, item);
    setQueue(q);
    // On retrouve la piste en cours à sa NOUVELLE place : c'est ce qui évite le
    // rechargement (l'identité de l'objet n'a pas changé, son index si).
    const k = q.indexOf(current);
    if (k >= 0) setIndex(k);
  }, []);

  // Vider = ne garder que ce qui joue. Une file « vidée » qui couperait aussi
  // le son serait un bouton fermer déguisé, et celui-ci existe déjà.
  const clearQueue = useCallback(() => {
    const current = queueRef.current[indexRef.current];
    if (!current) return close();
    setQueue([current]);
    setIndex(0);
  }, [close]);

  // Remplace la file SANS toucher à la lecture. C'est l'écoute en groupe qui
  // s'en sert : l'invité doit voir la file de l'hôte évoluer (un morceau ajouté,
  // un autre retiré) alors même que la piste en cours, elle, ne bouge pas.
  const syncQueue = useCallback((list) => {
    const items = (list || []).map((t) => toPlayable(t)).filter(Boolean);
    if (!items.length) return;
    const current = queueRef.current[indexRef.current];
    if (!current) return;
    const k = items.findIndex((t) => t.videoId === current.videoId);
    // La piste en cours n'est plus dans la file reçue : on ne touche à rien.
    // Le prochain repère de l'hôte fera autorité, et d'ici là on continue à
    // écouter ce qu'on écoutait plutôt que de sauter dans le vide.
    if (k < 0) return;
    setQueue(items);
    setIndex(k);
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
      // `play` et `seekTo` ne servaient qu'en interne : l'écoute en groupe les
      // demande explicitement (« l'hôte a repris », « l'hôte a sauté à 2:14 »),
      // là où `toggle` ne dit qu'« inverse », ce qui désynchronise dès qu'un des
      // deux côtés s'est trompé d'un cran.
      play: playActive,
      seekTo,
      prime,
      // La file, modifiable : ajouter, retirer, réordonner, vider (voir plus
      // haut). `syncQueue` n'est pas pour l'interface — c'est l'écoute en
      // groupe qui recopie la file de l'hôte sans toucher à la lecture.
      enqueue,
      playNext,
      removeAt,
      moveTrack,
      clearQueue,
      syncQueue,
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
      playActive,
      seekTo,
      prime,
      enqueue,
      playNext,
      removeAt,
      moveTrack,
      clearQueue,
      syncQueue,
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
