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
  Check,
  Save,
  Keyboard,
  Gamepad2,
  Camera,
  FastForward,
  MonitorCog,
  MoreHorizontal,
  AlertTriangle,
  Radio,
  Settings,
  X,
} from "lucide-react";
import { useScrollLock } from "../hooks/useScrollLock";
import { useBackClose } from "../hooks/useBackClose";
import { useLiveStatus } from "../lib/presence";
import GbaPad from "./GbaPad";
import GbaSaves from "./GbaSaves";
import GbaBroadcast, { LiveBadge, StartingBadge } from "./GbaBroadcast";
import { useGbaBroadcast } from "../hooks/useGbaBroadcast";
import {
  CORES,
  CORE_KEY,
  consoleDoc,
  coreOf,
  savedCore,
  muteKeys,
  EJS_DATA,
} from "../lib/gbaEmulator";
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
  applyVideo,
  fitScreen,
  loadView,
  padByDefault,
  saveView,
} from "../lib/gbaView";
import {
  AUTO_SLOT,
  deleteSave,
  listSaves,
  readSave,
  writeSave,
} from "../lib/gbaSaves";
import { fmtDuration } from "../lib/collection";

// ======================================================================
//  Le lecteur Game Boy Advance
// ======================================================================
// LA COQUE DESSINÉE A ÉTÉ RETIRÉE, ET C'EST LE SUJET DE CETTE VERSION.
//
// Il y avait une Game Boy Advance en SVG : coque grise, croix, A et B, gâchettes,
// sérigraphie. C'était fidèle, c'était beau une fois — et à chaque partie, ça
// coûtait les DEUX TIERS DE LA FENÊTRE pour montrer du plastique. Un écran de
// 240 × 160 finissait affiché dans un timbre-poste au milieu d'un dessin, et
// c'est l'écran qu'on est venu regarder.
//
// CE QUI LE REMPLACE N'EST PAS « LA MÊME CHOSE EN PLUS SOBRE » :
//
//   • L'ÉCRAN PREND TOUTE LA PLACE, et sa taille est CALCULÉE, pas subie :
//     on cherche le plus grand multiple entier de 240 × 160 qui tienne dans la
//     fenêtre (voir gbaView.js). Chaque pixel du jeu devient un carré exact —
//     c'est ce qui fait la différence entre une image de jeu rétro et une bouillie
//     interpolée.
//   • LES COMMANDES S'EFFACENT. Une seconde sans un geste et il ne reste que le
//     jeu. Le moindre mouvement les rappelle. On ne joue pas dans un cockpit.
//   • LA MANETTE À L'ÉCRAN EST UNE VRAIE MANETTE (voir GbaPad) : croix à huit
//     directions — la coque n'en faisait que quatre, donc pas de diagonale, donc
//     pas de Zelda —, glissement entre A et B, vibration à l'appui.
//   • CE QUI MANQUAIT EST ARRIVÉ : avance rapide, capture d'écran, volume,
//     sauvegarde et reprise au clavier (F5 / F8), verrouillage en paysage sur
//     téléphone.
//
// CE QUI RESTE DE L'ANCIEN, PARCE QUE C'ÉTAIT JUSTE :
//
//   • la PARTIE EST CHEZ NOUS — un état de machine par emplacement, sur le
//     serveur, à ton nom (GbaSaves et lib/gbaSaves.js) ;
//   • le TEMPS DE JEU compté par tranches, et seulement ce qui est VRAIMENT joué
//     (console en marche, onglet visible) ;
//   • l'écoute du clavier SUR LES DEUX FENÊTRES, et le silence imposé à celui
//     d'EmulatorJS (`muteKeys`) : l'iframe est cliquable (il lui faut le premier
//     clic pour débloquer son contexte audio), donc elle peut prendre le focus, et
//     sans ces deux précautions une touche enfoncerait deux boutons ;
//   • l'iframe qui EST l'écran, jamais démontée en cours de partie.

const TICK = 5; // secondes entre deux relevés
const FLUSH = 60; // on n'écrit le temps de jeu au serveur qu'à la minute
const AUTOSAVE = 120; // secondes entre deux sauvegardes automatiques
const BOOT_TIMEOUT = 30000; // au-delà, les cœurs ne viendront pas
const ASK_TIMEOUT = 8000; // une console qui ne répond pas a un problème
const CLOSE_TIMEOUT = 2500; // on n'attend pas huit secondes pour éteindre
// Sans un geste, les commandes s'effacent. UNE SECONDE : c'est court, et c'est
// voulu — la barre revient au moindre mouvement, donc le vrai coût d'un délai
// trop long n'est pas de la rappeler, c'est de la voir traîner sur le jeu à
// chaque fois qu'on a bougé la souris pour rien. Tant qu'on la survole, elle
// reste (voir `overDock`) : ce n'est pas de l'inactivité, c'est une hésitation
// devant un bouton.
const IDLE = 1000;

// On rend l'orientation au téléphone en sortant : la garder verrouillée en
// paysage après la partie coucherait le reste du site.
function unlockOrientation() {
  try {
    window.screen?.orientation?.unlock?.();
  } catch {
    /* rien à rendre */
  }
}

