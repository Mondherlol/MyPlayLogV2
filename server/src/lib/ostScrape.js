import CustomOst from "../models/CustomOst.js";
import GameOstScrape from "../models/GameOstScrape.js";

// Récupération automatique de l'OST d'un jeu depuis YouTube (sans clé API, par
// scraping de ytInitialData comme le feed). À la première ouverture de l'onglet
// OST d'un jeu, on cherche la meilleure playlist "OST", on scrape ses pistes, on
// nettoie les titres et on enregistre en base. Ensuite tout vient de la base.

const YT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Un id de playlist n'est jamais un id de vidéo (11 caractères pile) : il est
// plus long et/ou préfixé (PL, OL, RD, UU, FL, LL…).
function looksLikePlaylistId(id) {
  return typeof id === "string" && (id.length > 11 || /^(PL|OL|RD|UU|FL|LL)/.test(id));
}

async function fetchYtInitialData(url) {
  const html = await fetch(url, {
    headers: { "User-Agent": YT_UA, "Accept-Language": "en" },
  }).then((r) => r.text());
  const raw = html.split("ytInitialData = ")[1]?.split(";</script>")[0];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --- Recherche des playlists candidates pour "<jeu> OST" (filtre "Playlist") ---
export async function searchOstPlaylists(gameName) {
  // sp=EgIQAw%3D%3D : filtre "Playlist" de la recherche YouTube.
  const data = await fetchYtInitialData(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(
      `${gameName} OST`
    )}&sp=EgIQAw%3D%3D`
  );
  if (!data) return [];
  const out = [];
  const seen = new Set();
  (function walk(o) {
    if (!o || typeof o !== "object") return;

    // Ancien format
    const pr = o.playlistRenderer;
    if (pr?.playlistId && !seen.has(pr.playlistId)) {
      const title = pr.title?.simpleText || pr.title?.runs?.[0]?.text;
      if (title) {
        seen.add(pr.playlistId);
        out.push({
          playlistId: pr.playlistId,
          title,
          count: Number(pr.videoCount) || 0,
        });
      }
    }

    // Nouveau format (lockupViewModel) : playlist si contentId ressemble à un id
    // de playlist.
    const lm = o.lockupViewModel;
    if (lm?.contentId && looksLikePlaylistId(lm.contentId) && !seen.has(lm.contentId)) {
      const title = lm.metadata?.lockupMetadataViewModel?.title?.content;
      if (title) {
        seen.add(lm.contentId);
        // Nombre de vidéos : best-effort, cherché dans un badge/overlay.
        let count = 0;
        const m = JSON.stringify(lm).match(/"(\d[\d\s.,]*)\s*(?:videos|vid[ée]os)"/i);
        if (m) count = parseInt(m[1].replace(/[\s.,]/g, ""), 10) || 0;
        out.push({ playlistId: lm.contentId, title, count });
      }
    }

    for (const k in o) walk(o[k]);
  })(data);
  return out;
}

// Tokens significatifs du nom du jeu (ignore les mots courts / bruit).
function tokenize(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

// Choisit la playlist la plus pertinente parmi les candidates (ou null).
export function pickBestPlaylist(candidates, gameName) {
  const gameTokens = tokenize(gameName);
  const scored = candidates.map((c, i) => {
    const t = c.title.toLowerCase();
    let score = 0;
    if (/\boriginal soundtrack\b/.test(t)) score += 3;
    else if (/\bsoundtrack\b/.test(t)) score += 2;
    if (/\bost\b/.test(t)) score += 2;
    // Correspondance avec le nom du jeu.
    const hits = gameTokens.filter((tok) => t.includes(tok)).length;
    if (gameTokens.length) score += (hits / gameTokens.length) * 4;
    // Malus contenus dérivés.
    for (const bad of ["cover", "remix", "lyrics", "piano", "guitar", "8-bit", "8 bit", "nightcore"]) {
      if (t.includes(bad)) score -= 2;
    }
    // Bonus léger pour les grosses playlists (OST complètes).
    if (c.count >= 15) score += 1;
    // Départage : garder l'ordre de pertinence de YouTube.
    score -= i * 0.01;
    return { ...c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best && best.score > 0.5 ? best : null;
}

// --- Extrait les pistes d'une playlist YouTube (scraping de la page) ---
export async function ytPlaylistTracks(playlistId) {
  const data = await fetchYtInitialData(
    `https://www.youtube.com/playlist?list=${playlistId}`
  );
  if (!data) return [];
  const out = [];
  const seen = new Set();
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    if (o.lockupViewModel) {
      const lm = o.lockupViewModel;
      const id = lm.contentId;
      const title = lm.metadata?.lockupMetadataViewModel?.title?.content;
      if (id && title && !seen.has(id)) {
        seen.add(id);
        out.push({ videoId: id, title });
      }
    }
    for (const k in o) walk(o[k]);
  })(data);
  return out;
}

// Source de regex "souple" pour un nom de jeu (tolère ponctuation/espaces).
function looseGameSource(gameName) {
  return String(gameName || "")
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // échappe les métacaractères
    .replace(/\s+/g, "[\\s:;,'\\-]*"); // espaces ↔ ponctuation souple
}

