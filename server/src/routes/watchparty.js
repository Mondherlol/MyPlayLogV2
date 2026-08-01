import express from "express";
import WatchParty, { makeCode, MAX_PARTY_MESSAGES } from "../models/WatchParty.js";
import CollectionMedia from "../models/CollectionMedia.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFeature } from "../lib/features.js";
import { emitTo, onlineAmong } from "../lib/realtime.js";
import { deliverCard } from "./chat.js";
import { serializeFull } from "./collection.js";
import { extractVideoId, ytVideo } from "../lib/collection.js";

// ======================================================================
//  Watchparty — regarder à plusieurs, chacun chez soi
// ======================================================================
// Une salle, un hôte, un lien. Tout ce que le serveur fait ici tient en trois
// verbes : GARDER l'état (ce qu'on regarde, où en est la lecture, qui est là),
// REDIFFUSER ce que l'hôte décide, et TRANSMETTRE ce qui se dit.
//
// ------------------------------------------------------- pourquoi pas de socket
// Le temps réel passe par le flux SSE de la messagerie (`lib/realtime.js`,
// `GET /api/chat/stream`) — un seul tunnel par onglet, déjà ouvert, déjà géré
// par Caddy, et qui se reconnecte tout seul. Tous les évènements d'une salle
// sortent donc sous UN nom, `party`, et portent leur `kind` dans la charge :
// c'est ce qui évite d'aller ajouter un écouteur dans le contexte du chat à
// chaque geste qu'on invente ici.
//
//   kind: state    l'état de lecture a changé (l'hôte a joué / mis en pause /
//                  sauté) — ordre à appliquer chez l'invité ;
//   kind: tick     le battement de l'hôte (sa position), pour rattraper la
//                  dérive sans qu'il ait rien fait ;
//   kind: cue      le top de départ commun (« 3, 2, 1 ») ;
//   kind: content  on regarde autre chose (la salle recharge sa fiche) ;
//   kind: members  quelqu'un est entré ou sorti ;
//   kind: chat     un message ; kind: react  une réaction sur un message ;
//   kind: burst    une réaction qui s'envole par-dessus l'image (rien en base) ;
//   kind: typing   « … écrit » ; kind: end  l'hôte a fermé la salle.
//
// --------------------------------------------------- qui peut entrer, et comment
// LE CODE EST LA CLÉ. Dix caractères tirés au sort : qui l'a peut entrer, comme
// une invitation Discord — c'est ce que veut dire « un lien à copier et envoyer
// ailleurs ». L'invitation par DM, elle, suit la règle de la messagerie (on
// n'écrit qu'à quelqu'un qui est abonné à soi) ; le lien reste la porte pour
// tous les autres.

const router = express.Router();

// Le rayon vidéo et ses salles s'allument ensemble : une watchparty n'est qu'une
// façon de regarder la Collection à plusieurs. L'admin passe toujours (il
// prépare la page pendant qu'elle est éteinte).
router.use(requireAuth, requireFeature("collection"));

const MAX_TEXT = 2000;
const MAX_MEDIA = 4;
// Un émoji qui s'envole tient en quelques caractères — on ne laisse pas passer
// un roman déguisé en réaction.
const MAX_EMOJI = 16;

const abs = (req, p) =>
  p ? (p.startsWith("/uploads/") ? `${req.protocol}://${req.get("host")}${p}` : p) : null;

const userCard = (u) =>
  u ? { id: u._id, username: u.username, avatar: u.avatar || null } : null;

// ============================================================
//  Sérialisation
// ============================================================

function serializeMessage(m) {
  return {
    id: String(m._id),
    author: userCard(m.author),
    authorId: m.author ? String(m.author._id || m.author) : null,
    text: m.text || "",
    media: m.media || [],
    // Les réactions partent GROUPÉES (un émoji, un compte, la liste de ceux qui
    // l'ont posé) : c'est le client qui décide si l'une est la sienne, et il n'a
    // besoin que des identifiants pour ça.
    reactions: groupReactions(m.reactions),
    system: m.system || null,
    systemData: m.systemData || null,
    at: m.at,
  };
}

