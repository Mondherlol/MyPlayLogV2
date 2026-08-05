import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  RotateCcw,
  Check,
  X,
  AlignCenter,
  Ruler,
  Scissors,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import { CM, loadImage } from "../lib/collection";

// ======================================================================
//  Mesure d'un boîtier à partir de sa jaquette dépliée
// ======================================================================
// LA JAQUETTE COMMANDE, PAS LE GABARIT. C'est tout le sujet de cet écran, et
// c'est l'inverse de ce qu'il faisait à l'origine : l'image était alors
// recadrée de force aux proportions du boîtier DVD, donc rognée dès qu'elle
// n'avait pas exactement ce rapport.
//
// Ici on ne rogne rien d'autorité — mais on DÉSIGNE. Deux repères se posent sur
// l'image, et tout le reste s'en déduit :
//
//   ┌ · · · · · · · · · · · · · · · · · · · ┐   ← la page du PDF (fond perdu,
//   ·   ┌───────────┬────┬───────────┐      ·      marges de coupe, blanc)
//   ·   │    dos    │ tr │ couverture│      ·   ← LE CADRE : la jaquette réelle
//   ·   └───────────┴────┴───────────┘      ·
//   └ · · · · · · · · · · · · · · · · · · · ┘
//
//   • LE CADRE dit où est la jaquette DANS l'image. Une jaquette livrée en
//     qualité d'impression flotte presque toujours au milieu de bords blancs :
//     sans ce cadre, ces bords s'imprimaient sur le boîtier, ET la hauteur en
//     centimètres se rapportait à la page entière — donc à un objet trop grand.
//     Le cadre étant commun aux trois panneaux (une jaquette est UNE feuille),
//     régler son haut et son bas coupe du même geste le dos et la couverture.
//
//   • LE BANDEAU dit où est la tranche à l'intérieur du cadre. C'est la seule
//     chose qu'aucun calcul ne peut deviner.
//
// Les trois dimensions du boîtier tombent alors toutes seules :
//
//      w = largeur du bandeau
//      d = (ce qui reste à gauche + ce qui reste à droite) / 2
//      h = la hauteur réelle, en centimètres, rapportée à la hauteur DU CADRE
//
// La sortie n'est PAS une image : c'est un jeu de mesures (voir `boxSchema`
// côté serveur). Le fichier d'origine part intact, et c'est à la peinture qu'il
// sera découpé — donc un recadrage se corrige plus tard sans rien réimporter.

// Hauteurs réelles des supports courants, en centimètres. Ce sont des repères,
// pas une liste fermée : le champ libre reste maître.
const STANDARDS = [
  { key: "dvd", label: "DVD", cm: 19 },
  { key: "bluray", label: "Blu-ray", cm: 17.2 },
  { key: "vhs", label: "VHS", cm: 19 },
  { key: "cd", label: "CD / OST", cm: 12.4 },
];

// Épaisseur minimale d'une tranche, en unités du monde (≈ 2 mm). C'est la même
// borne que le serveur : en deçà, la mesure serait refusée à l'enregistrement,
// et l'admin n'aurait pour toute explication qu'un « dimensions invalides »
// après avoir tout réglé. Autant que le curseur ne puisse pas y descendre.
const MIN_SPINE_UNITS = 0.0125;

// Plafond du bandeau, en part du CADRE : au-delà, il ne resterait plus de quoi
// faire deux panneaux.
const MAX_SPINE = 0.6;

// Le cadre ne peut pas se refermer sur lui-même.
const MIN_CROP = 0.05;

// LA LOUPE. Poser un bord de cadre au bon endroit demande de VOIR ce bord :
// sur une jaquette de 5000 px affichée dans 800, un pixel d écran en vaut six,
// et la marge blanche qu on cherche à écarter fait justement quelques pixels.
// Sans grossissement, le réglage se fait au jugé.
//
// En dessous de 1, l image ne remplit plus le cadre : c est voulu, ça dégage
// les poignées des bords qui, collées au ras de l image, sont à moitié rognées.
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 12;
const ZOOM_STEP = 1.25;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (n, d = 1) => n.toFixed(d).replace(".", ",").replace(/,0$/, "");

