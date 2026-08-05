import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Check,
  RotateCcw,
  Trash2,
  ArrowUpToLine,
  ArrowDownToLine,
  User,
  Music,
  Gamepad2,
  Type,
  Sparkles,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import CoverArt, {
  defaultCoverDesign,
  coverElementStyle,
  MOTIFS,
  SHAPES,
  SHAPE_RADIUS,
  BG_PRESETS,
} from "./CoverArt";

const MOTIF_LABELS = {
  none: "Aucun",
  rings: "Anneaux",
  dots: "Points",
  stripes: "Rayures",
  grid: "Grille",
};
const SHAPE_LABELS = { circle: "Rond", rounded: "Arrondi", square: "Carré" };
const POS_LABELS = { top: "Haut", center: "Centre", bottom: "Bas" };

// Élément posé, déplaçable à la souris/au doigt sur la scène.
function EditorElement({ el, index, selected, onSelect, onDrag, canvasRef }) {
  const off = useRef(null);
  function down(e) {
    e.stopPropagation();
    onSelect(index);
    const r = canvasRef.current.getBoundingClientRect();
    // Décalage entre le point saisi et le centre de l'élément (drag naturel).
    off.current = {
      dx: e.clientX - (r.left + (el.x ?? 0.5) * r.width),
      dy: e.clientY - (r.top + (el.y ?? 0.5) * r.height),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e) {
    if (!off.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - off.current.dx - r.left) / r.width;
    const y = (e.clientY - off.current.dy - r.top) / r.height;
    onDrag(index, {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    });
  }
  function up(e) {
    off.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }
  return (
    <span
      className={`cvr-el editor ${selected ? "sel" : ""}`}
      style={coverElementStyle(el)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
    >
      <img
        src={el.src}
        alt=""
        draggable="false"
        style={{ borderRadius: SHAPE_RADIUS[el.shape] || SHAPE_RADIUS.rounded }}
      />
    </span>
  );
}

export default function CoverEditorModal({ list, items = [], avatar, token, onSave, onClose }) {
  const title = list.title || "";
  const [design, setDesign] = useState(() =>
    list.coverDesign
      ? { ...defaultCoverDesign(title), ...list.coverDesign }
      : defaultCoverDesign(title)
  );
  const [selected, setSelected] = useState(null);
  const [gameCovers, setGameCovers] = useState([]);
  const canvasRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Jaquettes des jeux présents dans la playlist (best-effort).
  useEffect(() => {
    const ids = [...new Set(items.map((i) => i.gameId).filter(Boolean))].slice(0, 8);
    if (!ids.length) return;
    let alive = true;
    Promise.all(
      ids.map((id) =>
        apiFetch(`/games/${id}/details`, { token })
          .then((d) => d.covers?.[0]?.url || null)
          .catch(() => null)
      )
    ).then((urls) => alive && setGameCovers([...new Set(urls.filter(Boolean))]));
    return () => {
      alive = false;
    };
  }, [items, token]);

  const trackArts = useMemo(
    () => [...new Set(items.map((i) => i.image).filter(Boolean))].slice(0, 16),
    [items]
  );

  const sel = selected != null ? design.elements?.[selected] : null;

  function patch(p) {
    setDesign((d) => ({ ...d, ...p }));
  }
  function addElement(src, kind = "image") {
    setDesign((d) => {
      const elements = [
        ...(d.elements || []),
        {
          kind,
          src,
          x: 0.5,
          y: 0.5,
          size: 0.34,
          rot: 0,
          shape: kind === "avatar" ? "circle" : "rounded",
        },
      ].slice(0, 24);
      setSelected(elements.length - 1);
      return { ...d, elements };
    });
  }
  function updateEl(i, p) {
    setDesign((d) => ({
      ...d,
      elements: d.elements.map((e, k) => (k === i ? { ...e, ...p } : e)),
    }));
  }
  function removeEl(i) {
    setDesign((d) => ({ ...d, elements: d.elements.filter((_, k) => k !== i) }));
    setSelected(null);
  }
  function layer(i, toFront) {
    setDesign((d) => {
      const arr = [...d.elements];
      const [it] = arr.splice(i, 1);
      arr.splice(toFront ? arr.length : 0, 0, it);
      setSelected(toFront ? arr.length - 1 : 0);
      return { ...d, elements: arr };
    });
  }

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal cvr-ed-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">
          <Sparkles size={20} /> Personnaliser la pochette
        </h2>

        <div className="cvr-ed">
          {/* ----- Scène (aperçu interactif) ----- */}
          <div className="cvr-ed-stage">
            <div
              className="cvr-ed-canvas"
              ref={canvasRef}
              onPointerDown={() => setSelected(null)}
            >
              <CoverArt design={design} title={title} hideElements />
              {(design.elements || []).map((el, i) => (
                <EditorElement
                  key={i}
                  el={el}
                  index={i}
                  selected={selected === i}
                  onSelect={setSelected}
                  onDrag={updateEl}
                  canvasRef={canvasRef}
                />
              ))}
            </div>
            <p className="cvr-ed-tip font-fun">Glisse les images pour les placer.</p>
          </div>

          {/* ----- Contrôles ----- */}
          <div className="cvr-ed-controls">
            {/* Fond */}
            <section className="cvr-ed-sec">
              <h3 className="cvr-ed-h">Fond</h3>
              <div className="cvr-ed-swatches">
                {BG_PRESETS.map(([a, b]) => (
                  <button
                    key={a + b}
                    className="cvr-ed-swatch clickable"
                    style={{ background: `linear-gradient(150deg, ${a}, ${b})` }}
                    onClick={() => patch({ bg1: a, bg2: b })}
                    title="Appliquer"
                  />
                ))}
              </div>
              <div className="cvr-ed-row">
                <label className="cvr-ed-color">
                  <input
                    type="color"
                    value={design.bg1}
                    onChange={(e) => patch({ bg1: e.target.value })}
                  />
                  <span>Couleur 1</span>
                </label>
                <label className="cvr-ed-color">
                  <input
                    type="color"
                    value={design.bg2}
                    onChange={(e) => patch({ bg2: e.target.value })}
                  />
                  <span>Couleur 2</span>
                </label>
                <button
                  className="cvr-ed-chip clickable"
                  onClick={() => patch({ bg2: design.bg1 })}
                  title="Fond uni"
                >
                  Uni
                </button>
              </div>
              <label className="cvr-ed-slider">
                <span>Sens</span>
                <input
                  type="range"
                  min={0}
                  max={360}
                  value={design.angle}
                  onChange={(e) => patch({ angle: +e.target.value })}
                />
              </label>
            </section>

            {/* Motif */}
            <section className="cvr-ed-sec">
              <h3 className="cvr-ed-h">Motif</h3>
              <div className="cvr-ed-chips">
                {MOTIFS.map((m) => (
                  <button
                    key={m}
                    className={`cvr-ed-chip clickable ${design.motif === m ? "on" : ""}`}
                    onClick={() => patch({ motif: m })}
                  >
                    {MOTIF_LABELS[m]}
                  </button>
                ))}
              </div>
              {design.motif !== "none" && (
                <label className="cvr-ed-slider">
                  <span>Intensité</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={design.motifOpacity}
                    onChange={(e) => patch({ motifOpacity: +e.target.value })}
                  />
                </label>
              )}
            </section>

            {/* Titre */}
            <section className="cvr-ed-sec">
              <h3 className="cvr-ed-h">
                <Type size={14} /> Titre
              </h3>
              <div className="cvr-ed-row">
                <button
                  className={`cvr-ed-chip clickable ${design.titleShow ? "on" : ""}`}
                  onClick={() => patch({ titleShow: !design.titleShow })}
                >
                  {design.titleShow ? "Visible" : "Masqué"}
                </button>
                {design.titleShow &&
                  ["top", "center", "bottom"].map((p) => (
                    <button
                      key={p}
                      className={`cvr-ed-chip clickable ${design.titlePos === p ? "on" : ""}`}
                      onClick={() => patch({ titlePos: p })}
                    >
                      {POS_LABELS[p]}
                    </button>
                  ))}
                {design.titleShow && (
                  <label className="cvr-ed-color">
                    <input
                      type="color"
                      value={design.titleColor}
                      onChange={(e) => patch({ titleColor: e.target.value })}
                    />
                    <span>Couleur</span>
                  </label>
                )}
                <button
                  className={`cvr-ed-chip clickable ${design.mark ? "on" : ""}`}
                  onClick={() => patch({ mark: !design.mark })}
                  title="Petit disque en coin"
                >
                  <Disc /> Disque
                </button>
              </div>
            </section>

            {/* Images à poser */}
            <section className="cvr-ed-sec">
              <h3 className="cvr-ed-h">Images</h3>
              <div className="cvr-ed-palette">
                {avatar && (
                  <button
                    className="cvr-ed-tile av clickable"
                    onClick={() => addElement(avatar, "avatar")}
                    title="Ta photo de profil"
                  >
                    <img src={avatar} alt="" draggable="false" />
                    <span className="cvr-ed-tile-tag">
                      <User size={11} />
                    </span>
                  </button>
                )}
                {trackArts.map((src) => (
                  <button
                    key={src}
                    className="cvr-ed-tile clickable"
                    onClick={() => addElement(src)}
                    title="Artwork de piste"
                  >
                    <img src={src} alt="" draggable="false" />
                    <span className="cvr-ed-tile-tag">
                      <Music size={11} />
                    </span>
                  </button>
                ))}
                {gameCovers.map((src) => (
                  <button
                    key={src}
                    className="cvr-ed-tile clickable"
                    onClick={() => addElement(src)}
                    title="Jaquette de jeu"
                  >
                    <img src={src} alt="" draggable="false" />
                    <span className="cvr-ed-tile-tag">
                      <Gamepad2 size={11} />
                    </span>
                  </button>
                ))}
                {!avatar && !trackArts.length && !gameCovers.length && (
                  <p className="cvr-ed-empty font-fun">Aucune image disponible.</p>
                )}
              </div>

              {/* Réglages de l'élément sélectionné */}
              {sel && (
                <div className="cvr-ed-elpanel">
                  <div className="cvr-ed-slider">
                    <span>Taille</span>
                    <input
                      type="range"
                      min={0.1}
                      max={0.9}
                      step={0.01}
                      value={sel.size}
                      onChange={(e) => updateEl(selected, { size: +e.target.value })}
                    />
                  </div>
                  <div className="cvr-ed-slider">
                    <span>Rotation</span>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      value={sel.rot}
                      onChange={(e) => updateEl(selected, { rot: +e.target.value })}
                    />
                  </div>
                  <div className="cvr-ed-row">
                    {SHAPES.map((s) => (
                      <button
                        key={s}
                        className={`cvr-ed-chip clickable ${sel.shape === s ? "on" : ""}`}
                        onClick={() => updateEl(selected, { shape: s })}
                      >
                        {SHAPE_LABELS[s]}
                      </button>
                    ))}
                    <button
                      className="cvr-ed-icon clickable"
                      onClick={() => layer(selected, true)}
                      title="Devant"
                    >
                      <ArrowUpToLine size={14} />
                    </button>
                    <button
                      className="cvr-ed-icon clickable"
                      onClick={() => layer(selected, false)}
                      title="Derrière"
                    >
                      <ArrowDownToLine size={14} />
                    </button>
                    <button
                      className="cvr-ed-icon danger clickable"
                      onClick={() => removeEl(selected)}
                      title="Retirer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>

        <div className="cvr-ed-foot">
          <button
            className="ld-vis clickable"
            onClick={() => {
              setDesign(defaultCoverDesign(title));
              setSelected(null);
            }}
          >
            <RotateCcw size={16} /> Réinitialiser
          </button>
          <span className="cvr-ed-foot-sp" />
          <button className="btn btn-ghost clickable" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary clickable" onClick={() => onSave(design)}>
            <Check size={17} /> Enregistrer
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Petit disque décoratif pour le bouton « Disque » (évite un import de plus).
function Disc() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    </svg>
  );
}
