import { useCallback, useEffect, useRef, useState } from "react";
import { loadYT } from "../lib/youtube";

// ======================================================================
//  Cycle de vie d'un lecteur YouTube, sans habillage
// ======================================================================
// Tout ce qui est commun à nos lecteurs maison : créer le YT.Player, suivre
// sa position, régler le son, le détruire proprement. L'HABILLAGE reste à
// l'appelant — la barre dorée de GameVideoPlayer (components/YouTubePlayer)
// ou les boutons du téléviseur cathodique de la Collection (CrtTv), qui
// n'affiche AUCUN contrôle à l'écran puisqu'ils sont sur la carrosserie.
//
// Piège respecté (le même que partout ailleurs dans l'app) : YT.Player n'est
// jamais monté sur un nœud rendu par React — YouTube REMPLACE le nœud qu'on
// lui donne par son iframe, et React, ne le retrouvant pas au démontage,
// plante toute la page. On crée donc un enfant DOM à la main dans un
// conteneur stable, et on vide ce conteneur nous-mêmes.

// Coupe les sous-titres. `cc_load_policy: 0` ne suffit pas : ce réglage veut
// dire « suis la préférence du spectateur », et beaucoup de comptes YouTube ont
// les sous-titres automatiques activés par défaut — ils s'affichent alors sur
// l'image sans qu'on l'ait demandé. Seul le déchargement du module les tait
// vraiment. Il est rejoué après le démarrage de la lecture, car le module peut
// se charger APRÈS l'évènement « prêt ».
function killCaptions(player) {
  try {
    player?.unloadModule?.("captions"); // ancien nom
    player?.unloadModule?.("cc"); // nom actuel
  } catch {
    /* le lecteur n'expose pas les modules : rien à couper */
  }
}

export function useYouTubePlayer({
  videoId,
  autoPlay = true,
  onEnded,
  startAt = 0,
  captions = true,
} = {}) {
  const holderRef = useRef(null);
  const playerRef = useRef(null);
  // Gardés en ref : le lecteur est créé une fois par vidéo, il ne doit pas
  // être recréé parce qu'un rappel a changé d'identité entre deux rendus.
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const startRef = useRef(startAt);
  startRef.current = startAt;

  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    let destroyed = false;
    let fallback = null;
    const holder = holderRef.current;
    if (!holder || !videoId) return;

    setReady(false);
    setCur(0);
    setDuration(0);
    const mount = document.createElement("div");
    holder.appendChild(mount);

    loadYT().then((YT) => {
      if (destroyed) return;
      playerRef.current = new YT.Player(mount, {
        videoId,
        playerVars: {
          autoplay: autoPlay ? 1 : 0,
          controls: 0,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
          disablekb: 1,
          modestbranding: 1,
          fs: 0,
          start: Math.floor(startRef.current) || 0,
          // Absent = on suit la préférence du spectateur ; 1 les FORCERAIT.
          ...(captions ? null : { cc_load_policy: 0 }),
        },
        events: {
          onReady: (e) => {
            if (destroyed) return;
            setReady(true);
            setDuration(e.target.getDuration?.() || 0);
            e.target.setVolume?.(100);
            if (!captions) killCaptions(e.target);
            if (autoPlay) {
              e.target.playVideo?.();
              // Autoplay sonore refusé par le navigateur ? On repart en muet,
              // le bouton son rend la main d'un clic.
              fallback = setTimeout(() => {
                try {
                  if (playerRef.current?.getPlayerState?.() !== 1) {
                    playerRef.current?.mute?.();
                    playerRef.current?.playVideo?.();
                    setMuted(true);
                  }
                } catch {
                  /* ignore */
                }
              }, 1400);
            }
          },
          onStateChange: (e) => {
            if (destroyed) return;
            setIsPlaying(e.data === 1);
            if (e.data === 1) {
              setDuration(e.target.getDuration?.() || 0);
              // Le module de sous-titres arrive souvent après « prêt ».
              if (!captions) killCaptions(e.target);
            }
            if (e.data === 0) endedRef.current?.();
          },
        },
      });
    });

    return () => {
      destroyed = true;
      clearTimeout(fallback);
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      // Le nœud a été remplacé par l'iframe : on vide le conteneur à la main.
      while (holder.firstChild) holder.removeChild(holder.firstChild);
    };
  }, [videoId, autoPlay, captions]);

  // Progression : YouTube n'émet pas d'évènement de temps, on l'interroge.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      try {
        setCur(p.getCurrentTime() || 0);
        setLoaded((p.getVideoLoadedFraction?.() || 0) * (p.getDuration?.() || 0));
      } catch {
        /* le lecteur est en train de mourir */
      }
    }, 250);
    return () => clearInterval(id);
  }, [ready]);

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.getPlayerState?.() === 1) p.pauseVideo?.();
    else p.playVideo?.();
  }, []);

  const seekTo = useCallback((seconds) => {
    const p = playerRef.current;
    if (!p?.seekTo) return;
    const next = Math.max(0, Math.min(seconds, p.getDuration?.() || 0));
    p.seekTo(next, true);
    setCur(next);
  }, []);

  const seekBy = useCallback(
    (delta) => {
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      seekTo(p.getCurrentTime() + delta);
    },
    [seekTo]
  );

  const setVol = useCallback((val) => {
    const p = playerRef.current;
    const next = Math.min(1, Math.max(0, val));
    setVolume(next);
    setMuted(next === 0);
    if (p) {
      p.setVolume?.(Math.round(next * 100));
      if (next === 0) p.mute?.();
      else p.unMute?.();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const p = playerRef.current;
    const next = !muted;
    setMuted(next);
    if (next) p?.mute?.();
    else p?.unMute?.();
    // Sortir du muet avec un volume à zéro ne rendrait rien d'audible.
    if (!next && volume === 0) setVol(0.6);
  }, [muted, volume, setVol]);

  return {
    holderRef,
    playerRef,
    ready,
    isPlaying,
    cur,
    duration,
    loaded,
    volume,
    muted,
    togglePlay,
    seekTo,
    seekBy,
    setVol,
    toggleMute,
  };
}
