// ======================================================================
//  Le chat d'un salon de jeu
// ======================================================================
// Une conversation le temps d'une partie, greffée sur les salons à plusieurs :
// blind test, Pixel Rush, Grand Quiz, Le Perroquet, et les sessions de groupe
// du Mot du jour. Deux jeux ne l'ont PAS, et c'est délibéré :
//
//   • GeoGamer — on y cherche un lieu, et se parler c'est se donner la
//     réponse (« c'est au Japon ») ; le mode entier s'effondre ;
//   • L'Imposteur — le jeu EST une conversation réglée (un mot chacun, puis on
//     vote). Un canal libre à côté permettrait de se disculper hors tour, et il
//     a déjà sa frappe visible en direct.
//
// ----------------------------------------------------------------- en mémoire
// RIEN N'EST ÉCRIT EN BASE, et ce n'est pas une économie : c'est la même règle
// que le chrono des salons (lib/versusRoom.js). Une partie ne survit pas au
// redémarrage du process, sa conversation non plus — elle vaut pour la partie
// qui se joue, comme ce qu'on se lance à voix haute sur le canapé. Le fil sert
// quand même d'historique à qui actualise ou rejoint en cours de route, puisque
// tout le monde tape sur le même process.
//
// Le transport, lui, est celui du salon : on rediffuse sous SON nom d'évènement
// (« pxversus », « quizversus »…) avec `kind: "chat"`. Pas de nouvel écouteur à
// déclarer côté client — c'est exactement le piège documenté en tête de
// context/ChatContext.jsx, qu'on évite ici en n'inventant aucun nom.
import { emitTo } from "./realtime.js";
import { playerIds, findPlayer } from "./versusRoom.js";

// Ce qu'un salon garde sous la main. Au-delà, les plus vieux tombent : personne
// ne remonte le fil d'un versus de dix minutes.
const MAX_KEEP = 60;
const MAX_LEN = 300;
// Un salon oublié (partie finie, onglets fermés) ne doit pas retenir sa
// conversation indéfiniment — les documents eux-mêmes s'effacent au bout de 2 h.
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
// Un message par demi-seconde : de quoi tenir une conversation vive, pas de quoi
// noyer l'écran d'un adversaire pendant qu'il cherche.
const RATE_MS = 500;

// `${event}:${code}` → { at, seq, messages }
const logs = new Map();
// `${event}:${code}:${userId}` → horodatage du dernier envoi
const lastAt = new Map();

// Ce que chaque jeu a déclaré en montant son chat : comment lister ses membres,
// comment y retrouver quelqu'un. Les salons de versus rangent leurs joueurs dans
// `players[]`, le Mot du jour dans `members[]` — c'est la seule divergence, et
// elle ne vaut pas quatre copies du même routeur.
//
// Le registre sert aussi à `gameChatSystem`, qui n'a que le nom d'évènement sous
// la main au moment d'annoncer une arrivée.
const games = new Map();
const configOf = (event) =>
  games.get(event) || { memberIds: playerIds, find: findPlayer };

function prune(now) {
  for (const [key, log] of logs)
    if (now - log.at > ROOM_TTL_MS) {
      logs.delete(key);
      for (const k of lastAt.keys()) if (k.startsWith(`${key}:`)) lastAt.delete(k);
    }
}

function logOf(event, code) {
  const key = `${event}:${code}`;
  let log = logs.get(key);
  if (!log) {
    log = { at: Date.now(), seq: 0, messages: [] };
    logs.set(key, log);
  }
  log.at = Date.now();
  return log;
}

function push(event, room, message) {
  const log = logOf(event, room.code);
  log.seq += 1;
  const full = { id: `${room.code}-${log.seq}`, at: Date.now(), ...message };
  log.messages.push(full);
  if (log.messages.length > MAX_KEEP) log.messages.splice(0, log.messages.length - MAX_KEEP);
  emitTo(configOf(event).memberIds(room), event, {
    code: room.code,
    kind: "chat",
    message: full,
  });
  return full;
}

// Les lignes de service — « X a rejoint », « X est parti ». Elles font partie du
// fil : dans un salon qui se remplit en attendant l'hôte, savoir qui vient
// d'arriver est la moitié de l'intérêt du chat.
//
// Appelée depuis les routes /join et /leave des jeux, APRÈS le save et le
// populate (il faut le pseudo, donc le document peuplé).
export function gameChatSystem(event, room, kind, user) {
  if (!room?.code) return null;
  const name = user?.username || "Quelqu'un";
  return push(event, room, { system: kind, name });
}

// Vide la conversation d'un salon (relance de partie : le fil de la précédente
// n'a plus lieu d'être à l'écran).
export function gameChatReset(event, code) {
  logs.delete(`${event}:${code}`);
}

// ============================================================
//  Le montage sur le routeur d'un jeu
// ============================================================
// `load(code)` doit rendre le salon PEUPLÉ (on a besoin du pseudo et de la
// photo de l'auteur) ou `null` — c'est la même fonction que le jeu utilise
// déjà pour ses propres routes.
//
// `base` : le préfixe des routes, quand le jeu ne range pas ses salons à la
// racine de son routeur (le Mot du jour les met sous `/session/:code`).
//
// `memberIds` / `find` : où sont les gens dans le document. Par défaut, les
// `players[]` des salons de versus.
//
// `auth` : le middleware d'authentification, quand le routeur du jeu ne l'a pas
// posé une fois pour toutes (le Mot du jour le met route par route). Sans lui,
// `req.userId` serait vide et TOUT LE MONDE écrirait sous le nom de personne.
export function mountGameChat(
  router,
  { event, load, base = "/:code", memberIds = playerIds, find = findPlayer, auth = [] }
) {
  games.set(event, { memberIds, find });
  const guard = [].concat(auth);

  // GET <base>/chat — le fil depuis le début, pour qui arrive ou actualise.
  router.get(`${base}/chat`, ...guard, async (req, res) => {
    try {
      const room = await load(req.params.code);
      if (!room) return res.status(404).json({ error: "Ce salon n'existe plus." });
      // On ne lit le salon que si on en est : le code circule dans des liens.
      if (!memberIds(room).includes(String(req.userId))) return res.json({ messages: [] });
      prune(Date.now());
      res.json({ messages: logs.get(`${event}:${room.code}`)?.messages || [] });
    } catch {
      res.json({ messages: [] });
    }
  });

  // POST <base>/chat — un message. Seuls les joueurs du salon écrivent : un
  // spectateur muni du lien ne doit pas pouvoir souffler la réponse.
  router.post(`${base}/chat`, ...guard, async (req, res) => {
    try {
      const room = await load(req.params.code);
      if (!room) return res.status(404).json({ error: "Ce salon n'existe plus." });
      const me = find(room, req.userId);
      if (!me || me.leftAt) return res.status(403).json({ error: "Tu ne joues pas ici." });

      const text = String(req.body?.text || "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
      if (!text) return res.status(400).json({ error: "Message vide." });

      const now = Date.now();
      prune(now);
      const key = `${event}:${room.code}:${req.userId}`;
      if (now - (lastAt.get(key) || 0) < RATE_MS)
        return res.status(429).json({ error: "Doucement." });
      lastAt.set(key, now);

      const author = me.user || null;
      const message = push(event, room, {
        authorId: String(req.userId),
        author: {
          username: author?.username || "",
          avatar: author?.avatar || null,
        },
        text,
      });
      res.json({ message });
    } catch (err) {
      console.error(`${event} chat error:`, err.message);
      res.status(500).json({ error: "Message non envoyé." });
    }
  });
}
