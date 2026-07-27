import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Power,
  Volume2,
  VolumeX,
  Ratio,
  ListVideo,
  Check,
  Antenna,
  ExternalLink,
  Lock,
  LockOpen,
} from "lucide-react";
import { useYouTubePlayer } from "../hooks/useYouTubePlayer";
import { useFilePlayer } from "../hooks/useFilePlayer";
import { useScrollLock } from "../hooks/useScrollLock";
import { useBackClose } from "../hooks/useBackClose";
import { fmtClock, episodeSources, PROVIDERS } from "../lib/collection";
import { playClackSound, playTubeSound } from "../lib/sfx";

// ======================================================================
//  Le téléviseur cathodique de la Collection
// ======================================================================
// PARTI PRIS : on ne regarde pas une vidéo dans un cadre, on allume une télé.
// L'écran ne porte donc AUCUN bouton — tout est sur la carrosserie, comme sur
// un vrai poste : la molette de canal change d'épisode, le potard règle le
// volume, le gros interrupteur éteint (et referme) le poste.
//
// L'habillage YouTube (titre, « partager », suggestions de fin) est mis hors
// champ par la même astuce que le lecteur de bandes-annonces : l'iframe est
// rendue plus haute que son cadre et les bandeaux tombent dans les bandes
// rognées. Ses propres contrôles sont désactivés (controls: 0) : ce sont les
// nôtres, sur le plastique, qui commandent — via useYouTubePlayer.
//
// TROIS LECTEURS, UN SEUL POSTE. YouTube et les fichiers vidéo se PILOTENT
// (position, pause, volume) : le poste garde alors toutes ses commandes. Le
// lecteur d'un site tiers, lui, est une boîte noire dans une iframe — on ne
// sait ni où en est la lecture ni quand elle finit. Plutôt que d'afficher des
// boutons qui ne feraient rien et une barre de progression qui mentirait, le
// poste passe en mode ANTENNE : l'image est au tiers, les commandes de lecture
// s'effacent, et il reste ce qui a du sens — changer de chaîne (d'épisode),
// changer de SOURCE (le même épisode chez un autre hébergeur) et cocher
// l'épisode comme vu à la main.
//
// Le tube est en 4/3, comme il se doit. Le bouton FORMAT fait ce que faisaient
// les télés de l'époque : « PLEIN » remplit le 4/3 (idéal pour un épisode
// d'origine 4/3 mis en ligne dans une vidéo 16/9, dont il mange les bandes
// noires latérales), « LARGE » laisse l'image 16/9 entière avec ses bandes.

const CROP = 62; // bandes rognées en haut et en bas de l'iframe (px)
const SEEK_STEP = 10;
const OSD_MS = 1600;

// Le cadre d'un lecteur tiers est BRIDÉ par défaut : pas de popup, pas de
// navigation de la page par-dessous. C'est ce qui empêche les pop-unders dont
// ces hébergeurs sont coutumiers.
//
// Mais certains lecteurs testent justement s'ils peuvent ouvrir une fenêtre, et
// refusent de démarrer quand ils n'y arrivent pas (« Sandboxed our player is
// not allowed »). On garde donc la bride par défaut, et on la lève À LA MAIN,
// hébergeur par hébergeur — le choix est mémorisé pour ne pas avoir à le
// refaire à chaque épisode.
const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-presentation";
const FREE_KEY = "mpl_coll_free_hosts";

