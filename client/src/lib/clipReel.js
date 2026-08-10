import { useCallback, useEffect, useRef, useState } from "react";

// ======================================================================
//  La bande-son d'une révélation
// ======================================================================
// Enchaîne des extraits TOUT SEUL, un à la fois, et publie l'avancement de
// celui qui joue. Deux écrans s'en servent — le résultat du solo (l'original
// puis sa propre tentative) et la révélation du versus (l'original puis les six
// imitations, du pire au meilleur) — et ils faisaient la même chose chacun de
// leur côté, à un détail près : le solo n'enchaînait rien du tout.
//
// CE QUE LE `progress` CHANGE. C'est lui qui permet à la courbe de se dessiner
// au rythme du son (cf. components/ContourChart.jsx). Sans lui on entend un cri
// pendant qu'un graphique fini reste immobile à côté, et rien ne relie les deux.
//
// Un clic reprend toujours la main : la séquence automatique ne doit jamais
// empêcher de réécouter ce qu'on veut, quand on veut.
export function useClipReel({ items, restartKey, gapMs = 420, onItem, enabled = true }) {
  const [current, setCurrent] = useState(null); // l'identifiant qui joue
  const [progress, setProgress] = useState(0);  // 0..1 dans l'extrait en cours

  const audioRef = useRef(null);
  const rafRef = useRef(0);
  const timerRef = useRef(null);
  const itemsRef = useRef(items);
  const onItemRef = useRef(onItem);
  itemsRef.current = items;
  onItemRef.current = onItem;

  const track = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    // `duration` vaut NaN tant que les métadonnées ne sont pas là, et Infinity
    // sur certains webm produits par MediaRecorder : dans les deux cas on
    // n'affiche pas d'avancement plutôt qu'un chiffre faux.
    const d = a.duration;
    if (Number.isFinite(d) && d > 0) setProgress(Math.min(1, a.currentTime / d));
    rafRef.current = requestAnimationFrame(track);
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    clearTimeout(timerRef.current);
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.onended = null;
    }
    setCurrent(null);
    setProgress(0);
  }, []);

  // Rejouer un extrait précis, à la demande.
  const play = useCallback(
    (id, url) => {
      clearTimeout(timerRef.current);
      cancelAnimationFrame(rafRef.current);
      if (!url) return;
      let a = audioRef.current;
      if (!a) {
        a = new Audio();
        audioRef.current = a;
      }
      a.onended = null;
      a.src = url;
      a.currentTime = 0;
      setCurrent(id);
      setProgress(0);
      onItemRef.current?.(id);
      a.play().catch(() => {});
      rafRef.current = requestAnimationFrame(track);
    },
    [track]
  );

  // La séquence : relancée à chaque `restartKey`, c'est-à-dire à chaque manche.
  useEffect(() => {
    if (!enabled) return undefined;
    const list = itemsRef.current || [];
    if (!list.length) return undefined;

    let alive = true;
    let i = 0;
    const a = audioRef.current || new Audio();
    audioRef.current = a;

    const next = () => {
      if (!alive) return;
      if (i >= list.length) {
        cancelAnimationFrame(rafRef.current);
        setCurrent(null);
        return;
      }
      const item = list[i];
      i += 1;
      if (!item?.url) {
        next();
        return;
      }
      setCurrent(item.id);
      setProgress(0);
      onItemRef.current?.(item.id);
      a.src = item.url;
      a.currentTime = 0;
      a.play().catch(() => {
        // Lecture refusée (onglet en arrière-plan, politique d'autoplay) : on
        // n'insiste pas et on passe au suivant, sinon la séquence se bloque net.
        timerRef.current = setTimeout(next, 300);
      });
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(track);
    };

    // Un silence entre deux extraits : collés, on ne sait plus où finit l'un et
    // où commence l'autre — et c'est précisément la comparaison qu'on veut.
    const onEnd = () => {
      setProgress(1);
      timerRef.current = setTimeout(next, gapMs);
    };
    a.addEventListener("ended", onEnd);
    next();

    return () => {
      alive = false;
      clearTimeout(timerRef.current);
      cancelAnimationFrame(rafRef.current);
      a.removeEventListener("ended", onEnd);
      a.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restartKey, enabled, gapMs, track]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(timerRef.current);
      audioRef.current?.pause();
      audioRef.current = null;
    },
    []
  );

  return { current, progress, play, stop };
}
