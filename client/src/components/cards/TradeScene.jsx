import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, GalleryVerticalEnd, X } from "lucide-react";
import { useScrollLock } from "../../hooks/useScrollLock";
import { primeBattleSounds, playTradeDeal, playTradeSend, playTradeLand, playTradeDone } from "../../lib/sfx";
import TcgCard from "./TcgCard";

// ======================================================================
//  L'échange, en scène : mes cartes partent chez lui, les siennes viennent
// ======================================================================
// Rien d'autre que les cartes (la version « capsules qui se croisent dans des
// tubes » a été jugée moche) :
// 1. chacun présente ses cartes, devant sa photo — moi à gauche, lui à droite ;
// 2. les deux paquets se croisent en arc (les miens par-dessus, les siens
//    par-dessous) ;
// 3. les miens se fondent dans SA photo (elle s'allume en rose) ; les siens
//    se posent devant moi, un reflet passe dessus, ma photo s'allume en or ;
// 4. « Échange réussi ».
// Les sons restent discrets : des cartes qu'on distribue, qu'on fait glisser,
// qu'on pose — et un jeton pour conclure.

const PHASES = [
  ["show", 0],
  ["go", 1100],
  ["land", 2250],
  ["done", 3100],
];

function useLayout() {
  const calc = () => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const narrow = W < 700;
    const cw = Math.round(Math.min(170, narrow ? W * 0.27 : W * 0.13, H * 0.22));
    const ch = cw * (88 / 63);
    const y = H * 0.44;
    return {
      cw,
      ch,
      L: { x: W * (narrow ? 0.27 : 0.33), y },
      R: { x: W * (narrow ? 0.73 : 0.67), y },
      // La photo, sous le paquet.
      avaY: y + ch / 2 + (narrow ? 50 : 56),
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

function Stack({ cards, at, cw, className, style }) {
  const n = cards.length;
  return (
    <div
      className={`tr-stack ${className}`}
      style={{ left: at.x - cw / 2, top: at.y - (cw * 88) / 63 / 2, width: cw, ...style }}
    >
      {cards.map((c, i) => {
        const off = i - (n - 1) / 2;
        return (
          <div
            key={c.id}
            className="tr-card"
            style={{
              transform: `translate(${off * cw * 0.3}px, ${Math.abs(off) * 5}px) rotate(${off * 6}deg)`,
              zIndex: 10 - Math.abs(off),
            }}
          >
            <TcgCard card={c} tilt={false} eager />
          </div>
        );
      })}
    </div>
  );
}

function Who({ u, at, side, label }) {
  return (
    <div className={`tr-who ${side}`} style={{ left: at.x, top: at.y }}>
      <span className="tr-ava">
        {u?.avatar ? <img src={u.avatar} alt="" draggable="false" /> : <b>{(u?.username || "?")[0]}</b>}
      </span>
      <b className="tr-name">{u?.username || label}</b>
    </div>
  );
}

export default function TradeScene({ me, other, gave = [], got = [], onClose, onBinder }) {
  useScrollLock(true);
  const s = useLayout();
  const [ph, setPh] = useState("show");
  const idx = (p) => PHASES.findIndex(([k]) => k === p);
  const at = (p) => idx(ph) >= idx(p);

  useEffect(() => {
    primeBattleSounds();
    // Un clic saute à la fin ; les étapes en retard ne la défont pas.
    const timers = PHASES.slice(1).map(([k, t]) => setTimeout(() => setPh((p) => (p === "done" ? p : k)), t));
    const sounds = [
      setTimeout(() => playTradeDeal(0), 150),
      setTimeout(() => playTradeDeal(1), 400),
      setTimeout(() => playTradeSend(), 1120),
      setTimeout(() => playTradeLand(0), 2250),
      setTimeout(() => playTradeLand(1), 2400),
      setTimeout(() => playTradeDone(), 3100),
    ];
    return () => [...timers, ...sounds].forEach(clearTimeout);
  }, []);
  useEffect(() => {
    const on = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  const skip = () => (ph === "done" ? null : setPh("done"));
  const dx = s.R.x - s.L.x;
  const drop = s.avaY - s.L.y; // du centre du paquet jusqu'à la photo

  return createPortal(
    <div className={`tr ph-${ph}`} onClick={skip}>
      <Who u={me} at={{ x: s.L.x, y: s.avaY }} side="me" label="Toi" />
      <Who u={other} at={{ x: s.R.x, y: s.avaY }} side="them" label="Ton pote" />

      {/* Les miens partent vers la droite (par-dessus) et se fondent dans sa
          photo ; les siens viennent à gauche (par-dessous) et restent. */}
      <Stack cards={gave} at={s.L} cw={s.cw} className="give" style={{ "--dx": `${dx}px`, "--drop": `${drop}px` }} />
      <Stack cards={got} at={s.R} cw={s.cw} className="get" style={{ "--dx": `${-dx}px` }} />

      <div className="tr-title">
        {at("done") && (
          <h2>
            <span className="tr-check">
              <Check />
            </span>
            Échange réussi
          </h2>
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
