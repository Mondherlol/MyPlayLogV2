// ======================================================================
//  L'image : ce qu'on voit, et comment on le voit
// ======================================================================
// LA COQUE DESSINÉE A DISPARU. Ce qu'il en reste d'utile, ce ne sont pas les
// boutons en plastique — c'était joli et ça mangeait les deux tiers de l'écran —
// mais LE SOIN APPORTÉ À L'IMAGE : une dalle de 240 × 160 étirée n'importe
// comment est laide, et personne ne joue longtemps sur une image laide.
//
// D'où ces trois réglages, et seulement ceux-là :
//
//   • PIXELS NETS ou lissés. Un jeu GBA est dessiné pixel par pixel : lissé, il
//     devient une aquarelle. Mais certains jeux 3D (Mario Kart, F-Zero) passent
//     mieux adoucis — donc c'est un choix, pas un dogme.
//   • PIXELS ENTIERS. Agrandir ×2,7 fait des pixels de tailles inégales : une
//     ligne sur trois est plus épaisse, et ça scintille dès que ça défile. En
//     s'arrêtant au multiple entier en dessous, chaque pixel du jeu devient un
//     carré exact. On perd quelques pour cent de taille, on gagne une image
//     parfaite.
//   • LES LIGNES CRT, pour ceux qui les aiment. Éteintes par défaut.
//
// Ils tiennent dans le navigateur, pas sur le serveur : ce sont des préférences
// d'affichage, pas des données de compte.

export const VIEW_KEY = "mpl_gba_view";

export const DEFAULT_VIEW = {
  smooth: false, // pixels nets par défaut : c'est ainsi que les jeux sont dessinés
  integer: true, // et à taille entière, pour qu'ils le restent
  crt: false,
  volume: 1,
  pad: null, // null = « selon l'appareil » ; true / false = choix explicite
  // La croix ou le joystick. LA CROIX RESTE LE DÉFAUT parce que c'est ce que la
  // machine a : une GBA n'a pas de stick, et ses jeux sont pensés pour huit
  // directions franches. Mais un pouce sur du verre n'a pas de relief pour se
  // repérer — d'où le joystick, qui vient CHERCHER le pouce là où il se pose et
  // ne le lâche plus. Les deux existent parce qu'aucun n'a raison partout.
  stick: false,
};

export function loadView() {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEW_KEY) || "null");
    if (!raw || typeof raw !== "object") return { ...DEFAULT_VIEW };
    const out = { ...DEFAULT_VIEW };
    for (const k of Object.keys(DEFAULT_VIEW)) {
      if (k in raw) out[k] = raw[k];
    }
    // Un volume corrompu couperait le son sans qu'on comprenne pourquoi.
    if (typeof out.volume !== "number" || !(out.volume >= 0 && out.volume <= 1))
      out.volume = 1;
    return out;
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

export function saveView(view) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    /* navigation privée : le réglage ne vaudra que pour cette partie */
  }
}

// Un appareil tactile n'a pas de clavier : la manette à l'écran s'y allume
// d'office. Ailleurs elle attend qu'on la demande.
export function padByDefault() {
  try {
    return (
      window.matchMedia?.("(pointer: coarse)").matches ||
      navigator.maxTouchPoints > 0
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
//  La netteté, qui se règle DANS le document du jeu
// ---------------------------------------------------------------------------
// EmulatorJS peint sur un canvas qui vit dans l'iframe : c'est donc là que la
// règle doit être posée, pas sur notre page. L'iframe est de notre origine (elle
// est écrite en `srcdoc`), on a le droit d'y glisser une feuille de style — et
// une seule, réécrite à chaque changement, plutôt qu'une pile qui s'accumule.
// `cursor` suit l'effacement des commandes : quand l'interface s'est retirée, le
// pointeur doit se retirer avec elle — et il vit AU-DESSUS DU JEU, donc dans ce
// document-là. Le cacher depuis notre page ne servirait à rien.
export function applyVideo(win, { smooth, cursor = true }) {
  try {
    const doc = win?.document;
    if (!doc?.head) return false;
    let tag = doc.getElementById("mpl-gba-video");
    if (!tag) {
      tag = doc.createElement("style");
      tag.id = "mpl-gba-video";
      doc.head.appendChild(tag);
    }
    tag.textContent =
      `canvas { image-rendering: ${smooth ? "auto" : "pixelated"} !important; }` +
      `html, body, canvas { cursor: ${cursor ? "auto" : "none"} !important; }`;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
//  La boîte de l'écran
// ---------------------------------------------------------------------------
// LA DALLE FAIT 240 × 160, soit exactement 3/2. On cherche la plus grande boîte
// de ce rapport qui tienne dans la place disponible — et, en pixels entiers, le
// plus grand multiple de 240 × 160 qui y tienne.
//
// LE PLANCHER EST À ×1 : sur un téléphone en portrait, la place restante sous la
// manette peut descendre sous 240 pixels de large, et un `Math.floor` y
// rendrait une boîte de taille zéro — donc un écran noir, sans erreur pour
// l'expliquer.
export const NATIVE = { w: 240, h: 160 };

// L'AGRANDISSEMENT ENTIER SE PAIE, ET PARFOIS TROP CHER. Sur un téléphone en
// portrait, la place disponible donne souvent une échelle de 1,6 : arrondie à 1,
// l'écran retombe à 240 × 160 au milieu d'une page vide — des pixels parfaits que
// personne ne voit. On garde donc l'arrondi tant qu'il coûte peu, et on rend la
// place au jeu quand il coûte le quart de l'image.
const INTEGER_COST = 0.75;

export function fitScreen(space, { integer }) {
  const w = Math.max(0, space.width);
  const h = Math.max(0, space.height);
  if (!w || !h) return null;
  const raw = Math.min(w / NATIVE.w, h / NATIVE.h);
  const k = Math.floor(raw);
  if (!integer || k < 1 || k / raw < INTEGER_COST)
    return { width: NATIVE.w * raw, height: NATIVE.h * raw };
  return { width: NATIVE.w * k, height: NATIVE.h * k, k };
}