function groupReactions(reactions) {
  const map = new Map();
  for (const r of reactions || []) {
    const entry = map.get(r.emoji) || { emoji: r.emoji, users: [] };
    entry.users.push(String(r.user));
    map.set(r.emoji, entry);
  }
  return [...map.values()].map((e) => ({ ...e, count: e.users.length }));
}

function serializeParty(req, party, meId) {
  const memberIds = party.members.map((m) => String(m.user?._id || m.user));
  const online = onlineAmong(memberIds);
  const hostId = String(party.host?._id || party.host);
  return {
    code: party.code,
    host: userCard(party.host),
    hostId,
    isHost: hostId === String(meId),
    // Piloter, c'est décider pour tout le monde : l'hôte toujours, les autres si
    // la télécommande a été posée sur la table.
    canControl: hostId === String(meId) || !!party.openControl,
    openControl: !!party.openControl,
    member: memberIds.includes(String(meId)),
    members: party.members.map((m) => ({
      ...userCard(m.user),
      joinedAt: m.joinedAt,
      online: online.has(String(m.user?._id || m.user)),
      isHost: String(m.user?._id || m.user) === hostId,
    })),
    content: {
      type: party.content.type,
      slug: party.content.slug || "",
      episodeIndex: party.content.episodeIndex || 0,
      videoId: party.content.videoId || "",
      url: party.content.url || "",
      author: party.content.author || "",
      title: party.content.title || "",
      subtitle: party.content.subtitle || "",
      poster: abs(req, party.content.poster) || "",
    },
    state: {
      playing: !!party.state.playing,
      at: party.state.at || 0,
      episodeIndex: party.state.episodeIndex || 0,
      sourceAt: party.state.sourceAt || 0,
      // En millisecondes d'horloge : le client compare avec SA propre horloge
      // pour savoir depuis combien de temps ça joue (voir la dérive).
      updatedAt: new Date(party.state.updatedAt || Date.now()).getTime(),
      cueAt: party.state.cueAt || 0,
      // L'heure du serveur au moment de la réponse : c'est ce qui permet au
      // client de corriger le décalage entre son horloge et la nôtre. Sans elle,
      // une machine en avance de 30 s se croirait 30 s en retard dans le film.
      now: Date.now(),
    },
    endedAt: party.endedAt,
  };
}

// ============================================================
//  Helpers
// ============================================================

const POPULATE = [
  { path: "host", select: "username avatar" },
  { path: "members.user", select: "username avatar" },
  { path: "messages.author", select: "username avatar" },
];

async function loadParty(code) {
  if (!code || !/^[a-z0-9]{4,16}$/.test(String(code))) return null;
  return WatchParty.findOne({ code: String(code), endedAt: null }).populate(POPULATE);
}

const memberIdsOf = (party) =>
  party.members.map((m) => String(m.user?._id || m.user));

const isMember = (party, userId) => memberIdsOf(party).includes(String(userId));

// Diffuse à toute la salle. Le `code` part avec : un onglet peut être ouvert sur
// une autre salle, il doit pouvoir ignorer ce qui ne le concerne pas.
function toRoom(party, kind, payload = {}) {
  emitTo(memberIdsOf(party), "party", { code: party.code, kind, ...payload });
}

// Un geste dans la salle la garde vivante (le TTL de Mongo efface les salles
// sans signe de vie — voir le modèle).
function touch(party) {
  party.lastActiveAt = new Date();
}

// Ajoute une ligne de service au fil ET la diffuse : « X a rejoint », « on
// regarde maintenant Y ». C'est le fil de la soirée autant que la conversation.
function pushSystem(party, actorId, system, systemData = null) {
  const line = {
    author: actorId || null,
    system,
    systemData,
    at: new Date(),
  };
  party.messages.push(line);
  trim(party);
  return line;
}

function trim(party) {
  if (party.messages.length > MAX_PARTY_MESSAGES)
    party.messages = party.messages.slice(-MAX_PARTY_MESSAGES);
}

