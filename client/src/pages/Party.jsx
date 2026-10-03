import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Bot,
  Check,
  Coins,
  Crown,
  Dices,
  Flag,
  Link2,
  Loader2,
  MessageCircle,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trophy,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { apiFetch } from "../lib/api";
import { useLiveStatus } from "../lib/presence";
import GameChat from "../components/GameChat";
import Burst from "../components/Burst";
import DuelFriends from "../components/cards/battle/DuelFriends";
import {
  isSfxMuted,
  setSfxMuted,
  primeBombSounds,
  playBattleSlam,
  playBattleChip,
  playBattlePoint,
  playBombMiss,
  playBombTurn,
  playBombWin,
  playBombLose,
  playBombCount,
} from "../lib/sfx";

// ======================================================================
//  La Party — un jeu de plateau à la Mario Party
// ======================================================================
// Règles et serveur : server/src/routes/party.js ; plateau et mini-jeux :
// server/src/lib/partyGames.js. Le serveur décide de tout (le dé, les cases,
// les réponses) ; cette page ANIME ce qu'on lui annonce : le dé qui roule,
// le pion qui saute de case en case, les pièces qui tombent, le Trophée.
//
// Même idiome que les combats de cartes et La Bombe : fond #0d0d10, plaques
// sombres à bord or, Lilita en capitales, une barre du haut réduite.
const STEP_MS = 330; // un saut de case (le même que le serveur)
const SPACE_ICON = { start: Flag };
const SPACE_LABEL = { blue: "+3", red: "−3", chance: "?", start: "" };

export default function Party() {
  const { code } = useParams();
  return code ? <PartyRoom key={code} code={code} /> : <PartyOpen />;
}

function useBodyClass() {
  useEffect(() => {
    document.body.classList.add("bt-immersive", "pty-on");
    return () => document.body.classList.remove("bt-immersive", "pty-on");
  }, []);
}

// /party : on ouvre une partie tout de suite (une seule fois, même quand
// React monte la page deux fois).
let opening = null;
function PartyOpen() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [err, setErr] = useState("");
  useBodyClass();
  const open = useCallback(() => {
    setErr("");
    if (!opening)
      opening = apiFetch("/party", { method: "POST", token }).finally(() => {
        setTimeout(() => {
          opening = null;
        }, 1000);
      });
    opening
      .then((d) => navigate(`/party/${d.room.code}`, { replace: true }))
      .catch((e) => setErr(e.message || "Impossible d'ouvrir une partie."));
  }, [token, navigate]);
  useEffect(() => {
    if (token) open();
  }, [token, open]);
  return (
    <div className="pty pty-wait">
      {err ? (
        <>
          <p className="pty-err">{err}</p>
          <button className="pty-big gold clickable" onClick={open}>
            Réessayer
          </button>
        </>
      ) : (
        <Loader2 size={28} className="spin" />
      )}
    </div>
  );
}

