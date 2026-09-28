import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Crown, Check, Bot, Shield, ShieldCheck, Volume2, VolumeX, Hash } from "lucide-react";
import { useScrollLock } from "../../../hooks/useScrollLock";
import { TYPES, cardStats, cardCover } from "../../../lib/cards";
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
  playBattleRescue,
  playBattleVictory,
  playBattleDefeat,
} from "../../../lib/sfx";
import Burst from "../../Burst";
import TcgCard, { TypeBadge } from "../TcgCard";
import { ObjectiveIcon, isYearKind, other } from "./battleUi";
import BattleEnd from "./BattleEnd";
import { botDriver } from "./drivers";

// ======================================================================
//  L'arène : une partie contre le bot — ou contre un pote — plein écran
// ======================================================================
// Le serveur décide tout (objectif, choix du bot, verdict, combat) ; ce
// composant ne fait que METTRE EN SCÈNE. Il ne parle au serveur que par son
// « pilote » (drivers.js) : le bot répond aussitôt, un pote quand il a posé.
// Dans l'ordre :
//   face-à-face → distribution → la case s'allume → la main MONTE en grand
//   (on choisit comme si on approchait ses cartes du visage) → je pose face
//   cachée (le bot aussi) → on retourne → verdict (balayage, duel, éclats)
//   → point → sauvetage éventuel → manche suivante… → écran de fin.
//
// Toutes les cartes sont des « pièces » posées en absolu sur une scène
// centrée : main, main en grand, case du plateau, pioche. Changer la zone
// d'une pièce change sa position, et la transition CSS fait le vol. Chaque
// carte est DESSINÉE à la plus grande taille qu'elle prendra (le choix en
// grand) et réduite partout ailleurs : agrandie, elle serait floue.

const RATIO = 88 / 63;

