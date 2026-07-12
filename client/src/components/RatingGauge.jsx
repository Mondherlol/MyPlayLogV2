import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

// Jauge de note semi-circulaire, PARTAGÉE (PlayedModal, GamePage, GameReviews).
// On attrape l'arc et on glisse le long du demi-cercle pour régler la note, ou
// on tape la valeur au clavier au centre (input texte → aucune flèche native).
// L'appelant met la valeur à 50 dans onEnable → « Noter » ouvre la jauge au
// milieu (champ pré-rempli à 50). Styles dans app-02-content.css (.rating-gauge,
// .gauge-*).
const GAUGE = { R: 56, CX: 70, CY: 66, SW: 12 };

export default function RatingGauge({ value, active, onEnable, onChange, onClear }) {
  const { R, CX, CY, SW } = GAUGE;
  const L = Math.PI * R;
  const arc = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
  const offset = L * (1 - (active ? value : 0) / 100);
  const color =
    !active ? "var(--border-strong)" : value < 40 ? "#e0483f" : value < 70 ? "#f2b70b" : "#22a35a";
  const [txt, setTxt] = useState(String(value));
  const svgRef = useRef(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    setTxt(String(value));
  }, [value]);

  // Saisie clavier libre (input texte, pas number → aucune flèche native).
  function onInput(e) {
    let v = e.target.value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
    if (v === "") {
      setTxt("");
      return;
    }
    const n = Math.max(0, Math.min(100, parseInt(v, 10)));
    setTxt(String(n));
    onChange(n);
  }

  // Position du pointeur → note : on mesure l'angle par rapport au centre du
  // demi-cercle (gauche = 0, sommet = 50, droite = 100).
  function valueFromEvent(e) {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 140;
    const y = ((e.clientY - rect.top) / rect.height) * 78;
    let ang = Math.atan2(CY - y, x - CX); // 0 à droite, π à gauche
    // Sous la ligne du centre (extrémités basses de l'arc), atan2 devient
    // négatif : on rabat vers l'extrémité la plus proche (gauche = 0, droite
    // = 100) au lieu de sauter à l'opposé.
    if (ang < 0) ang = x < CX ? Math.PI : 0;
    ang = Math.max(0, Math.min(Math.PI, ang));
    return Math.round((1 - ang / Math.PI) * 100);
  }

  function onPointerDown(e) {
    if (!active) onEnable();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const v = valueFromEvent(e);
    if (v != null) onChange(v);
  }
  function onPointerMove(e) {
    if (!draggingRef.current) return;
    const v = valueFromEvent(e);
    if (v != null) onChange(v);
  }
  function onPointerUp(e) {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  // Pastille attrapable, positionnée sur l'arc à la valeur courante.
  const tAng = (1 - value / 100) * Math.PI;
  const tx = CX + R * Math.cos(tAng);
  const ty = CY - R * Math.sin(tAng);

  return (
    <div className="rating-gauge">
      <div className="gauge-vis">
        <svg
          ref={svgRef}
          viewBox="0 0 140 78"
          className={`gauge-svg ${active ? "grabbable" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <path d={arc} fill="none" stroke="var(--border-strong)" strokeWidth={SW} strokeLinecap="round" />
          {active && (
            <>
              <path
                d={arc}
                fill="none"
                stroke={color}
                strokeWidth={SW}
                strokeLinecap="round"
                strokeDasharray={L}
                strokeDashoffset={offset}
                style={{ transition: draggingRef.current ? "none" : "stroke-dashoffset 0.25s ease, stroke 0.25s ease" }}
              />
              <circle className="gauge-thumb" cx={tx} cy={ty} r={9} fill="#fff" stroke={color} strokeWidth={3} />
            </>
          )}
        </svg>
        <div className="gauge-center">
          {active ? (
            <input
              type="text"
              inputMode="numeric"
              maxLength={3}
              value={txt}
              onChange={onInput}
              onFocus={(e) => e.target.select()}
              onBlur={() => txt === "" && setTxt(String(value))}
              className="gauge-input"
              style={{ color }}
              aria-label="Note sur 100"
            />
          ) : (
            <button className="gauge-noter clickable" onClick={onEnable}>
              Noter
            </button>
          )}
        </div>
      </div>
      {active && (
        <button className="gauge-clear clickable" onClick={onClear}>
          <X size={12} /> retirer la note
        </button>
      )}
    </div>
  );
}
