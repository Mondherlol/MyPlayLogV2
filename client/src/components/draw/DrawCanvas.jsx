import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

// ======================================================================
//  Le canevas de dessin
// ======================================================================
// Écrit pour La Bombe (le motif de sa bombe), pensé pour servir tel quel à un
// jeu de dessin à deviner : rien ici ne sait ce qu'on dessine ni pourquoi.
//
// ------------------------------------------------------------- les traits
// Le dessin n'est PAS une image qu'on modifie : c'est une liste de traits,
// rejouée dans l'ordre. C'est ce qui rend possibles, sans rien ajouter :
//   - annuler / rétablir (on retire un trait, on rejoue) ;
//   - rouvrir un dessin et continuer (on recharge la liste) ;
//   - le direct d'un jeu à deviner : chaque trait terminé sort par `onStroke`,
//     les autres le reçoivent et l'appliquent avec `apply()`.
//
//   { t: "pen" | "erase", c: "#rrggbb", w: 10, p: [x0, y0, x1, y1, …] }
//   { t: "fill", c: "#rrggbb", x, y }
//   { t: "clear" }
//
// Les coordonnées sont celles d'une feuille de DRAW_SIZE × DRAW_SIZE, quelle
// que soit la taille à l'écran : un dessin fait sur téléphone se rejoue à
// l'identique sur grand écran.
//
// ------------------------------------------------------------- deux calques
// Le calque « posé » (hors écran) contient les traits terminés ; la toile
// visible le recopie puis dessine par-dessus le trait en cours. Rejouer TOUT
// le dessin à chaque mouvement de souris serait trop lent dès qu'il y a des
// remplissages ; recopier une image de 512 × 512, non.
export const DRAW_SIZE = 512;

// Seize couleurs, à la Skribbl : de quoi tout dessiner sans chercher.
export const PALETTE = [
  "#ffffff",
  "#c1c1c1",
  "#4c4c4c",
  "#111111",
  "#ef130b",
  "#ff7100",
  "#ffe400",
  "#00cc00",
  "#00b2ff",
  "#231fd3",
  "#a300ba",
  "#d37caa",
  "#a0522d",
  "#ff5470",
  "#f2b70b",
  "#3ddc97",
];
export const WIDTHS = [4, 10, 20, 38];

// ------------------------------------------------------------- le rendu
function tracePen(ctx, s) {
  const p = s.p || [];
  const n = p.length / 2;
  if (!n) return;
  ctx.save();
  ctx.globalCompositeOperation = s.t === "erase" ? "destination-out" : "source-over";
  ctx.strokeStyle = s.c;
  ctx.fillStyle = s.c;
  ctx.lineWidth = s.w;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], s.w / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Lissé : on passe par le milieu de chaque segment (courbe quadratique),
    // ce qui efface les cassures d'une souris qui ne remonte que 60 points par
    // seconde.
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 1; i < n - 1; i += 1) {
      const x = p[i * 2];
      const y = p[i * 2 + 1];
      ctx.quadraticCurveTo(x, y, (x + p[i * 2 + 2]) / 2, (y + p[i * 2 + 3]) / 2);
    }
    ctx.lineTo(p[n * 2 - 2], p[n * 2 - 1]);
    ctx.stroke();
  }
  ctx.restore();
}