// Le dernier message tel qu'il sortira du document (avec son `_id` posé par
// Mongoose), auteur peuplé à la main : on vient de l'écrire, on sait qui c'est.
function lastMessage(party, author) {
  const m = party.messages[party.messages.length - 1];
  const plain = typeof m.toObject === "function" ? m.toObject() : m;
  return serializeMessage({ ...plain, author: author || m.author });
}

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

// ------------------------------------------------------------- le contenu
// Résout ce qu'on va regarder, depuis ce que le client demande. Deux natures,
// une seule sortie : de quoi remplir `content` du modèle.

async function resolveContent(body) {
  const youtubeUrl = String(body.youtubeUrl || "").trim();
  if (youtubeUrl) {
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) throw new Error("Ce lien n'est pas une vidéo YouTube.");
    // Le titre est un CONFORT, pas une condition : YouTube peut refuser de
    // répondre (quota, page remaniée) et la séance doit partir quand même.
    const info = await ytVideo(videoId).catch(() => null);
    return {
      type: "youtube",
      media: null,
      slug: "",
      episodeIndex: 0,
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      author: info?.channel || "",
      title: info?.title || "Vidéo YouTube",
      subtitle: info?.channel || "YouTube",
      poster: info?.thumbFallback || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  }

  const slug = String(body.slug || "").trim();
  if (!slug) throw new Error("Rien à regarder : il manque un titre ou un lien.");
  const media = await CollectionMedia.findOne({ slug }).lean();
  if (!media) throw new Error("Ce titre n'est pas sur l'étagère.");
  // Le papier et les cartouches ne se regardent pas ensemble : un volume de
  // manga se lit à son rythme, une partie de DS ne se pilote pas à distance.
  if (media.kind === "comic" || media.kind === "game")
    throw new Error("Seuls les séries et les films s'ouvrent en watchparty.");
  if (!media.episodes?.length)
    throw new Error("Ce titre n'a plus aucune source à jouer.");

  const index = Math.max(
    0,
    Math.min(Number(body.episodeIndex) || 0, media.episodes.length - 1)
  );
  const ep = media.episodes[index];
  const isSeries = media.kind === "series" && media.episodes.length > 1;
  return {
    type: "collection",
    media: media._id,
    slug: media.slug,
    episodeIndex: index,
    videoId: "",
    url: "",
    author: "",
    title: media.title,
    subtitle: isSeries
      ? `Épisode ${String(ep.number ?? index + 1).padStart(2, "0")}${
          ep.title ? ` · ${ep.title}` : ""
        }`
      : [media.year, media.studio].filter(Boolean).join(" · "),
    poster: media.artwork?.poster || "",
  };
}

// La fiche complète de ce qu'on regarde, telle que le lecteur l'attend. Pour une
// vidéo YouTube libre il n'y a pas de fiche en base : on en FABRIQUE une à un
// seul épisode, et le lecteur ne voit pas la différence — c'est ce qui permet de
// regarder un trailer avec la même mécanique de séance qu'une série du rayon.
async function contentMedia(req, content) {
  if (content.type === "youtube") {
    return {
      slug: null,
      kind: "film",
      title: content.title || "Vidéo YouTube",
      poster: abs(req, content.poster) || "",
      backdrop: "",
      color: "",
      year: null,
      studio: content.author || "",
      defaultHost: "",
      episodes: [
        {
          index: 0,
          number: 1,
          title: content.title || "Vidéo YouTube",
          provider: "youtube",
          videoId: content.videoId,
          url: content.url,
          mirrors: [],
          thumb: abs(req, content.poster) || "",
          duration: null,
        },
      ],
    };
  }
  const media = await CollectionMedia.findOne({ slug: content.slug }).lean();
  if (!media) return null;
  return serializeFull(req, media, null);
}

// ============================================================
//  Ouvrir / rejoindre / quitter
// ============================================================

