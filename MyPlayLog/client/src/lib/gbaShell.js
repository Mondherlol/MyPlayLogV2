// ======================================================================
//  La coque : la Game Boy Advance, en géométrie
// ======================================================================
// LA CONSOLE EST DESSINÉE, PAS PHOTOGRAPHIÉE — et c'est un choix, pas un pis-
// aller. Le rayon DS reposait sur un PNG de DS Lite percé de deux trous : il
// fallait mesurer les trous au décodeur pour y glisser les dalles, relever les
// pastilles des touches sur des agrandissements gradués, et tout se décalait dès
// qu'on retouchait l'image. Un dessin vectoriel, lui, DIT où sont les choses :
// les mêmes nombres servent au tracé et aux zones cliquables, donc ils ne
// peuvent pas se contredire.
//
// C'est ce fichier qui les porte. GbaConsole trace la coque avec, GbaPlayer y
// pose l'iframe, gbaInput y attache les touches — une seule source.
//
// LES PROPORTIONS SONT CELLES DE L'OBJET : une AGB-001 fait 144,5 mm de large
// sur 82 de haut, son écran 61 × 41 (2,9 pouces en 3/2). Le repère compte donc
// en DIXIÈMES DE MILLIMÈTRE, ce qui a un avantage inattendu : on peut vérifier
// une cote à la règle sur une vraie console.

// La boîte du dessin. Plus haute que la console elle-même : les gâchettes L et R
// sont sur la TRANCHE, et de face elles dépassent du haut de la coque. Sans cette
// marge, elles seraient coupées.
const W = 1445;
const H = 860;
const BODY_TOP = 40; // le haut du plastique, sous les gâchettes

// Du rectangle en dixièmes de millimètre au pourcentage utilisable en CSS. Tout
// ce qui se pose sur la coque est exprimé EN POURCENTAGE, jamais en pixels : le
// dessin est mis à l'échelle par la fenêtre, et un décalage en pixels se verrait
// dès le premier redimensionnement.
const box = (x, y, w, h) => ({
  left: (x / W) * 100,
  top: (y / H) * 100,
  width: (w / W) * 100,
  height: (h / H) * 100,
});

// ---------------------------------------------------------------------------
//  Le tracé
// ---------------------------------------------------------------------------
// Les cotes brutes, telles que le SVG les emploie. Chacune a une raison :
//
//   body     — le plastique, coins très arrondis (les poignées de la console) ;
//   bezel    — le panneau noir autour de l'écran, un objet à part sur la vraie
//              console : il est en plastique brillant là où la coque est mate ;
//   screen   — la dalle utile. C'est LÀ que va l'iframe ;
//   dpad     — la croix, à gauche, sous le pouce ;
//   a / b    — les deux boutons, en diagonale (A en haut à droite de B) ;
//   l / r    — les gâchettes, sur la tranche haute ;
//   start /
//   select   — deux pastilles sous l'écran, à droite du centre ;
//   led      — le témoin d'alimentation, à gauche de l'écran.
export const GEO = {
  w: W,
  h: H,
  ratio: `${W} / ${H}`,
  body: { x: 0, y: BODY_TOP, w: W, h: H - BODY_TOP, r: 168 },
  // Le panneau serre l'écran d'à peine sept millimètres de chaque côté, comme
  // sur l'objet. À 556 de haut il laissait sous la dalle une bande noire aussi
  // large que l'écran : on croyait à un second écran éteint.
  bezel: { x: 412, y: 132, w: 620, h: 470, r: 44 },
  screen: { x: 476, y: 203, w: 492, h: 328 },
  // Le témoin d'alimentation est SUR LE PLASTIQUE, à gauche du panneau noir —
  // pas dedans. Posé à 452 il tombait sur la marge du bezel, où un point rouge
  // ressemble à un pixel mort de l'écran. Et remonté à 330 parce que son
  // étiquette « POWER », plus large que le point, venait sinon buter contre le
  // bras droit de la croix.
  led: { x: 378, y: 330, r: 13 },
  // Les zones tactiles / cliquables, par identifiant de bouton (voir
  // gbaInput.js pour ce que chacun DÉCLENCHE).
  spots: {
    up: { x: 179, y: 343, w: 78, h: 88 },
    down: { x: 179, y: 509, w: 78, h: 88 },
    left: { x: 91, y: 431, w: 88, h: 78 },
    right: { x: 257, y: 431, w: 88, h: 78 },
    b: { x: 1084, y: 454, w: 112, h: 112, round: true },
    a: { x: 1234, y: 380, w: 112, h: 112, round: true },
    // LES GÂCHETTES SONT SUR LA TRANCHE : de face, on n'en voit que l'arête qui
    // dépasse du haut de la coque, soit une cinquantaine d'unités. La zone
    // cliquable épouse cette arête et RIEN DE PLUS — plus haute, elle couvrait
    // cent unités de plastique où il n'y a rien, et son survol allumait un
    // rectangle au milieu de la coque.
    l: { x: 110, y: 6, w: 204, h: 50 },
    r: { x: 1131, y: 6, w: 204, h: 50 },
    // START et SELECT sont loin à droite, sous le panneau. Placés au centre, ils
    // passaient par-dessus la sérigraphie « GAME BOY ADVANCE » — qui occupe, sur
    // l'objet comme ici, tout le bas-gauche du panneau.
    //
    // Leur hauteur est celle de la LIGNE DE BASE DE LA SÉRIGRAPHIE (660) : posés
    // plus bas, ils tombaient tout seuls dans un coin et le bas de la coque se
    // lisait en deux étages. Alignés, ça fait une rangée.
    select: { x: 900, y: 636, w: 118, h: 40 },
    start: { x: 1046, y: 636, w: 118, h: 40 },
  },
};

// La même chose en pourcentage, pour le CSS. Calculée une fois : ces nombres ne
// bougent jamais, et les recalculer à chaque rendu de chaque bouton serait du
// travail pour rien.
export const PCT = {
  screen: box(GEO.screen.x, GEO.screen.y, GEO.screen.w, GEO.screen.h),
  spots: Object.fromEntries(
    Object.entries(GEO.spots).map(([id, s]) => [id, { ...box(s.x, s.y, s.w, s.h), round: !!s.round }])
  ),
};

// ---------------------------------------------------------------------------
//  Les dispositions
// ---------------------------------------------------------------------------
// DEUX, ET PAS CINQ. Le rayon DS en proposait cinq parce qu'il avait deux dalles
// à arranger (empilées, côte à côte, l'une seule, l'autre seule…) : autant de
// réglages qui existaient pour contourner un problème que la GBA n'a pas. Un seul
// écran, donc deux façons honnêtes de le regarder — dans la console, ou en grand.
//
// « Console » est le défaut, et de loin le plus joli. « Écran » existe pour les
// moments où l'objet gêne : un jeu qu'on veut voir gros, un écran de portable
// trop court, une partie où l'on joue au clavier de toute façon.
export const LAYOUTS = [
  {
    value: "console",
    label: "Console",
    hint: "La GBA entière, écran dans la coque.",
    shell: true,
  },
  {
    value: "screen",
    label: "Écran seul",
    hint: "L'écran en grand, sans la coque.",
    shell: false,
  },
];

export const LAYOUT_KEY = "mpl_gba_layout";

export function savedLayout() {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    return LAYOUTS.some((l) => l.value === v) ? v : "console";
  } catch {
    return "console";
  }
}

export const layoutOf = (value) =>
  LAYOUTS.find((l) => l.value === value) || LAYOUTS[0];
