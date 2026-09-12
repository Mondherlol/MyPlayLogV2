// ======================================================================
//  Le nom d'une console, tel qu'on le dit
// ======================================================================
// IGDB nomme les plateformes en archiviste : « PC (Microsoft Windows) »,
// « Sega Mega Drive/Genesis », « Super Nintendo Entertainment System ». C'est
// exact et illisible dans une pastille de trente pixels de haut — personne ne
// dit « je l'ai fait sur PC (Microsoft Windows) ».
//
// ⚠️ ON N'AFFICHE PAS CE QU'ON ENREGISTRE. La bibliothèque stocke le nom
// D'ORIGINE (`platform` de l'entrée), parce que c'est ce que le site écrit
// aussi : deux écritures différentes pour la même console couperaient les
// statistiques en deux. Ces fonctions ne servent qu'à l'affichage et à la
// comparaison.

const ALIASES = [
  [/^pc \(microsoft windows\)$|^microsoft windows$|^windows$/i, "PC"],
  [/^web browser$|^browser$/i, "Navigateur"],
  [/^mac$|^macintosh$/i, "Mac"],
  [/^super nintendo entertainment system$/i, "Super Nintendo"],
  [/^nintendo entertainment system$/i, "NES"],
  [/^family computer/i, "Famicom"],
  [/^sega mega drive\/genesis$/i, "Mega Drive"],
  [/^sega master system/i, "Master System"],
  [/^nintendo switch 2$/i, "Switch 2"],
  [/^nintendo switch$/i, "Switch"],
  [/^nintendo gamecube$/i, "GameCube"],
  [/^new nintendo 3ds$/i, "New 3DS"],
  [/^nintendo (3ds|ds|dsi|64)$/i, (m) => m[1].toUpperCase().replace("DSI", "DSi")],
  [/^playstation portable$/i, "PSP"],
  [/^playstation vita$/i, "PS Vita"],
  [/^google stadia$/i, "Stadia"],
  [/^amazon luna$/i, "Luna"],
];

// Regarder quelqu'un y jouer n'est pas y avoir joué — mais ça compte, et ça se
// dit. Le site range ça au bout de la liste des plateformes (cf. LETSPLAY dans
// client/src/components/PlayedModal.jsx) : ⚠️ MÊME ORTHOGRAPHE EXACTEMENT, les
// deux écritures se retrouvent dans la même colonne de la base.
export const LETSPLAY = "Vu en let's play";

/** Le nom court d'une plateforme : `{ name, abbr }`, ou juste son nom. */
export function platformLabel(p) {
  const name = (typeof p === "string" ? p : p?.name) || "";
  const abbr = (typeof p === "string" ? "" : p?.abbr) || "";
  if (!name) return abbr;

  for (const [re, label] of ALIASES) {
    const m = name.match(re);
    if (m) return typeof label === "function" ? label(m) : label;
  }

  // Ce qui vit entre parenthèses — ou après une barre — est une précision
  // d'archiviste : « Genesis » pour la Mega Drive américaine, le nom de
  // l'éditeur du système d'exploitation…
  const short = name
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .split("/")[0]
    .trim();
  // Au-delà, la pastille déborde : le nom court d'IGDB fera mieux l'affaire.
  return short.length <= 16 ? short : abbr || short;
}

/** Deux noms qui désignent la même console ? (« PS5 » vs « PlayStation 5 ») */
export function samePlatform(a, b) {
  if (!a || !b) return false;
  const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (norm(a) === norm(b)) return true;
  return norm(platformLabel(a)) === norm(platformLabel(b));
}

/**
 * La console sur laquelle on a joué D'ABORD.
 *
 * Rouvrir son suivi et devoir chercher sa console au bout d'un rail de quinze
 * pastilles, alors qu'on l'a déjà cochée, n'a pas de sens. ⚠️ L'ordre se fige
 * à L'OUVERTURE (cf. l'appelant) : réordonner à chaque appui ferait sauter le
 * rail sous le doigt.
 */
export function platformsFirst(platforms, played) {
  if (!played) return platforms;
  const mine = platforms.filter((p) => samePlatform(p.name, played));
  if (!mine.length) return platforms;
  return [...mine, ...platforms.filter((p) => !mine.includes(p))];
}
