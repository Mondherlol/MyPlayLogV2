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
import { usePlayer } from "../context/PlayerContext";
import { apiFetch, API_BASE } from "../lib/api";
import { useLiveStatus } from "../lib/presence";
import { dedupeCandidates, searchCandidates } from "../lib/guessGame";
import { useGameSfx } from "../lib/useGameSfx";
import { VersusFace, VersusRail, VersusInvite, HUES } from "../components/VersusRoom";

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
// LA GROSSE DIFFÉRENCE AVEC LE SOLO : pas de lecteur YouTube. Le solo charge la
// vidéo, ce qui lui donne son titre — donc la réponse. Ici l'extrait arrive de
// NOTRE serveur, en audio pur, sous une adresse qui ne dit rien.
//
// Et il est TÉLÉCHARGÉ EN ENTIER pendant le sas, pas lu en flux : c'est
// précisément ce qu'on veut d'un décompte de départ. Quand le « 1 » tombe, le
// fichier est déjà dans la mémoire du navigateur et tout le monde entend la
// première note au même instant — personne ne subit son propre tampon.
const LIVES = 3;
const HINT_FRACS = [0.35, 0.55, 0.75];
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
  const [clipReady, setClipReady] = useState(false);
  const [, setTick] = useState(0);

  const inputRef = useRef(null);
  const suggestRef = useRef(null);
  const offsetRef = useRef(0);
  const audioRef = useRef(null);
  const urlRef = useRef(null);
  const loadedForRef = useRef(-1);

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

  // ---------- L'extrait ----------
  // Téléchargé EN ENTIER pendant le sas (cf. l'en-tête). On passe par fetch et
  // non par `<audio src>` parce que l'adresse est protégée : une balise audio ne
  // sait pas poser d'en-tête Authorization.
  useEffect(() => {
    if (!round?.clip || phase === "lobby" || phase === "done") return undefined;
    if (loadedForRef.current === round.index) return undefined;
    loadedForRef.current = round.index;
    setClipReady(false);
    let dead = false;
    const ac = new AbortController();

    (async () => {
      try {
        const res = await fetch(`${API_BASE}${round.clip}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ac.signal,
        });
        if (!res.ok) throw new Error("clip indisponible");
        const blob = await res.blob();
        if (dead) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        const el = audioRef.current;
        if (!el) return;
        el.src = urlRef.current;
        el.load();
        setClipReady(true);
      } catch {
        // Sans extrait, la manche se joue en silence : frustrant mais pas
        // bloquant, et le serveur enchaîne de toute façon.
        if (!dead) setClipReady(false);
      }
    })();

    return () => {
      dead = true;
      ac.abort();
    };
  }, [round?.clip, round?.index, phase, token]);

  // Départ du son : à l'instant exact décidé par le serveur, on pose l'aiguille
  // sur le climax et on lance. Le son s'arrête à la fin de l'extrait — le temps
  // bonus se joue en silence, comme en solo.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || phase !== "round" || !clipReady || !round) return undefined;
    const dur = el.duration || 0;
    if (dur > 0) {
      const clip = round.durationSec || 15;
      const start = Math.min((round.startFrac || 0.4) * dur, Math.max(0, dur - clip - 1));
      try {
        el.currentTime = start;
        el.muted = muted;
        el.play().catch(() => {});
      } catch {
        /* ignore */
      }
      const stop = setTimeout(() => {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
      }, clip * 1000);
      return () => clearTimeout(stop);
    }
    return undefined;
  }, [phase, clipReady, round?.index, muted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Le son se coupe dès qu'on quitte la manche (révélation, sortie de page).
  useEffect(() => {
    if (phase === "round") return;
    try {
      audioRef.current?.pause();
    } catch {
      /* ignore */
    }
  }, [phase]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
    sfx.setMuted(muted);
  }, [muted, sfx]);

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
      loadedForRef.current = -1;
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
  const graceMs = round?.graceMs || 10000;
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
    return pool.slice(0, 3).map((p, i) => ({ ...p, atMs: HINT_FRACS[i] * clipMs }));
  }, [round, clipMs]);

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
      {/* Le lecteur : jamais visible, jamais nommé. */}
      <audio ref={audioRef} preload="auto" style={{ display: "none" }} />

      <header className="bt-topbar">
        <button className="bt-back clickable" onClick={quit}>
          <ArrowLeft size={17} /> <span>Quitter</span>
        </button>
        <div className="bt-brand">
          <Swords size={17} /> Blind Test — Buzzer
        </div>
        <button
          className="bt-vol-btn clickable"
          onClick={() => setMuted((m) => !m)}
          title={muted ? "Réactiver le son" : "Couper le son"}
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
                {clipReady
                  ? "Tout le monde part ensemble…"
                  : "On prépare l'extrait pour tout le monde…"}
              </p>
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
                    <span key={h.key} className={`bt-hint ${open ? "open" : ""}`}>
                      {open ? <h.Icon size={13} /> : <Lock size={12} />}
                      <span>{open ? h.text : h.label}</span>
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
