import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Eye,
  Gamepad2,
  Globe2,
  Heart,
  Loader2,
  MapPin,
  Medal,
  Play,
  RotateCcw,
  Search,
  SkipForward,
  Swords,
  Timer,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { apiFetch } from "../lib/api";
import { useLiveStatus } from "../lib/presence";
import { dedupeCandidates, searchCandidates } from "../lib/guessGame";
import { useGameSfx } from "../lib/useGameSfx";
import { VersusFace, VersusRail, VersusInvite, HUES } from "../components/VersusRoom";
import MapRound, { TimerRing } from "../components/GeoMapRound";

// ======================================================================
//  GeoGamer VERSUS — le même panorama, en même temps, à plusieurs
// ======================================================================
// Le solo est une exploration ; ceci est une course. Toute la page découle de
// cette différence : on ne joue plus contre un catalogue mais contre quatre
// personnes qu'on connaît, et la première chose qu'on veut savoir à tout
// instant, c'est OÙ ELLES EN SONT.
//
// D'où le seul vrai ajout d'interface par rapport au solo : le RAIL DES
// JOUEURS, en haut à gauche, jamais masqué. Il ne dit pas la même chose selon
// le mode, et c'est exactement là que se joue la distinction :
//
//   CLASSIQUE  on ne voit QUE l'état — « a trouvé, 2ᵉ ». Rien de ce qui est
//              tapé ne fuit, pas même une mauvaise réponse : savoir qu'un ami a
//              cru reconnaître Zelda, c'est déjà un indice.
//   BUZZER     on voit tout, en direct — les lettres qui s'écrivent chez les
//              autres, leurs erreurs qui tombent. C'est bruyant, c'est le but :
//              la manche s'arrête au premier bon jeu, il faut sentir venir.
//
// ------------------------------------------------------------- qui commande
// LE SERVEUR MÈNE LA PARTIE (routes/geoVersus.js). Cette page ne décide de rien :
// elle affiche ce qu'on lui envoie et transmet ce qu'on tape. Les manches
// s'enchaînent toutes seules même si on ferme l'onglet, et surtout la réponse
// n'arrive JAMAIS avant la révélation — impossible de la lire en avance dans
// les outils de développement.
//
// Le direct passe par le flux SSE de la messagerie (évènement « geoversus »),
// déjà ouvert pour le chat — aucun tunnel supplémentaire.
const PanoViewer = lazy(() => import("../components/PanoViewer"));

const LIVES = 3;
const HOT_SEC = 10;
// Cadence d'envoi de « ce que je tape » en buzzer. Assez serré pour qu'on voie
// les lettres arriver, assez lâche pour ne pas poster à chaque touche.
const TYPING_MS = 200;
const TYPING_TTL = 4000;

const hueOf = (i) => HUES[i % HUES.length];

const MODES = {
  classic: {
    label: "Classique",
    Icon: Users,
    tag: "chacun dans son coin",
    blurb:
      "Tout le monde a le même lieu, mais personne ne voit ce que tapent les autres — seulement qui a trouvé. L'ordre d'arrivée fait le score.",
  },
  buzzer: {
    label: "Buzzer",
    Icon: Zap,
    tag: "le premier rafle tout",
    blurb:
      "Vous voyez tout le monde chercher en direct, lettre à lettre. Le premier bon jeu arrête la manche et prend les points. Trois vies chacun.",
  },
};

