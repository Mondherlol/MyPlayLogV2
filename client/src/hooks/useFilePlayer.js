import { useCallback, useEffect, useRef, useState } from "react";

// ======================================================================
//  Cycle de vie d'une vidéo servie en direct (mp4, webm, m3u8 natif)
// ======================================================================
// Le pendant de useYouTubePlayer pour une balise <video>, et surtout LA MÊME
// INTERFACE : le téléviseur cathodique branche l'un ou l'autre sans rien savoir
// de la différence. Tout ce qui n'a pas d'équivalent (la fraction chargée, par
// exemple) est renvoyé quand même, à zéro.
//
// Ici on tient vraiment la lecture : position, pause, volume, saut. C'est le
// seul autre lecteur, avec YouTube, où la reprise à la seconde près a un sens.

export function useFilePlayer({ src, autoPlay = true, startAt = 0, onEnded } = {}) {
  const videoRef = useRef(null);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  // Le point de reprise est lu au moment où la vidéo devient lisible, pas au
  // rendu : le poser avant que les métadonnées soient là ne fait rien du tout.
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
    const v = videoRef.current;
    if (!v || !src) return undefined;

    setReady(false);
    setCur(0);
    setDuration(0);

    const onLoaded = () => {
      setReady(true);
      setDuration(v.duration || 0);
      if (startRef.current > 0 && startRef.current < (v.duration || Infinity)) {
        v.currentTime = startRef.current;
      }
      if (autoPlay) {
        // Autoplay sonore refusé par le navigateur : on repart en muet, le
        // bouton son rend la main d'un clic — même politique que YouTube.
        v.play().catch(() => {
          v.muted = true;
          setMuted(true);
          v.play().catch(() => {});
        });
      }
    };
    const onTime = () => setCur(v.currentTime || 0);
    const onProgress = () => {
      try {
        if (v.buffered.length) setLoaded(v.buffered.end(v.buffered.length - 1));
      } catch {
        /* buffered peut lever si la vidéo n'est pas encore prête */
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnd = () => {
      setIsPlaying(false);
      endedRef.current?.();
    };

    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("progress", onProgress);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnd);
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("progress", onProgress);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnd);
      // Coupe le téléchargement en cours : sans ça, changer d'épisode laisse
      // le flux précédent se charger dans le vide.
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
  }, [src, autoPlay]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const seekTo = useCallback((seconds) => {
    const v = videoRef.current;
    if (!v) return;
    const next = Math.max(0, Math.min(seconds, v.duration || 0));
    v.currentTime = next;
    setCur(next);
  }, []);

  const seekBy = useCallback(
    (delta) => {
      const v = videoRef.current;
      if (v) seekTo((v.currentTime || 0) + delta);
    },
    [seekTo]
  );

  const setVol = useCallback((val) => {
    const v = videoRef.current;
    const next = Math.min(1, Math.max(0, val));
    setVolume(next);
    setMuted(next === 0);
    if (v) {
      v.volume = next;
      v.muted = next === 0;
    }
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    const next = !muted;
    setMuted(next);
    if (v) v.muted = next;
    if (!next && volume === 0) setVol(0.6);
  }, [muted, volume, setVol]);

  return {
    videoRef,
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

export default useFilePlayer;
