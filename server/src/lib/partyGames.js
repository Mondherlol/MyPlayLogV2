// ======================================================================
//  La Party — le plateau et les mini-jeux (routes/party.js)
// ======================================================================
// Un jeu de plateau à la Mario Party : chacun lance le dé à son tour, avance
// sur une boucle de cases, ramasse ou perd des pièces, et achète le Trophée
// (20 pièces) quand il passe dessus. Après chaque manche, un mini-jeu pour
// toute la table — tirés de ce que le site sait déjà faire :
//   - « blur »    : une jaquette floutée qui se dévoile, le premier qui trouve ;
//   - « price »   : Le juste prix (le prix Steam du jour, en euros) ;
//   - « trailer » : un trailer flouté qui se dévoile.
// Les réponses tapées passent par le dictionnaire de La Bombe
// (lib/bombCatalog.js : titres, abréviations, licences, fautes de frappe).

import GameFeatures from "../models/GameFeatures.js";
import { igdbQuery } from "./igdb.js";
import { steamOffer } from "./prices.js";
import { coverUrl, resolveTitle } from "./bombCatalog.js";

// ------------------------------------------------------------- le plateau
// 28 cases sur une boucle aux coins arrondis (une « superellipse »), avec une
// légère ondulation pour que le chemin ne soit pas un simple rectangle.
// Coordonnées dans un repère 100 × 62 (le client les met à l'échelle).
export const BOARD_W = 100;
export const BOARD_H = 62;
const N = 28;
const RED = new Set([5, 11, 17, 23]);
const CHANCE = new Set([3, 8, 13, 19, 25]);

// La boucle, tracée finement, puis les cases posées à intervalles ÉGAUX le
// long du tracé : sans ça, la superellipse les entasse dans les coins.
function loopPoint(t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return {
    x: 50 + 43 * Math.sign(c) * Math.abs(c) ** 0.55,
    y: 31 + 24 * Math.sign(s) * Math.abs(s) ** 0.55 + 1.4 * Math.sin(3 * t),
  };
}
const FINE = 2000;
const fine = Array.from({ length: FINE + 1 }, (_, k) => loopPoint(Math.PI / 2 + (k / FINE) * Math.PI * 2));
const cum = [0];
for (let k = 1; k <= FINE; k += 1)
  cum.push(cum[k - 1] + Math.hypot(fine[k].x - fine[k - 1].x, fine[k].y - fine[k - 1].y));
const total = cum[FINE];

export const BOARD = Array.from({ length: N }, (_, i) => {
  // On part du bas, au centre, et on tourne dans le sens des aiguilles.
  const want = (i / N) * total;
  let k = 0;
  while (k < FINE && cum[k] < want) k += 1;
  const { x, y } = fine[k];
  const type = i === 0 ? "start" : RED.has(i) ? "red" : CHANCE.has(i) ? "chance" : "blue";
  return { i, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, type };
});
export const BOARD_SIZE = N;

/** Une case bleue au hasard pour le Trophée (jamais celle où il était). */
export function nextTrophySpace(prev) {
  const options = BOARD.filter((s) => s.type === "blue" && s.i !== prev && Math.abs(s.i - prev) > 3);
  return options[Math.floor(Math.random() * options.length)].i;
}

// ------------------------------------------------------------- la chance
// Une case « ? » : un évènement tiré au sort. `apply` reçoit la table et le
// siège, et rend le texte à afficher.
export const CHANCE_EVENTS = [
  { key: "gift5", weight: 3, text: "Pluie de pièces : +5", run: (room, seat) => coins(seat, 5) },
  { key: "gift10", weight: 1, text: "Jackpot : +10", run: (room, seat) => coins(seat, 10) },
  { key: "tax", weight: 2, text: "Impôt surprise : −5", run: (room, seat) => coins(seat, -5) },
  {
    key: "steal",
    weight: 2,
    text: "Vol au premier : 5 pièces pour toi",
    run: (room, seat) => {
      const leader = [...room.seats]
        .filter((s) => s !== seat && !s.left)
        .sort((a, b) => b.trophies - a.trophies || b.coins - a.coins)[0];
      if (!leader) return coins(seat, 3);
      const n = Math.min(5, leader.coins);
      leader.coins -= n;
      seat.coins += n;
      return { stolenFrom: leader.id, amount: n };
    },
  },
  {
    key: "swap",
    weight: 1,
    text: "Échange de bourses avec un joueur au hasard",
    run: (room, seat) => {
      const others = room.seats.filter((s) => s !== seat && !s.left);
      if (!others.length) return null;
      const o = others[Math.floor(Math.random() * others.length)];
      [o.coins, seat.coins] = [seat.coins, o.coins];
      return { swappedWith: o.id };
    },
  },
  {
    key: "move",
    weight: 1,
    text: "Le Trophée déménage !",
    run: (room) => {
      room.trophyAt = nextTrophySpace(room.trophyAt);
      return { trophyAt: room.trophyAt };
    },
  },
];
function coins(seat, n) {
  seat.coins = Math.max(0, seat.coins + n);
  return { coins: n };
}
export function drawChance() {
  const total = CHANCE_EVENTS.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const e of CHANCE_EVENTS) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return CHANCE_EVENTS[0];
}