export default function GeoVersus() {
  const { code } = useParams();
  const { token, user } = useAuth();
  const { subscribe } = useChat();
  const navigate = useNavigate();
  const sfx = useGameSfx();

  const [room, setRoom] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [typers, setTypers] = useState({});
  // userId → instant du dernier raté, pour la secousse du rail (éphémère).
  const [missed, setMissed] = useState({});
  const [flash, setFlash] = useState(null); // « raté ! » local
  const [input, setInput] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [panoReady, setPanoReady] = useState(false);
  const [tick, setTick] = useState(0); // bat la seconde pour les chronos
  const [ranking, setRanking] = useState(null);
  // Vote « manche suivante » de la révélation : qui a déjà cliqué.
  const [skip, setSkip] = useState({ ready: [], total: 0 });

  const inputRef = useRef(null);
  const suggestRef = useRef(null);
  const typingRef = useRef({ at: 0, timer: null });
  // Écart entre l'horloge du serveur et la nôtre. Sans lui, une machine en
  // avance de trente secondes jouerait une manche déjà finie.
  const offsetRef = useRef(0);
  const pinSentRef = useRef(false);
  const cuedRef = useRef(-1); // manche dont on a déjà traité le sas

  const meId = user?.id ? String(user.id) : "";
  const phase = room?.phase || "lobby";
  const round = room?.round || null;
  const mode = room?.mode || "classic";
  const isHost = !!room?.isHost;
  const players = useMemo(() => room?.players || [], [room]);
  const me = players.find((p) => p.isMe) || null;
  const hueById = useMemo(() => {
    const m = new Map();
    players.forEach((p, i) => m.set(p.id, hueOf(i)));
    return m;
  }, [players]);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const applyRoom = useCallback((r) => {
    if (!r) return;
    if (typeof r.now === "number") offsetRef.current = r.now - Date.now();
    setRoom(r);
  }, []);

  // ---------- Chargement ----------
  const load = useCallback(async () => {
    try {
      const d = await apiFetch(`/geo/versus/${code}`, { token });
      applyRoom(d.room);
      if (d.candidates) setCandidates(d.candidates);
      setErr("");
      // Arrivée par un lien : on entre tout seul. Contrairement au mot du jour,
      // rejoindre ne coûte rien (il n'y a pas d'essais à verser au pot commun) —
      // une modale de confirmation ne ferait que retarder l'entrée.
      if (!d.member && d.room && !d.room.started && !d.room.endedAt) join();
    } catch (e) {
      setErr(e.message || "Salon introuvable.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, token, applyRoom]);

  useEffect(() => {
    if (token && code) load();
  }, [token, code, load]);

  // ---------- La liste de recherche des INVITÉS ----------
  // Elle ne voyage QUE dans la réponse à `/start`… que seul l'hôte reçoit. Les
  // autres joueurs partaient donc en manche avec une liste vide : taper ne
  // proposait rien, et il fallait recharger la page pour que le GET du salon
  // la rapporte. Elle est trop grosse pour être diffusée en SSE à chaque
  // manche — chacun va donc la chercher une fois, au lancement.
  useEffect(() => {
    if (!token || !code) return undefined;
    if (!room?.started || phase === "done" || candidates.length) return undefined;
    let alive = true;
    apiFetch(`/geo/versus/${code}`, { token })
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

  // ---------- Le direct ----------
  useEffect(() => {
    if (!subscribe || !code) return undefined;
    return subscribe((event, data) => {
      if (event !== "geoversus" || data?.code !== code) return;

      // La plupart des évènements portent l'état complet du salon, vu par MOI
      // (les vies et les essais visibles diffèrent d'un joueur à l'autre).
      if (data.room) applyRoom(data.room);

      switch (data.kind) {
        case "cue": {
          // Le sas se rediffuse à chaque atterrissage (il annonce qui l'on
          // attend) : on ne remet les compteurs à zéro que pour une NOUVELLE
          // manche. Sans ce garde-fou, `panoReady` retombait à faux alors que
          // le décor était déjà affiché — et comme `onReady` ne se déclenche
          // qu'une fois, on n'aurait plus jamais annoncé son atterrissage.
          const at = data.room?.round?.index ?? data.room?.index ?? 0;
          if (cuedRef.current === at) break;
          cuedRef.current = at;
          setPanoReady(false);
          setInput("");
          setHighlight(0);
          setFlash(null);
          setTypers({});
          pinSentRef.current = false;
          sfx.play("start");
          break;
        }
        case "go":
          setTimeout(() => inputRef.current?.focus(), 60);
          break;
        case "guess": {
          // Diffusé sans l'état complet (il part à chaque touche) : on recolle
          // seulement ce qui change.
          const mineNow = data.by === meId;
          if (!mineNow) sfx.play(data.correct ? "correct" : "wrong");
          // Un raté secoue la ligne de son auteur dans le rail. C'est la seule
          // façon de VOIR l'évènement : les cœurs, eux, changent en silence, et
          // on ne quitte pas le panorama des yeux pour surveiller un compteur.
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
                            ...r.round.attempts,
                            { userId: data.by, name: data.name, correct: data.correct },
                          ]
                        : r.round.attempts,
                  },
                }
              : r
          );
          // Son mot est parti : on efface ce qu'on le voyait taper.
          setTypers((t) => {
            const next = { ...t };
            delete next[data.by];
            return next;
          });
          break;
        }
        case "typing":
          setTypers((t) => ({ ...t, [data.by]: { text: data.text, at: Date.now() } }));
          break;
        case "pin":
          setRoom((r) =>
            r?.round ? { ...r, round: { ...r.round, pinned: data.pinned } } : r
          );
          break;
        case "map":
          pinSentRef.current = false;
          sfx.play("map-open");
          break;
        case "reveal":
          setSkip({ ready: [], total: 0 });
          sfx.play(
            data.room?.round?.results?.find((x) => x.userId === meId)?.correct
              ? "correct"
              : "wrong"
          );
          break;
        case "skip":
          setSkip({ ready: data.ready || [], total: data.total || 0 });
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

  // Les indicateurs de frappe s'éteignent d'eux-mêmes : si un joueur ferme son
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

  // Un battement de cœur pour les chronos : les bornes viennent du serveur, il
  // n'y a qu'à redessiner. Inutile de tourner hors des phases minutées.
  useEffect(() => {
    if (phase === "lobby" || phase === "done") return undefined;
    const iv = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(iv);
  }, [phase]);

  // Mode immersif dès que la partie est lancée (même bascule que le solo).
  const immersive = phase !== "lobby" && phase !== "done";
  useEffect(() => {
    if (!immersive) return undefined;
    document.body.classList.add("geo-immersive");
    window.dispatchEvent(new CustomEvent("mpl:sidebar-force", { detail: true }));
    return () => {
      document.body.classList.remove("geo-immersive");
      window.dispatchEvent(new CustomEvent("mpl:sidebar-force", { detail: false }));
    };
  }, [immersive]);

  useLiveStatus(
    "geo",
    room?.started && phase !== "done"
      ? `versus ${MODES[mode].label.toLowerCase()} · manche ${(room.index || 0) + 1}/${
          room.roundCount
        }`
      : "",
    { token }
  );

  // Préchargement de la manche suivante : le fichier atterrit dans le cache
  // HTTP pendant la révélation, et le sas de départ n'attend plus rien.
  useEffect(() => {
    if (!round?.image) return undefined;
    const ac = new AbortController();
    fetch(round.image, { signal: ac.signal, mode: "cors" })
      .then((r) => r.blob())
      .catch(() => {});
    return () => ac.abort();
  }, [round?.image]);

  // ---------- Actions ----------
  async function post(path, body) {
    return apiFetch(`/geo/versus/${code}${path}`, { method: "POST", token, body });
  }

  // Retour au salon (fin de partie, « on rejoue ») : la prochaine manche 0 est
  // une VRAIE nouvelle manche, son sas doit repartir de zéro.
  useEffect(() => {
    if (phase === "lobby") cuedRef.current = -1;
  }, [phase]);

  // ---------- « J'ai atterri » ----------
  // Le sas ne se referme que quand TOUT LE MONDE a son décor à l'écran (voir
  // POST /:code/armed côté serveur) : c'est ce qui règle le « je suis encore en
  // atterrissage alors que les autres tapent déjà ». On l'annonce quand la
  // texture est affichée — pas quand le téléchargement finit : sur téléphone,
  // décoder l'image et la monter en texture prend encore une bonne seconde.
  const armed = useMemo(() => round?.armed || [], [round?.armed]);
  const iAmArmed = armed.includes(meId);
  // Ceux qu'on attend, nous exclus (pour nous, c'est notre propre chargement
  // qui s'affiche, pas une attente).
  const waitingFor = useMemo(
    () => players.filter((p) => !p.left && p.id !== meId && !armed.includes(p.id)),
    [players, armed, meId]
  );

  useEffect(() => {
    if (phase !== "cue" || !panoReady || iAmArmed || room?.index == null) return undefined;
    let alive = true;
    const send = () => post("/armed", { index: room.index }).catch(() => {});
    send();
    // Filet : tant que le serveur ne nous a pas comptés, on répète. Une seule
    // annonce perdue bloquerait la manche de tout le salon jusqu'à la butée.
    const iv = setInterval(() => alive && send(), 1500);
    return () => {
      alive = false;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, room?.index, panoReady, iAmArmed]);

  async function join() {
    try {
      const d = await post("/join");
      applyRoom(d.room);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function toggleReady() {
    if (busy) return;
    setBusy(true);
    try {
      const d = await post("/ready", { ready: !me?.ready });
      applyRoom(d.room);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setMode(next) {
    if (!isHost || busy) return;
    setBusy(true);
    try {
      const d = await post("/mode", { mode: next });
      applyRoom(d.room);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setRounds(n) {
    if (!isHost || busy) return;
    setBusy(true);
    try {
      const d = await post("/mode", { rounds: n });
      applyRoom(d.room);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!isHost || busy) return;
    setBusy(true);
    setErr("");
    sfx.resume();
    try {
      const d = await post("/start");
      applyRoom(d.room);
      if (d.candidates) setCandidates(d.candidates);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function playAgain() {
    if (!isHost || busy) return;
    setBusy(true);
    try {
      const d = await post("/again");
      applyRoom(d.room);
      setRanking(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function quit() {
    try {
      await post("/leave");
    } catch {
      /* on part quand même */
    }
    navigate("/geo");
  }

  // Diffusion de ce que je tape (buzzer uniquement), à cadence bornée.
  // Diffusion de ce que je tape. DEUX RAISONS DE L'ENVOYER, et il a longtemps
  // manqué la seconde :
  //   buzzer     tout le monde voit tout, c'est le spectacle du mode ;
  //   classique  les SPECTATEURS voient les autres chercher (cf. watcherIds
  //              côté serveur, qui filtre les destinataires).
  // Sans le `hasAudience`, on posterait dans le vide tant que personne n'a fini
  // sa manche — c'est-à-dire la plupart du temps.
  function pushTyping(text) {
    if (phase !== "round") return;
    if (mode !== "buzzer" && !hasAudience) return;
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

  const settled = !!round?.settled;
  const lives = round?.lives ?? LIVES;

  // ---------- Qui cherche encore, qui regarde ----------
  // Une manche « réglée » (trouvée ou sans vie) sort son joueur de la course :
  // il devient spectateur. C'est la même définition que côté serveur — elle
  // décide à la fois de ce qu'on a le droit de recevoir et de ce qu'on affiche.
  const settledIds = useMemo(() => {
    const s = new Set(round?.out || []);
    for (const f of round?.found || []) s.add(f.userId);
    return s;
  }, [round]);

  const searchers = useMemo(
    () => players.filter((p) => !p.left && !settledIds.has(p.id)),
    [players, settledIds]
  );

  // Y a-t-il seulement quelqu'un pour me regarder ? Sans public, on n'envoie
  // pas une seule requête : le cas le plus courant (tout le monde cherche
  // encore) ne coûte donc rien du tout.
  const hasAudience = useMemo(
    () => players.some((p) => !p.left && p.id !== meId && settledIds.has(p.id)),
    [players, settledIds, meId]
  );

  // Je regarde les autres : ma manche est finie, la leur non.
  //
  // CLASSIQUE UNIQUEMENT. En buzzer la manche s'arrête au premier bon jeu :
  // l'attente qu'on cherchait à meubler n'existe pas, et le mode montre déjà
  // tout en direct sous le champ de saisie. Y ajouter des lucarnes serait un
  // deuxième spectacle par-dessus le premier.
  // ---------- La carte, en classique, se joue DANS la manche ----------
  // Dès qu'on a trouvé le jeu : plus de phase commune, plus d'attente. Le
  // chrono qui reste est celui de la manche — trouver vite achète du temps de
  // carte. Voir l'en-tête d'`endRound` côté serveur.
  const iFound = !!round?.found?.some((f) => f.userId === meId);
  const iPinned = !!round?.pinned?.includes(meId);
  const inlineMap =
    mode === "classic" && phase === "round" && iFound && !!round?.map && !iPinned;

  const watchable = mode === "classic";
  // On ne regarde les autres qu'une fois SA propre carte réglée : elle est
  // chronométrée, elle passe devant.
  const spectating =
    watchable && phase === "round" && settled && !inlineMap && searchers.length > 0;

  async function submitGuess(cand) {
    if (!cand || settled || phase !== "round") return;
    setInput("");
    setHighlight(0);
    pushTyping("");
    try {
      const d = await post("/guess", { gameId: cand.id, name: cand.name });
      sfx.play(d.correct ? "correct" : "wrong");
      if (!d.correct) setFlash({ name: cand.name, left: d.lives, at: Date.now() });
      // Mes vies et mon verrouillage ne viennent QUE d'ici : la diffusion à la
      // salle ne les porte pas (elle trahirait mes ratés aux autres), et le
      // prochain état complet du salon n'arrive qu'à la fin de la manche.
      setRoom((r) =>
        r?.round ? { ...r, round: { ...r.round, lives: d.lives, settled: d.settled } } : r
      );
    } catch (e) {
      // Manche déjà close pendant l'aller-retour : ce n'est pas une erreur à
      // montrer, l'écran a déjà basculé.
      if (e.status !== 409) setErr(e.message);
    }
  }

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 1700);
    return () => clearTimeout(t);
  }, [flash]);

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

  const onPanoReady = useCallback(() => {
    setPanoReady(true);
    sfx.play("land");
  }, [sfx]);

  // Décor introuvable : on l'annonce quand même « atterri ». La manche sera
  // injouable pour moi, mais bloquer les quatre autres jusqu'à la butée du sas
  // serait pire — et il n'y a plus rien à attendre de mon côté.
  const onPanoFailed = useCallback(() => setPanoReady(true), []);

  // Les épingles de tout le monde, pour la révélation de la manche carte. C'est
  // LE moment du mode buzzer : on découvre d'un coup qui connaissait vraiment le
  // coin, et de combien on s'est fait souffler la première place.
  const mapReveal = useMemo(() => {
    if (phase !== "reveal" || !round?.map?.answer) return null;
    const entries = (round.results || [])
      .filter((r) => r.map)
      .map((r) => {
        const i = players.findIndex((p) => p.id === r.userId);
        return {
          id: r.userId,
          name: players[i]?.username || "?",
          x: r.map.x,
          y: r.map.y,
          distance: r.map.distance,
          rank: r.map.rank,
          points: r.map.points,
          isMe: r.userId === meId,
          hue: Math.max(0, i),
        };
      });
    return entries.length ? { answer: round.map.answer, entries } : null;
  }, [phase, round, players, meId]);

  // ---------- Chronos dérivés ----------
  const now = serverNow();
  void tick; // le battement force le rendu ; la valeur elle-même ne sert pas
  const msLeft = room?.phaseEndsAt ? Math.max(0, room.phaseEndsAt - now) : 0;
  const secondsLeft = Math.ceil(msLeft / 1000);
  const total = room ? Math.max(1, room.phaseEndsAt - room.phaseStartsAt) : 1;
  const progress = Math.min(1, Math.max(0, 1 - msLeft / total));
  const cueLeft = room?.phaseStartsAt ? Math.ceil((room.phaseStartsAt - now) / 1000) : 0;
  const hot = phase === "round" && secondsLeft <= HOT_SEC;

  // ---------- Écrans ----------
  if (loading) {
    return (
      // `gv` dès l'attente : sans lui, la page s'ouvrait noire une seconde
      // avant de virer au thème du site en arrivant sur le salon.
      <div className="geo gv">
        <section className="geo-wait">
          <Loader2 size={32} className="spin" />
          <p>On ouvre le salon…</p>
        </section>
      </div>
    );
  }

  if (err && !room) {
    return (
      <div className="geo gv">
        <section className="geo-wait err">
          <p>{err}</p>
          <div className="geo-wait-actions">
            <Link to="/geo" className="geo-cta sm clickable">
              <Globe2 size={16} /> GeoGamer
            </Link>
            <Link to="/arcade" className="geo-ghost clickable">
              Retour à l'arcade
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`geo gv ${immersive ? "in-game" : ""}`}>
      {/* ---------- SALON D'ATTENTE ---------- */}
      {phase === "lobby" && (
        <Lobby
          room={room}
          me={me}
          hueById={hueById}
          busy={busy}
          err={err}
          onMode={setMode}
          onRounds={setRounds}
          onReady={toggleReady}
          onStart={start}
          onInvite={() => setShowInvite(true)}
          onQuit={quit}
        />
      )}

      {/* ---------- PARTIE ---------- */}
      {immersive && round && (
        <section className={`geo-game ${hot ? "hot" : ""}`}>
          <Suspense
            fallback={
              <div className="pano-load">
                <Loader2 size={30} className="spin" />
                <span className="pano-load-txt">Préparation du décor…</span>
              </div>
            }
          >
            <PanoViewer
              key={round.image}
              src={round.image}
              interactive
              onReady={onPanoReady}
              onFailed={onPanoFailed}
            />
          </Suspense>

          <span className="geo-vignette" aria-hidden="true" />
          <span className="geo-frame" aria-hidden="true">
            <i className="tl" />
            <i className="tr" />
            <i className="bl" />
            <i className="br" />
          </span>

          {/* ---- HUD haut : le rail des joueurs, le chrono, la sortie ---- */}
          <header className="geo-hud-top">
            <div className="geo-hud-l">
              <div className="geo-state">
                <span className="geo-state-round">
                  {(room.index || 0) + 1}
                  <em>/{room.roundCount}</em>
                </span>
                <i className="geo-state-sep" aria-hidden="true" />
                <span className={`gv-mode-chip ${mode}`}>
                  {mode === "buzzer" ? <Zap size={12} /> : <Users size={12} />}
                  {MODES[mode].label}
                </span>
              </div>
              <VersusRail
                players={players}
                found={round.found}
                out={round.out}
                livesById={round.livesById}
                hueById={hueById}
                missed={missed}
                lives={LIVES}
                // Deux états propres à GeoGamer viennent se substituer à la
                // ligne d'état standard : ce que tape l'adversaire (buzzer) et
                // l'avancement de la manche carte.
                renderSub={(p, { hit }) => {
                  if (phase === "map")
                    return (
                      <em>
                        {round.pinned?.includes(p.id) ? "épingle posée" : "cherche sur la carte…"}
                      </em>
                    );
                  const typing = typers[p.id]?.text;
                  if (mode === "buzzer" && typing && !hit)
                    return (
                      <em className="gv-rail-typing">
                        {typing.toUpperCase()}
                        <i className="gv-caret" aria-hidden="true" />
                      </em>
                    );
                  return null;
                }}
              />
            </div>

            <TimerRing
              seconds={phase === "round" ? secondsLeft : 0}
              progress={phase === "round" ? progress : 0}
              hot={hot}
              idle={phase !== "round"}
            />

            <div className="geo-hud-r">
              <button className="geo-icon-btn clickable" onClick={quit} title="Quitter la partie">
                <X size={18} />
              </button>
            </div>
          </header>

          {/* ---- Sas de départ : « 3, 2, 1 » pendant que le décor charge ---- */}
          {phase === "cue" && (
            <div className="gv-cue">
              <span className="gv-cue-num" key={cueLeft}>
                {cueLeft > 0 ? cueLeft : "!"}
              </span>
              <span className="gv-cue-txt">
                {!panoReady
                  ? "Chargement du lieu…"
                  : waitingFor.length
                    ? `On attend ${waitingFor.map((p) => p.username).join(", ")}…`
                    : "Prêt — tout le monde part ensemble"}
              </span>
              {/* Les têtes de ceux qui ont déjà atterri : on voit le salon se
                  remplir au lieu de fixer un décompte qui ne bouge plus. */}
              {panoReady && waitingFor.length > 0 && (
                <span className="gv-cue-wait">
                  {players
                    .filter((p) => !p.left)
                    .map((p) => (
                      <i key={p.id} className={armed.includes(p.id) ? "on" : ""}>
                        <VersusFace user={p} size={26} hue={hueById.get(p.id)} />
                      </i>
                    ))}
                </span>
              )}
            </div>
          )}

          {/* ---- Recherche ---- */}
          {phase === "round" && spectating && (
            <SpectatorGrid
              searchers={searchers}
              typers={typers}
              attempts={round.attempts}
              livesById={round.livesById}
              hueById={hueById}
              found={round.found}
              meId={meId}
              won={!!round.found?.some((f) => f.userId === meId)}
            />
          )}

          {phase === "round" && !spectating && !inlineMap && (
            <div className="geo-hud-bottom">
              {/* En buzzer, ce que tapent les autres. C'est LE spectacle du
                  mode : on voit une piste se former en face et on accélère. */}
              {mode === "buzzer" && <Typers typers={typers} players={players} hueById={hueById} />}

              <div className="geo-lives-row">
                <div className="geo-lives" aria-label={`${lives} vies restantes`}>
                  {Array.from({ length: LIVES }).map((_, i) => (
                    <Heart
                      key={i}
                      size={20}
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

              {!settled && suggestions.length > 0 && (
                <ul className="geo-suggest" ref={suggestRef}>
                  {suggestions.map((c, i) => (
                    <li key={c.id}>
                      <button
                        className={`geo-suggest-row clickable ${i === highlight ? "on" : ""}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          submitGuess(c);
                        }}
                        onMouseEnter={() => setHighlight(i)}
                      >
                        {c.cover ? (
                          <img src={c.cover} alt="" loading="lazy" draggable="false" />
                        ) : (
                          <span className="geo-suggest-ph">
                            <Gamepad2 size={13} />
                          </span>
                        )}
                        <span className="geo-suggest-name">{c.name}</span>
                        {i === highlight && <kbd>↵</kbd>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="geo-answer">
                <div className={`geo-field ${settled ? "done" : ""}`}>
                  <Search size={17} />
                  <input
                    ref={inputRef}
                    placeholder={
                      settled
                        ? lives > 0
                          ? "Trouvé — on attend les autres…"
                          : "Plus de vies sur cette manche"
                        : "Quel jeu ?"
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
              </div>
            </div>
          )}

          {/* ---- Manche carte ----
              Elle reste à l'écran PENDANT la révélation quand il y avait une
              carte : sans ça, on ne verrait jamais où les autres s'étaient
              placés — c'est-à-dire tout l'intérêt de la manche. */}
          {(phase === "map" || mapReveal || inlineMap) && round.map && (
            <div className="geo-map-dock">
              <MapRound
                map={round.map}
                gameName={round.gameName}
                sfx={sfx}
                reveal={mapReveal}
                // En classique la borne est celle de la MANCHE, en buzzer celle
                // de la phase carte : dans les deux cas `phaseEndsAt`, mais ça
                // ne veut pas dire la même chose — et c'est tout le changement.
                deadline={room.phaseEndsAt - offsetRef.current}
                eligible={mode === "buzzer" ? true : iFound}
                waiting={iPinned}
                hint={
                  mode === "buzzer"
                    ? "tout le monde joue · le plus proche rafle les points"
                    : inlineMap
                      ? "sur le temps de ta manche · situe-toi avant la fin"
                      : "molette pour zoomer · glisser pour déplacer"
                }
                onPin={(p) => {
                  if (pinSentRef.current) return;
                  pinSentRef.current = true;
                  post("/map", p).catch(() => {});
                }}
              />
            </div>
          )}

          {/* ---- Révélation ---- */}
          {phase === "reveal" && (
            <Reveal
              round={round}
              players={players}
              mode={mode}
              meId={meId}
              hueById={hueById}
              secondsLeft={secondsLeft}
              last={(room.index || 0) + 1 >= room.roundCount}
              sided={!!mapReveal}
              // La barre de décompte doit durer CE que dure la révélation, et
              // repartir au bon endroit si on arrive en cours de route (page
              // rechargée) — d'où la durée et l'écoulé, pris du serveur.
              totalMs={Math.max(0, (room.phaseEndsAt || 0) - (room.phaseStartsAt || 0))}
              elapsedMs={Math.max(0, now - (room.phaseStartsAt || 0))}
              skip={skip}
              onNext={() => {
                // Optimiste : on se compte soi-même tout de suite, l'aller-
                // retour ne doit pas donner l'impression que le clic est perdu.
                setSkip((s) =>
                  s.ready.includes(meId) ? s : { ...s, ready: [...s.ready, meId] }
                );
                post("/next").catch(() => {});
              }}
            />
          )}
        </section>
      )}

      {/* ---------- TABLEAU FINAL ---------- */}
      {phase === "done" && (
        <Podium
          room={room}
          // `ranking` vient de l'évènement de fin. Au rechargement d'une page
          // sur une partie déjà finie il n'y a pas d'évènement à attendre : on
          // reconstruit le classement depuis les scores du salon.
          ranking={
            ranking ||
            [...players]
              .filter((p) => !p.left)
              .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount)
              .map((p, i) => ({ ...p, user: p, rank: i + 1, correct: p.correctCount }))
          }
          hueById={hueById}
          isHost={isHost}
          busy={busy}
          onAgain={playAgain}
        />
      )}

      {showInvite && room && (
        <VersusInvite
          token={token}
          meId={meId}
          room={room}
          endpoint={`/geo/versus/${room.code}/invite`}
          title="Inviter au versus"
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  );
}

// ======================================================================
//  La régie — regarder les autres chercher
// ======================================================================
// LE PROBLÈME QU'ELLE RÈGLE : trouver vite était PUNI. On rendait sa copie en
// douze secondes, puis on regardait un champ grisé pendant trente. Le mode
// récompensait la vitesse au score et la sanctionnait au plaisir — et c'est
// évidemment le bon joueur qui attendait le plus longtemps.
//
// CE QU'ELLE MONTRE, ET RIEN D'AUTRE : ce que les autres TAPENT. Lettre à
// lettre, avec leurs fausses pistes qui s'empilent à côté. On voit une piste se
// former, hésiter, se tromper — c'est le seul morceau de leur partie qui
// raconte quelque chose.
//
// Il a existé ici une reconstitution de leur PANORAMA (leur cadrage rejoué en
// direct à partir de trois angles). Techniquement élégante, visuellement
// saccadée, et surtout muette : regarder quelqu'un balayer un décor n'apprend
// rien tant qu'on ne sait pas ce qu'il y cherche. Supprimée — la frappe seule
// dit tout, et elle ne coûte qu'un message quand une touche est enfoncée.
//
// Le droit de regarder se vérifie CÔTÉ SERVEUR, jamais ici : on ne reçoit ces
// évènements qu'une fois sa propre manche finie (watcherIds, routes/geoVersus.js).
// Cette page ne peut donc pas devenir une antisèche, même en trafiquant le client.

// On garde les trois derniers ratés : au-delà, la carte s'allonge sans rien
// apprendre de plus — ce qui compte, c'est de quel côté il cherche EN CE MOMENT.
const MISS_SHOWN = 3;

function SpectatorGrid({ searchers, typers, attempts, livesById, hueById, found, meId, won }) {
  const mineOrder = found?.find((f) => f.userId === meId)?.order;

  return (
    // Plein écran, centré, sur fond assombri et flouté : quand on regarde, on
    // REGARDE. Un bandeau en bas de son propre panorama laissait croire qu'on
    // jouait encore. Le calque reste SOUS le HUD haut (z-index) : le chrono et
    // le rail restent nets, ce sont les deux choses qu'on veut encore lire.
    <div className="gv-watch">
      <div className="gv-watch-in">
        <header className="gv-watch-head">
          <span className={`gv-watch-verdict ${won ? "ok" : "ko"}`}>
            {won ? <Check size={13} /> : <X size={13} />}
            {won ? (mineOrder ? `Trouvé · ${mineOrder}ᵉ` : "Trouvé") : "Plus de vies"}
          </span>
          <h2 className="gv-watch-title">
            <i className="gv-watch-live" aria-hidden="true" />
            {searchers.length > 1
              ? `${searchers.length} joueurs cherchent encore`
              : `${searchers[0]?.username || "Un joueur"} cherche encore`}
          </h2>
          <p className="gv-watch-sub">
            <Eye size={12} /> Tu vois ce qu'ils tapent, en direct.
          </p>
        </header>

        <ul className="gv-watch-list">
          {searchers.slice(0, 4).map((p) => (
            <SpectatorRow
              key={p.id}
              player={p}
              typing={typers[p.id]?.text || ""}
              misses={(attempts || [])
                .filter((a) => a.userId === p.id && !a.correct && a.name)
                .map((a) => a.name)}
              lives={livesById?.[p.id] ?? LIVES}
              hue={hueById.get(p.id)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function SpectatorRow({ player, typing, misses, lives, hue }) {
  const shown = misses.slice(-MISS_SHOWN);
  return (
    <li
      className={`gv-spy ${typing ? "live" : ""} ${lives <= 1 ? "hot" : ""}`}
      style={{ "--hue": hue }}
    >
      <VersusFace user={player} size={38} hue={hue} />

      <div className="gv-spy-body">
        <span className="gv-spy-top">
          <b>{player.username}</b>
          <span className="gv-spy-lives" aria-label={`${lives} vies restantes`}>
            {Array.from({ length: LIVES }).map((_, i) => (
              <Heart
                key={i}
                size={12}
                className={i < lives ? "on" : "off"}
                fill={i < lives ? "currentColor" : "none"}
              />
            ))}
          </span>
        </span>

        {/* LA LIGNE QU'ON EST VENU VOIR. Elle garde sa hauteur même vide :
            sinon chaque frappe ferait sauter toute la pile de cartes. */}
        <span className="gv-spy-type">
          {typing ? (
            <>
              <span className="gv-spy-word">{typing}</span>
              <i className="gv-caret" aria-hidden="true" />
            </>
          ) : (
            <em>cherche…</em>
          )}
        </span>

        {shown.length > 0 && (
          <span className="gv-spy-misses">
            {shown.map((m, i) => (
              // La clé porte le rang : deux fois la même fausse piste ne doit
              // pas se fondre en une seule pastille.
              <i key={`${m}-${i}`}>
                <X size={10} />
                {m}
              </i>
            ))}
          </span>
        )}
      </div>
    </li>
  );
}

// ---------- « X est en train de taper HOLL… » (buzzer) ----------
function Typers({ typers, players, hueById }) {
  const list = Object.entries(typers)
    .map(([id, v]) => ({ id, ...v, player: players.find((p) => p.id === id) }))
    .filter((t) => t.text && t.player);
  if (!list.length) return null;
  return (
    <div className="gv-typers">
      {list.slice(0, 4).map((t) => (
        <span className="gv-typer" key={t.id} style={{ "--hue": hueById.get(t.id) }}>
          <VersusFace user={t.player} size={20} hue={hueById.get(t.id)} />
          <span className="gv-typer-text">
            {t.text.toUpperCase()}
            <i className="gv-caret" aria-hidden="true" />
          </span>
        </span>
      ))}
    </div>
  );
}

// ============================================================
//  La révélation
// ============================================================
// Posée en bas comme en solo, pas en modale : le panorama reste visible
// derrière, et c'est le moment où l'on comprend le détail qu'on avait sous les
// yeux.
//
// ELLE N'EMPRUNTE PLUS LA COQUILLE DU SOLO. Celle-ci est une RANGÉE (badge,
// jaquette, texte, bouton) et il y avait cinq lignes de classement à y glisser :
// le tableau, en `width: 100%` dans une rangée flex, se posait par-dessus le nom
// du jeu — c'est le chevauchement qu'on voyait à l'écran. Ici la structure est
// une grille explicite en deux colonnes : à gauche CE QU'IL FALLAIT TROUVER, à
// droite CE QUE ÇA A RAPPORTÉ À QUI. Rien ne se superpose parce que rien ne
// partage plus la même cellule.
function Reveal({
  round,
  players,
  mode,
  meId,
  hueById,
  secondsLeft,
  last,
  sided,
  totalMs,
  elapsedMs,
  skip,
  onNext,
}) {
  const results = round.results || [];
  const mine = results.find((r) => r.userId === meId);
  const gain = (mine?.points || 0) + (mine?.mapPoints || 0);
  const voted = !!skip?.ready?.includes(meId);
  const alive = players.filter((p) => !p.left).length;
  const waitingFor = Math.max(0, (skip?.total || alive) - (skip?.ready?.length || 0));
  const rows = players
    .filter((p) => !p.left)
    .map((p) => ({ p, r: results.find((x) => x.userId === p.id) }))
    .sort(
      (a, b) =>
        (b.r?.points || 0) + (b.r?.mapPoints || 0) - ((a.r?.points || 0) + (a.r?.mapPoints || 0))
    );

  return (
    // `sided` : la carte de la manche bonus occupe le coin droit, la
    // révélation se décale pour ne pas lui passer dessus.
    <div className={`gv-reveal ${mine?.correct ? "good" : "bad"} ${sided ? "sided" : ""}`}>
      <i
        className="gv-rv-bar"
        aria-hidden="true"
        // Durée réelle de la phase, et départ recalé sur le temps déjà écoulé :
        // la barre du solo était figée à 5 s alors que la révélation à plusieurs
        // en dure 7, elle se vidait donc deux secondes trop tôt.
        style={
          totalMs
            ? { animationDuration: `${totalMs}ms`, animationDelay: `${-elapsedMs}ms` }
            : undefined
        }
      />

      <div className="gv-rv-head">
        <span className="gv-rv-badge">
          {mine?.correct ? <Check size={17} /> : <X size={17} />}
        </span>
        {round.cover && (
          <img className="gv-rv-cover" src={round.cover} alt="" draggable="false" />
        )}
        <span className="gv-rv-id">
          <em className="gv-rv-verdict">{mine?.correct ? "Trouvé" : "Raté"}</em>
          <b className="gv-rv-game">{round.gameName}</b>
          {mode === "buzzer" && round.winner && (
            <em className="gv-rv-buzz">
              <Zap size={11} /> buzz de{" "}
              {players.find((p) => p.id === round.winner)?.username || "?"}
            </em>
          )}
        </span>
        <span className={`gv-rv-gain ${gain > 0 ? "up" : ""}`}>
          +{gain}
          <em>pts</em>
        </span>
      </div>

      {/* Le décompte des points de la manche, joueur par joueur. */}
      <ul className="gv-rv-table">
        {rows.map(({ p, r }) => (
          <li
            key={p.id}
            className={`${p.id === meId ? "me" : ""} ${r?.correct ? "ok" : ""}`}
            style={{ "--hue": hueById.get(p.id) }}
          >
            <VersusFace user={p} size={20} hue={hueById.get(p.id)} />
            <span className="gv-rv-name">{p.username}</span>
            {r?.map?.rank === 1 && (
              <span className="gv-rv-tag" title="Épingle la plus proche">
                <MapPin size={10} />
              </span>
            )}
            <span className="gv-rv-pts">+{(r?.points || 0) + (r?.mapPoints || 0)}</span>
            <span className="gv-rv-total">{p.score}</span>
          </li>
        ))}
      </ul>

      {/* On peut couper court, mais PAS tout seul : la suite ne part en avance
          que si tout le monde a cliqué (routes/geoVersus.js → POST /next). Le
          compteur « 1/3 » est là pour ça — sans lui, un clic sans effet visible
          passerait pour un bouton cassé. */}
      <button
        className={`gv-rv-next clickable ${voted ? "voted" : ""}`}
        onClick={onNext}
        disabled={voted}
      >
        {voted ? <Check size={14} /> : <SkipForward size={14} />}
        {voted
          ? waitingFor > 0
            ? `On attend ${waitingFor} joueur${waitingFor > 1 ? "s" : ""}`
            : "C'est parti"
          : last
            ? "Tableau final"
            : "Manche suivante"}
        <b>{Math.max(0, secondsLeft)}</b>
      </button>
    </div>
  );
}

// ============================================================
//  Le salon d'attente
// ============================================================
function Lobby({
  room,
  me,
  hueById,
  busy,
  err,
  onMode,
  onRounds,
  onReady,
  onStart,
  onInvite,
  onQuit,
}) {
  const [copied, setCopied] = useState(false);
  const active = room.players.filter((p) => !p.left);
  const ready = active.filter((p) => p.ready).length;
  const canStart = room.isHost && active.length >= 2;

  async function copyLink() {
    const url = `${window.location.origin}/geo/versus/${room.code}`;
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
      <span className="gv-lobby-bg" aria-hidden="true" />

      <button className="geo-back clickable" onClick={onQuit}>
        <ArrowLeft size={16} /> Quitter
      </button>

      <div className="gv-lobby-in">
        <header className="gv-lobby-head">
          <span className="gv-lobby-kicker">
            <Swords size={13} /> GeoGamer versus
          </span>
          <h1 className="gv-lobby-title">Salon {room.code.toUpperCase()}</h1>
          <p className="gv-lobby-sub">
            Le même lieu pour tout le monde, en même temps. Jusqu'à 5 joueurs.
          </p>
        </header>

        {err && <p className="gv-err">{err}</p>}

        {/* ---- Les joueurs ---- */}
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

        {/* ---- Le mode ---- */}
        <div className="gv-modes">
          {Object.entries(MODES).map(([key, m]) => {
            const on = room.mode === key;
            return (
              <button
                key={key}
                className={`gv-mode clickable ${on ? "on" : ""} ${
                  room.isHost ? "" : "locked"
                }`}
                onClick={() => onMode(key)}
                disabled={!room.isHost || busy}
                aria-pressed={on}
              >
                <span className="gv-mode-top">
                  <m.Icon size={17} />
                  <b>{m.label}</b>
                  <i>{m.tag}</i>
                </span>
                <span className="gv-mode-blurb">{m.blurb}</span>
              </button>
            );
          })}
        </div>

        {/* ---- Le nombre de manches ---- */}
        <div className="gv-rounds">
          <span className="gv-rounds-lbl">Manches</span>
          <div className="geo-seg" role="group">
            {[5, 8, 12].map((n) => (
              <button
                key={n}
                className={`geo-seg-opt clickable ${room.roundCount === n ? "on" : ""}`}
                onClick={() => onRounds(n)}
                disabled={!room.isHost || busy}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* ---- Les commandes ---- */}
        <div className="gv-lobby-actions">
          <button className="gv-ghost clickable" onClick={onInvite}>
            <UserPlus size={16} /> Inviter
          </button>
          <button className="gv-ghost clickable" onClick={copyLink}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Lien copié" : "Copier le lien"}
          </button>
          {room.isHost ? (
            <button className="geo-cta clickable" onClick={onStart} disabled={!canStart || busy}>
              {busy ? <Loader2 size={18} className="spin" /> : <Play size={18} />}
              {active.length < 2 ? "Il manque du monde" : "Lancer la partie"}
            </button>
          ) : (
            <button
              className={`geo-cta clickable ${me?.ready ? "off" : ""}`}
              onClick={onReady}
              disabled={busy}
            >
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
//  Le tableau final
// ============================================================
function Podium({ room, ranking, hueById, isHost, busy, onAgain }) {
  const rows = ranking || [];
  const champ = rows[0];
  return (
    <section className="geo-done gv-done">
      <div className="gv-podium-hero">
        <span className="gv-podium-crown">
          <Crown size={30} />
        </span>
        <h1>
          {champ?.user?.username || champ?.username} remporte le versus
        </h1>
        <p>
          {MODES[room.mode].label} · {room.roundCount} manches
        </p>
      </div>

      <ol className="gv-podium">
        {rows.map((r, i) => {
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
              <VersusFace user={u} size={42} hue={hueById.get(id)} />
              <span className="gv-podium-id">
                <b>{u.username}</b>
                <em>
                  <MapPin size={11} /> {r.correct ?? r.correctCount ?? 0}/{room.roundCount} trouvés
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
        {isHost && (
          <button className="geo-cta sm clickable" onClick={onAgain} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />} Rejouer
          </button>
        )}
        <Link to="/geo" className="geo-ghost clickable">
          <Globe2 size={16} /> GeoGamer
        </Link>
        <Link to="/arcade" className="geo-ghost clickable">
          Arcade
        </Link>
      </div>

      <p className="gv-done-note">
        <Timer size={12} /> Les points de chacun sont crédités à l'arcade — le vainqueur
        touche 20&nbsp;% de plus.
      </p>
    </section>
  );
}
