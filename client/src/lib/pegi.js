// ======================================================================
//  PEGI : la pastille d'âge et les pictogrammes de contenu
// ======================================================================
// Dessinés ici, en SVG, plutôt que d'aller chercher les images officielles :
// nets à toutes les tailles, rien à télécharger, et le même tracé sert au site
// et à l'app (copie conforme dans myplaylog-mobile/src/lib/pegi.js).
//
// Les pictos suivent le style des boîtes récentes : blanc sur noir, dans une
// case carrée. Chaque forme est décrite en données (viewBox 32×32) :
//   t  : l'élément SVG (path, rect, circle, ellipse, line, text)
//   f  : remplissage, "w" (blanc) ou "k" (noir) — absent = aucun
//   s  : trait, "w" ou "k" — absent = aucun ; sw : son épaisseur
//   g  : rotation du groupe, en degrés autour du centre (seringue)
// Les clés arrivent du serveur (cf. `pegiOf`, routes/games.js).

// Les couleurs des pastilles d'âge : vert pour 3 et 7, orange pour 12 et 16,
// rouge pour 18, comme sur les boîtes.
export const PEGI_AGE_COLOR = {
  3: "#8bbd2a",
  7: "#8bbd2a",
  12: "#f29100",
  16: "#f29100",
  18: "#e3001b",
};

export const PEGI_LABEL = {
  violence: "Violence",
  language: "Langage grossier",
  fear: "Peur",
  gambling: "Jeux de hasard",
  sex: "Sexe",
  drugs: "Drogues",
  discrimination: "Discrimination",
  purchases: "Achats en jeu",
  online: "Jeu en ligne",
};

const mirror = (d) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${32 - x} ${y}`);
const SPIDER_LEGS = [
  "M12.5 15.5 L8 11 L5 13.5",
  "M12 17.5 L6.5 16 L4 18.5",
  "M12 19.5 L6.5 21.5 L5 25",
  "M13 21.5 L9.5 25 L9.5 28.5",
];

export const PEGI_ICONS = {
  // Le poing, de face : quatre doigts repliés sur la paume, le pouce en travers.
  violence: [
    { t: "rect", x: 8, y: 8.5, width: 4, height: 9, rx: 2, f: "w" },
    { t: "rect", x: 12.6, y: 7.5, width: 4, height: 10, rx: 2, f: "w" },
    { t: "rect", x: 17.2, y: 7.5, width: 4, height: 10, rx: 2, f: "w" },
    { t: "rect", x: 21.8, y: 8.5, width: 4, height: 9, rx: 2, f: "w" },
    { t: "rect", x: 8, y: 14, width: 17.8, height: 10.5, rx: 3.5, f: "w" },
    { t: "path", d: "M9.5 18.5 H18.5", s: "k", sw: 1.6 },
    { t: "rect", x: 11.5, y: 23.5, width: 11, height: 5, rx: 1, f: "w" },
  ],
  // La bulle qui jure.
  language: [
    { t: "rect", x: 3.5, y: 5.5, width: 25, height: 16, rx: 4, f: "w" },
    { t: "path", d: "M9 20 L7.5 27.5 L15.5 20 Z", f: "w" },
    { t: "text", x: 16, y: 17.2, text: "#@!", size: 10, f: "k" },
  ],
  // L'araignée au bout de son fil.
  fear: [
    { t: "path", d: "M16 3 V10", s: "w", sw: 1.4 },
    ...SPIDER_LEGS.map((d) => ({ t: "path", d, s: "w", sw: 1.8 })),
    ...SPIDER_LEGS.map((d) => ({ t: "path", d: mirror(d), s: "w", sw: 1.8 })),
    { t: "circle", cx: 16, cy: 12, r: 2.8, f: "w" },
    { t: "ellipse", cx: 16, cy: 19, rx: 4.2, ry: 5, f: "w" },
  ],
  // Deux dés.
  gambling: [
    { t: "rect", x: 3.5, y: 9, width: 14, height: 14, rx: 2.5, f: "w" },
    { t: "circle", cx: 7.3, cy: 12.8, r: 1.4, f: "k" },
    { t: "circle", cx: 10.5, cy: 16, r: 1.4, f: "k" },
    { t: "circle", cx: 13.7, cy: 19.2, r: 1.4, f: "k" },
    { t: "rect", x: 17.5, y: 13, width: 11, height: 11, rx: 2.2, f: "k", s: "w", sw: 1.8 },
    { t: "circle", cx: 20.7, cy: 16.2, r: 1.2, f: "w" },
    { t: "circle", cx: 25.3, cy: 16.2, r: 1.2, f: "w" },
    { t: "circle", cx: 20.7, cy: 20.8, r: 1.2, f: "w" },
    { t: "circle", cx: 25.3, cy: 20.8, r: 1.2, f: "w" },
  ],
  // ♀ ♂.
  sex: [
    { t: "circle", cx: 10, cy: 11.5, r: 4.6, s: "w", sw: 2.2 },
    { t: "path", d: "M10 16.1 V26 M6.5 21.5 H13.5", s: "w", sw: 2.2 },
    { t: "circle", cx: 20.5, cy: 19.5, r: 4.6, s: "w", sw: 2.2 },
    { t: "path", d: "M23.8 16.2 L28 12 M23.8 12 H28 V16.2", s: "w", sw: 2.2 },
  ],
  // La seringue, en biais.
  drugs: [
    { t: "rect", x: 13, y: 9, width: 6, height: 13, rx: 1, f: "w", g: 45 },
    { t: "path", d: "M13 13 H15.5 M13 16 H15.5 M13 19 H15.5", s: "k", sw: 1.2, g: 45 },
    { t: "path", d: "M10.5 9 H21.5 M16 9 V3.5 M13 3.5 H19", s: "w", sw: 2, g: 45 },
    { t: "path", d: "M16 22 V29.5", s: "w", sw: 1.4, g: 45 },
  ],
  // Trois silhouettes.
  discrimination: [
    { t: "circle", cx: 8.5, cy: 11, r: 2.8, f: "w" },
    { t: "path", d: "M4 26 V20.5 A4.5 4.5 0 0 1 13 20.5 V26 Z", f: "w" },
    { t: "circle", cx: 23.5, cy: 11, r: 2.8, f: "w" },
    { t: "path", d: "M19 26 V20.5 A4.5 4.5 0 0 1 28 20.5 V26 Z", f: "w" },
    { t: "circle", cx: 16, cy: 8.5, r: 3.2, f: "w", s: "k", sw: 1.4 },
    { t: "path", d: "M10.5 27 V19 A5.5 5.5 0 0 1 21.5 19 V27 Z", f: "w", s: "k", sw: 1.4 },
  ],
  // La carte de paiement.
  purchases: [
    { t: "rect", x: 4, y: 8, width: 24, height: 16, rx: 2.5, f: "w" },
    { t: "rect", x: 4, y: 11.5, width: 24, height: 3.2, f: "k" },
    { t: "rect", x: 7.5, y: 18.5, width: 7, height: 2.2, rx: 1, f: "k" },
  ],
  // Le globe.
  online: [
    { t: "circle", cx: 16, cy: 16, r: 10.5, s: "w", sw: 2 },
    { t: "ellipse", cx: 16, cy: 16, rx: 4.6, ry: 10.5, s: "w", sw: 1.6 },
    { t: "path", d: "M5.5 16 H26.5 M7.5 10.5 H24.5 M7.5 21.5 H24.5", s: "w", sw: 1.6 },
  ],
};
