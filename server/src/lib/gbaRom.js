import fs from "node:fs";

// ======================================================================
//  Lire une cartouche Game Boy Advance — en-tête et matériel de sauvegarde
// ======================================================================
// UNE CARTOUCHE GBA EN DIT BEAUCOUP MOINS QU'UNE CARTOUCHE DS, et il faut le
// savoir avant d'écrire le formulaire d'admin. La DS portait une BANNIÈRE : le
// titre du jeu dans sept langues, son éditeur, et l'icône 32×32 du menu de la
// console. Sur GBA, rien de tout ça n'existe — le format est de 2001, il n'y a
// pas de menu système à décorer.
//
// Ce qu'on peut lire tient dans les 192 premiers octets :
//
//   0x0A0  12  titre interne — ASCII MAJUSCULE, complété de zéros
//   0x0AC   4  code de jeu (« AXVE ») : le 4e caractère donne la région
//   0x0B0   2  code éditeur (« 01 » = Nintendo)
//   0x0B2   1  valeur fixe : 0x96 sur toute cartouche qui démarre
//   0x0B3   1  code machine (0x00 = GBA)
//   0x0BC   1  version du logiciel
//   0x0BD   1  somme de contrôle de l'en-tête
//
// LE TITRE INTERNE NE FAIT PAS UN TITRE D'AFFICHAGE : douze caractères en
// capitales, tronqués sans ménagement (« POKEMON RUBY », « ZELDA MC »). Il sert
// de dernier recours, jamais de vérité — c'est l'admin qui écrit le titre, et le
// formulaire le lui demande donc vraiment (voir AdminGameModal côté client).
//
// D'où aussi le SEUL enrichissement qui vaille ici : le MATÉRIEL DE SAUVEGARDE,
// écrit en clair dans le corps de la ROM. C'est la seule chose que le fichier
// sache dire de lui-même qu'on ne trouve pas ailleurs, et elle répond à une
// question concrète — « ce jeu peut-il sauvegarder ? ».

const HEADER_SIZE = 0xc0;
const FIXED_AT = 0xb2;
const FIXED_VALUE = 0x96; // la valeur que le BIOS vérifie au démarrage
const CHECK_AT = 0xbd; // la somme de contrôle de l'en-tête

// Le 4e caractère du code de jeu. Ce n'est pas de la décoration : c'est ce qui
// distingue une cartouche française d'une américaine, donc la langue qu'on
// verra à l'écran une fois le jeu lancé.
const REGIONS = {
  J: "Japon",
  E: "Amérique du Nord",
  P: "Europe",
  F: "France",
  D: "Allemagne",
  I: "Italie",
  S: "Espagne",
  H: "Pays-Bas",
  X: "Europe",
  Y: "Europe",
  Z: "Europe",
  U: "Australie",
  K: "Corée",
  C: "Chine",
};

// ------------------------------------------------------- somme de contrôle --
//
// LE CONTRÔLE LE PLUS HONNÊTE QU'ON PUISSE FAIRE SANS LANCER LE JEU, et il ne
// coûte que 29 additions. Le BIOS de la console fait exactement celui-là avant
// de céder la main à la cartouche : la valeur fixe 0x96 à sa place, et la somme
// des octets de l'en-tête qui retombe sur l'octet 0xBD.
//
// Un « .gba » renommé depuis autre chose échoue aux deux — et l'émulateur, lui,
// ne dirait rien de plus qu'un écran noir.
function headerOk(buf) {
  if (buf.length < HEADER_SIZE) return false;
  if (buf[FIXED_AT] !== FIXED_VALUE) return false;
  let sum = 0;
  for (let i = 0xa0; i <= 0xbc; i++) sum += buf[i];
  return ((-(0x19 + sum) & 0xff) >>> 0) === buf[CHECK_AT];
}

// -------------------------------------------------------------- le titre --
//
// Douze capitales sans ponctuation ne se posent pas telles quelles sur une
// jaquette : « POKEMON RUBY » deviendrait le titre officiel du boîtier. On le
// met en casse de titre pour qu'il soit LISIBLE, et c'est tout ce qu'on prétend.
//
// CE QUI RESTE EN CAPITALES SE DÉCLARE, ça ne se devine pas. « Tout mot de trois
// lettres ou moins » avait l'air d'une bonne règle et rendait « THE Minish » :
// les sigles n'ont rien à voir avec leur longueur. D'où une liste, courte et
// relue — les chiffres romains et les mots contenant un chiffre s'y ajoutent
// d'eux-mêmes.
const KEEP_UPPER = new Set([
  "DX", "SP", "XL", "HD", "3D", "EX", "GX", "ZX", "NES", "SNES", "GBA", "DS",
  "TV", "VS", "RPG", "USA", "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI",
]);
const ROMAN_OR_DIGIT = /^(?:[IVXLC]{2,}|.*\d.*)$/;

