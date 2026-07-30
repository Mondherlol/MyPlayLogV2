import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume2,
  Volume1,
  VolumeX,
  ListVideo,
  Maximize2,
  Minimize2,
  Timer,
  Lock,
  MonitorPlay,
  Clapperboard,
  ChevronDown,
  X,
  Check,
  Unplug,
  SmilePlus,
  GripVertical,
} from "lucide-react";
import { useVideoSession, SANDBOX } from "../hooks/useVideoSession";
import { usePartyClock } from "../hooks/useWatchParty";
import { episodeSources, PROVIDERS, fmtClock, hostOf } from "../lib/collection";
import { apiFetch } from "../lib/api";
import { playCueTick, playCueGo } from "../lib/sfx";

// ======================================================================
//  L'écran de la salle — un lecteur, et une horloge partagée
// ======================================================================
// La mécanique de lecture n'est PAS réécrite ici : c'est celle de la fiche solo
// (`useVideoSession` — épisodes, miroirs, clavier, reprise), à laquelle on
// branche la séance partagée par sa porte prévue (`sync.emit`). Ce composant
// n'ajoute que ce qui n'a de sens qu'à plusieurs.
//
// ------------------------------------------------- RIEN NE SE POSE SUR L'IMAGE
// Règle apprise à l'usage, et elle prime sur toute considération d'esthétique :
// SUR UN LECTEUR QU'ON NE PILOTE PAS, LE CENTRE DE L'IMAGE EST UN BOUTON. C'est
// là que vit le gros « play » de l'hébergeur, et c'est exactement là qu'il faut
// pouvoir appuyer À LA SECONDE PRÈS quand le décompte tombe. Un calque par
// dessus — même translucide, même joli — vole ce clic et casse la seule chose
// que le mode guidé sait faire.
//
// Donc :
//   • le DÉCOMPTE vit HORS de l'écran (une bande à part au-dessus), doublé d'une
//     AURA autour du cadre et de BIPS : on peut le suivre à l'oreille, les yeux
//     sur le bouton du lecteur ;
//   • les ÉTATS PERMANENTS (mode de synchro, qui pilote) remontent dans la barre
//     du haut de la page — ils sont vrais tout le temps, ils n'ont rien à faire
//     devant le film ;
//   • ce qui reste par-dessus l'image est FUGACE et `pointer-events: none` : les
//     réactions qui montent, les bulles du salon, l'annonce d'un geste.

// La télécommande a un peu de latence (le temps du tunnel) : on n'affiche pas
// le décompte à la milliseconde près.
const TICK_MS = 100;
// Sans un geste de souris pendant ce temps, l'habillage s'efface EN PLEIN ÉCRAN
// (et seulement là : en fenêtré la barre a sa place à elle, sous l'image, et la
// faire disparaître ne libère rien du tout).
const IDLE_MS = 1000;
// Position de la barre en plein écran, quand on l'a déplacée. Gardée d'une
// séance à l'autre : celui qui l'a poussée dans un coin l'y retrouve.
const BAR_POS_KEY = "mpl_wp_barpos";
const REACTIONS = ["😂", "😱", "🔥", "❤️", "👏", "😭", "🍿", "🤯"];
// Une bulle de salon reste le temps de se lire, pas plus.
const BUBBLE_MS = 7000;

