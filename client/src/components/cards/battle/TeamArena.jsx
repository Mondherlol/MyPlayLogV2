import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Crown, Check, Bot, Volume2, VolumeX, ChevronLeft, ChevronRight } from "lucide-react";
import { useScrollLock } from "../../../hooks/useScrollLock";
import { TYPES, cardStats } from "../../../lib/cards";
import {
  isSfxMuted,
  setSfxMuted,
  playCardDeal,
  primeBattleSounds,
  playBattleSlam,
  playBattleFan,
  playBattleFlip,
  playBattleTick,
  playBattleChip,
  playBattleDraw,
  playBattleObjective,
  playBattleVs,
  playBattleHit,
  playBattleShatter,
  playBattleWipe,
  playBattlePoint,
  playBattleDuel,
  playBattleVictory,
  playBattleDefeat,
} from "../../../lib/sfx";
import Burst from "../../Burst";
import TcgCard, { TypeBadge } from "../TcgCard";
import { isYearKind } from "./battleUi";
import BattleEnd from "./BattleEnd";
import { Avatar, ObjectiveFace, YearRoll } from "./Arena";

// ======================================================================
//  L'arène du 2 contre 2
// ======================================================================
// Le même théâtre que le 1 contre 1 (Arena.jsx), à quatre : mon équipe (or)
// en bas, l'autre (rose) en haut, et DEUX voies côte à côte, chacune avec son
// objectif. Je choisis ma voie (le bandeau en haut du choix), puis ma carte.
// Mon coéquipier prend l'autre voie : dès qu'il a posé, la sienne se grise.
// Les quatre cartes posées, on retourne tout, puis on juge voie par voie.
//
// Le serveur décide tout (lib/cardTeam.js) ; le pilote (drivers.js,
// teamDriver) apporte les cartes posées des autres et le verdict.

const RATIO = 88 / 63;
const LANES = [0, 1];
const teamOf = (s) => (s < 2 ? "a" : "b");