function readFreeHosts() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FREE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function hostOfUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export default function CrtTv({ media, startIndex = 0, startAt = 0, onClose, onProgress }) {
  const episodes = media.episodes || [];
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(startIndex, episodes.length - 1))
  );
  const episode = episodes[index] || null;

  // « plein » : l'image remplit le tube 4/3 (on rogne les côtés) — le bon
  // réglage pour du contenu d'époque. « large » : 16/9 entier, bandes comprises.
  const [fit, setFit] = useState(() => ((media.year || 0) < 2010 ? "plein" : "large"));
  const [tracking, setTracking] = useState(0.18); // dérèglement du tube (0 = net)
  const [phase, setPhase] = useState("warmup"); // warmup | on | off
  const [osd, setOsd] = useState(null);
  const [showList, setShowList] = useState(false);
  const osdTimer = useRef(null);

  // --- Quel lecteur pour cet épisode ? --------------------------------------
  // Un épisode peut exister à plusieurs endroits (les MIROIRS) : `source` dit
  // lequel est branché. On repart toujours sur le premier en changeant
  // d'épisode — c'est la source de référence, les autres sont des secours.
  const sources = useMemo(() => episodeSources(episode), [episode]);
  const [sourceAt, setSourceAt] = useState(0);
  useEffect(() => setSourceAt(0), [index]);
  const source = sources[sourceAt] || sources[0] || null;
  const provider = source?.provider || "youtube";
  // Hébergeurs pour lesquels on a déjà levé la bride du cadre.
  const [freeHosts, setFreeHosts] = useState(readFreeHosts);
  const host = hostOfUrl(source?.url);
  const freed = !!host && freeHosts.has(host);
  // « Piloté » : on tient la lecture (position, pause, volume). Sinon le poste
  // se met en mode antenne — voir l'en-tête du fichier.
  const piloted = !!PROVIDERS[provider]?.piloted;

  // Les deux lecteurs sont montés à chaque rendu (règle des hooks) mais un seul
  // reçoit de quoi travailler : celui qui n'est pas branché dort, sans iframe
  // ni requête.
  const yt = useYouTubePlayer({
    videoId: provider === "youtube" ? source?.videoId : null,
    autoPlay: true,
    startAt: index === startIndex ? startAt : 0,
    onEnded: () => goto(index + 1, "auto"),
    // Pas de sous-titres automatiques en travers du tube : ils ne sont pas
    // d'époque, et ils tombent pile là où l'image compte.
    captions: false,
  });
  const file = useFilePlayer({
    src: provider === "file" ? source?.url : null,
    autoPlay: true,
    startAt: index === startIndex ? startAt : 0,
    onEnded: () => goto(index + 1, "auto"),
  });
  const player = provider === "file" ? file : yt;
  const {
    holderRef,
    videoRef,
    cur,
    duration,
    volume,
    muted,
    togglePlay,
    seekTo,
    seekBy,
    setVol,
    toggleMute,
  } = player;
  // Un lecteur qu'on ne pilote pas ne dit jamais s'il joue : on le suppose en
  // marche, sinon le poste afficherait « PAUSE » sur une image qui tourne.
  const isPlaying = piloted ? player.isPlaying : true;

  useScrollLock(true);
  useBackClose(() => close(), "crt");

  // --- Affichage à l'écran (OSD), comme un vrai poste ---
  const flash = useCallback((text, bars = null) => {
    setOsd({ text, bars, id: Date.now() });
    clearTimeout(osdTimer.current);
    osdTimer.current = setTimeout(() => setOsd(null), OSD_MS);
  }, []);
  useEffect(() => () => clearTimeout(osdTimer.current), []);

  // --- Chauffe du tube : ~1 s de blanc puis l'image ---
  useEffect(() => {
    playTubeSound(true);
    const t = setTimeout(() => setPhase("on"), 1050);
    return () => clearTimeout(t);
  }, []);

  // Le dérèglement se stabilise tout seul au bout de quelques secondes, comme
  // une cassette qui trouve sa piste.
  useEffect(() => {
    const t = setTimeout(() => setTracking(0.06), 2600);
    return () => clearTimeout(t);
  }, [index]);

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
      // commencé. Sinon : on retient au moins QUEL épisode était sur le poste,
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
  function goto(next, reason) {
    if (next < 0 || next >= episodes.length) {
      flash(next < 0 ? "DÉBUT DE BANDE" : "FIN DE BANDE");
      return;
    }
    // L'épisode qu'on quitte est enregistré avant de changer de bande. Arrivé
    // au générique de fin (reason « auto »), il compte comme vu.
    onProgress?.({
      episodeIndex: index,
      positionSeconds: piloted && reason === "auto" ? duration : piloted ? cur : 0,
      durationSeconds: piloted ? duration : 0,
      watched: reason === "auto" || undefined,
    });
    setIndex(next);
    setTracking(0.2);
    const ep = episodes[next];
    flash(`CH ${String(ep?.number ?? next + 1).padStart(2, "0")} — ${ep?.title || ""}`);
  }

  // Le lecteur d'un tiers ne nous dira jamais qu'il est arrivé au bout : la
  // seule façon honnête de cocher un épisode, c'est de le demander.
  function markWatched() {
    onProgress?.({
      episodeIndex: index,
      positionSeconds: 0,
      durationSeconds: 0,
      watched: true,
    });
    flash("ÉPISODE MARQUÉ VU");
  }

  // Lève (ou remet) la bride du cadre pour CET hébergeur. Le choix vaut pour
  // tous ses épisodes et se retient d'une visite à l'autre : c'est un réglage
  // de confiance, pas un geste à refaire douze fois.
  function toggleFreeHost() {
    if (!host) return;
    setFreeHosts((prev) => {
      const next = new Set(prev);
      if (next.has(host)) next.delete(host);
      else next.add(host);
      try {
        localStorage.setItem(FREE_KEY, JSON.stringify([...next]));
      } catch {
        /* navigation privée : le réglage vaudra pour cette session */
      }
      flash(next.has(host) ? `CADRE LIBÉRÉ — ${host}` : `CADRE BRIDÉ — ${host}`);
      return next;
    });
  }

  // Le même épisode, chez un autre hébergeur. C'est le geste qui sauve la
  // soirée quand une source tombe — d'où sa place sur la carrosserie.
  function nextSource() {
    if (sources.length < 2) return;
    const at = (sourceAt + 1) % sources.length;
    setSourceAt(at);
    setTracking(0.24);
    flash(`SOURCE ${at + 1}/${sources.length} — ${sources[at].label.toUpperCase()}`);
  }

  function press(fn, sound = true) {
    return (e) => {
      e?.stopPropagation?.();
      if (sound) playClackSound();
      fn();
    };
  }

  function close() {
    if (phase === "off") return;
    playTubeSound(false);
    setPhase("off");
    // On laisse l'écran se rétracter avant de démonter (l'effet de démontage
    // enregistre la position au passage).
    setTimeout(() => onClose?.(), 620);
  }

  function changeVolume(v) {
    setVol(v);
    flash(`VOLUME ${Math.round(v * 100)}`, v);
  }

  function cycleFit() {
    const next = fit === "plein" ? "large" : "plein";
    setFit(next);
    flash(next === "plein" ? "FORMAT : PLEIN 4:3" : "FORMAT : LARGE 16:9");
  }

  // --- Clavier : les mêmes gestes que sur les autres lecteurs de l'app ---
  // Volontairement SANS tableau de dépendances : l'écouteur doit voir l'épisode
  // courant, le volume courant et la position courante. Les lister tous
  // reviendrait à réinscrire l'écouteur à chaque tick d'horloge de toute façon.
  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) return;
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

  const pct = duration ? (cur / duration) * 100 : 0;
  const isSeries = media.kind === "series" && episodes.length > 1;
  const chan = String(episode?.number ?? index + 1).padStart(2, "0");

  function barSeek(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
    if (duration) seekTo(ratio * duration);
  }

  return createPortal(
    <div className={`crt-room phase-${phase}`} role="dialog" aria-label={media.title}>
      <div className="crt-room-glow" style={{ "--tint": media.color }} aria-hidden="true" />

      <div className="crt-stage">
        {/* ---------------- le poste ---------------- */}
        <div className="crt-set">
          <div className="crt-set-top" aria-hidden="true" />

          <div className="crt-screen-wrap">
            <div
              className="crt-screen"
              style={{ "--tracking": tracking }}
              onDoubleClick={cycleFit}
            >
              {/* Le tube : 4/3. L'image 16/9 est placée dedans selon FORMAT. */}
              <div className="crt-tube">
                <div className="crt-frame" data-fit={fit}>
                  {provider === "youtube" && (
                    // Rogné en haut et en bas : c'est là que YouTube pose son
                    // titre et ses suggestions de fin.
                    <div
                      className="crt-crop"
                      ref={holderRef}
                      style={{ top: `-${CROP}px`, height: `calc(100% + ${CROP * 2}px)` }}
                    />
                  )}

                  {provider === "file" && (
                    <video
                      ref={videoRef}
                      className="crt-video"
                      src={source?.url}
                      playsInline
                      // Nos commandes sont sur le plastique : celles du
                      // navigateur n'ont rien à faire en travers du tube.
                      controls={false}
                      crossOrigin="anonymous"
                    />
                  )}

                  {provider === "embed" && (
                    // On ne rogne RIEN ici : les commandes du lecteur d'en face
                    // vivent en bas de son cadre, et ce sont les seules qui
                    // pilotent vraiment cette image.
                    //
                    // `sandbox` sans allow-popups ni allow-top-navigation : le
                    // cadre affiche sa vidéo, il n'ouvre pas d'onglet et ne
                    // détourne pas la page. `key` sur l'URL pour que changer de
                    // source remonte une iframe neuve plutôt que de recharger
                    // celle qui vient de tomber.
                    <iframe
                      // La clé porte l'état de la bride : la lever remonte une
                      // iframe NEUVE, sinon le lecteur garderait son refus.
                      key={`${source?.url}|${freed}`}
                      className="crt-embed"
                      src={source?.url}
                      title={episode?.title || media.title}
                      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                      allowFullScreen
                      // Bridé, on ne dit pas d'où l'on vient ; libéré, l'hôte
                      // voit notre origine — plusieurs la réclament pour
                      // accepter d'être encadrés.
                      referrerPolicy={freed ? "origin" : "no-referrer"}
                      sandbox={freed ? undefined : SANDBOX}
                    />
                  )}
                </div>
              </div>

              {/* Verre : lignes de balayage, halo, reflet, bruit de piste. */}
              <div className="crt-scanlines" aria-hidden="true" />
              <div className="crt-noise" aria-hidden="true" />
              <div className="crt-glare" aria-hidden="true" />
              <div className="crt-vignette" aria-hidden="true" />

              {/* Surface de tap : lecture/pause au centre, comme sur un poste
                  qu'on ne peut pas toucher — ici c'est un confort en plus.
                  Absente en mode antenne : elle couvrirait les commandes du
                  lecteur d'en face, les seules qui marchent. */}
              {piloted && (
                <button
                  className="crt-tap"
                  onClick={() => togglePlay()}
                  aria-label={isPlaying ? "Pause" : "Lecture"}
                />
              )}

              {osd && (
                <div key={osd.id} className="crt-osd">
                  <span className="crt-osd-text">{osd.text}</span>
                  {osd.bars != null && (
                    <span className="crt-osd-bars">
                      {Array.from({ length: 10 }, (_, i) => (
                        <i key={i} className={i < Math.round(osd.bars * 10) ? "on" : ""} />
                      ))}
                    </span>
                  )}
                </div>
              )}

              {phase === "warmup" && <div className="crt-warmup" aria-hidden="true" />}
              {!isPlaying && phase === "on" && (
                <div className="crt-paused">
                  <span>PAUSE</span>
                </div>
              )}

              {/* Mode antenne : d'où vient l'image, en petit dans le coin —
                  comme le logo de chaîne d'un vrai poste. */}
              {!piloted && phase === "on" && (
                <span className="crt-source-tag" aria-hidden="true">
                  <Antenna size={11} /> {source?.label}
                </span>
              )}
            </div>
          </div>

          {/* ---------------- la carrosserie ---------------- */}
          <div className="crt-panel">
            <div className="crt-brand">
              <span className="crt-brand-name">MyPlayLog</span>
              <span className="crt-brand-model">TX-86</span>
            </div>

            <div className="crt-readout">
              <span className="crt-readout-ch">{isSeries ? `CH${chan}` : "FILM"}</span>
              <span className="crt-readout-time">
                {piloted ? fmtClock(cur) : "— : —"}
              </span>
            </div>

            <div className="crt-buttons">
              <button
                className="crt-btn power clickable"
                onClick={press(close, false)}
                title="Éteindre (Échap)"
                aria-label="Éteindre"
              >
                <Power size={16} strokeWidth={2.6} />
              </button>

              {/* Lecture, saut, son : les commandes qui n'ont de sens que si
                  l'on tient vraiment le lecteur. En mode antenne, elles
                  laissent la place à ce qui marche (SOURCE, VU). */}
              {piloted ? (
                <>
                  <button
                    className="crt-btn big clickable"
                    onClick={press(togglePlay)}
                    title={isPlaying ? "Pause (Espace)" : "Lecture (Espace)"}
                    aria-label={isPlaying ? "Pause" : "Lecture"}
                  >
                    {isPlaying ? (
                      <Pause size={18} fill="currentColor" />
                    ) : (
                      <Play size={18} fill="currentColor" />
                    )}
                  </button>

                  <button
                    className="crt-btn clickable"
                    onClick={press(() => seekBy(-SEEK_STEP))}
                    title="Rembobiner 10 s (←)"
                    aria-label="Reculer de 10 secondes"
                  >
                    <RotateCcw size={16} />
                  </button>
                  <button
                    className="crt-btn clickable"
                    onClick={press(() => seekBy(SEEK_STEP))}
                    title="Avancer 10 s (→)"
                    aria-label="Avancer de 10 secondes"
                  >
                    <RotateCw size={16} />
                  </button>
                </>
              ) : (
                <button
                  className="crt-btn big clickable"
                  onClick={press(markWatched)}
                  title="Marquer cet épisode comme vu"
                  aria-label="Marquer cet épisode comme vu"
                >
                  <Check size={18} strokeWidth={3} />
                </button>
              )}

              {isSeries && (
                <>
                  <button
                    className="crt-btn clickable"
                    onClick={press(() => goto(index - 1))}
                    disabled={index === 0}
                    title="Épisode précédent ([)"
                    aria-label="Épisode précédent"
                  >
                    <SkipBack size={16} />
                  </button>
                  <button
                    className="crt-btn clickable"
                    onClick={press(() => goto(index + 1))}
                    disabled={index >= episodes.length - 1}
                    title="Épisode suivant (])"
                    aria-label="Épisode suivant"
                  >
                    <SkipForward size={16} />
                  </button>
                </>
              )}

              {piloted && (
                <button
                  className="crt-btn clickable"
                  onClick={press(() => {
                    toggleMute();
                    flash(muted ? "SON" : "COUPÉ");
                  })}
                  title="Couper le son"
                  aria-label="Couper le son"
                >
                  {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
              )}

              {/* La bride du cadre. Le bouton n'a de sens que sur un lecteur
                  tiers, et c'est LE geste à tenter quand il affiche « player
                  not allowed » au lieu de démarrer. */}
              {!piloted && (
                <button
                  className={`crt-btn clickable ${freed ? "active" : ""}`}
                  onClick={press(toggleFreeHost)}
                  title={
                    freed
                      ? `Cadre libéré pour ${host} — cliquer pour le rebrider`
                      : `Le lecteur refuse de démarrer ? Libérer le cadre pour ${host}`
                  }
                  aria-label="Libérer le cadre du lecteur"
                >
                  {freed ? <LockOpen size={16} /> : <Lock size={16} />}
                </button>
              )}

              {/* SOURCE : le même épisode, ailleurs. N'apparaît que s'il y a
                  vraiment un ailleurs. */}
              {sources.length > 1 && (
                <button
                  className="crt-btn clickable"
                  onClick={press(nextSource)}
                  title={`Changer de source (${sourceAt + 1}/${sources.length} — ${
                    source?.label || ""
                  })`}
                  aria-label="Changer de source"
                >
                  <Antenna size={16} />
                </button>
              )}

              <button
                className="crt-btn clickable"
                onClick={press(cycleFit)}
                title="Format de l'image"
                aria-label="Format de l'image"
              >
                <Ratio size={16} />
              </button>

              {isSeries && (
                <button
                  className={`crt-btn clickable ${showList ? "active" : ""}`}
                  onClick={press(() => setShowList((v) => !v))}
                  title="Liste des épisodes"
                  aria-label="Liste des épisodes"
                >
                  <ListVideo size={16} />
                </button>
              )}
            </div>

            {/* Potards : volume et réglage de piste (le fameux TRACKING). Le
                volume disparaît quand le son ne nous appartient pas — un potard
                qui ne tourne rien est pire qu'un potard absent. */}
            <div className="crt-knobs">
              {piloted && (
                <Knob value={muted ? 0 : volume} onChange={changeVolume} label="VOL" />
              )}
              <Knob
                value={1 - tracking / 0.35}
                onChange={(v) => {
                  setTracking((1 - v) * 0.35);
                  flash("RÉGLAGE DE PISTE");
                }}
                label="TRACKING"
              />
            </div>

            <div className="crt-grille" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) => (
                <i key={i} />
              ))}
            </div>
          </div>
        </div>

        {/* ---------------- le magnétoscope ---------------- */}
        <div className="crt-deck">
          <div className="crt-deck-slot" aria-hidden="true">
            <span className="crt-deck-tape" style={{ "--tint": media.color }} />
          </div>
          <div className="crt-deck-info">
            <span className="crt-deck-title">
              {isSeries ? `${chan} · ${episode?.title || ""}` : media.title}
            </span>

            {piloted ? (
              <>
                <div
                  className="crt-deck-bar clickable"
                  onPointerDown={barSeek}
                  role="slider"
                  aria-label="Position dans la vidéo"
                  aria-valuenow={Math.round(pct)}
                  tabIndex={0}
                >
                  <span className="crt-deck-bar-cur" style={{ width: `${pct}%` }} />
                  <span className="crt-deck-bar-thumb" style={{ left: `${pct}%` }} />
                </div>
                <span className="crt-deck-clock">
                  {fmtClock(cur)} <em>/ {fmtClock(duration)}</em>
                </span>
              </>
            ) : (
              // Pas de barre : on ne sait pas où en est la lecture, et une
              // barre qui ne bouge pas se lit comme une panne. On dit d'où
              // vient l'image, et on laisse la porte de sortie — certains
              // hébergeurs refusent d'être encadrés.
              <span className="crt-deck-ext">
                <em>
                  {PROVIDERS.embed.label} · {source?.label}
                  {sources.length > 1 ? ` (${sourceAt + 1}/${sources.length})` : ""}
                </em>
                {!freed && (
                  <button className="crt-deck-open clickable" onClick={toggleFreeHost}>
                    <LockOpen size={12} /> Le lecteur refuse ? Libérer le cadre
                  </button>
                )}
                <a
                  className="crt-deck-open clickable"
                  href={source?.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="Ouvrir la source dans un onglet"
                >
                  <ExternalLink size={12} /> Ouvrir à part
                </a>
              </span>
            )}
          </div>
          <button className="crt-deck-eject clickable" onClick={press(close, false)}>
            ÉJECTER
          </button>
        </div>
      </div>

      {/* Sélecteur d'épisodes : une liste sobre, posée à côté du poste. */}
      {showList && isSeries && (
        <aside className="crt-list">
          <header>
            <span>{media.title}</span>
            <button className="clickable" onClick={press(() => setShowList(false))}>
              Fermer
            </button>
          </header>
          <ul>
            {episodes.map((ep, i) => (
              // Clé sur la POSITION : un épisode servi par un lecteur tiers n'a
              // pas de videoId, et deux miroirs du même hébergeur peuvent
              // partager la même URL.
              <li key={ep.index ?? i}>
                <button
                  className={`clickable ${i === index ? "current" : ""}`}
                  onClick={press(() => {
                    goto(i);
                    setShowList(false);
                  })}
                >
                  <span className="crt-list-num">
                    {String(ep.number ?? i + 1).padStart(2, "0")}
                  </span>
                  <span className="crt-list-title">{ep.title}</span>
                  {media.progress?.watched?.includes(i) && <Check size={13} />}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>,
    document.body
  );
}

// ----------------------------------------------------------------- potard --
// Un bouton rotatif : on le tourne en glissant (verticalement ou en cercle) et
// à la molette. 270° de course utile, comme un vrai potentiomètre.
function Knob({ value, onChange, label }) {
  const ref = useRef(null);
  const angle = -135 + Math.min(1, Math.max(0, value)) * 270;

  function onPointerDown(e) {
    e.preventDefault();
    const el = ref.current;
    el?.setPointerCapture?.(e.pointerId);
    const startY = e.clientY;
    const startValue = value;
    const move = (ev) => {
      // 160 px de course pour aller de 0 à 100 % : assez fin pour viser.
      onChange(Math.min(1, Math.max(0, startValue + (startY - ev.clientY) / 160)));
    };
    const up = () => {
      el?.removeEventListener("pointermove", move);
      el?.removeEventListener("pointerup", up);
      el?.removeEventListener("pointercancel", up);
    };
    el?.addEventListener("pointermove", move);
    el?.addEventListener("pointerup", up);
    el?.addEventListener("pointercancel", up);
  }

  return (
    <div className="crt-knob-wrap">
      <div
        ref={ref}
        className="crt-knob clickable"
        onPointerDown={onPointerDown}
        onWheel={(e) => {
          e.preventDefault();
          onChange(Math.min(1, Math.max(0, value - Math.sign(e.deltaY) * 0.05)));
        }}
        style={{ "--angle": `${angle}deg` }}
        role="slider"
        aria-label={label}
        aria-valuenow={Math.round(value * 100)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowRight")
            onChange(Math.min(1, value + 0.05));
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft")
            onChange(Math.max(0, value - 0.05));
          else return;
          e.preventDefault();
        }}
      >
        <i className="crt-knob-mark" />
      </div>
      <span className="crt-knob-label">{label}</span>
    </div>
  );
}