// ------------------------------------------------------------- les mini-jeux
export const MINI = {
  blur: {
    name: "Jaquette floutée",
    rules: "Une jaquette sort du brouillard. Le premier qui trouve le jeu gagne — trois essais.",
    durationMs: 25000,
  },
  price: {
    name: "Le juste prix",
    rules: "Combien coûte ce jeu sur Steam aujourd'hui ? Le plus proche gagne.",
    durationMs: 16000,
  },
  trailer: {
    name: "Trailer flouté",
    rules: "Un trailer flou, sans le son. Il se précise : trouve le jeu avant les autres.",
    durationMs: 32000,
  },
};
export const MINI_KEYS = Object.keys(MINI);

// Des jeux connus (≥ 120 votes IGDB) avec une jaquette : ceux qu'on a une
// chance de reconnaître floutés.
function famous(cat, min = 120) {
  const out = [];
  for (const g of cat.byId.values()) if (g.votes >= min && g.cover) out.push(g);
  return out;
}
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Prépare un mini-jeu : { kind, public, secret }. `public` part au client,
 * `secret` reste au serveur (la réponse). Rend null si la préparation échoue
 * (pas de prix, pas de trailer) — l'appelant en tire alors un autre.
 */
export async function prepareMini(kind, cat, recent = new Set()) {
  if (kind === "blur") {
    const pool = famous(cat).filter((g) => !recent.has(g.id));
    const g = pickOne(pool);
    return {
      kind,
      public: { cover: coverUrl(g.cover).replace("t_cover_big", "t_cover_big_2x") },
      secret: { id: g.id, name: g.name, cover: coverUrl(g.cover), year: g.year },
    };
  }
  if (kind === "price") {
    // Un jeu connu vendu sur Steam, à un vrai prix (ni gratuit ni à venir).
    const rows = await GameFeatures.aggregate([
      { $match: { steam: { $ne: null }, ratingCount: { $gte: 150 }, cover: { $ne: null } } },
      { $sample: { size: 8 } },
      { $project: { name: 1, cover: 1, steam: 1, date: 1 } },
    ]);
    for (const r of rows) {
      if (recent.has(r._id)) continue;
      // eslint-disable-next-line no-await-in-loop
      const offer = await steamOffer(r.steam).catch(() => null);
      if (!offer || offer.free || offer.comingSoon || !(offer.price > 0)) continue;
      const year = r.date ? new Date(r.date * 1000).getUTCFullYear() : null;
      return {
        kind,
        // `title` et non `name` : `name` est celui du mini-jeu dans la vue.
        public: { title: r.name, cover: coverUrl(r.cover), year },
        secret: { id: r._id, name: r.name, cover: coverUrl(r.cover), year, price: offer.price, cut: offer.cut || 0 },
      };
    }
    return null;
  }
  if (kind === "trailer") {
    const pool = famous(cat, 200).filter((g) => !recent.has(g.id));
    for (let k = 0; k < 4; k += 1) {
      const g = pickOne(pool);
      // eslint-disable-next-line no-await-in-loop
      const rows = await igdbQuery("games", `fields videos.video_id,videos.name; where id = ${g.id};`).catch(() => []);
      const vids = rows?.[0]?.videos || [];
      const v = vids.find((x) => /trailer/i.test(x.name || "")) || vids[0];
      if (!v?.video_id) continue;
      return {
        kind,
        public: { videoId: v.video_id },
        secret: { id: g.id, name: g.name, cover: coverUrl(g.cover), year: g.year },
      };
    }
    return null;
  }
  return null;
}

/** Une réponse tapée désigne-t-elle le jeu du mini-jeu ? */
export function sameGame(cat, text, targetId) {
  const found = resolveTitle(cat, text);
  return !!found && found.ids.includes(targetId);
}

// Les pièces du classement d'un mini-jeu : 1er, 2e, 3e.
export const MINI_PRIZES = [10, 6, 3];
