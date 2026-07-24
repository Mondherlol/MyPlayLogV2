// ======================================================================
//  Boîte à outils des mini-jeux « devine le jeu »
// ======================================================================
// Partagée par le blind test (extrait d'OST) et Pixel Rush (screenshot
// pixelisé) : normalisation des titres, recherche tolérante et estimation des
// points. Les deux jeux notent pareil, donc une seule formule à maintenir.

export const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Version « collée » (sans espaces) : rend la recherche tolérante à la
// ponctuation et aux espaces mal placés — « assassins creed » et
// « assassin's creed » donnent tous deux « assassinscreed ».
export const squish = (s) => norm(s).replace(/\s+/g, "");

// Suffixes d'édition / portage / remaster à ignorer : deviner « BOTW » quand
// la réponse est « BOTW - Switch 2 Edition », c'est le même jeu → bonne
// réponse. Miroir EXACT de canonName()/sameGame() côté serveur
// (routes/blindtest.js, réutilisé par routes/pixel.js).
const EDITION_RE =
  /\b(nintendo switch 2 edition|nintendo switch edition|definitive edition|deluxe edition|complete edition|game of the year edition|goty edition|goty|enhanced edition|special edition|anniversary edition|legacy edition|collector s edition|ultimate edition|royal edition|directors cut|director s cut|remastered|remaster|remake|intergrade|redux|vr edition|hd)\b/g;

export const canonName = (s) =>
  norm(s).replace(EDITION_RE, " ").replace(/\s+/g, " ").trim();

export function sameGame(r, guessGameId, guessName) {
  if (guessGameId != null && Number(guessGameId) === Number(r.gameId)) return true;
  const a = canonName(guessName);
  return !!a && a === canonName(r.gameName);
}

// Acronymes d'un titre pour la recherche (« gta » → Grand Theft Auto,
// « botw » → Breath of the Wild, « ff7 » → Final Fantasy VII…). On génère les
// initiales du titre complet ET de chaque segment (avant/après « : » ou « - »),
// les nombres et chiffres romains étant gardés entiers (+ variante en chiffres).
const ROMAN = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8,
  ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16,
};

export function acronymsOf(rawName) {
  const out = new Set();
  const addFor = (words) => {
    if (words.length < 2) return;
    let a = ""; // « gtav », « ffvii »
    let b = ""; // variante chiffres : « gta5 », « ff7 »
    for (const w of words) {
      if (/^\d+$/.test(w)) {
        a += w;
        b += w;
      } else if (ROMAN[w]) {
        a += w;
        b += String(ROMAN[w]);
      } else {
        a += w[0];
        b += w[0];
      }
    }
    out.add(a);
    if (b !== a) out.add(b);
  };
  const allWords = norm(rawName).split(" ").filter(Boolean);
  addFor(allWords);
  for (const seg of String(rawName || "").split(/[:\-–—]/)) {
    const ws = norm(seg).split(" ").filter(Boolean);
    if (ws.length && ws.length !== allWords.length) addFor(ws);
  }
  return [...out];
}

// Miroir EXACT de scoreRound() côté serveur : le client affiche des points
// « en direct », le serveur recalcule la vérité au /finish.
export function estimatePoints(r, guessGameId, guessName, timeMs, durationSec) {
  const correct = sameGame(r, guessGameId, guessName);
  const dur = durationSec * 1000;
  const t = timeMs == null ? dur : Math.min(Math.max(timeMs, 0), dur);
  const frac = dur > 0 ? (dur - t) / dur : 0;
  const fam = r.owned
    ? Math.max(
        Math.min((r.playtimeHours || 0) / 40, 1),
        r.rating != null ? Math.max(0, (r.rating - 60) / 40) : 0
      )
    : 0;
  if (correct) {
    let pts = 200 + Math.round(600 * frac);
    if (!r.owned) pts += 250 + Math.round(150 * frac);
    else pts += Math.round(120 * fam);
    return pts;
  }
  if (r.owned) return -Math.round(60 + 240 * fam);
  return -40;
}

