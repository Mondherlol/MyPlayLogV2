import express from "express";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import multer from "multer";
import jwt from "jsonwebtoken";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
// Le modèle seulement, jamais le routeur : c'est `routes/watchparty.js` qui
// dépend d'ici (pour déposer une invitation en DM), et l'inverse ferait un
// cycle d'imports.
import WatchParty from "../models/WatchParty.js";
import { requireAuth } from "../middleware/auth.js";
import { addClient, removeClient, emitTo, onlineAmong } from "../lib/realtime.js";
import { statusOf, clearStatus } from "../lib/liveStatus.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { logEvent, ipOf } from "../lib/audit.js";
import { pushToUsers, preview } from "../lib/push.js";
// Les modèles seulement, là aussi (cf. WatchParty ci-dessus) : c'est le lien
// collé dans le message qui redevient une invitation.
import { cardFromLinks } from "../lib/inviteLinks.js";

const router = express.Router();

const MAX_TEXT = 2000;
const MAX_MEDIA = 4;
const PAGE = 30;

// --- Upload des images du chat (et des photos de groupe) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.join(__dirname, "../../uploads/chat");
fs.mkdirSync(CHAT_DIR, { recursive: true });

const chatUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, CHAT_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".png";
      cb(null, `m-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 6 * 1024 * 1024 }, // 6 Mo
  fileFilter: (req, file, cb) =>
    cb(null, /^image\/(jpe?g|png|webp|gif)$/.test(file.mimetype)),
});

// --- Upload des messages vocaux ---
// Séparé de l'upload d'images : ni le même filtre de type, ni la même taille.
// L'extension vient du TYPE MIME et jamais du nom de fichier envoyé par le
// client — un `MediaRecorder` ne nomme rien, et se fier au nom serait de toute
// façon la façon classique d'écrire n'importe quoi sur le disque.
//
// Les formats acceptés sont ceux que les navigateurs savent produire : webm
// (Chrome, Firefox), mp4/m4a (Safari), ogg (vieux Firefox). Tous se relisent
// dans une balise <audio>, donc rien à convertir côté serveur.
const VOICE_EXT = {
  "audio/webm": ".webm",
  // WAV : ce que produit un vocal passé par un effet de voix. Le navigateur ne
  // sait ré-encoder en compressé qu'en temps réel (cf. client/src/lib/voiceFx.js),
  // donc il nous rend du brut — mono 16 kHz, ce qui reste léger pour une voix.
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/aac": ".aac",
};
const MAX_VOICE_SEC = 300; // 5 min : au-delà, ce n'est plus un message

const voiceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, CHAT_DIR),
    filename: (req, file, cb) => {
      const base = String(file.mimetype).split(";")[0];
      cb(
        null,
        `v-${Date.now()}-${Math.round(Math.random() * 1e6)}${VOICE_EXT[base] || ".webm"}`
      );
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12 Mo ≈ 5 min largement
  fileFilter: (req, file, cb) =>
    cb(null, Object.hasOwn(VOICE_EXT, String(file.mimetype).split(";")[0])),
});

// ============================================================
//  Sérialisation
// ============================================================

const userCard = (u) =>
  u
    ? {
        id: u._id,
        username: u.username,
        avatar: u.avatar || null,
        // Dernier passage : affiché en « vu il y a 10 min » quand la personne
        // n'est pas connectée. Absent des cartes d'auteur de message (non
        // peuplé là-bas), ce qui ne gêne pas.
        lastSeenAt: u.lastSeenAt || null,
      }
    : null;

// « 0:07 » — la durée d'un vocal, lisible partout (aperçu, citation, bulle).
const fmtVoice = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Aperçu d'un message cité (bulle « en réponse à »).
function quoteOf(m) {
  if (!m) return null;
  const text = m.deletedAt
    ? ""
    : m.text ||
      (m.voice
        ? `🎤 Message vocal · ${fmtVoice(m.voice.duration)}`
        : m.game
        ? `🎮 ${m.game.name}`
        : m.ost
          ? `🎵 ${m.ost.name}`
          : m.party
            ? `📺 ${m.party.title}`
            : m.mot
              ? "🌡️ Mot du jour"
              : m.versus
                ? "⚔️ Versus"
                : m.book
                  ? `📖 ${m.book.title}`
                  : "");
  return {
    id: m._id,
    author: userCard(m.author),
    text,
    kind: m.voice
      ? "voice"
      : m.game
      ? "game"
      : m.ost
        ? "ost"
        : m.party
          ? "party"
          : m.mot
            ? "mot"
            : m.versus
              ? "versus"
              : m.book
                ? "book"
                : m.media?.length
              ? m.media[0].kind
              : "text",
    deleted: !!m.deletedAt,
  };
}

// Regroupe les réactions par émoji : [{ emoji, count, mine, users }].
function groupReactions(reactions, meId) {
  const map = new Map();
  for (const r of reactions || []) {
    const entry = map.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false };
    entry.count += 1;
    if (String(r.user) === String(meId)) entry.mine = true;
    map.set(r.emoji, entry);
  }
  return [...map.values()];
}

function serializeMessage(m, meId) {
  const deleted = !!m.deletedAt;
  return {
    id: m._id,
    conversation: String(m.conversation),
    author: userCard(m.author),
    mine: !!m.author && String(m.author._id || m.author) === String(meId),
    text: deleted ? "" : m.text || "",
    media: deleted ? [] : m.media || [],
    voice: deleted ? null : m.voice || null,
    mentions: (m.mentions || []).map((x) => x.username).filter(Boolean),
    replyTo: quoteOf(m.replyTo),
    reactions: deleted ? [] : groupReactions(m.reactions, meId),
    // Cartes riches (jeu recommandé / OST partagée / invitation à une séance).
    game: deleted ? null : m.game || null,
    ost: deleted ? null : m.ost || null,
    party: deleted ? null : m.party || null,
    mot: deleted ? null : m.mot || null,
    versus: deleted ? null : m.versus || null,
    book: deleted ? null : m.book || null,
    system: m.system || null,
    systemData: m.systemData || null,
    edited: !!m.editedAt,
    deleted,
    createdAt: m.createdAt,
  };
}

// Titre + photo d'une conversation, du point de vue du lecteur : un DM porte
// le nom de l'autre, un groupe sans nom liste ses membres.
function serializeConversation(c, meId, online) {
  const participants = (c.participants || []).map((p) => ({
    ...userCard(p),
    online: online.has(String(p._id || p)),
    // « Joue au Mot du jour · 39° » : ce que la personne est en train de faire,
    // affiché à la place de « en ligne » (cf. lib/liveStatus.js). Null la
    // plupart du temps — c'est un bonus, pas une donnée de la conversation.
    status: statusOf(p._id || p),
  }));
  const others = participants.filter((p) => String(p.id) !== String(meId));
  const mine = (c.reads || []).find((r) => String(r.user) === String(meId));
  const preview = c.lastMessage || {};
  return {
    id: c._id,
    isGroup: !!c.isGroup,
    name: c.name || "",
    title: c.isGroup
      ? c.name || others.map((o) => o.username).join(", ") || "Groupe"
      : others[0]?.username || "Moi-même",
    avatar: c.isGroup ? c.avatar || null : others[0]?.avatar || null,
    participants,
    others,
    ownerId: c.owner ? String(c.owner) : null,
    lastMessage: preview.at
      ? {
          text: preview.text || "",
          authorId: preview.author ? String(preview.author) : null,
          authorName: preview.authorName || "",
          kind: preview.kind || "text",
          at: preview.at,
        }
      : null,
    lastMessageAt: c.lastMessageAt,
    unread: mine?.unread || 0,
    // Mon dernier « vu » : sert à poser la barre « Nouveaux messages » à
    // l'ouverture du fil (style Discord).
    myReadAt: mine?.at || null,
    muted: (c.muted || []).some((u) => String(u) === String(meId)),
    // Accusés de lecture : « vu » sous la dernière bulle envoyée.
    reads: (c.reads || [])
      .filter((r) => String(r.user) !== String(meId) && r.at)
      .map((r) => ({ user: String(r.user), at: r.at })),
    online: !c.isGroup && others[0] ? !!others[0].online : false,
  };
}

const POPULATE_MESSAGE = [
  { path: "author", select: "username avatar" },
  {
    path: "replyTo",
    select: "text author media deletedAt game ost party mot versus book",
    populate: { path: "author", select: "username avatar" },
  },
];

// ============================================================
//  Helpers
// ============================================================

// Charge une conversation EN VÉRIFIANT que le lecteur en fait partie : toutes
// les routes passent par là, il n'y a donc pas de fil accessible de l'extérieur.
async function loadConversation(id, userId) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Conversation.findOne({ _id: id, participants: userId }).populate(
    "participants",
    "username avatar lastSeenAt"
  );
}

const participantIds = (c) =>
  (c.participants || []).map((p) => String(p._id || p));

// À qui puis-je écrire ? Uniquement aux gens qui sont abonnés à MOI : c'est
// leur abonnement qui vaut autorisation. Personne ne reçoit donc de message
// d'un inconnu, et il n'y a rien à bloquer ni à signaler.
function canMessage(me, target) {
  if (!me || !target) return false;
  if (String(me._id) === String(target._id)) return false;
  return (target.following || []).some((id) => String(id) === String(me._id));
}

// Message d'erreur commun (sans genre : le pseudo peut désigner n'importe qui).
const notAllowed = (username) =>
  `${username} n'est pas abonné(e) à toi : impossible d'ouvrir une discussion.`;

// Nettoie la liste des médias reçus du client (mêmes sources que les
// commentaires : notre upload ou GIPHY).
function sanitizeMedia(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m && typeof m.url === "string" && /^https?:\/\//.test(m.url))
    .slice(0, MAX_MEDIA)
    .map((m) => ({
      kind: m.kind === "gif" ? "gif" : "image",
      url: m.url,
      width: Number(m.width) || null,
      height: Number(m.height) || null,
    }));
}

// Le vocal reçu à l'envoi du message. On ne fait PAS confiance à ce que le
// client renvoie : l'URL doit être une de celles que /chat/voice a servies
// (même hôte, dossier des uploads du chat), sinon n'importe qui ferait afficher
// n'importe quel fichier du web dans une bulle qui a l'air d'être de nous.
function sanitizeVoice(v) {
  if (!v || typeof v.url !== "string") return null;
  if (!/^https?:\/\/[^/]+\/uploads\/chat\/[\w.-]+$/.test(v.url)) return null;
  const waveform = Array.isArray(v.waveform)
    ? v.waveform.slice(0, 48).map((n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0))))
    : [];
  return {
    url: v.url,
    duration: Math.min(MAX_VOICE_SEC, Math.max(0, Math.round(Number(v.duration) * 10) / 10 || 0)),
    waveform,
  };
}

const GIF_MAX_BYTES = 12 * 1024 * 1024; // 12 Mo : au-delà on garde l'URL distante

// Rapatrie un GIF GIPHY sur NOTRE serveur : GIPHY est parfois lent, et une fois
// hébergé chez nous le GIF s'affiche instantanément pour tous les participants
// (et reste dispo même si GIPHY tombe). Dédup par hash de l'URL. Best-effort :
// au moindre souci on renvoie l'URL d'origine (jamais bloquant pour l'envoi).
async function localizeGif(url, req) {
  try {
    const host = req.get("host");
    if (!host || url.includes(host)) return url; // déjà chez nous
    const ext = (url.match(/\.(gif|webp|mp4|png|jpe?g)(?:[?#]|$)/i)?.[1] || "gif").toLowerCase();
    const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
    const filename = `g-${hash}.${ext}`;
    const dest = path.join(CHAT_DIR, filename);
    const localUrl = `${req.protocol}://${host}/uploads/chat/${filename}`;
    if (fs.existsSync(dest)) return localUrl; // déjà téléchargé (dédup)

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return url;
    if (!/^image\//.test(res.headers.get("content-type") || "")) return url;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > GIF_MAX_BYTES) return url;
    fs.writeFileSync(dest, buf);
    return localUrl;
  } catch {
    return url;
  }
}