function prettyTitle(raw) {
  const clean = String(raw || "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!clean) return "";
  return clean
    .split(" ")
    .map((word) =>
      KEEP_UPPER.has(word) || ROMAN_OR_DIGIT.test(word)
        ? word
        : word.charAt(0) + word.slice(1).toLowerCase()
    )
    .join(" ");
}

// ------------------------------------------------ le matériel de sauvegarde --
//
// Les bibliothèques de développement de Nintendo laissent leur signature en
// clair dans la ROM (« FLASH1M_V103 », « SRAM_V113 ») : c'est ainsi que les
// émulateurs devinent quelle puce émuler, et c'est la seule information utile
// que la cartouche porte hors de son en-tête.
//
// L'ORDRE COMPTE : « FLASH1M_V » contient « FLASH », donc les marqueurs les plus
// précis passent devant. Lus à l'envers, tous les jeux à Flash 1 Mb
// s'annonceraient en 512 Kb.
const SAVE_MARKERS = [
  { needle: "FLASH1M_V", label: "Flash 1 Mb" },
  { needle: "FLASH512_V", label: "Flash 512 Kb" },
  { needle: "FLASH_V", label: "Flash 512 Kb" },
  { needle: "EEPROM_V", label: "EEPROM" },
  { needle: "SRAM_F_V", label: "SRAM 32 Ko" },
  { needle: "SRAM_V", label: "SRAM 32 Ko" },
];

// La plus longue aiguille, moins un : de quoi rattraper un marqueur coupé en
// deux par la frontière de deux tranches. Sans ce chevauchement, un jeu sur
// mille passerait pour un jeu sans sauvegarde.
const OVERLAP = 10;
const CHUNK = 1024 * 1024;

// Le marqueur est presque toujours dans le dernier quart du fichier (les
// bibliothèques sont liées après le jeu), mais « presque » ne suffit pas : on
// parcourt tout, par tranches d'un mégaoctet. Une cartouche GBA plafonne à 32 Mo
// — trente-deux lectures, et jamais plus d'un mégaoctet en mémoire.
async function findSaveType(fh, size) {
  let at = 0;
  let tail = Buffer.alloc(0);
  while (at < size) {
    const len = Math.min(CHUNK, size - at);
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, at);
    if (!bytesRead) break;
    const hay = Buffer.concat([tail, buf.subarray(0, bytesRead)]);
    for (const { needle, label } of SAVE_MARKERS) {
      if (hay.includes(needle, 0, "ascii")) return label;
    }
    tail = hay.subarray(Math.max(0, hay.length - OVERLAP));
    at += bytesRead;
  }
  return "";
}

// ------------------------------------------------------------- l'entrée --

// Tout ce qu'on sait dire d'une cartouche, en une passe. Ne LÈVE JAMAIS : une
// ROM exotique (un homebrew, une traduction de fans reconstruite) doit pouvoir
// se poser sur l'étagère quand même — c'est l'appelant qui décide si un en-tête
// non reconnu est rédhibitoire, et ici il ne l'est pas.
export function readGba(buffer) {
  const out = {
    recognized: false,
    code: "",
    maker: "",
    region: "",
    regionLabel: "",
    internalTitle: "",
    title: "",
    version: null,
    saveType: "",
  };
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_SIZE) return out;

  try {
    out.internalTitle = buffer
      .subarray(0xa0, 0xac)
      .toString("ascii")
      .replace(/\0+$/, "")
      .trim();
    out.code = buffer
      .subarray(0xac, 0xb0)
      .toString("ascii")
      .replace(/[^\x20-\x7e]/g, "");
    out.maker = buffer
      .subarray(0xb0, 0xb2)
      .toString("ascii")
      .replace(/[^\x20-\x7e]/g, "");
    out.region = out.code.length === 4 ? out.code[3] : "";
    out.regionLabel = REGIONS[out.region] || "";
    out.version = buffer[0xbc];
    out.title = prettyTitle(out.internalTitle);
    out.recognized = headerOk(buffer);
  } catch {
    return out;
  }
  return out;
}

// LA MÊME LECTURE, SUR UN FICHIER POSÉ SUR LE DISQUE — et sans le charger.
//
// L'en-tête tient en 192 octets : le lire en avalant les 16 mégaoctets du
// fichier, c'est autant de mémoire prise sur le serveur à chaque envoi, pour
// rien. Seule la recherche du matériel de sauvegarde parcourt la ROM, et elle le
// fait par tranches (voir `findSaveType`).
export async function readGbaFile(file) {
  let fh;
  try {
    fh = await fs.promises.open(file, "r");
    const { size } = await fh.stat();
    const head = Buffer.alloc(HEADER_SIZE);
    const { bytesRead } = await fh.read(head, 0, HEADER_SIZE, 0);
    const out = readGba(head.subarray(0, bytesRead));
    out.saveType = await findSaveType(fh, size);
    return out;
  } catch {
    return readGba(Buffer.alloc(0));
  } finally {
    await fh?.close().catch(() => {});
  }
}
