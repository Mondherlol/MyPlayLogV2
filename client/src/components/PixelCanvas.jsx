import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

// ============================================================
//  Le canvas pixelisé
// ============================================================
// On réduit l'image à `blocks` pixels de large sur un canvas hors écran (le
// navigateur moyenne les couleurs, ce qui donne de vrais gros pixels propres),
// puis on la ré-étire SANS lissage. Avec `reveal`, on dessine l'image nette.
//
// Partagé par Pixel Rush (une capture 16/9 par manche, carte d'accueil au
// format jaquette), par le versus et par la carte du jeu dans l'arcade. Les
// styles vivent dans styles/app-22-pixel.css (.px-canvas*).
//
// ---------------------------------------------------------------- deux aides
// Depuis qu'il n'y a PLUS QU'UNE capture par manche, la manche se joue sur une
// seule image : il fallait de quoi la fouiller, sinon on la regarde dix
// secondes et on n'a plus rien à faire.
//
//   • LE COIN LIBRE (`clear`) — un angle de l'image échappe à la pixelisation
//     et reste net. C'est le point d'accroche : un bout d'ATH, un morceau de
//     logo, une texture. Il est petit, il est TOUJOURS dans un coin (donc il
//     ne mange pas le sujet), et le serveur décide lequel pour que tout le
//     monde ait le même en versus.
//   • LA LOUPE (`loupe`) — au survol, un disque suit le curseur et redessine
//     CETTE ZONE-LÀ avec sa propre définition, bien plus fine. On ne voit
//     jamais l'image nette, mais on peut scruter un détail. Sur mobile, elle
//     suit le doigt.
//
// Les deux passent par le même canvas : la loupe est un second canvas dessiné
// à la demande, et le coin libre un simple `drawImage` de plus par-dessus les
// gros pixels.

// Résolution par défaut : le 16/9 des captures. L'image est dessinée dans le
// canvas puis étirée par le CSS — `w`/`h` ne font que fixer le CADRAGE.
const CV_W = 960;
const CV_H = 540;

// Part de la largeur/hauteur laissée nette dans le coin libre.
const CLEAR_FRAC = 0.26;
// Côté du canvas de la loupe, et part de l'image qu'elle embrasse (un carré de
// ~22 % de la largeur).
const LOUPE_PX = 260;
const LOUPE_FRAC = 0.22;
// LA LOUPE NE DÉPIXELISE PAS, ELLE DÉTAILLE. Sa définition était absolue (26
// blocs sur 22 % de l'image, soit ~120 blocs à l'échelle de l'image entière
// contre 9 à 24 autour) : on lisait l'ATH, on reconnaissait un visage — la
// manche était pliée au premier survol.
//
// Elle est donc RELATIVE à la définition du moment : la zone visée vaut
// toujours LOUPE_GAIN fois ce qu'on voit ailleurs, jamais plus. À la fin d'une
// manche, ça plafonne autour de 55 blocs sur la largeur de l'image — de quoi
// distinguer une silhouette d'un décor, pas de quoi lire quoi que ce soit. Et
// comme le rapport est constant, la loupe garde le même intérêt du début à la
// fin au lieu de tout donner d'un coup.
const LOUPE_GAIN = 2.3;
// Plancher : en tout début de manche, `blocks × gain × frac` tomberait sous 4
// blocs — un damier de quatre carrés ne montre plus rien du tout.
const LOUPE_MIN_BLOCKS = 6;

const CORNERS = { tl: [0, 0], tr: [1, 0], bl: [0, 1], br: [1, 1] };