// Localise les GIF d'une liste de médias (les images uploadées sont déjà chez
// nous). Renvoie la liste avec les URL réécrites.
async function localizeMedia(media, req) {
  return Promise.all(
    media.map(async (m) =>
      m.kind === "gif" ? { ...m, url: await localizeGif(m.url, req) } : m
    )
  );
}

// Résout les @pseudos du texte en vrais comptes (pour la coloration + le lien).
async function resolveMentions(text) {
  const names = [
    ...new Set(
      [...String(text || "").matchAll(/@([\p{L}\p{N}_.-]{2,32})/gu)].map((m) =>
        m[1].toLowerCase()
      )
    ),
  ].slice(0, 10);
  if (!names.length) return [];
  const users = await User.find({ username: { $in: names } })
    .collation({ locale: "fr", strength: 2 }) // insensible à la casse
    .select("username")
    .lean();
  return users.map((u) => ({ user: u._id, username: u.username }));
}

// Texte de l'aperçu dans la liste des conversations.
function previewText(msg) {
  if (msg.system) return systemPreview(msg);
  if (msg.voice) return `Message vocal · ${fmtVoice(msg.voice.duration)}`;
  if (msg.game) return msg.text || `Jeu : ${msg.game.name}`;
  if (msg.ost) return msg.text || `OST : ${msg.ost.name}`;
  if (msg.party) return msg.text || `Watchparty : ${msg.party.title}`;
  if (msg.mot) return msg.text || "Mot du jour : rejoins la partie";
  if (msg.versus) return msg.text || "Versus : rejoins le salon";
  if (msg.book)
    return msg.text || `Planche ${(msg.book.page || 0) + 1} — ${msg.book.title}`;
  if (msg.text) return msg.text.slice(0, 120);
  if (msg.media?.length) return msg.media[0].kind === "gif" ? "GIF" : "Photo";
  return "";
}

