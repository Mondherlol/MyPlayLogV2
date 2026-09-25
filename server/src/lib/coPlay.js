// ======================================================================
//  « Ceux qui ont aimé X ont aussi aimé Y » — le calcul, et rien d'autre
// ======================================================================
//
// Une fonction pure : des couples (joueur, jeu aimé) en entrée, les voisins de
// chaque jeu en sortie. Elle sert à deux endroits :
//   - scripts/buildCoPlay.js, sur ton PC, avec des millions d'avis publics
//     (Amazon, Steam) ;
//   - lib/recoCoPlay.js, sur le serveur, chaque nuit, avec les bibliothèques
//     des joueurs de MyPlayLog.
//
// ⚠️ COMPTER « X ET Y » NE SUFFIT PAS. Tout le monde a joué à GTA V : compté
// brut, il serait le voisin de tous les jeux. On mesure donc une ressemblance
// COSINUS — co(X,Y) / √(n(X)·n(Y)) — qui divise par la popularité des deux.
// Deux corrections par-dessus :
//   • un joueur qui a aimé 800 jeux dit moins, par paire, qu'un joueur qui en
//     a aimé 12 : son vote pèse 1 / log₂(2 + taille de sa liste) ;
//   • un lien vu chez 3 joueurs est fragile : on le rétrécit par
//     co / (co + SHRINK) — il faut une vraie foule pour atteindre 1 ;
//   • ⚠️ LE COSINUS NE SUFFIT PAS CONTRE LES MASTODONTES. Mesuré sur 88 000
//     bibliothèques Steam : Garry's Mod, Counter-Strike et Skyrim restaient
//     voisins de tout. La ressemblance est donc ASYMÉTRIQUE —
//     co / (n(X)^(1−β) · n(Y)^β) avec β > ½ — : la popularité du jeu PROPOSÉ
//     pèse plus lourd que celle du jeu de départ.
//
// Le coût est Σ (jeux aimés par joueur)². Plafonner chaque joueur à ses
// MAX_PER_USER jeux préférés le garde raisonnable (quelques secondes pour
// quelques millions de couples).

const MAX_PER_USER = 300;

/**
 * @param {Int32Array|number[]} users   joueur de chaque couple (entier)
 * @param {Int32Array|number[]} items   jeu de chaque couple (indice dense 0…nItems-1)
 * @param {number} nItems
 * @param {object} [opts]
 * @param {Float32Array|number[]} [opts.strength] force de chaque couple, pour
 *        garder les MAX_PER_USER plus forts d'un gros joueur (temps de jeu, note)
 * @param {number} [opts.minItemUsers=5]  un jeu aimé par moins de joueurs n'a pas de voisins
 * @param {number} [opts.minCo=3]         un lien vu chez moins de joueurs est ignoré
 * @param {number} [opts.shrink=10]
 * @param {number} [opts.top=40]
 * @param {number} [opts.beta=0.8] ½ = cosinus ; plus haut = plus sévère avec les jeux très joués
 * @param {(i:number)=>boolean} [opts.wanted] les jeux dont on veut les voisins
 * @returns {{ neighbors: Map<number, Array<[number, number]>>, itemUsers: Int32Array, users: number }}
 */
