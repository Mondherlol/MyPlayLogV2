import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useYouTubePlayer } from "./useYouTubePlayer";
import { useFilePlayer } from "./useFilePlayer";
import { useScrollLock } from "./useScrollLock";
import { episodeSources, sourcesInLang, PROVIDERS } from "../lib/collection";

// ======================================================================
//  Une séance — la mécanique commune aux deux lecteurs
// ======================================================================
// Le téléviseur cathodique a longtemps porté À LUI SEUL tout ce qu'il faut pour
// regarder un titre : choisir l'épisode, brancher la bonne source, basculer sur
// un miroir quand elle tombe, enregistrer la reprise, écouter le clavier. Le
// jour où le lecteur classique est arrivé, recopier tout ça aurait signifié le
// maintenir en double — et donc, tôt ou tard, deux comportements différents
// pour le même bouton.
//
// Cette mécanique vit donc ici, et les lecteurs ne sont plus que des VUES : un
// poste à tube, un grand cadre noir. Ils reçoivent une séance toute faite et se
// contentent de la présenter.
//
// ------------------------------------------------------ la séance partagée --
//
// Et c'est ici que se branchera la SÉANCE À DEUX (regarder en même temps qu'un
// ami, chacun chez soi). Tout geste qui change ce que l'on voit — lecture,
// pause, saut, changement d'épisode ou de source — passe par `command()` :
//
//   • `sync.emit(action)` part vers l'autre bout ;
//   • `sync.subscribe(fn)` ramène ce que l'autre a fait, rejoué par
//     `applyRemote` — SANS ré-émettre, sinon les deux navigateurs se
//     renverraient l'ordre à l'infini.
//
// Sans `sync`, `command()` est un passe-plat : la lecture solo ne paie rien
// pour cette porte laissée ouverte.

const SEEK_STEP = 10;
const OSD_MS = 1600;

// Le cadre d'un lecteur tiers reste BRIDÉ, toujours : pas de popup, pas de
// navigation de la page par-dessous. C'est ce qui empêche les pop-unders dont
// ces hébergeurs sont coutumiers.
//
// IL Y A EU UN BOUTON POUR LEVER CETTE BRIDE, et il est retiré. Il demandait au
// spectateur de comprendre ce qu'est un bac à sable pour deviner qu'il fallait
// l'ouvrir — un réglage de développeur posé au milieu d'un lecteur de films.
// Ce qu'il réparait vraiment tient en une ligne ci-dessous : `referrerPolicy`.
// La plupart des lecteurs qui « refusaient de démarrer » vérifiaient d'où
// venait la requête, pas s'ils pouvaient ouvrir une fenêtre. On envoie donc
// notre origine d'emblée, et il ne reste rien à débloquer.
//
// Un hébergeur qui refuse quand même a deux issues, toutes deux à portée de
// clic dans le sélecteur de source : en essayer un autre, ou l'ouvrir à part.
export const SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-presentation";