// Type d'aperçu (icône dans la liste) : media, carte de jeu, carte d'OST…
function previewKind(msg) {
  if (msg.system) return "system";
  if (msg.voice) return "voice";
  if (msg.game) return "game";
  if (msg.ost) return "ost";
  if (msg.party) return "party";
  if (msg.mot) return "mot";
  if (msg.versus) return "versus";
  if (msg.book) return "book";
  if (msg.media?.length) return msg.media[0].kind;
  return "text";
}

function systemPreview(msg) {
  const d = msg.systemData || {};
  switch (msg.system) {
    case "created":
      return "Groupe créé";
    case "join":
      return `${(d.names || []).join(", ")} a rejoint le groupe`;
    case "leave":
      return `${d.name || "Quelqu'un"} a quitté le groupe`;
    case "rename":
      return `Groupe renommé « ${d.name || ""} »`;
    case "avatar":
      return "Photo du groupe modifiée";
    // La trace d'un appel vocal (routes/calls.js). Un appel manqué DOIT laisser
    // une ligne : c'est la seule chose qui reste quand on n'était pas là, et
    // c'est ce qu'on vient chercher en rouvrant la conversation.
    case "call":
      return d.missed ? "Appel manqué" : `Appel · ${d.duration || ""}`.trim();
    default:
      return "";
  }
}

// Enregistre un message ET met la conversation à jour : aperçu, date de tri,
// compteur de non-lus des AUTRES participants (et remise à zéro du mien).
async function persistMessage(conv, meId, payload) {
  const msg = await Message.create({ conversation: conv._id, ...payload });

  const preview = {
    text: previewText(msg),
    author: msg.author || null,
    authorName: "",
    kind: previewKind(msg),
    at: msg.createdAt,
  };
  const author = (conv.participants || []).find(
    (p) => String(p._id) === String(msg.author)
  );
  preview.authorName = author?.username || "";

  await Conversation.updateOne(
    { _id: conv._id },
    {
      $set: { lastMessage: preview, lastMessageAt: msg.createdAt },
      $inc: { "reads.$[other].unread": 1 },
    },
    { arrayFilters: [{ "other.user": { $ne: new mongoose.Types.ObjectId(String(meId)) } }] }
  );
  // L'expéditeur, lui, vient forcément de lire son propre fil.
  await Conversation.updateOne(
    { _id: conv._id, "reads.user": meId },
    { $set: { "reads.$.unread": 0, "reads.$.at": msg.createdAt } }
  );

  await msg.populate(POPULATE_MESSAGE);
  return msg;
}

// Diffuse un message à tous les participants. Chacun reçoit SA version
// (le drapeau `mine` et ses propres réactions dépendent du lecteur).
function broadcastMessage(conv, msg, event = "message") {
  for (const id of participantIds(conv)) {
    emitTo([id], event, {
      conversationId: String(conv._id),
      message: serializeMessage(msg, id),
    });
  }
}

// Message de service (« a rejoint le groupe »…), créé + diffusé.
// Exporté pour routes/calls.js, qui dépose la ligne d'appel dans le fil. Le
// sens de la dépendance compte : c'est l'appel qui connaît la messagerie, pas
// l'inverse — la messagerie marchait très bien avant qu'on puisse s'appeler.
export async function pushSystem(conv, actorId, system, systemData) {
  const msg = await persistMessage(conv, actorId, {
    author: actorId,
    system,
    systemData,
  });
  broadcastMessage(conv, msg);
  return msg;
}

// Prévient les participants qu'une conversation a changé (nom, membres,
// aperçu…) pour qu'ils rafraîchissent leur liste sans recharger la page.
// Notification push d'un nouveau message.
//
// On NE notifie PAS :
//  - l'auteur (il sait qu'il a écrit) ;
//  - les gens dont un onglet ou l'app est ouvert (`onlineAmong`) : ils ont déjà
//    reçu le message par le flux SSE, une notification ferait doublon ;
//  - ceux qui ont mis la conversation en sourdine.
//
// Volontairement sans `await` chez l'appelant : une notification lente ne doit
// pas retarder la réponse à celui qui vient d'envoyer son message.
function notifyPush(conv, msg, authorId) {
  try {
    const author = (conv.participants || []).find(
      (p) => String(p._id) === String(authorId)
    );
    const muted = new Set((conv.muted || []).map(String));
    const everyone = participantIds(conv);
    const online = onlineAmong(everyone);

    const targets = everyone.filter(
      (id) => id !== String(authorId) && !online.has(id) && !muted.has(id)
    );
    if (!targets.length) return;

    const who = author?.username || "Quelqu'un";
    pushToUsers(targets, {
      // Dans un groupe, le titre porte le groupe et le corps dit qui parle :
      // sans ça, trois notifications d'un même groupe se ressemblent toutes.
      title: conv.isGroup ? conv.name || "Groupe" : who,
      body: conv.isGroup
        ? `${who} : ${preview(previewText(msg))}`
        : preview(previewText(msg)),
      data: { type: "chat", conversationId: String(conv._id) },
    }).catch(() => {
      /* best-effort : le message est déjà en base */
    });
  } catch (err) {
    console.error("push notify error:", err.message);
  }
}

async function broadcastConversation(convId) {
  const fresh = await Conversation.findById(convId).populate(
    "participants",
    "username avatar lastSeenAt"
  );
  if (!fresh) return;
  const ids = participantIds(fresh);
  const online = onlineAmong(ids);
  for (const id of ids) {
    emitTo([id], "conversation", {
      conversation: serializeConversation(fresh, id, online),
    });
  }
}

// ============================================================
//  Envoi de cartes (recommandation de jeu, partage d'OST) — réutilisé par
//  d'autres routes (recommendations.js, /chat/share) pour déposer un message
//  riche dans le DM avec quelqu'un.
// ============================================================

// Retrouve ou ouvre la conversation à deux entre deux personnes.
export async function getOrCreateDm(aId, bId) {
  const members = [String(aId), String(bId)];
  const dmKey = [...members].sort().join(":");
  let conv = await Conversation.findOne({ dmKey }).populate(
    "participants",
    "username avatar lastSeenAt"
  );
  if (conv) return conv;
  conv = await Conversation.create({
    isGroup: false,
    dmKey,
    owner: aId,
    participants: members,
    reads: members.map((u) => ({ user: u, at: null, unread: 0 })),
    lastMessageAt: new Date(),
  });
  await conv.populate("participants", "username avatar lastSeenAt");
  return conv;
}

// Dépose une carte (jeu / OST / invitation à une séance, avec un mot optionnel)
// dans le DM et la diffuse.
export async function deliverCard({
  fromId,
  toId,
  text = "",
  game = null,
  ost = null,
  party = null,
  mot = null,
  versus = null,
  book = null,
}) {
  const conv = await getOrCreateDm(fromId, toId);
  const msg = await persistMessage(conv, fromId, {
    author: fromId,
    text: String(text || "").slice(0, MAX_TEXT),
    game,
    ost,
    party,
    mot,
    versus,
    book,
  });
  broadcastMessage(conv, msg);
  await broadcastConversation(conv._id);
  return { conv, msg, serialize: (viewerId) => serializeMessage(msg, viewerId) };
}

