import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { downloadImage } from "../lib/download";

// ======================================================================
//  Visionneuse d'images plein écran — swipe, flèches, clavier, vignettes
// ======================================================================
// Portalisée sur <body> : posée dans une modale, elle en sortirait sinon (un
// `position: absolute` reste borné à la carte parente, ce qui donnait une
// « pleine page » grande comme la modale).
//
// `items` : [{ id, full, thumb?, type? }]. Le parent porte l'index courant, ce
// qui lui permet d'ouvrir la visionneuse sur n'importe quelle image.

// Distance (en fraction de la largeur) au-delà de laquelle un glissé change
// d'image. Assez court pour un pouce, assez long pour ne pas déclencher sur un
// simple tap qui bouge un peu.
const SWIPE_RATIO = 0.16;

export default function MediaLightbox({ items, index, onIndex, onClose, title = null }) {
  const list = items || [];
  const safe = Math.min(Math.max(index || 0, 0), Math.max(0, list.length - 1));
  const cur = list[safe];

  const rootRef = useRef(null);
  const stripRef = useRef(null);
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const drag = useRef(null);

  const step = useCallback(
    (dir) => onIndex(Math.min(list.length - 1, Math.max(0, safe + dir))),
    [onIndex, safe, list.length]
  );

  // Clavier : flèches pour naviguer, Échap pour fermer (le navigateur gère déjà
  // Échap pour sortir du plein écran natif, d'où le test sur fullscreenElement).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "Escape" && !document.fullscreenElement) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  // Le fond ne doit pas défiler sous la visionneuse.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Plein écran NATIF (bouton dédié) : sur mobile c'est le seul moyen de
  // récupérer la barre d'URL et la barre système. On suit l'état réel plutôt
  // que le nôtre, l'utilisateur pouvant sortir par un geste système.
  useEffect(() => {
    const sync = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      // Quitter la visionneuse ne doit pas laisser la page en plein écran.
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else rootRef.current?.requestFullscreen?.().catch(() => {});
  }

  // Garde la vignette active visible quand on navigue au clavier / au swipe.
  useEffect(() => {
    stripRef.current
      ?.querySelector(`[data-i="${safe}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [safe]);

  // --- Glissé (souris ET tactile via les événements pointeur) ---
  function onDown(e) {
    if (list.length < 2 || e.button > 0) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      w: e.currentTarget.clientWidth || 1,
      dx: 0,
      active: false,
    };
  }
  function onMove(e) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.active) {
      // On ne prend la main qu'à partir d'un geste franchement horizontal :
      // un glissé vertical doit rester au défilement de la page.
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(e.clientY - d.y)) return;
      d.active = true;
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    let v = dx;
    // Résistance élastique aux extrémités : on sent qu'il n'y a plus rien.
    if ((safe === 0 && v > 0) || (safe === list.length - 1 && v < 0)) v *= 0.35;
    d.dx = v;
    setDragDx(v);
  }
  function onUp() {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    setDragging(false);
    setDragDx(0);
    if (Math.abs(d.dx) > d.w * SWIPE_RATIO) step(d.dx < 0 ? 1 : -1);
  }

  if (!cur) return null;

  return createPortal(
    <div
      className="mlb"
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={title || "Image en grand"}
      // Clic dans le vide = fermer ; un clic sur l'image ou les commandes non.
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="mlb-top">
        {title && <span className="mlb-title">{title}</span>}
        <span className="mlb-count">
          {safe + 1} / {list.length}
        </span>
        <button
          className="mlb-btn clickable"
          onClick={() => downloadImage(cur.full, `${cur.type || "image"}-${safe + 1}`)}
          title="Télécharger"
          aria-label="Télécharger l'image"
        >
          <Download size={18} />
        </button>
        <button
          className="mlb-btn clickable"
          onClick={toggleFullscreen}
          title={isFull ? "Quitter le plein écran" : "Plein écran"}
          aria-label={isFull ? "Quitter le plein écran" : "Plein écran"}
        >
          {isFull ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
        <button
          className="mlb-btn close clickable"
          onClick={onClose}
          title="Fermer"
          aria-label="Fermer"
        >
          <X size={20} />
        </button>
      </div>

      <div
        className="mlb-stage"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {list.length > 1 && (
          <button
            className="mlb-nav left clickable"
            onClick={() => step(-1)}
            disabled={safe === 0}
            aria-label="Image précédente"
          >
            <ChevronLeft size={26} />
          </button>
        )}

        <div className="mlb-viewport">
          <div
            className={`mlb-track ${dragging ? "dragging" : ""}`}
            style={{ transform: `translateX(calc(${-safe * 100}% + ${dragDx}px))` }}
          >
            {list.map((m, i) => (
              <div className="mlb-slide" key={m.id ?? i}>
                {/* Seules l'image courante et ses voisines sont chargées : une
                    galerie de 10 captures en pleine résolution, c'est lourd. */}
                {Math.abs(i - safe) <= 1 ? (
                  <img
                    src={m.full}
                    alt=""
                    draggable="false"
                    decoding="async"
                    fetchPriority={i === safe ? "high" : "low"}
                  />
                ) : (
                  <span className="mlb-slide-ph" aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
        </div>

        {list.length > 1 && (
          <button
            className="mlb-nav right clickable"
            onClick={() => step(1)}
            disabled={safe === list.length - 1}
            aria-label="Image suivante"
          >
            <ChevronRight size={26} />
          </button>
        )}
      </div>

      {list.length > 1 && (
        <div className="mlb-strip" ref={stripRef}>
          {list.map((m, i) => (
            <button
              key={m.id ?? i}
              data-i={i}
              className={`mlb-thumb clickable ${i === safe ? "on" : ""}`}
              onClick={() => onIndex(i)}
              aria-label={`Image ${i + 1}`}
              aria-current={i === safe}
            >
              <img src={m.thumb || m.full} alt="" loading="lazy" draggable="false" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}
