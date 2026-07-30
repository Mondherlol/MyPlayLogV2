import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Power,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  Loader2,
  Unplug,
  Cpu,
  LayoutGrid,
  Check,
  Save,
  Keyboard,
  Gamepad2,
} from "lucide-react";
import { useScrollLock } from "../hooks/useScrollLock";
import { useBackClose } from "../hooks/useBackClose";
import GbaConsole from "./GbaConsole";
import GbaSaves from "./GbaSaves";
import {
  CORES,
  CORE_KEY,
  consoleDoc,
  coreOf,
  savedCore,
  muteKeys,
  EJS_DATA,
} from "../lib/gbaEmulator";
import { LAYOUT_KEY, layoutOf, savedLayout } from "../lib/gbaShell";
import {
  BUTTONS,
  PRESETS,
  assign,
  canPress,
  keyLabel,
  loadKeys,
  presetLabel,
  presetOf,
  pressButton,
  readLayout,
  saveKeys,
} from "../lib/gbaInput";
import {
  AUTO_SLOT,
  deleteSave,
  listSaves,
  readSave,
  writeSave,
} from "../lib/gbaSaves";

// ======================================================================
//  La console de la Collection
// ======================================================================
// MÊME PARTI PRIS QU'AVANT : on ne lance pas un émulateur dans un cadre, ON
// ALLUME UNE CONSOLE. Ce qui a changé, c'est la machine — et ce n'est pas un
// détail cosmétique.
//
// LE RAYON NINTENDO DS A ÉTÉ RETIRÉ, ET VOICI POURQUOI. Émuler une DS dans un
// navigateur demande une machine : deux écrans, un tactile, une puce 3D. Le
// mécanisme qu'il fallait pour ça — lire le canvas du cœur à chaque image,
// découper ses deux moitiés, les recopier dans les trous d'un gabarit, plus une
// iframe invisible posée sur l'écran du bas pour attraper le tactile, plus un
// détecteur de « recopie qui ne ramène que du noir » — se traînait sur un
// portable honnête. Une console qui rame n'est pas une console.
//
// LA GBA N'A QU'UN ÉCRAN, en 3/2 exactement comme la fenêtre découpée dans la
// coque. On montre donc L'IFRAME ELLE-MÊME, à sa place, et tout ce mécanisme
// disparaît : pas de recopie, pas de boucle d'animation à nous, pas de tactile à
// simuler, pas de panne muette possible. mGBA tourne à pleine vitesse jusque sur
// téléphone. C'est le même objet, en état de marche.
//
// ET LA PARTIE EST CHEZ NOUS. C'est l'autre moitié du travail : un état de
// machine par emplacement, sur le serveur, à ton nom (voir GbaSaves et
// lib/gbaSaves.js). On se reconnecte du téléphone et on reprend où on en était.
//
// CE QUI RESTE DE L'ANCIEN, parce que c'était juste :
//
//   • le TEMPS DE JEU compté par tranches, et seulement ce qui est VRAIMENT
//     joué (console en marche, onglet visible) — un compteur qui tourne pendant
//     une pause déjeuner ne raconte rien ;
//   • l'écoute du clavier SUR LES DEUX FENÊTRES, et le silence imposé à celui
//     d'EmulatorJS (`muteKeys`) : l'iframe est cliquable (il lui faut le premier
//     clic pour débloquer son contexte audio), donc elle peut prendre le focus,
//     et sans ces deux précautions une touche enfoncerait deux boutons ;
//   • les COMMANDES EN COLONNE contre le bord droit : c'est la seule place qui ne
//     retire pas un pixel de hauteur à l'objet.

const TICK = 5; // secondes entre deux relevés
const FLUSH = 60; // on n'écrit le temps de jeu au serveur qu'à la minute
const AUTOSAVE = 120; // secondes entre deux sauvegardes automatiques
const BOOT_TIMEOUT = 30000; // au-delà, les cœurs ne viendront pas
const ASK_TIMEOUT = 8000; // une console qui ne répond pas a un problème
const CLOSE_TIMEOUT = 2500; // on n'attend pas huit secondes pour éteindre