// Cherche la boîte englobante de ce qui n'est PAS du blanc — le geste que tout
// le monde ferait à la main sur un PDF d'impression, et qui tombe juste dans
// l'immense majorité des cas : une jaquette est une illustration posée sur du
// papier vierge. On travaille sur une réduction, parce que la position d'un
// bord ne se joue pas au pixel près et que lire quatre millions de pixels le
// ferait sentir.
function detectEdges(img) {
  const W = Math.min(700, img.width);
  const H = Math.max(1, Math.round((W * img.height) / img.width));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);

  let data;
  try {
    data = ctx.getImageData(0, 0, W, H).data;
  } catch {
    return null; // canvas souillé : l'image vient d'un autre domaine
  }

  // « De l'encre » = un canal nettement sous 244, ou une couleur franche. Le
  // seuil est haut exprès : un scan de papier n'est jamais à 255.
  const inked = (i) => {
    if (data[i + 3] < 24) return false; // transparent = fond, pas de l'encre
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    return Math.min(r, g, b) < 244 || Math.max(r, g, b) - Math.min(r, g, b) > 18;
  };

  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inked((y * W + x) * 4)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) return null; // page entièrement blanche

  // Un pixel de marge de chaque côté : la réduction a pu manger le bord.
  const left = Math.max(0, x0 - 1) / W;
  const top = Math.max(0, y0 - 1) / H;
  return {
    x: left,
    y: top,
    w: Math.min(W, x1 + 2) / W - left,
    h: Math.min(H, y1 + 2) / H - top,
  };
}