// La même chose, mais dans une conversation EXISTANTE (typiquement un groupe).
//
// Inviter un groupe de discussion à une partie, c'est écrire dans le fil qu'ils
// ont déjà plutôt que d'ouvrir cinq messages privés : tout le monde voit la
// même carte, et la discussion qui suit reste au même endroit. Il n'y a rien à
// vérifier de plus que l'appartenance de l'expéditeur — être dans le groupe,
// c'est le droit d'y écrire (c'est la règle de POST /messages).
//
// Renvoie `null` si la conversation n'existe pas ou si l'expéditeur n'en fait
// pas partie : à l'appelant de le signaler, jamais de lever.
export async function deliverCardToConversation({
  fromId,
  conversationId,
  text = "",
  game = null,
  ost = null,
  party = null,
  mot = null,
  versus = null,
  book = null,
}) {
  const conv = await loadConversation(conversationId, fromId);
  if (!conv) return null;
  const msg = await persistMessage(conv, fromId, {
    author: fromId,
    text: String(text || "").slice(0, MAX_TEXT),
    game,
    ost,
    party,
    mot,
    versus,
    book,
  });
  broadcastMessage(conv, msg);
  await broadcastConversation(conv._id);
  return { conv, msg };
}

// ============================================================
//  Flux temps réel (SSE)
// ============================================================
// `EventSource` ne sait pas poser d'en-tête Authorization : le jeton passe donc
// en query string (même origine, HTTPS de bout en bout via Caddy).
router.get("/stream", async (req, res) => {
  let userId;
  try {
    userId = jwt.verify(String(req.query.token || ""), process.env.JWT_SECRET).sub;
  } catch {
    return res.status(401).end();
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // au cas où un proxy nginx s'intercalerait
  });
  res.write("retry: 4000\n\n");
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  const first = addClient(userId, res) === 1;
  if (first) {
    notifyPresence(userId, true);
    // Le journal du serveur date ici les ARRIVÉES. C'est le seul signal fiable
    // de présence : le jeton JWT vit un mois, donc « s'est connecté » ne se
    // reproduit pas à chaque visite — alors que ce flux s'ouvre à chaque fois
    // que l'app est chargée, et se ferme quand le dernier onglet part.
    logEvent({
      kind: "presence",
      label: "est arrivé en ligne",
      actor: userId,
      ip: ipOf(req),
      ua: req.headers["user-agent"] || "",
    });
  }

  // Battement de cœur : garde le tunnel ouvert (proxies, 3G, veille mobile).
  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* le nettoyage se fait dans `close` */
    }
  }, 25000);

  const openedAt = Date.now();
  req.on("close", () => {
    clearInterval(ping);
    const left = removeClient(userId, res);
    if (!left) {
      notifyPresence(userId, false); // dernier onglet fermé
      logEvent({
        kind: "presence",
        label: "est reparti hors ligne",
        actor: userId,
        ms: Date.now() - openedAt, // durée de la session, en clair
        ip: ipOf(req),
      });
    }
  });
});

// Pastille verte : on ne prévient QUE les gens avec qui on a une conversation.
async function notifyPresence(userId, online) {
  try {
    const convs = await Conversation.find({ participants: userId })
      .select("participants")
      .lean();
    const targets = new Set();
    for (const c of convs) {
      for (const p of c.participants || []) {
        const id = String(p);
        if (id !== String(userId)) targets.add(id);
      }
    }
    // Dernier onglet fermé : on éteint aussi le statut d'activité, sinon
    // « Joue au Mot du jour » survivrait à la fermeture du navigateur pendant
    // toute la durée du TTL.
    if (!online) clearStatus(userId);
    emitTo(targets, "presence", {
      userId: String(userId),
      online,
      status: online ? statusOf(userId) : null,
    });

    // LES SALLES DE PROJECTION AUSSI. Fermer l'onglet en pleine séance n'envoie
    // aucun « je pars » — c'est le flux qui tombe, et rien d'autre. Sans cette
    // ligne, la tête de quelqu'un resterait allumée en haut de la salle des
    // heures après son départ, et les autres l'attendraient. La liste des
    // membres, elle, ne bouge pas : partir vraiment se fait par la porte
    // (POST /leave), un onglet fermé n'est qu'une absence.
    const parties = await WatchParty.find({ "members.user": userId, endedAt: null })
      .select("code members")
      .lean();
    for (const p of parties) {
      const others = p.members
        .map((m) => String(m.user))
        .filter((id) => id !== String(userId));
      if (others.length)
        emitTo(others, "party", {
          code: p.code,
          kind: "presence",
          userId: String(userId),
          online,
        });
    }
  } catch {
    /* la présence est un bonus : jamais bloquant */
  }
}

// ============================================================
//  Conversations
// ============================================================

