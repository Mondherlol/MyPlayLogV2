import { Eraser, PaintBucket, Pencil, Redo2, Trash2, Undo2 } from "lucide-react";
import { PALETTE, WIDTHS } from "./DrawCanvas";

// ======================================================================
//  La barre d'outils du canevas (components/draw/DrawCanvas.jsx)
// ======================================================================
// Trois outils (crayon, gomme, pot), la palette, quatre tailles, et l'annuler /
// rétablir / tout effacer. Raccourcis tenus par la page qui l'affiche (B, E,
// F, Ctrl+Z, Ctrl+Y) : elle seule sait si le clavier lui appartient.
const TOOLS = [
  ["pen", Pencil, "Crayon (B)"],
  ["erase", Eraser, "Gomme (E)"],
  ["fill", PaintBucket, "Pot de peinture (F)"],
];

export default function DrawToolbar({
  tool,
  onTool,
  color,
  onColor,
  width,
  onWidth,
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
}) {
  const custom = !PALETTE.includes(color);
  return (
    <div className="dt">
      <div className="dt-row">
        <div className="dt-group">
          {TOOLS.map(([k, Icon, label]) => (
            <button
              key={k}
              className={`dt-btn clickable ${tool === k ? "on" : ""}`}
              onClick={() => onTool(k)}
              title={label}
              aria-label={label}
              aria-pressed={tool === k}
            >
              <Icon />
            </button>
          ))}
        </div>
        <div className="dt-group">
          {WIDTHS.map((w) => (
            <button
              key={w}
              className={`dt-btn size clickable ${width === w ? "on" : ""}`}
              onClick={() => {
                onWidth(w);
                if (tool === "fill") onTool("pen");
              }}
              title={`Épaisseur ${w}`}
              aria-label={`Épaisseur ${w}`}
            >
              <i style={{ width: Math.max(4, w * 0.5), height: Math.max(4, w * 0.5), background: tool === "erase" ? "#fff" : color }} />
            </button>
          ))}
        </div>
        <div className="dt-group">
          <button className="dt-btn clickable" onClick={onUndo} disabled={!canUndo} title="Annuler (Ctrl+Z)" aria-label="Annuler">
            <Undo2 />
          </button>
          <button className="dt-btn clickable" onClick={onRedo} disabled={!canRedo} title="Rétablir (Ctrl+Y)" aria-label="Rétablir">
            <Redo2 />
          </button>
          <button className="dt-btn clickable" onClick={onClear} title="Tout effacer" aria-label="Tout effacer">
            <Trash2 />
          </button>
        </div>
      </div>
      <div className="dt-palette">
        {PALETTE.map((c) => (
          <button
            key={c}
            className={`dt-swatch clickable ${color === c ? "on" : ""}`}
            style={{ background: c }}
            onClick={() => {
              onColor(c);
              if (tool === "erase") onTool("pen");
            }}
            aria-label={`Couleur ${c}`}
          />
        ))}
        {/* N'importe quelle autre couleur : le sélecteur du système. */}
        <label className={`dt-swatch custom clickable ${custom ? "on" : ""}`} style={custom ? { background: color } : undefined} title="Autre couleur">
          <input
            type="color"
            value={color}
            onChange={(e) => {
              onColor(e.target.value);
              if (tool === "erase") onTool("pen");
            }}
          />
        </label>
      </div>
    </div>
  );
}
