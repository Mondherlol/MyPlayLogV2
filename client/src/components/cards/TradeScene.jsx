import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, GalleryVerticalEnd, X } from "lucide-react";
import { useScrollLock } from "../../hooks/useScrollLock";
import { playCardDeal, playBattleFlip, playBattleSlam, playTradeWhoosh } from "../../lib/sfx";
import Burst from "../Burst";
import TcgCard from "./TcgCard";

// ======================================================================
//  L'échange, en scène — à la manière des échanges Pokémon
// ======================================================================
// 1. Chacun présente ses cartes (les miennes à gauche, face visible ; les
//    siennes à droite, encore de dos).
// 2. Les cartes se referment dans une capsule — dorée pour moi, rose pour lui.
// 3. Les deux capsules partent en arc et se CROISENT au milieu (une gerbe
//    d'éclats au croisement), le long de deux tubes pointillés.
// 4. Arrivées de l'autre côté, elles s'ouvrent : chez moi, ses cartes
//    apparaissent et se retournent. « Échange réussi ! »

const PHASES = [
  ["show", 0],
  ["pack", 1300],
  ["travel", 2100],
  ["cross", 2900],
  ["land", 3700],
  ["reveal", 4200],
  ["done", 5300],
];

function useScene() {
  const calc = () => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const narrow = W < 700;
    const cw = Math.round(Math.min(190, narrow ? W * 0.3 : W * 0.15, H * 0.24));
    const L = { x: W * (narrow ? 0.25 : 0.3), y: H * 0.52 };
    const R = { x: W * (narrow ? 0.75 : 0.7), y: H * 0.52 };
    const lift = Math.min(170, H * 0.2);
    const dx = R.x - L.x;
    return {
      W,
      H,
      cw,
      L,
      R,
      // Ma capsule passe par le haut, la sienne par le bas : elles se croisent
      // au milieu sans se toucher.
      up: `M ${L.x} ${L.y} C ${L.x + dx * 0.3} ${L.y - lift}, ${R.x - dx * 0.3} ${R.y - lift}, ${R.x} ${R.y}`,
      down: `M ${R.x} ${R.y} C ${R.x - dx * 0.3} ${R.y + lift}, ${L.x + dx * 0.3} ${L.y + lift}, ${L.x} ${L.y}`,
      mid: { x: (L.x + R.x) / 2, y: L.y },
    };
  };
  const [s, setS] = useState(calc);
  useEffect(() => {
    const on = () => setS(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return s;
}

function Stack({ cards, x, y, cw, down, className = "" }) {
  const n = cards.length;
  return (
    <div className={`tr-stack ${className}`} style={{ left: x, top: y, width: cw, "--cw": `${cw}px` }}>
      {cards.map((c, i) => {
        const off = i - (n - 1) / 2;
        return (
          <div
            key={c.id}
            className="tr-card"
            style={{ transform: `translate(${off * cw * 0.28}px, ${Math.abs(off) * 6}px) rotate(${off * 7}deg)`, zIndex: 10 - Math.abs(off) }}
          >
            <TcgCard card={c} faceDown={down} tilt={false} eager />
          </div>
        );
      })}
    </div>
  );
}

function Who({ u, side, label }) {
  return (
    <div className={`tr-who ${side}`}>
      <span className="tr-ava">
        {u?.avatar ? <img src={u.avatar} alt="" draggable="false" /> : <b>{(u?.username || "?")[0]}</b>}
      </span>
      <span className="tr-who-txt">
        <b>{u?.username}</b>
        <small>{label}</small>
      </span>
    </div>
  );
}

export default function TradeScene({ me, other, gave = [], got = [], onClose, onBinder }) {
  useScrollLock(true);
  const s = useScene();
  const [ph, setPh] = useState("show");
  const at = (p) => PHASES.findIndex(([k]) => k === ph) >= PHASES.findIndex(([k]) => k === p);

  useEffect(() => {
    // Un clic saute à la fin ; les étapes en retard ne la défont pas.
    const timers = PHASES.slice(1).map(([k, t]) => setTimeout(() => setPh((p) => (p === "done" ? p : k)), t));
    const sounds = [
      setTimeout(() => playCardDeal(0), 120),
      setTimeout(() => playCardDeal(2), 320),
      setTimeout(() => playBattleSlam(true), 1450),
      setTimeout(() => playTradeWhoosh(), 2150),
      setTimeout(() => playTradeWhoosh(), 2350),
      setTimeout(() => playBattleSlam(), 3750),
      setTimeout(() => playBattleFlip(), 4350),
    ];
    return () => [...timers, ...sounds].forEach(clearTimeout);
  }, []);
  useEffect(() => {
    const on = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  const skip = () => (ph === "done" ? null : setPh("done"));
  const ch = s.cw * (88 / 63);
  const pathStyle = useMemo(() => ({ width: s.W, height: s.H }), [s.W, s.H]);

  return createPortal(
    <div className={`tr ph-${ph}`} onClick={skip}>
      <Who u={me} side="me" label="Toi" />
      <Who u={other} side="them" label="Ton pote" />

      {/* les deux tubes */}
      <svg className="tr-tubes" style={pathStyle} viewBox={`0 0 ${s.W} ${s.H}`} aria-hidden="true">
        <path className="tr-tube up" d={s.up} />
        <path className="tr-tube down" d={s.down} />
      </svg>

      {/* avant : ce que je donne (à gauche), ce que je reçois (à droite, de dos) */}
      {!at("travel") && (
        <>
          <Stack cards={gave} x={s.L.x - s.cw / 2} y={s.L.y - ch / 2} cw={s.cw} className="give" />
          <Stack cards={got} x={s.R.x - s.cw / 2} y={s.R.y - ch / 2} cw={s.cw} down className="get" />
        </>
      )}

      {/* les capsules */}
      {at("pack") && !at("reveal") && (
        <>
          <i className="tr-orb me" style={{ offsetPath: `path("${s.up}")` }} />
          <i className="tr-orb them" style={{ offsetPath: `path("${s.down}")` }} />
        </>
      )}
      {at("cross") && !at("land") && (
        <span className="tr-cross" style={{ left: s.mid.x, top: s.mid.y }}>
          <Burst colors={["#f2b70b", "#ff5470", "#ffffff"]} count={22} spread={90} />
        </span>
      )}

      {/* après : chez moi, ses cartes ; chez lui, les miennes */}
      {at("reveal") && (
        <>
          <Stack cards={got} x={s.L.x - s.cw / 2} y={s.L.y - ch / 2} cw={s.cw} className="got" />
          <Stack cards={gave} x={s.R.x - s.cw / 2} y={s.R.y - ch / 2} cw={s.cw} down className="gone" />
          <span className="tr-pop" style={{ left: s.L.x, top: s.L.y }}>
            <Burst colors={["#f2b70b", "#ffffff"]} count={28} spread={Math.round(s.cw * 0.9)} />
          </span>
        </>
      )}

      <div className="tr-title">
        {at("done") ? (
          <h2>Échange réussi !</h2>
        ) : (
          <span className="tr-kicker">
            <ArrowLeftRight />
          </span>
        )}
      </div>

      {at("done") && (
        <div className="tr-actions" onClick={(e) => e.stopPropagation()}>
          {onBinder && (
            <button className="tr-btn gold clickable" onClick={onBinder}>
              <GalleryVerticalEnd />
              Voir dans le classeur
            </button>
          )}
          <button className="tr-btn ghost clickable" onClick={onClose}>
            Fermer
          </button>
        </div>
      )}
      <button
        className="tr-close clickable"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Fermer"
      >
        <X />
      </button>
    </div>,
    document.body
  );
}