function hexRgb(hex) {
  const v = parseInt(String(hex).slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// Le pot de peinture : remplit la zone de même couleur que le point cliqué
// (au voisinage près — les bords d'un trait sont adoucis, sans tolérance le
// remplissage laisserait un liseré clair le long de chaque trait).
function floodFill(ctx, x0, y0, hex) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const x = Math.floor(x0);
  const y = Math.floor(y0);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const at = (y * W + x) * 4;
  const target = [d[at], d[at + 1], d[at + 2], d[at + 3]];
  const [r, g, b] = hexRgb(hex);
  if (target[3] === 255 && target[0] === r && target[1] === g && target[2] === b) return;
  const TOL = 60;
  const same = (i) =>
    Math.abs(d[i] - target[0]) + Math.abs(d[i + 1] - target[1]) + Math.abs(d[i + 2] - target[2]) + Math.abs(d[i + 3] - target[3]) * 1.5 <=
    TOL;
  const seen = new Uint8Array(W * H);
  const stack = [x, y];
  while (stack.length) {
    const py = stack.pop();
    let px = stack.pop();
    // On file à gauche puis à droite sur la ligne (remplissage par lignes :
    // dix fois moins de cases empilées qu'un remplissage point par point).
    while (px >= 0 && !seen[py * W + px] && same((py * W + px) * 4)) px -= 1;
    px += 1;
    let up = false;
    let down = false;
    while (px < W && !seen[py * W + px] && same((py * W + px) * 4)) {
      const k = py * W + px;
      seen[k] = 1;
      const i = k * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
      if (py > 0) {
        const kk = k - W;
        const ok = !seen[kk] && same(kk * 4);
        if (ok && !up) {
          stack.push(px, py - 1);
          up = true;
        } else if (!ok) up = false;
      }
      if (py < H - 1) {
        const kk = k + W;
        const ok = !seen[kk] && same(kk * 4);
        if (ok && !down) {
          stack.push(px, py + 1);
          down = true;
        } else if (!ok) down = false;
      }
      px += 1;
    }
  }
  // Le pot déborde d'un pixel sous les bords adoucis des traits : sans ça,
  // un liseré de la couleur d'avant reste visible autour de la zone.
  ctx.putImageData(img, 0, 0);
}

/** Applique un trait sur un contexte. */
export function paintStroke(ctx, s) {
  if (!s) return;
  if (s.t === "clear") ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  else if (s.t === "fill") floodFill(ctx, s.x, s.y, s.c);
  else tracePen(ctx, s);
}

/** Rejoue tout un dessin sur un contexte (effacé d'abord). */
export function renderStrokes(ctx, strokes) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const s of strokes || []) paintStroke(ctx, s);
}

/** Vrai si le dessin ne laisse rien à l'écran (tout effacé, ou rien tracé). */
export function strokesEmpty(strokes) {
  const list = strokes || [];
  let i = list.length - 1;
  while (i >= 0 && list[i].t !== "clear") i -= 1;
  return !list.slice(i + 1).some((s) => s.t === "pen" || s.t === "fill");
}

/** Le dessin en PNG (fond transparent), ou "" s'il est vide. */
export function strokesToPNG(strokes, size = DRAW_SIZE) {
  if (strokesEmpty(strokes)) return "";
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (size !== DRAW_SIZE) ctx.scale(size / DRAW_SIZE, size / DRAW_SIZE);
  renderStrokes(ctx, strokes);
  return c.toDataURL("image/png");
}