function useTeamLayout() {
  const calc = () => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const wide = W >= 900 && W / H >= 1.1;
    const top = 60;
    const hw = wide ? Math.round(Math.min(132, Math.max(88, H * 0.14))) : Math.round(Math.min(110, Math.max(60, W * 0.2), H * 0.13));
    const bw = Math.round(Math.max(28, hw * (wide ? 0.5 : 0.4)));
    const hh = hw * RATIO;
    const bh = bw * RATIO;
    const handY = H / 2 - hh / 2 - (wide ? 24 : 14);
    const botY = -H / 2 + top + bh / 2 + (wide ? 10 : 6);
    const aTop = botY + bh / 2 + (wide ? 22 : 14);
    const aBot = handY - hh / 2 - (wide ? 22 : 14);
    const aMid = (aTop + aBot) / 2;
    const objH = wide ? 78 : 58;
    const gap = wide ? 14 : 8;
    const colW = wide ? 0 : Math.floor((W - 16 - 10) / 2);
    const cw = Math.round(
      Math.min((aBot - aTop - objH - gap * 2) / 2 / RATIO, wide ? 210 : colW - 12, wide ? ((W - 160) / 2) * 0.55 : 200)
    );
    const ch = cw * RATIO;
    const objW = wide ? Math.round(Math.min(300, Math.max(cw * 1.45, 220))) : colW;
    const laneDX = wide ? Math.max(objW / 2 + 28, Math.min(W * 0.19, 270)) : colW / 2 + 5;
    const lanes = [-laneDX, laneDX].map((x) => ({
      x,
      obj: { x, y: aMid, w: objW, h: objH },
      you: { x, y: aMid + objH / 2 + gap + ch / 2 },
      bot: { x, y: aMid - objH / 2 - gap - ch / 2 },
    }));
    const span = Math.max(objW, cw) / 2 + (wide ? 26 : 4);
    const board = {
      x: -laneDX - span,
      y: lanes[0].bot.y - ch / 2 - (wide ? 18 : 10),
      w: (laneDX + span) * 2,
      h: lanes[0].you.y - lanes[0].bot.y + ch + (wide ? 36 : 20),
    };

    // Les mains des trois autres : de petits éventails. Les adversaires en
    // haut, au-dessus de chaque voie ; mon coéquipier en bas à gauche.
    const fan = bw * (wide ? 0.45 : 0.3);
    const fanW = bw + fan * 4;
    const stacks = {
      foeL: { x: -laneDX, y: botY, spread: fan, top: true },
      foeR: { x: laneDX, y: botY, spread: fan, top: true },
      mate: { x: -W / 2 + fanW / 2 + (wide ? 28 : 10), y: handY + hh * 0.12, spread: wide ? fan : bw * 0.16, top: false },
    };
    // Téléphone : ma main se décale un peu, pour laisser la place à la sienne.
    const handX = wide ? 0 : Math.min(26, Math.max(0, W * 0.07));

    // Le choix en grand : le bandeau des deux voies en haut, les cartes dessous.
    const bannerTop = top + (wide ? 14 : 8);
    const bannerH = wide ? 96 : 86;
    const zTop = bannerTop + bannerH + (wide ? 22 : 14);
    let zw;
    let zoomY;
    let dotsY = 0;
    if (wide) {
      zw = Math.round(Math.min(300, (W - 60) / 4.4, (H - zTop - 40) / RATIO));
      zoomY = zTop + (H - zTop - 30) / 2 - H / 2;
    } else {
      const extra = 100;
      zw = Math.round(Math.min(300, W * 0.68, (H - zTop - extra - 16) / RATIO));
      const zh = zw * RATIO;
      const blockTop = zTop + Math.max(0, (H - zTop - 16 - (zh + extra)) / 2);
      zoomY = blockTop + zh / 2 - H / 2;
      dotsY = zoomY + zh / 2 + 26;
    }
    const grid = (n) => {
      if (wide || !n) return null;
      const cols = n <= 3 ? n : Math.ceil(n / 2);
      const rows = n <= 3 ? 1 : 2;
      const g = 10;
      const gw = Math.floor(Math.min((W - 24 - g * (cols - 1)) / cols, (H - zTop - 40 - g * (rows - 1)) / rows / RATIO, zw));
      const gh = gw * RATIO;
      const gTop = zTop + Math.max(0, (H - zTop - 24 - (rows * gh + (rows - 1) * g)) / 2);
      return (i) => {
        const row = rows === 1 ? 0 : i < cols ? 0 : 1;
        const inRow = row === 0 ? Math.min(cols, n) : n - cols;
        const col = row === 0 ? i : i - cols;
        return { x: (col - (inRow - 1) / 2) * (gw + g), y: gTop + row * (gh + g) + gh / 2 - H / 2, w: gw };
      };
    };
    const base = Math.max(cw, zw);
    const k = base / cw;
    const dy = lanes[0].bot.y - lanes[0].you.y;
    const lunge = { you: { x: 0, y: dy * 0.26 * k }, bot: { x: 0, y: -dy * 0.26 * k } };
    return {
      W,
      H,
      wide,
      top,
      cw,
      ch,
      hw,
      bw,
      hh,
      bh,
      handY,
      handX,
      botY,
      aMid,
      lanes,
      board,
      stacks,
      fanW,
      lunge,
      bannerTop,
      bannerH,
      zw,
      zoomY,
      dotsY,
      base,
      grid,
    };
  };
  const [lay, setLay] = useState(calc);
  useEffect(() => {
    const on = () => setLay(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return lay;
}

// Qui est qui, vu de ma place.
function seatsOf(seat) {
  const mate = seat ^ 1;
  const foes = seat < 2 ? [2, 3] : [0, 1];
  return { mate, foes, pos: { [mate]: "mate", [foes[0]]: "foeL", [foes[1]]: "foeR" } };
}

function place(p, lay, hands, zoom, focus, peek, me, pos) {
  const B = lay.base;
  if (p.zone === "slot") return { ...lay.lanes[p.lane][p.side], r: 0, s: lay.cw / B, z: 30 };
  const mine = p.seat === me;
  if (p.zone === "deck") {
    const a = mine ? { y: lay.handY } : lay.stacks[pos[p.seat]];
    return { x: lay.W / 2 + lay.cw, y: a.y, r: 24, s: (mine ? lay.hw : lay.bw) / B, z: 5 };
  }
  const list = hands[p.seat] || [];
  const n = list.length;
  const i = list.indexOf(p.key);
  const off = i - (n - 1) / 2;
  if (mine && zoom) {
    if (lay.wide) {
      const spread = Math.min(lay.zw * 1.03, (lay.W - 50 - lay.zw) / Math.max(1, n - 1));
      return { x: off * spread, y: lay.zoomY + off * off * 5, r: off * 2, s: lay.zw / B, z: 70 + i };
    }
    const g = lay.grid(n)(i);
    if (!peek || i !== focus) return { x: g.x, y: g.y, r: 0, s: g.w / B, z: 60 + i };
    const d = i - focus;
    const ad = Math.abs(d);
    return {
      x: d * lay.zw * 0.78,
      y: lay.zoomY + ad * lay.zw * 0.05,
      r: d * 4,
      s: ((d === 0 ? 1 : 0.84) * lay.zw) / B,
      z: 80 - ad,
      far: ad >= 2,
    };
  }
  if (mine) {
    const spread = Math.min(lay.hw * (lay.wide ? 0.95 : 0.68), (lay.W - 24 - lay.hw - lay.handX * 2) / Math.max(1, n - 1));
    return {
      x: lay.handX + off * spread,
      y: lay.handY + off * off * 2.2,
      r: off * (lay.wide ? 2.4 : 3.2),
      s: lay.hw / B,
      z: 10 + i,
    };
  }
  const a = lay.stacks[pos[p.seat]];
  const sgn = a.top ? -1 : 1;
  return { x: a.x + off * a.spread, y: a.y + sgn * off * off * 1.5, r: sgn * off * 3, s: lay.bw / B, z: 6 + i };
}

// Le visage d'une place : un humain, ou un bot et son niveau.
function SeatFace({ pl, me, level, isMe }) {
  if (isMe) return <Avatar me={me} />;
  if (!pl || pl.bot)
    return (
      <>
        <Bot />
        {level ? <i className="ba-lvl">{level}</i> : null}
      </>
    );
  return <Avatar me={pl.user} />;
}
const seatName = (pl, me, isMe) => (isMe ? me?.username || "Moi" : !pl || pl.bot ? "Bot" : pl.user?.username || "?");

// Le face-à-face : mon équipe à gauche, l'autre à droite.
function TeamIntro({ me, players, seat, level, stage }) {
  const { mate, foes } = seatsOf(seat);
  const face = (s) => (
    <span className="ba-vs-ava tm-vs-ava" key={s}>
      <SeatFace pl={players[s]} me={me} level={level} isMe={s === seat} />
    </span>
  );
  return (
    <div className={`ba-vs tm-vs st-${stage}`}>
      <div className="ba-vs-side you">
        <span className="tm-vs-pair">
          {face(seat)}
          {face(mate)}
        </span>
        <b>
          {seatName(players[seat], me, true)} · {seatName(players[mate], me, false)}
        </b>
      </div>
      <span className="ba-vs-x">VS</span>
      <div className="ba-vs-side bot">
        <span className="tm-vs-pair">
          {face(foes[0])}
          {face(foes[1])}
        </span>
        <b>
          {seatName(players[foes[0]], me, false)} · {seatName(players[foes[1]], me, false)}
        </b>
      </div>
    </div>
  );
}

export default function TeamArena({ me, initial, resumed, driver: drv, onExit, onReplay, onBalance, rematch = null }) {
  useScrollLock(true);
  const lay = useTeamLayout();
  const layRef = useRef(lay);
  layRef.current = lay;
  const hoverable = useMemo(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches,
    []
  );
  const seat = initial.seat;
  const myTeam = initial.team;
  const { mate, foes, pos } = useMemo(() => seatsOf(seat), [seat]);
  const sideOf = (s) => (teamOf(s) === myTeam ? "you" : "bot");
  const sideOfTeam = (t) => (t === myTeam ? "you" : "bot");
  const rel = (sc) => ({ you: sc?.[myTeam] || 0, bot: sc?.[myTeam === "a" ? "b" : "a"] || 0 });

  const [pieces, setPieces] = useState([]);
  const piecesRef = useRef([]);
  const [phase, setPhaseState] = useState("intro");
  const phaseRef = useRef("intro");
  const [players, setPlayers] = useState(initial.players);
  const [score, setScore] = useState(() => rel(initial.score));
  const [objs, setObjs] = useState([null, null]);
  const [objState, setObjState] = useState(["off", "off"]);
  const [timer, setTimer] = useState(null);
  const [focus, setFocusState] = useState(0);
  const focusRef = useRef(0);
  const [peek, setPeekState] = useState(false);
  const peekRef = useRef(false);
  const [kbd, setKbd] = useState(false);
  // La voie que je vise, et celle que mon coéquipier a prise.
  const [lane, setLaneState] = useState(0);
  const laneRef = useRef(0);
  const [mateLane, setMateLaneState] = useState(null);
  const mateLaneRef = useRef(null);
  const [placed, setPlaced] = useState({}); // place -> voie, pour la manche en cours
  const [plaques, setPlaques] = useState({});
  const [stamps, setStamps] = useState({});
  const [crown, setCrown] = useState(null); // { lane, side }
  const [hp, setHp] = useState(null); // { lane, you, bot }
  const [pops, setPops] = useState([]);
  const [banner, setBanner] = useState(null);
  const [bursts, setBursts] = useState([]);
  const [rings, setRings] = useState([]);
  const [flash, setFlash] = useState(null);
  const [shake, setShake] = useState(0);
  const [orb, setOrb] = useState(null);
  const [intro, setIntro] = useState(null);
  const [end, setEnd] = useState(null);
  const [err, setErr] = useState("");
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [oppWait, setOppWait] = useState(false);
  const [muted, setMuted] = useState(isSfxMuted);
  const pipRefs = useRef({ you: [], bot: [] });
  const drag = useRef(null);

  const viewRef = useRef(initial);
  const seq = useRef(0);
  const otherSeq = useRef(0);
  const pickSeq = useRef(0);
  // Les cartes posées par les autres, par manche : un « go » forcé pendant
  // mes animations peut les faire arriver avant que la manche soit à l'écran.
  const pickBuf = useRef(new Map());
  const life = useRef({ run: 0, timers: new Set() });

  const setPhase = (ph) => {
    phaseRef.current = ph;
    setPhaseState(ph);
  };
  const setFocus = (i) => {
    focusRef.current = i;
    setFocusState(i);
  };
  const setPeek = (v) => {
    peekRef.current = v;
    setPeekState(v);
  };
  const setLane = (l) => {
    laneRef.current = l;
    setLaneState(l);
  };
  const setMateLane = (l) => {
    mateLaneRef.current = l;
    setMateLaneState(l);
    if (l != null && laneRef.current === l) setLane(1 - l);
  };
  const mutate = (fn) => {
    const next = fn(piecesRef.current);
    piecesRef.current = next;
    setPieces(next);
  };
  const setFx = (key, fx) => key && mutate((ps) => ps.map((p) => (p.key === key ? { ...p, fx } : p)));
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      life.current.timers.delete(t);
      fn();
    }, ms);
    life.current.timers.add(t);
  };
  const sleep = (ms) => new Promise((r) => later(r, ms));
  const dead = (R) => life.current.run !== R;
  const nextId = () => ++seq.current;
  const myHand = () => piecesRef.current.filter((p) => p.seat === seat && p.zone === "hand");
  const slotPiece = (s) => piecesRef.current.find((p) => p.seat === s && p.zone === "slot");
  const ring = (ln, side, delay = 380) =>
    later(() => {
      const id = nextId();
      setRings((r) => [...r, { id, lane: ln, side }]);
      later(() => setRings((r) => r.filter((x) => x.id !== id)), 700);
    }, delay);

  // --- les mains -----------------------------------------------------------------
  async function syncHands(v, R, instant = false) {
    const cur = piecesRef.current;
    const mineIds = cur.filter((p) => p.seat === seat && p.zone === "hand").map((p) => p.cardId);
    const add = v.hand.filter((c) => !mineIds.includes(c.id));
    const keep = new Set(v.hand.map((c) => c.id));
    const extra = {};
    const addN = {};
    for (const pl of v.players) {
      if (pl.seat === seat) continue;
      const have = cur.filter((p) => p.seat === pl.seat && p.zone === "hand").length;
      extra[pl.seat] = Math.max(0, have - pl.hand);
      addN[pl.seat] = Math.max(0, pl.hand - have);
    }
    const next = cur.filter((p) => {
      if (p.zone !== "hand") return true;
      if (p.seat === seat) return keep.has(p.cardId);
      if (extra[p.seat] > 0) {
        extra[p.seat]--;
        return false;
      }
      return true;
    });
    const fresh = [];
    for (const c of add) {
      const key = `y${c.id}`;
      next.push({ key, seat, side: "you", cardId: c.id, card: c, zone: instant ? "hand" : "deck", down: false, fx: "" });
      fresh.push(key);
    }
    for (const s of Object.keys(addN).map(Number)) {
      for (let i = 0; i < addN[s]; i++) {
        const key = `o${s}-${++otherSeq.current}`;
        next.push({ key, seat: s, side: sideOf(s), card: null, zone: instant ? "hand" : "deck", down: true, fx: "" });
        fresh.push(key);
      }
    }
    mutate(() => next);
    if (instant || !fresh.length) return;
    await sleep(60);
    let dealt = 0;
    for (const k of fresh) {
      if (dead(R)) return;
      mutate((ps) => ps.map((p) => (p.key === k ? { ...p, zone: "hand" } : p)));
      if (k.startsWith("y")) playCardDeal(dealt++);
      await sleep(k.startsWith("y") ? 95 : 40);
    }
    await sleep(350);
  }

  // Une carte d'un autre arrive, face cachée, sur sa voie.
  function placeOther(s, ln, quiet = false) {
    if (s === seat || slotPiece(s)) return;
    let p = piecesRef.current.find((x) => x.seat === s && x.zone === "hand");
    if (!p) {
      p = { key: `o${s}-${++otherSeq.current}`, seat: s, side: sideOf(s), card: null, zone: "deck", down: true, fx: "" };
      mutate((ps) => [...ps, p]);
    }
    const key = p.key;
    mutate((ps) => ps.map((x) => (x.key === key ? { ...x, zone: "slot", lane: ln, down: true } : x)));
    setPlaced((m) => ({ ...m, [s]: ln }));
    if (s === mate) setMateLane(ln);
    if (!quiet) {
      playBattleSlam(true);
      ring(ln, sideOf(s));
    }
  }

  // --- une manche commence -------------------------------------------------------
  async function beginRound(v, R) {
    viewRef.current = v;
    setScore(rel(v.score));
    setPlayers(v.players);
    const n = v.round.n;
    setPlaced({});
    mateLaneRef.current = null;
    setMateLaneState(null);
    const goAt = { t: 0, left: null };
    const go = drv.ready(n).then((g) => {
      goAt.t = g?.at || Date.now();
      goAt.left = g?.left ?? null;
    });
    await syncHands(v, R);
    if (dead(R)) return;
    setFlash({ text: `Manche ${v.n}`, k: nextId(), small: true });
    await sleep(760);
    if (dead(R)) return;
    setFlash(null);
    setObjs(v.round.objectives);
    setObjState(["in", "off"]);
    playBattleObjective();
    await sleep(260);
    setObjState(["in", "in"]);
    playBattleObjective();
    await sleep(640);
    if (dead(R)) return;
    setObjState(["lit", "lit"]);
    if (!goAt.t) setOppWait(true);
    await go;
    setOppWait(false);
    if (dead(R)) return;
    let ms = v.round.ms;
    const left = goAt.left ?? ms;
    ms = Math.max(3000, Math.min(ms, left - (Date.now() - goAt.t)));
    // Ce qui est déjà posé (reprise, ou les autres ont été rapides).
    v.round.picks?.forEach((p, s) => p && s !== seat && placeOther(s, p.lane, true));
    for (const [s, ln] of pickBuf.current.get(n) || []) placeOther(s, ln, true);
    pickBuf.current.delete(n - 1);
    if (v.round.mine) {
      const p = myHand().find((x) => x.cardId === v.round.mine.card);
      if (p) {
        setPhase("pick");
        play(p, v.round.mine.lane);
        return;
      }
    }
    setFocus(Math.floor((myHand().length - 1) / 2));
    setPeek(false);
    if (mateLaneRef.current != null) setLane(1 - mateLaneRef.current);
    setTimer({ ms, key: `${v.id}-${n}`, at: Date.now() });
    setPhase("pick");
    const mine = ++pickSeq.current;
    playBattleFan();
    later(() => {
      if (dead(R) || pickSeq.current !== mine || phaseRef.current !== "pick") return;
      const hand = myHand();
      if (hand.length) play(hand[Math.floor(Math.random() * hand.length)]);
    }, ms);
  }

  // --- je pose une carte ---------------------------------------------------------
  async function play(p, forced = null) {
    if (phaseRef.current !== "pick") return;
    const R = life.current.run;
    const n = viewRef.current.round.n;
    const want = forced ?? (mateLaneRef.current != null ? 1 - mateLaneRef.current : laneRef.current);
    setPhase("wait");
    setTimer((t) => (t ? { ...t, stopped: true } : t));
    mutate((ps) => ps.map((x) => (x.key === p.key ? { ...x, zone: "slot", lane: want, down: true } : x)));
    setPlaced((m) => ({ ...m, [seat]: want }));
    playBattleSlam();
    ring(want, "you", 520);
    if (forced == null) {
      let res;
      try {
        res = await drv.pick(viewRef.current, p.cardId, want);
      } catch (e) {
        if (dead(R)) return;
        setErr(e.message);
        mutate((ps) => ps.map((x) => (x.key === p.key ? { ...x, zone: "hand", down: false } : x)));
        setPlaced((m) => {
          const c = { ...m };
          delete c[seat];
          return c;
        });
        setTimer((t) => (t ? { ...t, stopped: false } : t));
        setPhase("pick");
        return;
      }
      if (dead(R)) return;
      setErr("");
      // Mon coéquipier avait pris cette voie à la même seconde : la mienne
      // glisse sur l'autre.
      if (res.lane !== want) {
        mutate((ps) => ps.map((x) => (x.key === p.key ? { ...x, lane: res.lane } : x)));
        setPlaced((m) => ({ ...m, [seat]: res.lane }));
      }
    }
    const state = await drv.round(n);
    if (dead(R)) return;
    await sleep(450);
    if (dead(R)) return;
    await resolveRound(state, R);
  }

  function shatter(key, ln, side) {
    if (!key) return;
    const card = piecesRef.current.find((p) => p.key === key)?.card;
    const st = card ? cardStats(card) : null;
    const colors = st
      ? [TYPES[st.types[0]]?.color || "#fff", TYPES[st.types[1] || st.types[0]]?.color || "#fff", "#ffffff"]
      : ["#ffffff"];
    setFx(key, "shatter");
    setBursts((b) => [...b, { id: nextId(), lane: ln, side, colors }]);
    playBattleShatter();
    setShake((s) => s + 1);
  }

  function flyOrb(ln, side, idx) {
    const L = layRef.current;
    const el = pipRefs.current[side]?.[Math.max(0, idx)];
    const from = L.lanes[ln][side];
    let to = { x: from.x, y: -L.H / 2 + 30 };
    if (el) {
      const r = el.getBoundingClientRect();
      to = { x: r.left + r.width / 2 - L.W / 2, y: r.top + r.height / 2 - L.H / 2 };
    }
    const id = nextId();
    setOrb({ id, side, from, to, go: false });
    requestAnimationFrame(() => requestAnimationFrame(() => setOrb((o) => (o && o.id === id ? { ...o, go: true } : o))));
    later(playBattleChip, 560);
    later(() => setOrb((o) => (o && o.id === id ? null : o)), 900);
  }

  // Le combat d'une voie (égalité) : chacun frappe à son tour.
  async function runFight(r, keys, R) {
    const f = r.fight;
    const ln = r.lane;
    setFlash({ text: "DUEL", k: nextId(), lane: ln });
    playBattleDuel();
    await sleep(850);
    if (dead(R)) return;
    setFlash(null);
    const S = (t) => sideOfTeam(t);
    const hp0 = { [S("a")]: f.hp0.a, [S("b")]: f.hp0.b };
    setHp({ lane: ln, you: { hp: hp0.you, max: hp0.you }, bot: { hp: hp0.bot, max: hp0.bot } });
    await sleep(380);
    for (const h of f.log) {
      if (dead(R)) return;
      const att = S(h.by);
      const def = att === "you" ? "bot" : "you";
      const card = h.by === "a" ? r.a.card : r.b.card;
      const move = cardStats(card).moves[h.move];
      setBanner({ lane: ln, side: att, name: move?.name || "", type: h.type, k: nextId() });
      setFx(keys[att], "lunge");
      await sleep(210);
      if (dead(R)) return;
      setFx(keys[def], "hit");
      playBattleHit(h.mult);
      if (h.mult >= 2) setShake((s) => s + 1);
      const pid = nextId();
      setPops((ps) => [...ps, { id: pid, lane: ln, side: def, dmg: h.dmg, mult: h.mult }]);
      later(() => setPops((ps) => ps.filter((x) => x.id !== pid)), 1300);
      const hpDef = h.hp[def === S("a") ? "a" : "b"];
      setHp((cur) => (cur ? { ...cur, [def]: { ...cur[def], hp: hpDef } } : cur));
      await sleep(620);
      setFx(keys[att], "");
      setFx(keys[def], "");
      await sleep(140);
    }
    setBanner(null);
    setFlash({ text: f.tech ? "K.O. technique" : "K.O.", k: nextId(), lane: ln });
    await sleep(700);
    setFlash(null);
    setHp(null);
  }

  // Les quatre cartes au bon endroit, avec leur vrai visage (le serveur a pu
  // jouer à la place de quelqu'un, ou une carte posée a pu nous échapper).
  function ensureSlots(results) {
    for (const r of results) {
      for (const t of ["a", "b"]) {
        const x = r[t];
        if (x.seat === seat) {
          const key = `y${x.card.id}`;
          mutate((ps) => {
            let out = ps.map((p) =>
              p.seat === seat && p.zone === "slot" && p.key !== key ? { ...p, zone: "hand", down: false } : p
            );
            if (!out.some((p) => p.key === key))
              out = [...out, { key, seat, side: "you", cardId: x.card.id, card: x.card, zone: "hand", down: false, fx: "" }];
            return out.map((p) => (p.key === key ? { ...p, zone: "slot", lane: r.lane, down: true } : p));
          });
        } else {
          if (!slotPiece(x.seat)) placeOther(x.seat, r.lane, true);
          const p = slotPiece(x.seat);
          if (p) mutate((ps) => ps.map((q) => (q.key === p.key ? { ...q, lane: r.lane } : q)));
        }
        const p = slotPiece(x.seat);
        if (p) mutate((ps) => ps.map((q) => (q.key === p.key ? { ...q, card: x.card } : q)));
      }
    }
  }

  // --- on retourne tout, puis voie par voie ------------------------------------------
  async function resolveRound(state, R) {
    const results = state.last?.results || [];
    setTimer(null);
    setPhase("reveal");
    ensureSlots(results);
    setObjState(["focus", "focus"]);
    await sleep(520);
    if (dead(R)) return;
    const keys = results.map((r) => ({
      [sideOfTeam("a")]: slotPiece(r.a.seat)?.key,
      [sideOfTeam("b")]: slotPiece(r.b.seat)?.key,
    }));
    const all = keys.flatMap((k) => [k.you, k.bot]).filter(Boolean);
    mutate((ps) => ps.map((x) => (all.includes(x.key) ? { ...x, down: false, fx: "rise" } : x)));
    playBattleFlip();
    await sleep(760);
    if (dead(R)) return;
    mutate((ps) => ps.map((x) => (all.includes(x.key) ? { ...x, fx: "" } : x)));

    for (const r of results) {
      if (dead(R)) return;
      const ln = r.lane;
      const k = keys[results.indexOf(r)];
      setObjState(LANES.map((l) => (l === ln ? "focus" : "dim")));
      const S = sideOfTeam;
      const yearKind = isYearKind(r.objective.kind);
      const info = (x) => (yearKind ? { year: x.year } : { ok: x.valid });
      setPlaques({
        [`${ln}-${S("a")}`]: info(r.a),
        [`${ln}-${S("b")}`]: info(r.b),
        target: r.objective.kind === "year" ? r.objective.year : null,
      });
      await sleep(yearKind ? 1250 : 750);
      if (dead(R)) return;
      if (r.fight) {
        await runFight(r, k, R);
        if (dead(R)) return;
      }
      const wiped = ["a", "b"].filter((t) => r.wiped?.[t]).map(S);
      if (wiped.length) {
        setStamps(Object.fromEntries(wiped.map((s) => [`${ln}-${s}`, true])));
        playBattleWipe();
        await sleep(520);
        if (dead(R)) return;
        for (const s of wiped) setFx(k[s], s === "you" ? "wipe-d" : "wipe-u");
      }
      const winner = r.winner ? S(r.winner) : null;
      const loser = winner ? (winner === "you" ? "bot" : "you") : null;
      if (winner) {
        setCrown({ lane: ln, side: winner });
        setFx(k[winner], "win");
        playBattlePoint(winner === "you");
      }
      if (loser && !wiped.includes(loser)) {
        await sleep(250);
        shatter(k[loser], ln, loser);
      }
      await sleep(760);
      if (dead(R)) return;
      if (winner) {
        const sc = rel(r.score);
        flyOrb(ln, winner, sc[winner] - 1);
        await sleep(620);
        setScore(sc);
      }
      await sleep(300);
      setPlaques({});
      setStamps({});
      setCrown(null);
    }
    if (dead(R)) return;
    // Les gagnantes rentrent en main, les autres s'en vont.
    const back = new Set(
      results.filter((r) => r.winner).map((r) => slotPiece(r[r.winner].seat)?.key).filter(Boolean)
    );
    await sleep(250);
    await settle(state, back, R);
  }

  async function settle(v, back, R) {
    viewRef.current = v;
    setPlaques({});
    setStamps({});
    setCrown(null);
    setHp(null);
    setObjState(["off", "off"]);
    setPlaced({});
    mutate((ps) =>
      ps
        .filter((p) => p.zone !== "slot" || back.has(p.key))
        .map((p) => (p.zone === "slot" ? { ...p, zone: "hand", down: p.seat !== seat, fx: "" } : p))
    );
    setBursts([]);
    await sleep(560);
    if (dead(R)) return;
    setObjs([null, null]);
    if (v.end) return finish(v);
    await beginRound(v, R);
  }

  function finish(v) {
    setPhase("end");
    setOppWait(false);
    setTimer(null);
    setScore(v.end.score || rel(v.score));
    if (v.end.winner === "you") playBattleVictory();
    else if (v.end.winner === "bot") playBattleDefeat();
    else playBattleDraw();
    setEnd(v.end);
    if (v.end.balance != null) onBalance?.(v.end.balance);
  }

  // --- le lancement -------------------------------------------------------------------
  useEffect(() => {
    primeBattleSounds();
    const R = ++life.current.run;
    const timers = life.current.timers;
    piecesRef.current = [];
    setPieces([]);
    (async () => {
      const v = initial;
      if (v.end) {
        await syncHands(v, R, true);
        finish(v);
        return;
      }
      if (!resumed) {
        setIntro("in");
        await sleep(380);
        if (dead(R)) return;
        playBattleVs();
        await sleep(1450);
        if (dead(R)) return;
        setIntro("out");
        await sleep(380);
        if (dead(R)) return;
        setIntro(null);
      } else await syncHands(v, R, true);
      if (!v.round) return;
      await beginRound(v, R);
    })();
    return () => {
      life.current.run++;
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
    // Une seule fois par partie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Les cartes des autres arrivent ; quelqu'un part (un bot le remplace) ; la
  // partie s'arrête net (annulée).
  useEffect(() => {
    const offPick = drv.on("picked", ({ n, seat: s, lane: ln }) => {
      const buf = pickBuf.current;
      if (!buf.has(n)) buf.set(n, []);
      buf.get(n).push([s, ln]);
      if (viewRef.current?.round?.n !== n || phaseRef.current === "end") return;
      placeOther(s, ln, phaseRef.current !== "pick" && phaseRef.current !== "wait");
    });
    const offPlayers = drv.on("players", (pl) => setPlayers(pl));
    const offEnd = drv.on("end", (v) => {
      if (phaseRef.current === "end") return;
      life.current.run++;
      for (const t of life.current.timers) clearTimeout(t);
      life.current.timers.clear();
      setFlash(null);
      setBanner(null);
      setObjs([null, null]);
      setObjState(["off", "off"]);
      viewRef.current = v;
      finish(v);
    });
    return () => {
      offPick();
      offPlayers();
      offEnd();
    };
    // Le pilote est fixe pour la partie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drv]);

  useEffect(() => {
    if (!timer || timer.stopped) return;
    const endAt = timer.at + timer.ms;
    let last = null;
    const iv = setInterval(() => {
      const left = Math.ceil((endAt - Date.now()) / 1000);
      if (left <= 5 && left >= 1 && left !== last) {
        last = left;
        playBattleTick();
      }
    }, 150);
    return () => clearInterval(iv);
  }, [timer]);

  // --- choisir ----------------------------------------------------------------------
  const choosing = () => phaseRef.current === "pick";
  function pickLane(l) {
    if (!choosing() || mateLaneRef.current === l) return;
    setLane(l);
  }
  function moveFocus(delta) {
    const n = myHand().length;
    if (!n) return;
    setFocus(Math.max(0, Math.min(n - 1, focusRef.current + delta)));
  }
  function actFocused() {
    const p = myHand()[focusRef.current];
    if (p) play(p);
  }
  function onDown(e, p) {
    if (!choosing()) return;
    drag.current = { x: e.clientX, key: p?.key || null };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onUp(e) {
    const d = drag.current;
    drag.current = null;
    if (!d || !choosing()) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 34) {
      if (peekRef.current) moveFocus(dx < 0 ? 1 : -1);
      return;
    }
    if (!d.key) {
      setPeek(false);
      return;
    }
    const hand = myHand();
    const idx = hand.findIndex((x) => x.key === d.key);
    if (idx < 0) return;
    if (!peekRef.current || idx !== focusRef.current) {
      setFocus(idx);
      setPeek(true);
    } else play(hand[idx]);
  }

  // Clavier : ← → les cartes, ↑ ↓ (ou 1 / 2) la voie, Entrée pour jouer.
  useEffect(() => {
    const on = (e) => {
      if (e.key === "Escape") {
        if (end) onExit();
        else setConfirmQuit((c) => !c);
        return;
      }
      if (!choosing() || confirmQuit) return;
      const t = e.target;
      if (t?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setKbd(true);
        setPeek(true);
        moveFocus(e.key === "ArrowLeft" ? -1 : 1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        pickLane(1 - laneRef.current);
      } else if (e.key === "1" || e.key === "2") {
        pickLane(Number(e.key) - 1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        actFocused();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  async function quit() {
    setConfirmQuit(false);
    life.current.run++;
    try {
      await drv.quit();
    } catch {
      /* partie déjà close */
    }
    onExit();
  }

  function toggleMute() {
    const m = !muted;
    setSfxMuted(m);
    setMuted(m);
  }

  // --- rendu -------------------------------------------------------------------------
  const hands = { 0: [], 1: [], 2: [], 3: [] };
  for (const p of pieces) if (p.zone === "hand") hands[p.seat].push(p.key);
  const zoom = phase === "pick";
  const cw = lay.cw;
  const ch = lay.ch;
  const B = lay.base;
  const toWin = initial.toWin || 5;
  const nHand = hands[seat].length;
  const level = initial.level;
  const face = (s, cls = "") => (
    <span className={`ba-ava ${cls}`} key={s}>
      <SeatFace pl={players[s]} me={me} level={level} isMe={s === seat} />
    </span>
  );
  const myLane = mateLane != null ? 1 - mateLane : lane;
  // Qui a posé sur quelle voie (pour le bandeau et les cases).
  const onLane = (ln, side) =>
    Object.entries(placed)
      .filter(([s, l]) => l === ln && sideOf(Number(s)) === side)
      .map(([s]) => Number(s));

  const hud = (side) => {
    const ss = side === "you" ? [seat, mate] : foes;
    return (
      <div className={`ba-side ${side}`}>
        <span className="tm-avas">{ss.map((s) => face(s))}</span>
        <span className="ba-who">
          <b>{ss.map((s) => seatName(players[s], me, s === seat)).join(" · ")}</b>
        </span>
        <span className="ba-pips">
          {Array.from({ length: toWin }, (_, i) => (
            <i
              key={i}
              ref={(el) => {
                pipRefs.current[side][i] = el;
              }}
              className={i < (score[side] || 0) ? "on" : ""}
            />
          ))}
        </span>
      </div>
    );
  };

  return createPortal(
    <div
      className={`ba tm ${lay.wide ? "wide" : "narrow"} ph-${phase} ${zoom ? "zooming" : ""}`}
      style={{ "--cw": `${cw}px`, "--ch": `${ch}px`, "--bw": `${B}px` }}
    >
      <div className={`ba-shake ${shake ? `shake-${shake % 2}` : ""}`}>
        <header className="ba-hud">
          <button className="ba-icon clickable" onClick={() => (end ? onExit() : setConfirmQuit(true))} title="Quitter">
            <X />
          </button>
          {hud("you")}
          <span className="ba-hud-vs">VS</span>
          {hud("bot")}
          <button className="ba-icon clickable" onClick={toggleMute} title={muted ? "Son coupé" : "Son"}>
            {muted ? <VolumeX /> : <Volume2 />}
          </button>
        </header>

        <div className="ba-stage">
          <div
            className="ba-board tm-board"
            style={{ transform: `translate(${lay.board.x}px, ${lay.board.y}px)`, width: lay.board.w, height: lay.board.h }}
          >
            <i className="ba-board-line" />
            <i className="tm-split" />
          </div>

          {/* les deux voies : deux cases (l'autre équipe en haut) et l'objectif */}
          {LANES.map((ln) => (
            <div key={ln}>
              {["you", "bot"].map((s) => {
                const at = lay.lanes[ln][s];
                const lit = objState[ln] === "lit" && (phase === "pick" || phase === "wait") && !onLane(ln, s).length;
                return (
                  <div
                    key={s}
                    className={`ba-slot ${s} ${lit ? "lit" : ""}`}
                    style={{ transform: `translate(${at.x - cw / 2}px, ${at.y - ch / 2}px)`, width: cw, height: ch }}
                  >
                    <span className="ba-slot-mark tm-lane-mark">{ln === 0 ? <ChevronLeft /> : <ChevronRight />}</span>
                  </div>
                );
              })}
              <div
                className={`ba-obj tm-obj o-${objState[ln] === "dim" ? "off" : objState[ln]} ${
                  objState[ln] === "dim" ? "dim" : ""
                } ${flash && flash.lane == null ? "o-flash" : ""}`}
                style={{
                  transform: `translate(${lay.lanes[ln].obj.x - lay.lanes[ln].obj.w / 2}px, ${lay.lanes[ln].obj.y - lay.lanes[ln].obj.h / 2}px)`,
                  width: lay.lanes[ln].obj.w,
                  height: lay.lanes[ln].obj.h,
                }}
              >
                {objs[ln] && (
                  <div className="ba-obj-in" key={objs[ln].key + (viewRef.current?.n || "")}>
                    <ObjectiveFace o={objs[ln]} />
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* à qui sont les mains des autres */}
          {[mate, ...foes].map((s) => {
            const a = lay.stacks[pos[s]];
            const dx = pos[s] === "mate" ? lay.fanW / 2 + 16 : pos[s] === "foeL" ? -(lay.fanW / 2 + 18) : lay.fanW / 2 + 18;
            return (
              <div
                key={s}
                className={`tm-seat ${sideOf(s)} ${pos[s]}`}
                style={{ transform: `translate(${a.x + (pos[s] === "mate" && !lay.wide ? 0 : dx)}px, ${a.y + (pos[s] === "mate" && !lay.wide ? -lay.bh / 2 - 16 : 0)}px)` }}
                title={seatName(players[s], me, false)}
              >
                {face(s, "tm-seat-ava")}
              </div>
            );
          })}

          {pieces.map((p) => {
            const at = place(p, lay, hands, zoom, focus, peek, seat, pos);
            const mine = p.seat === seat && p.zone === "hand";
            const pickable = zoom && mine;
            const focused = zoom && mine && hands[seat].indexOf(p.key) === focus && (lay.wide || peek);
            const side = p.zone === "slot" ? sideOf(p.seat) : p.side;
            return (
              <div
                key={p.key}
                className={`ba-card ${side} z-${p.zone} ${zoom && mine ? "zoomed" : ""} ${pickable ? "pickable" : ""} ${
                  focused ? "focused" : ""
                } ${zoom && mine && !lay.wide && peek && !focused ? "under" : ""} ${focused && kbd ? "kf" : ""} ${at.far ? "far" : ""} ${
                  p.fx ? `fx-${p.fx}` : ""
                }`}
                style={{
                  width: B,
                  height: B * RATIO,
                  marginLeft: -B / 2,
                  marginTop: (-B * RATIO) / 2,
                  transform: `translate(${at.x}px, ${at.y}px) rotate(${at.r}deg) scale(${at.s})`,
                  zIndex: at.z,
                  "--lx": `${lay.lunge[side]?.x || 0}px`,
                  "--ly": `${lay.lunge[side]?.y || 0}px`,
                }}
                onClick={pickable && lay.wide ? () => play(p) : undefined}
                onPointerDown={pickable && !lay.wide ? (e) => onDown(e, p) : undefined}
                onPointerUp={pickable && !lay.wide ? onUp : undefined}
              >
                <div className="ba-lift">
                  <div className="ba-fx">
                    <TcgCard
                      card={p.card}
                      faceDown={p.down}
                      tilt={(p.zone === "slot" && !p.down && hoverable) || (zoom && mine && hoverable)}
                      eager
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {/* ce qui s'accroche aux quatre cases */}
          {LANES.flatMap((ln) =>
            ["you", "bot"].map((s) => {
              const at = lay.lanes[ln][s];
              const pl = plaques[`${ln}-${s}`];
              const who = onLane(ln, s)[0];
              const edge = s === "you" ? ch / 2 : -ch / 2;
              return (
                <div key={`${ln}${s}`} className={`ba-anchor ${s}`} style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
                  {who != null && who !== seat && phase !== "pick" && (
                    <span
                      className={`tm-owner ${s}`}
                      style={{ transform: `translate(${-cw / 2}px, ${-ch / 2}px) translate(-35%, -35%)` }}
                      title={seatName(players[who], me, false)}
                    >
                      <SeatFace pl={players[who]} me={me} isMe={false} />
                    </span>
                  )}
                  {hp?.lane === ln && (
                    <div className="ba-hp" style={{ transform: `translate(-50%, ${-edge}px) translateY(-50%)` }}>
                      <i
                        className={hp[s].hp / hp[s].max < 0.3 ? "low" : hp[s].hp / hp[s].max < 0.6 ? "mid" : ""}
                        style={{ "--p": Math.max(0, hp[s].hp / hp[s].max) }}
                      />
                      <b>{hp[s].hp}</b>
                    </div>
                  )}
                  {pl && (
                    <div className="ba-plaque-at" style={{ transform: `translate(-50%, ${edge}px) translateY(-50%)` }}>
                      {"year" in pl ? (
                        <YearRoll year={pl.year} target={plaques.target} />
                      ) : (
                        <span className={`ba-plaque check ${pl.ok ? "ok" : "ko"}`}>{pl.ok ? <Check /> : <X />}</span>
                      )}
                    </div>
                  )}
                  {stamps[`${ln}-${s}`] && <div className="ba-stamp">Hors sujet</div>}
                  {crown?.lane === ln && crown.side === s && (
                    <span className="ba-crown" style={{ transform: `translate(-50%, ${-ch / 2 - 2}px) translateY(-100%)` }}>
                      <Crown />
                    </span>
                  )}
                  {banner?.lane === ln && banner.side === s && (
                    <div className="ba-banner" key={banner.k} style={{ "--tc": TYPES[banner.type]?.color }}>
                      <TypeBadge type={banner.type} className="mini" />
                      <span>{banner.name}</span>
                    </div>
                  )}
                  {pops
                    .filter((x) => x.lane === ln && x.side === s)
                    .map((x) => (
                      <div key={x.id} className={`ba-pop ${x.mult >= 1.5 ? "super" : x.mult < 1 ? "weak" : ""}`}>
                        <b>-{x.dmg}</b>
                        {x.mult !== 1 && <em>×{String(x.mult).replace(".", ",")}</em>}
                      </div>
                    ))}
                  {rings
                    .filter((x) => x.lane === ln && x.side === s)
                    .map((x) => (
                      <i key={x.id} className={`ba-ring ${s}`} />
                    ))}
                  {bursts
                    .filter((b) => b.lane === ln && b.side === s)
                    .map((b) => (
                      <span key={b.id} className="ba-burst">
                        <Burst colors={b.colors} count={22} spread={Math.round(cw * 0.95)} />
                      </span>
                    ))}
                </div>
              );
            })
          )}

          {orb && (
            <i
              className={`ba-orb ${orb.side}`}
              style={{ transform: `translate(${orb.go ? orb.to.x : orb.from.x}px, ${orb.go ? orb.to.y : orb.from.y}px)` }}
            />
          )}

          {flash && (
            <div
              className={`ba-flash ${flash.small ? "small" : ""} ${flash.lane != null ? "tm-lane-flash" : ""}`}
              key={flash.k}
              style={{ transform: `translate(${flash.lane != null ? lay.lanes[flash.lane].x : 0}px, ${lay.aMid}px)` }}
            >
              <span>{flash.text}</span>
            </div>
          )}

          {oppWait && !end && (
            <div className="ba-think tm-wait" style={{ transform: `translate(-50%, ${lay.aMid}px) translateY(-50%)` }}>
              <span>Prêts ?</span>
              <i className="ba-think-dots">
                <i />
                <i />
                <i />
              </i>
            </div>
          )}

          {zoom && !lay.wide && peek && nHand > 1 && (
            <div className="ba-dots" style={{ transform: `translate(-50%, ${lay.dotsY}px)` }}>
              {hands[seat].map((k, i) => (
                <i key={k} className={i === focus ? "on" : ""} />
              ))}
            </div>
          )}
          {zoom && !lay.wide && peek && (
            <button className="ba-go clickable tm-go" style={{ transform: `translate(-50%, ${lay.dotsY + 20}px)` }} onClick={actFocused}>
              {myLane === 0 && <ChevronLeft />}
              Jouer
              {myLane === 1 && <ChevronRight />}
            </button>
          )}
        </div>

        {/* le choix : voile + les deux voies en bandeau */}
        {zoom && (
          <div
            className="ba-scrim"
            onPointerDown={!lay.wide ? (e) => onDown(e, null) : undefined}
            onPointerUp={!lay.wide ? onUp : undefined}
          />
        )}
        {zoom && objs[0] && (
          <div className="tm-focus" style={{ top: lay.bannerTop, height: lay.bannerH }}>
            {LANES.map((ln) => {
              const taken = mateLane === ln;
              const sel = myLane === ln;
              const foesHere = onLane(ln, "bot");
              return (
                <button
                  key={ln}
                  className={`tm-lane clickable ${sel ? "sel" : ""} ${taken ? "taken" : ""}`}
                  onClick={() => pickLane(ln)}
                  disabled={taken}
                  title={taken ? `${seatName(players[mate], me, false)} joue ici` : ln === 0 ? "Voie de gauche" : "Voie de droite"}
                >
                  <span className="tm-lane-side">{ln === 0 ? <ChevronLeft /> : <ChevronRight />}</span>
                  <ObjectiveFace o={objs[ln]} />
                  <span className="tm-lane-who">
                    {taken && <span className="tm-dot you">{face(mate)}</span>}
                    {foesHere.map((s) => (
                      <span key={s} className="tm-dot bot">
                        {face(s)}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
            {timer && !timer.stopped && <i className="ba-timer" key={timer.key} style={{ animationDuration: `${timer.ms}ms` }} />}
          </div>
        )}

        {err && <div className="ba-err">{err}</div>}

        {intro && <TeamIntro me={me} players={players} seat={seat} level={level} stage={intro} />}

        {end && <BattleEnd end={end} onReplay={onReplay} onExit={onExit} replayLabel="Revanche" rematch={rematch} />}

        {confirmQuit && !end && (
          <div className="ba-confirm">
            <div className="ba-confirm-box">
              <b>Abandonner ?</b>
              <div className="ba-confirm-row">
                <button className="ba-btn ghost clickable" onClick={() => setConfirmQuit(false)}>
                  Continuer
                </button>
                <button className="ba-btn danger clickable" onClick={quit}>
                  Abandonner
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