function useArenaLayout() {
  const calc = () => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const wide = W >= 900 && W / H >= 1.1;
    const top = 60;
    const hw = wide
      ? Math.round(Math.min(150, Math.max(92, H * 0.17)))
      : Math.round(Math.min(140, Math.max(66, W * 0.24), H * 0.16));
    const bw = Math.round(Math.max(40, hw * (wide ? 0.55 : 0.52)));
    const hh = hw * RATIO;
    const bh = bw * RATIO;
    const handY = H / 2 - hh / 2 - (wide ? 30 : 16);
    const botY = -H / 2 + top + bh / 2 + 4;
    const aTop = botY + bh / 2 + 18;
    const aBot = handY - hh / 2 - 22;
    const aMid = (aTop + aBot) / 2;
    let cw;
    let slot;
    let obj;
    if (wide) {
      const objW = Math.round(Math.min(330, W * 0.25));
      cw = Math.round(Math.min(236, ((aBot - aTop) / RATIO) * 0.92, ((W - objW - 160) / 2) * 0.9));
      const dx = objW / 2 + 44 + cw / 2;
      slot = { you: { x: -dx, y: aMid }, bot: { x: dx, y: aMid } };
      obj = { x: 0, y: aMid, w: objW, h: 150 };
    } else {
      const objH = 66;
      const gap = 14;
      cw = Math.round(Math.min(210, W * 0.4, (aBot - aTop - objH - gap * 2 - 24) / 2 / RATIO));
      const ch = cw * RATIO;
      slot = {
        bot: { x: 0, y: aMid - objH / 2 - gap - ch / 2 },
        you: { x: 0, y: aMid + objH / 2 + gap + ch / 2 },
      };
      obj = { x: 0, y: aMid, w: Math.min(W - 40, 400), h: objH };
    }
    const ch = cw * RATIO;
    const board = wide
      ? {
          x: slot.you.x - cw / 2 - 30,
          y: aMid - ch / 2 - 26,
          w: (Math.abs(slot.you.x) + cw / 2 + 30) * 2,
          h: ch + 52,
        }
      : {
          x: -Math.min(W - 16, 440) / 2,
          y: slot.bot.y - ch / 2 - 14,
          w: Math.min(W - 16, 440),
          h: slot.you.y - slot.bot.y + ch + 28,
        };

    // Le choix en grand : le bandeau de l'objectif en haut, les cartes dessous.
    const bannerTop = top + (wide ? 14 : 8);
    const bannerH = wide ? 92 : 74;
    const zTop = bannerTop + bannerH + (wide ? 22 : 14);
    let zw;
    let zoomY;
    let dotsY = 0;
    if (wide) {
      zw = Math.round(Math.min(300, (W - 60) / 4.4, (H - zTop - 40) / RATIO));
      zoomY = zTop + (H - zTop - 30) / 2 - H / 2;
    } else {
      // Sous la carte : les points du carrousel et le bouton « Jouer ».
      const extra = 100;
      zw = Math.round(Math.min(300, W * 0.68, (H - zTop - extra - 16) / RATIO));
      const zh = zw * RATIO;
      const blockTop = zTop + Math.max(0, (H - zTop - 16 - (zh + extra)) / 2);
      zoomY = blockTop + zh / 2 - H / 2;
      dotsY = zoomY + zh / 2 + 26;
    }
    // Téléphone : toute la main d'un coup d'œil, en grille (3 + 2), sous le
    // bandeau. Toucher une carte la sort en grand (le carrousel ci-dessus).
    const grid = (n) => {
      if (wide || !n) return null;
      const cols = n <= 3 ? n : Math.ceil(n / 2);
      const rows = n <= 3 ? 1 : 2;
      const gap = 10;
      const gw = Math.floor(
        Math.min((W - 24 - gap * (cols - 1)) / cols, (H - zTop - 40 - gap * (rows - 1)) / rows / RATIO, zw)
      );
      const gh = gw * RATIO;
      const top = zTop + Math.max(0, (H - zTop - 24 - (rows * gh + (rows - 1) * gap)) / 2);
      return (i) => {
        const row = rows === 1 ? 0 : i < cols ? 0 : 1;
        const inRow = row === 0 ? Math.min(cols, n) : n - cols;
        const col = row === 0 ? i : i - cols;
        return {
          x: (col - (inRow - 1) / 2) * (gw + gap),
          y: top + row * (gh + gap) + gh / 2 - H / 2,
          w: gw,
        };
      };
    };
    const base = Math.max(cw, zw);
    // L'élan d'une attaque : un bon quart du chemin vers l'adversaire,
    // exprimé à l'échelle de la carte posée (réduite à cw/base).
    const k = base / cw;
    const lunge = {
      you: { x: (slot.bot.x - slot.you.x) * 0.26 * k, y: (slot.bot.y - slot.you.y) * 0.26 * k },
      bot: { x: (slot.you.x - slot.bot.x) * 0.26 * k, y: (slot.you.y - slot.bot.y) * 0.26 * k },
    };
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
      botY,
      slot,
      obj,
      board,
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

// La position d'une pièce selon sa zone (et le choix en grand).
function place(p, lay, hands, zoom, focus, peek) {
  const B = lay.base;
  if (p.zone === "slot") return { ...lay.slot[p.side], r: 0, s: lay.cw / B, z: 30 };
  if (p.zone === "deck") {
    return p.side === "you"
      ? { x: lay.W / 2 + lay.cw, y: lay.handY, r: 24, s: lay.hw / B, z: 5 }
      : { x: lay.W / 2 + lay.cw, y: lay.botY, r: -24, s: lay.bw / B, z: 5 };
  }
  const list = hands[p.side];
  const n = list.length;
  const i = list.indexOf(p.key);
  const off = i - (n - 1) / 2;
  if (p.side === "you" && zoom) {
    if (lay.wide) {
      const spread = Math.min(lay.zw * 1.03, (lay.W - 50 - lay.zw) / Math.max(1, n - 1));
      return { x: off * spread, y: lay.zoomY + off * off * 5, r: off * 2, s: lay.zw / B, z: 70 + i };
    }
    // Téléphone : toute la main en grille ; la carte touchée sort en grand
    // par-dessus (on glisse pour passer à la voisine, qui monte à son tour).
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
  if (p.side === "you") {
    const spread = Math.min(lay.hw * (lay.wide ? 0.95 : 0.8), (lay.W - 24 - lay.hw) / Math.max(1, n - 1));
    return { x: off * spread, y: lay.handY + off * off * 2.2, r: off * (lay.wide ? 2.4 : 3.2), s: lay.hw / B, z: 10 + i };
  }
  const spread = lay.bw * 0.72;
  return { x: off * spread, y: lay.botY - off * off * 2, r: -off * 3, s: lay.bw / B, z: 6 + i };
}

// L'année qui défile jusqu'à la vraie.
function YearRoll({ year, target }) {
  const [v, setV] = useState(year - 18);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const from = year - 18;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 850);
      const e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(from + (year - from) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
      else setDone(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [year]);
  const gap = target != null ? Math.abs(year - target) : null;
  return (
    <span className="ba-plaque year">
      <b>{v}</b>
      {done && gap != null && <em className={gap === 0 ? "bull" : ""}>{gap === 0 ? "PILE" : `±${gap}`}</em>}
    </span>
  );
}

function ObjectiveFace({ o, big = false }) {
  if (!o) return null;
  const len = o.label?.length || 0;
  return (
    <span className={`ba-objface ${big ? "big" : ""} ${len > 16 ? "long" : ""} ${len > 22 ? "xlong" : ""}`}>
      {o.kind === "type" ? (
        <TypeBadge type={o.type} className="ba-obj-type" />
      ) : (
        <span className="ba-obj-ico">
          <ObjectiveIcon o={o} />
        </span>
      )}
      <span className="ba-obj-label">{o.label}</span>
    </span>
  );
}

function Avatar({ me }) {
  return me?.avatar ? <img src={me.avatar} alt="" draggable="false" /> : <b>{(me?.username || "?")[0]}</b>;
}

// Le face-à-face, au lancement : moi à gauche, le bot (ou mon pote) à droite.
function VsIntro({ me, opp, level, stage }) {
  return (
    <div className={`ba-vs st-${stage}`}>
      <div className="ba-vs-side you">
        <span className="ba-vs-ava">
          <Avatar me={me} />
        </span>
        <b>{me?.username || "Moi"}</b>
      </div>
      <span className="ba-vs-x">VS</span>
      <div className="ba-vs-side bot">
        <span className="ba-vs-ava">
          {opp ? (
            <Avatar me={opp} />
          ) : (
            <>
              <Bot />
              <i className="ba-lvl">{level}</i>
            </>
          )}
        </span>
        <b>{opp ? opp.username : "Bot"}</b>
      </div>
    </div>
  );
}

export default function Arena({
  token,
  me,
  initial,
  resumed,
  onExit,
  onReplay,
  onBalance,
  driver = null,
  replayLabel,
  rematch = null,
}) {
  useScrollLock(true);
  // Le pilote : le bot par défaut. Contre un pote, c'est la page du duel qui
  // le fournit (et le garde pour toute la partie).
  const drv = useMemo(() => driver || botDriver(token), [driver, token]);
  const pvp = drv.mode === "pvp";
  const opp = drv.opponent;
  const lay = useArenaLayout();
  // Les déroulés (async) lisent la mise en page du moment, pas celle de leur départ.
  const layRef = useRef(lay);
  layRef.current = lay;
  const hoverable = useMemo(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches,
    []
  );

  const [pieces, setPieces] = useState([]);
  const piecesRef = useRef([]);
  const [phase, setPhaseState] = useState("intro");
  const phaseRef = useRef("intro");
  const [score, setScore] = useState(initial.score);
  const [curObj, setCurObj] = useState(null);
  const [objState, setObjState] = useState("off");
  const [timer, setTimer] = useState(null);
  const [focus, setFocusState] = useState(0);
  const focusRef = useRef(0);
  // Téléphone : une carte de la grille est sortie en grand.
  const [peek, setPeekState] = useState(false);
  const peekRef = useRef(false);
  const [kbd, setKbd] = useState(false);
  const [botIn, setBotIn] = useState(false);
  const [plaques, setPlaques] = useState({});
  const [stamps, setStamps] = useState({});
  const [crown, setCrown] = useState(null);
  const [hp, setHp] = useState(null);
  const [pops, setPops] = useState([]);
  const [banner, setBanner] = useState(null);
  const [bursts, setBursts] = useState([]);
  const [rings, setRings] = useState([]);
  const [flash, setFlash] = useState(null);
  const [shake, setShake] = useState(0);
  const [orb, setOrb] = useState(null);
  const [intro, setIntro] = useState(null);
  const [rescue, setRescue] = useState(null);
  const [botSave, setBotSave] = useState(null);
  const [end, setEnd] = useState(null);
  const [err, setErr] = useState("");
  const [confirmQuit, setConfirmQuit] = useState(false);
  // Contre un pote : j'attends qu'il soit prêt (avant le choix).
  const [oppWait, setOppWait] = useState(false);
  const [muted, setMuted] = useState(isSfxMuted);
  const pipRefs = useRef({ you: [], bot: [] });
  const drag = useRef(null);

  const viewRef = useRef(initial);
  const slotKey = useRef({ you: null, bot: null });
  const botPlaced = useRef(false);
  const doomed = useRef(new Set());
  const seq = useRef(0);
  const botSeq = useRef(0);
  // ⚠️ UN NUMÉRO PAR PHASE DE CHOIX. Le chrono d'une manche (« temps écoulé :
  // une carte au hasard ») n'est pas annulé quand on joue vite : il continuait
  // de courir et tombait en pleine manche SUIVANTE, où il posait une carte tout
  // seul au bout de quelques secondes. Chaque minuteur retient le numéro de
  // SA phase et ne fait rien si une autre a commencé depuis.
  const pickSeq = useRef(0);
  // Chaque déroulé porte le numéro de « vie » du composant : démonté (ou
  // remonté par le mode strict), les étapes en vol s'arrêtent d'elles-mêmes.
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
  const myHand = () => piecesRef.current.filter((p) => p.side === "you" && p.zone === "hand");
  // L'onde de choc d'une carte qui claque sur sa case (après son vol).
  const ring = (side, delay = 380) =>
    later(() => {
      const id = nextId();
      setRings((r) => [...r, { id, side }]);
      later(() => setRings((r) => r.filter((x) => x.id !== id)), 700);
    }, delay);

  // --- les mains : ajouter les cartes piochées (depuis la pioche) ------------
  async function syncHands(v, R, instant = false) {
    const cur = piecesRef.current;
    const mineIds = cur.filter((p) => p.side === "you" && p.zone === "hand").map((p) => p.cardId);
    const add = v.hand.filter((c) => !mineIds.includes(c.id));
    const botHave = cur.filter((p) => p.side === "bot" && p.zone === "hand").length;
    const botAdd = Math.max(0, v.bot.hand - botHave);
    const fresh = [];
    // Ce que le serveur n'a plus en main s'efface (il a toujours raison).
    const keep = new Set(v.hand.map((c) => c.id));
    let extraBot = Math.max(0, botHave - v.bot.hand);
    const next = cur.filter((p) => {
      if (p.zone !== "hand") return true;
      if (p.side === "you") return keep.has(p.cardId);
      if (extraBot > 0) {
        extraBot--;
        return false;
      }
      return true;
    });
    for (const c of add) {
      const key = `y${c.id}`;
      next.push({ key, side: "you", cardId: c.id, card: c, zone: instant ? "hand" : "deck", down: false, fx: "" });
      fresh.push(key);
    }
    for (let i = 0; i < botAdd; i++) {
      const key = `b${++botSeq.current}`;
      next.push({ key, side: "bot", card: null, zone: instant ? "hand" : "deck", down: true, fx: "" });
      fresh.push(key);
    }
    mutate(() => next);
    if (instant || !fresh.length) return;
    await sleep(60);
    for (let i = 0; i < fresh.length; i++) {
      if (dead(R)) return;
      const k = fresh[i];
      mutate((ps) => ps.map((p) => (p.key === k ? { ...p, zone: "hand" } : p)));
      if (k.startsWith("y")) playCardDeal(i);
      await sleep(k.startsWith("y") ? 95 : 55);
    }
    await sleep(350);
  }

  // --- une manche commence -----------------------------------------------------
  async function beginRound(v, R) {
    viewRef.current = v;
    setScore(v.score);
    // Contre un pote : je me dis prêt dès maintenant — l'attente se fond dans
    // la distribution et l'annonce de la manche.
    const n = v.round.n;
    const goAt = { t: 0, left: null };
    const go = pvp
      ? drv.ready(n).then((g) => {
          goAt.t = g?.at || Date.now();
          goAt.left = g?.left ?? null;
        })
      : null;
    await syncHands(v, R);
    if (dead(R)) return;
    // L'annonceur : « Manche 2 ».
    setFlash({ text: `Manche ${v.n}`, k: nextId(), small: true });
    await sleep(760);
    if (dead(R)) return;
    setFlash(null);
    const o = v.round.objective;
    setCurObj(o);
    setObjState("in");
    playBattleObjective();
    await sleep(700);
    if (dead(R)) return;
    setObjState("lit");
    botPlaced.current = false;
    setBotIn(false);
    slotKey.current = { you: null, bot: null };
    let ms = v.round.ms;
    if (pvp) {
      if (!goAt.t) setOppWait(true);
      await go;
      setOppWait(false);
      if (dead(R)) return;
      // Le chrono est celui du SERVEUR : ce qu'il restait au « go » (moins
      // l'annonce de la manche). Arrivé en retard, on voit le vrai temps qui
      // reste — et non 15 s pleines que le serveur couperait avant la fin.
      const left = goAt.left ?? ms;
      ms = Math.max(3000, Math.min(ms, left - (Date.now() - goAt.t)));
      // Reprise : ma carte était déjà posée.
      if (v.round.mine != null) {
        const p = myHand().find((x) => x.cardId === v.round.mine);
        if (p) {
          setPhase("pick");
          if (v.round.his || drv.picked(n)) placeBot(R);
          play(p);
          return;
        }
      }
    }
    // La main monte en grand, centrée sur la carte du milieu.
    setFocus(Math.floor((myHand().length - 1) / 2));
    setPeek(false);
    setTimer({ ms, key: `${v.id}-${n}`, at: Date.now() });
    setPhase("pick");
    const mine = ++pickSeq.current;
    const still = () => !dead(R) && pickSeq.current === mine;
    playBattleFan();
    if (pvp) {
      // Mon pote a peut-être déjà posé pendant l'annonce.
      if (v.round.his || drv.picked(n)) placeBot(R);
    } else {
      // Le bot pose sa carte quand il a « réfléchi ».
      later(() => still() && placeBot(R), 1300 + Math.random() * Math.min(5200, ms - 4000));
    }
    // Le temps est écoulé (pour CETTE manche) : une carte au hasard part pour moi.
    later(() => {
      if (!still() || phaseRef.current !== "pick") return;
      const hand = myHand();
      if (hand.length) play(hand[Math.floor(Math.random() * hand.length)]);
    }, ms);
  }

  function placeBot(R) {
    if (dead(R) || botPlaced.current) return;
    const hand = piecesRef.current.filter((p) => p.side === "bot" && p.zone === "hand");
    if (!hand.length) return;
    const p = hand[Math.floor(hand.length / 2)];
    botPlaced.current = true;
    setBotIn(true);
    slotKey.current.bot = p.key;
    mutate((ps) => ps.map((x) => (x.key === p.key ? { ...x, zone: "slot", down: true } : x)));
    playBattleSlam(true);
    ring("bot");
  }

  // --- je pose une carte ------------------------------------------------------
  async function play(p) {
    if (phaseRef.current !== "pick") return;
    const R = life.current.run;
    setPhase("wait");
    setTimer((t) => (t ? { ...t, stopped: true } : t));
    slotKey.current.you = p.key;
    mutate((ps) => ps.map((x) => (x.key === p.key ? { ...x, zone: "slot", down: true } : x)));
    playBattleSlam();
    ring("you", 520);
    let res;
    try {
      res = await drv.play(viewRef.current, p.cardId);
    } catch (e) {
      if (dead(R)) return;
      setErr(e.message);
      mutate((ps) => ps.map((x) => (x.key === p.key ? { ...x, zone: "hand", down: false } : x)));
      slotKey.current.you = null;
      setTimer((t) => (t ? { ...t, stopped: false } : t));
      setPhase("pick");
      return;
    }
    if (dead(R)) return;
    setErr("");
    if (!botPlaced.current) {
      placeBot(R);
      await sleep(650);
    }
    await sleep(350);
    if (dead(R)) return;
    await resolveRound(res.result, res.state, R);
  }

  function shatter(side) {
    const key = slotKey.current[side];
    if (!key) return;
    const card = piecesRef.current.find((p) => p.key === key)?.card;
    const st = card ? cardStats(card) : null;
    const colors = st
      ? [TYPES[st.types[0]]?.color || "#fff", TYPES[st.types[1] || st.types[0]]?.color || "#fff", "#ffffff"]
      : ["#ffffff"];
    doomed.current.add(key);
    setFx(key, "shatter");
    setBursts((b) => [...b, { id: nextId(), side, colors }]);
    playBattleShatter();
    setShake((s) => s + 1);
  }

  // Le point vole de la case gagnante jusqu'à sa pastille, en haut.
  function flyOrb(side, idx) {
    const L = layRef.current;
    const el = pipRefs.current[side]?.[Math.max(0, idx)];
    const from = L.slot[side];
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

  // --- le duel ------------------------------------------------------------------
  async function runFight(r, R) {
    const f = r.fight;
    setFlash({ text: "DUEL", k: nextId() });
    playBattleDuel();
    await sleep(850);
    if (dead(R)) return;
    setFlash(null);
    setHp({ you: { hp: f.hp0.you, max: f.hp0.you }, bot: { hp: f.hp0.bot, max: f.hp0.bot } });
    await sleep(380);
    for (const h of f.log) {
      if (dead(R)) return;
      const att = h.by;
      const def = other(att);
      const card = att === "you" ? r.you.card : r.bot.card;
      const move = cardStats(card).moves[h.move];
      setBanner({ side: att, name: move?.name || "", type: h.type, k: nextId() });
      setFx(slotKey.current[att], "lunge");
      await sleep(210);
      if (dead(R)) return;
      setFx(slotKey.current[def], "hit");
      playBattleHit(h.mult);
      if (h.mult >= 2) setShake((s) => s + 1);
      const pid = nextId();
      setPops((ps) => [...ps, { id: pid, side: def, dmg: h.dmg, mult: h.mult }]);
      later(() => setPops((ps) => ps.filter((x) => x.id !== pid)), 1300);
      setHp((cur) => (cur ? { ...cur, [def]: { ...cur[def], hp: h.hp[def] } } : cur));
      await sleep(620);
      setFx(slotKey.current[att], "");
      setFx(slotKey.current[def], "");
      await sleep(140);
    }
    setBanner(null);
    setFlash({ text: f.tech ? "K.O. technique" : "K.O.", k: nextId() });
    await sleep(700);
    setFlash(null);
  }

  // --- on retourne, et le verdict ------------------------------------------------
  async function resolveRound(r, nextIn, R) {
    let next = nextIn;
    const yk = slotKey.current.you;
    const bk = slotKey.current.bot;
    mutate((ps) =>
      ps.map((x) => (x.key === yk ? { ...x, card: r.you.card } : x.key === bk ? { ...x, card: r.bot.card } : x))
    );
    setTimer(null);
    setObjState("focus");
    await sleep(560);
    if (dead(R)) return;
    mutate((ps) => ps.map((x) => (x.key === yk || x.key === bk ? { ...x, down: false, fx: "rise" } : x)));
    playBattleFlip();
    await sleep(700);
    if (dead(R)) return;
    mutate((ps) => ps.map((x) => (x.key === yk || x.key === bk ? { ...x, fx: "" } : x)));

    const yearKind = isYearKind(r.objective.kind);
    setPlaques({
      you: yearKind ? { year: r.you.year } : { ok: r.you.valid },
      bot: yearKind ? { year: r.bot.year } : { ok: r.bot.valid },
      target: r.objective.kind === "year" ? r.objective.year : null,
    });
    await sleep(yearKind ? 1250 : 750);
    if (dead(R)) return;

    if (r.fight) {
      await runFight(r, R);
      if (dead(R)) return;
    }

    const wipedSides = ["you", "bot"].filter((s) => r.wiped?.[s]);
    if (wipedSides.length) {
      setStamps(Object.fromEntries(wipedSides.map((s) => [s, true])));
      playBattleWipe();
      await sleep(520);
      if (dead(R)) return;
      for (const s of wipedSides) {
        doomed.current.add(slotKey.current[s]);
        const wide = layRef.current.wide;
        setFx(slotKey.current[s], wide ? (s === "you" ? "wipe-l" : "wipe-r") : s === "you" ? "wipe-d" : "wipe-u");
      }
    }

    const winner = r.winner;
    const loser = winner ? other(winner) : null;
    const mineInDanger = !!next.pending && loser === "you";
    if (winner) {
      setCrown(winner);
      setFx(slotKey.current[winner], "win");
      playBattlePoint(winner === "you");
    }
    if (loser && !r.wiped?.[loser]) {
      if (loser === "bot" && pvp && next.danger) {
        // Mon pote tente de sauver sa carte : on attend sa réponse.
        setBotSave({ ask: next.danger.ask, state: "try" });
        setFx(slotKey.current.bot, "danger");
        const t0 = Date.now();
        const out = await drv.oppRescue(r.n);
        if (dead(R)) return;
        await sleep(Math.max(0, 1100 - (Date.now() - t0)));
        if (dead(R)) return;
        next = out.state;
        if (out.rescue?.saved) {
          setBotSave((b) => b && { ...b, state: "ok" });
          setFx(slotKey.current.bot, "shield");
          playBattleRescue(true);
        } else {
          setBotSave((b) => b && { ...b, state: "fail" });
          playBattleRescue(false);
          await sleep(250);
          shatter("bot");
        }
      } else if (loser === "bot" && r.botRescue) {
        setBotSave({ ask: r.botRescue.ask, state: "try" });
        setFx(slotKey.current.bot, "danger");
        await sleep(1100);
        if (dead(R)) return;
        if (r.botRescue.saved) {
          setBotSave((b) => b && { ...b, state: "ok" });
          setFx(slotKey.current.bot, "shield");
          playBattleRescue(true);
        } else {
          setBotSave((b) => b && { ...b, state: "fail" });
          playBattleRescue(false);
          await sleep(250);
          shatter("bot");
        }
      } else if (mineInDanger) {
        setFx(slotKey.current.you, "danger");
      } else {
        await sleep(250);
        shatter(loser);
      }
    }
    await sleep(800);
    if (dead(R)) return;
    if (winner) {
      flyOrb(winner, (r.score?.[winner] || 1) - 1);
      await sleep(620);
      setScore(r.score);
    }
    if (mineInDanger) {
      startRescue(next, R);
      return;
    }
    await sleep(350);
    await settle(next, R);
  }

  // --- le sauvetage -------------------------------------------------------------
  // Même geste que le choix : la main monte en grand, le bandeau dit quel tag
  // montrer, et rappelle la carte en danger.
  function startRescue(v, R) {
    viewRef.current = v;
    setCurObj(null);
    setObjState("off");
    setCrown(null);
    setPlaques({});
    setHp(null);
    const p = v.pending;
    setFocus(Math.floor((myHand().length - 1) / 2));
    setPeek(false);
    setRescue({ ask: p.ask, card: p.card, ms: p.ms, key: nextId(), state: "ask" });
    setPhase("rescue");
    const mine = ++pickSeq.current;
    playBattleFan();
    later(() => {
      if (!dead(R) && pickSeq.current === mine && phaseRef.current === "rescue") rescuePick(null);
    }, p.ms);
  }

  async function rescuePick(piece) {
    if (phaseRef.current !== "rescue") return;
    const R = life.current.run;
    // La main redescend et le voile s'en va AVANT le verdict : c'est sur le
    // plateau que la carte en danger est sauvée ou vole en éclats.
    setPhase("wait");
    const t0 = Date.now();
    if (piece) setFx(piece.key, "probe");
    let res;
    try {
      res = await drv.rescue(viewRef.current, piece ? piece.cardId : null);
    } catch (e) {
      if (dead(R)) return;
      setErr(e.message);
      if (piece) setFx(piece.key, "");
      setPhase("rescue");
      return;
    }
    if (dead(R)) return;
    await sleep(Math.max(0, 620 - (Date.now() - t0)));
    if (dead(R)) return;
    const ok = res.rescue.saved;
    setRescue((x) => x && { ...x, state: ok ? "ok" : "fail" });
    if (ok) {
      playBattleRescue(true);
      if (piece) setFx(piece.key, "good");
      setFx(slotKey.current.you, "shield");
    } else {
      playBattleRescue(false);
      if (piece) setFx(piece.key, "bad");
      const right = new Set(res.rescue.answers || []);
      mutate((ps) =>
        ps.map((x) => (x.side === "you" && x.zone === "hand" && right.has(x.cardId) ? { ...x, fx: "answer" } : x))
      );
      await sleep(450);
      shatter("you");
    }
    await sleep(1400);
    if (dead(R)) return;
    mutate((ps) => ps.map((x) => (x.side === "you" && x.zone === "hand" ? { ...x, fx: "" } : x)));
    setRescue(null);
    await settle(res.state, R);
  }

  // --- fin de manche : on range ---------------------------------------------------
  async function settle(v, R) {
    viewRef.current = v;
    setCrown(null);
    setPlaques({});
    setStamps({});
    setHp(null);
    setBotSave(null);
    setObjState("off");
    const gone = doomed.current;
    mutate((ps) =>
      ps
        .filter((p) => !gone.has(p.key))
        .map((p) => (p.zone === "slot" ? { ...p, zone: "hand", down: p.side === "bot", fx: "" } : p))
    );
    doomed.current = new Set();
    slotKey.current = { you: null, bot: null };
    setBursts([]);
    await sleep(560);
    if (dead(R)) return;
    setCurObj(null);
    if (v.end) return finish(v);
    await beginRound(v, R);
  }

  function finish(v) {
    setPhase("end");
    setOppWait(false);
    setTimer(null);
    setScore(v.end.score || v.score);
    if (v.end.winner === "you") playBattleVictory();
    else if (v.end.winner === "bot") playBattleDefeat();
    else playBattleDraw();
    setEnd(v.end);
    if (v.end.balance != null) onBalance?.(v.end.balance);
  }

  // --- le lancement ---------------------------------------------------------------
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
        await sleep(1250);
        if (dead(R)) return;
        setIntro("out");
        await sleep(380);
        if (dead(R)) return;
        setIntro(null);
      }
      if (pvp && v.danger && v.last) {
        // Reprise pendant que mon pote sauve sa carte : on attend l'issue.
        await syncHands(v, R, true);
        setBotSave({ ask: v.danger.ask, state: "try" });
        const out = await drv.oppRescue(v.last.n);
        if (dead(R)) return;
        setBotSave(null);
        await settle(out.state, R);
        return;
      }
      if (v.pending) {
        // Reprise en plein sauvetage : la carte en danger est déjà sur sa case.
        await syncHands(v, R, !!resumed);
        const c = v.pending.card;
        const key = `y${c.id}`;
        mutate((ps) => [...ps, { key, side: "you", cardId: c.id, card: c, zone: "slot", down: false, fx: "danger" }]);
        slotKey.current.you = key;
        startRescue(v, R);
        return;
      }
      await beginRound(v, R);
    })();
    return () => {
      life.current.run++;
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
    // Une seule fois par partie : `initial` ne change pas (la partie a sa clé).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Contre un pote : sa carte arrive (face cachée), ou la partie s'arrête net
  // (abandon, partie annulée).
  useEffect(() => {
    if (!pvp) return undefined;
    const offPick = drv.on("picked", (n) => {
      const v = viewRef.current;
      if (v?.round?.n !== n) return;
      if (phaseRef.current === "pick" || phaseRef.current === "wait") placeBot(life.current.run);
    });
    const offEnd = drv.on("end", (v) => {
      if (phaseRef.current === "end") return;
      life.current.run++;
      for (const t of life.current.timers) clearTimeout(t);
      life.current.timers.clear();
      setRescue(null);
      setBotSave(null);
      setFlash(null);
      setBanner(null);
      setCurObj(null);
      setObjState("off");
      viewRef.current = v;
      finish(v);
    });
    return () => {
      offPick();
      offEnd();
    };
    // Le pilote est fixe pour la partie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drv]);

  // Le chrono : les cinq dernières secondes font tic.
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

  // --- choisir une carte ----------------------------------------------------------
  const choosing = () => phaseRef.current === "pick" || phaseRef.current === "rescue";
  function act(p) {
    if (phaseRef.current === "pick") play(p);
    else if (phaseRef.current === "rescue") rescuePick(p);
  }
  function moveFocus(delta) {
    const n = myHand().length;
    if (!n) return;
    setFocus(Math.max(0, Math.min(n - 1, focusRef.current + delta)));
  }
  function actFocused() {
    const p = myHand()[focusRef.current];
    if (p) act(p);
  }
  // Téléphone : glisser change de carte, toucher la carte du centre la joue,
  // toucher une voisine la ramène au centre.
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
    // Toucher à côté : la carte en grand retourne dans la grille.
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
    } else act(hand[idx]);
  }

  // Clavier : ← → pour parcourir, Entrée pour jouer, Échap pour quitter.
  useEffect(() => {
    const on = (e) => {
      if (e.key === "Escape") {
        if (end) onExit();
        else setConfirmQuit((c) => !c);
        return;
      }
      if (!choosing() || confirmQuit) return;
      // On écrit dans un champ (une fenêtre de discussion par-dessus) : l'espace
      // ou Entrée ne doivent pas jouer une carte.
      const t = e.target;
      if (t?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setKbd(true);
        setPeek(true);
        moveFocus(e.key === "ArrowLeft" ? -1 : 1);
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
      await drv.quit(viewRef.current);
    } catch {
      /* partie déjà close : on sort quand même */
    }
    onExit();
  }

  function toggleMute() {
    const m = !muted;
    setSfxMuted(m);
    setMuted(m);
  }

  // --- rendu ---------------------------------------------------------------------
  const hands = { you: [], bot: [] };
  for (const p of pieces) if (p.zone === "hand") hands[p.side].push(p.key);
  // La main en grand : pendant le choix, et pendant tout le sauvetage (on
  // doit voir sur quelles cartes tombe le verdict).
  const zoom = phase === "pick" || phase === "rescue";
  const canChoose = phase === "pick" || phase === "rescue";
  const cw = lay.cw;
  const ch = lay.ch;
  const B = lay.base;
  const toWin = initial.toWin || 3;
  const nHand = hands.you.length;

  const hud = (side) => (
    <div className={`ba-side ${side}`}>
      <span className="ba-ava">
        {side === "you" ? <Avatar me={me} /> : opp ? <Avatar me={opp} /> : <Bot />}
        {side === "bot" && !opp && (
          <i className="ba-lvl" title={`Niveau ${initial.level}`}>
            {initial.level}
          </i>
        )}
      </span>
      <span className="ba-who">
        <b>{side === "you" ? me?.username || "Moi" : opp ? opp.username : "Bot"}</b>
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

  return createPortal(
    <div
      className={`ba ${lay.wide ? "wide" : "narrow"} ph-${phase} ${zoom ? "zooming" : ""}`}
      style={{ "--cw": `${cw}px`, "--ch": `${ch}px`, "--bw": `${B}px` }}
    >
      <div className={`ba-shake ${shake ? `shake-${shake % 2}` : ""}`}>
        {/* ---------- la barre du haut ---------- */}
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
          {/* le tapis et ses deux cases */}
          <div
            className="ba-board"
            style={{ transform: `translate(${lay.board.x}px, ${lay.board.y}px)`, width: lay.board.w, height: lay.board.h }}
          >
            <i className="ba-board-line" />
          </div>
          {["you", "bot"].map((s) => (
            <div
              key={s}
              className={`ba-slot ${s} ${
                objState === "lit" && (phase === "pick" || (pvp && s === "bot" && phase === "wait")) && !(s === "bot" && botIn)
                  ? "lit"
                  : ""
              }`}
              style={{ transform: `translate(${lay.slot[s].x - cw / 2}px, ${lay.slot[s].y - ch / 2}px)`, width: cw, height: ch }}
            >
              <span className="ba-slot-mark">{s === "you" ? <Avatar me={me} /> : opp ? <Avatar me={opp} /> : <Bot />}</span>
            </div>
          ))}

          {/* la case objectif */}
          <div
            className={`ba-obj o-${objState} ${flash ? "o-flash" : ""}`}
            style={{ transform: `translate(${lay.obj.x - lay.obj.w / 2}px, ${lay.obj.y - lay.obj.h / 2}px)`, width: lay.obj.w, height: lay.obj.h }}
          >
            {curObj && (
              <div className="ba-obj-in" key={curObj.key + (viewRef.current?.n || "")}>
                <ObjectiveFace o={curObj} big={lay.wide} />
              </div>
            )}
          </div>

          {/* les cartes */}
          {pieces.map((p) => {
            const pos = place(p, lay, hands, zoom, focus, peek);
            const mine = p.side === "you" && p.zone === "hand";
            const pickable = canChoose && mine;
            const focused = zoom && mine && hands.you.indexOf(p.key) === focus && (lay.wide || peek);
            return (
              <div
                key={p.key}
                className={`ba-card ${p.side} z-${p.zone} ${zoom && mine ? "zoomed" : ""} ${pickable ? "pickable" : ""} ${
                  focused ? "focused" : ""
                } ${zoom && mine && !lay.wide && peek && !focused ? "under" : ""} ${focused && kbd ? "kf" : ""} ${pos.far ? "far" : ""} ${p.fx ? `fx-${p.fx}` : ""}`}
                style={{
                  width: B,
                  height: B * RATIO,
                  marginLeft: -B / 2,
                  marginTop: (-B * RATIO) / 2,
                  transform: `translate(${pos.x}px, ${pos.y}px) rotate(${pos.r}deg) scale(${pos.s})`,
                  zIndex: pos.z,
                  "--lx": `${lay.lunge[p.side].x}px`,
                  "--ly": `${lay.lunge[p.side].y}px`,
                }}
                onClick={pickable && lay.wide ? () => act(p) : undefined}
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

          {/* ce qui s'accroche aux deux cases : verdict, PV, dégâts */}
          {["you", "bot"].map((s) => {
            const at = lay.slot[s];
            const pl = plaques[s];
            return (
              <div key={s} className={`ba-anchor ${s}`} style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
                {hp && (
                  <div
                    className="ba-hp"
                    style={{
                      transform: lay.wide
                        ? `translate(-50%, ${-ch / 2 - 10}px) translateY(-100%)`
                        : `translate(-50%, ${-ch / 2}px) translateY(-50%)`,
                    }}
                  >
                    <i
                      className={hp[s].hp / hp[s].max < 0.3 ? "low" : hp[s].hp / hp[s].max < 0.6 ? "mid" : ""}
                      style={{ "--p": Math.max(0, hp[s].hp / hp[s].max) }}
                    />
                    <b>{hp[s].hp}</b>
                  </div>
                )}
                {pl && (
                  <div className="ba-plaque-at" style={{ transform: `translate(-50%, ${ch / 2}px) translateY(-50%)` }}>
                    {"year" in pl ? (
                      <YearRoll year={pl.year} target={plaques.target} />
                    ) : (
                      <span className={`ba-plaque check ${pl.ok ? "ok" : "ko"}`}>{pl.ok ? <Check /> : <X />}</span>
                    )}
                  </div>
                )}
                {stamps[s] && <div className="ba-stamp">Hors sujet</div>}
                {crown === s && (
                  <span
                    className="ba-crown"
                    style={{ transform: `translate(-50%, ${-ch / 2 - (hp ? (lay.wide ? 40 : 14) : 2)}px) translateY(-100%)` }}
                  >
                    <Crown />
                  </span>
                )}
                {banner?.side === s && (
                  <div className="ba-banner" key={banner.k} style={{ "--tc": TYPES[banner.type]?.color }}>
                    <TypeBadge type={banner.type} className="mini" />
                    <span>{banner.name}</span>
                  </div>
                )}
                {pops
                  .filter((x) => x.side === s)
                  .map((x) => (
                    <div key={x.id} className={`ba-pop ${x.mult >= 1.5 ? "super" : x.mult < 1 ? "weak" : ""}`}>
                      <b>-{x.dmg}</b>
                      {x.mult !== 1 && <em>×{String(x.mult).replace(".", ",")}</em>}
                    </div>
                  ))}
                {rings
                  .filter((x) => x.side === s)
                  .map((x) => (
                    <i key={x.id} className={`ba-ring ${s}`} />
                  ))}
                {bursts
                  .filter((b) => b.side === s)
                  .map((b) => (
                    <span key={b.id} className="ba-burst">
                      <Burst colors={b.colors} count={26} spread={Math.round(cw * 0.95)} />
                    </span>
                  ))}
                {s === "bot" && pvp && !end && (oppWait || (phase === "wait" && objState === "lit" && !botIn)) && (
                  <div className="ba-think">
                    <span className="ba-think-ava">
                      <Avatar me={opp} />
                    </span>
                    <span>{oppWait ? "Prêt ?" : "Choisit"}</span>
                    <i className="ba-think-dots">
                      <i />
                      <i />
                      <i />
                    </i>
                  </div>
                )}
                {s === "bot" && botSave && (
                  <div className={`ba-botsave st-${botSave.state}`}>
                    {botSave.state === "ok" ? <ShieldCheck /> : <Shield />}
                    <span>{botSave.ask.label}</span>
                  </div>
                )}
              </div>
            );
          })}

          {orb && (
            <i
              className={`ba-orb ${orb.side}`}
              style={{ transform: `translate(${orb.go ? orb.to.x : orb.from.x}px, ${orb.go ? orb.to.y : orb.from.y}px)` }}
            />
          )}

          {flash && (
            <div
              className={`ba-flash ${flash.small ? "small" : ""}`}
              key={flash.k}
              style={{ transform: `translate(${lay.obj.x}px, ${lay.obj.y}px)` }}
            >
              <span>{flash.text}</span>
            </div>
          )}

          {/* le carrousel (téléphone) : où j'en suis, et le bouton pour jouer */}
          {zoom && !lay.wide && peek && nHand > 1 && (
            <div className="ba-dots" style={{ transform: `translate(-50%, ${lay.dotsY}px)` }}>
              {hands.you.map((k, i) => (
                <i key={k} className={i === focus ? "on" : ""} />
              ))}
            </div>
          )}
          {zoom && !lay.wide && peek && canChoose && (
            <button
              className={`ba-go clickable ${phase === "rescue" ? "rescue" : ""}`}
              style={{ transform: `translate(-50%, ${lay.dotsY + 20}px)` }}
              onClick={actFocused}
            >
              {phase === "rescue" ? "Montrer" : "Jouer"}
            </button>
          )}
        </div>

        {/* ---------- le choix en grand : voile + bandeau ---------- */}
        {zoom && (
          <div className="ba-scrim" onPointerDown={!lay.wide ? (e) => onDown(e, null) : undefined} onPointerUp={!lay.wide ? onUp : undefined} />
        )}
        {(rescue || (zoom && curObj)) && (
          <div
            className={`ba-focus ${rescue ? `rescue st-${rescue.state}` : ""}`}
            style={{ top: lay.bannerTop, height: lay.bannerH }}
            key={rescue ? `r${rescue.key}` : `o${curObj.key}`}
          >
            {rescue ? (
              <>
                <span className="ba-focus-thumb" title={rescue.card?.name}>
                  {rescue.card?.cover && <img src={cardCover(rescue.card.cover, "t_cover_small")} alt="" draggable="false" />}
                </span>
                <span className="ba-focus-main">
                  <span className="ba-focus-head">
                    {rescue.state === "ok" ? <ShieldCheck /> : <Shield />}
                    Sauvetage
                  </span>
                  <span className="ba-focus-ask">
                    {rescue.ask.kind === "tag" ? <Hash /> : <ObjectiveIcon o={rescue.ask} />}
                    <span>{rescue.ask.label}</span>
                  </span>
                </span>
              </>
            ) : (
              <ObjectiveFace o={curObj} big={false} />
            )}
            {!rescue && (
              <span
                className={`ba-focus-bot ${botIn ? "in" : ""} ${opp ? "opp" : ""}`}
                title={
                  opp
                    ? botIn
                      ? `${opp.username} a posé sa carte`
                      : `${opp.username} choisit`
                    : botIn
                      ? "Le bot a posé sa carte"
                      : "Le bot réfléchit"
                }
              >
                {opp ? <Avatar me={opp} /> : <Bot />}
                {botIn && <Check className="ok" />}
              </span>
            )}
            {rescue?.state === "ask" && <i className="ba-timer" style={{ animationDuration: `${rescue.ms}ms` }} />}
            {!rescue && timer && !timer.stopped && (
              <i className="ba-timer" key={timer.key} style={{ animationDuration: `${timer.ms}ms` }} />
            )}
          </div>
        )}

        {err && <div className="ba-err">{err}</div>}

        {intro && <VsIntro me={me} opp={opp} level={initial.level} stage={intro} />}

        {end && (
          <BattleEnd
            end={end}
            onReplay={onReplay}
            onExit={onExit}
            opp={opp}
            replayLabel={replayLabel}
            rematch={rematch}
          />
        )}

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