function PartyRoom({ code }) {
  const { token, user } = useAuth();
  const { subscribe } = useChat();
  const navigate = useNavigate();
  useBodyClass();

  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(isSfxMuted);
  const [picking, setPicking] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1100px)").matches);
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [pawns, setPawns] = useState({}); // seatId → case affichée
  const [hopping, setHopping] = useState(null); // seatId qui saute
  const [rolling, setRolling] = useState(false);
  const [dieFace, setDieFace] = useState(null);
  const [fx, setFx] = useState(null); // { kind, seatId, text, key }
  const [answer, setAnswer] = useState("");
  const [, setTick] = useState(0);

  const offsetRef = useRef(0);
  const animRef = useRef(false);
  const chatOpenRef = useRef(false);
  chatOpenRef.current = chatOpen;
  const meId = user?.id ? String(user.id) : "";

  const applyRoom = useCallback((r) => {
    if (!r) return;
    if (typeof r.now === "number") offsetRef.current = r.now - Date.now();
    setRoom(r);
    // Les pions suivent la vérité du serveur, sauf pendant une animation.
    if (!animRef.current) setPawns(Object.fromEntries((r.seats || []).map((s) => [s.id, s.pos])));
  }, []);
  const post = useCallback(
    (path, body) => apiFetch(`/party/${code}${path}`, { method: "POST", token, body }),
    [code, token]
  );
  const serverNow = () => Date.now() + offsetRef.current;

  useEffect(() => {
    primeBombSounds();
    const mq = window.matchMedia("(min-width: 1100px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    (async () => {
      try {
        const d = await apiFetch(`/party/${code}`, { token });
        if (!alive) return;
        applyRoom(d.room);
        if (!d.member) {
          const j = await apiFetch(`/party/${code}/join`, { method: "POST", token });
          if (alive) applyRoom(j.room);
        }
      } catch (e) {
        if (alive) setErr(e.message || "Partie introuvable.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, token, applyRoom]);

  // ---------- Le pion qui saute de case en case ----------
  const hop = useCallback((seatId, path) => {
    animRef.current = true;
    setHopping(seatId);
    path.forEach((pos, k) => {
      setTimeout(() => {
        setPawns((p) => ({ ...p, [seatId]: pos }));
        playBattleSlam(true);
        if (k === path.length - 1) {
          setTimeout(() => {
            animRef.current = false;
            setHopping(null);
          }, 120);
        }
      }, k * STEP_MS);
    });
  }, []);

  // ---------- Le direct ----------
  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((event, data) => {
      if (event !== "party" || data?.code !== code) return;
      if (data.kind === "chat" && !chatOpenRef.current && !data.message?.system && data.message?.authorId !== meId)
        setUnread((n) => n + 1);
      if (data.room) applyRoom(data.room);
      switch (data.kind) {
        case "turn":
          setDieFace(null);
          setRolling(data.room?.turnSeat === meId ? false : true);
          if (data.room?.turnSeat === meId) playBombTurn();
          break;
        case "roll":
          setRolling(false);
          setDieFace(data.value);
          playBattleSlam();
          break;
        case "move":
          hop(data.seatId, data.path || []);
          break;
        case "landed": {
          const l = data.landing;
          setFx({ kind: l.space, seatId: l.seatId, text: l.text, key: Date.now() });
          if (l.coins > 0) playBattleChip();
          else if (l.coins < 0) playBombMiss();
          else playBattlePoint(true);
          break;
        }
        case "trophy":
          setFx({ kind: "trophy", seatId: data.seatId, key: Date.now() });
          playBombWin();
          break;
        case "mini-intro":
          setAnswer("");
          playBombCount();
          break;
        case "mini":
          setAnswer("");
          break;
        case "mini-found":
          playBattlePoint(true);
          break;
        case "mini-miss":
          if (data.seatId === meId) playBombMiss();
          break;
        case "mini-result":
          playBattleChip();
          break;
        case "done": {
          const win = (data.ranking || [])[0];
          if (win?.id === meId) playBombWin();
          else playBombLose();
          break;
        }
        default:
          break;
      }
    });
  }, [subscribe, code, applyRoom, meId, hop]);

  useEffect(() => {
    if (!fx) return undefined;
    const t = setTimeout(() => setFx(null), 1900);
    return () => clearTimeout(t);
  }, [fx]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const phase = room?.phase || "lobby";
  const seats = useMemo(() => room?.seats || [], [room]);
  const me = seats.find((s) => s.isMe) || null;
  const turnSeat = seats.find((s) => s.id === room?.turnSeat) || null;
  const myTurn = !!turnSeat && turnSeat.id === meId;
  const inMini = phase.startsWith("mini");
  const playing = phase !== "lobby" && phase !== "done";

  // Le dé qui roule (les faces défilent) tant que le joueur n'a pas tapé.
  useEffect(() => {
    if (phase !== "roll") return undefined;
    const iv = setInterval(() => setDieFace(1 + Math.floor(Math.random() * 10)), 70);
    return () => clearInterval(iv);
  }, [phase]);
  useEffect(() => {
    if (!inMini && phase !== "buy") return undefined;
    const iv = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(iv);
  }, [inMini, phase]);

  useLiveStatus("party", playing ? `manche ${room?.round || 1}/${room?.settings?.turns || 10}` : "", { token });

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
  const roll = () =>
    act(async () => {
      setRolling(true);
      await post("/roll");
    });
  const buy = (yes) => act(() => post("/buy", { buy: yes }));
  async function sendAnswer(e) {
    e?.preventDefault();
    const text = answer.trim();
    if (!text) return;
    try {
      if (room.mini?.kind === "price") {
        await post("/mini", { value: Number(text.replace(",", ".")) });
      } else {
        const d = await post("/mini", { text });
        if (!d.ok) setErr("");
      }
      setAnswer("");
    } catch (e2) {
      setErr(e2.message);
    }
  }
  async function quit() {
    try {
      await post("/leave");
    } catch {
      /* on part quand même */
    }
    navigate("/arcade");
  }
  function copyLink() {
    navigator.clipboard?.writeText(`${window.location.origin}/party/${code}`).then(() => setToast("Lien copié"));
  }
  async function invite(f) {
    const d = await post("/challenge", { userId: f.id });
    setPicking(false);
    setToast(d.online ? `Invitation envoyée à ${f.username}` : `${f.username} la trouvera dans ses messages`);
  }

  if (loading)
    return (
      <div className="pty pty-wait">
        <Loader2 size={28} className="spin" />
      </div>
    );
  if (!room)
    return (
      <div className="pty pty-wait">
        <p className="pty-err">{err || "Cette partie n'existe plus."}</p>
        <button className="pty-big gold clickable" onClick={() => navigate("/party")}>
          Ouvrir une partie
        </button>
      </div>
    );

  const showChat = wide && chatOpen;
  return (
    <div className={`pty ${showChat ? "chat-open" : ""} phase-${phase}`}>
      <div className="pty-main">
        <header className="pty-hud">
          <button className="pty-icon clickable" onClick={quit} aria-label="Quitter la partie">
            <X />
          </button>
          {playing && (
            <span className="pty-round">
              Manche <b>{room.round}</b> / {room.settings.turns}
            </span>
          )}
          <span className="pty-hud-right">
            {wide && (
              <button
                className={`pty-icon clickable ${chatOpen ? "on" : ""}`}
                onClick={() => {
                  setChatOpen((v) => !v);
                  setUnread(0);
                }}
                aria-label={chatOpen ? "Fermer le chat" : "Ouvrir le chat"}
              >
                <MessageCircle />
                {!chatOpen && unread > 0 && <em className="pty-badge">{unread > 9 ? "9+" : unread}</em>}
              </button>
            )}
            <button
              className="pty-icon clickable"
              onClick={() => {
                setSfxMuted(!muted);
                setMuted(!muted);
              }}
              aria-label={muted ? "Activer le son" : "Couper le son"}
            >
              {muted ? <VolumeX /> : <Volume2 />}
            </button>
          </span>
        </header>

        {phase === "lobby" ? (
          <Lobby
            room={room}
            busy={busy}
            isAdmin={!!user?.isAdmin}
            onTurns={(n) => act(async () => applyRoom((await post("/settings", { turns: n })).room))}
            onAddBot={() => act(async () => applyRoom((await post("/bot", {})).room))}
            onKick={(id) => act(async () => applyRoom((await post("/bot", { remove: id })).room))}
            onStart={() =>
              act(async () => {
                primeBombSounds();
                applyRoom((await post("/start")).room);
              })
            }
            onInvite={() => setPicking(true)}
            onLink={copyLink}
          />
        ) : (
          <>
            <Players seats={seats} turnSeat={room.turnSeat} />
            <section className="pty-stage">
              <Board room={room} pawns={pawns} hopping={hopping} fx={fx}>
                <Center
                  room={room}
                  phase={phase}
                  myTurn={myTurn}
                  turnSeat={turnSeat}
                  dieFace={dieFace}
                  rolling={rolling}
                  busy={busy}
                  me={me}
                  onRoll={roll}
                  onBuy={buy}
                  serverNow={serverNow}
                />
              </Board>
            </section>
          </>
        )}

        {inMini && room.mini && (
          <MiniGame
            room={room}
            meId={meId}
            serverNow={serverNow}
            answer={answer}
            setAnswer={setAnswer}
            onSubmit={sendAnswer}
          />
        )}

        {phase === "done" && (
          <Results
            ranking={room.ranking || []}
            meId={meId}
            isHost={room.isHost}
            busy={busy}
            onAgain={() => act(async () => applyRoom((await post("/again")).room))}
            onQuit={quit}
          />
        )}

        {(toast || err) && (
          <button
            className={`pty-toast ${err ? "bad" : ""} clickable`}
            onClick={() => {
              setErr("");
              setToast("");
            }}
          >
            {err || toast}
          </button>
        )}
      </div>

      {showChat ? (
        <aside className="pty-chat">
          <GameChat
            token={token}
            code={code}
            event="party"
            endpoint="/party"
            players={seats.filter((s) => !s.bot)}
            meId={meId}
            docked
            onClose={() => setChatOpen(false)}
          />
        </aside>
      ) : (
        !wide && (
          <GameChat token={token} code={code} event="party" endpoint="/party" players={seats.filter((s) => !s.bot)} meId={meId} />
        )
      )}

      {picking && (
        <DuelFriends
          token={token}
          endpoint="/party/friends"
          title="Inviter un pote"
          action="Inviter"
          onPick={invite}
          onLink={async () => {
            copyLink();
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
//  Les joueurs : pièces et Trophées, celui qui joue en avant
// ----------------------------------------------------------------------
function Face({ seat, size = 40 }) {
  return (
    <span className="pty-face" style={{ "--c": seat.color, width: size, height: size }}>
      {seat.avatar ? (
        <img src={seat.avatar} alt="" draggable="false" />
      ) : (
        <i>{seat.bot ? <Bot size={size * 0.5} /> : (seat.username || "?")[0].toUpperCase()}</i>
      )}
    </span>
  );
}

function Players({ seats, turnSeat }) {
  return (
    <div className="pty-players">
      {seats.map((s) => (
        <div key={s.id} className={`pty-player ${s.id === turnSeat ? "turn" : ""} ${s.left ? "left" : ""}`} style={{ "--c": s.color }}>
          <Face seat={s} size={42} />
          <span className="pty-player-txt">
            <b>{s.username}</b>
            <span className="pty-player-stats">
              <span className="pty-stat tro" key={`t${s.trophies}`}>
                <Trophy size={14} /> {s.trophies}
              </span>
              <span className="pty-stat coin" key={`c${s.coins}`}>
                <Coins size={14} /> {s.coins}
              </span>
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------
//  Le plateau
// ----------------------------------------------------------------------
function Board({ room, pawns, hopping, fx, children }) {
  const { w, h, spaces } = room.board;
  const pct = (s) => ({ left: `${(s.x / w) * 100}%`, top: `${(s.y / h) * 100}%` });
  const seats = room.seats.filter((s) => !s.left);
  // Plusieurs pions sur la même case : on les écarte un peu.
  const byPos = {};
  for (const s of seats) {
    const p = pawns[s.id] ?? s.pos;
    (byPos[p] = byPos[p] || []).push(s.id);
  }
  const points = spaces.map((s) => `${s.x},${s.y}`).join(" ");
  const trophy = spaces[room.trophyAt];
  return (
    <div className="pty-board" style={{ aspectRatio: `${w} / ${h}` }}>
      <svg className="pty-path" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <polygon points={points} />
      </svg>
      {spaces.map((s) => {
        const Icon = SPACE_ICON[s.type];
        return (
          <span key={s.i} className={`pty-space ${s.type}`} style={pct(s)}>
            {Icon ? <Icon size={14} /> : SPACE_LABEL[s.type]}
          </span>
        );
      })}
      {trophy && (
        <span className="pty-trophy" style={pct(trophy)} key={`tr${room.trophyAt}`}>
          <Trophy size={20} />
        </span>
      )}
      {seats.map((s) => {
        const p = pawns[s.id] ?? s.pos;
        const sp = spaces[p];
        if (!sp) return null;
        const group = byPos[p] || [s.id];
        const k = group.indexOf(s.id);
        const dx = (k - (group.length - 1) / 2) * 3.2;
        return (
          <span
            key={s.id}
            className={`pty-pawn ${hopping === s.id ? "hop" : ""} ${room.turnSeat === s.id ? "turn" : ""}`}
            style={{ left: `calc(${(sp.x / w) * 100}% + ${dx}%)`, top: `${(sp.y / h) * 100}%`, "--c": s.color }}
          >
            <span className="pty-pawn-in" key={hopping === s.id ? `h${p}` : "still"}>
              <Face seat={s} size={34} />
            </span>
            {fx && fx.seatId === s.id && (
              <span className={`pty-fx ${fx.kind}`} key={fx.key}>
                {fx.kind === "trophy" ? (
                  <>
                    <Trophy size={16} /> Trophée !
                  </>
                ) : (
                  fx.text
                )}
              </span>
            )}
          </span>
        );
      })}
      <div className="pty-center">{children}</div>
    </div>
  );
}

// ----------------------------------------------------------------------
//  Le centre du plateau : le dé, le Trophée à acheter, la case d'arrivée
// ----------------------------------------------------------------------
function Center({ room, phase, myTurn, turnSeat, dieFace, rolling, busy, me, onRoll, onBuy, serverNow }) {
  const name = turnSeat?.username || "…";
  if (phase === "buy") {
    const left = Math.max(0, Math.ceil((room.phaseEndsAt - serverNow()) / 1000));
    return (
      <div className="pty-panel buy">
        <span className="pty-panel-ico gold">
          <Trophy size={30} />
        </span>
        <b className="pty-panel-title">Le Trophée !</b>
        {myTurn ? (
          <>
            <p className="pty-panel-sub">
              {room.trophyPrice} pièces — il t'en reste {me?.coins ?? 0}
            </p>
            <div className="pty-panel-go">
              <button className="pty-big gold clickable" onClick={() => onBuy(true)} disabled={busy}>
                Acheter
              </button>
              <button className="pty-line clickable" onClick={() => onBuy(false)} disabled={busy}>
                Passer ({left})
              </button>
            </div>
          </>
        ) : (
          <p className="pty-panel-sub">{name} hésite…</p>
        )}
      </div>
    );
  }
  if (phase === "landed" && room.landing) {
    const l = room.landing;
    return (
      <div className={`pty-panel land ${l.space}`} key={`l${l.seatId}${room.round}`}>
        <span className={`pty-panel-ico ${l.space}`}>{l.space === "chance" ? <Sparkles size={28} /> : <Coins size={28} />}</span>
        <b className="pty-panel-title">{l.text}</b>
        <p className="pty-panel-sub">{name}</p>
      </div>
    );
  }
  if (phase === "roll" || phase === "rolled" || phase === "moving") {
    const settled = phase !== "roll";
    return (
      <div className="pty-panel dice">
        <button
          className={`pty-die ${settled ? "settled" : ""} ${myTurn && phase === "roll" ? "mine" : ""} clickable`}
          onClick={myTurn && phase === "roll" ? onRoll : undefined}
          disabled={!myTurn || phase !== "roll" || busy || rolling}
          key={settled ? `s${room.round}${room.turnSeat}` : "rolling"}
          aria-label="Lancer le dé"
        >
          <b>{dieFace ?? "?"}</b>
        </button>
        {phase === "roll" ? (
          myTurn ? (
            <b className="pty-panel-title">
              <Dices size={18} /> Tape le dé !
            </b>
          ) : (
            <p className="pty-panel-sub">{name} lance le dé…</p>
          )
        ) : (
          <p className="pty-panel-sub">
            {name} avance de <b>{room.roll?.value}</b>
          </p>
        )}
      </div>
    );
  }
  return null;
}

// ----------------------------------------------------------------------
//  Les mini-jeux
// ----------------------------------------------------------------------
function MiniGame({ room, meId, serverNow, answer, setAnswer, onSubmit }) {
  const m = room.mini;
  const phase = room.phase;
  const seats = room.seats;
  const nameOf = (id) => seats.find((s) => s.id === id)?.username || "?";
  const seatOf = (id) => seats.find((s) => s.id === id);
  const t = phase === "mini" ? Math.max(0, serverNow() - (m.startsAt || 0)) : 0;
  const frac = Math.min(1, t / (m.durationMs || 1));
  const leftS = Math.max(0, Math.ceil((room.phaseEndsAt - serverNow()) / 1000));
  const found = m.found.some((f) => f.seatId === meId);
  const out = m.tries >= 3;

  if (phase === "mini-intro") {
    return (
      <div className="pty-mini intro">
        <div className="pty-mini-card">
          <span className="pty-mini-kicker">Mini-jeu</span>
          <h2 className="pty-mini-title">{m.name}</h2>
          <p className="pty-mini-rules">{m.rules}</p>
          <span className="pty-mini-count" key={leftS}>
            {leftS}
          </span>
        </div>
      </div>
    );
  }

  if (phase === "mini-result") {
    const a = m.answer || {};
    return (
      <div className="pty-mini result">
        <div className="pty-mini-card">
          <span className="pty-mini-kicker">{m.name}</span>
          {m.kind === "price" ? (
            <div className="pty-reveal">
              {a.cover && <img src={a.cover} alt="" />}
              <span>
                <b>{a.name}</b>
                <em className="pty-price">{Number(a.price).toFixed(2).replace(".", ",")} €</em>
              </span>
            </div>
          ) : (
            <div className="pty-reveal">
              {a.cover && <img src={a.cover} alt="" />}
              <span>
                <b>{a.name}</b>
                {a.year && <em>{a.year}</em>}
              </span>
            </div>
          )}
          <ol className="pty-mini-rank">
            {(m.results || []).length === 0 && <li className="none">Personne n'a trouvé.</li>}
            {(m.results || []).map((r) => {
              const s = seatOf(r.seatId);
              return (
                <li key={r.seatId} style={{ "--c": s?.color }}>
                  <b>{r.rank}</b>
                  {s && <Face seat={s} size={28} />}
                  <span className="pty-mini-rank-name">{nameOf(r.seatId)}</span>
                  {m.kind === "price" && <em>{Number(r.value).toFixed(2).replace(".", ",")} €</em>}
                  {r.prize > 0 && (
                    <strong>
                      +{r.prize} <Coins size={13} />
                    </strong>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    );
  }

  // phase === "mini"
  const blur = Math.round(32 * (1 - frac) ** 1.4);
  return (
    <div className={`pty-mini play k-${m.kind}`}>
      <div className="pty-mini-card wide">
        <div className="pty-mini-head">
          <span className="pty-mini-kicker">{m.name}</span>
          <span className="pty-mini-time" style={{ "--f": 1 - frac }}>
            {leftS}
          </span>
        </div>
        {m.kind === "blur" && (
          <div className="pty-blur">
            <img src={m.cover} alt="" draggable="false" style={{ filter: `blur(${blur}px)` }} />
          </div>
        )}
        {m.kind === "trailer" && (
          <div className="pty-trailer" style={{ "--b": `${blur}px` }}>
            <iframe
              title="Trailer"
              src={`https://www.youtube-nocookie.com/embed/${m.videoId}?autoplay=1&mute=1&controls=0&disablekb=1&modestbranding=1&rel=0&playsinline=1&iv_load_policy=3&start=6`}
              allow="autoplay; encrypted-media"
            />
            {/* Le titre de la vidéo s'affiche en haut : on le cache. */}
            <i className="pty-trailer-mask" />
            <i className="pty-trailer-shield" />
          </div>
        )}
        {m.kind === "price" && (
          <div className="pty-price-game">
            {m.cover && <img src={m.cover} alt="" draggable="false" />}
            <span>
              <b>{m.title}</b>
              {m.year && <em>{m.year}</em>}
              <small>Combien coûte-t-il sur Steam aujourd'hui ?</small>
            </span>
          </div>
        )}

        {m.kind === "price" ? (
          m.guessed ? (
            <p className="pty-mini-done">
              <Check size={16} /> Réponse envoyée
            </p>
          ) : (
            <form className="pty-answer" onSubmit={onSubmit}>
              <input
                inputMode="decimal"
                value={answer}
                onChange={(e) => setAnswer(e.target.value.replace(/[^0-9.,]/g, ""))}
                placeholder="Prix en euros"
                autoFocus
              />
              <button className="pty-send clickable" disabled={!answer}>
                €
              </button>
            </form>
          )
        ) : found ? (
          <p className="pty-mini-done">
            <Check size={16} /> Trouvé !
          </p>
        ) : out ? (
          <p className="pty-mini-done bad">Plus d'essais</p>
        ) : (
          <form className="pty-answer" onSubmit={onSubmit}>
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Le jeu…"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <button className="pty-send clickable" disabled={!answer.trim()}>
              <Check strokeWidth={3} />
            </button>
            <span className="pty-tries">
              {[0, 1, 2].map((i) => (
                <i key={i} className={i < 3 - (m.tries || 0) ? "on" : ""} />
              ))}
            </span>
          </form>
        )}

        <div className="pty-mini-who">
          {seats
            .filter((s) => !s.left)
            .map((s) => {
              const f = m.found.find((x) => x.seatId === s.id);
              const done = m.kind === "price" ? m.answered.includes(s.id) : !!f;
              return (
                <span key={s.id} className={`pty-who ${done ? "done" : ""}`} style={{ "--c": s.color }}>
                  <Face seat={s} size={30} />
                  {f && <em>{f.order}</em>}
                  {m.kind === "price" && done && (
                    <em>
                      <Check size={11} />
                    </em>
                  )}
                </span>
              );
            })}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
//  Le salon d'attente
// ----------------------------------------------------------------------
function Lobby({ room, busy, isAdmin, onTurns, onAddBot, onKick, onStart, onInvite, onLink }) {
  const host = room.isHost;
  const seats = room.seats.filter((s) => !s.left);
  const free = room.maxSeats - seats.length;
  const enough = seats.length >= 2;
  return (
    <main className="ptl">
      <div className="ptyl-card">
        <div className="ptyl-hero" aria-hidden="true">
          <span className="ptyl-die">
            <b>6</b>
          </span>
          <span className="ptyl-trophy">
            <Trophy size={30} />
          </span>
        </div>
        <h1 className="ptyl-title">La Party</h1>
        <p className="ptyl-pitch">Lance le dé, ramasse des pièces, achète des Trophées. Un mini-jeu à chaque manche.</p>
        <div className="ptyl-seats">
          {seats.map((s, i) => (
            <div key={s.id} className="ptyl-seat" style={{ "--c": ["#f2b70b", "#ff5470", "#3ddc97", "#2f7de1"][i % 4] }}>
              <span className="ptyl-face">
                {s.avatar ? <img src={s.avatar} alt="" /> : <i>{s.bot ? <Bot size={22} /> : (s.username || "?")[0].toUpperCase()}</i>}
                {s.isHost && (
                  <span className="ptyl-crown">
                    <Crown size={12} />
                  </span>
                )}
                {host && s.bot && (
                  <button className="ptyl-kick clickable" onClick={() => onKick(s.id)} aria-label={`Retirer ${s.username}`}>
                    <X size={12} />
                  </button>
                )}
              </span>
              <b>{s.username}</b>
            </div>
          ))}
          {Array.from({ length: free }).map((_, i) => (
            <button key={i} className="ptyl-seat empty clickable" onClick={onInvite} aria-label="Inviter un pote">
              <span className="ptyl-face">
                <Plus size={22} />
              </span>
              <b>Inviter</b>
            </button>
          ))}
        </div>
        <div className="ptyl-rule">
          <span>Manches</span>
          {[5, 10, 15].map((n) => (
            <button
              key={n}
              className={`clickable ${room.settings.turns === n ? "on" : ""}`}
              disabled={!host || busy}
              onClick={() => onTurns(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="ptyl-go">
          {host ? (
            <button className="pty-big gold clickable" onClick={onStart} disabled={busy || !enough}>
              {busy ? <Loader2 className="spin" /> : <Play />}
              Lancer
            </button>
          ) : (
            <p className="ptyl-wait">
              <Loader2 size={16} className="spin" /> L'hôte va lancer la partie
            </p>
          )}
          <button className="pty-big pink clickable" onClick={onInvite}>
            <UserPlus />
            Inviter un pote
          </button>
          {host && isAdmin && free > 0 && (
            <button className="pty-line clickable" onClick={onAddBot} disabled={busy}>
              <Bot size={17} /> Ajouter un bot
            </button>
          )}
          {host && !enough && <p className="ptyl-hint">Il faut au moins deux joueurs : invite un pote.</p>}
          <button className="ptyl-link clickable" onClick={onLink}>
            <Link2 size={14} /> Copier le lien de la partie
          </button>
        </div>
      </div>
    </main>
  );
}

// ----------------------------------------------------------------------
//  Fin de partie
// ----------------------------------------------------------------------
function Results({ ranking, meId, isHost, busy, onAgain, onQuit }) {
  const winner = ranking[0];
  return (
    <div className="pty-results">
      <div className="pty-results-card">
        {winner && (
          <div className="pty-winner">
            <span className="pty-winner-face" style={{ "--c": winner.color }}>
              {winner.avatar ? <img src={winner.avatar} alt="" /> : <i>{winner.bot ? <Bot size={30} /> : winner.username[0]}</i>}
              <Crown size={26} className="pty-winner-crown" />
              <Burst colors={["#f2b70b", "#ffffff", "#ff5470"]} count={24} spread={120} />
            </span>
            <h2>{winner.id === meId ? "Victoire" : `${winner.username} gagne`}</h2>
          </div>
        )}
        <ol className="pty-rank">
          {ranking.map((r) => (
            <li key={r.id} className={r.id === meId ? "me" : ""} style={{ "--c": r.color }}>
              <b>{r.place}</b>
              <span className="pty-rank-face">
                {r.avatar ? <img src={r.avatar} alt="" /> : r.bot ? <Bot size={15} /> : <i>{r.username[0]}</i>}
              </span>
              <span className="pty-rank-name">{r.username}</span>
              <span className="pty-stat tro">
                <Trophy size={14} /> {r.trophies}
              </span>
              <span className="pty-stat coin">
                <Coins size={14} /> {r.coins}
              </span>
              {!r.bot && <strong>+{r.points}</strong>}
            </li>
          ))}
        </ol>
        <div className="pty-results-go">
          {isHost ? (
            <button className="pty-big gold clickable" onClick={onAgain} disabled={busy}>
              <RotateCcw /> Rejouer
            </button>
          ) : (
            <p className="ptyl-wait">L'hôte peut relancer</p>
          )}
          <button className="pty-line clickable" onClick={onQuit}>
            Quitter
          </button>
        </div>
      </div>
    </div>
  );
}
