// ======================================================================
//  Les touches de la console
// ======================================================================
// LA PAGE ÉCOUTE LE CLAVIER, TRADUIT, ET POUSSE LE BOUTON. L'émulateur ne voit
// jamais une touche, seulement des appuis de manette — la même porte que celle
// qu'emprunte sa manette tactile (`gameManager.simulateInput`). Le dessin de la
// coque et le clavier passent donc par exactement le même chemin, ce qui veut
// dire qu'il n'y en a qu'un à faire marcher.
//
// L'ALTERNATIVE ÉTAIT DE LAISSER FAIRE EMULATORJS, et elle coûtait deux choses :
// il fallait sans cesse rendre le focus à l'iframe (au moindre clic sur la coque,
// la console cessait de répondre), et ses touches nous étaient opaques —
// impossible d'écrire « A ▸ W » sous un bouton, ni de laisser quelqu'un en
// changer ailleurs que dans SON menu, en anglais.
//
// LES INDEX SONT CEUX DE LIBRETRO (RETRO_DEVICE_ID_JOYPAD), pas les nôtres :
// c'est ce que le cœur attend, et les inventer serait s'en remettre au hasard.
//
// DIX BOUTONS, ET C'EST TOUT. Une GBA n'a ni X, ni Y, ni second stick, ni écran
// tactile : la manette entière tient sous deux pouces. C'est précisément ce qui
// rend le remappage abordable — dix touches à poser, contre quatorze sur DS dont
// deux qui ne servaient qu'à moitié.

export const PLAYER = 0;

export const BUTTONS = [
  // --- la croix, à gauche ---
  { id: "up", index: 4, label: "Haut", glyph: "↑", pad: true },
  { id: "down", index: 5, label: "Bas", glyph: "↓", pad: true },
  { id: "left", index: 6, label: "Gauche", glyph: "←", pad: true },
  { id: "right", index: 7, label: "Droite", glyph: "→", pad: true },

  // --- les deux boutons, à droite ---
  { id: "a", index: 8, label: "A", glyph: "A", face: true },
  { id: "b", index: 0, label: "B", glyph: "B", face: true },

  // --- les gâchettes, sur la tranche haute ---
  { id: "l", index: 10, label: "L", glyph: "L" },
  { id: "r", index: 11, label: "R", glyph: "R" },

  // --- START / SELECT ---
  { id: "start", index: 3, label: "START", glyph: "START" },
  { id: "select", index: 2, label: "SELECT", glyph: "SELECT" },
];

// ---------------------------------------------------------------------------
//  Le clavier
// ---------------------------------------------------------------------------
// ON RETIENT `code`, PAS `key`. `code` est la POSITION physique de la touche :
// elle ne bouge pas d'un clavier à l'autre, et c'est ce qu'on veut d'une manette
// — la touche « sous l'index gauche » reste sous l'index gauche en AZERTY comme
// en QWERTY.
//
// Mais on retient AUSSI ce qui est écrit dessus, relevé au moment où la touche
// est apprise. Sans ça on affiche « A ▸ Z » à quelqu'un dont le clavier porte un
// W à cet endroit — et c'est le genre de détail qui fait douter de tout le reste.
export const KEYS_KEY = "mpl_gba_keys";

