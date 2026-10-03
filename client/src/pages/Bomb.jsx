import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Bot,
  Building2,
  CalendarDays,
  Check,
  Crown,
  Eye,
  Gamepad2,
  Heart,
  HeartCrack,
  Link2,
  Loader2,
  MessageCircle,
  Paintbrush,
  Palette,
  Play,
  Plus,
  RotateCcw,
  Shapes,
  Skull,
  Tag,
  Type,
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
import GameChat from "../components/GameChat";
import Burst from "../components/Burst";
import DuelFriends from "../components/cards/battle/DuelFriends";
import BombArt from "../components/bomb/BombArt";
import BombStudio from "../components/bomb/BombStudio";
import { strokesToPNG } from "../components/draw/DrawCanvas";
import {
  isSfxMuted,
  setSfxMuted,
  primeBombSounds,
  playBombBoom,
  playBombTick,
  playBombMiss,
  playBombPass,
  playBombLife,
  playBombTurn,
  playBombCount,
  playBombWin,
  playBombLose,
} from "../lib/sfx";

// ======================================================================
//  La Bombe — BombParty, avec des jeux vidéo
// ======================================================================
// Une table ronde, une bombe au milieu. Celui qui la tient voit un défi (un
// logo de studio, un genre, une console, « le titre contient ONS ») et tape un
// jeu — ou une licence, « pokémon », « zelda » — qui colle : la bombe file
// chez le voisin avec un nouveau défi. Elle explose quand elle veut (la mèche
// est au serveur, jamais ici) et coûte une vie. Dernier debout gagne. Règles :
// server/src/routes/bomb.js ; dictionnaire et défis : lib/bombCatalog.js.
//
// ------------------------------------------------------------------- le style
// Celui des combats de cartes (styles/app-59-card-battle.css), que le premier
// jet de cette page n'avait pas : le tapis sombre, les plaques à bord or, le
// Lilita en capitales, une barre du haut presque vide. Le défi est écrit sur
// une plaque ronde au centre ; la bombe (components/bomb/BombArt.jsx) saute de
// joueur en joueur et rougit à mesure que la mèche brûle. C'est la bombe de
// CELUI QUI LA TIENT : son dessin, sa couleur — une tête de mort par défaut.
//
// Ce qui est resté du premier jet, parce que c'était bien : les têtes autour
// de la table et la frappe en direct sous la tête de celui qui joue.
const TYPING_MS = 70;
const KIND_ICON = {
  studio: Building2,
  platform: Gamepad2,
  genre: Shapes,
  tag: Tag,
  syllable: Type,
  theme: Palette,
  decade: CalendarDays,
  mode: Users,
  persp: Eye,
};
const MISS_LABEL = {
  unknown: "Connais pas",
  used: "Déjà sorti",
};
// Les deux façons de jouer (server/src/routes/bomb.js, MODES).
const MODE_LABEL = { classic: "Classique", rotate: "Un défi par tour" };
const MODE_NEXT = { classic: "rotate", rotate: "classic" };
const BOT_LABEL = { easy: "Facile", normal: "Moyen", hard: "Fort" };
const BOT_NEXT = { easy: "normal", normal: "hard", hard: "easy" };

export default function Bomb() {
  const { code } = useParams();
  return code ? <BombRoom key={code} code={code} /> : <BombOpen />;
}

// Le mode immersif : ni barre latérale ni barre du bas sur téléphone, et le
// tiroir du chat passe devant la table.
function useBodyClass() {
  useEffect(() => {
    document.body.classList.add("bt-immersive", "bb-on");
    return () => document.body.classList.remove("bt-immersive", "bb-on");
  }, []);
}