export default function WrapCropModal({ src, media, onCancel, onApply }) {
  const [img, setImg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  // Tout l'état tient dans un cadre, un bandeau et une hauteur. Repris du
  // réglage précédent quand il existe : rouvrir l'outil ne doit pas obliger à
  // tout replacer.
  const saved = media?.box;
  const [crop, setCrop] = useState(() =>
    saved?.cropW > 0
      ? { x: saved.cropX || 0, y: saved.cropY || 0, w: saved.cropW, h: saved.cropH || 1 }
      : { x: 0, y: 0, w: 1, h: 1 }
  );
  const [spineX, setSpineX] = useState(() =>
    saved?.spineW > 0 ? saved.spineX : 0.5 - 0.03 / 2
  );
  const [spineW, setSpineW] = useState(() => (saved?.spineW > 0 ? saved.spineW : 0.03));
  // 19 cm par défaut : la hauteur d'un vrai boîtier DVD, donc le repère juste
  // pour la très grande majorité des jaquettes qu'on dépose ici.
  const [heightCm, setHeightCm] = useState(() =>
    saved?.h > 0 ? Math.round(saved.h * CM * 10) / 10 : 19
  );

  // La LOUPE : un facteur et un décalage, appliqués en une seule transformation
  // CSS sur le calque qui porte l'image ET les repères. Les repères sont placés
  // en pourcentages de ce calque, ils suivent donc le grossissement sans qu'on
  // ait rien à recalculer — et `getBoundingClientRect` renvoyant la boîte APRÈS
  // transformation, les gestes de la souris tombent justes eux aussi, sans une
  // ligne de plus.
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const viewRef = useRef(null);
  const frameRef = useRef(null);
  const drag = useRef(null);

  // Recentre le calque quand il est plus petit que la fenêtre, et l'empêche
  // d'être traîné hors de vue quand il est plus grand.
  const settle = useCallback((v) => {
    const rect = viewRef.current?.getBoundingClientRect();
    if (!rect) return v;
    const sw = rect.width * v.z;
    const sh = rect.height * v.z;
    return {
      z: v.z,
      x: sw <= rect.width ? (rect.width - sw) / 2 : clamp(v.x, rect.width - sw, 0),
      y: sh <= rect.height ? (rect.height - sh) / 2 : clamp(v.y, rect.height - sh, 0),
    };
  }, []);

  // Zoom AU CURSEUR : le point sous la souris ne bouge pas. Zoomer au centre
  // obligerait à repositionner après chaque cran, ce qui est exactement ce
  // qu'on essaie d'éviter quand on cherche un bord.
  const zoomAt = useCallback(
    (factor, px, py) =>
      setView((v) => {
        const z = clamp(v.z * factor, MIN_ZOOM, MAX_ZOOM);
        const k = z / v.z;
        return settle({ z, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
      }),
    [settle]
  );

  // La molette est posée À LA MAIN, en écouteur NON PASSIF : React attache
  // `onWheel` en passif, où `preventDefault` est sans effet — la modale
  // défilait donc sous le curseur pendant qu'on zoomait.
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(
        e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP,
        e.clientX - rect.left,
        e.clientY - rect.top
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, img]);

  const zoomCenter = (factor) => {
    const rect = viewRef.current?.getBoundingClientRect();
    if (rect) zoomAt(factor, rect.width / 2, rect.height / 2);
  };
  const fitView = () => setView({ z: 1, x: 0, y: 0 });

  useEffect(() => {
    let alive = true;
    loadImage(src).then((i) => {
      if (!alive) return;
      if (i) setImg(i);
      else setError("Image illisible (ou refusée par son hébergeur).");
    });
    return () => {
      alive = false;
    };
  }, [src]);

  // L'échelle se rapporte à la hauteur DU CADRE, pas de l'image : c'est la
  // jaquette qui fait 19 cm, pas la page du PDF qui la porte.
  const perPx = img ? heightCm / CM / (crop.h * img.height) : 0;

  // Le plancher du bandeau dépend de l'image, du cadre ET de la hauteur : 2 mm
  // ne représentent pas la même fraction sur un scan de 4000 px que sur une
  // vignette de 800. Recalculé plutôt que posé en dur, sinon le curseur laisse
  // atteindre des mesures que l'enregistrement refusera.
  const minSpine = useMemo(() => {
    if (!img || !perPx) return 0.004;
    return clamp(
      (MIN_SPINE_UNITS * 1.02) / (img.width * perPx),
      0.0005,
      MAX_SPINE * crop.w
    );
  }, [img, perPx, crop.w]);

  // --- Les mesures qui en sortent -----------------------------------------
  //
  // Le dos et la couverture doivent avoir la MÊME largeur : une boîte n'a
  // qu'une profondeur. Un scan a pourtant rarement deux marges égales, donc on
  // prend la moyenne des deux côtés — l'écart, de l'ordre du pour cent, se
  // solde en un cheveu d'étirement invisible, là où choisir un seul côté
  // décalerait franchement le dessin.
  const dims = useMemo(() => {
    if (!img) return null;
    const left = spineX - crop.x;
    const right = crop.x + crop.w - (spineX + spineW);
    const w = spineW * img.width * perPx;
    const d = ((left + right) / 2) * img.width * perPx;
    return {
      box: {
        w,
        h: heightCm / CM,
        d,
        spineX,
        spineW,
        cropX: crop.x,
        cropY: crop.y,
        cropW: crop.w,
        cropH: crop.h,
      },
      cm: { w: w * CM, h: heightCm, d: d * CM },
      lean: Math.abs(left - right) * img.width * perPx * CM,
      // Ce qui restera vraiment de l'image, une fois la fenêtre découpée.
      px: [Math.round(img.width * crop.w), Math.round(img.height * crop.h)],
    };
  }, [img, heightCm, spineX, spineW, crop, perPx]);

  // --- Le geste. Cadre et bandeau passent par le même suivi de pointeur : ce
  //     qui change d'une poignée à l'autre, c'est seulement ce qu'on recalcule.
  const floor = useRef(0.004);
  floor.current = minSpine;

  const onPointerMove = useCallback((e) => {
    const g = drag.current;
    if (!g) return;

    // Le fond sert À LA FOIS à déplacer la vue et à poser le bandeau d'un clic.
    // On tranche au mouvement : au-delà de quelques pixels, c'est un
    // déplacement ; en deçà, ce sera un clic quand le doigt se lèvera.
    if (g.mode === "pan") {
      if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) g.moved = true;
      if (!g.moved) return;
      setView((v) => settle({ ...v, x: g.vx + (e.clientX - g.x), y: g.vy + (e.clientY - g.y) }));
      return;
    }

    // `g.w` est la largeur du calque APRÈS grossissement : les fractions sont
    // donc justes à n'importe quel niveau de zoom, sans terme correctif.
    const dx = (e.clientX - g.x) / g.w;
    const dy = (e.clientY - g.y) / g.h;
    const min = floor.current;
    const c = g.crop;

    switch (g.mode) {
      case "move":
        // Le bandeau reste dans le cadre : c'est une tranche, pas un cache.
        setSpineX(clamp(g.sx + dx, c.x, c.x + c.w - g.sw));
        break;
      case "spine-l": {
        const right = g.sx + g.sw;
        const x = clamp(g.sx + dx, c.x, right - min);
        setSpineX(x);
        setSpineW(clamp(right - x, min, MAX_SPINE * c.w));
        break;
      }
      case "spine-r":
        setSpineW(clamp(g.sw + dx, min, Math.min(MAX_SPINE * c.w, c.x + c.w - g.sx)));
        break;
      // Les quatre bords du cadre. Chacun ne bouge QUE son côté : l'opposé
      // reste où il est, sinon régler une marge déplacerait celle d'en face.
      case "crop-l": {
        const right = c.x + c.w;
        const x = clamp(c.x + dx, 0, right - MIN_CROP);
        setCrop((p) => ({ ...p, x, w: right - x }));
        setSpineX((s) => Math.max(s, x));
        break;
      }
      case "crop-r": {
        const w = clamp(c.w + dx, MIN_CROP, 1 - c.x);
        setCrop((p) => ({ ...p, w }));
        setSpineX((s) => Math.min(s, c.x + w - g.sw));
        break;
      }
      case "crop-t": {
        const bottom = c.y + c.h;
        const y = clamp(c.y + dy, 0, bottom - MIN_CROP);
        setCrop((p) => ({ ...p, y, h: bottom - y }));
        break;
      }
      case "crop-b":
        setCrop((p) => ({ ...p, h: clamp(c.h + dy, MIN_CROP, 1 - c.y) }));
        break;
      default:
        break;
    }
  }, [settle]);

  const onPointerUp = useCallback((e) => {
    const g = drag.current;
    drag.current = null;
    // Fond cliqué sans avoir bougé : le bandeau vient s y centrer. Plus direct
    // que de le faire glisser depuis l autre bout d une jaquette large.
    // Bouton principal SEULEMENT : le clic droit sert à se déplacer (comme
    // dans la vitrine du rayon), il n'a pas à poser la tranche au passage.
    if (g?.mode === "pan" && !g.moved && g.button === 0) {
      const rect = frameRef.current?.getBoundingClientRect();
      if (!rect) return;
      const at = (e.clientX - rect.left) / rect.width;
      // Pas de `||` ici : un cadre commençant à 0 donne un résultat de 0, que le
      // repli aurait pris pour « rien » — le bandeau refusait alors d'aller au
      // bord gauche, et seulement là.
      setSpineX(clamp(at - g.sw / 2, g.crop.x, g.crop.x + g.crop.w - g.sw));
    }
  }, []);

  // Le suivi vit sur la FENÊTRE, pas sur les poignées : une poignée fait
  // quelques pixels de large, et le curseur la quitte au premier geste vif. Sur
  // la fenêtre, on peut sortir du cadre et revenir sans lâcher.
  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  function grab(mode) {
    return (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = frameRef.current?.getBoundingClientRect();
      if (!rect) return;
      drag.current = {
        mode,
        x: e.clientX,
        y: e.clientY,
        w: rect.width,
        h: rect.height,
        sx: spineX,
        sw: spineW,
        crop,
        vx: view.x,
        vy: view.y,
        button: e.button,
      };
    };
  }

  // Le plancher n'est connu qu'une fois l'image chargée, et il bouge avec le
  // cadre : une valeur héritée peut donc se retrouver en dessous. On la remonte
  // ici plutôt que de laisser l'enregistrement échouer tout à la fin.
  useEffect(() => {
    setSpineW((v) => (v < minSpine ? minSpine : v));
  }, [minSpine]);

  function autoCrop() {
    if (!img) return;
    const found = detectEdges(img);
    if (!found) {
      setNote("Aucun bord blanc trouvé — le cadre reste tel quel.");
      return;
    }
    setCrop(found);
    setSpineX((s) => clamp(s, found.x, found.x + found.w - spineW));
    setNote(
      `Cadre posé sur l'illustration : ${fmt(found.w * 100, 0)} % × ${fmt(
        found.h * 100,
        0
      )} % de l'image.`
    );
  }

  const recenter = () => setSpineX(crop.x + crop.w / 2 - spineW / 2);

  function reset() {
    const w = Math.max(0.03, minSpine);
    setCrop({ x: 0, y: 0, w: 1, h: 1 });
    setSpineW(w);
    setSpineX(0.5 - w / 2);
    setHeightCm(19);
    setNote(null);
    fitView();
  }

  async function apply() {
    if (!dims) return;
    setBusy(true);
    try {
      await onApply(dims.box);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const ratio = img ? img.width / img.height : 2;
  const pc = (v) => `${v * 100}%`;
  // Positions RELATIVES AU CADRE : les panneaux et le bandeau vivent dedans.
  const bandLeft = crop.w ? (spineX - crop.x) / crop.w : 0;
  const bandWidth = crop.w ? spineW / crop.w : 0;

  return (
    <div className="wrapcrop" onClick={onCancel}>
      <div className="wrapcrop-sheet" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h3>Mesurer le boîtier</h3>
            <p>Pose le cadre sur la jaquette, le bandeau sur la tranche.</p>
          </div>
          <button className="adm-coll-icon clickable" onClick={onCancel} aria-label="Fermer">
            <X size={16} />
          </button>
        </header>

        <div className="wrapcrop-stage">
          {/* La fenêtre découpe, le calque grossit. `--z` redescend jusqu'aux
              poignées, qui se contre-mettent à l'échelle : à ×8, un repère de
              4 px deviendrait un pavé de 32 px et couvrirait ce qu'on vise. */}
          <div
            className={`wrapcrop-view ${view.z > 1.001 ? "zoomed" : ""}`}
            ref={viewRef}
            style={{ aspectRatio: ratio }}
            onPointerDown={grab("pan")}
            // Sans ça, se déplacer au clic droit fait surgir le menu du
            // navigateur à chaque relâchement — c'est le geste de déplacement
            // de la vitrine du rayon, il doit se comporter pareil ici.
            onContextMenu={(e) => e.preventDefault()}
          >
          <div
            className="wrapcrop-frame"
            ref={frameRef}
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
              "--z": view.z,
            }}
          >
            {img ? (
              <>
                <img src={src} alt="" draggable={false} />

                {/* Le cadre. Son ombre portée démesurée assombrit d'un seul
                    trait tout ce qui l'entoure : ce qui reste hors de la
                    jaquette, et qui sera coupé. */}
                <span
                  className="wrapcrop-crop"
                  style={{
                    left: pc(crop.x),
                    top: pc(crop.y),
                    width: pc(crop.w),
                    height: pc(crop.h),
                  }}
                >
                  <span className="wrapcrop-panel back" style={{ width: pc(bandLeft) }}>
                    <b>Dos</b>
                  </span>
                  <span
                    className="wrapcrop-panel front"
                    style={{ width: pc(1 - bandLeft - bandWidth) }}
                  >
                    <b>Couverture</b>
                  </span>

                  <span
                    className="wrapcrop-band"
                    style={{ left: pc(bandLeft), width: pc(bandWidth) }}
                    onPointerDown={grab("move")}
                  >
                    <i className="wrapcrop-grip left" onPointerDown={grab("spine-l")} />
                    <i className="wrapcrop-grip right" onPointerDown={grab("spine-r")} />
                  </span>

                  <i className="wrapcrop-edge l" onPointerDown={grab("crop-l")} />
                  <i className="wrapcrop-edge r" onPointerDown={grab("crop-r")} />
                  <i className="wrapcrop-edge t" onPointerDown={grab("crop-t")} />
                  <i className="wrapcrop-edge b" onPointerDown={grab("crop-b")} />
                </span>
              </>
            ) : (
              <span className="wrapcrop-load">
                {error || <Loader2 size={22} className="spin" />}
              </span>
            )}
          </div>

            <div className="wrapcrop-zoom" onPointerDown={(e) => e.stopPropagation()}>
              <button
                className="clickable"
                type="button"
                onClick={() => zoomCenter(1 / ZOOM_STEP)}
                title="Dézoomer (molette)"
                disabled={view.z <= MIN_ZOOM + 1e-6}
              >
                <ZoomOut size={14} />
              </button>
              <b>{Math.round(view.z * 100)} %</b>
              <button
                className="clickable"
                type="button"
                onClick={() => zoomCenter(ZOOM_STEP)}
                title="Zoomer (molette)"
                disabled={view.z >= MAX_ZOOM - 1e-6}
              >
                <ZoomIn size={14} />
              </button>
              <button
                className="clickable"
                type="button"
                onClick={fitView}
                title="Revoir toute l'image"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>

          {/* L'objet tel qu'il sera : deux rectangles aux proportions calculées.
              C'est le seul retour qui dise vraiment « voilà l'épaisseur que tu
              es en train de régler ». */}
          {dims && (
            <aside className="wrapcrop-out">
              <span className="wrapcrop-out-label">
                <Ruler size={13} /> Le boîtier obtenu
              </span>
              <div className="wrapcrop-solid">
                <span
                  className="wrapcrop-solid-spine"
                  style={{ "--w": dims.cm.w, "--h": dims.cm.h }}
                />
                <span
                  className="wrapcrop-solid-face"
                  style={{ "--w": dims.cm.d, "--h": dims.cm.h }}
                />
              </div>
              <dl className="wrapcrop-specs">
                <div>
                  <dt>Hauteur</dt>
                  <dd>{fmt(dims.cm.h)} cm</dd>
                </div>
                <div>
                  <dt>Largeur</dt>
                  <dd>{fmt(dims.cm.d)} cm</dd>
                </div>
                <div>
                  <dt>Tranche</dt>
                  <dd>{fmt(dims.cm.w * 10, 0)} mm</dd>
                </div>
                <div>
                  <dt>Image gardée</dt>
                  <dd>
                    {dims.px[0]} × {dims.px[1]}
                  </dd>
                </div>
              </dl>
              {dims.lean > 0.4 && (
                <p className="wrapcrop-lean">
                  Le bandeau est décentré de {fmt(dims.lean)} cm : le dos et la
                  couverture n'auront pas tout à fait la même largeur.
                </p>
              )}
            </aside>
          )}
        </div>

        <div className="wrapcrop-controls">
          <label className="wrapcrop-ctl grow">
            <span>Tranche</span>
            <input
              type="range"
              min={minSpine}
              max={MAX_SPINE * crop.w}
              step={0.0005}
              value={spineW}
              onChange={(e) => {
                const v = Number(e.target.value);
                // On élargit par le CENTRE : sinon le bandeau glisse vers la
                // droite pendant qu'on l'épaissit, et il faut le repositionner
                // à chaque cran.
                setSpineX((x) => clamp(x + (spineW - v) / 2, crop.x, crop.x + crop.w - v));
                setSpineW(v);
              }}
              disabled={!img}
            />
          </label>

          <div className="wrapcrop-ctl">
            <span>Hauteur réelle</span>
            <div className="wrapcrop-heights">
              {STANDARDS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`wrapcrop-std clickable ${
                    Math.abs(heightCm - s.cm) < 0.05 ? "on" : ""
                  }`}
                  onClick={() => setHeightCm(s.cm)}
                >
                  {s.label}
                </button>
              ))}
              <span className="wrapcrop-cm">
                <input
                  type="number"
                  min={4}
                  max={48}
                  step={0.1}
                  value={heightCm}
                  onChange={(e) => setHeightCm(clamp(Number(e.target.value) || 0, 4, 48))}
                />
                cm
              </span>
            </div>
          </div>

          <button
            className="adm-coll-icon clickable"
            onClick={autoCrop}
            title="Poser le cadre sur l'illustration (écarte les bords blancs)"
            type="button"
            disabled={!img}
          >
            <Scissors size={15} />
          </button>
          <button
            className="adm-coll-icon clickable"
            onClick={recenter}
            title="Recentrer la tranche"
            type="button"
          >
            <AlignCenter size={15} />
          </button>
          <button
            className="adm-coll-icon clickable"
            onClick={reset}
            title="Tout réinitialiser"
            type="button"
          >
            <RotateCcw size={15} />
          </button>
        </div>

        <p className="wrapcrop-help">
          Molette pour zoomer, glisser sur le fond (ou au clic droit) pour se
          déplacer, clic simple pour poser le bandeau. Tire les bords du cadre pour écarter les marges
          blanches — le haut et le bas valent pour les trois panneaux. Les
          ciseaux posent le cadre tout seuls.
        </p>

        {note && <p className="wrapcrop-note">{note}</p>}
        {error && img && <p className="adm-coll-error">{error}</p>}

        <footer className="adm-coll-foot">
          <button className="btn btn-ghost clickable" onClick={onCancel}>
            Annuler
          </button>
          <button
            className="btn btn-primary clickable"
            onClick={apply}
            disabled={!img || busy}
          >
            {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
            Utiliser ces dimensions
          </button>
        </footer>
      </div>
    </div>
  );
}