// ---------------------------------------------------------------------------
//  Les jeux de touches prêts à l'emploi
// ---------------------------------------------------------------------------
// « RENDS LE MAPPAGE DE TOUCHE FACILE » ne veut pas dire « rends chaque touche
// réassignable » — ça, c'était déjà le cas et personne n'y touchait. Ça veut
// dire : que la manette soit BONNE DÈS LE DÉPART, et qu'en changer soit un clic.
//
// D'où ces trois jeux complets. Chacun correspond à une façon de tenir un
// clavier, et on choisit celui qui ressemble à sa main plutôt que de reposer dix
// touches une par une.
//
// Les libellés sont ceux d'un clavier FRANÇAIS (le site l'est) — corrigés au
// démarrage par la disposition réelle quand le navigateur veut bien la donner
// (voir `readLayout`).
export const PRESETS = [
  {
    value: "arrows",
    label: "Flèches + W X",
    hint: "Les deux mains, la croix à droite. Le réglage d'origine.",
    keys: {
      up: { code: "ArrowUp", label: "↑" },
      down: { code: "ArrowDown", label: "↓" },
      left: { code: "ArrowLeft", label: "←" },
      right: { code: "ArrowRight", label: "→" },
      b: { code: "KeyZ", label: "W" },
      a: { code: "KeyX", label: "X" },
      l: { code: "KeyA", label: "Q" },
      r: { code: "KeyE", label: "E" },
      start: { code: "Enter", label: "Entrée" },
      select: { code: "ShiftRight", label: "Maj droite" },
    },
  },
  {
    value: "zqsd",
    label: "ZQSD + K L",
    hint: "La croix sous la main gauche, comme un jeu PC.",
    keys: {
      up: { code: "KeyW", label: "Z" },
      down: { code: "KeyS", label: "S" },
      left: { code: "KeyA", label: "Q" },
      right: { code: "KeyD", label: "D" },
      b: { code: "KeyK", label: "K" },
      a: { code: "KeyL", label: "L" },
      l: { code: "KeyU", label: "U" },
      r: { code: "KeyO", label: "O" },
      start: { code: "Enter", label: "Entrée" },
      select: { code: "Space", label: "Espace" },
    },
  },
  {
    value: "onehand",
    label: "Une main",
    hint: "Tout à droite du clavier, pour jouer d'une seule main.",
    keys: {
      up: { code: "ArrowUp", label: "↑" },
      down: { code: "ArrowDown", label: "↓" },
      left: { code: "ArrowLeft", label: "←" },
      right: { code: "ArrowRight", label: "→" },
      b: { code: "Numpad1", label: "1 (pavé)" },
      a: { code: "Numpad2", label: "2 (pavé)" },
      l: { code: "Numpad4", label: "4 (pavé)" },
      r: { code: "Numpad5", label: "5 (pavé)" },
      start: { code: "NumpadEnter", label: "Entrée (pavé)" },
      select: { code: "Numpad0", label: "0 (pavé)" },
    },
  },
];

export const DEFAULT_KEYS = PRESETS[0].keys;

// Le jeu de touches auquel une configuration correspond, s'il y en a un. Sert à
// cocher le bon dans le panneau : après avoir réassigné une seule touche, on
// n'est plus sur aucun jeu prêt à l'emploi, et le dire est plus honnête que de
// laisser une pastille allumée à côté d'un réglage qui a changé.
export function presetOf(keys) {
  return (
    PRESETS.find((p) =>
      BUTTONS.every((b) => keys?.[b.id]?.code === p.keys[b.id]?.code)
    )?.value || null
  );
}

// Les touches qui n'écrivent rien : leur nom ne se lit pas sur le clavier, il
// se dit. Tout le reste passe par ce que le navigateur nous rend.
const NAMED = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "Entrée",
  NumpadEnter: "Entrée (pavé)",
  Space: "Espace",
  Tab: "Tab",
  Backspace: "Retour",
  ShiftLeft: "Maj gauche",
  ShiftRight: "Maj droite",
  ControlLeft: "Ctrl gauche",
  ControlRight: "Ctrl droite",
  AltLeft: "Alt",
  AltRight: "Alt Gr",
  Backquote: "²",
};

// Le nom lisible d'une touche, à l'instant où on l'apprend. `event.key` donne
// le caractère RÉELLEMENT gravé sur la touche du joueur — c'est lui qui fait
// foi, et à défaut on retombe sur le nom de la position.
export function keyLabel(e) {
  if (NAMED[e.code]) return NAMED[e.code];
  if (e.key && e.key.length === 1 && e.key !== " ") return e.key.toUpperCase();
  if (e.code?.startsWith("Numpad")) return `${e.code.slice(6)} (pavé)`;
  if (e.code?.startsWith("Key")) return e.code.slice(3);
  if (e.code?.startsWith("Digit")) return e.code.slice(5);
  return e.key || e.code || "?";
}

