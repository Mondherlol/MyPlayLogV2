import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Check,
  Copy,
  Crown,
  Gamepad2,
  Heart,
  Loader2,
  Lock,
  Medal,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Search,
  Swords,
  Tag,
  Timer,
  UserPlus,
  Users,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { usePlayer } from "../context/PlayerContext";
import { apiFetch } from "../lib/api";
import { useLiveStatus } from "../lib/presence";
import { loadYT } from "../lib/youtube";
import { dedupeCandidates, searchCandidates } from "../lib/guessGame";
import { useGameSfx } from "../lib/useGameSfx";
import { VersusFace, VersusRail, VersusInvite, HUES } from "../components/VersusRoom";
import GameChat from "../components/GameChat";

// ======================================================================
//  Blind test VERSUS — le buzzer
// ======================================================================
// Le pendant musical de pages/GeoVersus.jsx : même salon, même rail de joueurs,
// même « 3, 2, 1 ». Un seul mode (voir models/BlindTestVersus.js) et c'est le
// BUZZER — le premier qui trouve arrête la manche et rafle la mise.
//
// D'où deux partis pris d'affichage qui découlent de la règle :
//   - ON VOIT TOUT LE MONDE TAPER, lettre à lettre. Quand la manche peut
//     s'arrêter à la seconde suivante, savoir qu'en face ça s'agite change ce
//     qu'on fait — on valide au lieu de fignoler.
//   - LES MAUVAISES RÉPONSES SONT PUBLIQUES. Elles ne protègent plus rien (la
//     manche s'arrête au premier bon jeu) et elles évitent de retenter la même
//     fausse piste.
//
// ------------------------------------------------------------------ le son
// EXACTEMENT LE MÊME MOTEUR QUE LE SOLO : une iframe YouTube cachée, pilotée
// par l'API IFrame (lib/youtube.js).
//
// Ça n'a pas toujours été le cas. L'extrait passait par NOTRE serveur, en audio
// pur, sous une adresse qui ne disait rien (/clip/:index) — pour que le videoId,
// donc le titre, donc la réponse, ne parte jamais au navigateur. C'était plus
// propre sur le papier et intenable en pratique : ce chemin repose sur yt-dlp,
// et depuis l'IP d'un datacenter YouTube le bloque en permanence. En prod, toute
// piste absente du cache disque renvoyait 502 et LA MANCHE PARTAIT MUETTE —
// pendant que le solo, sur la même piste, retombait sur cette iframe et jouait
// très bien. Un mode inviolable et silencieux ne vaut pas un mode jouable.
//
// LE PIÈGE DE L'IFRAME, et comment le solo le contourne : une iframe d'un autre
// domaine ne peut pas lancer de son toute seule. Elle le peut MUETTE, toujours.
// On charge donc la vidéo en sourdine pendant le sas, on pose l'aiguille sur le
// climax dès que la durée est connue, et au « go » il ne reste qu'à démasquer le
// son et lancer — ce que le navigateur accepte parce que la page a déjà reçu un
// clic (« Lancer la partie », « Je suis prêt »).
const LIVES = 3;
// Quatre paliers ici (le solo en a trois) : l'extrait dure plus longtemps et se
// termine avec la manche, il y a la place pour un dernier indice — celui qui
// dit QUI, à cette table, a ce jeu en bibliothèque.
const HINT_FRACS = [0.2, 0.4, 0.6, 0.78];
// Cadence de sondage de `getDuration()` : l'API IFrame ne prévient pas quand
// elle connaît la durée, il faut la lui demander. Au-delà de PROBE_GIVEUP_MS on
// renonce à viser le climax et on joue depuis le début plutôt que se taire.
const PROBE_MS = 120;
const PROBE_GIVEUP_MS = 8000;
// Cadence d'envoi de « ce que je tape ». Assez serré pour qu'on voie les
// lettres arriver, assez lâche pour ne pas poster à chaque touche.
const TYPING_MS = 200;
const TYPING_TTL = 4000;

