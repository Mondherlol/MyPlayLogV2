import sharp from "sharp";
import smartcrop from "smartcrop";

// ======================================================================
//  Le cadrage des jaquettes sur les cartes
// ======================================================================
// La fenêtre d'une carte est plus large que haute ; la jaquette, l'inverse.
// On y montre donc un MORCEAU de la jaquette, choisi par smartcrop : il cherche
// la zone qui compte (visages, couleurs, détails) et évite les bords vides.
//
// `focus` = le rectangle retenu, en fractions de la jaquette ({ x, y, w, h }),
// indépendant de la taille servie par IGDB : le client le rejoue sur la
// vignette comme sur la version 2×.
//
// PAS DE ZONE D'INTÉRÊT → PAS DE CADRAGE (`focus: null`) : une jaquette grise
// ou au trait (ni peau ni couleur dans le meilleur cadrage) se montre alors
// entière, sur son fond flouté — la rogner ne montrerait qu'un bout au hasard.

// Largeur / hauteur de la fenêtre d'image d'une carte (cf. .tcg-art en CSS :
// 86,6 × 74,2 cqw une fois les bords ôtés).
export const ART_RATIO = 86.6 / 74.2;

// smartcrop travaille sur des pixels bruts : on lui prête sharp pour ouvrir,
// réduire et lire l'image (le paquet « smartcrop-sharp » exige une vieille
// version de sharp).
const iop = {
  open: async (buf) => {
    const m = await sharp(buf).metadata();
    return { width: m.width, height: m.height, buf };
  },
  resample: async (img, w, h) => ({
    width: ~~w,
    height: ~~h,
    buf: await sharp(img.buf).resize(~~w, ~~h, { fit: "fill" }).toBuffer(),
  }),
  getData: async (img) => {
    const { data, info } = await sharp(img.buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return new smartcrop.ImgData(info.width, info.height, data);
  },
};

/** Le cadrage d'une jaquette IGDB (image_id), ou null s'il n'y a rien à viser. */
export async function coverFocus(coverId) {
  const res = await fetch(`https://images.igdb.com/igdb/image/upload/t_cover_big/${coverId}.jpg`);
  if (!res.ok) throw new Error(`jaquette ${coverId} : ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  const { topCrop: c } = await smartcrop.crop(buf, {
    width: 100 * ART_RATIO,
    height: 100,
    // Un léger zoom est permis (15 %), pas plus : la jaquette est petite.
    minScale: 0.85,
    // Les personnages avant le texte : le lettrage d'un titre est très
    // « détaillé » et gagnait souvent sur le héros.
    detailWeight: 0.06,
    skinWeight: 2.6,
    saturationWeight: 0.35,
    imageOperations: iop,
  });
  if (!c || (c.score.skin <= 0 && c.score.saturation <= 1)) return null;
  const r = (v) => Math.round(v * 10000) / 10000;
  return {
    x: r(c.x / meta.width),
    y: r(c.y / meta.height),
    w: r(c.width / meta.width),
    h: r(c.height / meta.height),
  };
}
