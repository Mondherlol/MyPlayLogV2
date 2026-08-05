// ======================================================================
//  La carrosserie d un boîtier — géométrie pure
// ======================================================================
// Séparé du composant : c est du calcul de sommets, sans React ni WebGL, donc
// vérifiable tel quel hors navigateur (ce que la scène 3D, elle, ne permet pas).
import * as THREE from "three";
import { paintPageEdge, paintPlankFibres, paintShade } from "./collection";

//
// UN BOÎTIER N'EST PAS UN CUBE AVEC DES IMAGES COLLÉES DESSUS.
//
// L'ancienne fabrication posait trois plans plats sur une boîte aux arêtes
// arrondies. Au ras de chaque arête le plan s'arrêtait net, et la coque nue
// reparaissait dessous : d'où la COUPURE qu'on voyait entre la face et le
// bord, et cette impression de carton plié à angle droit sur un objet rond.
// Aucun réglage de retrait ne pouvait la faire disparaître — un plan est plat,
// une arête est courbe, ils ne se rejoignent nulle part.
//
// Ici la jaquette est UNE SEULE SURFACE qui fait le tour. On dessine le CONTOUR
// de la section (vue de dessus : un rectangle dont les deux arêtes verticales
// côté tranche sont franchement arrondies — c'est là qu'on regarde quand les
// boîtiers sont rangés), on l'extrude sur la hauteur, et on répartit la texture
// le long de ce contour PAR LONGUEUR D'ARC. Le papier suit donc la courbe au
// lieu de la sauter, et les deux plis de l'impression tombent au milieu des
// deux arrondis — exactement là où une vraie jaquette se plie.

// Segments par quart d'arrondi. Au-delà de douze, on paie des triangles sur
// toute la hauteur du boîtier sans que l'œil distingue quoi que ce soit.
export const ARC_SEG = 12;

// Arrondi des arêtes verticales. Sur un vrai boîtier, la courbe entre la
// tranche et les faces est généreuse — de l'ordre du cinquième de l'épaisseur —
// et c'est justement celle-là qu'on regarde. Bornée aussi par la profondeur
// pour ne pas déformer un boîtier très fin.
export const edgeRadius = (box) => Math.min(box.w * 0.22, box.d * 0.06);

// Le contour de la section, du bord d'ouverture du DOS au bord d'ouverture de
// la COUVERTURE : c'est la course exacte du papier. `closed` le referme par le
// chant d'ouverture pour obtenir la coque entière.
//
// Renvoie l'indice des deux POINTS DE PLI (le milieu de chaque arrondi), là où
// doivent tomber les traits d'impression de la jaquette.
export function sectionPath(w, d, r, r2, closed) {
  const pts = [];
  const arc = (cx, cz, rad, from, to, seg) => {
    for (let i = 1; i <= seg; i++) {
      const a = from + (to - from) * (i / seg);
      pts.push([cx + Math.cos(a) * rad, cz + Math.sin(a) * rad]);
    }
  };

  pts.push([-w / 2, -d / 2 + r2]); // bord d'ouverture, côté dos
  pts.push([-w / 2, d / 2 - r]); // fin de la face dos
  const foldA = pts.length + ARC_SEG / 2 - 1;
  arc(-w / 2 + r, d / 2 - r, r, Math.PI, Math.PI / 2, ARC_SEG);
  pts.push([w / 2 - r, d / 2]); // fin de la tranche
  const foldB = pts.length + ARC_SEG / 2 - 1;
  arc(w / 2 - r, d / 2 - r, r, Math.PI / 2, 0, ARC_SEG);
  pts.push([w / 2, -d / 2 + r2]); // bord d'ouverture, côté couverture

  if (closed) {
    // Le chant d'ouverture : à peine cassé, c'est un bord de plastique.
    arc(w / 2 - r2, -d / 2 + r2, r2, 0, -Math.PI / 2, 3);
    pts.push([-w / 2 + r2, -d / 2]);
    arc(-w / 2 + r2, -d / 2 + r2, r2, -Math.PI / 2, -Math.PI, 3);
    pts.pop(); // le dernier point retombe sur le premier : la forme se referme
  }
  return { pts, foldA, foldB };
}

// --------------------------------------------------------------- rubans --
//
// TOUT CE QUI EST HABILLÉ DE PAPIER DANS CETTE SECTION EST UN RUBAN : un profil
// dessiné dans le plan (x, z) — la section vue de dessus — extrudé sur la
// hauteur. La jaquette d'un boîtier, la couverture d'un volume, le dos qui se
// déplie quand on l'ouvre et jusqu'à la page qui se tourne sont le MÊME objet,
// à un profil près. D'où un seul constructeur, et surtout une seule mise à jour :
// les profils qui bougent (le dos, la page) se recalculent à chaque image sans
// jamais réallouer de tampon.

export function ribbonGeometry(pts, u, height) {
  const geo = new THREE.BufferGeometry();
  const n = pts.length;
  const uvs = [];
  const idx = [];
  for (let i = 0; i < n; i++) uvs.push(u[i], 0, u[i], 1);
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  return ribbonUpdate(geo, pts, height);
}

