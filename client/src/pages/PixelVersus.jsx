import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Check,
  Cherry,
  Copy,
  Crown,
  Gamepad2,
  Grid2x2,
  Heart,
  Loader2,
  Lock,
  Medal,
  Play,
  RotateCcw,
  Search,
  Swords,
  Tag,
  Timer,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { apiFetch } from "../lib/api";
import { useLiveStatus } from "../lib/presence";
import { dedupeCandidates, searchCandidates } from "../lib/guessGame";
import { useGameSfx } from "../lib/useGameSfx";
import PixelCanvas from "../components/PixelCanvas";
import { VersusFace, VersusRail, VersusInvite, HUES } from "../components/VersusRoom";
import GameChat from "../components/GameChat";

// ======================================================================
//  Pixel Rush VERSUS — le buzzer visuel
// ======================================================================
// Le troisième salon du site (après GeoGamer et le blind test), et il en
// reprend délibérément toute la charpente : même machinerie de salon, même rail
// de joueurs, même « 3, 2, 1 », même BUZZER — le premier qui trouve arrête la
// manche, trois vies chacun. Ce qui se ressemble doit se ressembler : on ne
// réapprend pas à jouer en changeant de mini-jeu.
//
// ------------------------------------------------------------------ l'image
// LA DÉFINITION VIENT DE L'HORLOGE DU SERVEUR, pas d'un chrono local. En solo,
// les gros pixels fondent au rythme de la machine du joueur ; ici, le calcul
// part de `phaseStartsAt`, l'heure commune, pour qu'à un instant donné tout le
// monde regarde exactement la même image. Sans ça, un joueur dont l'onglet a
// été mis en veille une seconde jouerait une image plus floue que les autres —
// sur une course au buzzer, c'est décisif.
//
// La réponse, elle, ne descend jamais avant la révélation (voir roundView dans
// routes/pixelVersus.js) : on reçoit UNE URL de capture et rien d'autre.
//
// ------------------------------------------------------------------ les tomates
// Trois par joueur et par partie. On en jette une à un adversaire : son écran
// ENTIER est éclaboussé deux secondes — pas juste la capture, TOUT, y compris
// le rail, le chrono et sa propre liste de suggestions. C'est le principe : on
// lui prend la vue, pas la manche (le champ de réponse reste actif dessous, on
// peut valider à l'aveugle si on avait déjà l'idée).
//
// Le tir est PUBLIC (tout le monde voit qui vise qui) et on ne peut pas viser
// quelqu'un dont la manche est déjà finie. Le reste des garde-fous est côté
// serveur, c'est lui qui décompte les munitions.
//
// Deux façons de viser, et les deux comptent : le panier de têtes au-dessus du
// plateau (on le voit, donc on y pense) et le CLIC DROIT sur un joueur du rail
// (on vise celui qu'on regarde déjà taper — c'est le geste naturel quand on
// voit sa réponse se former).
const LIVES = 3;
// Quatre paliers d'indices, comme le blind test versus — le dernier étant « y
// ont joué », avec les têtes des joueurs de la table qui ont le jeu.
const HINT_FRACS = [0.2, 0.4, 0.6, 0.78];
// Bornes de la pixelisation, identiques au solo : on part de très gros blocs et
// on ne devient JAMAIS lisible. Ce qui fait avancer, c'est la loupe.
const PIX_START = 9;
const PIX_END = 24;
const TYPING_MS = 200;
const TYPING_TTL = 4000;

