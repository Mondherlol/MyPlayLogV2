import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Move, Check, Loader2 } from "lucide-react";

const clamp = (n) => Math.max(0, Math.min(100, n));

// Parse une position CSS "50% 30%" en { x, y } (défaut : centré).
function parsePos(pos) {
  if (typeof pos === "string") {
    const m = pos.match(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/);
    if (m) return { x: clamp(+m[1]), y: clamp(+m[2]) };
  }
  return { x: 50, y: 50 };
}

// Recadre la couverture existante : on fait glisser l'image pour choisir la
// partie visible dans la bannière. On enregistre un `object-position` CSS.
export default function ReframeCoverModal({ cover, pos, onSave, onClose }) {
  const [p, setP] = useState(() => parsePos(pos));
  const [saving, setSaving] = useState(false);
  const stageRef = useRef(null);
  const natRef = useRef({ w: 0, h: 0 }); // dimensions naturelles de l'image
  const dragRef = useRef(null); // { x, y, pos } au début du glisser

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function onImgLoad(e) {
    natRef.current = { w: e.target.naturalWidth, h: e.target.naturalHeight };
  }

  // Débordement (en px) de l'image mise à l'échelle "cover" par rapport au cadre.
  function overflow() {
    const el = stageRef.current;
    const { w: nw, h: nh } = natRef.current;
    if (!el || !nw || !nh) return { x: 0, y: 0 };
    const W = el.clientWidth;
    const H = el.clientHeight;
    const scale = Math.max(W / nw, H / nh);
    return { x: nw * scale - W, y: nh * scale - H };
  }

  function onPointerDown(e) {
    e.preventDefault();
    stageRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, pos: p };
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const ov = overflow();
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    // Glisser vers la droite/bas révèle la partie gauche/haute → le % diminue.
    const nx = ov.x > 1 ? clamp(d.pos.x - (100 * dx) / ov.x) : d.pos.x;
    const ny = ov.y > 1 ? clamp(d.pos.y - (100 * dy) / ov.y) : d.pos.y;
    setP({ x: nx, y: ny });
  }
  function onPointerUp(e) {
    dragRef.current = null;
    stageRef.current?.releasePointerCapture?.(e.pointerId);
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(`${Math.round(p.x)}% ${Math.round(p.y)}%`);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal reframe-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">
          <Move size={20} /> Recadrer la couverture
        </h2>
        <p className="reframe-hint font-fun">
          Fais glisser l'image pour choisir la partie visible.
        </p>

        <div
          className="reframe-stage"
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            src={cover}
            alt=""
            draggable="false"
            onLoad={onImgLoad}
            style={{ objectPosition: `${p.x}% ${p.y}%` }}
          />
          <span className="reframe-grip">
            <Move size={18} />
          </span>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