export default function WatchPartyStage({ pt, media, onOpenPicker, onMode }) {
  const {
    party,
    canControl,
    isHost,
    hostState,
    order,
    post,
    emitControl,
    cue,
    setCue,
    note,
    bursts,
    burst,
    startCue,
    messages,
    me,
    token,
  } = pt;

  const stageRef = useRef(null);
  const sessionRef = useRef(null);
  const [full, setFull] = useState(false);

  // --- La source branchée à l'ouverture --------------------------------------
  // On vise une source qu'on PILOTE : c'est elle qui rend la séance automatique.
  const roomIndex = party?.state?.episodeIndex || 0;
  const pilotedHost = useMemo(() => {
    const ep = media?.episodes?.[roomIndex];
    const hit = episodeSources(ep).find((s) => PROVIDERS[s.provider]?.piloted);
    return hit ? hostOf(hit.url) : media?.defaultHost || "";
  }, [media, roomIndex]);

  // --- L'entrée en séance ----------------------------------------------------
  // Arriver en retard est le cas NORMAL d'une watchparty : on démarre là où en
  // est l'hôte, pas au début. La valeur est lue une seule fois, au montage —
  // ensuite c'est le rattrapage de dérive qui tient la barre.
  const startAt = useRef(null);
  const startPlaying = useRef(null);
  if (startAt.current === null) {
    const h = hostState.current;
    startAt.current = h.receivedAt
      ? Math.max(0, h.at + (h.playing ? (Date.now() - h.receivedAt) / 1000 : 0))
      : 0;
    startPlaying.current = canControl ? true : h.playing;
  }

  // --- La progression, comme si l'on regardait seul --------------------------
  const slug = party?.content?.type === "collection" ? party.content.slug : null;
  const onProgress = useCallback(
    (payload) => {
      if (!slug || !token) return;
      apiFetch(`/collection/${slug}/progress`, { method: "PUT", token, body: payload }).catch(
        () => {
          /* la reprise n'est pas critique : on ne dérange pas la séance */
        }
      );
    },
    [slug, token]
  );

  // --- La séance partagée ----------------------------------------------------
  const sync = useMemo(
    () => ({
      emit: (action) => {
        const s = sessionRef.current;
        if (!s) return;
        const at = s.cur || 0;
        switch (action.type) {
          case "toggle":
            emitControl({ action, at, playing: !s.isPlaying });
            break;
          case "seek":
            emitControl({ action, at: action.at, playing: s.isPlaying });
            break;
          case "episode":
            emitControl({ action, at: 0, playing: s.isPlaying, episodeIndex: action.index });
            break;
          case "source":
            emitControl({ action, at, playing: s.isPlaying, sourceAt: action.at });
            break;
          default:
            break;
        }
      },
    }),
    [emitControl]
  );

  const s = useVideoSession({
    media,
    startIndex: roomIndex,
    startAt: startAt.current,
    warmupMs: 0,
    outroMs: 0,
    defaultHost: pilotedHost,
    sync,
    canCommand: canControl,
    autoPlay: startPlaying.current,
    onProgress,
  });
  sessionRef.current = s;

  const { hostClockAt } = usePartyClock({
    session: s,
    party,
    hostState,
    order,
    isHost,
    post,
    meId: me?.id,
  });

  // Le mode de synchro et le lecteur branché remontent à la page : c'est elle
  // qui les affiche, dans sa barre du haut (voir l'en-tête).
  useEffect(() => {
    onMode?.({ piloted: s.piloted, label: s.source?.label || "", host: s.host });
  }, [onMode, s.piloted, s.source, s.host]);

  // --- Le top de départ commun ----------------------------------------------
  const [countdown, setCountdown] = useState(null);
  const lastTick = useRef(null);
  useEffect(() => {
    if (!cue?.cueAt) {
      setCountdown(null);
      lastTick.current = null;
      return undefined;
    }
    const id = setInterval(() => {
      const left = cue.cueAt - Date.now();
      if (left > 0) {
        const n = Math.ceil(left / 1000);
        setCountdown(n);
        // UN BIP PAR SECONDE, et un seul : l'intervalle tourne dix fois plus
        // vite que la seconde pour que le chiffre tombe juste.
        if (lastTick.current !== n) {
          lastTick.current = n;
          playCueTick(n);
        }
        return;
      }
      clearInterval(id);
      if (lastTick.current !== 0) {
        lastTick.current = 0;
        playCueGo();
      }
      setCountdown(0);
      // On part. Le lecteur piloté saute à la seconde annoncée et se lance ;
      // celui qu'on ne pilote pas se contente du signal (visuel et sonore).
      const cur = sessionRef.current;
      if (cur?.piloted) {
        cur.applyRemote({ type: "seek", at: cue.at || 0 });
        if (!cur.isPlaying) cur.applyRemote({ type: "toggle" });
      }
      if (canControl) emitControl({ at: cue.at || 0, playing: true });
      setTimeout(() => {
        setCue(null);
        setCountdown(null);
      }, 1100);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [cue, canControl, emitControl, setCue]);

  // --- Plein écran -----------------------------------------------------------
  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else stageRef.current?.requestFullscreen?.();
  }, []);

  // --- L'habillage qui s'efface (plein écran) --------------------------------
  // Il ne part que si l'on ne s'en sert pas : la souris posée dessus, un menu
  // ouvert, et il reste — sinon on chercherait ses boutons dans le noir.
  const [idle, setIdle] = useState(false);
  const [overBar, setOverBar] = useState(false);
  // DEUX DRAPEAUX, UN PAR MENU, et ce n'est pas du zèle : avec un seul, refermer
  // le sélecteur de lecteur éteignait aussi celui des réactions — la barre
  // s'effaçait alors sous un menu resté ouvert.
  const [srcOpen, setSrcOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const idleTimer = useRef(null);
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  }, []);
  useEffect(() => {
    if (!full) {
      clearTimeout(idleTimer.current);
      setIdle(false);
      return undefined;
    }
    wake();
    // LA SOURIS QUI PASSE SUR L'IFRAME EST INVISIBLE POUR NOUS : un cadre d'une
    // autre origine avale ses évènements, et la page n'en voit pas un seul. La
    // barre effacée pourrait donc devenir INJOIGNABLE sur un lecteur tiers en
    // plein écran. Trois rattrapages, et il en faut trois :
    //   • le clavier (toujours à nous, même quand le pointeur est chez eux) ;
    //   • les bandes noires autour de l'image, quand l'écran n'est pas en 16/9 ;
    //   • et la poignée qui reste, elle, visible (voir `.wp-peek` plus bas).
    const onKey = () => wake();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(idleTimer.current);
      window.removeEventListener("keydown", onKey);
    };
  }, [full, wake]);
  const hideBar = full && idle && !overBar && !srcOpen && !reactOpen && !s.showList;

  // --- La barre qu'on déplace (plein écran) ---------------------------------
  // Elle flotte par-dessus l'image : selon le film, le sous-titrage ou la tête
  // d'un personnage, sa place idéale n'est pas la même. On la pousse où l'on
  // veut, et elle y reste d'une séance à l'autre.
  const [barPos, setBarPos] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(BAR_POS_KEY) || "null");
      return raw && typeof raw.x === "number" ? raw : null;
    } catch {
      return null;
    }
  });
  const drag = useRef(null);

  const onGripDown = (e) => {
    if (!full) return;
    e.preventDefault();
    const box = stageRef.current?.getBoundingClientRect();
    const bar = e.currentTarget.closest(".wp-bar")?.getBoundingClientRect();
    if (!box || !bar) return;
    drag.current = {
      dx: e.clientX - bar.left,
      dy: e.clientY - bar.top,
      box,
      w: bar.width,
      h: bar.height,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onGripMove = (e) => {
    const d = drag.current;
    if (!d) return;
    // Bornée au cadre : une barre poussée hors de l'écran ne se rattrape plus.
    const x = Math.min(Math.max(e.clientX - d.dx - d.box.left, 8), d.box.width - d.w - 8);
    const y = Math.min(Math.max(e.clientY - d.dy - d.box.top, 8), d.box.height - d.h - 8);
    setBarPos({ x, y });
  };
  const onGripUp = () => {
    if (!drag.current) return;
    drag.current = null;
    try {
      localStorage.setItem(BAR_POS_KEY, JSON.stringify(barPos));
    } catch {
      /* navigation privée : la position n'est pas vitale */
    }
  };
  const resetBar = () => {
    setBarPos(null);
    try {
      localStorage.removeItem(BAR_POS_KEY);
    } catch {
      /* ignore */
    }
  };
  const barStyle =
    full && barPos ? { left: `${barPos.x}px`, top: `${barPos.y}px`, bottom: "auto", transform: "none" } : undefined;

  // --- Le chrono commun (mode guidé) ----------------------------------------
  const [shared, setShared] = useState(0);
  useEffect(() => {
    if (s.piloted) return undefined;
    const id = setInterval(() => setShared(hostClockAt()), 500);
    return () => clearInterval(id);
  }, [s.piloted, hostClockAt]);

  // --- Le salon qui passe devant l'image ------------------------------------
  // Regarder en plein écran ne doit pas couper de la conversation : chaque
  // message monte le long du bord, puis s'efface. On ne montre que ce qui
  // ARRIVE — au montage, on prend le fil tel quel sans rejouer l'historique.
  const [bubbles, setBubbles] = useState([]);
  const seen = useRef(null);
  // CE QUI EST DÉJÀ LÀ EST DE L'HISTOIRE, PAS DU DIRECT : l'annuaire se remplit
  // au montage, une fois. Le remplir à la première arrivée (quand le salon
  // s'ouvre vide) avalerait précisément le premier message de la séance.
  useEffect(() => {
    seen.current = new Set((messages || []).map((m) => m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!seen.current || !messages?.length) return;
    const fresh = messages.filter((m) => !seen.current.has(m.id) && !m.system && m.text);
    if (!fresh.length) return;
    fresh.forEach((m) => seen.current.add(m.id));
    setBubbles((prev) => [...prev, ...fresh.map((m) => ({ ...m, key: `${m.id}-${Date.now()}` }))].slice(-5));
  }, [messages]);
  useEffect(() => {
    if (!bubbles.length) return undefined;
    const t = setTimeout(() => setBubbles((prev) => prev.slice(1)), BUBBLE_MS);
    return () => clearTimeout(t);
  }, [bubbles]);

  const roomPlaying = !!party?.state?.playing;
  const vol = s.muted ? 0 : s.volume;
  const VolIcon = vol === 0 ? VolumeX : vol < 0.5 ? Volume1 : Volume2;
  // Le top de départ ne sert qu'à PARTIR : proposé à l'arrêt, rangé en lecture.
  const stopped = s.piloted ? !s.isPlaying : !roomPlaying;

  const barRef = useRef(null);
  const [hover, setHover] = useState(null);
  const ratioAt = (e) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
  };

  // En mode guidé, les gestes portent sur le CHRONO COMMUN et non sur un lecteur
  // que personne ne pilote : avancer, c'est déplacer le repère de tout le monde.
  const nudgeShared = (delta) =>
    emitControl({ at: Math.max(0, hostClockAt() + delta), playing: roomPlaying });
  const toggleShared = () =>
    emitControl({ at: hostClockAt(), playing: !roomPlaying, action: { type: "toggle" } });

  return (
    <div
      className={`wp-stage-wrap ${full ? "is-full" : ""} ${hideBar ? "is-idle" : ""} ${
        countdown !== null ? "is-cue" : ""
      }`}
      ref={stageRef}
      onPointerMove={full ? wake : undefined}
    >
      {/* ---------------- le décompte, HORS de l'image ----------------
          En fenêtré c'est une bande à part, qui pousse l'image : zéro
          recouvrement. En plein écran il n'y a plus de « dehors » — elle passe
          alors en pastille flottante, haut centre, INERTE au clic (le bouton du
          lecteur, lui, est au milieu). */}
      {countdown !== null && (
        <div className="wp-cue-strip" aria-live="assertive">
          <span className="wp-cue-num" key={countdown}>
            {countdown > 0 ? countdown : "▶"}
          </span>
          <span className="wp-cue-text">
            <strong>
              {countdown > 0
                ? s.piloted
                  ? "Départ commun…"
                  : "Prêt à appuyer sur lecture"
                : s.piloted
                  ? "C'est parti !"
                  : "Lance maintenant !"}
            </strong>
            {!s.piloted && <em>Le bouton du lecteur est libre — on part au bip</em>}
          </span>
        </div>
      )}

      {/* ---------------- l'image ---------------- */}
      <div className="wp-fit">
        <div className="wp-screen">
          {!s.source ? (
            <div className="wp-empty">
              <Unplug size={30} />
              <strong>Plus aucune source</strong>
              <span>Ce titre n'a plus de lecteur disponible.</span>
            </div>
          ) : s.provider === "youtube" ? (
            <div className="wp-yt" ref={s.holderRef} />
          ) : s.provider === "file" ? (
            <video
              ref={s.videoRef}
              className="wp-video"
              src={s.source.url}
              playsInline
              controls={false}
              crossOrigin="anonymous"
            />
          ) : (
            <iframe
              key={s.source.url}
              className="wp-embed"
              src={s.source.url}
              title={s.episode?.title || media.title}
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="origin"
              sandbox={SANDBOX}
            />
          )}

          {/* Le clic sur l'image met en pause — pour qui pilote, et là seulement
              où l'on tient vraiment la lecture. Sur un lecteur tiers, l'image
              est à lui : on n'y touche pas. */}
          {s.piloted && s.source && canControl && (
            <button
              className="wp-tap"
              onClick={s.togglePlay}
              // Ce calque couvre déjà l'image sur un lecteur qu'on pilote : il
              // sert donc aussi de capteur de mouvement, et la barre revient
              // naturellement dès qu'on bouge sur la vidéo.
              onPointerMove={full ? wake : undefined}
              aria-label={s.isPlaying ? "Pause" : "Lecture"}
            />
          )}

          {/* --- ce qui passe par-dessus l'image, et rien d'autre ---
              Tout ce bloc est INERTE au clic (`pointer-events: none` en CSS) :
              rien ici ne doit jamais voler un appui destiné au lecteur. */}

          {/* L'aura : c'est ELLE qui remplace le voile de décompte. Le cadre
              respire au rythme des bips, on le voit du coin de l'œil sans
              quitter le bouton des yeux. */}
          <span className="wp-aura" aria-hidden="true" />

          <div className="wp-bursts" aria-hidden="true">
            {bursts.map((b) => (
              <span
                key={b.id}
                className="wp-burst"
                style={{
                  "--x": `${8 + (hashOf(b.id) % 78)}%`,
                  "--drift": `${(hashOf(b.id) % 40) - 20}px`,
                }}
              >
                <em>{b.emoji}</em>
                <i>{b.name}</i>
              </span>
            ))}
          </div>

          <div className="wp-chatflow" aria-hidden="true">
            {bubbles.map((m) => (
              <span key={m.key} className="wp-chatbub">
                <i>{m.author?.username || "…"}</i>
                <em>{m.text}</em>
              </span>
            ))}
          </div>

          {note && (
            <div className={`wp-note ${s.piloted ? "" : "is-order"}`} key={note.id}>
              <strong>{nameOf(party, note.by)}</strong>
              <span>{actionLabel(note, s.piloted)}</span>
            </div>
          )}

          {s.osd && (
            <div key={s.osd.id} className="wp-osd">
              <span>{s.osd.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- la barre, sur UNE ligne ---------------- */}
      <div
        className="wp-bar"
        style={barStyle}
        onPointerEnter={() => setOverBar(true)}
        onPointerLeave={() => setOverBar(false)}
      >
        {/* La poignée n'apparaît qu'en plein écran : c'est le seul cas où la
            barre flotte sur l'image et où sa place peut gêner. */}
        {full && (
          <button
            className="wp-grip clickable"
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
            onDoubleClick={resetBar}
            title="Déplacer la barre (double-clic : remettre en bas)"
            aria-label="Déplacer la barre"
          >
            <GripVertical size={15} />
          </button>
        )}

        {s.piloted ? (
          <>
            <button
              className="wp-play clickable"
              onClick={s.togglePlay}
              disabled={!canControl}
              title={
                canControl
                  ? s.isPlaying
                    ? "Pause pour tout le monde"
                    : "Lecture pour tout le monde"
                  : "L'hôte tient la télécommande"
              }
            >
              {s.isPlaying ? (
                <Pause size={18} fill="currentColor" />
              ) : (
                <Play size={18} fill="currentColor" />
              )}
            </button>
            <button
              className="wp-icon clickable"
              onClick={() => s.seekBy(-s.seekStep)}
              disabled={!canControl}
              title="Reculer de 10 secondes"
            >
              <RotateCcw size={16} />
            </button>
            <button
              className="wp-icon clickable"
              onClick={() => s.seekBy(s.seekStep)}
              disabled={!canControl}
              title="Avancer de 10 secondes"
            >
              <RotateCw size={16} />
            </button>

            {/* Le rail prend la place libre : c'est la seule pièce de la barre
                qui gagne à être large. */}
            <div
              className={`wp-rail ${canControl ? "clickable" : "locked"}`}
              ref={barRef}
              onPointerDown={(e) =>
                canControl && s.duration && s.seekTo(ratioAt(e) * s.duration)
              }
              onPointerMove={(e) => setHover(ratioAt(e))}
              onPointerLeave={() => setHover(null)}
              role="slider"
              aria-label="Position dans la vidéo"
              aria-valuenow={Math.round(s.pct)}
              tabIndex={canControl ? 0 : -1}
            >
              <span className="wp-rail-bed" />
              <span className="wp-rail-cur" style={{ width: `${s.pct}%` }} />
              {canControl && <span className="wp-rail-thumb" style={{ left: `${s.pct}%` }} />}
              {hover != null && s.duration > 0 && (
                <span className="wp-rail-tip" style={{ left: `${hover * 100}%` }}>
                  {fmtClock(hover * s.duration)}
                </span>
              )}
            </div>

            <span className="wp-clock">
              {fmtClock(s.cur)} <em>/ {fmtClock(s.duration)}</em>
            </span>
          </>
        ) : (
          <>
            <button
              className="wp-play clickable"
              onClick={toggleShared}
              disabled={!canControl}
              title={roomPlaying ? "Arrêter le chrono commun" : "Lancer le chrono commun"}
            >
              {roomPlaying ? (
                <Pause size={18} fill="currentColor" />
              ) : (
                <Play size={18} fill="currentColor" />
              )}
            </button>
            <button
              className="wp-icon clickable"
              onClick={() => nudgeShared(-10)}
              disabled={!canControl}
              title="Reculer le repère de 10 secondes"
            >
              <RotateCcw size={16} />
            </button>
            <button
              className="wp-icon clickable"
              onClick={() => nudgeShared(10)}
              disabled={!canControl}
              title="Avancer le repère de 10 secondes"
            >
              <RotateCw size={16} />
            </button>

            {/* LE CHRONO COMMUN, en ligne. Ce n'est pas une barre de
                progression : rien à remplir, personne ne pilote le lecteur. Un
                repère, en gros, que chacun recopie chez lui. */}
            <span className="wp-shared">
              <Timer size={14} />
              <strong>{fmtClock(shared)}</strong>
              <em>
                chrono commun · {roomPlaying ? "en marche" : "arrêté"}
                <b> — mets ton lecteur à cette minute</b>
              </em>
            </span>
          </>
        )}

        {s.isSeries && (
          <>
            <button
              className="wp-icon clickable"
              onClick={() => s.goto(s.index - 1)}
              disabled={!canControl || s.index === 0}
              title="Épisode précédent"
            >
              <SkipBack size={16} />
            </button>
            <button
              className="wp-icon clickable"
              onClick={() => s.goto(s.index + 1)}
              disabled={!canControl || s.index >= s.episodes.length - 1}
              title="Épisode suivant"
            >
              <SkipForward size={16} />
            </button>
          </>
        )}

        {s.piloted && (
          <div className="wp-vol">
            <button className="wp-icon clickable" onClick={s.toggleMute} title="Son">
              <VolIcon size={16} />
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={vol}
              onChange={(e) => s.changeVolume(Number(e.target.value))}
              aria-label="Volume"
              style={{ "--fill": `${vol * 100}%` }}
            />
          </div>
        )}

        {/* LA CHARNIÈRE DE LA BARRE : à gauche ce qui commande la LECTURE, à
            droite ce qui commande la SALLE. Un ressort explicite plutôt qu'un
            `margin-left: auto` posé sur le premier bouton de droite — celui-ci
            change selon le titre (pas de sélecteur de lecteur sur une source
            unique, pas de « Changer » sans télécommande) et le groupe se
            décollait alors du bord. */}
        <span className="wp-gap" aria-hidden="true" />

        <SourceSwitch session={s} locked={!canControl} onOpen={setSrcOpen} />

        {/* Le top de départ ne s'affiche qu'à l'arrêt : une fois lancé, il n'a
            plus rien à donner et ne fait qu'occuper la ligne. */}
        {canControl && stopped && (
          <button
            className="wp-pill accent clickable"
            onClick={() => startCue(s.piloted ? s.cur : hostClockAt())}
            title="Décompte de 3 secondes, puis tout le monde part ensemble"
          >
            <Timer size={15} /> <span>Top de départ</span>
          </button>
        )}

        {s.isSeries && (
          <button
            className={`wp-pill clickable ${s.showList ? "on" : ""}`}
            onClick={() => s.setShowList((v) => !v)}
            title="Liste des épisodes"
          >
            <ListVideo size={15} />
            <span className="wp-lbl">Épisodes</span>
          </button>
        )}

        {canControl && (
          <button className="wp-pill clickable" onClick={onOpenPicker} title="Regarder autre chose">
            <Clapperboard size={15} />
            <span className="wp-lbl">Changer</span>
          </button>
        )}

        {/* LES RÉACTIONS N'ONT PAS LE MÊME COÛT SELON LA PLACE. En plein écran la
            barre flotte SUR le film : huit boutons de plus, c'est une deuxième
            ligne de barre par-dessus l'image pour un geste qu'on fait trois fois
            par séance — elles se replient derrière un bouton, à sa place dans la
            ligne (juste avant la sortie du plein écran). */}
        {full && <ReactPicker onPick={burst} onOpen={setReactOpen} />}

        <button
          className="wp-icon clickable"
          onClick={toggleFull}
          title={full ? "Quitter le plein écran" : "Plein écran"}
        >
          {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>

        {/* En fenêtré, la barre a une ligne à elle sous l'image : les huit émojis
            y sont posés à plat, à un clic, et FERMENT la barre — d'où leur place
            après le plein écran, qui reste ainsi avec les autres commandes de
            la salle au lieu de se retrouver seul sur une ligne. */}
        {!full && (
          <div className="wp-reacts-row">
            {REACTIONS.map((e) => (
              <button
                key={e}
                className="wp-react clickable"
                onClick={() => burst(e)}
                title={`Envoyer ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* LA POIGNÉE DE RAPPEL. Minuscule, mais elle n'est pas décorative : sur un
          lecteur tiers, c'est la SEULE chose qui reste atteignable à la souris
          une fois la barre effacée (voir l'effet plein écran ci-dessus). Elle se
          range exactement là où la barre a été posée. */}
      {hideBar && (
        <button
          className="wp-peek"
          style={barStyle}
          onPointerEnter={wake}
          onClick={wake}
          title="Afficher les commandes"
          aria-label="Afficher les commandes"
        >
          <GripVertical size={13} />
        </button>
      )}

      {/* Le tiroir d'épisodes. */}
      {s.showList && s.isSeries && (
        <aside className="wp-list">
          <header>
            <span>{media.title}</span>
            <button className="clickable" onClick={() => s.setShowList(false)} aria-label="Fermer">
              <X size={15} />
            </button>
          </header>
          <ul>
            {s.episodes.map((ep, i) => (
              <li key={ep.index ?? i}>
                <button
                  className={`clickable ${i === s.index ? "current" : ""}`}
                  disabled={!canControl}
                  onClick={() => {
                    s.goto(i);
                    s.setShowList(false);
                  }}
                >
                  <span className="wp-list-num">
                    {String(ep.number ?? i + 1).padStart(2, "0")}
                  </span>
                  <span className="wp-list-title">{ep.title}</span>
                  {i === s.index && <Check size={13} />}
                </button>
              </li>
            ))}
          </ul>
          {!canControl && (
            <p className="wp-list-foot">
              <Lock size={11} /> Seul l'hôte change d'épisode.
            </p>
          )}
        </aside>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Les réactions, repliées derrière un bouton. La rangée de huit émojis mangeait
// toute la largeur de la barre — en plein écran elle passait même à la ligne,
// et la barre doublait de hauteur par-dessus l'image.
function ReactPicker({ onPick, onOpen }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    onOpen?.(open);
    if (!open) return undefined;
    const away = (e) => !boxRef.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open, onOpen]);

  return (
    <div className="wp-reacts" ref={boxRef}>
      <button
        className={`wp-icon clickable ${open ? "on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Réagir"
        aria-label="Réagir"
      >
        <SmilePlus size={16} />
      </button>
      {open && (
        <div className="wp-reacts-pop" role="menu">
          {REACTIONS.map((e) => (
            <button
              key={e}
              className="wp-react clickable"
              onClick={() => {
                onPick(e);
                setOpen(false);
              }}
              title={`Envoyer ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Le choix du lecteur. Même geste que sur la fiche solo, mais il vaut POUR TOUTE
// LA SALLE — d'où le cadenas quand on ne pilote pas, et la mention de ce que
// chaque source permet : basculer d'un hébergeur opaque vers YouTube fait
// repasser la séance en synchro automatique, et ça mérite d'être dit.
function SourceSwitch({ session: s, locked, onOpen }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    onOpen?.(open);
    if (!open) return undefined;
    const away = (e) => !boxRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, onOpen]);

  if (!s.source) return null;
  const lone = s.sources.length < 2;

  return (
    <div className="wp-src" ref={boxRef}>
      <button
        className={`wp-pill clickable ${open ? "on" : ""}`}
        onClick={() => !locked && !lone && setOpen((v) => !v)}
        disabled={locked && !lone}
        title={locked ? "L'hôte choisit le lecteur" : "Changer de lecteur"}
      >
        <MonitorPlay size={14} />
        <span>{s.source.label}</span>
        {!lone && (
          <>
            <em>
              {s.sourceAt + 1}/{s.sources.length}
            </em>
            <ChevronDown size={13} />
          </>
        )}
      </button>
      {open && (
        <div className="wp-src-menu" role="menu">
          <p className="wp-src-head">Lecteur de la salle</p>
          {s.sources.map((src, i) => {
            const auto = !!PROVIDERS[src.provider]?.piloted;
            return (
              <button
                key={`${src.url}-${i}`}
                className={`wp-src-row clickable ${i === s.sourceAt ? "current" : ""}`}
                onClick={() => {
                  s.pickSource(i);
                  setOpen(false);
                }}
                role="menuitem"
              >
                <span className="wp-src-dot" aria-hidden="true" />
                <span className="wp-src-label">{src.label}</span>
                <em className={auto ? "auto" : ""}>{auto ? "synchro auto" : "guidée"}</em>
              </button>
            );
          })}
          <p className="wp-src-foot">
            Un lecteur <strong>piloté</strong> (YouTube, fichier vidéo) se
            synchronise tout seul. Chez un hébergeur tiers, la lecture reste chez
            lui : la salle se cale au top de départ.
          </p>
        </div>
      )}
    </div>
  );
}

// Une position stable et bien répartie à partir d'un identifiant : c'est ce qui
// évite que deux réactions envoyées en même temps montent l'une sur l'autre.
function hashOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 100000;
  return h;
}

const nameOf = (party, id) =>
  party?.members?.find((m) => String(m.id) === String(id))?.username || "Quelqu'un";

// Ce qu'on annonce dépend de ce que le spectateur peut faire tout seul : en
// synchro automatique, son lecteur a déjà obéi (« a mis en pause ») ; en synchro
// guidée, la phrase est une consigne (« mets en pause »).
function actionLabel(note, piloted) {
  const t = note.action?.type;
  if (t === "episode") return "a changé d'épisode";
  if (t === "source") return "a changé de lecteur";
  if (t === "seek")
    return piloted
      ? `a sauté à ${fmtClock(note.at)}`
      : `est à ${fmtClock(note.at)} — remets-toi à cette minute`;
  if (note.playing) return piloted ? "a relancé la lecture" : "a relancé — appuie sur lecture";
  return piloted ? "a mis en pause" : "a mis en pause — mets en pause aussi";
}