export default function GbaPlayer({ media, token, onClose, onPlayed }) {
  const [core, setCore] = useState(savedCore);
  const [phase, setPhase] = useState("boot"); // boot | on | nodata | slow
  const [paused, setPaused] = useState(false);
  const [full, setFull] = useState(false);
  const [raw, setRaw] = useState(false); // panneau de l'émulateur ouvert
  const [sheet, setSheet] = useState(null); // "saves" | "keys" | "view" | "more"
  const [keys, setKeys] = useState(loadKeys);
  const [view, setView] = useState(loadView);
  const [pad, setPad] = useState(() => loadView().pad ?? padByDefault());
  const [capturing, setCapturing] = useState(null); // bouton en réapprentissage
  const [deaf, setDeaf] = useState(false); // le cœur n'écoute pas nos boutons
  const [ff, setFf] = useState(false); // avance rapide en cours
  const [ffOk, setFfOk] = useState(false); // ce cœur sait-il accélérer ?
  const [box, setBox] = useState(null); // la boîte calculée de l'écran
  const [awake, setAwake] = useState(true); // les commandes sont-elles visibles ?
  const [overDock, setOverDock] = useState(false); // le pointeur est sur la barre

  // --- les sauvegardes ---
  const [saves, setSaves] = useState([]);
  const [slots, setSlots] = useState(6);
  const [savesBusy, setSavesBusy] = useState(null); // emplacement en cours
  const [savesError, setSavesError] = useState(null);
  const [offer, setOffer] = useState(false); // « reprendre ta partie ? »
  const [closing, setClosing] = useState(false);
  const [flash, setFlash] = useState(null);

  // Le temps de jeu TOTAL, celui qui s'écrit sous une vignette. Parti de ce que le
  // serveur sait déjà, augmenté au fil de la partie.
  //
  // DOUBLÉ EN RÉF, et ce n'est pas de la redondance. La sauvegarde a besoin de le
  // LIRE ; si elle en dépendait, elle serait reconstruite toutes les cinq secondes
  // — et le minuteur de la sauvegarde automatique, qui dépend d'elle, repartirait
  // de zéro à chaque top. Il ne se déclencherait jamais.
  const totalRef = useRef(media.progress?.playSeconds || 0);
  const [total, setTotal] = useState(totalRef.current);

  const frame = useRef(null);
  const shell = useRef(null);
  const viewport = useRef(null);
  const pending = useRef(0); // secondes jouées, pas encore envoyées
  const busy = useRef(false); // une sauvegarde est en vol
  const gone = useRef(false); // on est en train d'éteindre
  const sleeper = useRef(null); // le minuteur qui efface les commandes

  useScrollLock(true);

  const rom = media.cartridge?.rom;
  const tint = media.color || "#f2b70b";
  const engine = coreOf(core);

  // Le document de la console. Recalculé au changement de moteur SEULEMENT :
  // toute autre dépendance ferait redémarrer le jeu en cours de partie.
  const doc = useMemo(
    () => consoleDoc({ rom, core, name: media.title, slug: media.slug, tint }),
    [rom, core, media.title, media.slug, tint]
  );

  // L'émulateur, quand il est là. Toujours par cette fonction : le contenu de
  // l'iframe disparaît entre deux rendus (changement de moteur, fermeture), et une
  // référence gardée de côté pointerait alors dans le vide.
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

  // Les deux fenêtres qui peuvent recevoir une touche : la page, et le document du
  // jeu quand il a le focus. Tout ce qui écoute le clavier passe par là — n'en
  // écouter qu'une fait une console qui s'arrête de répondre dès qu'on a cliqué
  // l'écran une fois.
  const bothWindows = useCallback(() => {
    const inner = win();
    return inner && inner !== window ? [window, inner] : [window];
  }, [win]);

  const say = useCallback((msg, ok = true) => {
    setFlash({ msg, ok, at: Date.now() });
  }, []);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(t);
  }, [flash]);


  // ------------------------------------------------------ les préférences --
  const setPref = useCallback((patch) => {
    setView((v) => {
      const next = { ...v, ...patch };
      saveView(next);
      return next;
    });
  }, []);

  const togglePad = useCallback(() => {
    const next = !pad;
    setPad(next);
    setPref({ pad: next });
  }, [pad, setPref]);

  // ---------------------------------------------------- la taille de l'écran --
  //
  // ELLE SE CALCULE, ET C'EST TOUT LE PROPOS DE CETTE VERSION. `aspect-ratio` en
  // CSS aurait suffi à ne pas déformer l'image, mais pas à la rendre NETTE : à
  // l'échelle 2,7, une ligne de pixels sur trois est plus épaisse que les autres,
  // et ça scintille dès que le décor défile. On cherche donc la plus grande boîte
  // qui tienne — au multiple entier près quand le réglage le demande.
  useLayoutEffect(() => {
    const host = viewport.current;
    if (!host) return undefined;
    const measure = () => {
      const fit = fitScreen(
        { width: host.clientWidth, height: host.clientHeight },
        { integer: view.integer }
      );
      if (fit) setBox(fit);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [view.integer]);

  // ------------------------------------------------------------- le temps --
  //
  // Le rapporteur est gardé EN RÉF, et `flushTime` ne dépend de rien. Sans ça, un
  // parent qui passe une fonction anonyme (le cas courant : `onPlayed={(s) => …}`)
  // en fabrique une nouvelle à chaque rendu — et le relevé du temps, dont le
  // nettoyage envoie ce qui reste, se démonterait et se remonterait avec elle. Le
  // minuteur repartirait de zéro à chaque fois : une partie entière pourrait ne
  // jamais atteindre son premier top.
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

  // Le reliquat part à la fermeture : sans ça, une partie de cinquante secondes ne
  // compterait jamais pour rien.
  useEffect(() => () => flushTime(), [flushTime]);

  // ============================================================ le dialogue ==
  //
  // Tout ce qui demande une réponse à l'iframe passe par ici : on numérote la
  // question, on garde la promesse de côté, et le message de retour la résout.
  //
  // AVEC UN DÉLAI DE GARDE, et c'est indispensable : le seul cas où l'on parle à
  // l'iframe est la sauvegarde, donc le seul cas où une absence de réponse ferait
  // ATTENDRE quelqu'un devant un bouton qui tourne.
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

  // Ce que le cœur accepte : nos boutons, le silence côté clavier, l'accélération.
  // Les trois se demandent une fois la partie lancée, et une fois le panneau
  // refermé — il y remet parfois ses touches.
  //
  // ON REDEMANDE PLUSIEURS FOIS AVANT DE CONCLURE. Le cœur annonce son démarrage
  // AVANT d'avoir fini de s'installer : sur une machine lente (ou un téléphone),
  // `gameManager` n'existe pas encore une demi-seconde plus tard. Une seule
  // question, et l'on affichait « ce cœur n'accepte pas les commandes » sur une
  // console parfaitement jouable — le bandeau restait là toute la partie,
  // puisque rien ne le rouvrait.
  useEffect(() => {
    if (phase !== "on") return undefined;
    let tries = 0;
    const ask = () => {
      const w = win();
      const ok = canPress(w);
      if (ok) {
        setDeaf(false);
        muteKeys(w);
        try {
          setFfOk(typeof w?.EJS_emulator?.gameManager?.toggleFastForward === "function");
        } catch {
          setFfOk(false);
        }
        clearInterval(id);
        return;
      }
      // Dix secondes d'attente : au-delà, ce n'est plus un démarrage lent.
      if ((tries += 1) >= 20) {
        setDeaf(true);
        clearInterval(id);
      }
    };
    const id = setInterval(ask, 500);
    return () => clearInterval(id);
  }, [phase, raw, win]);

  // La netteté — et le pointeur — se règlent DANS le document du jeu : c'est là
  // qu'est le canvas, et c'est au-dessus de lui que la souris passe son temps.
  // Donc à chaque nouveau document, chaque nouveau réglage, et chaque fois que
  // l'interface s'endort ou se réveille.
  useEffect(() => {
    if (phase !== "on") return undefined;
    const t = setTimeout(
      () => applyVideo(win(), { smooth: view.smooth, cursor: awake }),
      120
    );
    return () => clearTimeout(t);
  }, [phase, core, view.smooth, awake, win]);

  // Le volume est une préférence, pas un état de séance : il se retrouve d'une
  // partie à l'autre. On le pose dès que le moteur est là.
  useEffect(() => {
    if (phase !== "on") return;
    try {
      const e = emu();
      if (e?.setVolume) e.setVolume(view.volume);
      else if (e) e.volume = view.volume;
    } catch {
      /* moteur pas encore prêt : le réglage suivant repassera */
    }
  }, [phase, view.volume, emu]);

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
        // Une sauvegarde automatique qui échoue ne DÉRANGE pas — mais elle se dit
        // quand même dans le tiroir, sinon on croit être à l'abri.
        setSavesError(e.message);
        if (!quiet) say(e.message, false);
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
        setSheet(null);
        setPaused(false);
        say(slot === AUTO_SLOT ? "Partie reprise" : `Emplacement ${slot} chargé`);
      } catch (e) {
        setSavesError(e.message);
        say(e.message, false);
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
  // manette à l'écran. Un seul chemin d'entrée, donc un seul à faire marcher.
  const push = useCallback((index, down) => pressButton(win(), index, down), [win]);

  // ============================================================ la diffusion ==
  //
  // « VIENS VOIR » : l'écran part en direct chez ceux à qui on donne le lien, et
  // l'on peut leur PASSER LA MANETTE. Ce dernier point ne coûte presque rien
  // ici, et c'est le dessin de ce fichier qui le permet : toute commande — le
  // clavier, la manette à l'écran, et maintenant un spectateur à l'autre bout
  // d'une connexion — emprunte la MÊME porte, `push`. Il n'y a jamais eu qu'un
  // seul chemin d'entrée à faire marcher.
  const cast = useGbaBroadcast({ token, slug: media.slug, win, onInput: push });

  // Un ennui de diffusion se dit tout de suite : le panneau, lui, ne s'ouvre que
  // si la diffusion a démarré — un échec au démarrage n'aurait donc nulle part
  // où s'afficher, et le bouton semblerait ne rien faire.
  useEffect(() => {
    if (cast.error) say(cast.error, false);
  }, [cast.error, say]);

  // « Joue sur Game Boy Advance · Zelda » dans le rail « en ce moment » des gens
  // qui me suivent. L'annonce est ICI et non dans la page de la fiche : la
  // console s'ouvre aussi depuis l'étagère et depuis l'aperçu d'admin, et un
  // statut posé sur la page raterait ces deux chemins.
  //
  // EN DIRECT, LE LIEN CHANGE : « Rejoindre » mène alors à la diffusion et non à
  // la fiche du jeu — c'est tout l'intérêt d'avoir les deux au même endroit.
  useLiveStatus("gba", media.title || "", {
    token,
    active: phase === "on",
    path: cast.room ? `/gba/${cast.room.code}` : `/collection/${media.slug}`,
  });

  useEffect(() => {
    if (capturing || raw || paused || phase !== "on") return undefined;
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
    const targets = bothWindows();
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
  }, [keys, capturing, raw, paused, phase, push, bothWindows]);

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

  // La frappe qui apprend une touche. En capture, donc AVANT tout le reste, et
  // arrêtée net : une partie ne doit pas recevoir la touche qu'on lui assigne.
  useEffect(() => {
    if (!capturing) return undefined;
    function onKey(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key !== "Escape") setKeys((k) => assign(k, capturing, e.code, keyLabel(e)));
      setCapturing(null);
    }
    const targets = bothWindows();
    for (const t of targets) {
      try {
        t.addEventListener("keydown", onKey, true);
      } catch {
        /* document jeté */
      }
    }
    return () => {
      for (const t of targets) {
        try {
          t.removeEventListener("keydown", onKey, true);
        } catch {
          /* rien à retirer */
        }
      }
    };
  }, [capturing, bothWindows]);

  // ------------------------------------------------------------ commandes --
  const togglePause = useCallback(() => {
    const next = !paused;
    try {
      const e = emu();
      if (next) e?.pause?.();
      else e?.play?.();
    } catch {
      /* moteur pas encore prêt : l'état d'affichage suit quand même */
    }
    setPaused(next);
  }, [emu, paused]);

  const restart = useCallback(() => {
    try {
      emu()?.gameManager?.restart?.();
    } catch {
      /* rien : le panneau de l'émulateur offre la même chose */
    }
    setPaused(false);
    say("Partie redémarrée");
  }, [emu, say]);

  // L'AVANCE RAPIDE, celle qui manquait le plus. Un RPG demande de traverser
  // trois écrans de texte et deux couloirs vides ; sans elle, on les traverse en
  // temps réel. Le cœur ne sait pas toujours le faire (d'où `ffOk`) : dans ce cas
  // le bouton n'existe pas, plutôt que d'exister sans rien faire.
  const toggleFf = useCallback(() => {
    const next = !ff;
    try {
      const gm = emu()?.gameManager;
      gm?.setFastForwardRatio?.(3);
      gm?.toggleFastForward?.(next ? 1 : 0);
      setFf(next);
    } catch {
      setFfOk(false);
    }
  }, [emu, ff]);

  const toggleSound = useCallback(() => {
    setPref({ volume: view.volume > 0 ? 0 : 1 });
  }, [setPref, view.volume]);

  // LA CAPTURE PART DU CANVAS DU CŒUR, agrandie ×3 sans lissage : une image de
  // 240 × 160 n'est pas partageable, et la même redimensionnée par le navigateur
  // serait floue. On la rend en pixels francs, comme à l'écran.
  const snap = useCallback(async () => {
    try {
      const src = emu()?.canvas;
      if (!src?.width || !src?.height) throw new Error("Écran illisible.");
      const cv = document.createElement("canvas");
      cv.width = 720;
      cv.height = 480;
      const ctx = cv.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, cv.width, cv.height);
      const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
      if (!blob) throw new Error("Image vide.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${media.slug}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      say("Capture enregistrée");
    } catch {
      say("La capture n'a pas pu être prise.", false);
    }
  }, [emu, media.slug, say]);

  // Le panneau de l'émulateur : on révèle l'iframe en grand, barre d'EmulatorJS
  // comprise. Filtres, tricheurs, réglages du cœur y vivent — les réécrire
  // n'apporterait rien.
  const toggleRaw = useCallback(() => {
    const next = !raw;
    try {
      frame.current?.contentWindow?.document?.body?.classList.toggle("bare", !next);
    } catch {
      /* pas de document : rien à montrer */
    }
    setRaw(next);
    setSheet(null);
  }, [raw]);

  // LE PLEIN ÉCRAN COUCHE LE TÉLÉPHONE. Une GBA est un objet en paysage : sur un
  // portable tenu debout, l'écran occupe le tiers de la dalle. On demande donc la
  // rotation — et si le navigateur refuse (iOS ne l'expose pas), rien n'est perdu :
  // la mise en page portrait existe.
  const toggleFull = useCallback(() => {
    const node = shell.current;
    if (!node) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      unlockOrientation();
      return;
    }
    node
      .requestFullscreen?.()
      .then(() => {
        try {
          // La promesse est rejetée sur les navigateurs qui n'en veulent pas
          // (iOS n'expose rien du tout) : sans ce `catch`, ça remonte en erreur
          // non gérée dans la console pour un confort qu'on peut perdre.
          window.screen?.orientation?.lock?.("landscape")?.catch?.(() => {});
        } catch {
          /* refusé : la mise en page portrait prend le relais */
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ------------------------------------------------ le téléphone se couche --
  //
  // UNE GBA EST UN OBJET EN PAYSAGE. Sur un téléphone tenu debout, l'écran
  // occupe le tiers de la dalle et les pouces se marchent dessus : la console
  // s'ouvre donc COUCHÉE, sans qu'on ait à le demander.
  //
  // Le verrouillage d'orientation EXIGE le plein écran (règle des navigateurs),
  // d'où l'enchaînement des deux. Et il ne marche qu'après un geste : ici on
  // l'obtient du clic qui a lancé la console — d'où l'appel au montage, tant que
  // ce clic « compte » encore. Si le navigateur refuse (iOS n'expose rien), rien
  // n'est perdu : la mise en page portrait existe et prend le relais.
  useEffect(() => {
    if (!padByDefault()) return; // appareil sans tactile : on ne touche à rien
    const node = shell.current;
    if (!node || document.fullscreenElement) return;
    node
      .requestFullscreen?.()
      .then(() => window.screen?.orientation?.lock?.("landscape")?.catch?.(() => {}))
      .catch(() => {
        /* refusé (geste trop vieux, navigateur récalcitrant) : on joue debout */
      });
  }, []);

  // ------------------------------------------- les commandes qui s'effacent --
  //
  // TROIS SECONDES SANS UN GESTE ET IL NE RESTE QUE LE JEU. C'est ce qui remplace
  // le mode « écran seul » de l'ancienne version : plus de disposition à choisir,
  // l'interface se retire d'elle-même et revient au moindre mouvement.
  //
  // ON ÉCOUTE AUSSI DANS L'IFRAME : la souris passe le plus clair de son temps
  // au-dessus de l'écran du jeu, et ces mouvements-là ne remontent pas à la page.
  // Sans cette écoute, les commandes disparaîtraient pour ne jamais revenir.
  const wake = useCallback(() => {
    setAwake(true);
    clearTimeout(sleeper.current);
    sleeper.current = setTimeout(() => setAwake(false), IDLE);
  }, []);

  useEffect(() => {
    // Le pointeur POSÉ SUR LA BARRE n'est pas de l'inactivité : c'est quelqu'un
    // qui cherche un bouton, ou qui règle son volume sans bouger d'un pixel.
    // Sans ce cas, la barre s'évanouissait sous le curseur au bout d'une
    // seconde — et le réglage de volume, qui en sort, avec elle.
    const busyNow =
      phase !== "on" || paused || sheet || raw || offer || closing || overDock;
    if (busyNow) {
      clearTimeout(sleeper.current);
      setAwake(true);
      return undefined;
    }
    wake();
    const targets = bothWindows();
    for (const t of targets) {
      try {
        t.addEventListener("pointermove", wake);
        t.addEventListener("pointerdown", wake);
        t.addEventListener("keydown", wake);
      } catch {
        /* document jeté */
      }
    }
    return () => {
      clearTimeout(sleeper.current);
      for (const t of targets) {
        try {
          t.removeEventListener("pointermove", wake);
          t.removeEventListener("pointerdown", wake);
          t.removeEventListener("keydown", wake);
        } catch {
          /* rien à retirer */
        }
      }
    };
  }, [phase, paused, sheet, raw, offer, closing, overDock, core, wake, bothWindows]);

  // ------------------------------------------------------------ éteindre --
  //
  // ON SAUVEGARDE AVANT DE PARTIR, et on le montre. C'est la seule attente qu'on
  // impose au joueur, et elle est justifiée : sans elle, fermer perdrait la partie
  // — l'iframe est jetée avec le composant, et on ne peut plus rien lui demander
  // après. BORNÉE À DEUX SECONDES ET DEMIE : un cœur en panne ne doit pas pouvoir
  // retenir quelqu'un qui veut sortir.
  const close = useCallback(async () => {
    if (gone.current) return;
    gone.current = true;
    flushTime();
    unlockOrientation();
    if (phase === "on" && !raw) {
      setClosing(true);
      await store(AUTO_SLOT, { quiet: true, timeout: CLOSE_TIMEOUT });
    }
    onClose();
  }, [flushTime, onClose, phase, raw, store]);

  useBackClose(close, "gba");

  // --------------------------------------------------- les raccourcis clavier --
  //
  // ILS S'EFFACENT DEVANT LA MANETTE : si F5 a été assigné au bouton A, c'est le
  // bouton A qu'il fait. Un raccourci de confort ne prend jamais le pas sur une
  // touche de jeu — sinon on sauvegarde en sautant.
  useEffect(() => {
    if (phase !== "on" || capturing) return undefined;
    const taken = new Set(
      BUTTONS.map((b) => keys[b.id]?.code).filter(Boolean)
    );
    function onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (taken.has(e.code)) return;
      if (e.code === "F5") {
        e.preventDefault();
        store(AUTO_SLOT);
      } else if (e.code === "F8") {
        e.preventDefault();
        restore(AUTO_SLOT);
      } else if (e.code === "F2") {
        e.preventDefault();
        snap();
      } else if (e.code === "KeyP") {
        e.preventDefault();
        togglePause();
      }
    }
    const targets = bothWindows();
    for (const t of targets) {
      try {
        t.addEventListener("keydown", onKey);
      } catch {
        /* document jeté */
      }
    }
    return () => {
      for (const t of targets) {
        try {
          t.removeEventListener("keydown", onKey);
        } catch {
          /* rien à retirer */
        }
      }
    };
  }, [phase, capturing, keys, store, restore, snap, togglePause, bothWindows]);

  // Échap sert d'abord à refermer ce qui est ouvert par-dessus.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || document.fullscreenElement) return;
      if (capturing) return; // c'est l'écoute en capture qui l'annule
      if (sheet) return setSheet(null);
      if (raw) return toggleRaw();
      return close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, sheet, raw, capturing, toggleRaw]);

  function pickEngine(value) {
    setSheet(null);
    if (value === core) return;
    flushTime();
    // Changer de moteur jette le document, donc la partie en cours. On la
    // sauvegarde AVANT — et comme un état appartient à son cœur (voir GbaSaves),
    // la sauvegarde part sous l'ANCIEN nom de moteur : c'est elle qu'on retrouvera
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
      setFf(false);
      setCore(value);
    });
  }

  if (!rom)
    return createPortal(
      <div className="gbx-stage" style={{ "--tint": tint }}>
        <div className="gbx-fail">
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
  const muted = view.volume <= 0;
  const chrome = awake || phase !== "on" || paused || !!sheet || raw || offer;

  // ------------------------------------------------------------ les actions --
  //
  // UNE SEULE LISTE, DEUX RENDUS. Les principales tiennent dans la barre sur
  // n'importe quel téléphone ; les autres s'y ajoutent dès qu'il y a la place, et
  // se retrouvent sinon derrière « … », en clair, avec leur nom. Deux listes à
  // tenir en parallèle finiraient toujours par diverger.
  const acts = [
    {
      id: "pause",
      main: true,
      icon: paused ? Play : Pause,
      fill: paused,
      label: paused ? "Reprendre" : "Pause",
      onClick: togglePause,
      disabled: phase !== "on",
    },
    {
      id: "ff",
      icon: FastForward,
      label: "Avance rapide",
      onClick: toggleFf,
      on: ff,
      hidden: !ffOk,
      disabled: phase !== "on",
    },
    {
      id: "restart",
      icon: RotateCcw,
      label: "Redémarrer",
      onClick: restart,
      disabled: phase !== "on",
    },
    {
      id: "saves",
      main: true,
      icon: Save,
      label: "Sauvegardes",
      onClick: () => setSheet((s) => (s === "saves" ? null : "saves")),
      on: sheet === "saves",
      dot: saves.length > 0,
      disabled: phase !== "on",
    },
    {
      id: "snap",
      icon: Camera,
      label: "Capture d'écran",
      onClick: snap,
      disabled: phase !== "on",
    },
    {
      id: "cast",
      main: true,
      icon: Radio,
      label: cast.live ? "Diffusion en cours" : "Diffuser ma partie",
      // Premier clic : on allume. Ensuite le bouton ouvre le panneau — on
      // n'éteint pas une diffusion par mégarde en cherchant qui regarde.
      onClick: () => (cast.live ? setSheet((s) => (s === "cast" ? null : "cast")) : cast.start()),
      on: cast.live,
      disabled: phase !== "on" || cast.starting,
    },
    {
      id: "sound",
      icon: muted ? VolumeX : Volume2,
      label: muted ? "Remettre le son" : "Couper le son",
      onClick: toggleSound,
      on: muted,
    },
    {
      id: "pad",
      main: true,
      icon: Gamepad2,
      label: pad ? "Cacher la manette" : "Manette à l'écran",
      onClick: togglePad,
      on: pad,
    },
    {
      id: "keys",
      icon: Keyboard,
      label: "Touches",
      onClick: () => setSheet((s) => (s === "keys" ? null : "keys")),
      on: sheet === "keys",
    },
    {
      id: "view",
      icon: MonitorCog,
      label: "Image et moteur",
      onClick: () => setSheet((s) => (s === "view" ? null : "view")),
      on: sheet === "view",
    },
    {
      id: "raw",
      icon: SlidersHorizontal,
      label: "Panneau de l'émulateur",
      onClick: toggleRaw,
      on: raw,
    },
    {
      id: "full",
      main: true,
      icon: full ? Minimize2 : Maximize2,
      label: full ? "Quitter le plein écran" : "Plein écran",
      onClick: toggleFull,
    },
  ].filter((a) => !a.hidden);

  // Un bouton de la barre. Une FONCTION, pas un composant imbriqué : un composant
  // défini dans le rendu change d'identité à chaque passage, et React démonte puis
  // remonte tous les boutons — le focus saute, et l'infobulle clignote.
  const dockBtn = (act) => {
    const Icon = act.icon;
    return (
      <button
        key={act.id}
        className={`gbx-btn clickable ${act.main ? "main" : ""} ${act.on ? "on" : ""} ${
          act.dot ? "dot" : ""
        }`}
        onClick={act.onClick}
        disabled={act.disabled}
        data-tip={act.label}
        aria-label={act.label}
        aria-pressed={act.on === undefined ? undefined : !!act.on}
      >
        <Icon size={18} fill={act.fill ? "currentColor" : "none"} />
      </button>
    );
  };

  return createPortal(
    <div
      className={`gbx-stage ${phase === "on" ? "lit" : ""} ${raw ? "raw" : ""} ${
        chrome ? "" : "asleep"
      } ${pad ? "padded" : ""} ${view.crt ? "crt" : ""}`}
      style={{ "--tint": tint }}
      role="dialog"
      aria-label={`${media.title} — Game Boy Advance`}
    >
      <div className="gbx-shell" ref={shell}>
        {/* ---------------- l'écran ----------------
            IL EST L'IFRAME ELLE-MÊME, à la taille calculée : pas une recopie, pas
            un canvas intermédiaire. Et il n'est JAMAIS démonté tant que le moteur
            ne change pas — le démonter relancerait le jeu en pleine partie. */}
        <div className="gbx-viewport" ref={viewport}>
          <div
            className={`gbx-screen ${paused ? "held" : ""}`}
            style={
              raw || !box
                ? undefined
                : { width: `${Math.round(box.width)}px`, height: `${Math.round(box.height)}px` }
            }
          >
            <iframe
              key={core}
              ref={frame}
              className="gbx-feed"
              title={`${media.title} — écran`}
              srcDoc={doc}
              // Le plein écran d'EmulatorJS part de SON document : sans cette
              // permission, son bouton ne fait rien du tout.
              allow="fullscreen; autoplay; gamepad"
            />
            {view.crt && <span className="gbx-scan" aria-hidden="true" />}
            {paused && phase === "on" && (
              <button
                className="gbx-resume clickable"
                onClick={togglePause}
                aria-label="Reprendre la partie"
              >
                <Play size={26} fill="currentColor" />
                <span>En pause</span>
              </button>
            )}
          </div>
        </div>

        {/* ---------------- la manette à l'écran ---------------- */}
        {pad && !raw && (
          <GbaPad
            onPress={push}
            stick={view.stick}
            disabled={phase !== "on" || paused}
          />
        )}

        {/* ---------------- EN DIRECT ----------------
            HORS DE LA BARRE DU HAUT, et c'est la raison d'être de ces trois
            lignes : la barre s'efface au bout de trois secondes, or savoir que
            d'autres yeux sont sur son écran n'est pas une commande — c'est un
            fait, et il doit rester vérifiable d'un regard à tout instant. (Un
            enfant ne peut pas rattraper l'opacité de son parent : il fallait
            qu'il en sorte.) */}
        {cast.starting && <StartingBadge />}
        {cast.room && (
          <LiveBadge
            room={cast.room}
            onClick={() => setSheet((s) => (s === "cast" ? null : "cast"))}
          />
        )}

        {/* ---------------- l'étiquette ----------------
            Le titre se dit une fois, dans un coin, et laisse l'écran tranquille.
            Il s'efface avec le reste des commandes. */}
        <div className="gbx-top">
          <div className="gbx-tag">
            <span className="gbx-led" aria-hidden="true" />
            <div>
              <strong>{media.title}</strong>
              <em>
                {["Game Boy Advance", media.cartridge?.region, engine.label]
                  .filter(Boolean)
                  .join(" · ")}
              </em>
            </div>
          </div>
          {total > 60 && (
            <span className="gbx-clock" title="Temps passé sur cette cartouche">
              {fmtDuration(total)}
            </span>
          )}
          {/* SUR TÉLÉPHONE, LA BARRE DU BAS N'EXISTE PAS : elle mangeait le tiers
              de l'écran et se retrouvait sous les pouces. Ses commandes passent
              derrière ce bouton, en clair et avec leurs noms ; le plein écran,
              lui, reste à portée immédiate — c'est le geste qu'on fait en
              premier. Les deux ne s'affichent QUE sur petit écran (feuille de
              style) : ailleurs la barre du bas fait déjà tout. */}
          <button
            className="gbx-topbtn clickable"
            onClick={toggleFull}
            aria-label={full ? "Quitter le plein écran" : "Plein écran"}
          >
            {full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button
            className={`gbx-topbtn clickable ${sheet === "more" ? "on" : ""}`}
            onClick={() => setSheet((v) => (v === "more" ? null : "more"))}
            aria-label="Réglages"
          >
            <Settings size={17} />
          </button>
          <button
            className="gbx-quit clickable"
            onClick={close}
            disabled={closing}
            aria-label="Quitter"
          >
            <Power size={16} />
            <span>Quitter</span>
          </button>
        </div>

        {flash && (
          <p className={`gbx-flash ${flash.ok ? "" : "bad"}`} role="status">
            {flash.ok ? <Check size={13} /> : <AlertTriangle size={13} />} {flash.msg}
          </p>
        )}

        {/* ---------------- la barre de commandes ----------------
            EN BAS, AU CENTRE, ET ELLE S'EFFACE. L'ancienne colonne contre le bord
            droit existait pour ne pas rogner la hauteur de la coque dessinée ; il
            n'y a plus de coque, et une barre qui disparaît ne coûte plus rien. */}
        <div
          className="gbx-dock"
          // AU DOIGT, ON NE SURVOLE PAS : un `pointerenter` tactile ne se voit
          // jamais suivi d'un `pointerleave`, et la barre resterait affichée
          // pour toujours après le premier appui. Le survol n'existe qu'à la
          // souris ; le doigt, lui, réveille la barre en touchant l'écran.
          onPointerEnter={(e) => e.pointerType === "mouse" && setOverDock(true)}
          onPointerLeave={() => setOverDock(false)}
        >
          {acts.map((a) =>
            // LE SON EST LE SEUL BOUTON QUI CACHE UN RÉGLAGE, pas seulement une
            // bascule : « couper » ne remplace pas « moins fort ». Le curseur
            // sort au survol du bouton, au-dessus, et le clic garde son sens —
            // deux gestes sur un seul bouton, sans rien ajouter à la barre.
            a.id === "sound" ? (
              <span key={a.id} className="gbx-volwrap">
                {dockBtn(a)}
                <span className="gbx-volpop">
                  <em>{Math.round(view.volume * 100)}</em>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={view.volume}
                    onChange={(e) => setPref({ volume: Number(e.target.value) })}
                    aria-label="Volume"
                  />
                </span>
              </span>
            ) : (
              dockBtn(a)
            )
          )}
          <button
            className={`gbx-btn more clickable ${sheet === "more" ? "on" : ""}`}
            onClick={() => setSheet((s) => (s === "more" ? null : "more"))}
            data-tip="Plus"
            aria-label="Plus de commandes"
          >
            <MoreHorizontal size={18} />
          </button>
        </div>

        {/* ---------------- démarrage et pannes ---------------- */}
        {phase !== "on" && !closing && (
          <div className="gbx-note">
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
                      Le cœur {engine.label} n'a pas répondu. L'autre moteur démarre
                      souvent là où celui-ci cale.
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

        {closing && (
          <div className="gbx-note">
            <Loader2 size={22} className="spin" />
            <strong>Sauvegarde de la partie…</strong>
            <span>Elle t'attendra sur ton compte, où que tu reprennes.</span>
          </div>
        )}

        {/* ---------------- reprendre ta partie ? ----------------
            LA VIGNETTE FAIT LA DÉCISION. On ne demande pas « veux-tu reprendre ta
            sauvegarde du 12 mars » : on MONTRE l'écran sur lequel on s'est arrêté,
            et le choix se fait tout seul. */}
        {offer && phase === "on" && autoSave && (
          <div className="gbx-offer">
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
            <div className="gbx-offer-btns">
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
            {/* ON LE DIT AVANT, PAS APRÈS : repartir de zéro veut dire que la
                reprise automatique sera écrasée dans les minutes qui suivent. */}
            <em className="gbx-offer-warn">
              Une nouvelle partie remplacera cette reprise. Tes emplacements gardés,
              eux, sont intacts.
            </em>
          </div>
        )}

        {/* ================================================== les panneaux == */}
        {sheet && (
          <>
            <div
              className="gbx-veil"
              onPointerDown={() => setSheet(null)}
              aria-hidden="true"
            />

            {sheet === "saves" && (
              <div className="gbx-sheet wide">
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
                  onClose={() => setSheet(null)}
                />
              </div>
            )}

            {sheet === "keys" && (
              <div className="gbx-sheet">
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
                      onClick={() => setSheet(null)}
                      aria-label="Fermer"
                    >
                      <X size={15} />
                    </button>
                  </header>

                  {/* LES JEUX TOUT FAITS D'ABORD : « rends le mappage facile » ne
                      veut pas dire « rends chaque touche réassignable » — ça l'était
                      déjà, et personne n'y touchait. Ça veut dire : que la manette
                      soit bonne en un clic. */}
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
                        className={`gba-keyrow clickable ${
                          capturing === b.id ? "waiting" : ""
                        }`}
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
                    <span className="gbx-shortcuts">
                      <kbd>F5</kbd> sauvegarder · <kbd>F8</kbd> reprendre ·{" "}
                      <kbd>F2</kbd> capture · <kbd>P</kbd> pause
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

            {sheet === "view" && (
              <div className="gbx-sheet">
                <div className="gbx-panel" role="dialog" aria-label="Image et moteur">
                  <header>
                    <div>
                      <strong>Image et moteur</strong>
                      <em>
                        Une dalle de 240 × 160 mérite qu'on la regarde correctement.
                      </em>
                    </div>
                    <button
                      className="clickable"
                      onClick={() => setSheet(null)}
                      aria-label="Fermer"
                    >
                      <X size={15} />
                    </button>
                  </header>

                  <Toggle
                    on={!view.smooth}
                    onClick={() => setPref({ smooth: !view.smooth })}
                    title="Pixels nets"
                    hint="Chaque pixel du jeu reste un carré franc. Lissé, essaie sur les jeux en 3D (Mario Kart, F-Zero)."
                  />
                  <Toggle
                    on={view.integer}
                    onClick={() => setPref({ integer: !view.integer })}
                    title="Agrandissement entier"
                    hint={
                      box?.k
                        ? `L'écran est agrandi ×${box.k} exactement : aucune ligne de pixels plus épaisse qu'une autre.`
                        : view.integer
                          ? "Ici l'arrondi coûterait trop de place : l'écran prend tout ce qu'il peut. Il reprendra une taille entière dès qu'il y aura la place."
                          : "L'écran s'arrête au multiple entier : aucune ligne de pixels plus épaisse qu'une autre."
                    }
                  />
                  {/* LE CHOIX N'EXISTE QUE LÀ OÙ IL A UN SENS : sans manette à
                      l'écran, croix ou joystick ne veut rien dire. */}
                  {pad && (
                    <Toggle
                      on={view.stick}
                      onClick={() => setPref({ stick: !view.stick })}
                      title="Joystick plutôt que la croix"
                      hint="Le champignon suit le pouce au lieu d'une croix fixe. Plus doux pour tourner, moins précis pour les sauts au pixel."
                    />
                  )}
                  <Toggle
                    on={view.crt}
                    onClick={() => setPref({ crt: !view.crt })}
                    title="Lignes de balayage"
                    hint="Le grain d'un écran cathodique, par-dessus l'image."
                  />

                  <label className="gbx-vol">
                    <span>
                      {muted ? <VolumeX size={15} /> : <Volume2 size={15} />} Volume
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={view.volume}
                      onChange={(e) => setPref({ volume: Number(e.target.value) })}
                    />
                  </label>

                  <p className="gbx-panel-title">Moteur d'émulation</p>
                  {CORES.map((c) => (
                    <button
                      key={c.value}
                      className={`gbx-row clickable ${c.value === core ? "on" : ""}`}
                      onClick={() => pickEngine(c.value)}
                    >
                      <span>
                        <strong>{c.label}</strong>
                        <em>{c.hint}</em>
                      </span>
                      {c.value === core && <Check size={15} />}
                    </button>
                  ))}
                  <p className="gbx-panel-note">
                    La partie en cours est sauvegardée avant de changer. Attention :
                    une sauvegarde ne se relit que dans le moteur qui l'a écrite.
                  </p>
                </div>
              </div>
            )}

            {sheet === "cast" && cast.room && (
              <div className="gbx-sheet">
                <GbaBroadcast
                  room={cast.room}
                  links={cast.links}
                  error={cast.error}
                  hasAudio={cast.hasAudio}
                  max={cast.max}
                  onGrant={cast.grantPad}
                  onStop={() => {
                    cast.stop();
                    setSheet(null);
                  }}
                  onClose={() => setSheet(null)}
                />
              </div>
            )}

            {sheet === "more" && (
              <div className="gbx-sheet">
                <div className="gbx-panel" role="dialog" aria-label="Commandes">
                  <header>
                    <div>
                      <strong>Commandes</strong>
                      <em>Tout ce que la console sait faire, en toutes lettres.</em>
                    </div>
                    <button
                      className="clickable"
                      onClick={() => setSheet(null)}
                      aria-label="Fermer"
                    >
                      <X size={15} />
                    </button>
                  </header>
                  {acts.map((a) => {
                    const Icon = a.icon;
                    return (
                      <button
                        key={a.id}
                        className={`gbx-row clickable ${a.on ? "on" : ""}`}
                        onClick={() => {
                          a.onClick();
                          if (!["saves", "keys", "view"].includes(a.id)) setSheet(null);
                        }}
                        disabled={a.disabled}
                      >
                        <span className="gbx-row-icon">
                          <Icon size={16} />
                        </span>
                        <span>
                          <strong>{a.label}</strong>
                        </span>
                        {a.on && <Check size={15} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {deaf && (
          <p className="gbx-deaf">
            Ce cœur n'accepte pas les commandes de la page — passe par le panneau de
            l'émulateur pour jouer et remapper.
          </p>
        )}
      </div>
    </div>,
    document.body
  );
}

// Un interrupteur nommé, avec sa raison d'être écrite dessous. Trois réglages
// d'image dont personne ne devine l'effet au nom seul : la phrase compte autant
// que le bouton.
function Toggle({ on, onClick, title, hint }) {
  return (
    <button
      className={`gbx-toggle clickable ${on ? "on" : ""}`}
      onClick={onClick}
      role="switch"
      aria-checked={on}
    >
      <span>
        <strong>{title}</strong>
        <em>{hint}</em>
      </span>
      <span className="gbx-switch" aria-hidden="true" />
    </button>
  );
}
