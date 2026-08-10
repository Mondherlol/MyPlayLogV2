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
// CE QUE `span` CHANGE. Un extrait peut durer plus longtemps que ce qu'il a à
// raconter : la voix passée à la cathédrale (lib/clipFx.js) continue de résonner
// deux secondes et demie après le dernier mot. `span` (0..1) dit quelle fraction
// porte le propos, et il sert à deux choses :
//
//   1. L'AVANCEMENT s'y rapporte. Sinon la courbe se dessinerait à moitié
//      vitesse, puis resterait finie pendant que la queue sonne.
//   2. LA SÉQUENCE N'ATTEND PAS TOUTE LA QUEUE. Elle en laisse entendre `RING`,
//      puis passe au suivant. Ce n'est pas un raffinement : la révélation d'un
//      versus dure 18 secondes côté serveur (models/PerroquetVersus.js) et
//      enchaîne jusqu'à six imitations. À 2,5 s de résonance chacune, la phase
//      changeait avant qu'on ait entendu les meilleures — c'est-à-dire la fin du
//      jeu télévisé, ce pour quoi tout le monde est là.
//
// CE QUE `gapMs` CHANGE. Le blanc entre deux extraits n'est pas qu'une politesse
// de montage : dans la révélation à plusieurs, c'est LE temps de commenter la voix
// qu'on vient d'entendre. Enchaînées à 400 ms, les six imitations défilaient sans
// que personne puisse réagir — on regardait un carrousel au lieu de se moquer
// gentiment les uns des autres, qui est le but du mode. `waiting` dit qu'on est
// dans ce blanc, pour que l'écran l'assume au lieu d'avoir l'air en panne.
//
// Et comme un blanc de cinq secondes est parfois quatre de trop, `skipWait` le
// coupe : la pause est un CADEAU DE TEMPS, pas une attente imposée. C'est ce qui
// permet de la régler généreusement — quand elle traîne, on l'écourte d'un clic
// au lieu de subir un réglage choisi pour la table la plus bavarde.
//
// Un clic reprend toujours la main : la séquence automatique ne doit jamais
// empêcher de réécouter ce qu'on veut, quand on veut.

// Ce qu'on laisse entendre de la résonance avant d'enchaîner. Assez pour que la
// nef s'entende, assez peu pour que six imitations tiennent dans la phase.
const RING_SEC = 0.7;

export function useClipReel({ items, restartKey, gapMs = 420, onItem, enabled = true }) {
  const [current, setCurrent] = useState(null); // l'identifiant qui joue
  const [progress, setProgress] = useState(0);  // 0..1 dans l'extrait en cours
  // Vrai pendant le blanc entre deux extraits. Sur un `gapMs` de deux secondes —
  // la pause pour commenter la voix qu'on vient d'entendre — l'écran doit dire
  // qu'il attend exprès, sinon on croit que la lecture a planté.
  const [waiting, setWaiting] = useState(false);

  const audioRef = useRef(null);
  const rafRef = useRef(0);
  const timerRef = useRef(null);
  const spanRef = useRef(1); // la part « utile » de l'extrait en cours
  // La suite de la séquence, tenue à disposition pour pouvoir l'appeler d'un clic
  // (cf. `skipWait`). Elle vit dans la fermeture de l'effet ci-dessous, qui est le
  // seul endroit à connaître la position dans la file.
  const nextRef = useRef(null);
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
    const span = spanRef.current || 1;
    if (Number.isFinite(d) && d > 0) {
      setProgress(Math.min(1, a.currentTime / (d * span)));
      // La queue de réverbération : on en laisse passer un peu, puis on coupe et
      // on laisse la séquence continuer. `ended` est émis à la main plutôt que
      // simulé par un saut de `currentTime` — un saut relancerait le décodeur et
      // produirait un clic.
      if (span < 0.98 && a.currentTime >= d * span + RING_SEC) {
        a.pause();
        a.dispatchEvent(new Event("ended"));
        return;
      }
    }
    rafRef.current = requestAnimationFrame(track);
  }, []);

  // Couper court à la pause : on passe à la voix suivante tout de suite. Sans
  // effet si aucune pause n'est en cours — cliquer ne doit jamais interrompre une
  // voix qu'on est en train d'écouter.
  const skipWait = useCallback(() => {
    if (!waiting || !nextRef.current) return;
    clearTimeout(timerRef.current);
    setWaiting(false);
    nextRef.current();
  }, [waiting]);

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
    setWaiting(false);
  }, []);

  // Rejouer un extrait précis, à la demande.
  const play = useCallback(
    (id, url, span = 1) => {
      clearTimeout(timerRef.current);
      cancelAnimationFrame(rafRef.current);
      if (!url) return;
      spanRef.current = span || 1;
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
      setWaiting(false);
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
      setWaiting(false);
      spanRef.current = item.span || 1;
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
    //
    // Sauf après une queue de réverbération : elle vient DÉJÀ de séparer les deux
    // voix mieux qu'un blanc ne le ferait, et le blanc en plus coûte une demi-
    // seconde par joueur — sur six, de quoi faire déborder la phase.
    const onEnd = () => {
      setProgress(1);
      const rang = (spanRef.current || 1) < 0.98;
      // Après une queue de réverbération, on retire de la pause le temps que la
      // queue a déjà pris : elle sépare les voix, mais elle ne se DISCUTE pas —
      // on ne parle pas par-dessus. Le rythme reste donc le même d'une manche à
      // l'autre, avec ou sans effet.
      const wait = rang ? Math.max(300, gapMs - Math.round(RING_SEC * 1000)) : gapMs;
      setWaiting(wait > 400 && i < list.length);
      timerRef.current = setTimeout(next, wait);
    };
    a.addEventListener("ended", onEnd);
    nextRef.current = next;
    next();

    return () => {
      alive = false;
      nextRef.current = null;
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

  return { current, progress, waiting, play, stop, skipWait };
}