export default function GbaPlayer({ media, token, onClose, onPlayed }) {
  const [core, setCore] = useState(savedCore);
  const [phase, setPhase] = useState("boot"); // boot | on | nodata | slow
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);
  const [raw, setRaw] = useState(false); // panneau de l'émulateur ouvert
  const [menu, setMenu] = useState(null); // "core" | "keys" | "saves" | null
  const [layout, setLayout] = useState(savedLayout);
  const [keys, setKeys] = useState(loadKeys);
  // DEUX ÉTATS POUR UNE MÊME IDÉE, et ils ne se confondent pas : `capturing`
  // est l'identifiant du bouton qu'on réapprend DANS LE PANNEAU, `tuning` dit
  // seulement que la coque, elle, en réapprend un dans sa bulle. Les mélanger
  // faisait assigner une touche à un bouton nommé « spot ».
  const [capturing, setCapturing] = useState(null);
  const [tuning, setTuning] = useState(false);
  const [deaf, setDeaf] = useState(false); // le cœur n'écoute pas nos boutons
  const [screen, setScreen] = useState(null); // la boîte mesurée de la dalle

  // --- les sauvegardes ---
  const [saves, setSaves] = useState([]);
  const [slots, setSlots] = useState(6);
  const [savesBusy, setSavesBusy] = useState(null); // emplacement en cours
  const [savesError, setSavesError] = useState(null);
  const [offer, setOffer] = useState(false); // « reprendre ta partie ? »
  const [closing, setClosing] = useState(false);
  const [flash, setFlash] = useState(null);

  // Le temps de jeu TOTAL, celui qui s'écrit sous une vignette. Parti de ce que
  // le serveur sait déjà, augmenté au fil de la partie.
  //
  // DOUBLÉ EN RÉF, et ce n'est pas de la redondance. La sauvegarde a besoin de le
  // LIRE ; si elle en dépendait, elle serait reconstruite toutes les cinq
  // secondes — et le minuteur de la sauvegarde automatique, qui dépend d'elle,
  // repartirait de zéro à chaque top. Il ne se déclencherait jamais.
  const totalRef = useRef(media.progress?.playSeconds || 0);
  const [total, setTotal] = useState(totalRef.current);

  const frame = useRef(null);
  const shell = useRef(null);
  const body = useRef(null);
  const pending = useRef(0); // secondes jouées, pas encore envoyées
  const busy = useRef(false); // une sauvegarde est en vol
  const gone = useRef(false); // on est en train d'éteindre

  useScrollLock(true);

  const rom = media.cartridge?.rom;
  const tint = media.color || "#f2b70b";
  const shape = layoutOf(layout);
  const engine = coreOf(core);

  // Le document de la console. Recalculé au changement de moteur SEULEMENT :
  // toute autre dépendance ferait redémarrer le jeu en cours de partie.
  const doc = useMemo(
    () => consoleDoc({ rom, core, name: media.title, slug: media.slug, tint }),
    [rom, core, media.title, media.slug, tint]
  );

  // L'émulateur, quand il est là. Toujours par cette fonction : le contenu de
  // l'iframe disparaît entre deux rendus (changement de moteur, fermeture), et
  // une référence gardée de côté pointerait alors dans le vide.
  const emu = useCallback(() => {
    try {
      return frame.current?.contentWindow?.EJS_emulator || null;
    } catch {
      return null;
    }
  }, []);

  const win = useCallback(() => {
    try {
      return frame.current?.contentWindow || null;
    } catch {
      return null;
    }
  }, []);

  const say = useCallback((msg) => {
    setFlash({ msg, at: Date.now() });
  }, []);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(t);
  }, [flash]);

  // ------------------------------------------------- où poser l'écran --
  // La dalle est placée par la coque : dans le trou du dessin, ou seule au
  // milieu. Sa boîte se MESURE, elle ne se calcule pas — et l'iframe vient s'y
  // coller.
  //
  // C'EST CE DÉTOUR QUI PERMET DE CHANGER DE DISPOSITION EN PLEINE PARTIE.
  // L'iframe n'est enfant ni de la coque ni de l'écran seul : elle est posée
  // par-dessus, en absolu. Enfant de l'un des deux, elle serait démontée au
  // changement — et le jeu redémarrerait.
  useLayoutEffect(() => {
    const host = body.current;
    if (!host) return undefined;
    const measure = () => {
      const slot = host.querySelector(".gba-screen-slot");
      if (!slot) return setScreen(null);
      const a = slot.getBoundingClientRect();
      const b = host.getBoundingClientRect();
      if (!a.width || !a.height) return undefined;
      return setScreen({
        left: a.left - b.left,
        top: a.top - b.top,
        width: a.width,
        height: a.height,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [layout, phase]);

  // ------------------------------------------------------------- le temps --
  //
  // Le rapporteur est gardé EN RÉF, et `flushTime` ne dépend de rien. Sans ça, un
  // parent qui passe une fonction anonyme (le cas courant : `onPlayed={(s) =>
  // …}`) en fabrique une nouvelle à chaque rendu — et le relevé du temps, dont
  // le nettoyage envoie ce qui reste, se démonterait et se remonterait avec
  // elle. Le minuteur repartirait de zéro à chaque fois : une partie entière
  // pourrait ne jamais atteindre son premier top.
  const report = useRef(onPlayed);
  report.current = onPlayed;

  const flushTime = useCallback(() => {
    const secs = Math.round(pending.current);
    pending.current = 0;
    if (secs > 0) report.current?.(secs);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (phase !== "on" || paused || document.hidden) return;
      pending.current += TICK;
      totalRef.current += TICK;
      setTotal(totalRef.current);
      if (pending.current >= FLUSH) flushTime();
    }, TICK * 1000);
    return () => clearInterval(id);
  }, [phase, paused, flushTime]);

  // Le reliquat part à la fermeture : sans ça, une partie de cinquante secondes
  // ne compterait jamais pour rien.
  useEffect(() => () => flushTime(), [flushTime]);

  // ============================================================ le dialogue ==
  //
  // Tout ce qui demande une réponse à l'iframe passe par ici : on numérote la
  // question, on garde la promesse de côté, et le message de retour la résout.
  //
  // AVEC UN DÉLAI DE GARDE, et c'est indispensable : le seul cas où l'on parle à
  // l'iframe est la sauvegarde, donc le seul cas où une absence de réponse ferait
  // ATTENDRE quelqu'un devant un bouton qui tourne. Au bout de huit secondes on
  // le dit, plutôt que de tourner indéfiniment.
  const waiting = useRef(new Map());
  const nextId = useRef(1);

  const ask = useCallback(
    (kind, extra = {}, timeout = ASK_TIMEOUT) => {
      const w = win();
      if (!w) return Promise.reject(new Error("La console n'est pas allumée."));
      const id = nextId.current++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.current.delete(id);
          reject(new Error("La console n'a pas répondu."));
        }, timeout);
        waiting.current.set(id, { resolve, timer });
        w.postMessage({ mplGba: kind, id, ...extra }, "*");
      });
    },
    [win]
  );

  useEffect(() => {
    // La table est prise DANS l'effet, alors qu'elle vit dans une réf. Elle ne
    // change jamais d'identité (elle est créée une fois pour toute la vie du
    // composant), donc c'est strictement équivalent — mais ça dit à qui lit le
    // nettoyage qu'on parle bien de la table de CE montage.
    const asks = waiting.current;
    function onMessage(e) {
      if (e.source !== frame.current?.contentWindow) return;
      const what = e.data?.mplGba;
      if (what === "ready" || what === "start") {
        setPhase("on");
        setPaused(false);
        return;
      }
      if (what === "nodata") {
        setPhase("nodata");
        return;
      }
      // Une réponse à une question numérotée.
      const slot = asks.get(e.data?.id);
      if (slot) {
        asks.delete(e.data.id);
        clearTimeout(slot.timer);
        slot.resolve(e.data);
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      // Les questions en vol n'auront jamais de réponse : leurs minuteurs
      // partiraient dans le vide après le démontage.
      for (const { timer } of asks.values()) clearTimeout(timer);
      asks.clear();
    };
  }, []);

  // Rien n'est arrivé au bout d'une demi-minute : ce n'est plus « ça charge »,
  // c'est en panne. On le dit, plutôt que de laisser tourner une roue.
  useEffect(() => {
    if (phase !== "boot") return undefined;
    const t = setTimeout(() => setPhase((p) => (p === "boot" ? "slow" : p)), BOOT_TIMEOUT);
    return () => clearTimeout(t);
  }, [phase, core]);

  // Le cœur accepte-t-il qu'on lui pousse des boutons ? Et accepte-t-il de se
  // taire côté clavier ? Les deux se posent une fois la partie lancée, et une
  // fois le panneau refermé — il y remet parfois ses touches.
  useEffect(() => {
    if (phase !== "on") return undefined;
    const t = setTimeout(() => {
      setDeaf(!canPress(win()));
      muteKeys(win());
    }, 600);
    return () => clearTimeout(t);
  }, [phase, raw, win]);

  // ============================================================ sauvegardes ==

  // La liste, chargée pendant que le cœur se télécharge : au moment où le jeu
  // démarre, on sait déjà s'il y a une partie à reprendre.
  useEffect(() => {
    let alive = true;
    listSaves(media.slug, token)
      .then(({ saves: list, slots: count }) => {
        if (!alive) return;
        setSaves(list);
        if (count) setSlots(count);
        if (list.some((s) => s.slot === AUTO_SLOT)) setOffer(true);
      })
      .catch(() => {
        /* pas de sauvegardes lisibles : on joue, c'est tout */
      });
    return () => {
      alive = false;
    };
  }, [media.slug, token]);

  const remember = useCallback((save) => {
    setSaves((list) => [...list.filter((s) => s.slot !== save.slot), save]);
  }, []);

  // Écrire un emplacement. `quiet` sert aux sauvegardes automatiques : elles ne
  // doivent ni faire tourner les boutons du tiroir ni annoncer quoi que ce soit,
  // sinon la console clignote toutes les deux minutes.
  const store = useCallback(
    async (slot, { quiet = false, timeout = ASK_TIMEOUT } = {}) => {
      if (busy.current) return false;
      busy.current = true;
      if (!quiet) {
        setSavesBusy(slot);
        setSavesError(null);
      }
      try {
        const reply = await ask("save", {}, timeout);
        if (!reply.buf?.byteLength)
          throw new Error(
            reply.error
              ? `Le moteur n'a pas rendu l'état (${reply.error}).`
              : "Le moteur n'a pas rendu l'état de la partie."
          );
        const save = await writeSave(
          media.slug,
          slot,
          { buf: reply.buf, shot: reply.shot, core, playSeconds: totalRef.current },
          token
        );
        remember(save);
        if (!quiet)
          say(
            slot === AUTO_SLOT
              ? "Partie sauvegardée"
              : `Sauvegardé dans l'emplacement ${slot}`
          );
        return true;
      } catch (e) {
        // Une sauvegarde automatique qui échoue ne DÉRANGE pas — mais elle se
        // dit quand même dans le tiroir, sinon on croit être à l'abri.
        setSavesError(e.message);
        return false;
      } finally {
        busy.current = false;
        if (!quiet) setSavesBusy(null);
      }
    },
    [ask, core, media.slug, remember, say, token]
  );

  const restore = useCallback(
    async (slot) => {
      if (busy.current) return;
      busy.current = true;
      setSavesBusy(slot);
      setSavesError(null);
      try {
        const buf = await readSave(media.slug, slot, token);
        const reply = await ask("load", { buf });
        if (!reply.ok)
          throw new Error(
            reply.error
              ? `Le moteur a refusé la sauvegarde (${reply.error}).`
              : "Le moteur a refusé la sauvegarde."
          );
        setOffer(false);
        setMenu(null);
        setPaused(false);
        say(slot === AUTO_SLOT ? "Partie reprise" : `Emplacement ${slot} chargé`);
      } catch (e) {
        setSavesError(e.message);
      } finally {
        busy.current = false;
        setSavesBusy(null);
      }
    },
    [ask, media.slug, say, token]
  );

  const forget = useCallback(
    async (slot) => {
      setSavesBusy(slot);
      setSavesError(null);
      try {
        await deleteSave(media.slug, slot, token);
        setSaves((list) => list.filter((s) => s.slot !== slot));
        if (slot === AUTO_SLOT) setOffer(false);
      } catch (e) {
        setSavesError(e.message);
      } finally {
        setSavesBusy(null);
      }
    },
    [media.slug, token]
  );

  // La sauvegarde automatique. Elle ne tourne QUE quand on joue vraiment — même
  // règle que le compteur de temps : sauvegarder un onglet en arrière-plan
  // écraserait la reprise par un état où il ne se passe rien.
  useEffect(() => {
    if (phase !== "on" || offer) return undefined;
    const id = setInterval(() => {
      if (paused || document.hidden || busy.current) return;
      store(AUTO_SLOT, { quiet: true });
    }, AUTOSAVE * 1000);
    return () => clearInterval(id);
  }, [phase, paused, offer, store]);

  // ------------------------------------------------------------ les touches --
  // On écoute, et on POUSSE LE BOUTON. L'émulateur ne reçoit jamais une touche,
  // seulement des appuis de manette — la même porte que celle qu'emprunte la
  // coque dessinée. Un seul chemin d'entrée, donc un seul à faire marcher.
  //
  // SUR LES DEUX FENÊTRES, et c'est indispensable : cliquer l'écran donne le
  // focus à l'iframe, et à partir de là c'est ELLE qui reçoit les touches.
  // N'écouter que la page ferait une console qui cesse de répondre au clavier dès
  // qu'on a cliqué l'écran une fois.
  //
  // L'écoute se tait pendant qu'on apprend une touche, pendant la pause, et
  // quand le panneau de l'émulateur est ouvert — là, c'est LUI qui commande.
  const push = useCallback((index, down) => pressButton(win(), index, down), [win]);

  useEffect(() => {
    if (capturing || tuning || raw || paused || phase !== "on") return undefined;
    const byCode = new Map();
    for (const b of BUTTONS) {
      const k = keys[b.id];
      if (k?.code) byCode.set(k.code, b.index);
    }
    const held = new Set();
    const release = () => {
      for (const code of held) push(byCode.get(code), false);
      held.clear();
    };
    function onDown(e) {
      // Les raccourcis du navigateur restent au navigateur : personne n'assigne
      // Ctrl+T à un bouton, et l'intercepter ne ferait que des dégâts.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const index = byCode.get(e.code);
      if (index === undefined) return;
      e.preventDefault();
      if (e.repeat) return;
      held.add(e.code);
      push(index, true);
    }
    function onUp(e) {
      const index = byCode.get(e.code);
      if (index === undefined) return;
      e.preventDefault();
      held.delete(e.code);
      push(index, false);
    }
    const inner = win();
    const targets = inner && inner !== window ? [window, inner] : [window];
    for (const t of targets) {
      try {
        t.addEventListener("keydown", onDown);
        t.addEventListener("keyup", onUp);
      } catch {
        /* document jeté : l'autre fenêtre suffit */
      }
    }
    window.addEventListener("blur", release);
    return () => {
      release();
      for (const t of targets) {
        try {
          t.removeEventListener("keydown", onDown);
          t.removeEventListener("keyup", onUp);
        } catch {
          /* rien à retirer */
        }
      }
      window.removeEventListener("blur", release);
    };
  }, [keys, capturing, tuning, raw, paused, phase, push, win]);

  const onSpot = useCallback((btn, down) => push(btn.index, down), [push]);

  // Le clavier du joueur, tel qu'il est vraiment gravé (Chromium seulement) :
  // afficher « Z » sous un bouton quand la touche porte un W est le genre de
  // détail qui fait douter de tout le reste.
  useEffect(() => {
    let alive = true;
    readLayout(keys).then((fixed) => {
      if (alive && fixed) setKeys(fixed);
    });
    return () => {
      alive = false;
    };
    // Une seule fois : ensuite ce sont les touches réapprises qui font foi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => saveKeys(keys), [keys]);

  // La frappe qui apprend une touche depuis LE PANNEAU (la coque a la sienne,
  // dans sa bulle). En capture, donc avant tout le reste, et arrêtée net.
  useEffect(() => {
    if (!capturing) return undefined;
    function onKey(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key !== "Escape") setKeys((k) => assign(k, capturing, e.code, keyLabel(e)));
      setCapturing(null);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing]);

  // ------------------------------------------------------------ commandes --
  function togglePause() {
    const e = emu();
    const next = !paused;
    try {
      if (next) e?.pause?.();
      else e?.play?.();
    } catch {
      /* moteur pas encore prêt : l'état d'affichage suit quand même */
    }
    setPaused(next);
  }

  function restart() {
    try {
      emu()?.gameManager?.restart?.();
    } catch {
      /* rien : le panneau de l'émulateur offre la même chose */
    }
    setPaused(false);
  }

  function toggleSound() {
    const e = emu();
    const next = !muted;
    try {
      if (e?.setVolume) e.setVolume(next ? 0 : 1);
      else if (e) e.volume = next ? 0 : 1;
    } catch {
      /* sans effet : on ne prétend pas avoir coupé le son */
    }
    setMuted(next);
  }

  // Le panneau de l'émulateur : on révèle l'iframe en grand, barre d'EmulatorJS
  // comprise. Filtres, tricheurs, réglages du cœur y vivent — les réécrire
  // n'apporterait rien.
  function toggleRaw() {
    const next = !raw;
    try {
      frame.current?.contentWindow?.document?.body?.classList.toggle("bare", !next);
    } catch {
      /* pas de document : rien à montrer */
    }
    setRaw(next);
    setMenu(null);
  }

  function toggleFull() {
    const node = shell.current;
    if (!node) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else node.requestFullscreen?.().catch(() => {});
  }

  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Un menu ouvert se referme dès qu'on regarde ailleurs : il sort d'un bouton
  // de la colonne, il n'a pas à être congédié explicitement.
  useEffect(() => {
    if (!menu) return undefined;
    function onDown(e) {
      if (!e.target.closest?.(".gba-pop, .gba-panel")) setMenu(null);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menu]);

  function toggleLayout() {
    const next = layout === "console" ? "screen" : "console";
    setLayout(next);
    setMenu(null);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      /* navigation privée : le choix ne vaudra que pour cette partie */
    }
  }

  // ------------------------------------------------------------ éteindre --
  //
  // ON SAUVEGARDE AVANT DE PARTIR, et on le montre. C'est la seule attente qu'on
  // impose au joueur dans toute cette console, et elle est justifiée : sans elle,
  // fermer l'onglet perdrait la partie — l'iframe est jetée avec le composant, et
  // on ne peut plus rien lui demander après.
  //
  // BORNÉE À DEUX SECONDES ET DEMIE. Un cœur en panne ne doit pas pouvoir retenir
  // quelqu'un qui veut sortir : passé ce délai on éteint quand même, et le temps
  // de jeu, lui, est déjà parti.
  const close = useCallback(async () => {
    if (gone.current) return;
    gone.current = true;
    flushTime();
    if (phase === "on" && !raw) {
      setClosing(true);
      await store(AUTO_SLOT, { quiet: true, timeout: CLOSE_TIMEOUT });
    }
    onClose();
  }, [flushTime, onClose, phase, raw, store]);

  useBackClose(close, "gba");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || document.fullscreenElement) return;
      // Échap sert d'abord à refermer ce qui est ouvert par-dessus. Pendant un
      // réapprentissage de touche, il annule celui-ci et rien d'autre : c'est
      // l'écoute en capture qui s'en charge, on ne fait que ne pas éteindre.
      if (capturing || tuning) return;
      if (menu) return setMenu(null);
      if (raw) return toggleRaw();
      return close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close, menu, raw, capturing, tuning]);

  function pickEngine(value) {
    setMenu(null);
    if (value === core) return;
    flushTime();
    // Changer de moteur jette le document, donc la partie en cours. On la
    // sauvegarde AVANT — sans ça, on perdrait exactement ce qu'on venait de
    // jouer. Et comme un état appartient à son cœur (voir GbaSaves), la
    // sauvegarde part sous l'ANCIEN nom de moteur : c'est elle qu'on retrouvera
    // en revenant.
    store(AUTO_SLOT, { quiet: true, timeout: CLOSE_TIMEOUT }).finally(() => {
      try {
        localStorage.setItem(CORE_KEY, value);
      } catch {
        /* le choix ne vaudra que pour cette partie */
      }
      setPhase("boot");
      setPaused(false);
      setDeaf(false);
      setOffer(false);
      setCore(value);
    });
  }

  if (!rom)
    return createPortal(
      <div className="gba-stage" style={{ "--tint": tint }}>
        <div className="gba-fail">
          <Unplug size={24} />
          <strong>Pas de cartouche dans ce boîtier.</strong>
          <p>Le titre est bien sur l'étagère, mais son fichier n'a pas été déposé.</p>
          <button className="btn btn-ghost clickable" onClick={onClose}>
            Refermer
          </button>
        </div>
      </div>,
      document.body
    );

  const other = CORES.find((c) => c.value !== core);
  const autoSave = saves.find((s) => s.slot === AUTO_SLOT);
  const preset = presetOf(keys);

  // La fenêtre de l'écran. Sans mesure encore (premier rendu), l'iframe reste
  // dans son coin : invisible, mais TOUJOURS rendue — un document que le
  // navigateur ne peint pas voit ses images étranglées, et le jeu tournerait au
  // ralenti.
  const frameStyle =
    !raw && screen
      ? {
          left: `${screen.left}px`,
          top: `${screen.top}px`,
          width: `${screen.width}px`,
          height: `${screen.height}px`,
        }
      : undefined;

  return createPortal(
    <div
      className={`gba-stage ${phase === "on" ? "lit" : ""} ${raw ? "raw" : ""} ${
        capturing || tuning ? "tuning" : ""
      }`}
      style={{ "--tint": tint }}
      role="dialog"
      aria-label={`${media.title} — Game Boy Advance`}
    >
      <div className="gba-shell" ref={shell}>
        <div className={`gba-body ${paused ? "held" : ""}`} ref={body}>
          <GbaConsole
            shell={shape.shell}
            keys={keys}
            onKeys={setKeys}
            onPress={onSpot}
            onCapture={setTuning}
            lit={phase === "on" && !paused}
            disabled={phase !== "on"}
          />

          {/* L'ÉCRAN. L'iframe elle-même, posée sur la dalle mesurée — pas une
              recopie. C'est toute la différence avec le rayon d'avant. */}
          <div className={`gba-frame ${frameStyle ? "fitted" : ""}`} style={frameStyle}>
            <iframe
              key={core}
              ref={frame}
              className="gba-feed"
              title={`${media.title} — écran`}
              srcDoc={doc}
              // Le plein écran d'EmulatorJS part de SON document : sans cette
              // permission, son bouton ne fait rien du tout.
              allow="fullscreen; autoplay; gamepad"
            />
          </div>

          {phase !== "on" && (
            <div className="gba-boot">
              {phase === "boot" ? (
                <>
                  <Loader2 size={22} className="spin" />
                  <strong>Insertion de la cartouche…</strong>
                  <span>
                    Le cœur {engine.label} se télécharge — c'est le plus long, et
                    seulement la première fois.
                  </span>
                </>
              ) : (
                <>
                  <Unplug size={22} />
                  <strong>
                    {phase === "nodata"
                      ? "Les cœurs d'émulation sont injoignables."
                      : "La console ne démarre pas."}
                  </strong>
                  <span>
                    {phase === "nodata" ? (
                      <>
                        Rien n'a pu être téléchargé depuis <code>{EJS_DATA}</code>. Un
                        bloqueur, une coupure — ou l'hébergement à régler (
                        <code>VITE_EJS_DATA</code>).
                      </>
                    ) : (
                      <>
                        Le cœur {engine.label} n'a pas répondu. L'autre moteur
                        démarre souvent là où celui-ci cale.
                      </>
                    )}
                  </span>
                  <button
                    className="btn btn-ghost clickable"
                    onClick={() => pickEngine(other?.value || core)}
                  >
                    <Cpu size={15} /> Essayer {other?.label}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ---------------- reprendre ta partie ? ----------------
              LA VIGNETTE FAIT LA DÉCISION. On ne demande pas « veux-tu reprendre
              ta sauvegarde du 12 mars » : on MONTRE l'écran sur lequel on s'est
              arrêté, et le choix se fait tout seul.

              Et on DEMANDE, plutôt que de reprendre d'office : quelqu'un qui
              revient pour recommencer une partie ne doit pas voir la console
              charger la précédente sous ses yeux. */}
          {offer && phase === "on" && autoSave && (
            <div className="gba-offer">
              {autoSave.thumb && <img src={autoSave.thumb} alt="" />}
              <div>
                <strong>Reprendre ta partie ?</strong>
                <span>
                  {autoSave.playSeconds > 60
                    ? `Tu en étais là, après ${Math.round(autoSave.playSeconds / 60)} minutes de jeu.`
                    : "Tu en étais là."}
                </span>
                {savesError && <em>{savesError}</em>}
              </div>
              <div className="gba-offer-btns">
                <button
                  className="btn btn-primary clickable"
                  onClick={() => restore(AUTO_SLOT)}
                  disabled={savesBusy !== null}
                >
                  {savesBusy === AUTO_SLOT ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <Play size={15} />
                  )}
                  Reprendre
                </button>
                <button
                  className="btn btn-ghost clickable"
                  onClick={() => setOffer(false)}
                  disabled={savesBusy !== null}
                >
                  Nouvelle partie
                </button>
              </div>
              {/* ON LE DIT AVANT, PAS APRÈS. Repartir de zéro veut dire que la
                  sauvegarde automatique sera écrasée par la nouvelle partie dans
                  les minutes qui suivent — c'est le contrat normal d'une reprise
                  automatique, mais le découvrir après coup, c'est perdre une
                  partie. Les emplacements, eux, ne bougent pas. */}
              <em className="gba-offer-warn">
                Une nouvelle partie remplacera cette reprise. Tes emplacements
                gardés, eux, sont intacts.
              </em>
            </div>
          )}

          {closing && (
            <div className="gba-boot">
              <Loader2 size={22} className="spin" />
              <strong>Sauvegarde de la partie…</strong>
              <span>Elle t'attendra sur ton compte, où que tu reprennes.</span>
            </div>
          )}
        </div>

        {/* ---------------- l'étiquette ----------------
            Le titre ne mérite pas une barre à lui : il se dit une fois, dans un
            coin, et laisse la console tranquille. */}
        <div className="gba-tag">
          <span className="gba-led" aria-hidden="true" />
          <div>
            <strong>{media.title}</strong>
            <em>
              {["Game Boy Advance", media.cartridge?.region, engine.label]
                .filter(Boolean)
                .join(" · ")}
            </em>
          </div>
        </div>

        {flash && (
          <p className="gba-flash" role="status">
            <Check size={13} /> {flash.msg}
          </p>
        )}

        {/* ---------------- la colonne de commandes ----------------
            Contre le bord droit, en colonne : c'est la seule place qui ne
            retire pas un pixel de hauteur à la console. Les libellés sortent au
            survol, vers l'intérieur. */}
        <div className="gba-rack">
          <button
            className="gba-btn clickable"
            onClick={togglePause}
            disabled={phase !== "on"}
            data-tip={paused ? "Reprendre" : "Pause"}
            aria-label={paused ? "Reprendre" : "Mettre en pause"}
          >
            {paused ? <Play size={17} fill="currentColor" /> : <Pause size={17} />}
          </button>
          <button
            className="gba-btn clickable"
            onClick={restart}
            disabled={phase !== "on"}
            data-tip="Redémarrer"
            aria-label="Redémarrer la console"
          >
            <RotateCcw size={17} />
          </button>
          <button
            className="gba-btn clickable"
            onClick={toggleSound}
            data-tip={muted ? "Remettre le son" : "Couper le son"}
            aria-label={muted ? "Remettre le son" : "Couper le son"}
          >
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>

          <span className="gba-sep" aria-hidden="true" />

          {/* Les sauvegardes en TÊTE de ce groupe, et avec une pastille quand il y
              a une partie en réserve : c'est la commande qu'on vient chercher. */}
          <div className="gba-pop">
            <button
              className={`gba-btn clickable ${menu === "saves" ? "on" : ""} ${
                saves.length ? "dot" : ""
              }`}
              onClick={() => setMenu((m) => (m === "saves" ? null : "saves"))}
              disabled={phase !== "on"}
              data-tip="Sauvegardes"
              aria-label="Sauvegardes"
            >
              <Save size={17} />
            </button>
          </div>

          <div className="gba-pop">
            <button
              className={`gba-btn clickable ${menu === "keys" ? "on" : ""}`}
              onClick={() => setMenu((m) => (m === "keys" ? null : "keys"))}
              data-tip="Touches"
              aria-label="Réglage des touches"
            >
              <Keyboard size={17} />
            </button>
          </div>

          {/* Deux dispositions seulement : un interrupteur, pas un menu. */}
          <button
            className={`gba-btn clickable ${!shape.shell ? "on" : ""}`}
            onClick={toggleLayout}
            data-tip={shape.shell ? "Écran seul" : "Voir la console"}
            aria-label={shape.shell ? "Afficher l'écran seul" : "Afficher la console"}
            aria-pressed={!shape.shell}
          >
            <LayoutGrid size={17} />
          </button>

          <div className="gba-pop">
            <button
              className={`gba-btn clickable ${menu === "core" ? "on" : ""}`}
              onClick={() => setMenu((m) => (m === "core" ? null : "core"))}
              data-tip={`Moteur · ${engine.label}`}
              aria-label="Changer de moteur d'émulation"
            >
              <Cpu size={17} />
            </button>
            {menu === "core" && (
              <div className="gba-menu">
                <p className="gba-menu-title">Moteur</p>
                {CORES.map((c) => (
                  <button
                    key={c.value}
                    className={`clickable ${c.value === core ? "on" : ""}`}
                    onClick={() => pickEngine(c.value)}
                  >
                    <span>
                      <strong>{c.label}</strong>
                      <em>{c.hint}</em>
                    </span>
                    {c.value === core && <Check size={14} />}
                  </button>
                ))}
                <p className="gba-menu-note">
                  La partie en cours est sauvegardée avant de changer. Attention :
                  une sauvegarde ne se relit que dans le moteur qui l'a écrite.
                </p>
              </div>
            )}
          </div>

          <button
            className={`gba-btn clickable ${raw ? "on" : ""}`}
            onClick={toggleRaw}
            data-tip="Panneau de l'émulateur"
            aria-label="Panneau de l'émulateur"
            aria-pressed={raw}
          >
            <SlidersHorizontal size={17} />
          </button>

          <span className="gba-sep" aria-hidden="true" />

          <button
            className="gba-btn clickable"
            onClick={toggleFull}
            data-tip={full ? "Quitter le plein écran" : "Plein écran"}
            aria-label={full ? "Quitter le plein écran" : "Plein écran"}
          >
            {full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button
            className="gba-btn power clickable"
            onClick={close}
            disabled={closing}
            data-tip="Éteindre"
            aria-label="Éteindre"
          >
            <Power size={17} />
          </button>
        </div>

        {/* ---------------- les panneaux ---------------- */}
        {menu === "saves" && (
          <div className="gba-panel">
            <GbaSaves
              saves={saves}
              slots={slots}
              core={core}
              busy={savesBusy}
              error={savesError}
              playSeconds={total}
              onLoad={restore}
              onSave={(slot) => store(slot)}
              onDelete={forget}
              onClose={() => setMenu(null)}
            />
          </div>
        )}

        {menu === "keys" && (
          <div className="gba-panel">
            <div className="gba-keys" role="dialog" aria-label="Touches">
              <header>
                <div>
                  <strong>Touches</strong>
                  <em>
                    Choisis une manette toute faite, ou clique une touche pour la
                    changer.
                  </em>
                </div>
                <button
                  className="clickable"
                  onClick={() => setMenu(null)}
                  aria-label="Fermer"
                >
                  <Check size={15} />
                </button>
              </header>

              {/* LES JEUX TOUT FAITS D'ABORD, et c'est le point. « Rends le
                  mappage facile » ne veut pas dire « rends chaque touche
                  réassignable » — ça l'était déjà, et personne n'y touchait. Ça
                  veut dire : que la manette soit bonne en un clic. */}
              <div className="gba-preset-row">
                {PRESETS.map((p) => (
                  <button
                    key={p.value}
                    className={`gba-preset clickable ${preset === p.value ? "on" : ""}`}
                    onClick={() => setKeys({ ...p.keys })}
                  >
                    <strong>{presetLabel(p, keys)}</strong>
                    <em>{p.hint}</em>
                    {preset === p.value && <Check size={13} />}
                  </button>
                ))}
              </div>

              <div className="gba-keys-list">
                {BUTTONS.map((b) => (
                  <button
                    key={b.id}
                    className={`gba-keyrow clickable ${capturing === b.id ? "waiting" : ""}`}
                    onClick={() => setCapturing(b.id)}
                  >
                    <span className="gba-keyrow-name">{b.label}</span>
                    <kbd>
                      {capturing === b.id
                        ? "Appuie…"
                        : keys[b.id]?.label || "non assignée"}
                    </kbd>
                  </button>
                ))}
              </div>

              <footer>
                <span>
                  <Gamepad2 size={13} /> Une manette branchée marche telle quelle,
                  sans rien régler.
                </span>
                {preset !== PRESETS[0].value && (
                  <button
                    className="btn btn-ghost clickable"
                    onClick={() => setKeys({ ...PRESETS[0].keys })}
                  >
                    <RotateCcw size={14} /> Tout par défaut
                  </button>
                )}
              </footer>
            </div>
          </div>
        )}

        {deaf && (
          <p className="gba-deaf">
            Ce cœur n'accepte pas les commandes de la page — passe par le panneau
            de l'émulateur pour jouer et remapper.
          </p>
        )}
      </div>
    </div>,
    document.body
  );
}