// POST /api/watchparty — ouvre une salle. { slug, episodeIndex } ou { youtubeUrl }
router.post("/", async (req, res) => {
  try {
    const content = await resolveContent(req.body || {});
    // ON N'OUVRE UNE SALLE QUE SUR SES PROPRES BOÎTIERS. Le rayon est commun
    // mais les étagères sont personnelles (voir routes/collection.js) : sans ce
    // contrôle, la watchparty serait la porte dérobée du verrouillage — il
    // suffirait d'ouvrir une salle sur n'importe quel slug pour regarder ce
    // qu'on n'a pas débloqué.
    //
    // REJOINDRE, en revanche, reste ouvert à qui a le code : c'est tout l'objet
    // d'une séance partagée, et c'est l'hôte qui prête son boîtier le temps
    // d'une soirée. (Les liens YouTube collés n'appartiennent à personne : ils
    // ne passent pas par ici.)
    if (content.slug) {
      const me = await User.findById(req.userId).select("ownedCases").lean();
      const owns = (me?.ownedCases || []).some((c) => c.slug === content.slug);
      if (!owns)
        return res.status(403).json({
          error:
            "Ce boîtier n'est pas dans ta collection — débloque-le à la machine à capsules pour ouvrir une séance dessus.",
        });
    }
    // Une collision sur dix caractères tirés au sort est théorique ; l'index
    // unique la rattraperait de toute façon. On boucle deux fois, sans drame.
    let party = null;
    for (let tries = 0; tries < 3 && !party; tries += 1) {
      const code = makeCode();
      // eslint-disable-next-line no-await-in-loop
      const exists = await WatchParty.exists({ code });
      if (exists) continue;
      // eslint-disable-next-line no-await-in-loop
      party = await WatchParty.create({
        code,
        host: req.userId,
        content,
        members: [{ user: req.userId, joinedAt: new Date() }],
        state: {
          playing: false,
          at: 0,
          episodeIndex: content.episodeIndex || 0,
          sourceAt: 0,
          updatedAt: new Date(),
        },
      });
    }
    if (!party) return res.status(500).json({ error: "Salle non créée, réessaie." });
    await party.populate(POPULATE);
    res.status(201).json({ party: serializeParty(req, party, req.userId) });
  } catch (err) {
    res.status(400).json({ error: err.message || "Impossible d'ouvrir la séance." });
  }
});

// GET /api/watchparty/:code — l'état de la salle + la fiche à jouer.
//
// LA SALLE SE REGARDE AVANT D'Y ENTRER : on répond même à qui n'est pas encore
// membre (il faut bien lui montrer ce qu'on lui propose), mais SANS le fil de
// discussion — ce qui s'y dit n'appartient qu'à ceux qui sont dedans.
router.get("/:code", async (req, res) => {
  try {
    const party = await loadParty(req.params.code);
    if (!party) return res.status(404).json({ error: "Cette séance n'existe plus." });
    const mine = isMember(party, req.userId);
    const [media] = await Promise.all([contentMedia(req, party.content)]);
    res.json({
      party: serializeParty(req, party, req.userId),
      media,
      messages: mine ? party.messages.map(serializeMessage) : [],
    });
  } catch (err) {
    console.error("watchparty get error:", err.message);
    res.status(500).json({ error: "Séance illisible." });
  }
});

// POST /api/watchparty/:code/join — entrer dans la salle.
router.post("/:code/join", async (req, res) => {
  try {
    const party = await loadParty(req.params.code);
    if (!party) return res.status(404).json({ error: "Cette séance n'existe plus." });
    if (!isMember(party, req.userId)) {
      party.members.push({ user: req.userId, joinedAt: new Date() });
      const me = await User.findById(req.userId).select("username avatar").lean();
      pushSystem(party, req.userId, "join", { name: me?.username || "" });
      touch(party);
      await party.save();
      await party.populate(POPULATE);
      // La ligne « a rejoint » et la nouvelle liste partent ensemble : ceux qui
      // sont déjà là voient l'arrivée dans le fil ET dans les têtes en haut.
      toRoom(party, "chat", { message: lastMessage(party, me) });
      toRoom(party, "members", {
        members: serializeParty(req, party, req.userId).members,
      });
    } else {
      touch(party);
      await party.save();
    }
    const media = await contentMedia(req, party.content);
    res.json({
      party: serializeParty(req, party, req.userId),
      media,
      messages: party.messages.map(serializeMessage),
    });
  } catch (err) {
    console.error("watchparty join error:", err.message);
    res.status(500).json({ error: "Impossible de rejoindre la séance." });
  }
});