// La forme de l'éclaboussure, tirée à l'impact. Un PRNG maison plutôt que
// Math.random en vrac : à partir d'une graine (l'horodatage du tir), toute la
// tache est reproductible — utile pour la déboguer, et surtout ça garantit que
// deux tomates coup sur coup ne se superposent pas à l'identique.
//
// Le dessin lui-même est fait de disques parfaits ; c'est le filtre SVG de
// turbulence (voir plus bas) qui les tord et leur donne des bords déchiquetés.
// Beaucoup moins de code qu'un chemin dessiné à la main, et ça ne se répète
// jamais tout à fait.
function makeSplat(seed) {
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cx = 28 + rnd() * 44;
  const cy = 24 + rnd() * 34;
  // Le noyau, puis des satellites de plus en plus petits en s'éloignant.
  const blobs = [{ cx, cy, r: 25 + rnd() * 9 }];
  for (let i = 0; i < 18; i += 1) {
    const a = rnd() * Math.PI * 2;
    const d = 15 + rnd() * 46;
    blobs.push({
      cx: cx + Math.cos(a) * d,
      cy: cy + Math.sin(a) * d * 0.78,
      r: 2 + rnd() * (10 - Math.min(7, d / 9)),
    });
  }
  // Les coulures : elles partent du bas du noyau et descendent, chacune à son
  // rythme. C'est ce qui fait qu'on lit « ça dégouline » et pas « il y a une
  // tache rouge ».
  const drips = Array.from({ length: 6 }, () => ({
    x: cx - 22 + rnd() * 44,
    y: cy + 4 + rnd() * 18,
    w: 2.5 + rnd() * 4,
    h: 16 + rnd() * 40,
    delay: rnd() * 0.5,
  }));
  return { blobs, drips, rot: -14 + rnd() * 28 };
}

