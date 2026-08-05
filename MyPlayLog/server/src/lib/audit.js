import jwt from "jsonwebtoken";
import ServerLog from "../models/ServerLog.js";
import User from "../models/User.js";
import { emitTo } from "./realtime.js";

// ======================================================================
//  Le journal du serveur — écriture, étiquetage, diffusion
// ======================================================================
// Une seule porte d'entrée, `logEvent`, appelée depuis trois endroits :
//   - le middleware ci-dessous, pour toute requête qui écrit ou qui échoue ;
//   - routes/auth.js, pour les connexions (une connexion réussie n'écrit rien
//     en base, elle n'a donc pas de requête « écriture » à intercepter) ;
//   - routes/chat.js, pour l'ouverture et la fermeture du flux temps réel,
//     c'est-à-dire l'arrivée et le départ réels d'un joueur.
//
// TOUT EST « FIRE AND FORGET » : journaliser ne doit jamais ralentir une
// requête ni la faire échouer. Une écriture de log qui plante est avalée — un
// journal muet est ennuyeux, une app en panne parce que son journal est plein
// l'est beaucoup plus.

// --- Ce qu'on ne journalise jamais ---
// Des routes légitimes, mais appelées si souvent qu'elles n'apprendraient rien
// et rendraient le journal illisible : la frappe en cours part toutes les
// 200 ms, la synchro d'une watchparty à chaque seconde de lecture.
const SKIP = [
  /\/typing$/,
  /\/read$/,
  /^\/api\/notifications\/read$/,
  /^\/api\/patchnotes\/seen$/,
  /^\/api\/videos\/progress$/,
  /^\/api\/watchparty\/[^/]+\/(state|burst|cue)$/,
  /^\/api\/missions\/event$/,
  /^\/api\/presence$/,
  /^\/api\/client-errors/,
  /^\/api\/audio\//,
  // La connexion est journalisée à la main dans routes/auth.js : elle seule
  // sait QUI a tenté d'entrer quand ça échoue (le middleware, lui, ne verrait
  // qu'un 401 anonyme).
  /^\/api\/auth\//,
  // Idem pour l'envoi d'un message : la route sait à QUI il part et dans quelle
  // conversation, le middleware ne verrait qu'un identifiant opaque.
  /^\/api\/chat\/conversations\/[^/]+\/messages$/,
  // Le journal lui-même : sans cette ligne, ouvrir l'onglet Logs écrirait une
  // ligne de log, qui rafraîchirait la vue, qui écrirait une ligne…
  /^\/api\/admin\/logs/,
  // Les annonces push sont journalisées à la main dans routes/admin.js : la
  // route seule sait ce qui a été écrit et à combien d'appareils c'est parti,
  // et un essai adressé à soi-même ne mérite pas de ligne.
  /^\/api\/admin\/push\/send$/,
];