// ----------------------------------------------------------------------
//  /bombe : on ouvre une table tout de suite
// ----------------------------------------------------------------------
// Pas d'écran d'accueil à lire : la table EST l'accueil (on y voit la règle,
// on y invite, on lance). Une seule ouverture même quand React monte la page
// deux fois (StrictMode) : la promesse vit hors du composant.
let opening = null;
function BombOpen() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [err, setErr] = useState("");
  useBodyClass();

  const open = useCallback(() => {
    setErr("");
    if (!opening)
      opening = apiFetch("/bombe", { method: "POST", token }).finally(() => {
        setTimeout(() => {
          opening = null;
        }, 1000);
      });
    opening
      .then((d) => navigate(`/bombe/${d.room.code}`, { replace: true }))
      .catch((e) => setErr(e.message || "Impossible d'ouvrir une table."));
  }, [token, navigate]);

  useEffect(() => {
    if (token) open();
  }, [token, open]);

  return (
    <div className="bb bb-wait">
      {err ? (
        <>
          <p className="bb-err">{err}</p>
          <button className="bb-big gold clickable" onClick={open}>
            Réessayer
          </button>
        </>
      ) : (
        <Loader2 size={28} className="spin" />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
//  La table
// ----------------------------------------------------------------------
function BombRoom({ code }) {
  const { token, user } = useAuth();
  const { subscribe } = useChat();
  const navigate = useNavigate();
  useBodyClass();

  const [room, setRoom] = useState(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [muted, setMuted] = useState(isSfxMuted);
  const [picking, setPicking] = useState(false);
  const [studio, setStudio] = useState(false);
  // Le chat, en grand écran : FERMÉ par défaut (la table reste au centre), on
  // l'ouvre d'un clic. Le choix est retenu sur cet appareil.
  const [chatOpen, setChatOpen] = useState(() => {
    try {
      return localStorage.getItem("mpl_bomb_chat") === "1";
    } catch {
      return false;
    }
  });
  const [unread, setUnread] = useState(0);
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
  const toggleChat = useCallback(() => {
    setChatOpen((v) => {
      try {
        localStorage.setItem("mpl_bomb_chat", v ? "0" : "1");
      } catch {
        /* simple confort */
      }
      return !v;
    });
    setUnread(0);
  }, []);
  const [hitFx, setHitFx] = useState(null);
  const [missFx, setMissFx] = useState(null);
  const [boomFx, setBoomFx] = useState(null);
  const [cheatFx, setCheatFx] = useState({});
  const [freshLetters, setFreshLetters] = useState([]);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1100px)").matches);
  const [, setTick] = useState(0);

  const offsetRef = useRef(0);
  const inputRef = useRef(null);
  const shakeTimer = useRef(null);
  const meId = user?.id ? String(user.id) : "";

  const applyRoom = useCallback((r) => {
    if (!r) return;
    if (typeof r.now === "number") offsetRef.current = r.now - Date.now();
    setRoom(r);
  }, []);

  const post = useCallback(
    (path, body) => apiFetch(`/bombe/${code}${path}`, { method: "POST", token, body }),
    [code, token]
  );

  // Secouer le champ SANS le remonter : un remontage lui ferait perdre le
  // focus en pleine frappe.
  const doShake = useCallback(() => {
    setShake(false);
    clearTimeout(shakeTimer.current);
    requestAnimationFrame(() => setShake(true));
    shakeTimer.current = setTimeout(() => setShake(false), 480);
  }, []);

  useEffect(() => {
    primeBombSounds();
    const mq = window.matchMedia("(min-width: 1100px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // ---------- Chargement, et on s'assied ----------
  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    (async () => {
      try {
        const d = await apiFetch(`/bombe/${code}`, { token });
        if (!alive) return;
        applyRoom(d.room);
        if (!d.member) {
          const j = await apiFetch(`/bombe/${code}/join`, { method: "POST", token });
          if (alive) applyRoom(j.room);
        }
        setErr("");
      } catch (e) {
        if (alive) setErr(e.message || "Table introuvable.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, token, applyRoom]);

  // ---------- Le direct ----------
  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((event, data) => {
      if (event !== "bombe" || data?.code !== code) return;
      // Un message pendant que le chat est fermé : la pastille compte.
      // (Les annonces du jeu — « X a explosé » — ne comptent pas : seuls les
      // vrais messages des joueurs.)
      if (data.kind === "chat" && !chatOpenRef.current && !data.message?.system && data.message?.authorId !== meId)
        setUnread((n) => n + 1);
      if (data.room) applyRoom(data.room);
      switch (data.kind) {
        case "typing":
          setRoom((r) =>
            r?.turn?.seatId === data.seatId ? { ...r, turn: { ...r.turn, text: data.text } } : r
          );
          break;
        case "countdown":
          setBoomFx(null);
          setHitFx(null);
          break;
        case "turn":
          if (data.room?.turn?.seatId === meId) {
            setInput("");
            setTimeout(() => inputRef.current?.focus(), 30);
            playBombTurn();
          }
          break;
        case "hit": {
          const mine = data.seatId === meId;
          setHitFx({ ...data, key: `${data.at}-${data.id}` });
          playBombPass(mine);
          if (data.life) setTimeout(playBombLife, 250);
          if (mine) {
            setInput("");
            setFreshLetters(data.letters || []);
          }
          break;
        }
        case "miss":
          setMissFx({ ...data, key: Date.now() });
          playBombMiss();
          if (data.seatId === meId) {
            doShake();
            setTimeout(() => inputRef.current?.select(), 10);
          }
          break;
        case "boom":
          setBoomFx({ seatId: data.seatId, out: data.out, examples: data.examples || [], key: Date.now() });
          setHitFx(null);
          setMissFx(null);
          playBombBoom();
          if (data.seatId === meId) setInput("");
          break;
        case "hint":
          setRoom((r) => (r?.turn && r.turn.n === data.n ? { ...r, turn: { ...r.turn, hint: data.hint } } : r));
          break;
        case "cheat":
          setCheatFx((c) => ({ ...c, [data.seatId]: { line: data.line, key: Date.now() } }));
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
  }, [subscribe, code, applyRoom, meId, doShake]);

  // Les répliques de triche s'effacent seules, siège par siège.
  useEffect(() => {
    if (!Object.keys(cheatFx).length) return undefined;
    const t = setTimeout(() => {
      const now = Date.now();
      setCheatFx((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => now - v.key < 4000)));
    }, 4100);
    return () => clearTimeout(t);
  }, [cheatFx]);

  useEffect(() => {
    if (!freshLetters.length) return undefined;
    const t = setTimeout(() => setFreshLetters([]), 1400);
    return () => clearTimeout(t);
  }, [freshLetters]);

  useEffect(() => {
    if (!toast) return undefined;
    // Un toast qui propose « Annuler » reste le temps de se raviser.
    const t = setTimeout(() => setToast(""), toast.undo ? 6000 : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const phase = room?.phase || "lobby";
  const turn = room?.turn || null;
  const seats = useMemo(() => room?.seats || [], [room]);
  const me = seats.find((s) => s.isMe) || null;
  const myTurn = phase === "play" && turn?.seatId === meId;
  const holder = seats.find((s) => s.id === turn?.seatId) || null;
  const playing = phase === "play" || phase === "boom" || phase === "countdown";

  // Battement du compte à rebours.
  useEffect(() => {
    if (phase !== "countdown" && phase !== "boom") return undefined;
    const iv = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(iv);
  }, [phase]);

  // ---------- Le décompte, à l'oreille ----------
  // Un bip à chaque seconde (3, 2, 1), un accord quand la bombe s'allume.
  const endsAt = room?.phaseEndsAt || 0;
  const prevPhase = useRef(phase);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = phase;
    if (phase === "play" && was === "countdown") playBombCount(0);
    if (phase !== "countdown" || !endsAt) return undefined;
    let last = 0;
    const check = () => {
      const n = Math.ceil((endsAt - (Date.now() + offsetRef.current)) / 1000);
      if (n >= 1 && n !== last) {
        last = n;
        playBombCount(n);
      }
    };
    check();
    const iv = setInterval(check, 100);
    return () => clearInterval(iv);
  }, [phase, endsAt]);

  // ---------- Le tic-tac ----------
  // Il s'accélère depuis l'ALLUMAGE de la bombe (`litAt`, le même pour toute
  // la table), pas depuis le début du tour : passer la bombe ne remet pas le
  // compteur à zéro. Le temps qui reste, lui, n'est jamais révélé.
  const turnRef = useRef(turn);
  turnRef.current = turn;
  useEffect(() => {
    if (phase !== "play") return undefined;
    let t;
    const loop = () => {
      const tr = turnRef.current;
      if (!tr) return;
      playBombTick(tr.seatId === meId);
      const lit = Date.now() - ((tr.litAt || tr.startedAt) - offsetRef.current);
      t = setTimeout(loop, Math.max(330, 720 - lit / 40));
    };
    t = setTimeout(loop, 300);
    return () => clearTimeout(t);
  }, [phase, meId]);

  // ---------- La frappe, diffusée ----------
  const typingRef = useRef({ at: 0, timer: null });
  function pushTyping(text) {
    const t = typingRef.current;
    clearTimeout(t.timer);
    const fire = () => {
      t.at = Date.now();
      post("/typing", { text }).catch(() => {});
    };
    const wait = TYPING_MS - (Date.now() - t.at);
    if (wait <= 0) fire();
    else t.timer = setTimeout(fire, wait);
  }

  async function submit() {
    const text = input.trim();
    if (!text || !myTurn) return;
    try {
      const d = await post("/answer", { text });
      if (d.ok) setInput("");
    } catch (e) {
      if (e.status !== 409) setErr(e.message);
    }
  }

  // ---------- La triche ----------
  // Quitter l'onglet ou la fenêtre pendant la partie se signale à la table
  // (le retour aussi). Rien d'autre : pas de vie retirée.
  const watching = playing && !!me && !me.out;
  useEffect(() => {
    if (!watching) return undefined;
    let awayAt = 0;
    const away = () => {
      if (awayAt) return;
      awayAt = Date.now();
      post("/cheat", { what: "away" }).catch(() => {});
    };
    const back = () => {
      if (!awayAt || document.hidden) return;
      const ms = Date.now() - awayAt;
      awayAt = 0;
      post("/cheat", { what: "back", ms }).catch(() => {});
    };
    const onVis = () => (document.hidden ? away() : back());
    const onBlur = () =>
      setTimeout(() => {
        if (!document.hasFocus()) away();
      }, 250);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", back);
    };
  }, [watching, post]);

  useLiveStatus("bombe", playing ? `${seats.filter((s) => !s.out).length} en vie` : "", { token });

  // ---------- Actions ----------
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
  const setSetting = (body) => act(async () => applyRoom((await post("/settings", body)).room));
  const addBot = () => act(async () => applyRoom((await post("/bot", { level: "normal" })).room));
  const botLevel = (s) => act(async () => applyRoom((await post("/bot", { id: s.id, level: BOT_NEXT[s.bot] })).room));
  const removeBot = (id) => act(async () => applyRoom((await post("/bot", { remove: id })).room));
  const start = () =>
    act(async () => {
      primeBombSounds();
      applyRoom((await post("/start")).room);
    });
  const again = () => act(async () => applyRoom((await post("/again")).room));
  async function quit() {
    try {
      await post("/leave");
    } catch {
      /* on part quand même */
    }
    navigate("/arcade");
  }
  function copyLink() {
    navigator.clipboard?.writeText(`${window.location.origin}/bombe/${code}`).then(() => setToast("Lien copié"));
  }
  async function invite(f) {
    const d = await post("/challenge", { userId: f.id });
    setPicking(false);
    setToast(d.online ? `Invitation envoyée à ${f.username}` : `${f.username} la trouvera dans ses messages`);
  }
  async function inviteLink() {
    copyLink();
    setPicking(false);
  }
  // Ma bombe enregistrée : le toast propose de revenir à la précédente (on
  // rejoue ses traits pour en refaire l'image).
  function skinSaved(skin, prev) {
    setToast({
      text: "Bombe enregistrée",
      undo: async () => {
        setToast("");
        try {
          await apiFetch("/bombe/skin", {
            method: "POST",
            token,
            body: { color: prev.color, png: strokesToPNG(prev.strokes), strokes: prev.strokes },
          });
          setToast("Bombe d'avant remise");
        } catch (e) {
          setErr(e.message);
        }
      },
    });
  }
  function toggleMute() {
    setSfxMuted(!muted);
    setMuted(!muted);
  }

  // ---------- La place de chacun autour de la table ----------
  // On s'assoit TOUJOURS en bas, face à son champ ; les autres tournent dans
  // l'ordre du jeu (sens des aiguilles d'une montre).
  const layout = useMemo(() => {
    const n = Math.max(seats.length, 1);
    const mine = Math.max(0, seats.findIndex((s) => s.isMe));
    const map = new Map();
    seats.forEach((s, i) => {
      const deg = 180 + ((i - mine) * 360) / n;
      const rad = (deg * Math.PI) / 180;
      map.set(s.id, { deg, x: 50 + 41 * Math.sin(rad), y: 50 - 41 * Math.cos(rad) });
    });
    return map;
  }, [seats]);


  if (loading)
    return (
      <div className="bb bb-wait">
        <Loader2 size={28} className="spin" />
      </div>
    );
  if (!room)
    return (
      <div className="bb bb-wait">
        <p className="bb-err">{err || "Cette table n'existe plus."}</p>
        <button className="bb-big gold clickable" onClick={() => navigate("/bombe")}>
          Ouvrir une table
        </button>
      </div>
    );

  const countdown =
    phase === "countdown" ? Math.max(1, Math.ceil((room.phaseEndsAt - (Date.now() + offsetRef.current)) / 1000)) : 0;
  const alive = seats.filter((s) => !s.out && !s.left);

  return (
    <div
      className={`bb ${wide ? "wide" : ""} ${wide && chatOpen ? "chat-open" : ""} ${
        wide && phase !== "lobby" ? "with-log" : ""
      } phase-${phase} ${
        myTurn ? "my-turn" : ""
      }`}
    >
      {wide && phase !== "lobby" && <UsedLog history={room.history || []} seats={seats} />}
      <div className="bb-main">
        {/* La barre du haut : sortir, et le son. Rien d'autre. */}
        <header className="bb-hud">
          <button className="bb-icon clickable" onClick={quit} aria-label="Quitter la table">
            <X />
          </button>
          {phase !== "lobby" && (
            <span className="bb-alive" aria-label={`${alive.length} encore en vie`}>
              {seats.map((s) => (
                <i key={s.id} className={s.out || s.left ? "" : "on"} />
              ))}
            </span>
          )}
          <span className="bb-hud-right">
            {wide && (
              <button
                className={`bb-icon clickable ${chatOpen ? "on" : ""}`}
                onClick={toggleChat}
                aria-label={chatOpen ? "Fermer le chat" : "Ouvrir le chat"}
                aria-pressed={chatOpen}
              >
                <MessageCircle />
                {!chatOpen && unread > 0 && <em className="bb-icon-badge">{unread > 9 ? "9+" : unread}</em>}
              </button>
            )}
            <button
              className="bb-icon clickable"
              onClick={toggleMute}
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
            onLives={(n) => setSetting({ lives: n })}
            onMode={() => setSetting({ mode: MODE_NEXT[room.settings.mode] || "classic" })}
            isAdmin={!!user?.isAdmin}
            onAddBot={addBot}
            onBotLevel={botLevel}
            onKick={removeBot}
            onStart={start}
            onInvite={() => setPicking(true)}
            onLink={copyLink}
            onStudio={() => setStudio(true)}
          />
        ) : (
          <>
            <section className={`bb-stage ${boomFx && phase === "boom" ? "shaking" : ""}`}>
              <div className="bb-table">
                {seats.map((s) => (
                  <Seat
                    key={s.id}
                    seat={s}
                    pos={layout.get(s.id)}
                    holding={turn?.seatId === s.id && phase === "play"}
                    // Ma propre frappe vient du champ (le serveur ne me la renvoie pas).
                    text={turn?.seatId === s.id ? (s.isMe ? input : turn.text) : ""}
                    hit={hitFx?.seatId === s.id ? hitFx : null}
                    miss={missFx?.seatId === s.id ? missFx : null}
                    boom={boomFx?.seatId === s.id && phase === "boom" ? boomFx : null}
                    cheat={cheatFx[s.id] || null}
                    maxLives={Math.max(room.settings.lives, s.lives)}
                    prompt={turn?.prompt}
                  />
                ))}
                <BombCore phase={phase} turn={turn} myTurn={myTurn} countdown={countdown} boom={boomFx} />
                {(() => {
                  // La bombe, à mi-chemin entre la plaque et celui qui la tient.
                  const at = phase === "boom" ? boomFx?.seatId : phase === "play" ? turn?.seatId : null;
                  const pos = at && layout.get(at);
                  if (!pos) return null;
                  const owner = seats.find((s) => s.id === at);
                  return (
                    <TravelBomb
                      skin={owner?.bot ? null : owner?.skin}
                      ownerId={at}
                      // À CÔTÉ de la tête (vers l'intérieur de la table) : elle ne
                      // couvre jamais ce que le joueur tape au-dessus ou dessous.
                      x={pos.x + (pos.x > 66 ? -12 : 12)}
                      y={pos.y - 2}
                      hop={turn?.n || 0}
                      litAt={turn?.litAt || 0}
                      offsetRef={offsetRef}
                      mine={myTurn}
                      boom={phase === "boom" ? boomFx : null}
                    />
                  );
                })()}
              </div>
            </section>
            {phase === "boom" && boomFx && <span className="bb-flash" key={`f${boomFx.key}`} />}

            <footer className="bb-dock">
              {phase === "done" ? null : !me ? (
                <p className="bb-note">
                  <Eye size={15} /> Tu regardes. Tu joues à la prochaine.
                </p>
              ) : me.out ? (
                <p className="bb-note">
                  <Skull size={15} /> Tu as explosé. Charrie les autres dans le chat.
                </p>
              ) : (
                <>
                  <form
                    className={`bb-answer ${myTurn ? "on" : ""} ${shake ? "shake" : ""}`}
                    onSubmit={(e) => {
                      e.preventDefault();
                      submit();
                    }}
                  >
                    <input
                      ref={inputRef}
                      value={myTurn ? input : ""}
                      disabled={!myTurn}
                      maxLength={80}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder={
                        myTurn
                          ? "Un jeu ou une licence…"
                          : phase === "countdown"
                            ? "Ça commence…"
                            : holder
                              ? `${holder.username} a la bombe`
                              : ""
                      }
                      onChange={(e) => {
                        setInput(e.target.value);
                        pushTyping(e.target.value);
                      }}
                      onPaste={(e) => {
                        e.preventDefault();
                        doShake();
                        post("/cheat", { what: "paste" }).catch(() => {});
                      }}
                      onDrop={(e) => e.preventDefault()}
                    />
                    <button className="bb-send clickable" disabled={!myTurn || !input.trim()} aria-label="Valider">
                      <Check strokeWidth={3} />
                    </button>
                  </form>
                  <Letters bonus={room.bonus} have={me.letters} fresh={freshLetters} />
                </>
              )}
            </footer>
          </>
        )}

        {phase === "done" && (
          <Results ranking={room.ranking || []} meId={meId} isHost={room.isHost} busy={busy} onAgain={again} onQuit={quit} />
        )}

        {(toast || err) && (
          <div className={`bb-toast ${err ? "bad" : ""}`}>
            <button
              className="bb-toast-txt clickable"
              onClick={() => {
                setErr("");
                setToast("");
              }}
            >
              {err || toast.text || toast}
            </button>
            {!err && toast.undo && (
              <button className="bb-toast-undo clickable" onClick={toast.undo}>
                Annuler
              </button>
            )}
          </div>
        )}
      </div>

      {wide ? (
        chatOpen && (
        <aside className="bb-chat">
          <GameChat
            token={token}
            code={code}
            event="bombe"
            endpoint="/bombe"
            players={seats.filter((s) => !s.bot)}
            meId={meId}
            docked
            onClose={toggleChat}
          />
        </aside>
        )
      ) : (
        <GameChat token={token} code={code} event="bombe" endpoint="/bombe" players={seats.filter((s) => !s.bot)} meId={meId} />
      )}

      {studio && <BombStudio token={token} onClose={() => setStudio(false)} onSaved={skinSaved} />}

      {picking && (
        <DuelFriends
          token={token}
          endpoint="/bombe/friends"
          title="Inviter un pote"
          action="Inviter"
          onPick={invite}
          onLink={inviteLink}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
//  La plaque du centre : le défi (et, après l'explosion, ce qu'il fallait dire)
// ----------------------------------------------------------------------
function BombCore({ phase, turn, myTurn, countdown, boom }) {
  const p = turn?.prompt;
  const lit = phase === "play";
  return (
    <div className={`bbm ${lit ? "lit" : ""} ${myTurn ? "mine" : ""}`}>
      {phase === "boom" ? (
        boom && (
          <div className="bbm-missed">
            <span className="bbm-cap-txt">Il fallait dire</span>
            <ul>
              {boom.examples.map((g) => (
                <li key={g.id}>
                  {g.cover ? <img src={g.cover} alt="" draggable="false" /> : <i />}
                  <span>{g.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : (
        <div className="bbm-body">
          {phase === "countdown" ? (
            <b className="bbm-count" key={countdown}>
              {countdown}
            </b>
          ) : p ? (
            <Prompt p={p} k={`${p.key}-${turn.n}`} hint={turn.hint} />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
//  La bombe qui voyage
// ----------------------------------------------------------------------
// Elle saute chez celui qui la reçoit (un petit bond, écrasée à l'atterrissage)
// et chauffe depuis son allumage : du noir au rouge, elle tremble de plus en
// plus, et sa petite tête passe du sourire à la panique. `--heat` (0 → 1) est
// posé directement sur l'élément, sans rendu React.
const HEAT_MS = 28000;

function TravelBomb({ x, y, hop, litAt, offsetRef, mine, boom, skin, ownerId }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!litAt) return undefined;
    const set = () => {
      const lit = Date.now() - (litAt - offsetRef.current);
      ref.current?.style.setProperty("--heat", Math.min(1, Math.max(0, lit / HEAT_MS)).toFixed(3));
    };
    set();
    const iv = setInterval(set, 200);
    return () => clearInterval(iv);
  }, [litAt, offsetRef]);
  return (
    <div
      ref={ref}
      className={`bbx ${mine ? "mine" : ""} ${boom ? "boom" : ""}`}
      style={{ left: `${x}%`, top: `${y}%` }}
      aria-hidden="true"
    >
      <div className="bbx-hop" key={hop}>
        <div className="bbx-wob">
          <BombArt skin={skin} ownerId={ownerId} lit={!boom} />
        </div>
      </div>
      {boom && (
        <span className="bb-blast" key={boom.key}>
          <i className="ring" />
          <i className="ring two" />
          <Burst colors={["#f2b70b", "#ff5470", "#ffffff"]} count={28} spread={200} />
        </span>
      )}
    </div>
  );
}


function Prompt({ p, k, hint }) {
  const Icon = KIND_ICON[p.kind] || Tag;
  const label = p.kind === "tag" ? `#${p.label}` : p.label;
  const len = (label || "").length;
  // Les logos de console (IGDB) sont souvent sur fond opaque : passés en blanc,
  // ils devenaient un rectangle blanc. Seuls les studios gardent leur logo.
  const logo = p.kind === "studio" ? p.logo : null;
  return (
    <div className={`bbm-face ${hint ? "has-hint" : ""}`} key={k} data-prompt={p.key}>
      <span className="bbm-cap-txt">{p.caption}</span>
      {p.kind === "syllable" ? (
        <b className="bbm-syl">{p.label}</b>
      ) : p.kind === "fav" ? (
        <span className="bbm-fav">
          {p.avatar ? <img src={p.avatar} alt="" draggable="false" /> : <i>{(p.label || "?")[0].toUpperCase()}</i>}
          <b>{p.label}</b>
        </span>
      ) : logo ? (
        <img
          className={`bbm-logo ${p.logoMode === "box" ? "box" : ""}`}
          src={logo}
          alt={p.label}
          title={p.label}
          draggable="false"
        />
      ) : (
        <>
          <span className="bbm-ico">
            <Icon />
          </span>
          <b className={`bbm-label ${len > 14 ? "long" : ""} ${len > 20 ? "xlong" : ""}`}>{label}</b>
        </>
      )}
      {/* L'indice : celui qui sèche depuis un moment reçoit la jaquette floutée
          d'une réponse, et ses lettres — celles de la SAGA quand le jeu en porte
          le nom (server/src/routes/bomb.js, HINT_AFTER). */}
      {hint && (
        <span className="bbm-hint" title="Indice : un jeu qui colle">
          <i className="bbm-hint-k">Indice</i>
          {hint.cover && <img src={hint.cover} alt="" draggable="false" />}
          <b>{hint.text || hint}</b>
          {hint.saga && <em>saga</em>}
        </span>
      )}
    </div>
  );
}

// Pourquoi une réponse est refusée, dite avec le défi en cours : « Control :
// pas un jeu Microsoft » plutôt qu'un « non » sec qui laisse croire que le jeu
// n'a pas été reconnu.
function whyNot(p) {
  if (!p) return "non";
  const l = p.label;
  switch (p.kind) {
    case "studio":
      return `pas un jeu ${l}`;
    case "platform":
      return `pas sorti sur ${l}`;
    case "decade":
      return `pas des ${String(l).toLowerCase()}`;
    case "syllable":
      return `pas de « ${l} » dedans`;
    case "fav":
      return `pas un favori de ${l}`;
    case "tag":
      return `pas #${l}`;
    default:
      return `pas « ${l} »`;
  }
}

// ----------------------------------------------------------------------
//  Un siège
// ----------------------------------------------------------------------
function Seat({ seat, pos, holding, text, hit, miss, boom, cheat, maxLives, prompt }) {
  if (!pos) return null;
  const below = pos.y < 62; // la frappe sous la tête, sauf pour ceux du bas
  // Ce qui sort d'un siège au bord de la table s'ouvre vers l'intérieur.
  const side = pos.x > 66 ? "side-r" : pos.x < 34 ? "side-l" : "";
  // Ceux du haut : ce qui jaillit part VERS LE BAS (sinon sous la barre du haut).
  const top = pos.y < 30 ? "top" : "";
  return (
    <div
      className={`bb-seat ${holding ? "holding" : ""} ${seat.out ? "out" : ""} ${seat.isMe ? "me" : ""} ${
        !seat.online ? "away" : ""
      } ${boom ? "hit-boom" : ""} ${below ? "below" : "above"} ${side} ${top}`}
      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
    >
      <span className="bb-seat-face">
        {seat.avatar ? (
          <img src={seat.avatar} alt="" draggable="false" />
        ) : (
          <i className="letters">{seat.bot ? <Bot size={22} /> : (seat.username || "?")[0].toUpperCase()}</i>
        )}
        {seat.out && (
          <span className="bb-seat-skull">
            <Skull size={20} />
          </span>
        )}
        {seat.cheats > 0 && (
          <span className="bb-seat-sus" key={seat.cheats} title={`Soupçonné ${seat.cheats} fois`}>
            <Eye size={11} /> {seat.cheats}
          </span>
        )}
        {/* La triche : une étiquette à côté de la tête (la phrase, elle, part
            dans le chat). */}
        {cheat && (
          <span className="bb-sus tag" key={`t${cheat.key}`}>
            Triche ?
          </span>
        )}
      </span>
      <span className="bb-seat-name">
        {seat.bot && <Bot size={12} />}
        {seat.username}
      </span>
      <span className="bb-seat-lives">
        {Array.from({ length: maxLives }).map((_, i) => (
          <Heart key={i} size={13} className={i < seat.lives ? "on" : "off"} />
        ))}
      </span>

      {holding && (
        <span className={`bb-typed ${miss ? "miss" : ""}`} key={miss ? `t${miss.key}` : "t"}>
          {text ? (
            <>
              {text.slice(0, -1)}
              <b key={text.length}>{text.slice(-1)}</b>
            </>
          ) : (
            <em className="bb-typed-wait">
              <i />
              <i />
              <i />
            </em>
          )}
        </span>
      )}

      {miss && (
        <span className="bb-pop bad" key={miss.key}>
          {miss.reason === "nope" && miss.game
            ? `${miss.game.license ? `Aucun ${miss.game.name}` : miss.game.name} : ${whyNot(prompt)}`
            : MISS_LABEL[miss.reason] || "Non"}
        </span>
      )}
      {hit && (
        <span className="bb-pop good" key={hit.key}>
          {hit.cover && <img src={hit.cover} alt="" draggable="false" />}
          <span>
            <b>{hit.name}</b>
            {hit.year && <em>{hit.year}</em>}
          </span>
          {hit.life && (
            <span className="bb-pop-life">
              <Heart size={13} /> +1
            </span>
          )}
        </span>
      )}
      {boom && (
        <span className="bb-pop broke" key={boom.key}>
          <HeartCrack size={24} />
          {boom.out && <b>Éliminé</b>}
        </span>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
//  Déjà sortis : la liste, à gauche de la table
// ----------------------------------------------------------------------
// Un jeu ne sort qu'une fois par partie : la liste évite de le retaper. Le
// plus récent en haut ; ce qui a été TAPÉ s'affiche quand ce n'est pas le
// titre (« zelda » → The Legend of Zelda: Breath of the Wild).
const flat = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function UsedLog({ history, seats }) {
  const byId = new Map(seats.map((s) => [s.id, s]));
  const list = [...history].reverse();
  return (
    <aside className="bb-log">
      <header className="bb-log-head">
        Déjà sortis <small>{history.length}</small>
      </header>
      {list.length ? (
        <ol className="bb-log-list">
          {list.map((h, i) => (
            <li key={`${h.id}-${history.length - i}`}>
              {h.cover ? <img src={h.cover} alt="" loading="lazy" draggable="false" /> : <i />}
              <span className="bb-log-txt">
                <b>{h.name}</b>
                {h.license ? (
                  <em className="lic">Licence</em>
                ) : (
                  h.typed && flat(h.typed) !== flat(h.name) && <em>« {h.typed} »</em>
                )}
              </span>
              {/* Qui l'a dit : sa tête, pas son pseudo. */}
              <Face seat={byId.get(h.seatId)} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="bb-log-empty">Rien pour l'instant.</p>
      )}
    </aside>
  );
}

function Face({ seat }) {
  if (!seat) return <span className="bb-log-face" />;
  return (
    <span className={`bb-log-face ${seat.bot ? "bot" : ""}`} title={seat.username}>
      {seat.avatar ? (
        <img src={seat.avatar} alt={seat.username} draggable="false" />
      ) : seat.bot ? (
        <Bot size={13} />
      ) : (
        <b>{(seat.username || "?")[0].toUpperCase()}</b>
      )}
    </span>
  );
}

// ----------------------------------------------------------------------
//  Les lettres bonus (l'alphabet complet rend une vie)
// ----------------------------------------------------------------------
function Letters({ bonus, have, fresh }) {
  const set = new Set(have || []);
  const freshSet = new Set(fresh || []);
  return (
    <div className="bb-letters" title="Toutes ces lettres dans tes réponses = une vie de plus">
      {bonus.split("").map((l) => (
        <i key={l} className={`${set.has(l) ? "on" : ""} ${freshSet.has(l) ? "fresh" : ""}`}>
          {l}
        </i>
      ))}
      <Heart size={14} className="bb-letters-heart" />
    </div>
  );
}

// ----------------------------------------------------------------------
//  Le salon d'attente — dans l'idiome du lobby des combats
// ----------------------------------------------------------------------
function Lobby({ room, busy, onLives, onMode, onAddBot, onBotLevel, onKick, onStart, onInvite, onLink, onStudio, isAdmin }) {
  const host = room.isHost;
  const seats = room.seats.filter((s) => !s.left);
  const free = room.maxSeats - seats.length;
  const enough = seats.length >= 2;
  const hostName = seats.find((s) => s.isHost)?.username || "L'hôte";
  const me = seats.find((s) => s.isMe);
  return (
    <main className="bbl">
      <div className="bbl-card">
        {/* MA bombe : c'est elle que la table verra quand je la tiendrai. */}
        <button className="bbl-hero clickable" onClick={onStudio} title="Dessiner ma bombe">
          <span className="bbx still">
            <span className="bbx-wob">
              {/* Éteinte : elle ne s'allume qu'au lancement de la partie. */}
              <BombArt skin={me?.skin} ownerId={me?.id} lit={false} />
            </span>
          </span>
          <span className="bbl-paint">
            <Paintbrush size={15} />
          </span>
        </button>
        <h1 className="bbl-title">La Bombe</h1>
        <p className="bbl-pitch">Le bombparty des puants.</p>

        <div className="bbl-seats">
          {seats.map((s) => (
            <div key={s.id} className={`bbl-seat ${s.bot ? "bot" : ""} ${s.isMe ? "me" : ""}`}>
              <span className="bbl-face">
                {s.avatar ? (
                  <img src={s.avatar} alt="" draggable="false" />
                ) : (
                  <i>{s.bot ? <Bot size={24} /> : (s.username || "?")[0].toUpperCase()}</i>
                )}
                {s.isHost && (
                  <span className="bbl-crown" title="Hôte">
                    <Crown size={12} />
                  </span>
                )}
                {host && s.bot && (
                  <button className="bbl-kick clickable" onClick={() => onKick(s.id)} aria-label={`Retirer ${s.username}`}>
                    <X size={12} />
                  </button>
                )}
              </span>
              <b>{s.username}</b>
              {s.bot &&
                (host ? (
                  <button className="bbl-lvl clickable" onClick={() => onBotLevel(s)} disabled={busy} title="Changer le niveau">
                    {BOT_LABEL[s.bot]}
                  </button>
                ) : (
                  <span className="bbl-lvl">{BOT_LABEL[s.bot]}</span>
                ))}
            </div>
          ))}
          {free > 0 && (
            <button className="bbl-seat empty clickable" onClick={onInvite} aria-label="Inviter un pote">
              <span className="bbl-face">
                <Plus size={22} />
              </span>
              <b>Inviter</b>
            </button>
          )}
        </div>

        <div className="bbl-rules">
          <span className="bbl-rule">
            <span className="bbl-rule-k">Vies</span>
            <span className="bbl-hearts">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  className={`clickable ${n <= room.settings.lives ? "on" : ""}`}
                  disabled={!host || busy}
                  onClick={() => onLives(n)}
                  aria-label={`${n} vie${n > 1 ? "s" : ""}`}
                >
                  <Heart />
                </button>
              ))}
            </span>
          </span>
          <button
            className="bbl-rule clickable"
            disabled={!host || busy}
            onClick={onMode}
            title={
              room.settings.mode === "rotate"
                ? "Chaque joueur reçoit un défi neuf"
                : "Le même défi pour toute la table, jusqu'à l'explosion"
            }
          >
            <span className="bbl-rule-k">Mode</span>
            <b>{MODE_LABEL[room.settings.mode] || MODE_LABEL.classic}</b>
          </button>
        </div>

        <div className="bbl-go">
          {host ? (
            <button className="bb-big gold clickable" onClick={onStart} disabled={busy || !enough}>
              {busy ? <Loader2 className="spin" /> : <Play />}
              Lancer
            </button>
          ) : (
            <p className="bbl-wait">
              <Loader2 size={16} className="spin" /> {hostName} va lancer la partie
            </p>
          )}
          <button className="bb-big pink clickable" onClick={onInvite}>
            <UserPlus />
            Inviter un pote
          </button>
          {/* Les bots ne servent qu'à tester : le bouton n'existe que pour un admin. */}
          {host && isAdmin && free > 0 && (
            <button className="bb-line clickable" onClick={onAddBot} disabled={busy}>
              <Bot size={17} /> Ajouter un bot
            </button>
          )}
          {host && !enough && <p className="bbl-hint">Il faut au moins un adversaire : invite un pote.</p>}
          <button className="bbl-link clickable" onClick={onLink}>
            <Link2 size={14} /> Copier le lien de la table
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
    <div className="bb-results">
      <div className="bb-results-card">
        {winner && (
          <div className="bb-winner">
            <span className="bb-winner-face">
              {winner.avatar ? (
                <img src={winner.avatar} alt="" draggable="false" />
              ) : (
                <i>{winner.bot ? <Bot size={30} /> : winner.username[0].toUpperCase()}</i>
              )}
              <Crown size={26} className="bb-winner-crown" />
              <Burst colors={["#f2b70b", "#ffffff", "#ff5470"]} count={22} spread={110} />
            </span>
            <h2>{winner.id === meId ? "Victoire" : `${winner.username} gagne`}</h2>
          </div>
        )}
        <ol className="bb-rank">
          {ranking.map((r) => (
            <li key={r.id} className={r.id === meId ? "me" : ""}>
              <b>{r.place}</b>
              <span className="bb-rank-face">
                {r.avatar ? (
                  <img src={r.avatar} alt="" draggable="false" />
                ) : r.bot ? (
                  <Bot size={15} />
                ) : (
                  <i>{(r.username || "?")[0].toUpperCase()}</i>
                )}
              </span>
              <span className="bb-rank-name">{r.username}</span>
              <em>
                {r.answers} jeu{r.answers > 1 ? "x" : ""}
              </em>
              {!r.bot && <strong>{r.points > 0 ? `+${r.points}` : "0"}</strong>}
            </li>
          ))}
        </ol>
        <div className="bb-results-go">
          {isHost ? (
            <button className="bb-big gold clickable" onClick={onAgain} disabled={busy}>
              <RotateCcw /> Rejouer
            </button>
          ) : (
            <p className="bbl-wait">L'hôte peut relancer</p>
          )}
          <button className="bb-line clickable" onClick={onQuit}>
            Quitter
          </button>
        </div>
      </div>
    </div>
  );
}