export default function PixelVersus() {
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
  const [input, setInput] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [flash, setFlash] = useState(null);
  const [missed, setMissed] = useState({});
  const [typers, setTypers] = useState({});
  const [ranking, setRanking] = useState(null);
  const [muted, setMuted] = useState(false);
  // L'éclaboussure que JE me prends : { kind, by, until }. Les tirs des autres
  // passent par `shots` (le bandeau « X a visé Y »).
  const [splat, setSplat] = useState(null);
  // Position du menu « jeter une tomate » : { x, y, player } ou null.
  const [aim, setAim] = useState(null);
  const [shots, setShots] = useState([]);
  const [, setTick] = useState(0);

  const inputRef = useRef(null);
  const suggestRef = useRef(null);
  const offsetRef = useRef(0);

  const meId = user?.id ? String(user.id) : "";
  const phase = room?.phase || "lobby";
  const round = room?.round || null;
  const players = useMemo(() => room?.players || [], [room]);
  const me = players.find((p) => p.isMe) || null;
  const hueById = useMemo(() => {
    const m = new Map();
    players.forEach((p, i) => m.set(p.id, HUES[i % HUES.length]));
    return m;
  }, [players]);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);
  const applyRoom = useCallback((r) => {
    if (!r) return;
    if (typeof r.now === "number") offsetRef.current = r.now - Date.now();
    setRoom(r);
  }, []);

  useEffect(() => {
    sfx.setMuted(muted);
  }, [muted, sfx]);

  // Le son ne peut naître que d'un geste (règle des navigateurs), et un invité
  // arrivé par un lien n'en fait parfois aucun : le salon le fait entrer, l'hôte
  // lance, et il joue toute la partie en silence. On s'accroche donc au PREMIER
  // geste venu, quel qu'il soit, puis on se retire.
  useEffect(() => {
    const wake = () => {
      sfx.resume();
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [sfx]);

  // ---------- Chargement ----------
  const load = useCallback(async () => {
    try {
      const d = await apiFetch(`/pixel/versus/${code}`, { token });
      applyRoom(d.room);
      if (d.candidates) setCandidates(d.candidates);
      setErr("");
      if (!d.member && d.room && !d.room.started && !d.room.endedAt) {
        const j = await apiFetch(`/pixel/versus/${code}/join`, { method: "POST", token });
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

  // La liste de recherche des INVITÉS : elle ne voyage que dans la réponse à
  // /start, que seul l'hôte reçoit (même défaut corrigé qu'à GeoGamer et au
  // blind test). Sans ce rattrapage, les invités partent sans suggestions.
  useEffect(() => {
    if (!token || !code) return undefined;
    if (!room?.started || phase === "done" || candidates.length) return undefined;
    let alive = true;
    apiFetch(`/pixel/versus/${code}`, { token })
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
      if (event !== "pxversus" || data?.code !== code) return;
      if (data.room) applyRoom(data.room);

      switch (data.kind) {
        case "cue":
          setInput("");
          setHighlight(0);
          setFlash(null);
          setTypers({});
          setSplat(null);
          setShots([]);
          sfx.play("start");
          break;
        case "typing":
          setTypers((t) => ({ ...t, [data.by]: { text: data.text, at: Date.now() } }));
          break;
        case "go":
          setTimeout(() => inputRef.current?.focus(), 60);
          break;
        case "splat": {
          const ms = data.ms || 2200;
          // Le souffle du lancer pour tout le monde ; l'impact seulement pour
          // celui qui le prend — sinon cinq personnes entendent un « splotch »
          // sans rien voir et ne comprennent pas ce qui se passe.
          sfx.play("throw");
          if (data.target === meId) {
            setSplat({
              kind: data.splat,
              by: data.by,
              until: Date.now() + ms,
              ms,
              shape: makeSplat(Date.now()),
            });
            setTimeout(() => sfx.play("splat"), 130);
          }
          setShots((s) => [...s.slice(-2), { ...data, at: Date.now() }]);
          // Le stock de chacun bouge : les boutons se grisent chez tout le monde.
          setRoom((r) =>
            r && data.ammoById
              ? {
                  ...r,
                  players: r.players.map((p) =>
                    data.ammoById[p.id] != null ? { ...p, ammo: data.ammoById[p.id] } : p
                  ),
                }
              : r
          );
          break;
        }
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
          setTypers((t) => {
            const n = { ...t };
            delete n[data.by];
            return n;
          });
          break;
        }
        case "reveal":
          setSplat(null);
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

  // Battement pour les chronos, la définition et l'éclaboussure.
  useEffect(() => {
    if (phase === "lobby" || phase === "done") return undefined;
    const iv = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(iv);
  }, [phase]);

  // L'éclaboussure s'efface d'elle-même. Un `setTimeout` plutôt que le seul
  // battement : elle doit disparaître à la milliseconde près même si la manche
  // se termine entre-temps.
  useEffect(() => {
    if (!splat) return undefined;
    const t = setTimeout(() => setSplat(null), Math.max(0, splat.until - Date.now()));
    return () => clearTimeout(t);
  }, [splat]);

  useEffect(() => {
    document.body.classList.add("bt-immersive");
    return () => document.body.classList.remove("bt-immersive");
  }, []);

  useLiveStatus(
    "pixel",
    room?.started && phase !== "done"
      ? `versus · manche ${(room.index || 0) + 1}/${room.roundCount}`
      : "",
    { token }
  );

  // Le menu de visée se referme au moindre geste ailleurs — c'est un menu
  // contextuel, il ne doit jamais rester collé à l'écran.
  useEffect(() => {
    if (!aim) return undefined;
    const close = () => setAim(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", close);
    };
  }, [aim]);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 1700);
    return () => clearTimeout(t);
  }, [flash]);

  // Les bandeaux de tir et les indicateurs de frappe s'éteignent seuls.
  useEffect(() => {
    if (!shots.length) return undefined;
    const t = setTimeout(() => setShots((s) => s.filter((x) => Date.now() - x.at < 2600)), 700);
    return () => clearTimeout(t);
  }, [shots]);

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

  // ---------- Actions ----------
  const post = (path, body) =>
    apiFetch(`/pixel/versus/${code}${path}`, { method: "POST", token, body });

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

  async function act(fn) {
    if (busy) return;
    // DANS le geste : sans ça, seul l'hôte (qui passe par /start) a du son —
    // les invités ne touchent jamais à un bouton qui réveille l'AudioContext,
    // et jouent toute la partie en silence.
    sfx.resume();
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const toggleReady = () =>
    act(async () => applyRoom((await post("/ready", { ready: !me?.ready })).room));
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
    navigate("/pixel");
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

  // Jeter une tomate. On ne bloque pas l'interface : le serveur diffuse et c'est
  // sa diffusion qui met à jour le stock, y compris le nôtre.
  const [throwing, setThrowing] = useState(false);
  async function throwSplat(targetId) {
    setAim(null);
    if (throwing || (me?.ammo ?? 0) <= 0) return;
    sfx.resume();
    setThrowing(true);
    try {
      await post("/splat", { target: targetId, kind: "tomato" });
    } catch (e) {
      if (e.status !== 429 && e.status !== 409) setErr(e.message);
    } finally {
      setTimeout(() => setThrowing(false), 400);
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

  // ---------- Chronos et définition ----------
  const now = serverNow();
  const msLeft = room?.phaseEndsAt ? Math.max(0, room.phaseEndsAt - now) : 0;
  const cueLeft = room?.phaseStartsAt ? Math.ceil((room.phaseStartsAt - now) / 1000) : 0;
  const roundMs = (round?.durationSec || 30) * 1000;
  const elapsedMs = Math.max(0, Math.min(roundMs, roundMs - msLeft));
  const frac = msLeft / roundMs;
  const secondsLeft = Math.ceil(msLeft / 1000);
  // Le palier de pixelisation, arrondi : le canvas ne se redessine qu'aux
  // changements réels et pas dix fois par seconde.
  const progress = phase === "cue" ? 0 : Math.min(1, elapsedMs / roundMs);
  const blocks = Math.round(PIX_START + (PIX_END - PIX_START) * progress);

  // Indices progressifs, synchrones pour toute la table.
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
    return pool.slice(0, 4).map((p, i) => ({ ...p, atMs: HINT_FRACS[i] * roundMs }));
  }, [round, roundMs, players]);

  // Qui peut encore se prendre une tomate : les joueurs toujours en course.
  const targets = players.filter(
    (p) => !p.left && !p.isMe && !round?.out?.includes(p.id) &&
      !round?.found?.some((f) => f.userId === p.id)
  );

  // ---------- Écrans ----------
  if (loading)
    return (
      <div className="bt-page px-page">
        <div className="bt-loading">
          <Loader2 size={34} className="spin" />
          <p>On ouvre le salon…</p>
        </div>
      </div>
    );

  if (err && !room)
    return (
      <div className="bt-page px-page">
        <div className="bt-loading bt-err">
          <p>{err}</p>
          <div className="bt-err-actions">
            <Link to="/pixel" className="bt-start sm clickable">
              <Grid2x2 size={16} /> Pixel Rush
            </Link>
            <Link to="/arcade" className="bt-ghost clickable">
              Arcade
            </Link>
          </div>
        </div>
      </div>
    );

  return (
    <div className="bt-page px-page gv">
      <div className="px-scene" aria-hidden="true">
        <span className="px-beam l" />
        <span className="px-beam r" />
        <span className="px-floor" />
        <span className="px-crowd" />
        <span className="px-sparks" />
      </div>

      <header className="bt-topbar">
        <button className="bt-back clickable" onClick={quit}>
          <ArrowLeft size={17} /> <span>Quitter</span>
        </button>
        <div className="bt-brand">
          <Swords size={17} /> Pixel Rush — Buzzer
        </div>
        <button
          className="bt-vol-btn clickable"
          onClick={() => setMuted((m) => !m)}
          title={muted ? "Réactiver les sons" : "Couper les sons"}
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
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
          <div className="bt-play px-play gv-play">
            <div className="bt-play-head">
              <span className="bt-round-count">
                Manche <b>{(room.index || 0) + 1}</b>
                <em>/ {room.roundCount}</em>
              </span>
              <span className="bt-live-score">
                <Timer size={14} /> {me?.score || 0} pts
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
              row
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
              // Clic droit sur un adversaire = on le met en joue. C'est le
              // geste naturel quand on le voit taper la bonne réponse.
              onPlayerContext={
                phase === "round"
                  ? (e, p) => {
                      if (p.isMe || !targets.some((t) => t.id === p.id)) return;
                      setAim({ x: e.clientX, y: e.clientY, player: p });
                    }
                  : null
              }
            />

            {/* Le panier, JUSTE SOUS LE RAIL et au-dessus du plateau : c'est là
                qu'on regarde les autres jouer, donc là qu'on pense à viser. En
                bas de page, sous le champ de réponse, personne ne le voyait. */}
            {phase === "round" && targets.length > 0 && (
              <div className="px-ammo">
                <span className="px-ammo-lbl">
                  <Cherry size={14} />
                  {(me?.ammo ?? 0) > 0 ? (
                    <>
                      <b>{me.ammo}</b> tomate{me.ammo > 1 ? "s" : ""}
                    </>
                  ) : (
                    "Panier vide"
                  )}
                </span>
                <div className="px-ammo-targets">
                  {targets.map((p) => (
                    <button
                      key={p.id}
                      className="px-throw clickable"
                      style={{ "--hue": hueById.get(p.id) }}
                      disabled={(me?.ammo ?? 0) <= 0 || throwing}
                      onClick={() => throwSplat(p.id)}
                      title={`Jeter une tomate sur ${p.username}`}
                    >
                      <VersusFace user={p} size={22} hue={hueById.get(p.id)} />
                      <span>{p.username}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ---- L'écran : LA capture, pixelisée ---- */}
            <div
              className={`px-stage ${secondsLeft <= 5 && phase === "round" ? "hot" : ""} ${
                splat ? "splatted" : ""
              }`}
            >
              <div className="px-grid n-1">
                {/* `key` sur l'URL : la carte est redistribuée à chaque manche. */}
                <div className="px-tile solo" key={round.shot || round.index}>
                  {round.shot ? (
                    <PixelCanvas
                      src={round.shot}
                      blocks={phase === "reveal" ? PIX_END : blocks}
                      reveal={phase === "reveal"}
                      clear={round.clearCorner}
                      // Pas de loupe pendant le sas ni à la révélation : avant
                      // le « go » ce serait de l'avance sur les autres, après
                      // l'image est nette et la loupe n'a plus d'objet.
                      loupe={phase === "round" && !splat}
                      label="Capture pixelisée"
                    />
                  ) : (
                    <span className="px-canvas-loading">
                      <Loader2 size={26} className="spin" />
                    </span>
                  )}
                </div>
              </div>

              <span className={`px-timer ${secondsLeft <= 5 ? "hot" : ""}`}>
                <Timer size={13} /> {phase === "cue" ? Math.max(0, cueLeft) : secondsLeft}s
              </span>
              <span className="px-def" title="Définition actuelle de la capture">
                {blocks}px
              </span>
              <i
                className="px-progress"
                style={{ transform: `scaleX(${1 - Math.min(1, Math.max(0, frac))})` }}
              />

              {phase === "cue" && (
                <span className="px-cue" aria-hidden="true">
                  <b>{Math.max(0, cueLeft)}</b>
                  <em>Tout le monde part ensemble…</em>
                </span>
              )}

            </div>

            {/* Les tirs des autres, en bandeau : le tir est public, c'est la
                moitié du plaisir et ça évite la tomate anonyme. */}
            {shots.length > 0 && (
              <div className="px-shots">
                {shots.map((s) => (
                  <span key={`${s.by}-${s.at}`} className="px-shot-line">
                    <Cherry size={12} />
                    <b>{players.find((p) => p.id === s.by)?.username || "?"}</b> vise{" "}
                    <b>{players.find((p) => p.id === s.target)?.username || "?"}</b>
                  </span>
                ))}
              </div>
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

      {/* Le menu de visée du clic droit. En portail : le rail est dans un
          conteneur qui défile et qui peut porter un `transform`, un menu
          positionné en `fixed` à l'intérieur s'y retrouverait ancré au mauvais
          endroit. */}
      {aim &&
        createPortal(
          <div
            className="px-aim"
            style={{ left: aim.x, top: aim.y }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="px-aim-who">
              <VersusFace user={aim.player} size={20} hue={hueById.get(aim.player.id)} />
              {aim.player.username}
            </span>
            <button
              className="px-aim-go clickable"
              disabled={(me?.ammo ?? 0) <= 0 || throwing}
              onClick={() => throwSplat(aim.player.id)}
            >
              <Cherry size={14} />
              {(me?.ammo ?? 0) > 0 ? "Jeter une tomate" : "Panier vide"}
              {(me?.ammo ?? 0) > 0 && <em>{me.ammo} restante{me.ammo > 1 ? "s" : ""}</em>}
            </button>
          </div>,
          document.body
        )}

      {/* L'ÉCLABOUSSURE, PAR-DESSUS TOUT L'ÉCRAN. En portail sur le body, et
          c'est nécessaire : le plateau tremble à l'impact (`transform`), ce qui
          en ferait un bloc de référence pour tout `position: fixed` à
          l'intérieur — la tache se serait retrouvée enfermée dans le cadre de
          l'image, ce qu'on cherchait justement à quitter. */}
      {splat && createPortal(<Splat splat={splat} players={players} />, document.body)}

      {showInvite && room && (
        <VersusInvite
          token={token}
          meId={meId}
          room={room}
          endpoint={`/pixel/versus/${room.code}/invite`}
          title="Inviter à Pixel Rush"
          onClose={() => setShowInvite(false)}
        />
      )}

      {/* Le chat du salon : réservé à ceux qui jouent (un curieux muni du lien
          n'a rien à souffler à la table). */}
      {room && me && (
        <GameChat
          token={token}
          code={code}
          event="pxversus"
          endpoint="/pixel/versus"
          players={players}
          meId={meId}
        />
      )}
    </div>
  );
}

// ============================================================
//  L'éclaboussure
// ============================================================
// Des disques parfaits, tordus par un filtre SVG de turbulence : c'est ce
// `feDisplacementMap` qui fait toute la crédibilité de la tache — sans lui on
// a des ronds rouges, avec lui on a des bords déchiquetés et des bavures. Le
// SVG s'étire sur tout le viewport (`preserveAspectRatio="none"`), donc les
// coordonnées du dessin sont en pourcentages de l'écran.
// Pulpe : clair au centre du lobe, sombre sur les bords. Les couleurs sont en
// dur ici et pas en variables CSS — le dégradé vit dans un <stop>, et `var()`
// dans un attribut de présentation SVG n'est pas également compris partout.
const PULP = {
  tomato: ["#f0453a", "#8e120e"],
  ink: ["#3a4260", "#080a12"],
};

function Splat({ splat, players }) {
  const { blobs, drips, rot } = splat.shape;
  const [c1, c2] = PULP[splat.kind] || PULP.tomato;
  const who = players.find((p) => p.id === splat.by)?.username || "Quelqu'un";
  return (
    <div
      className={`px-splat ${splat.kind}`}
      style={{ "--dur": `${splat.ms}ms` }}
      aria-hidden="true"
    >
      <svg
        className="px-splat-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        focusable="false"
      >
        <defs>
          <filter id="px-goo" x="-30%" y="-30%" width="160%" height="160%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.022 0.035"
              numOctaves="3"
              seed="9"
              result="n"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="n"
              scale="10"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          <radialGradient id="px-pulp" cx="38%" cy="34%">
            <stop offset="0%" stopColor={c1} />
            <stop offset="100%" stopColor={c2} />
          </radialGradient>
        </defs>
        <g filter="url(#px-goo)" fill="url(#px-pulp)" transform={`rotate(${rot} 50 45)`}>
          {blobs.map((b, i) => (
            <circle key={`b${i}`} cx={b.cx} cy={b.cy} r={b.r} />
          ))}
          {drips.map((d, i) => (
            <rect
              key={`d${i}`}
              className="px-drip"
              x={d.x}
              y={d.y}
              width={d.w}
              height={d.h}
              rx={d.w / 2}
              style={{ animationDelay: `${d.delay}s`, transformOrigin: `${d.x}px ${d.y}px` }}
            />
          ))}
        </g>
      </svg>
      <span className="px-splat-say">
        <Cherry size={17} />
        {who} t'a mis une tomate !
      </span>
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
    const url = `${window.location.origin}/pixel/versus/${room.code}`;
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
      <span className="gv-lobby-bg px" aria-hidden="true" />
      <div className="gv-lobby-in">
        <header className="gv-lobby-head">
          <span className="gv-lobby-kicker">
            <Grid2x2 size={13} /> Pixel Rush · buzzer
          </span>
          <h1 className="gv-lobby-title">Salon {room.code.toUpperCase()}</h1>
          <p className="gv-lobby-sub">
            La même capture pour tout le monde, en même temps. Le premier qui trouve
            arrête la manche — trois vies chacun, et trois tomates à jeter à la figure
            des autres.
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
        <p>Pixel Rush buzzer · {room.roundCount} manches</p>
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
                  <Grid2x2 size={11} /> {r.correct ?? r.correctCount ?? 0}/{room.roundCount}{" "}
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
        <Link to="/pixel" className="bt-ghost clickable">
          <Grid2x2 size={16} /> Pixel Rush
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