// POST /api/watchparty/:code/leave — sortir. L'hôte qui part FERME la salle :
// sans horloge de référence, il ne reste qu'une pièce vide où chacun regarde de
// son côté. Mieux vaut le dire.
router.post("/:code/leave", async (req, res) => {
  try {
    const party = await loadParty(req.params.code);
    if (!party) return res.json({ ok: true });
    const hostId = String(party.host?._id || party.host);
    if (hostId === String(req.userId)) {
      party.endedAt = new Date();
      await party.save();
      toRoom(party, "end", { by: req.userId });
      return res.json({ ok: true, ended: true });
    }
    const me = await User.findById(req.userId).select("username avatar").lean();
    party.members = party.members.filter(
      (m) => String(m.user?._id || m.user) !== String(req.userId)
    );
    pushSystem(party, req.userId, "leave", { name: me?.username || "" });
    touch(party);
    await party.save();
    await party.populate(POPULATE);
    toRoom(party, "chat", { message: lastMessage(party, me) });
    toRoom(party, "members", { members: serializeParty(req, party, req.userId).members });
    res.json({ ok: true });
  } catch (err) {
    console.error("watchparty leave error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ============================================================
//  Inviter
// ============================================================
// L'invitation est une CARTE DANS LE DM (voir Message.party) : elle reste dans
// la conversation, elle porte l'affiche et le bouton pour entrer, et elle
// bénéficie de tout ce que la messagerie sait déjà faire (pop-up, son, badge).
// La règle d'écriture de la messagerie s'applique telle quelle : on n'écrit
// qu'à qui est abonné à soi. Pour les autres, il y a le lien.

router.post("/:code/invite", async (req, res) => {
  try {
    const party = await loadParty(req.params.code);
    if (!party) return res.status(404).json({ error: "Cette séance n'existe plus." });
    if (!isMember(party, req.userId))
      return res.status(403).json({ error: "Rejoins la séance avant d'inviter." });

    const ids = [...new Set((req.body?.userIds || []).map(String))].slice(0, 20);
    if (!ids.length) return res.status(400).json({ error: "Personne à inviter." });

    const [me, targets] = await Promise.all([
      User.findById(req.userId).select("username").lean(),
      User.find({ _id: { $in: ids } }).select("username following").lean(),
    ]);

    const card = {
      code: party.code,
      title: party.content.title || "Watchparty",
      subtitle: party.content.subtitle || "",
      poster: abs(req, party.content.poster) || null,
      hostName: me?.username || "",
    };

    const sent = [];
    const skipped = [];
    for (const target of targets) {
      // Abonné à moi ? (`following` de la cible contient mon id.)
      const allowed = (target.following || []).some(
        (id) => String(id) === String(req.userId)
      );
      if (!allowed) {
        skipped.push({ id: String(target._id), username: target.username });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await deliverCard({
        fromId: req.userId,
        toId: target._id,
        text: String(req.body?.text || "").slice(0, 300),
        party: card,
      });
      sent.push({ id: String(target._id), username: target.username });
    }
    touch(party);
    await party.save();
    res.json({ sent, skipped });
  } catch (err) {
    console.error("watchparty invite error:", err.message);
    res.status(500).json({ error: "Invitation non envoyée." });
  }
});

// ============================================================
//  Piloter la lecture
// ============================================================
// L'ÉTAT DE LA SALLE EST CELUI DE L'HÔTE, pas une moyenne des participants.
// Chaque ordre est écrit puis rediffusé tel quel ; les invités le rejouent sans
// le renvoyer (voir `applyRemote` côté client), sinon deux navigateurs se
// passeraient la balle à l'infini.

function canControl(party, userId) {
  return (
    String(party.host?._id || party.host) === String(userId) || !!party.openControl
  );
}

router.post("/:code/state", async (req, res) => {
  try {
    const party = await loadParty(req.params.code);
    if (!party) return res.status(404).json({ error: "Cette séance n'existe plus." });
    if (!canControl(party, req.userId))
      return res.status(403).json({ error: "L'hôte tient la télécommande." });

    const body = req.body || {};
    const at = Math.max(0, Number(body.at) || 0);
    party.state.at = at;
    if (typeof body.playing === "boolean") party.state.playing = body.playing;
    if (Number.isFinite(Number(body.episodeIndex)))
      party.state.episodeIndex = Math.max(0, Number(body.episodeIndex));
    if (Number.isFinite(Number(body.sourceAt)))
      party.state.sourceAt = Math.max(0, Number(body.sourceAt));
    party.state.updatedAt = new Date();
    touch(party);
    await party.save();

    // Un BATTEMENT (`silent`) ne demande rien à personne : il dit juste où en est
    // l'hôte, pour que les autres rattrapent leur dérive et voient la barre
    // avancer. Un ORDRE, lui, s'applique — d'où deux `kind` différents.
    toRoom(party, body.silent ? "tick" : "state", {
      state: serializeParty(req, party, req.userId).state,
      action: body.silent ? null : body.action || null,
      by: String(req.userId),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("watchparty state error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /:code/cue — le top de départ commun. Une date dans un instant proche :
// tout le monde la reçoit, tout le monde voit le même décompte, et tout le monde
// part ensemble. C'est la SEULE synchronisation possible quand le lecteur ne se
// pilote pas (iframe d'un hébergeur tiers) — et elle fait aussi un joli départ
// quand il se pilote.
router.post("/:code/cue", async (req, res) => {
  try {
    const party = await loadParty(req.params.code);
    if (!party) return res.status(404).json({ error: "Cette séance n'existe plus." });
    if (!canControl(party, req.userId))
      return res.status(403).json({ error: "L'hôte tient la télécommande." });
    const delay = Math.min(10000, Math.max(1000, Number(req.body?.delay) || 3500));
    const cueAt = Date.now() + delay;
    party.state.cueAt = cueAt;
    party.state.at = Math.max(0, Number(req.body?.at) || party.state.at || 0);
    party.state.updatedAt = new Date();
    touch(party);
    await party.save();
    toRoom(party, "cue", {
      cueAt,
      at: party.state.at,
      now: Date.now(),
      by: String(req.userId),
    });
    res.json({ ok: true, cueAt });
  } catch (err) {
    console.error("watchparty cue error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /:code/content — on regarde autre chose. Remet l'horloge à zéro : c'est
// un nouveau départ, pas la suite du précédent.
router.post("/:code/content", async (req, res) => {
  try {
    const party = await loadParty(req.params.code);
    if (!party) return res.status(404).json({ error: "Cette séance n'existe plus." });
    if (!canControl(party, req.userId))
      return res.status(403).json({ error: "L'hôte choisit ce qu'on regarde." });

    const content = await resolveContent(req.body || {});
    party.content = content;
    party.state = {
      playing: false,
      at: 0,
      episodeIndex: content.episodeIndex || 0,
      sourceAt: 0,
      updatedAt: new Date(),
      cueAt: 0,
    };
    const me = await User.findById(req.userId).select("username avatar").lean();
    pushSystem(party, req.userId, "content", {
      name: me?.username || "",
      title: content.title,
      subtitle: content.subtitle,
    });
    touch(party);
    await party.save();
    await party.populate(POPULATE);

    const media = await contentMedia(req, party.content);
    const full = serializeParty(req, party, req.userId);
    toRoom(party, "content", { content: full.content, state: full.state, media });
    toRoom(party, "chat", { message: lastMessage(party, me) });
    res.json({ party: full, media });
  } catch (err) {
    res.status(400).json({ error: err.message || "Changement impossible." });
  }
});

// POST /:code/control-mode — l'hôte pose (ou reprend) la télécommande.
router.post("/:code/control-mode", async (req, res) => {
  try {
    const party = await loadParty(req.params.code);
    if (!party) return res.status(404).json({ error: "Cette séance n'existe plus." });
    if (String(party.host?._id || party.host) !== String(req.userId))
      return res.status(403).json({ error: "Seul l'hôte décide de ça." });
    party.openControl = !!req.body?.open;
    touch(party);
    await party.save();
    toRoom(party, "mode", { openControl: party.openControl });
    res.json({ openControl: party.openControl });
  } catch (err) {
    console.error("watchparty mode error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ============================================================
//  Le fil de la salle
// ============================================================

router.post("/:code/messages", async (req, res) => {
  try {
    const party = await loadParty(req.params.code);
    if (!party) return res.status(404).json({ error: "Cette séance n'existe plus." });
    if (!isMember(party, req.userId))
      return res.status(403).json({ error: "Rejoins la séance pour écrire." });

    const text = String(req.body?.text || "").slice(0, MAX_TEXT);
    const media = sanitizeMedia(req.body?.media);
    if (!text.trim() && !media.length)
      return res.status(400).json({ error: "Message vide." });

    party.messages.push({ author: req.userId, text, media, at: new Date() });
    trim(party);
    touch(party);
    await party.save();
    const me = await User.findById(req.userId).select("username avatar").lean();
    const message = lastMessage(party, me);
    toRoom(party, "chat", { message });
    res.status(201).json({ message });
  } catch (err) {
    console.error("watchparty message error:", err.message);
    res.status(500).json({ error: "Message non envoyé." });
  }
});

router.post("/:code/messages/:id/react", async (req, res) => {
  try {
    const party = await loadParty(req.params.code);
    if (!party) return res.status(404).json({ error: "Cette séance n'existe plus." });
    if (!isMember(party, req.userId))
      return res.status(403).json({ error: "Rejoins la séance." });
    const emoji = String(req.body?.emoji || "").slice(0, MAX_EMOJI);
    if (!emoji) return res.status(400).json({ error: "Réaction vide." });

    const msg = party.messages.id(req.params.id);
    if (!msg) return res.status(404).json({ error: "Message introuvable." });
    const at = msg.reactions.findIndex(
      (r) => r.emoji === emoji && String(r.user) === String(req.userId)
    );
    if (at >= 0) msg.reactions.splice(at, 1);
    else msg.reactions.push({ emoji, user: req.userId });
    touch(party);
    await party.save();
    const reactions = groupReactions(msg.reactions);
    toRoom(party, "react", { messageId: String(msg._id), reactions });
    res.json({ reactions });
  } catch (err) {
    console.error("watchparty react error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /:code/burst — la réaction qui S'ENVOLE par-dessus l'image. Rien n'est
// écrit : c'est un geste, pas un message. Une réaction qu'on retrouve dans le
// fil deux heures plus tard n'est plus une réaction.
router.post("/:code/burst", async (req, res) => {
  try {
    const party = await loadParty(req.params.code);
    if (!party) return res.status(404).json({ error: "Cette séance n'existe plus." });
    if (!isMember(party, req.userId)) return res.status(403).json({ error: "Rejoins la séance." });
    const emoji = String(req.body?.emoji || "").slice(0, MAX_EMOJI);
    if (!emoji) return res.status(400).json({ error: "Réaction vide." });
    const me = await User.findById(req.userId).select("username").lean();
    toRoom(party, "burst", {
      emoji,
      by: String(req.userId),
      name: me?.username || "",
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

router.post("/:code/typing", async (req, res) => {
  try {
    const party = await loadParty(req.params.code);
    if (!party || !isMember(party, req.userId)) return res.json({ ok: true });
    const me = await User.findById(req.userId).select("username").lean();
    // Diffusé à TOUT LE MONDE sauf soi : personne n'a besoin de se voir écrire.
    emitTo(
      memberIdsOf(party).filter((id) => id !== String(req.userId)),
      "party",
      {
        code: party.code,
        kind: "typing",
        by: String(req.userId),
        name: me?.username || "",
        stopped: !!req.body?.stopped,
      }
    );
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

export default router;
