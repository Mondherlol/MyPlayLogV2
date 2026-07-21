// Jeux gratuits « du moment » (à récupérer et garder pour toujours), agrégés
// depuis GamerPower — qui recense les giveaways Epic Games Store, Steam, GOG,
// Prime Gaming, Ubisoft, itch.io… Aucune clé d'API requise.
//
// Résultat mis en cache mémoire 1 h pour ne pas marteler l'API à chaque visite
// de l'accueil. En cas d'échec réseau, on sert le dernier cache connu (même
// périmé) plutôt que de casser la section.
//
// Chaque giveaway est rattaché à sa fiche IGDB (par titre) : la carte de
// l'accueil renvoie alors vers la page du jeu sur le site, qui affiche à son
// tour une banderole « récupérer gratuitement » (voir FreeGameBanner.jsx).
import { matchNamesToIgdb, simplifyName } from "./psn.js";

// platform=pc : méta-plateforme qui couvre Steam, Epic, GOG, itch.io… et exclut
// mobile/console — on veut les jeux gratuits à récupérer sur PC.
const API_URL =
  "https://www.gamerpower.com/api/giveaways?type=game&platform=pc&sort-by=popularity";
const TTL = 60 * 60 * 1000; // 1 h

let cache = { at: 0, games: null };

// "PC, Steam" → magasin lisible + slug (pour la pastille colorée côté client).
// On scanne par ordre de priorité : un même giveaway peut lister plusieurs
// plateformes ("PC, Steam, DRM-Free"), on garde la plus parlante.
const STORES = [
  [/epic/i, { label: "Epic Games", slug: "epic" }],
  [/steam/i, { label: "Steam", slug: "steam" }],
  [/gog/i, { label: "GOG", slug: "gog" }],
  [/ubisoft/i, { label: "Ubisoft", slug: "ubisoft" }],
  [/origin|\bea\b/i, { label: "EA", slug: "ea" }],
  [/battle\.?net/i, { label: "Battle.net", slug: "battlenet" }],
  [/prime|amazon/i, { label: "Prime Gaming", slug: "prime" }],
  [/itch/i, { label: "itch.io", slug: "itchio" }],
  [/drm.?free/i, { label: "DRM-Free", slug: "drm-free" }],
];

function pickStore(platforms) {
  const s = platforms || "";
  for (const [re, store] of STORES) if (re.test(s)) return store;
  // Repli : premier segment un peu spécifique, sinon « PC ».
  const first = s.split(",").map((x) => x.trim()).find((x) => x && x !== "PC");
  return { label: first || "PC", slug: "pc" };
}

// "The Life and Suffering of Sir Brante (Steam) Giveaway" → titre nu.
function cleanTitle(title, store) {
  return (title || "")
    .replace(/\s*\([^)]*\)\s*/g, " ") // parenthèses (mention du magasin)
    .replace(/\b(?:key\s+)?giveaway\b/gi, "")
    .replace(/\bfree\s+(?:download|game)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim() || store.label;
}

// "$19.99" → "$19.99" ; "N/A" / "$0.00" → null (pas de prix barré pertinent).
function cleanWorth(worth) {
  if (!worth) return null;
  const w = String(worth).trim();
  if (!w || /n\/?a/i.test(w) || /^\$?0([.,]0+)?$/.test(w)) return null;
  return w;
}

// "2026-07-23 23:59:00" (naïf, tz GamerPower) → ISO. On le traite comme de
// l'UTC : la tolérance au jour près rend le décalage de fuseau négligeable.
function parseEnd(endDate) {
  if (!endDate || /n\/?a/i.test(endDate)) return null;
  const iso = endDate.trim().replace(" ", "T") + "Z";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function normalize(g) {
  const store = pickStore(g.platforms);
  return {
    id: g.id,
    title: cleanTitle(g.title, store),
    store,
    worth: cleanWorth(g.worth),
    image: g.image || g.thumbnail || null,
    url: g.open_giveaway_url || g.gamerpower_url || null,
    endsAt: parseEnd(g.end_date),
    users: g.users || 0,
    // Renseignés par attachIgdb() (null si le titre n'a pas été reconnu).
    gameId: null,
    cover: null,
  };
}

// Rattache les giveaways à IGDB par nom (même matching que l'import PSN).
// Best-effort : un titre non reconnu garde gameId null et la carte pointe
// alors directement vers l'offre du magasin.
async function attachIgdb(games) {
  try {
    const map = await matchNamesToIgdb(games.map((g) => g.title));
    for (const g of games) {
      const hit = map.get(simplifyName(g.title));
      if (!hit) continue;
      g.gameId = hit.gameId;
      g.cover = hit.cover;
    }
  } catch (err) {
    console.error("free-games igdb match error:", err.message);
  }
}

export async function getFreeGames() {
  if (cache.games && Date.now() - cache.at < TTL) return cache.games;

  let raw;
  try {
    const res = await fetch(API_URL, {
      headers: { "User-Agent": "MyPlayLog/1.0 (+https://myplaylog.cc)" },
    });
    if (!res.ok) throw new Error(`GamerPower ${res.status}`);
    raw = await res.json();
  } catch (err) {
    // Réseau/API en carafe : on sert le dernier cache si on en a un.
    if (cache.games) return cache.games;
    throw err;
  }

  const games = (Array.isArray(raw) ? raw : [])
    .filter((g) => g && g.status === "Active" && (g.open_giveaway_url || g.gamerpower_url))
    .map(normalize)
    .sort((a, b) => {
      // Les offres qui expirent bientôt d'abord (l'esprit « de la semaine »),
      // puis les offres sans échéance triées par popularité.
      if (a.endsAt && b.endsAt) return Date.parse(a.endsAt) - Date.parse(b.endsAt);
      if (a.endsAt) return -1;
      if (b.endsAt) return 1;
      return b.users - a.users;
    })
    .slice(0, 12);

  await attachIgdb(games);

  cache = { at: Date.now(), games };
  return games;
}

// Le giveaway en cours pour un jeu IGDB donné (null si ce jeu n'est pas
// gratuit en ce moment) — alimente la banderole de la fiche de jeu.
export async function getFreeGameForIgdbId(gameId) {
  const id = Number(gameId);
  if (!id) return null;
  const games = await getFreeGames();
  return games.find((g) => g.gameId === id) || null;
}