export default function BlindTestVersus() {
  const { code } = useParams();
  const { token, user } = useAuth();
  const { subscribe } = useChat();
  const player = usePlayer();
  const navigate = useNavigate();
  const sfx = useGameSfx();

  const [room, setRoom] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [input, setInput] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [flash, setFlash] = useState(null);
  const [missed, setMissed] = useState({});
  const [typers, setTypers] = useState({});
  const [ranking, setRanking] = useState(null);
  const [muted, setMuted] = useState(false);
  // MÊME RÉGLAGE QU'EN SOLO, même clé de stockage : c'est le même jeu, on ne
  // remonte pas le son deux fois. (`getItem` rend `null` quand rien n'est
  // stocké, et `Number(null)` vaut 0 — d'où le test explicite de l'absence,
  // sinon la toute première partie démarre muette.)
  const [volume, setVolume] = useState(() => {
    const raw = localStorage.getItem("bt_volume");
    const v = raw == null ? NaN : Number(raw);
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 100;
  });
  const [clipReady, setClipReady] = useState(false);
  // Le son n'a PAS démarré, et on sait pourquoi : soit l'extrait n'est pas
  // arrivé (`clipError`), soit le navigateur a refusé la lecture (`soundBlocked`
  // — mobile, quand aucun geste ne l'a autorisée). Dans les deux cas on le DIT
  // et on offre une issue : une manche muette sans explication est le pire des
  // deux mondes.
  const [clipError, setClipError] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [, setTick] = useState(0);

  const inputRef = useRef(null);
  const suggestRef = useRef(null);
  const offsetRef = useRef(0);
  const mutedRef = useRef(false); // miroir de la sourdine (cf. le départ du son)
  const volumeRef = useRef(volume); // idem pour le volume
  const clipStartRef = useRef(0); // où l'extrait commence dans le morceau (s)
  const roundRef = useRef(null); // la manche courante, lue par les sondages
  // « La manche est en cours, le son DOIT jouer. » C'est ce drapeau, et non un
  // état React, que consulte le sondage de durée : le climax peut être trouvé
  // AVANT comme APRÈS le « go », et dans les deux cas il faut partir.
  const wantAudioRef = useRef(false);
  // Miroirs lus par le départ du son, qui ne doit dépendre QUE de la manche.
  const phaseStartRef = useRef(0);
  const serverNowRef = useRef(() => Date.now());

  // --- Le lecteur YouTube caché, propre à la page (cf. « le son ») ----------
  // `ytHostRef` porte un <div> React ; l'API IFrame, elle, remplace le nœud
  // qu'on lui donne — d'où le <div> JETABLE créé à la main dedans. Monter le
  // lecteur SUR un nœud géré par React fait planter la page au démontage
  // (React ne retrouve plus son enfant) : même piège qu'à la fiche de jeu.
  // Le conteneur N'EXISTE PAS au premier rendu : la page renvoie d'abord son
  // écran de chargement, puis éventuellement son écran d'erreur. Une ref seule
  // laisserait l'effet de création tomber sur `null` une fois pour toutes — et
  // le lecteur ne serait jamais monté. On suit donc le nœud dans un ÉTAT, pour
  // que l'effet rejoue à l'instant où il apparaît. (C'est la panne qu'avait
  // déjà la balise <audio> qu'il remplace.)
  const ytHostRef = useRef(null);
  const [ytHost, setYtHost] = useState(null);
  const setYtHostNode = useCallback((el) => {
    ytHostRef.current = el;
    setYtHost(el);
  }, []);
  const ytRef = useRef(null);
  const readyRef = useRef(false); // le lecteur a fini de s'initialiser
  const probeRef = useRef(null); // sondage de getDuration() en cours
  const cuedForRef = useRef(null); // videoId déjà chargé dans le lecteur

  // L'icône suit le niveau : coupé, faible, fort — on lit l'état sans lire le
  // curseur.
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  const meId = user?.id ? String(user.id) : "";
  const phase = room?.phase || "lobby";
  const round = room?.round || null;
  roundRef.current = round;
  phaseStartRef.current = room?.phaseStartsAt || 0;
  const players = useMemo(() => room?.players || [], [room]);
  const me = players.find((p) => p.isMe) || null;
  const hueById = useMemo(() => {
    const m = new Map();
    players.forEach((p, i) => m.set(p.id, HUES[i % HUES.length]));
    return m;
  }, [players]);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);
  serverNowRef.current = serverNow;
  const applyRoom = useCallback((r) => {
    if (!r) return;
    if (typeof r.now === "number") offsetRef.current = r.now - Date.now();
    setRoom(r);
  }, []);

  // ---------- Chargement ----------
  const load = useCallback(async () => {
    try {
      const d = await apiFetch(`/blindtest/versus/${code}`, { token });
      applyRoom(d.room);
      if (d.candidates) setCandidates(d.candidates);
      setErr("");
      if (!d.member && d.room && !d.room.started && !d.room.endedAt) {
        const j = await apiFetch(`/blindtest/versus/${code}/join`, { method: "POST", token });
        applyRoom(j.room);
      }
    } catch (e) {
      setErr(e.message || "Salon introuvable.");
    } finally {
      setLoading(false);
    }
  }, [code, token, applyRoom]);

  useEffect(() => {
    if (token && code) load();
  }, [token, code, load]);

  // ---------- La liste de recherche des INVITÉS ----------
  // Même défaut qu'à GeoGamer (pages/GeoVersus.jsx, même en-tête) : elle ne
  // voyage que dans la réponse à `/start`, que seul l'hôte reçoit. Les invités
  // partaient donc en manche sans aucune suggestion jusqu'à ce qu'ils
  // rechargent la page.
  useEffect(() => {
    if (!token || !code) return undefined;
    if (!room?.started || phase === "done" || candidates.length) return undefined;
    let alive = true;
    apiFetch(`/blindtest/versus/${code}`, { token })
      .then((d) => {
        if (alive && d.candidates?.length) setCandidates(d.candidates);
      })
      .catch(() => {
        /* on réessaiera au prochain changement de phase */
      });
    return () => {
      alive = false;
    };
  }, [token, code, room?.started, phase, candidates.length]);

  // Le mini-lecteur global se tait pendant une partie.
  useEffect(() => {
    player?.pause?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Le direct ----------
  useEffect(() => {
    if (!subscribe || !code) return undefined;
    return subscribe((event, data) => {
      if (event !== "btversus" || data?.code !== code) return;
      if (data.room) applyRoom(data.room);

      switch (data.kind) {
        case "cue":
          setInput("");
          setHighlight(0);
          setFlash(null);
          setTypers({});
          sfx.play("start");
          break;
        case "typing":
          setTypers((t) => ({ ...t, [data.by]: { text: data.text, at: Date.now() } }));
          break;
        case "go":
          setTimeout(() => inputRef.current?.focus(), 60);
          break;
        case "guess": {
          if (data.by !== meId) sfx.play(data.correct ? "correct" : "wrong");
          if (!data.correct) {
            setMissed((m) => ({ ...m, [data.by]: Date.now() }));
            setTimeout(
              () =>
                setMissed((m) => {
                  const n = { ...m };
                  delete n[data.by];
                  return n;
                }),
              900
            );
          }
          setRoom((r) =>
            r?.round
              ? {
                  ...r,
                  round: {
                    ...r.round,
                    found: data.found || r.round.found,
                    out: data.out || r.round.out,
                    livesById: data.livesById || r.round.livesById,
                    attempts:
                      data.name != null
                        ? [
                            ...(r.round.attempts || []),
                            { userId: data.by, name: data.name, correct: data.correct },
                          ]
                        : r.round.attempts,
                  },
                }
              : r
          );
          // Son mot est parti : on efface ce qu'on le voyait taper.
          setTypers((t) => {
            const n = { ...t };
            delete n[data.by];
            return n;
          });
          break;
        }
        case "reveal":
          sfx.play(
            data.room?.round?.results?.find((x) => x.userId === meId)?.correct
              ? "correct"
              : "wrong"
          );
          break;
        case "done":
          setRanking(data.ranking || null);
          sfx.play("finish");
          break;
        case "closed":
          setErr("L'hôte a fermé le salon.");
          break;
        default:
          break;
      }
    });
  }, [subscribe, code, applyRoom, meId, sfx]);

  // ---------- L'extrait : le lecteur YouTube caché ----------
  // Créé une seule fois, pour toute la partie. On lui donne un <div> jetable
  // (voir `ytHostRef` plus haut) et on le détruit au démontage de la page.
  useEffect(() => {
    if (!ytHost) return undefined;
    let destroyed = false;
    loadYT().then((YT) => {
      if (destroyed || !ytHostRef.current) return;
      const host = document.createElement("div");
      ytHostRef.current.appendChild(host);
      ytRef.current = new YT.Player(host, {
        height: "0",
        width: "0",
        playerVars: {
          autoplay: 0,
          playsinline: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            // La manche a pu démarrer pendant que l'API se chargeait.
            cueClipRef.current();
          },
          // Vidéo supprimée, bloquée dans le pays, lecture interdite hors
          // YouTube : la manche se jouera sans son, mais on le DIT.
          onError: () => setClipError(true),
        },
      });
    });
    return () => {
      destroyed = true;
      clearInterval(probeRef.current);
      try {
        ytRef.current?.destroy();
      } catch {
        /* ignore */
      }
      ytRef.current = null;
      readyRef.current = false;
      if (ytHostRef.current) ytHostRef.current.innerHTML = "";
    };
  }, [ytHost]);

  // Le départ du son, à l'instant décidé par le serveur.
  //
  // Appelé par le sondage de durée ET par le passage en phase « round » : les
  // deux peuvent arriver dans n'importe quel ordre, le premier qui trouve la
  // situation jouable lance, l'autre ne fait rien de mal. `wantAudioRef` dit
  // « la manche est en cours », `clipStartRef` où se trouve le climax.
  const rollClip = useCallback(() => {
    const p = ytRef.current;
    const r = roundRef.current;
    if (!p || !r || !wantAudioRef.current || !readyRef.current) return;

    const clipLen = r.durationSec || 15;
    // Retard éventuel (iframe plus lente que le sas) : on prend l'extrait où il
    // en serait, pas au début — les autres ont déjà entendu ces secondes-là.
    const late = Math.max(0, (serverNowRef.current() - phaseStartRef.current) / 1000);
    if (late >= clipLen) return; // extrait déjà fini

    try {
      p.seekTo((clipStartRef.current || 0) + late, true);
      // Démasquer le son : accepté parce que la page a déjà reçu un clic
      // (« Lancer », « Je suis prêt »). Sans ce clic — un invité qui n'a fait
      // qu'ouvrir le lien — ça reste muet, d'où le bouton de secours plus bas.
      if (mutedRef.current) p.mute?.();
      else {
        p.unMute?.();
        p.setVolume?.(volumeRef.current);
      }
      p.playVideo?.();
    } catch {
      /* ignore */
    }
  }, []);

  // Charge la vidéo de la manche, EN SOURDINE, et pose l'aiguille sur le
  // climax. C'est tout l'intérêt du sas : au « go », il ne reste qu'à démasquer.
  //
  // L'API IFrame ne prévient pas quand elle connaît la durée — il faut la lui
  // demander en boucle (`PROBE_MS`). Passé `PROBE_GIVEUP_MS` on renonce au
  // climax et on jouera depuis le début : une manche qui commence au mauvais
  // endroit vaut mieux qu'une manche muette.
  const cueClip = useCallback(() => {
    const p = ytRef.current;
    const r = roundRef.current;
    if (!p || !readyRef.current || !r?.videoId) return;
    if (cuedForRef.current === r.videoId) return; // déjà chargée
    cuedForRef.current = r.videoId;

    setClipReady(false);
    setClipError(false);
    clearInterval(probeRef.current);
    try {
      p.mute?.(); // muet obligatoire : c'est la seule lecture qu'on nous accorde
      p.loadVideoById(r.videoId);
    } catch {
      setClipError(true);
      return;
    }

    const startedAt = Date.now();
    probeRef.current = setInterval(() => {
      const pl = ytRef.current;
      const cur = roundRef.current;
      // La manche a changé sous nos pieds : ce sondage ne concerne plus rien.
      if (!pl || cur?.videoId !== r.videoId) return clearInterval(probeRef.current);

      let dur = 0;
      try {
        dur = pl.getDuration?.() || 0;
      } catch {
        /* pas encore prêt */
      }

      if (dur > 0) {
        clearInterval(probeRef.current);
        const clipLen = r.durationSec || 15;
        clipStartRef.current = Math.min(
          (r.startFrac || 0.4) * dur,
          Math.max(0, dur - clipLen - 1)
        );
        try {
          pl.seekTo(clipStartRef.current, true);
          // Toujours muet, et en pause tant que le « go » n'est pas donné : on
          // ne fait que remplir le tampon au bon endroit.
          if (!wantAudioRef.current) pl.pauseVideo?.();
        } catch {
          /* ignore */
        }
        setClipReady(true);
        rollClip(); // le « go » est peut-être déjà passé
      } else if (Date.now() - startedAt > PROBE_GIVEUP_MS) {
        clearInterval(probeRef.current);
        clipStartRef.current = 0;
        setClipReady(true);
        rollClip();
      }
    }, PROBE_MS);
  }, [rollClip]);

  // `onReady` de l'iframe peut tomber avant que `cueClip` n'existe dans sa
  // version à jour : on le lit par une ref plutôt que de le capturer.
  const cueClipRef = useRef(cueClip);
  cueClipRef.current = cueClip;

  // Nouvelle manche = nouvelle vidéo à précharger. `round.videoId` redevient
  // absent en repassant par le salon, ce qui remet le lecteur à zéro pour une
  // revanche — pour TOUT LE MONDE, pas seulement pour l'hôte.
  useEffect(() => {
    if (!round?.videoId) {
      cuedForRef.current = null;
      return;
    }
    cueClip();
  }, [round?.videoId, cueClip]);

  // Le « go ». Le son s'arrête à la fin de l'extrait — le temps bonus se joue
  // en silence, comme en solo.
  useEffect(() => {
    if (phase !== "round" || !round) {
      wantAudioRef.current = false;
      return undefined;
    }

    const clipLen = round.durationSec || 15;
    const late = Math.max(0, (serverNowRef.current() - phaseStartRef.current) / 1000);
    if (late >= clipLen) return undefined;

    wantAudioRef.current = true;
    rollClip();

    const stop = setTimeout(
      () => {
        wantAudioRef.current = false;
        try {
          ytRef.current?.pauseVideo?.();
        } catch {
          /* ignore */
        }
      },
      (clipLen - late) * 1000
    );

    // Chien de garde : `playVideo()` peut ne rien produire (autoplay refusé
    // faute de clic sur la page, tampon vide). On regarde la seule chose qui
    // compte — LA TÊTE DE LECTURE A-T-ELLE BOUGÉ — et on relance tant que non.
    // Au bout de trois vérifications sèches on affiche le bouton de secours :
    // un vrai clic lève toujours le refus.
    let idle = 0;
    let mark = -1;
    const watchdog = setInterval(() => {
      if (!wantAudioRef.current) return;
      let at = 0;
      try {
        at = ytRef.current?.getCurrentTime?.() || 0;
      } catch {
        /* ignore */
      }
      if (Math.abs(at - mark) > 0.05) {
        mark = at; // ça tourne
        idle = 0;
        setSoundBlocked(false);
        return;
      }
      mark = at;
      idle += 1;
      if (idle >= 3) setSoundBlocked(true);
      rollClip();
    }, 700);

    return () => {
      clearTimeout(stop);
      clearInterval(watchdog);
    };
  }, [phase, round?.index, round?.videoId, rollClip]); // eslint-disable-line react-hooks/exhaustive-deps

  // Le son se coupe dès qu'on quitte la manche (révélation, sortie de page) ;
  // et à l'inverse, un morceau lancé « en entier » depuis la révélation se tait
  // au départ de la manche suivante — deux musiques ne se superposent jamais.
  useEffect(() => {
    if (phase === "round") {
      player?.pause?.();
      return;
    }
    try {
      ytRef.current?.pauseVideo?.();
    } catch {
      /* ignore */
    }
  }, [phase, player]);

  useEffect(() => {
    mutedRef.current = muted;
    sfx.setMuted(muted);
    try {
      if (muted) ytRef.current?.mute?.();
      else if (readyRef.current) {
        ytRef.current?.unMute?.();
        ytRef.current?.setVolume?.(volumeRef.current);
      }
    } catch {
      /* ignore */
    }
  }, [muted, sfx]);

  // Volume : l'extrait ET les bruitages, retenu pour la prochaine partie.
  useEffect(() => {
    volumeRef.current = volume;
    localStorage.setItem("bt_volume", String(volume));
    sfx.setLevel(volume / 100);
    try {
      ytRef.current?.setVolume?.(volume);
    } catch {
      /* ignore */
    }
  }, [volume, sfx]);

  // Battement pour les chronos.
  useEffect(() => {
    if (phase === "lobby" || phase === "done") return undefined;
    const iv = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(iv);
  }, [phase]);

  useEffect(() => {
    document.body.classList.add("bt-immersive");
    return () => document.body.classList.remove("bt-immersive");
  }, []);

  useLiveStatus(
    "blindtest",
    room?.started && phase !== "done"
      ? `versus · manche ${(room.index || 0) + 1}/${room.roundCount}`
      : "",
    { token }
  );

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 1700);
    return () => clearTimeout(t);
  }, [flash]);

  // Les indicateurs de frappe s'éteignent d'eux-mêmes : si quelqu'un ferme son
  // onglet en plein mot, personne ne doit rester avec son « HOLL » à l'écran.
  useEffect(() => {
    if (!Object.keys(typers).length) return undefined;
    const iv = setInterval(() => {
      const now = Date.now();
      setTypers((t) => {
        const next = Object.fromEntries(
          Object.entries(t).filter(([, v]) => now - v.at < TYPING_TTL)
        );
        return Object.keys(next).length === Object.keys(t).length ? t : next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [typers]);

  // Diffusion de ce que je tape, à cadence bornée.
  const typingRef = useRef({ at: 0, timer: null });
  function pushTyping(text) {
    if (phase !== "round") return;
    const now = Date.now();
    const t = typingRef.current;
    clearTimeout(t.timer);
    const fire = () => {
      t.at = Date.now();
      post("/typing", { text }).catch(() => {});
    };
    if (now - t.at >= TYPING_MS) fire();
    else t.timer = setTimeout(fire, TYPING_MS - (now - t.at));
  }

  // Rattrapage manuel du son. Un clic est un geste : le navigateur ne peut plus
  // refuser. On reprend l'extrait LÀ OÙ IL EN SERAIT (pas au début) — sinon on
  // rejouerait quinze secondes déjà passées pour les autres.
  const fixSound = useCallback(() => {
    const clip = roundRef.current?.durationSec || 15;
    const elapsed = Math.max(0, (serverNow() - (room?.phaseStartsAt || 0)) / 1000);
    if (elapsed >= clip) return setSoundBlocked(false); // trop tard, extrait fini
    wantAudioRef.current = true;
    rollClip();
  }, [room?.phaseStartsAt, serverNow, rollClip]);

  // ---------- Actions ----------
  const post = (path, body) =>
    apiFetch(`/blindtest/versus/${code}${path}`, { method: "POST", token, body });

  async function act(fn) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const toggleReady = () => act(async () => applyRoom((await post("/ready", { ready: !me?.ready })).room));
  const setRounds = (n) => act(async () => applyRoom((await post("/rounds", { rounds: n })).room));
  const playAgain = () =>
    act(async () => {
      applyRoom((await post("/again")).room);
      setRanking(null);
    });

  const start = () =>
    act(async () => {
      sfx.resume();
      const d = await post("/start");
      applyRoom(d.room);
      if (d.candidates) setCandidates(d.candidates);
    });

  async function quit() {
    try {
      await post("/leave");
    } catch {
      /* on part quand même */
    }
    navigate("/blindtest");
  }

  const settled = !!round?.settled;
  const lives = round?.lives ?? LIVES;

  async function submitGuess(cand) {
    if (!cand || settled || phase !== "round") return;
    setInput("");
    setHighlight(0);
    pushTyping("");
    try {
      const d = await post("/guess", { gameId: cand.id, name: cand.name });
      sfx.play(d.correct ? "correct" : "wrong");
      if (!d.correct) setFlash({ name: cand.name, left: d.lives, at: Date.now() });
      setRoom((r) =>
        r?.round ? { ...r, round: { ...r.round, lives: d.lives, settled: d.settled } } : r
      );
    } catch (e) {
      if (e.status !== 409) setErr(e.message);
    }
  }

  const uniqueCandidates = useMemo(() => dedupeCandidates(candidates), [candidates]);
  const suggestions = useMemo(
    () => searchCandidates(input, uniqueCandidates),
    [input, uniqueCandidates]
  );

  useEffect(() => {
    suggestRef.current?.children[highlight]?.scrollIntoView({ block: "nearest" });
  }, [highlight, suggestions]);

  function onKeyDown(e) {
    if (settled) return;
    if (e.key === "Tab") {
      e.preventDefault();
      const pick = suggestions[highlight] || suggestions[0];
      if (pick) {
        setInput(pick.name);
        setHighlight(0);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const pick = suggestions[highlight] || suggestions[0];
      if (pick) submitGuess(pick);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    }
  }

  // ---------- Chronos ----------
  const now = serverNow();
  const msLeft = room?.phaseEndsAt ? Math.max(0, room.phaseEndsAt - now) : 0;
  const cueLeft = room?.phaseStartsAt ? Math.ceil((room.phaseStartsAt - now) / 1000) : 0;
  const clipMs = (round?.durationSec || 15) * 1000;
  // Le versus n'a PAS de temps mort : le serveur envoie 0 (la manche s'arrête
  // au buzzer ou à la fin de l'extrait). `??` et non `||` — un 0 est une
  // valeur, pas une absence.
  const graceMs = round?.graceMs ?? 0;
  // Comme en solo : l'anneau montre l'écoute, puis le temps bonus en rouge.
  const listenLeft = Math.max(0, msLeft - graceMs);
  const inGrace = phase === "round" && msLeft > 0 && listenLeft <= 0;
  const frac = inGrace ? msLeft / graceMs : listenLeft / clipMs;
  const secondsLeft = Math.ceil((inGrace ? msLeft : listenLeft) / 1000);
  const elapsedMs = clipMs - listenLeft;

  // Indices progressifs, identiques au solo et synchrones pour toute la table.
  const hintDefs = useMemo(() => {
    const h = round?.hints;
    if (!h) return [];
    const pool = [];
    if (h.year) pool.push({ key: "year", Icon: Calendar, label: "Année", text: String(h.year) });
    if (h.platforms?.length)
      pool.push({
        key: "plat",
        Icon: Gamepad2,
        label: "Plateformes",
        text: h.platforms.slice(0, 3).join(" · "),
      });
    if (h.studio) pool.push({ key: "studio", Icon: Building2, label: "Studio", text: h.studio });
    else if (h.genre) pool.push({ key: "genre", Icon: Tag, label: "Genre", text: h.genre });
    // Le dernier, et le plus fort : QUI À CETTE TABLE Y A JOUÉ. On ne donne pas
    // le titre, on donne l'adversaire à surveiller — et si la liste est vide,
    // c'est un piège que personne n'a touché, ce qui se sait aussi.
    if (Array.isArray(h.players)) {
      const seats = h.players
        .map((o) => ({ ...o, p: players.find((pl) => pl.id === o.id) }))
        .filter((o) => o.p);
      pool.push({
        key: "who",
        Icon: Users,
        label: "Y ont joué",
        seats,
        favs: seats.filter((o) => o.favorite),
        text: seats.length
          ? seats.map((o) => o.p.username).join(" · ")
          : "Personne à cette table",
      });
    }
    return pool.slice(0, 4).map((p, i) => ({ ...p, atMs: HINT_FRACS[i] * clipMs }));
  }, [round, clipMs, players]);

  // ---------- Écrans ----------
  if (loading)
    return (
      <div className="bt-page">
        <div className="bt-loading">
          <Loader2 size={34} className="spin" />
          <p>On ouvre le salon…</p>
        </div>
      </div>
    );

  if (err && !room)
    return (
      <div className="bt-page">
        <div className="bt-loading bt-err">
          <p>{err}</p>
          <div className="bt-err-actions">
            <Link to="/blindtest" className="bt-start sm clickable">
              <Music2 size={16} /> Blind Test
            </Link>
            <Link to="/arcade" className="bt-ghost clickable">
              Arcade
            </Link>
          </div>
        </div>
      </div>
    );

  return (
    <div className="bt-page gv">
      {/* Le lecteur : hors écran, jamais visible. L'API IFrame remplace le nœud
          qu'on lui donne — d'où le <div> jetable créé à la main là-dedans, et
          pas sur ce conteneur-ci, que React gère. */}
      <div ref={setYtHostNode} style={{ position: "fixed", left: -9999, top: -9999 }} />

      <header className="bt-topbar">
        <button className="bt-back clickable" onClick={quit}>
          <ArrowLeft size={17} /> <span>Quitter</span>
        </button>
        <div className="bt-brand">
          <Swords size={17} /> Blind Test — Buzzer
        </div>
        <div className="bt-volume">
          <button
            className="bt-vol-btn clickable"
            onClick={() => setMuted((m) => !m)}
            title={muted ? "Réactiver le son" : "Couper le son"}
          >
            <VolIcon size={17} />
          </button>
          <input
            type="range"
            className="bt-vol-slider clickable"
            min="0"
            max="100"
            value={muted ? 0 : volume}
            style={{ "--bt-vol-pct": `${muted ? 0 : volume}%` }}
            aria-label="Volume"
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              if (muted && v > 0) setMuted(false);
            }}
          />
        </div>
      </header>

      <div className="bt-body">
        {/* ---------- SALON ---------- */}
        {phase === "lobby" && (
          <Lobby
            room={room}
            me={me}
            hueById={hueById}
            busy={busy}
            err={err}
            onRounds={setRounds}
            onReady={toggleReady}
            onStart={start}
            onInvite={() => setShowInvite(true)}
          />
        )}

        {/* ---------- PARTIE ---------- */}
        {(phase === "cue" || phase === "round" || phase === "reveal") && round && (
          <div className="bt-play gv-play">
            <div className="bt-play-head">
              <span className="bt-round-count">
                Manche <b>{(room.index || 0) + 1}</b>
                <em>/ {room.roundCount}</em>
              </span>
              <span className="bt-live-score">
                <Timer size={14} /> {me?.score || 0} pts
              </span>
            </div>

            {/* Le rail des joueurs, partagé avec GeoGamer. */}
            <VersusRail
              players={players}
              found={round.found}
              out={round.out}
              livesById={round.livesById}
              hueById={hueById}
              missed={missed}
              lives={LIVES}
              row
              // Ce que tape l'adversaire prend la place de son état : c'est
              // l'information la plus chaude du mode buzzer.
              renderSub={(p, { hit }) => {
                const typing = typers[p.id]?.text;
                if (!typing || hit) return null;
                return (
                  <em className="gv-rail-typing">
                    {typing.toUpperCase()}
                    <i className="gv-caret" aria-hidden="true" />
                  </em>
                );
              }}
            />

            <div
              className={`bt-stage ${inGrace || secondsLeft <= 3 ? "hot" : ""} ${
                inGrace ? "grace" : ""
              }`}
            >
              <span className="bt-vinyl">
                <span className="bt-vinyl-disc" />
                <span className="bt-eq">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <i key={i} style={{ animationDelay: `${i * 0.09}s` }} />
                  ))}
                </span>
              </span>
              <svg className="bt-ring" viewBox="0 0 120 120" aria-hidden="true">
                <circle className="bt-ring-bg" cx="60" cy="60" r="54" />
                <circle
                  className="bt-ring-fg"
                  cx="60"
                  cy="60"
                  r="54"
                  style={{
                    strokeDasharray: 2 * Math.PI * 54,
                    strokeDashoffset:
                      2 * Math.PI * 54 * (1 - Math.min(1, Math.max(0, frac))),
                  }}
                />
              </svg>
              <span className="bt-timer-num">
                {phase === "cue" ? Math.max(0, cueLeft) : secondsLeft}
              </span>

              {phase === "cue" && (
                <span className="bt-clip-loading" aria-hidden="true">
                  {clipReady ? (
                    <>
                      <Check size={22} />
                      <span>Prêt</span>
                    </>
                  ) : (
                    <>
                      <Loader2 size={26} className="spin" />
                      <span>Chargement…</span>
                    </>
                  )}
                </span>
              )}
            </div>

            {phase === "cue" && (
              <p className="bt-grace-hint">
                {clipError
                  ? "Extrait indisponible — la manche se jouera sans son."
                  : clipReady
                    ? "Tout le monde part ensemble…"
                    : "On prépare l'extrait pour tout le monde…"}
              </p>
            )}

            {/* Le son n'est pas parti : on ne laisse JAMAIS la manche muette
                sans issue. Un clic suffit à débloquer une lecture refusée. */}
            {phase === "round" && soundBlocked && !inGrace && (
              <button className="bt-sound-fix clickable" onClick={fixSound}>
                <Volume2 size={16} />
                Appuie pour lancer le son
              </button>
            )}
            {phase === "round" && clipError && (
              <p className="bt-grace-hint">Extrait indisponible — devine à l'aveugle !</p>
            )}
            {inGrace && phase === "round" && (
              <p className="bt-grace-hint">Extrait terminé — valide ta réponse !</p>
            )}

            {/* Indices */}
            {phase === "round" && hintDefs.length > 0 && (
              <div className="bt-hints">
                {hintDefs.map((h) => {
                  const open = elapsedMs >= h.atMs;
                  const inSec = Math.max(0, Math.ceil((h.atMs - elapsedMs) / 1000));
                  return (
                    <span
                      key={h.key}
                      className={`bt-hint ${open ? "open" : ""} ${h.seats ? "who" : ""}`}
                    >
                      {open ? <h.Icon size={13} /> : <Lock size={12} />}
                      {open && h.seats ? (
                        <>
                          {h.seats.length > 0 && (
                            <span className="bt-hint-avs">
                              {h.seats.map((o) => (
                                <span
                                  key={o.id}
                                  className="bt-hint-av"
                                  title={o.p.username}
                                  style={{ "--hue": hueById.get(o.id) ?? 0 }}
                                >
                                  {o.p.avatar ? (
                                    <img src={o.p.avatar} alt="" draggable="false" />
                                  ) : (
                                    <i>{(o.p.username || "?")[0].toUpperCase()}</i>
                                  )}
                                  {o.favorite && (
                                    <b className="bt-hint-fav" aria-hidden="true">
                                      <Heart size={8} />
                                    </b>
                                  )}
                                </span>
                              ))}
                            </span>
                          )}
                          <span>{h.text}</span>
                          {h.favs.length > 0 && (
                            <em className="bt-hint-favtxt">
                              <Heart size={10} /> favori de{" "}
                              {h.favs.map((o) => o.p.username).join(", ")}
                            </em>
                          )}
                        </>
                      ) : (
                        <span>{open ? h.text : h.label}</span>
                      )}
                      {!open && <i className="bt-hint-t">{inSec}s</i>}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Réponse */}
            {phase === "round" && (
              <>
                <div className="gv-lives-row">
                  <div className="geo-lives" aria-label={`${lives} vies restantes`}>
                    {Array.from({ length: LIVES }).map((_, i) => (
                      <Heart
                        key={i}
                        size={18}
                        className={i < lives ? "on" : "off"}
                        fill={i < lives ? "currentColor" : "none"}
                      />
                    ))}
                  </div>
                  {flash && (
                    <span className="geo-wrong" key={flash.at}>
                      Raté&nbsp;! Encore {flash.left} {flash.left > 1 ? "essais" : "essai"}
                    </span>
                  )}
                </div>

                <div className={`bt-guess ${settled ? "locked" : ""}`}>
                  <div className="bt-search">
                    <Search size={18} className="bt-search-ic" />
                    <input
                      ref={inputRef}
                      className="bt-search-input"
                      placeholder={
                        settled
                          ? lives > 0
                            ? "Buzz !"
                            : "Plus de vies sur cette manche"
                          : "Le premier qui trouve… Entrée pour buzzer"
                      }
                      value={input}
                      disabled={settled}
                      onChange={(e) => {
                        setInput(e.target.value);
                        setHighlight(0);
                        pushTyping(e.target.value.trim());
                      }}
                      onKeyDown={onKeyDown}
                      autoComplete="off"
                      spellCheck="false"
                    />
                  </div>
                  {!settled && suggestions.length > 0 && (
                    <ul className="bt-suggest" ref={suggestRef}>
                      {suggestions.map((c, i) => (
                        <li key={c.id}>
                          <button
                            className={`bt-suggest-row clickable ${i === highlight ? "on" : ""}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              submitGuess(c);
                            }}
                            onMouseEnter={() => setHighlight(i)}
                          >
                            {c.cover ? (
                              <img src={c.cover} alt="" loading="lazy" draggable="false" />
                            ) : (
                              <span className="bt-suggest-ph">
                                <Gamepad2 size={14} />
                              </span>
                            )}
                            <span className="bt-suggest-name">{c.name}</span>
                            {i === highlight && <kbd className="bt-kbd">↵</kbd>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}

            {/* Révélation */}
            {phase === "reveal" && (
              <Reveal round={round} players={players} meId={meId} hueById={hueById} />
            )}
          </div>
        )}

        {/* ---------- TABLEAU FINAL ---------- */}
        {phase === "done" && (
          <Podium
            room={room}
            ranking={
              ranking ||
              [...players]
                .filter((p) => !p.left)
                .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount)
                .map((p, i) => ({ ...p, user: p, rank: i + 1, correct: p.correctCount }))
            }
            hueById={hueById}
            busy={busy}
            onAgain={playAgain}
          />
        )}
      </div>

      {showInvite && room && (
        <VersusInvite
          token={token}
          meId={meId}
          room={room}
          endpoint={`/blindtest/versus/${room.code}/invite`}
          title="Inviter au blind test"
          onClose={() => setShowInvite(false)}
        />
      )}

      {/* Le chat du salon : réservé à ceux qui jouent (un curieux muni du lien
          n'a rien à souffler à la table). */}
      {room && me && (
        <GameChat
          token={token}
          code={code}
          event="btversus"
          endpoint="/blindtest/versus"
          players={players}
          meId={meId}
        />
      )}
    </div>
  );
}

// ============================================================
//  Le salon d'attente
// ============================================================
function Lobby({ room, me, hueById, busy, err, onRounds, onReady, onStart, onInvite }) {
  const [copied, setCopied] = useState(false);
  const active = room.players.filter((p) => !p.left);
  const ready = active.filter((p) => p.ready).length;

  async function copyLink() {
    const url = `${window.location.origin}/blindtest/versus/${room.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copie ce lien :", url);
    }
  }

  return (
    <section className="gv-lobby">
      <span className="gv-lobby-bg bt" aria-hidden="true" />
      <div className="gv-lobby-in">
        <header className="gv-lobby-head">
          <span className="gv-lobby-kicker">
            <Music2 size={13} /> Blind test · buzzer
          </span>
          <h1 className="gv-lobby-title">Salon {room.code.toUpperCase()}</h1>
          <p className="gv-lobby-sub">
            Le même extrait pour tout le monde, en même temps. Le premier qui trouve
            arrête la manche et rafle les points — trois vies chacun.
          </p>
        </header>

        {err && <p className="gv-err">{err}</p>}

        <div className="gv-seats">
          {active.map((p) => (
            <div
              key={p.id}
              className={`gv-seat ${p.ready ? "ready" : ""} ${p.isMe ? "me" : ""}`}
              style={{ "--hue": hueById.get(p.id) }}
            >
              <VersusFace user={p} size={52} hue={hueById.get(p.id)} />
              <b>{p.username}</b>
              <em>
                {p.isHost ? (
                  <>
                    <Crown size={11} /> hôte
                  </>
                ) : p.ready ? (
                  <>
                    <Check size={11} /> prêt
                  </>
                ) : (
                  "en attente"
                )}
              </em>
            </div>
          ))}
          {Array.from({ length: Math.max(0, 5 - active.length) }).map((_, i) => (
            <button key={`e${i}`} className="gv-seat empty clickable" onClick={onInvite}>
              <span className="gv-seat-plus">
                <UserPlus size={20} />
              </span>
              <em>Inviter</em>
            </button>
          ))}
        </div>

        <div className="gv-rounds">
          <span className="gv-rounds-lbl">Manches</span>
          <div className="bt-rounds-opts">
            {[5, 8, 12].map((n) => (
              <button
                key={n}
                className={`bt-round-opt clickable ${room.roundCount === n ? "on" : ""}`}
                onClick={() => onRounds(n)}
                disabled={!room.isHost || busy}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="gv-lobby-actions">
          <button className="gv-ghost clickable" onClick={onInvite}>
            <UserPlus size={16} /> Inviter
          </button>
          <button className="gv-ghost clickable" onClick={copyLink}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Lien copié" : "Copier le lien"}
          </button>
          {room.isHost ? (
            <button
              className="bt-start clickable"
              onClick={onStart}
              disabled={active.length < 2 || busy}
            >
              {busy ? <Loader2 size={18} className="spin" /> : <Play size={18} />}
              {active.length < 2 ? "Il manque du monde" : "Lancer la partie"}
            </button>
          ) : (
            <button className="bt-start clickable" onClick={onReady} disabled={busy}>
              {me?.ready ? <RotateCcw size={18} /> : <Check size={18} />}
              {me?.ready ? "Pas prêt" : "Je suis prêt"}
            </button>
          )}
        </div>

        <p className="gv-lobby-note">
          {room.isHost
            ? `${ready}/${active.length} prêt${ready > 1 ? "s" : ""} — tu peux lancer quand tu veux.`
            : "L'hôte lance la partie."}
        </p>
      </div>
    </section>
  );
}

// ============================================================
//  La révélation
// ============================================================
function Reveal({ round, players, meId, hueById }) {
  // Écouter le morceau EN ENTIER : le serveur envoie le videoId à la
  // révélation, précisément pour ça. Le mini-lecteur global s'en charge — et il
  // se taira tout seul au départ de la manche suivante (voir plus haut).
  const player = usePlayer();
  const fullTrack = round.videoId
    ? {
        id: `btv-${round.gameId}-${round.videoId}`,
        videoId: round.videoId,
        name: round.ostName || round.gameName,
        artist: round.gameName,
        artwork: round.cover || null,
        gameId: round.gameId,
        gameName: round.gameName,
      }
    : null;
  const fullOn = !!(fullTrack && player?.isPlaying?.(fullTrack));

  const results = round.results || [];
  const mine = results.find((r) => r.userId === meId);
  const champ = players.find((p) => p.id === round.winner);
  const iBuzzed = round.winner === meId;
  const rows = players
    .filter((p) => !p.left)
    .map((p) => ({ p, r: results.find((x) => x.userId === p.id) }))
    .sort((a, b) => (b.r?.points || 0) - (a.r?.points || 0));

  return (
    <div className="bt-overlay" role="dialog" aria-modal="true">
      <div className="bt-reveal-wrap">
        <div className={`bt-reveal ${iBuzzed ? "good" : "bad"}`}>
          <i className="bt-reveal-progress" aria-hidden="true" />
          <span className="bt-reveal-verdict">
            {iBuzzed
              ? "Buzz gagnant !"
              : champ
                ? `${champ.username} a buzzé`
                : "Personne n'a trouvé"}
            <b className="bt-reveal-pts up">+{mine?.points || 0}</b>
          </span>
          <div className="bt-reveal-cover">
            {round.cover ? (
              <img src={round.cover} alt="" draggable="false" />
            ) : (
              <span className="bt-reveal-ph">
                <Gamepad2 size={34} />
              </span>
            )}
            <span className="bt-reveal-badge">
              {mine?.correct ? <Check size={22} /> : <X size={22} />}
            </span>
          </div>
          <span className="bt-reveal-game">{round.gameName}</span>
          {round.ostName && (
            <span className="bt-reveal-ost">
              <Music2 size={12} /> {round.ostName}
            </span>
          )}
          {fullTrack && (
            <button
              className={`bt-reveal-full clickable ${fullOn ? "on" : ""}`}
              onClick={() =>
                player?.toggleTrack?.(fullTrack, [fullTrack], {
                  source: fullTrack.gameName ? { label: fullTrack.gameName } : undefined,
                })
              }
            >
              {fullOn ? <Pause size={12} /> : <Music2 size={12} />}
              <span>{fullOn ? "En cours d'écoute" : "Écouter en entier"}</span>
            </button>
          )}

          <ul className="gv-rv-table">
            {rows.map(({ p, r }) => (
              <li
                key={p.id}
                className={`${p.id === meId ? "me" : ""} ${r?.correct ? "ok" : ""}`}
                style={{ "--hue": hueById.get(p.id) }}
              >
                <VersusFace user={p} size={20} hue={hueById.get(p.id)} />
                <span className="gv-rv-name">{p.username}</span>
                {p.id === round.winner && (
                  <span className="gv-rv-tag" title="A buzzé">
                    <Crown size={10} />
                  </span>
                )}
                <span className="gv-rv-pts">+{r?.points || 0}</span>
                <span className="gv-rv-total">{p.score}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  Le tableau final
// ============================================================
function Podium({ room, ranking, hueById, busy, onAgain }) {
  const champ = ranking[0];
  return (
    <section className="gv-done bt-done">
      <div className="gv-podium-hero">
        <span className="gv-podium-crown">
          <Crown size={30} />
        </span>
        <h1>{champ?.user?.username || champ?.username} remporte le versus</h1>
        <p>Blind test buzzer · {room.roundCount} manches</p>
      </div>

      <ol className="gv-podium">
        {ranking.map((r, i) => {
          const u = r.user || r;
          const id = String(u.id || r.id);
          return (
            <li
              key={id}
              className={`gv-podium-row r${i + 1} ${u.isMe || r.isMe ? "me" : ""}`}
              style={{ "--hue": hueById.get(id) }}
            >
              <span className="gv-podium-rank">
                {i === 0 ? <Crown size={15} /> : i === 1 || i === 2 ? <Medal size={14} /> : i + 1}
              </span>
              <VersusFace user={u} size={38} hue={hueById.get(id)} />
              <span className="gv-podium-id">
                <b>{u.username}</b>
                <em>
                  <Music2 size={11} /> {r.correct ?? r.correctCount ?? 0}/{room.roundCount}{" "}
                  trouvés
                </em>
              </span>
              <span className="gv-podium-score">
                {r.score}
                <em>pts</em>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="gv-done-actions">
        {room.isHost && (
          <button className="bt-start sm clickable" onClick={onAgain} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />} Rejouer
          </button>
        )}
        <Link to="/blindtest" className="bt-ghost clickable">
          <Music2 size={16} /> Blind Test
        </Link>
        <Link to="/arcade" className="bt-ghost clickable">
          Arcade
        </Link>
      </div>

      <p className="gv-done-note">
        <Users size={12} /> Les points de chacun sont crédités à l'arcade — le vainqueur
        touche 20&nbsp;% de plus.
      </p>
    </section>
  );
}
