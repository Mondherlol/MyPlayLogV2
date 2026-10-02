import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { apiFetch } from "../../lib/api";
import DrawCanvas from "../draw/DrawCanvas";
import DrawToolbar from "../draw/DrawToolbar";
import BombArt, { BombSkull, DEFAULT_BOMB } from "./BombArt";

// ======================================================================
//  L'atelier : dessiner SA bombe
// ======================================================================
// On dessine directement sur la panse de la bombe (le canevas EST la panse),
// on choisit la couleur du corps, on enregistre. Tant que la panse est vide,
// la tête de mort par défaut transparaît en fantôme : c'est elle que la table
// verra si on n'y touche pas.
//
// Ce qu'on enregistre (POST /api/bombe/skin) : la couleur, le dessin en PNG,
// et les traits — pour rouvrir l'atelier et continuer, annuler compris.
const BODY_COLORS = [
  DEFAULT_BOMB,
  "#1d1d23",
  "#5b6270",
  "#e9e4dc",
  "#c62a3c",
  "#ff5470",
  "#ff8a3d",
  "#f2b70b",
  "#3ddc97",
  "#1f8a5b",
  "#2f7de1",
  "#6d4bd6",
];

export default function BombStudio({ token, onClose, onSaved }) {
  const canvas = useRef(null);
  const [color, setColor] = useState(DEFAULT_BOMB);
  const [tool, setTool] = useState("pen");
  const [ink, setInk] = useState("#ffffff");
  const [width, setWidth] = useState(20);
  const [state, setState] = useState({ canUndo: false, canRedo: false, empty: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  // Ce qu'il y avait avant : de quoi annuler l'enregistrement (le toast).
  const before = useRef(null);

  useEffect(() => {
    let alive = true;
    apiFetch("/bombe/skin", { token })
      .then((d) => {
        if (!alive) return;
        const skin = d.skin || { color: DEFAULT_BOMB, strokes: [] };
        before.current = { color: skin.color || DEFAULT_BOMB, strokes: skin.strokes || [] };
        setColor(skin.color || DEFAULT_BOMB);
        canvas.current?.setStrokes(skin.strokes || []);
      })
      .catch(() => {
        before.current = { color: DEFAULT_BOMB, strokes: [] };
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token]);

  // Les raccourcis — sauf quand on tape dans un champ (le sélecteur de couleur).
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") onClose();
      else if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) {
        e.preventDefault();
        canvas.current?.undo();
      } else if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        canvas.current?.redo();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (k === "b") setTool("pen");
        else if (k === "e") setTool("erase");
        else if (k === "f") setTool("fill");
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const onChange = useCallback((s) => setState({ canUndo: s.canUndo, canRedo: s.canRedo, empty: s.empty }), []);

  async function save() {
    if (saving) return;
    setSaving(true);
    setErr("");
    try {
      const c = canvas.current;
      const strokes = c.isEmpty() ? [] : c.getStrokes();
      const d = await apiFetch("/bombe/skin", {
        method: "POST",
        token,
        body: { color, png: c.isEmpty() ? "" : c.toPNG(), strokes },
      });
      onSaved?.(d.skin, before.current);
      onClose();
    } catch (e) {
      setErr(e.message || "Bombe non enregistrée.");
      setSaving(false);
    }
  }

  return createPortal(
    <div className="bbs-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bbs">
        <header className="bbs-head">
          <h3>Ma bombe</h3>
          <button className="bbs-x clickable" onClick={onClose} aria-label="Fermer">
            <X />
          </button>
        </header>

        <div className="bbs-work">
          <div className={`bbs-bomb ${loading ? "loading" : ""}`}>
            <BombArt
              skin={{ color }}
              lit={false}
              body={
                <>
                  {state.empty && <BombSkull className="bba-skull ghost" />}
                  <DrawCanvas
                    ref={canvas}
                    shape="circle"
                    tool={tool}
                    color={ink}
                    width={width}
                    onChange={onChange}
                  />
                </>
              }
            />
            {loading && <Loader2 className="spin bbs-wait" />}
          </div>

          <div className="bbs-side">
            <DrawToolbar
              tool={tool}
              onTool={setTool}
              color={ink}
              onColor={setInk}
              width={width}
              onWidth={setWidth}
              onUndo={() => canvas.current?.undo()}
              onRedo={() => canvas.current?.redo()}
              onClear={() => canvas.current?.clear()}
              canUndo={state.canUndo}
              canRedo={state.canRedo}
            />

            <div className="bbs-colors">
              <span className="bbs-k">Couleur de la bombe</span>
              <div className="bbs-swatches">
                {BODY_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`bbs-swatch clickable ${color === c ? "on" : ""}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    aria-label={`Bombe ${c}`}
                  />
                ))}
                <label
                  className={`bbs-swatch custom clickable ${BODY_COLORS.includes(color) ? "" : "on"}`}
                  style={BODY_COLORS.includes(color) ? undefined : { background: color }}
                  title="Autre couleur"
                >
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
                </label>
              </div>
            </div>

            {err && <p className="bbs-err">{err}</p>}
            <div className="bbs-go">
              <button className="bb-big gold clickable" onClick={save} disabled={saving || loading}>
                {saving && <Loader2 className="spin" />}
                Enregistrer
              </button>
              <button
                className="bb-line clickable"
                onClick={() => {
                  canvas.current?.clear();
                  setColor(DEFAULT_BOMB);
                }}
                disabled={loading}
              >
                Revenir à la tête de mort
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