// --- Nettoyage best-effort des titres d'OST (retire les tags "OST" répétés) ---
// Gère les préfixes ("Sonic OST - Titre", "[Persona 4 OST] 01 - Titre",
// "Steins;Gate OST Titre") ET les suffixes ("Titre - Persona 4 Golden OST
// Soundtrack"). L'ordre est important : on retire d'abord le suffixe, sinon la
// coupe "jusqu'à OST" mangerait le vrai titre placé au début.
export function cleanOstTitle(title, gameName) {
  const original = String(title || "").trim();
  let s = original;
  const OST = "(?:original\\s+soundtrack|soundtrack|ost)";
  const SEPC = "\\-–—|:~•"; // caractères séparateurs (pour classes)
  const SEP = `[${SEPC}]`; // classe séparateur (autonome)

  // 1. Groupe crochet/parenthèse contenant un marqueur OST : "[Persona 4 OST]".
  s = s.replace(new RegExp(`[\\[(][^\\])]*\\b${OST}\\b[^\\])]*[\\])]`, "gi"), " ");

  // 2. Suffixe : segment final (après un séparateur) contenant un marqueur OST.
  //    "… - Persona 4 Golden OST Soundtrack" → supprimé.
  s = s.replace(new RegExp(`\\s*${SEP}\\s*[^${SEPC}]*\\b${OST}\\b.*$`, "i"), "");

  // 3. Suffixe : nom du jeu nu en fin ("Green Hill Zone - Sonic The Hedgehog").
  if (gameName) {
    s = s.replace(
      new RegExp(`\\s*${SEP}\\s*(?:the\\s+)?${looseGameSource(gameName)}\\s*${OST}?\\s*$`, "i"),
      ""
    );
  }

  // 4. Préfixe : tout jusqu'au marqueur OST inclus, proche du début.
  //    "Sonic The Hedgehog OST - ", "Steins;Gate OST ". Gardé seulement si le
  //    reste n'est pas vide (sinon le titre "était" le marqueur).
  s = s.replace(new RegExp(`^.{0,60}?\\b${OST}\\b\\s*${SEP}*\\s*`, "i"), (m) => {
    const rest = s.slice(m.length).trim();
    return rest.length >= 2 ? "" : m;
  });

  // 5. Préfixe : nom du jeu nu en tête ("Persona 4 - Titre").
  if (gameName) {
    s = s.replace(
      new RegExp(`^\\s*(?:the\\s+)?${looseGameSource(gameName)}\\s*${OST}?\\s*${SEP}+\\s*`, "i"),
      ""
    );
  }

  // 6. Numéro de piste en tête : "01 - ", "01. ", "#01 ", "1) ".
  s = s.replace(/^\s*#?\d{1,3}\s*[-–—.):|]+\s*/, "");
  s = s.replace(/^\s*#?\d{1,3}\s+(?=\p{L})/u, "");

  // 7. Séparateurs/guillemets résiduels + espaces multiples + point final isolé.
  s = s
    .replace(/^["'«»\-–—:|.\s]+/, "")
    .replace(/["'«»\s]+$/, "")
    .replace(/\s*\.\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return s || original;
}

// Concurrence : évite de scraper deux fois le même jeu si plusieurs users
// ouvrent l'onglet en même temps (mono-process).
const inFlight = new Map();

// Scrape + enregistre l'OST auto d'un jeu à la première ouverture. Idempotent :
// si une sentinelle GameOstScrape existe déjà, ne fait rien.
export async function ensureScraped(gameId, gameName) {
  if (!gameName) return [];
  if (inFlight.has(gameId)) return inFlight.get(gameId);

  const promise = (async () => {
    const already = await GameOstScrape.findOne({ gameId }).lean();
    if (already) return CustomOst.find({ gameId }).sort({ order: 1, createdAt: 1 });

    let playlist = null;
    let tracks = [];
    try {
      const candidates = await searchOstPlaylists(gameName);
      playlist = pickBestPlaylist(candidates, gameName);
      if (playlist) {
        const raw = await ytPlaylistTracks(playlist.playlistId);
        tracks = raw.slice(0, 200);
      }
    } catch (err) {
      console.error("ost auto-scrape error:", err.message);
    }

    // On pose la sentinelle (bloque les futures tentatives) uniquement si :
    //  - on a bien récupéré des pistes (succès), OU
    //  - aucune playlist candidate n'existe (ce jeu n'a pas d'OST sur YouTube).
    // Si une playlist a été trouvée mais renvoie 0 piste, c'est probablement
    // transitoire (rate-limit / page de consentement) → on retentera plus tard.
    const persistSentinel = !playlist || tracks.length > 0;
    if (persistSentinel) {
      await GameOstScrape.updateOne(
        { gameId },
        {
          $set: {
            playlistId: playlist?.playlistId || null,
            playlistTitle: playlist?.title || null,
            count: tracks.length,
            scrapedAt: new Date(),
          },
        },
        { upsert: true }
      );
    }

    if (tracks.length) {
      await CustomOst.insertMany(
        tracks.map((it, i) => ({
          gameId,
          name: cleanOstTitle(it.title, gameName),
          artist: null,
          url: `https://www.youtube.com/watch?v=${it.videoId}`,
          videoId: it.videoId,
          artwork: `https://img.youtube.com/vi/${it.videoId}/mqdefault.jpg`,
          source: "auto",
          order: i,
          playlistId: playlist?.playlistId || null,
        })),
        { ordered: false }
      ).catch((e) => console.error("ost insert error:", e.message));
    }

    return CustomOst.find({ gameId }).sort({ order: 1, createdAt: 1 });
  })();

  inFlight.set(gameId, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(gameId);
  }
}