// Repose les sommets d'un ruban sur un nouveau profil. Le nombre de points ne
// change JAMAIS entre deux appels : c'est ce qui permet de déformer une page en
// pleine rotation sans allouer quoi que ce soit.
export function ribbonUpdate(geo, pts, height) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const top = height / 2;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const m = Math.hypot(tx, tz) || 1;
    tx /= m;
    tz /= m;
    // Normale extérieure : la tangente tournée d'un quart de tour. Prise sur
    // les deux points VOISINS, elle est moyennée d'elle-même, donc l'ombrage
    // traverse les courbes sans facette visible.
    pos.setXYZ(i * 2, pts[i][0], -top, pts[i][1]);
    pos.setXYZ(i * 2 + 1, pts[i][0], top, pts[i][1]);
    nrm.setXYZ(i * 2, -tz, 0, tx);
    nrm.setXYZ(i * 2 + 1, -tz, 0, tx);
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
  geo.computeBoundingSphere();
  return geo;
}

// Répartit la feuille imprimée le long d'un profil, PAR LONGUEUR D'ARC : c'est
// elle, et non l'angle ou l'indice du point, qui commande — sinon le dessin
// s'étire dans les courbes. Les plis de l'impression atterrissent aux deux
// indices donnés, donc la tranche imprimée occupe la tranche réelle.
export function panelUvs({ pts, foldA, foldB }, cuts) {
  const len = [0];
  for (let i = 1; i < pts.length; i++) {
    len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = len[len.length - 1];
  const la = len[foldA];
  const lb = len[foldB];
  const backW = cuts?.x ?? 0.45;
  const spineW = cuts?.w ?? 0.1;
  return len.map((l) => {
    if (l <= la) return (l / la) * backW;
    if (l <= lb) return backW + ((l - la) / (lb - la)) * spineW;
    return backW + spineW + ((l - lb) / (total - lb)) * (1 - backW - spineW);
  });
}

// La jaquette d'un boîtier : le contour extrudé, avec ses UV par longueur d'arc.
export function paperGeometry(box, cuts) {
  const gap = 0.0014; // l'épaisseur du carton : le papier passe DEVANT la coque
  const r = edgeRadius(box);
  const section = sectionPath(
    box.w + gap * 2,
    box.d + gap * 2,
    r + gap,
    r * 0.4 + gap,
    false
  );
  // Un cheveu de plastique en haut et en bas, comme sur l'objet réel.
  return ribbonGeometry(section.pts, panelUvs(section, cuts), box.h * 0.99);
}

// ============================================================== le volume ==
//
// UN LIVRE N'EST PAS UN BOÎTIER, ET ÇA SE VOIT D'ABORD À SA TRANCHE.
//
// Un boîtier DVD a un dos plat, deux arêtes vives, une coque de plastique qui
// déborde et une rainure d'ouverture sur le chant opposé. Un volume broché n'a
// rien de tout ça : son dos est une DEMI-LUNE (la colle et le mors arrondissent
// le cahier), sa couverture épouse cette courbe sans jamais s'en détacher, et
// surtout il montre du PAPIER — le chant du bloc de pages, en retrait de la
// couverture sur les trois côtés ouverts.
//
// Ces trois signes suffisent : de loin, sur l'étagère, un volume ne se confond
// plus avec un DVD même quand on n'en voit que la tranche.

// L'épaisseur de la couverture. Purement visuelle : elle ne sert qu'à décoller
// les plats du bloc pour qu'aucune face ne soit coplanaire avec une autre.
export const COVER = 0.0012;

// La CHASSE : ce dont la couverture déborde du bloc sur les trois côtés
// ouverts. ≈ 2 mm à l'échelle du monde (1 unité ≈ 16 cm). C'est elle qui
// protège les pages, et c'est elle qu'on voit en bordure quand le volume est
// ouvert — sans elle, les pages affleurent et l'objet redevient une brique.
export const SQUARE = 0.013;

// Le contour d'un volume, du bord d'ouverture du plat verso au bord d'ouverture
// du plat recto. Le dos est une demi-lune de rayon w/2 : la couverture y arrive
// tangente des deux côtés, donc sans arête. Les deux plis d'impression tombent
// aux extrémités de cette demi-lune — le dos imprimé occupe exactement le dos.
export function bookSection(w, d, seg = ARC_SEG * 2) {
  const r = w / 2;
  const cz = d / 2 - r; // centre de la demi-lune
  const pts = [
    [-w / 2, -d / 2],
    [-w / 2, cz],
  ];
  const foldA = pts.length - 1;
  for (let i = 1; i <= seg; i++) {
    const a = Math.PI * (1 - i / seg);
    pts.push([Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  const foldB = pts.length - 1;
  pts.push([w / 2, -d / 2]);
  return { pts, foldA, foldB };
}

// La couverture : le contour extrudé sur toute la hauteur. Pas de retrait en
// haut ni en bas comme sur un boîtier — c'est la couverture qui dépasse, pas
// le plastique.
export function bookCoverGeometry(box, cuts) {
  const section = bookSection(box.w, box.d);
  return ribbonGeometry(section.pts, panelUvs(section, cuts), box.h);
}

// Les cotes du bloc de pages et sa place dans la couverture. Le bloc s'arrête à
// la CORDE de la demi-lune : ce qui dépasse au-delà, c'est le dos arrondi, et
// il doit rester creux.
export function blockOf(box) {
  const d = Math.max(0.05, box.d - SQUARE - box.w / 2);
  return {
    w: Math.max(0.004, box.w - COVER * 2),
    h: Math.max(0.05, box.h - SQUARE * 2),
    d,
    z: -box.d / 2 + SQUARE + d / 2,
  };
}

// Le bloc lui-même. Une boîte, et c'est tout : ce qui la fait lire comme du
// papier n'est pas sa forme mais son chant (voir `pageEdgeTexture`).
export function bookBlockGeometry(box) {
  const b = blockOf(box);
  const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
  geo.translate(0, 0, b.z);
  return geo;
}

// LE CHANT DU BLOC — quelques centaines de fils crème, sur une seule ligne de
// texture. Une couleur unie donnerait un savon ; ces fils donnent des pages.
//
// L'orientation n'est pas un hasard : les traits courent le long de `u`, donc
// dans le SENS D'EMPILEMENT des pages. Sur un volume rangé (empilé selon x),
// c'est juste sur le dessus et sur le chant ; ouvert (empilé selon z), c'est
// juste sur les deux gouttières — les deux faces qu'on regarde dans chaque cas.
//
// Une seule texture pour toute l'application : elle ne dépend d'aucun titre, et
// three.js garde son état GPU par renderer — le rayon et le lecteur peuvent
// donc la partager sans qu'elle soit téléversée deux fois par scène.
let edgeTexture = null;
export function pageEdgeTexture() {
  if (!edgeTexture) {
    edgeTexture = new THREE.CanvasTexture(paintPageEdge());
    edgeTexture.colorSpace = THREE.SRGBColorSpace;
    edgeTexture.wrapS = THREE.RepeatWrapping;
    edgeTexture.wrapT = THREE.RepeatWrapping;
    edgeTexture.anisotropy = 4;
  }
  return edgeTexture;
}

// ------------------------------------------------------------- la planche --
//
// LA MATIÈRE DE LA TABLETTE qui porte tout ça. Elle n'appartient à aucun titre,
// elle est donc peinte une fois pour toute l'application, comme le chant du
// bloc de pages juste au-dessus.
//
// DEUX TEXTURES POUR UN SEUL DESSIN. Le chant de la planche est un demi-cylindre
// couché : ses UV tournent d'un quart de tour par rapport à celles du dessus, et
// sans ce quart de tour les fibres traverseraient le chant en travers — un
// peigne, pas du bois. La copie PARTAGE l'image (three garde son état GPU par
// source) : seul le repère change.
//
// Le nombre de carreaux, lui, dépend de la largeur de chaque planche : il se
// règle sur la copie, côté scène.
let plankTex = null;
export function plankTextures() {
  if (!plankTex) {
    const top = new THREE.CanvasTexture(paintPlankFibres());
    top.colorSpace = THREE.SRGBColorSpace;
    top.wrapS = THREE.RepeatWrapping;
    top.wrapT = THREE.RepeatWrapping;
    // Le chant est vu très rasant, et de plus en plus à mesure qu'une rangée
    // s'éloigne du niveau de l'œil : sans filtrage anisotrope, le fil s'y
    // écrase en moiré.
    top.anisotropy = 8;
    const nose = top.clone();
    nose.center.set(0.5, 0.5);
    nose.rotation = Math.PI / 2;
    plankTex = { top, nose };
  }
  return plankTex;
}

// Le dégradé d'ombre de la planche — contact et ombre portée. Noir : seul son
// alpha sert.
let shadeTex = null;
export function shadeTexture() {
  if (!shadeTex) {
    shadeTex = new THREE.CanvasTexture(paintShade());
    shadeTex.wrapS = THREE.ClampToEdgeWrapping;
    shadeTex.wrapT = THREE.ClampToEdgeWrapping;
  }
  return shadeTex;
}

// La coque : le même contour, refermé, extrudé et bouché aux deux bouts. On ne
// lui demande ni UV soignées ni biseau — c'est du plastique uni, et elle ne se
// voit que par le dessus, le dessous et le chant d'ouverture.
export function shellGeometry(box) {
  const r = edgeRadius(box);
  const { pts } = sectionPath(box.w, box.d, r, r * 0.4, true);
  const shape = new THREE.Shape(
    // `-z` : l'extrusion se fait sur l'axe Z de la forme, qu'on redresse
    // ensuite en Y d'un quart de tour — lequel renverse l'axe Z du monde. On
    // le renverse donc en amont, ce qui remet du même coup le contour dans le
    // sens antihoraire attendu pour que les normales sortent.
    pts.map(([x, z]) => new THREE.Vector2(x, -z))
  );
  const geo = new THREE.ExtrudeGeometry(shape, { depth: box.h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -box.h / 2, 0);
  return geo;
}