export default function PixelCanvas({
  src,
  blocks,
  reveal,
  label,
  w = CV_W,
  h = CV_H,
  clear = null, // "tl" | "tr" | "bl" | "br" — coin laissé net
  loupe = false, // active la loupe au survol
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const loupeRef = useRef(null);
  const offRef = useRef(null);
  const lensOffRef = useRef(null); // canvas de réduction de la loupe, réutilisé
  const imgRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  // Position du curseur DANS l'image, en fractions (0→1). `null` = pas de loupe.
  const [lens, setLens] = useState(null);

  // Cadrage « cover » commun au canvas principal et à la loupe : la loupe doit
  // viser exactement ce que l'on voit, pas l'image d'origine.
  const cover = useCallback(
    (img) => {
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const sw = w / scale;
      const sh = h / scale;
      return { sw, sh, sx: (img.naturalWidth - sw) / 2, sy: (img.naturalHeight - sh) / 2 };
    },
    [w, h]
  );

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const img = imgRef.current;
    if (!cv || !img || !img.naturalWidth) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const { sx, sy, sw, sh } = cover(img);

    ctx.clearRect(0, 0, w, h);
    if (reveal) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      return;
    }

    const bw = Math.max(4, Math.round(blocks));
    const bh = Math.max(3, Math.round((bw * h) / w));
    const off = (offRef.current ||= document.createElement("canvas"));
    off.width = bw;
    off.height = bh;
    const octx = off.getContext("2d");
    if (!octx) return;
    octx.imageSmoothingEnabled = true; // réduction lissée = moyenne des blocs
    octx.clearRect(0, 0, bw, bh);
    octx.drawImage(img, sx, sy, sw, sh, 0, 0, bw, bh);
    ctx.imageSmoothingEnabled = false; // agrandissement en gros carrés nets
    ctx.drawImage(off, 0, 0, bw, bh, 0, 0, w, h);

    // Le coin libre, par-dessus : on redessine la portion correspondante de
    // l'image source, nette, dans son rectangle.
    const c = CORNERS[clear];
    if (c) {
      const cw = Math.round(w * CLEAR_FRAC);
      const ch = Math.round(h * CLEAR_FRAC);
      const dx = c[0] ? w - cw : 0;
      const dy = c[1] ? h - ch : 0;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        img,
        sx + (dx / w) * sw,
        sy + (dy / h) * sh,
        (cw / w) * sw,
        (ch / h) * sh,
        dx,
        dy,
        cw,
        ch
      );
    }
  }, [blocks, reveal, w, h, clear, cover]);

  // La loupe : un carré de l'image redessiné plus finement — mais TOUJOURS dans
  // le même rapport à la définition ambiante (cf. LOUPE_GAIN).
  const drawLens = useCallback(() => {
    const cv = loupeRef.current;
    const img = imgRef.current;
    if (!cv || !img || !lens) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const { sx, sy, sw, sh } = cover(img);
    // Fenêtre visée, bornée pour que la loupe ne sorte jamais de l'image.
    const fw = sw * LOUPE_FRAC;
    const fh = sh * LOUPE_FRAC;
    const fx = Math.min(Math.max(sx + lens.x * sw - fw / 2, sx), sx + sw - fw);
    const fy = Math.min(Math.max(sy + lens.y * sh - fh / 2, sy), sy + sh - fh);

    // Combien de blocs dans le disque. `blocks` est la définition de l'image
    // entière : rapportée à la fenêtre, elle donne le nombre de blocs qu'on y
    // verrait sans loupe, qu'on multiplie par le gain.
    const n = Math.max(
      LOUPE_MIN_BLOCKS,
      Math.round(Math.max(4, blocks) * LOUPE_FRAC * LOUPE_GAIN)
    );

    // Réutilisé d'un mouvement de souris à l'autre : la loupe se redessine à
    // chaque pixel parcouru, on ne va pas allouer un canvas à chaque fois.
    const off = (lensOffRef.current ||= document.createElement("canvas"));
    off.width = n;
    off.height = n;
    const octx = off.getContext("2d");
    if (!octx) return;
    octx.clearRect(0, 0, n, n);
    octx.imageSmoothingEnabled = true;
    octx.drawImage(img, fx, fy, fw, fh, 0, 0, n, n);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, LOUPE_PX, LOUPE_PX);
    ctx.drawImage(off, 0, 0, n, n, 0, 0, LOUPE_PX, LOUPE_PX);
  }, [lens, cover, blocks]);

  useEffect(() => {
    setLoaded(false);
    imgRef.current = null;
    if (!src) return undefined;
    const img = new Image();
    // Pas de lecture de pixels (getImageData) : le canvas « teinté » ne pose
    // aucun problème, on ne fait que dessiner.
    img.decoding = "async";
    let alive = true;
    img.onload = () => {
      if (!alive) return;
      imgRef.current = img;
      setLoaded(true);
    };
    img.src = src;
    return () => {
      alive = false;
      img.onload = null;
    };
  }, [src]);

  useEffect(() => {
    if (loaded) draw();
  }, [loaded, draw]);

  useEffect(() => {
    if (loaded && lens) drawLens();
  }, [loaded, lens, drawLens]);

  // La loupe se coupe dès que l'image passe en net : à la révélation elle
  // n'apporte plus rien, et un disque qui traîne sur la réponse fait sale.
  const lensOn = loupe && !reveal;
  useEffect(() => {
    if (!lensOn) setLens(null);
  }, [lensOn]);

  const track = (e) => {
    if (!lensOn) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pt = e.touches?.[0] || e;
    const x = (pt.clientX - r.left) / r.width;
    const y = (pt.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return setLens(null);
    setLens({ x, y });
  };

  return (
    <div
      className={`px-canvas-wrap ${lensOn ? "lensable" : ""}`}
      ref={wrapRef}
      onMouseMove={track}
      onMouseLeave={() => setLens(null)}
      onTouchStart={track}
      onTouchMove={track}
      onTouchEnd={() => setLens(null)}
    >
      <canvas
        ref={canvasRef}
        width={w}
        height={h}
        className={`px-canvas ${reveal ? "sharp" : ""}`}
        aria-label={label}
      />
      {lensOn && lens && (
        <canvas
          ref={loupeRef}
          width={LOUPE_PX}
          height={LOUPE_PX}
          className="px-loupe"
          aria-hidden="true"
          style={{ left: `${lens.x * 100}%`, top: `${lens.y * 100}%` }}
        />
      )}
      {!loaded && (
        <span className="px-canvas-loading" aria-hidden="true">
          <Loader2 size={26} className="spin" />
        </span>
      )}
    </div>
  );
}