export function loadKeys() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEYS_KEY) || "null");
    if (!raw) return { ...DEFAULT_KEYS };
    // On ne fait pas confiance au contenu : une entrée corrompue ou un bouton
    // disparu ne doit pas priver le joueur des neuf autres.
    //
    // UN `null` ENREGISTRÉ EST UN CHOIX, pas un trou. C'est ce que laisse
    // `assign` quand une touche est reprise à un autre bouton : le rendre à sa
    // valeur d'origine au rechargement recréerait le doublon qu'on venait
    // justement de défaire.
    const out = { ...DEFAULT_KEYS };
    for (const b of BUTTONS) {
      if (!(b.id in raw)) continue;
      const v = raw[b.id];
      if (v === null) out[b.id] = null;
      else if (v && typeof v.code === "string")
        out[b.id] = { code: v.code, label: v.label || v.code };
    }
    return out;
  } catch {
    return { ...DEFAULT_KEYS };
  }
}

export function saveKeys(keys) {
  try {
    localStorage.setItem(KEYS_KEY, JSON.stringify(keys));
  } catch {
    /* navigation privée : le mappage ne vaudra que pour cette partie */
  }
}

// LA MÊME TOUCHE NE PEUT PAS FAIRE DEUX BOUTONS. Sans ce ménage, assigner « X »
// au A alors qu'il servait déjà au B laissait les deux liés : une touche pour
// sauter ET frapper, et un joueur qui croit son remappage cassé. On libère donc
// l'ancien porteur — il apparaît « non assignée », ce qui se voit, plutôt que de
// faire deux choses en silence.
export function assign(keys, id, code, label) {
  const out = { ...keys };
  for (const b of BUTTONS) {
    if (b.id !== id && out[b.id]?.code === code) out[b.id] = null;
  }
  out[id] = { code, label };
  return out;
}

// Ce que le clavier du joueur porte VRAIMENT. `navigator.keyboard` n'existe que
// sur les navigateurs Chromium, et c'est le seul moyen honnête de savoir qu'une
// position « KeyZ » s'appelle W ici : ailleurs, on garde les libellés par
// défaut, qui deviendront exacts dès la première touche réapprise.
export async function readLayout(keys) {
  try {
    const map = await navigator.keyboard?.getLayoutMap?.();
    if (!map) return null;
    let changed = false;
    const out = { ...keys };
    for (const b of BUTTONS) {
      const cur = out[b.id];
      if (!cur?.code) continue;
      const real = map.get(cur.code);
      if (real && real.toUpperCase() !== cur.label) {
        out[b.id] = { ...cur, label: real.toUpperCase() };
        changed = true;
      }
    }
    return changed ? out : null;
  } catch {
    return null;
  }
}

// Le libellé d'un jeu de touches passé au filtre de la disposition réelle : sans
// ça, les trois jeux prêts à l'emploi s'annoncent en libellés français à
// quelqu'un dont le clavier est en QWERTY, et il choisit à l'aveugle.
export function presetLabel(preset, keys) {
  const real = (id) => keys?.[id]?.code === preset.keys[id]?.code && keys[id]?.label;
  if (preset.value === "arrows")
    return `Flèches + ${real("b") || "W"} ${real("a") || "X"}`;
  if (preset.value === "zqsd")
    return `${real("up") || "Z"}${real("left") || "Q"}${real("down") || "S"}${
      real("right") || "D"
    } + ${real("b") || "K"} ${real("a") || "L"}`;
  return preset.label;
}

// ---------------------------------------------------------------------------
//  Pousser un bouton
// ---------------------------------------------------------------------------
// La porte d'entrée du cœur, celle qu'emprunte la manette tactile d'EmulatorJS.
// Elle est cherchée à chaque appel plutôt que gardée : le document de l'iframe
// est jeté à chaque changement de moteur, et une référence gardée pointerait
// dans le vide sans jamais le dire.
export function pressButton(win, index, down) {
  try {
    const gm = win?.EJS_emulator?.gameManager;
    if (typeof gm?.simulateInput !== "function") return false;
    gm.simulateInput(PLAYER, index, down ? 1 : 0);
    return true;
  } catch {
    return false;
  }
}

// La console sait-elle recevoir nos boutons ? Posé une fois au démarrage : si la
// réponse est non, autant le dire tout de suite et renvoyer vers les réglages du
// moteur, plutôt que de laisser un joueur appuyer dans le vide.
export function canPress(win) {
  try {
    return typeof win?.EJS_emulator?.gameManager?.simulateInput === "function";
  } catch {
    return false;
  }
}