// ----------------------------------------------------------------------
//  Le composant
// ----------------------------------------------------------------------
// Contrôlé pour l'outil (`tool`, `color`, `width`) : la barre d'outils vit où
// le jeu veut (components/draw/DrawToolbar.jsx). Le dessin, lui, vit dedans —
// on y accède par la ref : undo(), redo(), clear(), getStrokes(),
// setStrokes(list), apply(stroke), toPNG(), isEmpty().
//
// `shape="circle"` : la feuille est un disque (le motif d'une bombe) ; ce qui
// déborde est coupé à l'affichage. `background` : la couleur sous le dessin
// (elle ne fait PAS partie du dessin — on peut la changer après coup).
const DrawCanvas = forwardRef(function DrawCanvas(
  {
    tool = "pen",
    color = "#111111",
    width = 10,
    background = "transparent",
    shape = "rect",
    readOnly = false,
    onChange,
    onStroke,
    className = "",
    children,
  },
  ref
) {
  const canvasRef = useRef(null);
  const baseRef = useRef(null);
  const cursorRef = useRef(null);
  const strokesRef = useRef([]);
  const redoRef = useRef([]);
  const curRef = useRef(null);
  const toolRef = useRef({ tool, color, width });
  toolRef.current = { tool, color, width };
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onStrokeRef = useRef(onStroke);
  onStrokeRef.current = onStroke;

  // Le calque posé, hors écran.
  const base = useCallback(() => {
    if (!baseRef.current) {
      const c = document.createElement("canvas");
      c.width = DRAW_SIZE;
      c.height = DRAW_SIZE;
      baseRef.current = c.getContext("2d", { willReadFrequently: true });
    }
    return baseRef.current;
  }, []);

  const show = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, DRAW_SIZE, DRAW_SIZE);
    ctx.drawImage(base().canvas, 0, 0);
    if (curRef.current) paintStroke(ctx, curRef.current);
  }, [base]);

  const changed = useCallback(() => {
    onChangeRef.current?.({
      strokes: strokesRef.current,
      canUndo: strokesRef.current.length > 0,
      canRedo: redoRef.current.length > 0,
      empty: strokesEmpty(strokesRef.current),
    });
  }, []);

  const commit = useCallback(
    (s, { silent = false } = {}) => {
      strokesRef.current = [...strokesRef.current, s];
      paintStroke(base(), s);
      show();
      if (!silent) {
        redoRef.current = [];
        onStrokeRef.current?.(s);
      }
      changed();
    },
    [base, show, changed]
  );

  const rebuild = useCallback(() => {
    renderStrokes(base(), strokesRef.current);
    show();
    changed();
  }, [base, show, changed]);

  useImperativeHandle(
    ref,
    () => ({
      undo() {
        const s = strokesRef.current;
        if (!s.length) return;
        redoRef.current = [...redoRef.current, s[s.length - 1]];
        strokesRef.current = s.slice(0, -1);
        rebuild();
      },
      redo() {
        const r = redoRef.current;
        if (!r.length) return;
        const s = r[r.length - 1];
        redoRef.current = r.slice(0, -1);
        strokesRef.current = [...strokesRef.current, s];
        paintStroke(base(), s);
        show();
        changed();
      },
      clear() {
        if (strokesEmpty(strokesRef.current)) return;
        commit({ t: "clear" });
      },
      getStrokes: () => strokesRef.current,
      setStrokes(list) {
        strokesRef.current = Array.isArray(list) ? list : [];
        redoRef.current = [];
        rebuild();
      },
      // Un trait venu d'ailleurs (le direct d'un jeu à deviner).
      apply(s) {
        commit(s, { silent: true });
      },
      toPNG: () => strokesToPNG(strokesRef.current),
      isEmpty: () => strokesEmpty(strokesRef.current),
    }),
    [rebuild, base, show, changed, commit]
  );

  useEffect(() => {
    show();
  }, [show]);

  // ---------- Le pointeur ----------
  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [
      Math.round(((e.clientX - r.left) / r.width) * DRAW_SIZE),
      Math.round(((e.clientY - r.top) / r.height) * DRAW_SIZE),
    ];
  };

  // Le rond qui suit le pointeur : la taille réelle du pinceau, à l'échelle de
  // l'écran. Posé directement sur l'élément — pas de rendu React à 60 i/s.
  const moveCursor = (e) => {
    const el = cursorRef.current;
    const cv = canvasRef.current;
    if (!el || !cv) return;
    const r = cv.getBoundingClientRect();
    const { tool: t, width: w } = toolRef.current;
    const d = t === "fill" ? 22 : Math.max(6, (w / DRAW_SIZE) * r.width);
    el.style.width = `${d}px`;
    el.style.height = `${d}px`;
    el.style.transform = `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`;
    el.dataset.tool = t;
    el.style.opacity = "1";
  };

  function down(e) {
    if (readOnly || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    const [x, y] = pos(e);
    const { tool: t, color: c, width: w } = toolRef.current;
    if (t === "fill") {
      commit({ t: "fill", c, x, y });
      return;
    }
    curRef.current = { t: t === "erase" ? "erase" : "pen", c, w, p: [x, y] };
    show();
  }
  function move(e) {
    moveCursor(e);
    const cur = curRef.current;
    if (!cur) return;
    const evs = e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent];
    for (const ev of evs) {
      const [x, y] = pos(ev);
      const n = cur.p.length;
      // Un point par pixel parcouru au plus : la liste reste légère.
      if (Math.abs(x - cur.p[n - 2]) + Math.abs(y - cur.p[n - 1]) < 2) continue;
      cur.p.push(x, y);
    }
    show();
  }
  function up() {
    const cur = curRef.current;
    if (!cur) return;
    curRef.current = null;
    commit(cur);
  }

  return (
    <div className={`dc ${shape} ${readOnly ? "ro" : ""} ${className}`} style={{ background }}>
      <canvas
        ref={canvasRef}
        width={DRAW_SIZE}
        height={DRAW_SIZE}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => {
          if (cursorRef.current) cursorRef.current.style.opacity = "0";
        }}
      />
      {!readOnly && <span className="dc-cursor" ref={cursorRef} aria-hidden="true" />}
      {children}
    </div>
  );
});

export default DrawCanvas;