export function hostOfUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function useVideoSession({
  media,
  startIndex = 0,
  startAt = 0,
  onClose,
  onProgress,
  // La durée de l'ouverture et de la fermeture : une télé met une seconde à
  // chauffer et autant à s'éteindre ; le lecteur classique n'a rien à ouvrir du
  // tout et passe donc zéro.
  warmupMs = 1050,
  outroMs = 620,
  // Une poignée que le PARENT tient sur la fermeture du lecteur : c'est lui
  // qui écoute le bouton « retour » du téléphone, parce que ce bouton doit
  // fermer LA SÉANCE et non le lecteur courant — en changer en cours de route
  // ne doit pas lui faire perdre le fil.
  closeRef = null,
  // L'hébergeur retenu pour ce titre (réglage collectif, voir le modèle
  // `source.defaultHost`). Il décide de la source branchée à l'ouverture et à
  // chaque changement d'épisode.
  defaultHost = "",
  // LA PISTE QU'ON VEUT ENTENDRE (« vf », « vostfr »), choisie sur la fiche.
  // Un titre importé porte maintenant toutes ses versions, chaque adresse
  // étiquetée de la sienne : ce réglage ne change donc RIEN à la liste des
  // épisodes, il ne fait que réduire les sources de chacun. Vide = tout, ce qui
  // est le cas de tous les titres dont personne n'a étiqueté les adresses.
  lang = "",
  // La séance à deux, quand elle existera. Voir l'en-tête.
  sync = null,
  // LA LECTURE APPARTIENT-ELLE À CELUI QUI REGARDE ? Faux dans une séance
  // partagée où quelqu'un d'autre tient la télécommande : les gestes ne sont
  // alors pas seulement muets, ils sont REFUSÉS. Les laisser agir en local
  // mettrait l'invité en pause pendant que la salle continue — jusqu'à ce que le
  // rattrapage de dérive le remette de force, une seconde plus tard, sans qu'il
  // comprenne pourquoi. Mieux vaut ne rien faire et le dire.
  canCommand = true,
  // Démarrer tout seul. Vrai en lecture solo (on a cliqué sur « Regarder ») ;
  // dans une séance partagée, ça vaut ce que fait la salle à l'instant où l'on
  // entre — on ne se met pas à jouer dans une pièce en pause.
  //
  // À NE PAS RENDRE DYNAMIQUE : les lecteurs se recréent quand cette valeur
  // change (elle décide de la construction du YT.Player). L'appelant la fige au
  // montage.
  autoPlay = true,
} = {}) {
  // Mémorisé, et pas seulement par hygiène : sans ça, `episodes` est un tableau
  // neuf à chaque rendu, donc `episode` aussi, donc les sources sont recalculées
  // quatre fois par seconde (au rythme de l'horloge du lecteur) et le lecteur
  // d'un site tiers voyait sa clé changer sous lui.
  const episodes = useMemo(() => media.episodes || [], [media.episodes]);
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(startIndex, episodes.length - 1))
  );
  const episode = episodes[index] || null;

  // LA LISTE PEUT RÉTRÉCIR SOUS NOS PIEDS : un administrateur retire un
  // hébergeur mort en pleine séance, et les épisodes qui n'avaient que lui
  // disparaissent. Sans ce recalage, on resterait sur un index qui ne désigne
  // plus rien — écran noir, sans un mot.
  useEffect(() => {
    if (episodes.length && index >= episodes.length) setIndex(episodes.length - 1);
  }, [episodes.length, index]);

  const [phase, setPhase] = useState(warmupMs > 0 ? "warmup" : "on");
  const [osd, setOsd] = useState(null);
  const [showList, setShowList] = useState(false);
  const osdTimer = useRef(null);

  // --- Quel lecteur pour cet épisode ? --------------------------------------
  // Un épisode peut exister à plusieurs endroits (les MIROIRS) : `source` dit
  // lequel est branché.
  //
  // ON REPART DE L'HÉBERGEUR RETENU, à chaque épisode. C'est tout l'intérêt de
  // l'étoile : sur une série de vingt épisodes à quatre lecteurs, celui qui
  // marche est le même du début à la fin, et sans ça on rejouait la recherche
  // à chaque changement d'épisode. À défaut, la source de référence — la
  // première de la liste.
  //
  // LA PISTE PASSE AVANT L'HÉBERGEUR. Elles ne se contredisent pas : la langue
  // dit ce qu'on veut ENTENDRE, l'étoile chez QUI aller le chercher. On réduit
  // donc d'abord aux sources de la bonne piste, puis on cherche l'hébergeur
  // retenu là-dedans — l'inverse aurait rebranché la VF dès que l'étoile
  // pointait un hôte qui n'a que celle-là.
  const sources = useMemo(
    () => sourcesInLang(episodeSources(episode), lang),
    [episode, lang]
  );
  const preferredAt = useMemo(() => {
    if (!defaultHost) return 0;
    const at = sources.findIndex((s) => hostOfUrl(s.url) === defaultHost);
    return at >= 0 ? at : 0;
  }, [sources, defaultHost]);
  const [sourceAt, setSourceAt] = useState(preferredAt);
  useEffect(() => setSourceAt(preferredAt), [index, preferredAt]);
  const source = sources[sourceAt] || sources[0] || null;
  const provider = source?.provider || "youtube";
  const host = hostOfUrl(source?.url);
  // « Piloté » : on tient la lecture (position, pause, volume). Sinon on passe
  // en mode ANTENNE — l'image est là, mais les commandes appartiennent au
  // lecteur d'en face, et afficher les nôtres serait mentir.
  const piloted = !!PROVIDERS[provider]?.piloted;

  // --- La séance partagée ----------------------------------------------------
  const syncRef = useRef(sync);
  syncRef.current = sync;
  // Vrai le temps de rejouer un ordre venu de l'autre bout : c'est ce qui
  // empêche l'aller-retour infini entre deux navigateurs.
  const replaying = useRef(false);

  // Un geste refusé ne part pas et ne s'applique pas : `flash` remplace l'action
  // par son explication, à l'endroit exact où l'on vient d'appuyer.
  const commandRef = useRef(canCommand);
  commandRef.current = canCommand;
  const flashRef = useRef(null);

  const command = useCallback((action, run) => {
    if (!commandRef.current) {
      flashRef.current?.("L'HÔTE TIENT LA TÉLÉCOMMANDE");
      return;
    }
    run();
    if (!replaying.current) syncRef.current?.emit?.(action);
  }, []);

  // --- Les lecteurs ----------------------------------------------------------
  // Les deux sont montés à chaque rendu (règle des hooks) mais un seul reçoit
  // de quoi travailler : celui qui n'est pas branché dort, sans iframe ni
  // requête.
  const gotoRef = useRef(null);
  const yt = useYouTubePlayer({
    videoId: provider === "youtube" ? source?.videoId : null,
    autoPlay: autoPlay,
    startAt: index === startIndex ? startAt : 0,
    onEnded: () => gotoRef.current?.(index + 1, "auto"),
    // Pas de sous-titres automatiques en travers de l'image : ils ne sont pas
    // d'époque, et ils tombent pile là où l'image compte.
    captions: false,
  });
  const file = useFilePlayer({
    src: provider === "file" ? source?.url : null,
    autoPlay: autoPlay,
    startAt: index === startIndex ? startAt : 0,
    onEnded: () => gotoRef.current?.(index + 1, "auto"),
  });
  const player = provider === "file" ? file : yt;
  const {
    holderRef,
    videoRef,
    cur,
    duration,
    volume,
    muted,
    togglePlay: rawTogglePlay,
    seekTo: rawSeekTo,
    seekBy: rawSeekBy,
    setVol,
    toggleMute: rawToggleMute,
  } = player;
  // Un lecteur qu'on ne pilote pas ne dit jamais s'il joue : on le suppose en
  // marche, sinon on afficherait « PAUSE » sur une image qui tourne.
  const isPlaying = piloted ? player.isPlaying : true;

  useScrollLock(true);

  // --- Affichage à l'écran (OSD), comme sur un vrai poste ---
  const flash = useCallback((text, bars = null) => {
    setOsd({ text, bars, id: Date.now() });
    clearTimeout(osdTimer.current);
    osdTimer.current = setTimeout(() => setOsd(null), OSD_MS);
  }, []);
  // `command` est déclaré plus haut (les lecteurs en dépendent) et doit pouvoir
  // afficher un refus : il passe par cette poignée plutôt que par une dépendance
  // circulaire entre les deux.
  flashRef.current = flash;
  useEffect(() => () => clearTimeout(osdTimer.current), []);

  // --- Ouverture du décor : chauffe du tube, écartement du rideau… -----------
  useEffect(() => {
    if (warmupMs <= 0) return undefined;
    const t = setTimeout(() => setPhase("on"), warmupMs);
    return () => clearTimeout(t);
  }, [warmupMs]);

  // --- Sauvegarde de la progression -----------------------------------------
  // Ce qui est courant est lu en ref : l'effet ne doit pas se relancer à chaque
  // tick d'horloge du lecteur.
  const liveRef = useRef(null);
  liveRef.current = { index, cur, duration, piloted };

  // Toutes les 15 s pendant la lecture, et à chaque changement d'épisode ou
  // fermeture : on ne veut ni marteler l'API ni perdre la reprise. Sur un
  // lecteur qu'on ne pilote pas, il n'y a pas de position à écrire — seul
  // l'épisode en cours est mémorisé, à la fermeture.
  useEffect(() => {
    if (!isPlaying || !piloted) return undefined;
    const id = setInterval(() => {
      const { index: i, cur: c, duration: d } = liveRef.current;
      if (c > 0) onProgress?.({ episodeIndex: i, positionSeconds: c, durationSeconds: d });
    }, 15000);
    return () => clearInterval(id);
  }, [isPlaying, piloted, onProgress]);

  useEffect(
    () => () => {
      const { index: i, cur: c, duration: d, piloted: p } = liveRef.current;
      // Piloté : on retient la seconde exacte, et seulement si l'on a vraiment
      // commencé. Sinon : on retient au moins QUEL épisode était à l'écran,
      // pour que « Reprendre » y revienne.
      if (p && c <= 5) return;
      onProgress?.({
        episodeIndex: i,
        positionSeconds: p ? c : 0,
        durationSeconds: p ? d : 0,
      });
    },
    [onProgress]
  );

  // --- Commandes -------------------------------------------------------------

  const goto = useCallback(
    (next, reason) => {
      if (next < 0 || next >= episodes.length) {
        flash(next < 0 ? "DÉBUT DE BANDE" : "FIN DE BANDE");
        return;
      }
      const { index: from, cur: c, duration: d, piloted: p } = liveRef.current;
      // L'épisode qu'on quitte est enregistré avant de changer de bande. Arrivé
      // au générique de fin (reason « auto »), il compte comme vu.
      onProgress?.({
        episodeIndex: from,
        positionSeconds: p && reason === "auto" ? d : p ? c : 0,
        durationSeconds: p ? d : 0,
        watched: reason === "auto" || undefined,
      });
      command({ type: "episode", index: next }, () => setIndex(next));
      const ep = episodes[next];
      flash(`CH ${String(ep?.number ?? next + 1).padStart(2, "0")} — ${ep?.title || ""}`);
    },
    [episodes, flash, onProgress, command]
  );
  gotoRef.current = goto;

  // Le lecteur d'un tiers ne nous dira jamais qu'il est arrivé au bout : la
  // seule façon honnête de cocher un épisode, c'est de le demander.
  const markWatched = useCallback(() => {
    onProgress?.({
      episodeIndex: liveRef.current.index,
      positionSeconds: 0,
      durationSeconds: 0,
      watched: true,
    });
    flash("ÉPISODE MARQUÉ VU");
  }, [flash, onProgress]);

  // Le même épisode, chez un autre hébergeur. C'est le geste qui sauve la
  // soirée quand une source tombe.
  const nextSource = useCallback(() => {
    if (sources.length < 2) return;
    const at = (sourceAt + 1) % sources.length;
    command({ type: "source", at }, () => setSourceAt(at));
    flash(`SOURCE ${at + 1}/${sources.length} — ${sources[at].label.toUpperCase()}`);
  }, [sources, sourceAt, flash, command]);

  // Une source DÉSIGNÉE, depuis la liste : on ne fait plus tourner à l'aveugle
  // quand on sait déjà chez qui on veut aller.
  const pickSource = useCallback(
    (at) => {
      if (at < 0 || at >= sources.length || at === sourceAt) return;
      command({ type: "source", at }, () => setSourceAt(at));
      flash(sources[at].label.toUpperCase());
    },
    [sources, sourceAt, flash, command]
  );

  const togglePlay = useCallback(() => {
    command(
      { type: "toggle", at: liveRef.current.cur },
      () => rawTogglePlay()
    );
  }, [command, rawTogglePlay]);

  const seekTo = useCallback(
    (t) => command({ type: "seek", at: t }, () => rawSeekTo(t)),
    [command, rawSeekTo]
  );

  const seekBy = useCallback(
    (d) =>
      command({ type: "seek", at: Math.max(0, liveRef.current.cur + d) }, () =>
        rawSeekBy(d)
      ),
    [command, rawSeekBy]
  );

  // Le son ne se partage PAS : c'est un réglage de fauteuil, pas de séance.
  // Chacun met le volume qu'il veut chez lui — d'où l'absence de `command()`.
  const changeVolume = useCallback(
    (v) => {
      setVol(v);
      flash(`VOLUME ${Math.round(v * 100)}`, v);
    },
    [setVol, flash]
  );

  const toggleMute = useCallback(() => {
    rawToggleMute();
    flash(muted ? "SON" : "COUPÉ");
  }, [rawToggleMute, muted, flash]);

  // La fermeture laisse le lecteur se refermer avant de démonter (l'effet de
  // démontage enregistre la position au passage).
  const closingRef = useRef(false);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setPhase("off");
    setTimeout(() => onClose?.(), outroMs);
  }, [onClose, outroMs]);

  useEffect(() => {
    if (!closeRef) return undefined;
    closeRef.current = close;
    return () => {
      // Un lecteur qui s'en va ne reprend pas la poignée à celui qui arrive :
      // pendant un changement de décor, la nouvelle a déjà posé la sienne.
      if (closeRef.current === close) closeRef.current = null;
    };
  }, [closeRef, close]);

  // --- Ce qui revient de l'autre bout ---------------------------------------
  // Rejoué tel quel, sans repartir : `replaying` coupe l'émission le temps de
  // l'appliquer.
  const applyRemote = useCallback(
    (action) => {
      replaying.current = true;
      try {
        switch (action?.type) {
          case "episode":
            setIndex(action.index);
            break;
          case "source":
            setSourceAt(action.at);
            break;
          case "seek":
            rawSeekTo(action.at);
            break;
          case "toggle":
            rawTogglePlay();
            break;
          default:
            break;
        }
      } finally {
        replaying.current = false;
      }
    },
    [rawSeekTo, rawTogglePlay]
  );
  const applyRef = useRef(applyRemote);
  applyRef.current = applyRemote;

  useEffect(() => {
    if (!sync?.subscribe) return undefined;
    return sync.subscribe((action) => applyRef.current(action));
  }, [sync]);

  // --- Clavier : les mêmes gestes que sur les autres lecteurs de l'app ---
  // Volontairement SANS tableau de dépendances : l'écouteur doit voir l'épisode
  // courant, le volume courant et la position courante. Les lister tous
  // reviendrait à réinscrire l'écouteur à chaque tick d'horloge de toute façon.
  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) return;
      if (document.activeElement?.isContentEditable) return;
      const k = e.key;
      // En mode antenne, les touches de lecture ne sont pas à nous : elles
      // doivent filer au lecteur du site, qui a les siennes.
      if (k === "Escape") close();
      else if (k === "PageUp" || k === "]") goto(index + 1);
      else if (k === "PageDown" || k === "[") goto(index - 1);
      else if (!piloted) return;
      else if (k === " " || k === "k") togglePlay();
      else if (k === "ArrowLeft") seekBy(-SEEK_STEP);
      else if (k === "ArrowRight") seekBy(SEEK_STEP);
      else if (k === "ArrowUp") changeVolume(Math.min(1, (muted ? 0 : volume) + 0.1));
      else if (k === "ArrowDown") changeVolume(Math.max(0, (muted ? 0 : volume) - 0.1));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const isSeries = media.kind === "series" && episodes.length > 1;

  return {
    // ce qu'on regarde
    media,
    episodes,
    episode,
    index,
    isSeries,
    channel: String(episode?.number ?? index + 1).padStart(2, "0"),

    // le lecteur branché
    source,
    sources,
    sourceAt,
    provider,
    piloted,
    host,
    holderRef,
    videoRef,

    // l'état de lecture
    phase,
    isPlaying,
    cur,
    duration,
    pct: duration ? (cur / duration) * 100 : 0,
    volume,
    muted,
    osd,
    showList,
    setShowList,

    // les gestes
    seekStep: SEEK_STEP,
    goto,
    togglePlay,
    seekTo,
    seekBy,
    changeVolume,
    toggleMute,
    nextSource,
    pickSource,
    markWatched,
    flash,
    close,

    // la séance partagée : de quoi piloter le lecteur depuis l'extérieur
    applyRemote,
  };
}