// --- Étiquettes lisibles ---
// L'ordre compte : la première expression qui accroche gagne. On décrit ce qui
// se voit dans l'app (« a commenté une liste »), jamais la route.
const LABELS = [
  [/^POST \/api\/chat\/conversations\/[^/]+\/messages$/, "a envoyé un message"],
  [/^POST \/api\/chat\/conversations$/, "a ouvert une discussion"],
  [/^POST \/api\/chat\/conversations\/[^/]+\/members$/, "a ajouté quelqu'un à un groupe"],
  [/^DELETE \/api\/chat\/conversations\/[^/]+\/members/, "a retiré quelqu'un d'un groupe"],
  [/^(PUT|DELETE) \/api\/chat\/messages\//, "a modifié ou supprimé un message"],
  [/^POST \/api\/chat\/messages\/[^/]+\/react$/, "a réagi à un message"],
  [/^POST \/api\/chat\/share$/, "a partagé une carte en message"],

  [/^PUT \/api\/library\//, "a mis à jour un jeu de sa bibliothèque"],
  [/^DELETE \/api\/library\//, "a retiré un jeu de sa bibliothèque"],

  [/^POST \/api\/lists$/, "a créé une liste"],
  [/^(PUT|DELETE) \/api\/lists\/[^/]+$/, "a modifié ou supprimé une liste"],
  [/^POST \/api\/lists\/[^/]+\/items$/, "a ajouté des jeux à une liste"],
  [/^POST \/api\/lists\/[^/]+\/comments/, "a commenté une liste"],
  [/^POST \/api\/lists\/[^/]+\/like$/, "a aimé une liste"],

  [/^POST \/api\/games\/[^/]+\/reviews\/[^/]+\/comments/, "a commenté un avis"],
  [/^DELETE \/api\/games\/[^/]+\/reviews\//, "a supprimé un avis"],
  [/^POST \/api\/games\/[^/]+\/cover$/, "a changé une jaquette"],
  [/^POST \/api\/games\/[^/]+\/translate$/, "a demandé une traduction"],
  [/^POST \/api\/games\/[^/]+\/ost/, "a touché aux OST d'un jeu"],

  [/^POST \/api\/game-media\/game\//, "a publié sur un mur média"],
  [/^POST \/api\/game-media\/[^/]+\/comments/, "a commenté un post du mur média"],
  [/^DELETE \/api\/game-media\//, "a supprimé un post du mur média"],

  [/^POST \/api\/users\/[^/]+\/follow$/, "a suivi quelqu'un"],
  [/^POST \/api\/users\/me\/avatar$/, "a changé sa photo de profil"],
  [/^POST \/api\/users\/me\/cover$/, "a changé sa bannière"],
  [/^PUT \/api\/users\/me\/privacy$/, "a changé ses réglages de confidentialité"],
  [/^PUT \/api\/users\/me/, "a modifié son profil"],
  [/^POST \/api\/users\/me\/follow-requests\//, "a répondu à une demande d'abonnement"],

  [/^POST \/api\/recommendations$/, "a recommandé un jeu"],
  [/^POST \/api\/reposts$/, "a republié un fan art"],
  [/^POST \/api\/videos\/recommend/, "a recommandé une vidéo"],

  [/^POST \/api\/blindtest\/finish$/, "a fini un blind test"],
  [/^POST \/api\/pixel\/finish$/, "a fini un Pixel Rush"],
  [/^POST \/api\/geo\/finish$/, "a fini un GeoGamer"],
  [/^POST \/api\/mot\/guess$/, "a proposé un mot"],
  [/^POST \/api\/mot\/session/, "a joué au mot du jour à plusieurs"],
  [/^(POST|PATCH) \/api\/mot\/team/, "a touché à une équipe du mot du jour"],
  [/^POST \/api\/arcade\/cases\/[^/]+\/open$/, "a ouvert une caisse"],
  [/^POST \/api\/arcade\/equip$/, "a équipé un objet"],
  [/^POST \/api\/collection\/gacha\/draw$/, "a tiré un boîtier"],
  [/^PUT \/api\/collection\/shelf$/, "a rangé son étagère"],
  [/^POST \/api\/collection\/[^/]+\/comments/, "a commenté un titre de la collection"],
  [/^POST \/api\/missions\/[^/]+\/claim$/, "a réclamé une mission"],

  [/^POST \/api\/watchparty$/, "a ouvert une séance"],
  [/^POST \/api\/watchparty\/[^/]+\/join$/, "a rejoint une séance"],
  [/^POST \/api\/watchparty\/[^/]+\/messages$/, "a écrit dans une séance"],

  [/^POST \/api\/downloads$/, "a téléchargé un fichier"],
  [/^POST \/api\/(steam|psn)\/import$/, "a importé sa bibliothèque"],
  [/^POST \/api\/psn\/request$/, "a demandé une synchro PlayStation"],
  [/^POST \/api\/trackers\//, "a branché un tracker de parties"],

  [/^DELETE \/api\/admin\/users\//, "a SUPPRIMÉ un compte"],
  [/^PATCH \/api\/admin\/users\/[^/]+\/password$/, "a changé le mot de passe d'un compte"],
  [/^PATCH \/api\/admin\/users\/[^/]+\/email$/, "a changé l'email d'un compte"],
  [/^PATCH \/api\/admin\/users\/[^/]+\/admin$/, "a changé les droits d'un compte"],
  [/^(POST|PUT|DELETE) \/api\/admin\/secrets/, "a modifié la configuration du serveur"],
  [/^\w+ \/api\/admin\//, "a fait une action d'administration"],
];

// Les gestes d'administration méritent leur propre couleur dans le journal :
// ce sont les seuls qu'on relit en se demandant « qui a fait ça ».
const ADMIN_PATH = /^\/api\/(admin|settings\/features)/;

export function describe(method, path) {
  const key = `${method} ${path}`;
  for (const [rx, label] of LABELS) if (rx.test(key)) return label;
  // Repli lisible : « a écrit sur collection/gacha » plutôt qu'un chemin brut.
  const rest = path.replace(/^\/api\//, "").split("?")[0];
  const verb = method === "DELETE" ? "a supprimé sur" : "a écrit sur";
  return `${verb} ${rest}`;
}

// --- À qui pousser le direct ---
// La liste des admins change rarement : on la garde une minute en mémoire
// plutôt que d'aller la chercher à chaque ligne de journal.
let adminCache = { at: 0, ids: [] };
const ADMIN_TTL = 60_000;

async function adminIds() {
  if (Date.now() - adminCache.at < ADMIN_TTL) return adminCache.ids;
  try {
    const admins = await User.find({
      $or: [{ isAdmin: true }, { isSuperAdmin: true }],
    })
      .select("_id")
      .lean();
    adminCache = { at: Date.now(), ids: admins.map((u) => String(u._id)) };
  } catch {
    adminCache = { at: Date.now(), ids: adminCache.ids };
  }
  return adminCache.ids;
}

// À appeler quand on promeut ou rétrograde quelqu'un : sans ça, le nouvel
// admin attend jusqu'à une minute avant de voir le flux en direct.
export function forgetAdmins() {
  adminCache = { at: 0, ids: [] };
}

// Forme envoyée au client (identique à celle de la route de lecture, pour que
// le panneau n'ait qu'un seul format à afficher).
export function publicLog(l) {
  return {
    id: String(l._id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    at: l.at,
    kind: l.kind,
    label: l.label || "",
    actor: l.actor
      ? { id: String(l.actor._id || l.actor), username: l.actorName || "", avatar: l.actorAvatar || null }
      : null,
    actorName: l.actorName || "",
    target: l.target ? String(l.target._id || l.target) : null,
    targetName: l.targetName || "",
    method: l.method || "",
    path: l.path || "",
    status: l.status ?? null,
    ms: l.ms ?? null,
    ip: l.ip || "",
    meta: l.meta || null,
  };
}

// --- Le nom de l'acteur ---
// Recopié dans la ligne pour qu'elle reste lisible après suppression du compte.
// Cache mémoire : une action génère souvent dix lignes d'affilée pour la même
// personne, ça ne vaut pas dix lectures en base.
const nameCache = new Map(); // userId -> { username, avatar, at }
const NAME_TTL = 5 * 60_000;

async function whois(userId) {
  if (!userId) return null;
  const key = String(userId);
  const hit = nameCache.get(key);
  if (hit && Date.now() - hit.at < NAME_TTL) return hit;
  try {
    const u = await User.findById(key).select("username avatar").lean();
    if (!u) return null;
    const entry = { username: u.username, avatar: u.avatar || null, at: Date.now() };
    nameCache.set(key, entry);
    // Le cache ne doit pas devenir une deuxième base d'utilisateurs.
    if (nameCache.size > 500) nameCache.delete(nameCache.keys().next().value);
    return entry;
  } catch {
    return null;
  }
}

// La porte d'entrée du journal. Ne lève jamais, ne se laisse jamais attendre.
export async function logEvent(entry) {
  try {
    const who = entry.actorName ? null : await whois(entry.actor);
    const doc = {
      at: entry.at || new Date(),
      kind: entry.kind || "action",
      label: String(entry.label || "").slice(0, 200),
      actor: entry.actor || null,
      actorName: entry.actorName || who?.username || "",
      target: entry.target || null,
      targetName: entry.targetName || "",
      method: entry.method || "",
      path: String(entry.path || "").slice(0, 300),
      status: entry.status ?? null,
      ms: entry.ms ?? null,
      ip: String(entry.ip || "").slice(0, 60),
      ua: String(entry.ua || "").slice(0, 250),
      meta: entry.meta || null,
    };
    const saved = await ServerLog.create(doc);
    // Direct : les admins qui ont l'onglet ouvert voient la ligne apparaître.
    const ids = await adminIds();
    if (ids.length)
      emitTo(ids, "adminlog", {
        entry: publicLog({ ...doc, _id: saved._id, actorAvatar: who?.avatar || null }),
      });
  } catch {
    /* un journal en panne ne casse rien */
  }
}

// L'adresse réelle derrière Caddy (app.set("trust proxy") est déjà posé).
const ipOf = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "";

// De secours, quand `req.userId` n'a pas été renseigné : une route INEXISTANTE
// ne traverse aucun `requireAuth`, donc un 404 arriverait anonyme alors que le
// jeton est là, valide, dans l'en-tête. Or « qui est tombé sur cette erreur »
// est précisément ce qu'on vient chercher dans un journal. On ne décode que
// dans ce cas — jamais sur le chemin normal, où l'info est déjà là.
function subFromHeader(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(header.slice(7), process.env.JWT_SECRET).sub || null;
  } catch {
    return null; // jeton expiré ou trafiqué : l'évènement reste anonyme
  }
}

// ----------------------------------------------------------------------
//  Le middleware
// ----------------------------------------------------------------------
// Monté TRÈS TÔT dans index.js, mais il ne décide de rien à l'aller : il pose
// un écouteur sur la fin de la réponse. C'est indispensable — `req.userId` est
// renseigné par `requireAuth`, qui vit à l'intérieur des routeurs, donc bien
// après ce point. À la fin de la requête, en revanche, tout est connu : qui,
// quel statut, combien de temps.
export function auditLog(req, res, next) {
  const started = Date.now();
  const path = req.originalUrl.split("?")[0];

  if (!path.startsWith("/api/") || SKIP.some((rx) => rx.test(path))) return next();

  res.on("finish", () => {
    const failed = res.statusCode >= 400;
    const writes = req.method !== "GET" && req.method !== "HEAD";
    // Les lectures réussies ne laissent pas de trace (cf. l'en-tête du modèle).
    if (!writes && !failed) return;

    logEvent({
      kind: failed
        ? "error"
        : ADMIN_PATH.test(path)
          ? "admin"
          : /^\/api\/chat\/conversations\/[^/]+\/messages$/.test(path)
            ? "message"
            : "action",
      label: describe(req.method, path),
      actor: req.userId || subFromHeader(req),
      method: req.method,
      path,
      status: res.statusCode,
      ms: Date.now() - started,
      ip: ipOf(req),
      ua: req.headers["user-agent"] || "",
      // L'identifiant de la cible quand la route en désigne une : c'est ce qui
      // permet de filtrer « tout ce qui a visé ce compte ».
      meta: failed ? { error: res.statusMessage || "" } : null,
    });
  });

  next();
}

export { ipOf };