export function computeCoPlay(users, items, nItems, opts = {}) {
  const {
    strength = null,
    minItemUsers = 5,
    minCo = 3,
    shrink = 10,
    top = 40,
    beta = 0.8,
    wanted = null,
  } = opts;
  const n = users.length;

  // 1. Regrouper par joueur (tri des indices), sans doublon (joueur, jeu).
  const order = new Int32Array(n);
  for (let k = 0; k < n; k++) order[k] = k;
  order.sort((a, b) => users[a] - users[b] || items[a] - items[b]);

  const uStart = [];
  const uItems = [];
  for (let k = 0; k < n; ) {
    const u = users[order[k]];
    let list = [];
    for (; k < n && users[order[k]] === u; k++) {
      const idx = order[k];
      if (list.length && list[list.length - 1][0] === items[idx]) continue;
      list.push([items[idx], strength ? strength[idx] : 0]);
    }
    if (list.length < 2) continue; // un seul jeu aimé ne relie rien
    if (list.length > MAX_PER_USER) {
      list.sort((a, b) => b[1] - a[1]);
      list = list.slice(0, MAX_PER_USER);
    }
    uStart.push(uItems.length);
    for (const [it] of list) uItems.push(it);
  }
  uStart.push(uItems.length);
  const nUsers = uStart.length - 1;
  const U = Int32Array.from(uItems);
  const S = Int32Array.from(uStart);

  // 2. La liste inverse : jeu -> joueurs, et le poids de chaque joueur.
  const uw = new Float64Array(nUsers);
  const itemUsers = new Int32Array(nItems);
  for (let u = 0; u < nUsers; u++) {
    uw[u] = 1 / Math.log2(2 + (S[u + 1] - S[u]));
    for (let k = S[u]; k < S[u + 1]; k++) itemUsers[U[k]]++;
  }
  const iStart = new Int32Array(nItems + 1);
  for (let i = 0; i < nItems; i++) iStart[i + 1] = iStart[i] + itemUsers[i];
  const iUsers = new Int32Array(iStart[nItems]);
  const fill = iStart.slice(0, nItems);
  const W = new Float64Array(nItems); // somme des poids des joueurs qui aiment le jeu
  for (let u = 0; u < nUsers; u++)
    for (let k = S[u]; k < S[u + 1]; k++) {
      const i = U[k];
      iUsers[fill[i]++] = u;
      W[i] += uw[u];
    }

  // 3. Pour chaque jeu : ses co-joueurs, leurs autres jeux, la ressemblance.
  const acc = new Float64Array(nItems);
  const cnt = new Int32Array(nItems);
  const neighbors = new Map();
  for (let i = 0; i < nItems; i++) {
    if (itemUsers[i] < minItemUsers || (wanted && !wanted(i))) continue;
    const touched = [];
    for (let p = iStart[i]; p < iStart[i + 1]; p++) {
      const u = iUsers[p];
      const w = uw[u];
      for (let k = S[u]; k < S[u + 1]; k++) {
        const j = U[k];
        if (cnt[j] === 0) touched.push(j);
        cnt[j]++;
        acc[j] += w;
      }
    }
    const out = [];
    for (const j of touched) {
      const c = cnt[j];
      if (j !== i && c >= minCo) {
        const sim = (acc[j] / (W[i] ** (1 - beta) * W[j] ** beta)) * (c / (c + shrink));
        out.push([j, sim]);
      }
      acc[j] = 0;
      cnt[j] = 0;
    }
    if (!out.length) continue;
    out.sort((a, b) => b[1] - a[1]);
    neighbors.set(i, out.slice(0, top));
  }
  return { neighbors, itemUsers, users: nUsers };
}

/**
 * Ramène les forces d'une source sur une échelle commune, EN PLACE.
 *
 * ⚠️ CHAQUE SOURCE A SA PROPRE ÉCHELLE. Sur Steam, une bibliothèque est
 * complète : les meilleurs liens valent 0,2 à 0,6. Sur Amazon, un acheteur note
 * 1,6 jeu en moyenne : 35 000 avis d'Animal Crossing ne donnent que 74
 * acheteurs qui ont noté autre chose, et des liens JUSTES à 0,007 (Mario Kart
 * 8, Paper Mario, Link's Awakening). Mélangées telles quelles, Amazon
 * disparaîtrait sous Steam. Le lien « typique » de la source — le 75ᵉ centile
 * des meilleurs liens par jeu — vaut donc 0,5 après calibrage, et la courbe
 * 1 − e^(−x) garde l'ordre au-dessus au lieu de tout plafonner à 1.
 * Rend la valeur typique d'origine.
 */
export function calibrate(neighbors) {
  const top1 = [...neighbors.values()].map((l) => l[0][1]).sort((a, b) => a - b);
  const typical = top1[Math.floor(top1.length * 0.75)] || 1;
  for (const list of neighbors.values())
    for (const pair of list) pair[1] = 1 - Math.exp((-Math.LN2 * pair[1]) / typical);
  return typical;
}

/**
 * Fusionne les voisins venus de plusieurs sources (déjà calibrées). « Ou » probabiliste :
 * 1 − Π(1 − s). Deux sources qui s'accordent se renforcent ; une seule
 * source garde sa valeur ; aucune ne peut dépasser 1.
 * @param {Array<Map<number, Array<[number, number]>>>} maps
 */
export function mergeNeighbors(maps, top = 40) {
  const merged = new Map();
  for (const m of maps)
    for (const [i, list] of m) {
      let acc = merged.get(i);
      if (!acc) merged.set(i, (acc = new Map()));
      for (const [j, s] of list) acc.set(j, 1 - (1 - (acc.get(j) || 0)) * (1 - Math.min(1, s)));
    }
  const out = new Map();
  for (const [i, acc] of merged)
    out.set(
      i,
      [...acc].sort((a, b) => b[1] - a[1]).slice(0, top)
    );
  return out;
}
