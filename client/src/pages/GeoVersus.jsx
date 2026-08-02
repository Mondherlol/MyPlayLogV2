import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Gamepad2,
  Globe2,
  Heart,
  Loader2,
  MapPin,
  Medal,
  Play,
  RotateCcw,
  Search,
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

  const inputRef = useRef(null);
  const suggestRef = useRef(null);
  const typingRef = useRef({ at: 0, timer: null });
  // Écart entre l'horloge du serveur et la nôtre. Sans lui, une machine en
  // avance de trente secondes jouerait une manche déjà finie.
  const offsetRef = useRef(0);
  const pinSentRef = useRef(false);

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

  // ---------- Le direct ----------
  useEffect(() => {
    if (!subscribe || !code) return undefined;
    return subscribe((event, data) => {
      if (event !== "geoversus" || data?.code !== code) return;

      // La plupart des évènements portent l'état complet du salon, vu par MOI
      // (les vies et les essais visibles diffèrent d'un joueur à l'autre).
      if (data.room) applyRoom(data.room);

      switch (data.kind) {
        case "cue":
          setPanoReady(false);
          setInput("");
          setHighlight(0);
          setFlash(null);
          setTypers({});
          pinSentRef.current = false;
          sfx.play("start");
          break;
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
  function pushTyping(text) {
    if (mode !== "buzzer" || phase !== "round") return;
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
            <PanoViewer key={round.image} src={round.image} interactive onReady={onPanoReady} />
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
                {panoReady ? "Prêt — tout le monde part ensemble" : "Chargement du lieu…"}
              </span>
            </div>
          )}

          {/* ---- Recherche ---- */}
          {phase === "round" && (
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
          {(phase === "map" || mapReveal) && round.map && (
            <div className="geo-map-dock">
              <MapRound
                map={round.map}
                gameName={round.gameName}
                sfx={sfx}
                reveal={mapReveal}
                deadline={room.phaseEndsAt - offsetRef.current}
                eligible={
                  mode === "buzzer"
                    ? true
                    : !!round.found?.some((f) => f.userId === meId)
                }
                waiting={round.pinned?.includes(meId)}
                hint={
                  mode === "buzzer"
                    ? "tout le monde joue · le plus proche rafle les points"
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
// yeux. La nouveauté, c'est la colonne de droite — qui a marqué quoi.
function Reveal({ round, players, mode, meId, hueById, secondsLeft, last, sided }) {
  const results = round.results || [];
  const mine = results.find((r) => r.userId === meId);
  const rows = players
    .filter((p) => !p.left)
    .map((p) => ({ p, r: results.find((x) => x.userId === p.id) }))
    .sort((a, b) => (b.r?.points || 0) + (b.r?.mapPoints || 0) - ((a.r?.points || 0) + (a.r?.mapPoints || 0)));

  return (
    // `sided` : la carte de la manche bonus occupe le coin droit, la
    // révélation se décale pour ne pas lui passer dessus.
    <div className={`geo-reveal gv-reveal ${mine?.correct ? "good" : "bad"} ${sided ? "sided" : ""}`}>
      <i className="geo-rv-bar" aria-hidden="true" />
      <span className="geo-rv-badge">
        {mine?.correct ? <Check size={19} /> : <X size={19} />}
      </span>
      {round.cover && (
        <img className="geo-rv-cover" src={round.cover} alt="" draggable="false" />
      )}
      <div className="geo-rv-txt">
        <span className="geo-rv-verdict">
          {mine?.correct ? "Trouvé" : "Raté"}
          <b className="up">
            +{(mine?.points || 0) + (mine?.mapPoints || 0)}
          </b>
        </span>
        <b className="geo-rv-name">{round.gameName}</b>
        {mode === "buzzer" && round.winner && (
          <em>
            <Zap size={11} /> buzz de{" "}
            {players.find((p) => p.id === round.winner)?.username || "?"}
          </em>
        )}
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
            <span className="gv-rv-pts">
              +{(r?.points || 0) + (r?.mapPoints || 0)}
            </span>
            <span className="gv-rv-total">{p.score}</span>
          </li>
        ))}
      </ul>

      <span className="geo-rv-next static">
        {last ? "Tableau final" : "Manche suivante"}
        <span>{Math.max(0, secondsLeft)}</span>
      </span>
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
              <VersusFace user={u} size={38} hue={hueById.get(id)} />
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