// Miroir EXACT de scoreRound() de routes/geo.js. GeoGamer a sa propre fonction
// plutôt qu'un paramètre en plus sur estimatePoints() : la difficulté du LIEU
// n'existe que là, et lui donner une valeur par défaut ici décalerait
// silencieusement les points affichés par le blind test et Pixel Rush.
export function estimateGeoPoints(r, guessGameId, guessName, timeMs, durationSec) {
  const correct = sameGame(r, guessGameId, guessName);
  if (!correct) return 0; // aucune sanction pour une mauvaise réponse
  const dur = durationSec * 1000;
  const t = timeMs == null ? dur : Math.min(Math.max(timeMs, 0), dur);
  const frac = dur > 0 ? (dur - t) / dur : 0;
  const hard = (Math.min(Math.max(r.difficulty || 3, 1), 5) - 1) / 4;
  return 300 + Math.round(300 * frac) + Math.round(200 * hard);
}

// Miroir EXACT de scoreMapGuess() de routes/geo.js — la manche bonus « où sur
// la carte ? ». Les positions sont des FRACTIONS de la carte : ni les
// dimensions du fichier ni la taille de l'écran n'entrent en jeu.
//
// Le barème vient de la source (relevé dans son geogamer.js), dont les paliers
// sont exprimés dans un repère de 2100 unités — d'où la remise à l'échelle —
// puis multiplié par 4 pour culminer à 400 comme nos autres manches.
export const MAP_FRAME = 2100;
export const MAP_MAX_POINTS = 400;

function mapCurve(d) {
  if (d <= 50) return 100;
  if (d <= 150) return Math.round(100 - 0.15 * (d - 50));
  if (d <= 300) return Math.round(85 - 0.133 * (d - 150));
  if (d <= 500) return Math.round(65 - 0.125 * (d - 300));
  if (d <= 800) return Math.round(40 - 0.083 * (d - 500));
  return Math.max(0, Math.round(15 - 0.015 * (d - 800)));
}

export function estimateMapPoints(map, guess) {
  if (!map || !guess) return { points: 0, distance: null };
  const distance = Math.hypot(guess.x - map.answer.x, guess.y - map.answer.y);
  return { points: mapCurve(distance * MAP_FRAME) * 4, distance };
}

// Une seule entrée par jeu « canonique » dans la recherche : pas de doublons
// éditions / versions / remasters (le nom le plus court = le jeu de base, et
// deviner l'un vaut l'autre grâce à sameGame). Précalcule au passage tout ce
// qui sert à la recherche : acronymes et corpus de noms (nom principal + noms
// alternatifs / FR), chacun en version normalisée ET « collée ».
export function dedupeCandidates(candidates) {
  const byCanon = new Map();
  for (const c of candidates || []) {
    const key = canonName(c.name) || norm(c.name);
    const prev = byCanon.get(key);
    if (!prev) {
      byCanon.set(key, c);
    } else {
      // On fusionne : on garde le nom le plus court comme libellé, mais on
      // cumule les noms alternatifs (FR, etc.) des deux entrées.
      const better = c.name.length < prev.name.length ? c : prev;
      byCanon.set(key, {
        ...better,
        cover: better.cover || prev.cover || c.cover,
        alt: [...(prev.alt || []), ...(c.alt || [])],
      });
    }
  }
  return [...byCanon.values()].map((c) => {
    const raw = [c.name, ...(c.alt || [])].filter(Boolean);
    const names = [...new Set(raw.map(norm))].filter(Boolean);
    const sq = [...new Set(raw.map(squish))].filter(Boolean);
    return { ...c, acr: acronymsOf(c.name), _names: names, _sq: sq };
  });
}

// Suggestions : préfixe > acronyme (« gta », « botw », « ff7 »…) > sous-chaîne.
// On teste le nom principal ET les noms alternatifs (FR…), en version normale
// et « collée » — donc « another code » trouve « Trace Memory », et
// « assassins creed » trouve « Assassin's Creed ».
export function searchCandidates(input, list, max = 8) {
  const q = norm(input);
  if (!q) return [];
  const qc = squish(input); // « gta 5 » / « assassin's » → « gta5 » / « assassins »
  const starts = [];
  const acro = [];
  const incl = [];
  for (const c of list) {
    if (c._names.some((n) => n.startsWith(q)) || c._sq.some((n) => n.startsWith(qc)))
      starts.push(c);
    else if (qc.length >= 2 && c.acr.some((a) => a.startsWith(qc))) acro.push(c);
    else if (
      c._names.some((n) => n.includes(q)) ||
      (qc.length >= 2 && c._sq.some((n) => n.includes(qc)))
    )
      incl.push(c);
    if (starts.length >= max) break;
  }
  return [...starts, ...acro, ...incl].slice(0, max);
}