// GET /api/chat/conversations — la liste, la plus récente en tête.
router.get("/conversations", requireAuth, async (req, res) => {
  try {
    const convs = await Conversation.find({ participants: req.userId })
      .sort({ lastMessageAt: -1 })
      .limit(80)
      .populate("participants", "username avatar lastSeenAt")
      .lean();
    const online = onlineAmong(
      convs.flatMap((c) => (c.participants || []).map((p) => p._id))
    );
    const list = convs
      // Un fil ouvert mais jamais utilisé n'existe que pour celui qui l'a
      // ouvert : personne ne voit débarquer une conversation vide.
      .filter((c) => c.lastMessage?.at || String(c.owner) === String(req.userId))
      .map((c) => serializeConversation(c, req.userId, online));

    // --- Discussions « prêtes » avec tous mes abonnés -----------------------
    // Pas besoin de créer une conversation à la main : quiconque est abonné à
    // moi (donc peut recevoir mes messages) apparaît déjà dans la liste, avec
    // un fil vide. Rien n'est écrit en base tant qu'aucun message n'est envoyé
    // — ces entrées sont purement virtuelles.
    const peersWithDm = new Set(
      list
        .filter((c) => !c.isGroup)
        .flatMap((c) => (c.others || []).map((o) => String(o.id)))
    );
    const followers = await User.find({ following: req.userId })
      .select("username avatar lastSeenAt")
      .limit(300)
      .lean();
    const onlineFollowers = onlineAmong(followers.map((u) => u._id));
    const virtuals = followers
      .filter((u) => !peersWithDm.has(String(u._id)))
      .sort((a, b) => a.username.localeCompare(b.username, "fr"))
      .map((u) => {
        const peer = {
          ...userCard(u),
          online: onlineFollowers.has(String(u._id)),
        };
        return {
          // Identifiant symbolique : la vraie conversation naît au 1er message.
          id: `new:${u._id}`,
          virtual: true,
          peerId: String(u._id),
          isGroup: false,
          name: "",
          title: u.username,
          avatar: u.avatar || null,
          participants: [peer],
          others: [peer],
          ownerId: null,
          lastMessage: null,
          lastMessageAt: null,
          unread: 0,
          myReadAt: null,
          muted: false,
          reads: [],
          online: peer.online,
        };
      });

    res.json({
      conversations: [...list, ...virtuals],
      unread: list.reduce((n, c) => n + c.unread, 0),
    });
  } catch (err) {
    console.error("chat conversations error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// GET /api/chat/unread-count — léger (repli si le flux SSE est coupé).
router.get("/unread-count", requireAuth, async (req, res) => {
  try {
    const convs = await Conversation.find({ participants: req.userId })
      .select("reads")
      .lean();
    const unread = convs.reduce((n, c) => {
      const mine = (c.reads || []).find(
        (r) => String(r.user) === String(req.userId)
      );
      return n + (mine?.unread || 0);
    }, 0);
    res.json({ unread });
  } catch {
    res.status(500).json({ error: "Erreur." });
  }
});

// GET /api/chat/contacts?q= — à qui puis-je écrire ? Mes abonnements et mes
// abonnés d'abord (les plus probables), puis la recherche ouverte.
router.get("/contacts", requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const me = await User.findById(req.userId).select("following").lean();
    const followingIds = (me?.following || []).map(String);

    const [following, followers] = await Promise.all([
      User.find({ _id: { $in: followingIds } })
        .select("username avatar privacy following")
        .lean(),
      User.find({ following: req.userId })
        .select("username avatar privacy following")
        .limit(200)
        .lean(),
    ]);

    const pool = new Map();
    const add = (u, relation) => {
      const id = String(u._id);
      if (id === String(req.userId)) return;
      const prev = pool.get(id);
      if (prev) {
        if (prev.relation !== relation) prev.relation = "mutual";
        return;
      }
      pool.set(id, { user: u, relation });
    };
    following.forEach((u) => add(u, "following"));
    followers.forEach((u) => add(u, "follower"));

    // Recherche ouverte : on complète avec les pseudos qui commencent par `q`.
    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const found = await User.find({
        username: { $regex: `^${safe}`, $options: "i" },
      })
        .select("username avatar privacy following")
        .limit(12)
        .lean();
      found.forEach((u) => add(u, "none"));
    }

    const meDoc = { _id: req.userId, following: followingIds };
    const lower = q.toLowerCase();
    const contacts = [...pool.values()]
      .filter(({ user }) => canMessage(meDoc, user))
      .filter(({ user }) => !q || user.username.toLowerCase().includes(lower))
      .sort((a, b) => {
        const rank = (r) => (r === "mutual" ? 0 : r === "following" ? 1 : 2);
        return (
          rank(a.relation) - rank(b.relation) ||
          a.user.username.localeCompare(b.user.username, "fr")
        );
      })
      .slice(0, 40)
      .map(({ user, relation }) => ({ ...userCard(user), relation }));

    res.json({ contacts });
  } catch (err) {
    console.error("chat contacts error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /api/chat/conversations — ouvre (ou retrouve) un fil.
// { userIds: [...], name? } — un seul destinataire et pas de nom = DM.
router.post("/conversations", requireAuth, async (req, res) => {
  try {
    const ids = [
      ...new Set(
        (Array.isArray(req.body?.userIds) ? req.body.userIds : [])
          .map(String)
          .filter((id) => mongoose.isValidObjectId(id) && id !== String(req.userId))
      ),
    ].slice(0, 20);
    if (!ids.length)
      return res.status(400).json({ error: "Choisis au moins une personne." });

    const me = await User.findById(req.userId).select("following username").lean();
    const targets = await User.find({ _id: { $in: ids } })
      .select("username avatar privacy following")
      .lean();
    if (targets.length !== ids.length)
      return res.status(404).json({ error: "Utilisateur introuvable." });

    const refused = targets.find((t) => !canMessage(me, t));
    if (refused)
      return res.status(403).json({
        error: notAllowed(refused.username),
      });

    const isGroup = ids.length > 1 || !!String(req.body?.name || "").trim();
    const members = [String(req.userId), ...ids];

    // DM : clé déterministe → on retombe toujours sur le même fil.
    if (!isGroup) {
      const dmKey = [...members].sort().join(":");
      const existing = await Conversation.findOne({ dmKey }).populate(
        "participants",
        "username avatar"
      );
      if (existing) {
        const online = onlineAmong(participantIds(existing));
        return res.json({
          conversation: serializeConversation(existing, req.userId, online),
          existing: true,
        });
      }
      const conv = await Conversation.create({
        isGroup: false,
        dmKey,
        owner: req.userId, // sert au filtrage des fils encore vides
        participants: members,
        reads: members.map((u) => ({ user: u, at: null, unread: 0 })),
        lastMessageAt: new Date(),
      });
      await conv.populate("participants", "username avatar lastSeenAt");
      const online = onlineAmong(participantIds(conv));
      // Le fil n'apparaît chez l'autre qu'au premier message : inutile de le
      // prévenir tout de suite (une conversation vide n'a rien à montrer).
      return res.status(201).json({
        conversation: serializeConversation(conv, req.userId, online),
      });
    }

    // Groupe déjà existant avec EXACTEMENT les mêmes membres : on prévient
    // plutôt que d'en empiler un second à l'identique. `force` passe outre.
    if (!req.body?.force) {
      const twin = await Conversation.findOne({
        isGroup: true,
        participants: { $all: members, $size: members.length },
      })
        .populate("participants", "username avatar lastSeenAt")
        .lean();
      if (twin) {
        const names = (twin.participants || [])
          .filter((p) => String(p._id) !== String(req.userId))
          .map((p) => p.username);
        return res.status(409).json({
          error: "Groupe déjà existant.",
          duplicate: {
            id: String(twin._id),
            title: twin.name || names.join(", ") || "Groupe",
          },
        });
      }
    }

    const conv = await Conversation.create({
      isGroup: true,
      name: String(req.body?.name || "").trim().slice(0, 60),
      owner: req.userId,
      participants: members,
      reads: members.map((u) => ({ user: u, at: null, unread: 0 })),
      lastMessageAt: new Date(),
    });
    await conv.populate("participants", "username avatar lastSeenAt");
    await pushSystem(conv, req.userId, "created", {
      names: targets.map((t) => t.username),
    });
    await broadcastConversation(conv._id);
    // Mission « Bande organisée » — pour le créateur comme pour les invités.
    for (const u of members) triggerMissionCheck(u);

    const online = onlineAmong(participantIds(conv));
    res.status(201).json({
      conversation: serializeConversation(conv, req.userId, online),
    });
  } catch (err) {
    console.error("chat create conversation error:", err.message);
    res.status(500).json({ error: "Impossible d'ouvrir la conversation." });
  }
});

// GET /api/chat/conversations/:id — une conversation seule (lien direct).
router.get("/conversations/:id", requireAuth, async (req, res) => {
  try {
    const conv = await loadConversation(req.params.id, req.userId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable." });
    const online = onlineAmong(participantIds(conv));
    res.json({ conversation: serializeConversation(conv, req.userId, online) });
  } catch {
    res.status(500).json({ error: "Erreur." });
  }
});

// PATCH /api/chat/conversations/:id — nom / photo d'un groupe.
router.patch("/conversations/:id", requireAuth, async (req, res) => {
  try {
    const conv = await loadConversation(req.params.id, req.userId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable." });
    if (!conv.isGroup)
      return res.status(400).json({ error: "Seuls les groupes se renomment." });

    if (typeof req.body?.name === "string") {
      const name = req.body.name.trim().slice(0, 60);
      if (name !== conv.name) {
        conv.name = name;
        await conv.save();
        await pushSystem(conv, req.userId, "rename", { name });
      }
    }
    if (typeof req.body?.avatar === "string" || req.body?.avatar === null) {
      conv.avatar = req.body.avatar || null;
      await conv.save();
      await pushSystem(conv, req.userId, "avatar", {});
    }
    await broadcastConversation(conv._id);
    const online = onlineAmong(participantIds(conv));
    res.json({ conversation: serializeConversation(conv, req.userId, online) });
  } catch (err) {
    console.error("chat patch conversation error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /api/chat/conversations/:id/members — ajoute du monde au groupe.
router.post("/conversations/:id/members", requireAuth, async (req, res) => {
  try {
    const conv = await loadConversation(req.params.id, req.userId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable." });
    if (!conv.isGroup)
      return res.status(400).json({ error: "Cette conversation est à deux." });

    const current = new Set(participantIds(conv));
    const ids = [
      ...new Set(
        (Array.isArray(req.body?.userIds) ? req.body.userIds : [])
          .map(String)
          .filter((id) => mongoose.isValidObjectId(id) && !current.has(id))
      ),
    ].slice(0, 20);
    if (!ids.length) return res.status(400).json({ error: "Personne à ajouter." });

    const me = await User.findById(req.userId).select("following").lean();
    const targets = await User.find({ _id: { $in: ids } })
      .select("username avatar privacy following")
      .lean();
    const refused = targets.find((t) => !canMessage(me, t));
    if (refused)
      return res.status(403).json({
        error: notAllowed(refused.username),
      });

    conv.participants.push(...targets.map((t) => t._id));
    conv.reads.push(...targets.map((t) => ({ user: t._id, at: null, unread: 0 })));
    await conv.save();
    await conv.populate("participants", "username avatar lastSeenAt");
    await pushSystem(conv, req.userId, "join", {
      names: targets.map((t) => t.username),
    });
    await broadcastConversation(conv._id);
    // Mission « Bande organisée » : les nouveaux venus rejoignent un groupe.
    for (const t of targets) triggerMissionCheck(t._id);

    const online = onlineAmong(participantIds(conv));
    res.json({ conversation: serializeConversation(conv, req.userId, online) });
  } catch (err) {
    console.error("chat add members error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// DELETE /api/chat/conversations/:id/members/:userId — quitter / exclure.
router.delete("/conversations/:id/members/:userId", requireAuth, async (req, res) => {
  try {
    const conv = await loadConversation(req.params.id, req.userId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable." });
    const target = String(req.params.userId);
    const isSelf = target === String(req.userId);
    if (!conv.isGroup)
      return res.status(400).json({ error: "Cette conversation est à deux." });
    if (!isSelf && String(conv.owner) !== String(req.userId))
      return res.status(403).json({ error: "Seul le créateur peut exclure." });
    if (!participantIds(conv).includes(target))
      return res.status(404).json({ error: "Cette personne n'est pas là." });

    const leaving = (conv.participants || []).find(
      (p) => String(p._id) === target
    );
    const before = participantIds(conv);

    conv.participants = conv.participants.filter((p) => String(p._id) !== target);
    conv.reads = conv.reads.filter((r) => String(r.user) !== target);
    conv.muted = (conv.muted || []).filter((u) => String(u) !== target);
    if (String(conv.owner) === target) conv.owner = conv.participants[0]?._id || null;

    // Groupe vidé : on efface tout (fil et messages) plutôt que de laisser un
    // orphelin invisible en base.
    if (!conv.participants.length) {
      await Message.deleteMany({ conversation: conv._id });
      await conv.deleteOne();
      emitTo(before, "conversation:gone", { conversationId: String(req.params.id) });
      return res.json({ ok: true, deleted: true });
    }

    await conv.save();
    await pushSystem(conv, req.userId, "leave", {
      name: leaving?.username || "Quelqu'un",
      kicked: !isSelf,
    });
    await broadcastConversation(conv._id);
    // La personne partie ne voit plus le fil : elle a besoin d'être prévenue.
    emitTo([target], "conversation:gone", { conversationId: String(conv._id) });

    res.json({ ok: true });
  } catch (err) {
    console.error("chat remove member error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /api/chat/conversations/:id/mute — bascule le mode silencieux.
router.post("/conversations/:id/mute", requireAuth, async (req, res) => {
  try {
    const conv = await loadConversation(req.params.id, req.userId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable." });
    const muted = (conv.muted || []).some((u) => String(u) === String(req.userId));
    if (muted) conv.muted = conv.muted.filter((u) => String(u) !== String(req.userId));
    else conv.muted.push(req.userId);
    await conv.save();
    res.json({ muted: !muted });
  } catch {
    res.status(500).json({ error: "Erreur." });
  }
});

// ============================================================
//  Messages
// ============================================================

// GET /api/chat/conversations/:id/messages?before=<date> — page d'historique.
router.get("/conversations/:id/messages", requireAuth, async (req, res) => {
  try {
    const conv = await loadConversation(req.params.id, req.userId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable." });

    const query = { conversation: conv._id };
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    if (before && !Number.isNaN(before.getTime())) query.createdAt = { $lt: before };

    const raw = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(PAGE)
      .populate(POPULATE_MESSAGE)
      .lean();

    res.json({
      messages: raw.reverse().map((m) => serializeMessage(m, req.userId)),
      hasMore: raw.length === PAGE,
    });
  } catch (err) {
    console.error("chat messages error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /api/chat/conversations/:id/messages — envoi.
router.post("/conversations/:id/messages", requireAuth, async (req, res) => {
  try {
    const conv = await loadConversation(req.params.id, req.userId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable." });

    let text = String(req.body?.text || "").trim().slice(0, MAX_TEXT);
    let media = sanitizeMedia(req.body?.media);
    // Un vocal EST le message : il ne se combine ni avec du texte ni avec des
    // images (une bulle qui porterait les deux ne saurait pas quoi montrer, et
    // aucune messagerie ne le propose).
    const voice = sanitizeVoice(req.body?.voice);
    if (voice) {
      text = "";
      media = [];
    }
    if (!voice && !text && !media.length)
      return res.status(400).json({ error: "Message vide." });
    // Rapatrie les GIF GIPHY chez nous (affichage instantané côté destinataires).
    media = await localizeMedia(media, req);

    let replyTo = null;
    if (req.body?.replyTo && mongoose.isValidObjectId(req.body.replyTo)) {
      // Une réponse ne peut citer qu'un message DU MÊME fil.
      const exists = await Message.exists({
        _id: req.body.replyTo,
        conversation: conv._id,
      });
      if (exists) replyTo = req.body.replyTo;
    }

    // Un lien de salon collé dans le fil vaut une invitation : on l'échange
    // contre la carte que le bouton « Inviter » aurait déposée, lien compris
    // (lib/inviteLinks.js). Rien ne bouge si le salon n'est plus rejoignable.
    const invite = await cardFromLinks(
      text,
      req.userId,
      `${req.protocol}://${req.get("host")}`
    );
    if (invite) text = invite.text;

    const msg = await persistMessage(conv, req.userId, {
      author: req.userId,
      text,
      media,
      mentions: await resolveMentions(text),
      replyTo,
      voice,
      ...(invite?.card || {}),
    });

    broadcastMessage(conv, msg);
    await broadcastConversation(conv._id);
    notifyPush(conv, msg, req.userId);

    // Journal : le message est tracé AVEC son destinataire et sa conversation,
    // ce que le middleware générique ne saurait pas dire. Le texte, lui, n'est
    // PAS recopié ici — il vit dans la collection Message, que l'onglet Logs
    // relit à la demande. Un journal qui dupliquerait chaque conversation
    // doublerait la base et survivrait aux suppressions de messages.
    const others = participantIds(conv).filter((id) => id !== String(req.userId));
    logEvent({
      kind: "message",
      label: conv.isGroup ? "a écrit dans un groupe" : "a envoyé un message privé",
      actor: req.userId,
      target: !conv.isGroup && others.length === 1 ? others[0] : null,
      targetName: conv.isGroup
        ? conv.name || "groupe"
        : (conv.participants || []).find((p) => String(p._id) === others[0])?.username || "",
      method: "POST",
      path: `/api/chat/conversations/${conv._id}/messages`,
      status: 201,
      ip: ipOf(req),
      meta: {
        conversation: String(conv._id),
        group: !!conv.isGroup,
        chars: text.length,
        media: media.length,
        recipients: others.length,
      },
    });

    res.status(201).json({ message: serializeMessage(msg, req.userId) });
  } catch (err) {
    console.error("chat send error:", err.message);
    res.status(500).json({ error: "Message non envoyé." });
  }
});

// PUT /api/chat/messages/:id — modification (auteur seulement).
router.put("/messages/:id", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Message introuvable." });
    const msg = await Message.findById(req.params.id);
    if (!msg || msg.deletedAt || msg.system)
      return res.status(404).json({ error: "Message introuvable." });
    if (String(msg.author) !== String(req.userId))
      return res.status(403).json({ error: "Ce message n'est pas le tien." });
    // Un vocal ne se corrige pas : on le supprime et on le refait. (Le client
    // ne propose déjà pas « Modifier » dessus — ceci est le garde-fou.)
    if (msg.voice)
      return res.status(400).json({ error: "Un message vocal ne se modifie pas." });

    const conv = await loadConversation(msg.conversation, req.userId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable." });

    const text = String(req.body?.text || "").trim().slice(0, MAX_TEXT);
    if (!text && !msg.media.length)
      return res.status(400).json({ error: "Message vide." });
    msg.text = text;
    msg.mentions = await resolveMentions(text);
    msg.editedAt = new Date();
    await msg.save();
    await msg.populate(POPULATE_MESSAGE);

    // Le dernier message a changé de texte : l'aperçu de la liste aussi.
    if (String(conv.lastMessage?.at) === String(msg.createdAt)) {
      await Conversation.updateOne(
        { _id: conv._id },
        { $set: { "lastMessage.text": previewText(msg) } }
      );
      await broadcastConversation(conv._id);
    }

    broadcastMessage(conv, msg, "message:update");
    res.json({ message: serializeMessage(msg, req.userId) });
  } catch (err) {
    console.error("chat edit error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// DELETE /api/chat/messages/:id — suppression douce (auteur, ou chef du groupe).
router.delete("/messages/:id", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Message introuvable." });
    const msg = await Message.findById(req.params.id);
    if (!msg || msg.deletedAt)
      return res.status(404).json({ error: "Message introuvable." });

    const conv = await loadConversation(msg.conversation, req.userId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable." });

    const isAuthor = String(msg.author) === String(req.userId);
    const isOwner = conv.isGroup && String(conv.owner) === String(req.userId);
    if (!isAuthor && !isOwner)
      return res.status(403).json({ error: "Suppression non autorisée." });

    msg.deletedAt = new Date();
    msg.text = "";
    msg.media = [];
    msg.mentions = [];
    msg.reactions = [];
    await msg.save();
    await msg.populate(POPULATE_MESSAGE);

    broadcastMessage(conv, msg, "message:update");
    if (String(conv.lastMessage?.at) === String(msg.createdAt)) {
      await Conversation.updateOne(
        { _id: conv._id },
        { $set: { "lastMessage.text": "Message supprimé", "lastMessage.kind": "text" } }
      );
      await broadcastConversation(conv._id);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("chat delete error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /api/chat/messages/:id/react — pose / retire une réaction émoji.
router.post("/messages/:id/react", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Message introuvable." });
    const emoji = String(req.body?.emoji || "").trim().slice(0, 8);
    if (!emoji) return res.status(400).json({ error: "Émoji manquant." });

    const msg = await Message.findById(req.params.id);
    if (!msg || msg.deletedAt)
      return res.status(404).json({ error: "Message introuvable." });
    const conv = await loadConversation(msg.conversation, req.userId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable." });

    const idx = msg.reactions.findIndex(
      (r) => r.emoji === emoji && String(r.user) === String(req.userId)
    );
    if (idx >= 0) msg.reactions.splice(idx, 1);
    else msg.reactions.push({ emoji, user: req.userId });
    await msg.save();
    await msg.populate(POPULATE_MESSAGE);

    broadcastMessage(conv, msg, "message:update");
    res.json({ message: serializeMessage(msg, req.userId) });
  } catch (err) {
    console.error("chat react error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /api/chat/conversations/:id/read — « j'ai tout lu ».
router.post("/conversations/:id/read", requireAuth, async (req, res) => {
  try {
    const conv = await loadConversation(req.params.id, req.userId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable." });
    const at = new Date();
    const updated = await Conversation.updateOne(
      { _id: conv._id, "reads.user": req.userId },
      { $set: { "reads.$.unread": 0, "reads.$.at": at } }
    );
    // Participant ajouté avant l'existence du champ `reads` : on le crée.
    if (!updated.matchedCount) {
      await Conversation.updateOne(
        { _id: conv._id },
        { $push: { reads: { user: req.userId, at, unread: 0 } } }
      );
    }
    emitTo(
      participantIds(conv).filter((id) => id !== String(req.userId)),
      "read",
      { conversationId: String(conv._id), userId: String(req.userId), at }
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /api/chat/conversations/:id/typing — « … est en train d'écrire ».
// Volatile : rien n'est stocké, on relaie juste aux autres.
router.post("/conversations/:id/typing", requireAuth, async (req, res) => {
  try {
    const conv = await loadConversation(req.params.id, req.userId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable." });
    const me = (conv.participants || []).find(
      (p) => String(p._id) === String(req.userId)
    );
    emitTo(
      participantIds(conv).filter((id) => id !== String(req.userId)),
      "typing",
      {
        conversationId: String(conv._id),
        user: userCard(me),
        stopped: !!req.body?.stopped,
      }
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /api/chat/media — image d'un message (ou photo de groupe).
router.post("/media", requireAuth, chatUpload.single("media"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier." });
  const url = `${req.protocol}://${req.get("host")}/uploads/chat/${req.file.filename}`;
  res.status(201).json({ media: { kind: "image", url } });
});

// POST /api/chat/voice — le fichier d'un message vocal.
//
// L'envoi se fait en DEUX TEMPS, comme les images : d'abord le fichier ici, qui
// rend son URL, puis le message qui la porte. C'est ce qui permet de commencer
// à téléverser dès que l'enregistrement s'arrête, pendant que la personne
// décide encore si elle envoie — et de ne rien laisser dans le fil si elle
// annule.
//
// La forme d'onde arrive du client, mesurée pendant l'enregistrement : on la
// borne (48 entiers 0..100) sans lui faire confiance, mais on ne la recalcule
// pas — décoder l'audio côté serveur pour redessiner ce que le micro nous a
// déjà donné serait du travail pur perte.
router.post("/voice", requireAuth, voiceUpload.single("voice"), (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: "Format audio non pris en charge." });

  const duration = Math.min(
    MAX_VOICE_SEC,
    Math.max(0, Math.round(Number(req.body?.duration || 0) * 10) / 10)
  );
  let waveform = [];
  try {
    const raw = JSON.parse(req.body?.waveform || "[]");
    if (Array.isArray(raw))
      waveform = raw
        .slice(0, 48)
        .map((n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0))));
  } catch {
    /* pas de silhouette : la bulle affichera des barres plates */
  }

  const url = `${req.protocol}://${req.get("host")}/uploads/chat/${req.file.filename}`;
  res.status(201).json({ voice: { url, duration, waveform } });
});

// POST /api/chat/share — partage une OST (mini-lecteur) à quelqu'un, en message.
// { toUserId, ost, message? }. Comme une recommandation, ça arrive dans le DM.
router.post("/share", requireAuth, async (req, res) => {
  try {
    const { toUserId, ost, message } = req.body || {};
    if (!mongoose.isValidObjectId(toUserId))
      return res.status(400).json({ error: "Destinataire invalide." });
    if (String(toUserId) === String(req.userId))
      return res.status(400).json({ error: "Tu ne peux pas te partager à toi-même." });
    if (!ost || !ost.name)
      return res.status(400).json({ error: "OST invalide." });

    const [me, target] = await Promise.all([
      User.findById(req.userId).select("following").lean(),
      User.findById(toUserId).select("username following").lean(),
    ]);
    if (!target) return res.status(404).json({ error: "Utilisateur introuvable." });
    if (!canMessage(me, target))
      return res.status(403).json({ error: notAllowed(target.username) });

    const card = {
      name: String(ost.name).slice(0, 200),
      artist: String(ost.artist || "").slice(0, 200),
      artwork: ost.artwork || null,
      videoId: ost.videoId || null,
      url: ost.url || null,
      gameId: Number(ost.gameId) || null,
      gameName: ost.gameName ? String(ost.gameName).slice(0, 200) : null,
    };
    await deliverCard({
      fromId: req.userId,
      toId: toUserId,
      text: message ? String(message).slice(0, 500) : "",
      ost: card,
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("chat share error:", err.message);
    res.status(500).json({ error: "Partage impossible." });
  }
});

// POST /api/chat/share-book — « regarde cette planche ».
// { userIds[], conversationIds[], message?, book: { slug, page, shot, … } }
//
// La capture est DÉJÀ chez nous : le lecteur l'envoie d'abord par /chat/media
// (le même envoi que n'importe quelle image de message), et ne passe ici que
// l'URL qu'on lui a rendue. On la revalide quand même — une carte est du
// contenu que d'autres vont afficher, et rien ne garantit que l'URL reçue
// vienne bien de notre propre réponse.
//
// Deux destinations d'un seul geste, comme les invitations de versus : des
// personnes (carte en message privé) et des groupes de discussion (carte dans
// le fil commun). On ne peut écrire qu'à ses abonnés, c'est la règle de la
// messagerie, et l'appartenance au groupe suffit pour le reste.
router.post("/share-book", requireAuth, async (req, res) => {
  try {
    const raw = req.body?.book || {};
    const slug = String(raw.slug || "").slice(0, 200);
    if (!slug) return res.status(400).json({ error: "Volume inconnu." });

    // La capture doit être une image servie par NOUS, dans le dossier du chat :
    // une URL quelconque ferait de la carte un cadre à charger n'importe où.
    const host = req.get("host");
    const shot = String(raw.shot || "");
    const ours =
      /^https?:\/\//.test(shot) && host && shot.includes(host) &&
      shot.includes("/uploads/chat/");
    if (shot && !ours)
      return res.status(400).json({ error: "Capture invalide." });

    const page = Math.max(0, Math.min(9999, Math.round(Number(raw.page) || 0)));
    const card = {
      slug,
      title: String(raw.title || "").slice(0, 200),
      franchise: String(raw.franchise || "").slice(0, 200),
      page,
      pages: Math.max(0, Math.min(9999, Math.round(Number(raw.pages) || 0))),
      shot: shot || null,
      color: raw.color ? String(raw.color).slice(0, 32) : null,
    };
    const text = req.body?.message ? String(req.body.message).slice(0, 500) : "";

    const userIds = [...new Set((req.body?.userIds || []).map(String))].slice(0, 10);
    const conversationIds = [
      ...new Set((req.body?.conversationIds || []).map(String)),
    ].slice(0, 10);
    if (!userIds.length && !conversationIds.length)
      return res.status(400).json({ error: "Choisis au moins un destinataire." });

    const me = await User.findById(req.userId).select("following").lean();
    const sent = [];
    const groups = [];

    for (const id of userIds) {
      if (!mongoose.isValidObjectId(id) || String(id) === String(req.userId)) continue;
      const target = await User.findById(id).select("username following").lean();
      // Un destinataire qui ne peut pas recevoir de message est SAUTÉ, pas une
      // erreur : on en a choisi cinq, quatre passent, et la réponse dit
      // lesquels — refuser le lot entier pour un abonnement défait serait
      // absurde.
      if (!target || !canMessage(me, target)) continue;
      await deliverCard({ fromId: req.userId, toId: id, text, book: card });
      sent.push(String(id));
    }

    for (const cid of conversationIds) {
      const out = await deliverCardToConversation({
        fromId: req.userId,
        conversationId: cid,
        text,
        book: card,
      });
      if (out) groups.push(String(cid));
    }

    res.status(201).json({ ok: true, sent, groups });
  } catch (err) {
    console.error("chat share book error:", err.message);
    res.status(500).json({ error: "Partage impossible." });
  }
});

export default router;
