import User from "../models/User.js";
import UserGame from "../models/UserGame.js";
import List from "../models/List.js";
import BlindTest from "../models/BlindTest.js";
import PixelGame from "../models/PixelGame.js";
import GemDiscovery from "../models/GemDiscovery.js";
import Repost from "../models/Repost.js";
import Documentary from "../models/Documentary.js";
import GameTracker from "../models/GameTracker.js";
import Recommendation from "../models/Recommendation.js";
import GameMedia from "../models/GameMedia.js";
import Conversation from "../models/Conversation.js";
import MissionAward from "../models/MissionAward.js";
import MissionConfig from "../models/MissionConfig.js";
import Notification from "../models/Notification.js";
import { grantPoints, getBalance } from "./points.js";

// ======================================================================
//  Missions & badges — une façon de gagner points + badges en jouant.
// ======================================================================
// Le CATALOGUE vit ici (code, pas base) : ajouter une mission = ajouter une
// entrée ci-dessous. Chaque mission sait mesurer sa progression à partir des
// données déjà présentes (`progress`), donc les missions s'accomplissent aussi
// RÉTROACTIVEMENT (un joueur qui avait déjà 10 jeux accomplit « Collectionneur »
// dès la première évaluation).
//
// DEUX TEMPS, et c'est important : accomplir une mission la met en « à
// récupérer » (statut ready + notification), mais ne crédite RIEN. Les points
// n'arrivent que quand le joueur clique « Récupérer » (claimMission) — sinon on
// lui remplit sa cagnotte dans son dos et le badge n'a plus de saveur.
//
// `icon` : nom d'une icône lucide, rendue côté client (voir ProfileBadges.jsx).
// `tier` : bronze | silver | gold | platinum — pilote la couleur du badge.
//
// BARÈME : un geste anodin vaut ~100-200, une vraie habitude ~300-500, un
// effort qui se mérite 800-1000. Une caisse coûtant quelques centaines de
// points, une mission doit peser assez pour qu'on ait envie d'aller la chercher.
// Ces montants sont retouchables depuis le panel admin (voir MissionConfig).

// Les statuts qui veulent dire « j'y ai joué » — tout sauf la wishlist.
const PLAYED_STATUSES = ["playing", "finished", "paused", "dropped", "endless"];

// La plus longue série de connexions jamais atteinte. On regarde `best` (et
// non `current`) : un badge décroché à la sueur de 30 jours ne doit pas
// redevenir inaccessible parce qu'on a sauté un mardi. Voir lib/streak.js.
const bestStreak = (user) =>
  Math.max(user.streak?.best || 0, user.streak?.current || 0);

export const MISSIONS = [
  {
    key: "follow-one",
    title: "Premier contact",
    description: "Abonne-toi à un autre joueur.",
    icon: "UserPlus",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (_id, { user }) => (user.following || []).length,
  },
  {
    key: "finish-game",
    title: "Générique de fin",
    description: "Termine un jeu de ta bibliothèque.",
    icon: "Trophy",
    tier: "bronze",
    points: 300,
    target: 1,
    progress: (id) => UserGame.countDocuments({ user: id, status: "finished" }),
  },
  {
    key: "rate-game",
    title: "À mon humble avis",
    description: "Attribue une note à un jeu.",
    icon: "Star",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (id) => UserGame.countDocuments({ user: id, rating: { $ne: null } }),
  },
  {
    key: "like-list",
    title: "Bon public",
    description: "Aime la liste d'un autre joueur.",
    icon: "Heart",
    tier: "bronze",
    points: 120,
    target: 1,
    progress: (id) => List.countDocuments({ likes: id }),
  },
  {
    key: "open-case",
    title: "Chasseur de butin",
    description: "Ouvre une caisse à l'arcade.",
    icon: "PackageOpen",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (_id, { user }) => (user.inventory || []).length,
  },
  {
    key: "blindtest",
    title: "Oreille absolue",
    description: "Termine une partie de blind test.",
    icon: "Music2",
    tier: "bronze",
    points: 250,
    target: 1,
    progress: (id) => BlindTest.countDocuments({ user: id }),
  },
  {
    key: "pixelrush",
    title: "Œil de lynx",
    description: "Termine une partie de Pixel Rush.",
    icon: "Grid2x2",
    tier: "bronze",
    points: 250,
    target: 1,
    progress: (id) => PixelGame.countDocuments({ user: id }),
  },
  {
    key: "discover-gem",
    title: "Chercheur d'or",
    description: "Déniche une pépite indé depuis l'accueil.",
    icon: "Sparkles",
    tier: "bronze",
    points: 200,
    target: 1,
    // Une fournée de pépites = un document du jour (cf. models/GemDiscovery).
    progress: (id) => GemDiscovery.countDocuments({ user: id }),
  },
  {
    key: "watch-doc",
    title: "Ciné-club",
    description: "Lance un documentaire depuis l'accueil et regarde-le.",
    icon: "Film",
    tier: "bronze",
    points: 200,
    target: 1,
    // `watched` est posé par le lecteur au bout de ~30 s (cf. routes/videos.js) :
    // ouvrir puis fermer aussitôt ne compte pas.
    progress: (id) => Documentary.countDocuments({ user: id, watched: true }),
  },
  {
    key: "like-video",
    title: "Pouce en l'air",
    description: "Aime une vidéo recommandée par un joueur.",
    icon: "ThumbsUp",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (id) => Documentary.countDocuments({ user: id, liked: true }),
  },
  {
    key: "reply-review",
    title: "Droit de réponse",
    description: "Réponds à l'avis d'un autre joueur.",
    icon: "Reply",
    tier: "bronze",
    points: 200,
    target: 1,
    // Les réponses vivent dans l'entrée de biblio qui porte l'avis : on cherche
    // donc mes commentaires posés chez QUELQU'UN D'AUTRE.
    progress: (id) =>
      UserGame.countDocuments({ "comments.user": id, user: { $ne: id } }),
  },
  {
    key: "republish-fanart",
    title: "Galeriste",
    description: "Republie un fan art sur ton feed.",
    icon: "Repeat2",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (id) => Repost.countDocuments({ user: id }),
  },
  {
    key: "write-review",
    title: "Plume acérée",
    description: "Écris une review sur un jeu.",
    icon: "PenLine",
    tier: "bronze",
    points: 300,
    target: 1,
    progress: (id) => UserGame.countDocuments({ user: id, review: { $nin: [null, ""] } }),
  },
  {
    key: "favorite-character",
    title: "Chouchou",
    description: "Choisis ton personnage préféré sur un jeu.",
    icon: "UserRound",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (id) =>
      UserGame.countDocuments({ user: id, "favoriteCharacter.name": { $nin: [null, ""] } }),
  },
  {
    key: "dark-mode",
    title: "Côté obscur",
    description: "Passe l'application en thème sombre.",
    icon: "Moon",
    tier: "bronze",
    points: 100,
    target: 1,
    // Geste purement client : signalé une fois via POST /missions/event.
    progress: (_id, { user }) => ((user.missionFlags || []).includes("dark-mode") ? 1 : 0),
  },
  {
    key: "equip-cursor",
    title: "Ma patte",
    description: "Équipe un curseur gagné à l'arcade.",
    icon: "MousePointer2",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (_id, { user }) => (user.equipped?.cursor ? 1 : 0),
  },
  {
    key: "favorite-ost",
    title: "Coup de cœur sonore",
    description: "Mets une bande-son en OST favorite.",
    icon: "Disc3",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (id) =>
      UserGame.countDocuments({ user: id, "favoriteOst.name": { $nin: [null, ""] } }),
  },
  {
    key: "explorer-list",
    title: "Vue d'ensemble",
    description: "Essaie l'affichage en liste dans l'Explorer.",
    icon: "List",
    tier: "bronze",
    points: 100,
    target: 1,
    // Geste purement client : signalé via POST /missions/event.
    progress: (_id, { user }) =>
      (user.missionFlags || []).includes("explorer-list") ? 1 : 0,
  },
  {
    key: "comment-list",
    title: "Mot de la fin",
    description: "Commente la liste d'un joueur.",
    icon: "MessageSquare",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (id) => List.countDocuments({ "comments.user": id }),
  },
  {
    key: "boost-reco",
    title: "Je plussoie",
    description: "Fais +1 sur une recommandation de jeu.",
    icon: "Flame",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (id) => Recommendation.countDocuments({ boosters: id }),
  },
  {
    key: "game-media-post",
    title: "Reporter de terrain",
    description: "Publie un post sur le mur d'un jeu.",
    icon: "ImagePlus",
    tier: "bronze",
    points: 250,
    target: 1,
    progress: (id) => GameMedia.countDocuments({ user: id }),
  },
  {
    key: "two-covers",
    title: "Galerie perso",
    description: "Mets deux photos de couverture sur ton profil.",
    icon: "Images",
    tier: "bronze",
    points: 250,
    target: 2,
    progress: (_id, { user }) => (user.covers || []).length,
  },
  {
    key: "ost-order",
    title: "Mon classement",
    description: "Range tes OST favorites par ordre de préférence.",
    icon: "ArrowUpDown",
    tier: "bronze",
    points: 250,
    target: 1,
    progress: (_id, { user }) => (user.ostOrder || []).length,
  },
  {
    key: "write-bio",
    title: "Présentations",
    description: "Écris ta bio sur ton profil.",
    icon: "Quote",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (_id, { user }) => ((user.bio || "").trim() ? 1 : 0),
  },
  {
    key: "profile-character",
    title: "Si j'étais un perso",
    description: "Choisis le personnage de jeu qui te représente.",
    icon: "VenetianMask",
    tier: "bronze",
    points: 150,
    target: 1,
    // La « tagline » du profil : le personnage choisi dans la modale d'édition,
    // celle-là même où l'on écrit sa bio.
    progress: (_id, { user }) => ((user.tagline || "").trim() ? 1 : 0),
  },
  {
    key: "chat-group",
    title: "Bande organisée",
    description: "Crée ou rejoins ton premier groupe dans la messagerie.",
    icon: "MessagesSquare",
    tier: "bronze",
    points: 200,
    target: 1,
    // Créé par soi ou rejoint sur invitation : dans les deux cas on est dans
    // les participants — c'est la seule chose qui compte.
    progress: (id) => Conversation.countDocuments({ isGroup: true, participants: id }),
  },
  {
    key: "streak-3",
    title: "Petit rituel",
    description: "Connecte-toi 3 jours d'affilée.",
    icon: "CalendarDays",
    tier: "bronze",
    points: 200,
    target: 3,
    progress: (_id, { user }) => bestStreak(user),
  },
  {
    key: "recommend-video",
    title: "Bon plan vidéo",
    description: "Recommande une vidéo depuis ton profil.",
    icon: "Clapperboard",
    tier: "silver",
    points: 300,
    target: 1,
    progress: (id) => Documentary.countDocuments({ user: id, recommended: true }),
  },
  {
    key: "recommend-game",
    title: "Passeur de jeux",
    description: "Recommande un jeu à un autre joueur.",
    icon: "Send",
    tier: "silver",
    points: 300,
    target: 1,
    progress: (id) => Recommendation.countDocuments({ "recommenders.user": id }),
  },
  {
    key: "favorite-platform",
    title: "Team console",
    description: "Épingle ta console favorite.",
    icon: "Joystick",
    tier: "silver",
    points: 300,
    target: 1,
    // DEUX façons d'épingler sa console, et les deux comptent : depuis la page
    // d'une console (/platform/:id → user.favoritePlatforms) ou depuis la carte
    // « Console favorite » de l'aperçu du profil, qui range son choix dans
    // asideConfig.console (cf. ProfileAsideCardModal). Ne regarder que la
    // première laissait le badge inaccessible pour qui passe par le profil.
    progress: (_id, { user }) =>
      (user.favoritePlatforms || []).length ||
      (user.asideConfig?.console?.mode === "pin" && user.asideConfig.console.platform
        ? 1
        : 0),
  },
  {
    key: "favorite-company",
    title: "Fidèle au studio",
    description: "Épingle un studio ou un éditeur favori.",
    icon: "Building2",
    tier: "silver",
    points: 300,
    target: 1,
    progress: (_id, { user }) => (user.favoriteCompanies || []).length,
  },
  {
    key: "link-tracker",
    title: "Sous surveillance",
    description: "Relie un compte de tracking (Marvel Rivals, LoL…).",
    icon: "Swords",
    tier: "silver",
    points: 600,
    target: 1,
    progress: (id) => GameTracker.countDocuments({ user: id }),
  },
  {
    key: "tier-list",
    title: "Grand ordonnateur",
    description: "Crée une tier list.",
    icon: "ListOrdered",
    tier: "silver",
    points: 400,
    target: 1,
    progress: (id) => List.countDocuments({ user: id, type: "tier" }),
  },
  {
    key: "ranked-list",
    title: "Podium personnel",
    description: "Crée une liste classée.",
    icon: "Medal",
    tier: "silver",
    points: 400,
    target: 1,
    progress: (id) => List.countDocuments({ user: id, type: "ranked" }),
  },
  {
    key: "playlist",
    title: "DJ du dimanche",
    description: "Crée une playlist d'OST.",
    icon: "ListMusic",
    tier: "silver",
    points: 400,
    target: 1,
    progress: (id) => List.countDocuments({ user: id, type: "playlist" }),
  },
  {
    key: "link-account",
    title: "Tout est relié",
    description: "Relie ton compte Steam ou PlayStation.",
    icon: "Link2",
    tier: "silver",
    points: 600,
    target: 1,
    progress: (_id, { user }) =>
      user.steam?.steamId || user.psn?.accountId ? 1 : 0,
  },
  {
    key: "pixelrush-3000",
    title: "Pixel perfect",
    description: "Marque au moins 3 000 points en une partie de Pixel Rush.",
    icon: "Target",
    tier: "silver",
    points: 500,
    target: 1,
    progress: (id) => PixelGame.countDocuments({ user: id, score: { $gte: 3000 } }),
  },
  {
    key: "blindtest-3000",
    title: "Diapason d'or",
    description: "Marque au moins 3 000 points en une partie de blind test.",
    icon: "Zap",
    tier: "silver",
    points: 500,
    target: 1,
    progress: (id) => BlindTest.countDocuments({ user: id, score: { $gte: 3000 } }),
  },
  {
    key: "recommend-10",
    title: "Bouche à oreille",
    description: "Recommande 10 jeux à d'autres joueurs.",
    icon: "Megaphone",
    tier: "silver",
    points: 500,
    target: 10,
    progress: (id) => Recommendation.countDocuments({ "recommenders.user": id }),
  },
  {
    key: "rate-10",
    title: "Jury populaire",
    description: "Note 10 jeux.",
    icon: "Stars",
    tier: "silver",
    points: 400,
    target: 10,
    progress: (id) => UserGame.countDocuments({ user: id, rating: { $ne: null } }),
  },
  {
    key: "review-5",
    title: "Chroniqueur",
    description: "Écris 5 reviews.",
    icon: "Feather",
    tier: "silver",
    points: 500,
    target: 5,
    progress: (id) => UserGame.countDocuments({ user: id, review: { $nin: [null, ""] } }),
  },
  {
    key: "wishlist-played-10",
    title: "Souhait exaucé",
    description: "Joue à 10 jeux venus de ta wishlist.",
    icon: "BookmarkCheck",
    tier: "silver",
    points: 500,
    target: 10,
    // Les jeux passés par la wishlist et qui n'y sont plus (cf. UserGame
    // .wasWishlisted) : la liste de souhaits qui devient de vraies parties.
    progress: (id) =>
      UserGame.countDocuments({
        user: id,
        wasWishlisted: true,
        status: { $in: PLAYED_STATUSES },
      }),
  },
  {
    key: "streak-7",
    title: "Semaine pleine",
    description: "Connecte-toi 7 jours d'affilée.",
    icon: "CalendarRange",
    tier: "silver",
    points: 500,
    target: 7,
    progress: (_id, { user }) => bestStreak(user),
  },
  {
    key: "social-butterfly",
    title: "Papillon social",
    description: "Suis 5 joueurs.",
    icon: "Users",
    tier: "gold",
    points: 800,
    target: 5,
    progress: (_id, { user }) => (user.following || []).length,
  },
  {
    key: "collector",
    title: "Collectionneur",
    description: "Réunis 10 jeux dans ta bibliothèque.",
    icon: "Library",
    tier: "gold",
    points: 1000,
    target: 10,
    progress: (id) => UserGame.countDocuments({ user: id }),
  },
  {
    key: "rate-50",
    title: "Critique assermenté",
    description: "Note 50 jeux.",
    icon: "Gauge",
    tier: "gold",
    points: 800,
    target: 50,
    progress: (id) => UserGame.countDocuments({ user: id, rating: { $ne: null } }),
  },
  {
    key: "review-20",
    title: "Éditorialiste",
    description: "Écris 20 reviews.",
    icon: "ScrollText",
    tier: "gold",
    points: 1000,
    target: 20,
    progress: (id) => UserGame.countDocuments({ user: id, review: { $nin: [null, ""] } }),
  },
  {
    key: "wishlist-played-50",
    title: "Backlog en fumée",
    description: "Joue à 50 jeux venus de ta wishlist.",
    icon: "Rocket",
    tier: "gold",
    points: 1000,
    target: 50,
    progress: (id) =>
      UserGame.countDocuments({
        user: id,
        wasWishlisted: true,
        status: { $in: PLAYED_STATUSES },
      }),
  },
  {
    key: "streak-30",
    title: "Pilier de comptoir",
    description: "Connecte-toi 30 jours d'affilée.",
    icon: "Flame",
    tier: "gold",
    points: 1200,
    target: 30,
    progress: (_id, { user }) => bestStreak(user),
  },
  {
    key: "rate-100",
    title: "Barème absolu",
    description: "Note 100 jeux.",
    icon: "Scale",
    tier: "platinum",
    points: 1500,
    target: 100,
    progress: (id) => UserGame.countDocuments({ user: id, rating: { $ne: null } }),
  },
  {
    key: "review-100",
    title: "Œuvre complète",
    description: "Écris 100 reviews.",
    icon: "NotebookPen",
    tier: "platinum",
    points: 2000,
    target: 100,
    progress: (id) => UserGame.countDocuments({ user: id, review: { $nin: [null, ""] } }),
  },
  {
    key: "wishlist-played-100",
    title: "Rien ne se perd",
    description: "Joue à 100 jeux venus de ta wishlist.",
    icon: "Crown",
    tier: "platinum",
    points: 1800,
    target: 100,
    progress: (id) =>
      UserGame.countDocuments({
        user: id,
        wasWishlisted: true,
        status: { $in: PLAYED_STATUSES },
      }),
  },
];

// --- Retouches admin (titre / description / icône / points) ---------------
// Elles vivent en base (MissionConfig) et se superposent au catalogue du code.
// Cache mémoire : ces valeurs sont lues à CHAQUE évaluation de missions, mais
// ne changent qu'au passage d'un admin — on invalide alors explicitement.
let overridesCache = { at: 0, map: new Map() };
const OVERRIDES_TTL = 5 * 60 * 1000;

export function invalidateMissionOverrides() {
  overridesCache = { at: 0, map: new Map() };
}

async function getOverrides() {
  if (overridesCache.at && Date.now() - overridesCache.at < OVERRIDES_TTL)
    return overridesCache.map;
  try {
    const rows = await MissionConfig.find().lean();
    overridesCache = { at: Date.now(), map: new Map(rows.map((r) => [r.missionKey, r])) };
  } catch (err) {
    console.error("mission overrides error:", err.message);
    // On garde le cache précédent (ou vide) : le catalogue du code fait foi.
    overridesCache = { at: Date.now(), map: overridesCache.map };
  }
  return overridesCache.map;
}

// Mission « effective » = code + retouches admin. Un champ absent/null côté
// config garde la valeur du code. `tier` et `target` ne sont PAS retouchables :
// ils tiennent à la difficulté, pas à l'habillage.
function effective(m, ov) {
  if (!ov) return m;
  return {
    ...m,
    title: ov.title ?? m.title,
    description: ov.description ?? m.description,
    icon: ov.icon ?? m.icon,
    points: ov.points ?? m.points,
  };
}

// Vue publique d'une mission : on retire la fonction `progress`, ajoutée au fil
// de l'évaluation.
function publicMission(m) {
  return {
    key: m.key,
    title: m.title,
    description: m.description,
    icon: m.icon,
    tier: m.tier,
    points: m.points,
    target: m.target,
  };
}

// Champs de User que lisent les `progress` (et le solde affiché).
const USER_FIELDS =
  "following inventory steam psn points equipped favoritePlatforms favoriteCompanies missionFlags covers cover ostOrder asideConfig bio tagline streak";

// Marque une mission comme ACCOMPLIE (statut ready) et prévient le joueur qu'il
// a une récompense à récupérer. Ne crédite aucun point : c'est claimMission qui
// le fera. L'index unique (user, missionKey) absorbe les courses — le second
// create lève E11000, qu'on avale.
// Retourne le document créé (nouvellement accompli) ou null (déjà connu/échec).
async function markReady(user, m) {
  let doc;
  try {
    doc = await MissionAward.create({
      user: user._id,
      missionKey: m.key,
      status: "ready",
      points: 0,
      readyAt: new Date(),
    });
  } catch (err) {
    if (err.code === 11000) return null; // déjà accompli → rien à refaire
    console.error("markReady error:", err.message);
    return null;
  }
  // Notification (système, sans acteur). On glisse le titre du badge dans
  // `gameName` et l'appel à l'action dans `snippet` : ce sont les seuls champs
  // libres que le sérialiseur des notifs renvoie déjà.
  Notification.create({
    user: user._id,
    type: "mission_unlocked",
    actor: null,
    gameName: m.title,
    snippet: m.points > 0 ? `Récupère tes ${m.points} points` : m.description,
  }).catch((e) => console.error("mission notif error:", e.message));
  return doc;
}

// Récupération de la récompense : c'est ICI (et seulement ici) qu'on crédite.
// La mise à jour est conditionnée au statut "ready", donc deux clics simultanés
// ne peuvent pas créditer deux fois — le second ne trouve plus rien à modifier.
// Lève une erreur parlante si la mission n'est pas accomplie ou déjà récupérée.
export async function claimMission(userId, missionKey) {
  const base = MISSIONS.find((x) => x.key === missionKey);
  if (!base) {
    const err = new Error("Mission inconnue.");
    err.status = 404;
    throw err;
  }
  // Barème effectif au moment de la récupération (retouches admin comprises).
  const m = effective(base, (await getOverrides()).get(missionKey));

  const award = await MissionAward.findOneAndUpdate(
    { user: userId, missionKey, status: "ready" },
    { $set: { status: "claimed", points: m.points, claimedAt: new Date() } },
    { new: true }
  );
  if (!award) {
    // Soit la mission n'est pas accomplie, soit elle est déjà récupérée : on
    // regarde laquelle des deux pour le dire clairement.
    const existing = await MissionAward.findOne({ user: userId, missionKey }).lean();
    const err = new Error(
      existing ? "Récompense déjà récupérée." : "Cette mission n'est pas encore accomplie."
    );
    err.status = 409;
    throw err;
  }

  const balance =
    m.points > 0
      ? await grantPoints(userId, m.points, "mission", { missionKey })
      : await getBalance(userId);
  return { mission: publicMission(m), balance: balance ?? (await getBalance(userId)) };
}

// Évalue TOUTES les missions d'un joueur. Avec `award: true`, marque au passage
// celles qui viennent d'être accomplies (statut ready + notif) et renvoie leurs
// clés dans `newlyReady` → le client peut le signaler tout de suite. Sans
// `award` (profil d'un autre joueur), on ne fait que lire.
export async function evaluateMissions(targetUserId, { award = false } = {}) {
  const [user, awards, overrides] = await Promise.all([
    User.findById(targetUserId).select(USER_FIELDS),
    MissionAward.find({ user: targetUserId })
      .select("missionKey status readyAt claimedAt")
      .lean(),
    getOverrides(),
  ]);
  if (!user)
    return { missions: [], balance: 0, done: 0, claimed: 0, claimable: 0, newlyReady: [] };

  const awardedMap = new Map(awards.map((a) => [a.missionKey, a]));
  // Progressions calculées en parallèle ; une mesure qui plante vaut 0.
  const values = await Promise.all(
    MISSIONS.map((m) => Promise.resolve(m.progress(targetUserId, { user })).catch(() => 0))
  );

  const newlyReady = [];
  const missions = [];
  for (let i = 0; i < MISSIONS.length; i++) {
    // Habillage et barème retouchés par l'admin, condition inchangée.
    const m = effective(MISSIONS[i], overrides.get(MISSIONS[i].key));
    const current = Math.max(0, Math.round(Number(values[i]) || 0));
    let existing = awardedMap.get(m.key);

    if (!existing && current >= m.target && award) {
      const fresh = await markReady(user, m);
      if (fresh) {
        existing = { status: "ready", readyAt: fresh.readyAt, claimedAt: null };
        newlyReady.push(m.key);
      }
    }

    const claimed = existing?.status === "claimed";
    missions.push({
      ...publicMission(m),
      current: Math.min(current, m.target),
      // « accomplie » : soit déjà enregistrée, soit la mesure le dit (cas d'un
      // profil consulté sans droit d'écriture — award: false).
      done: !!existing || current >= m.target,
      claimed,
      claimable: !!existing && !claimed,
      readyAt: existing?.readyAt || null,
      claimedAt: existing?.claimedAt || null,
    });
  }

  const balance = await getBalance(targetUserId);
  return {
    missions,
    balance,
    done: missions.filter((x) => x.done).length,
    claimed: missions.filter((x) => x.claimed).length,
    claimable: missions.filter((x) => x.claimable).length,
    newlyReady,
  };
}

// Combien de badges ce joueur a-t-il RÉELLEMENT gagnés (récompense récupérée) —
// c'est ce compteur qui s'affiche sur l'onglet du profil.
export function countBadges(userId) {
  return MissionAward.countDocuments({ user: userId, status: "claimed" });
}

// Enregistre un geste accompli côté client (thème sombre…), puis réévalue.
// Liste blanche : le client ne peut pas inventer de drapeau.
const CLIENT_FLAGS = new Set(["dark-mode", "explorer-list"]);

export async function recordMissionFlag(userId, flag) {
  if (!CLIENT_FLAGS.has(flag)) {
    const err = new Error("Évènement inconnu.");
    err.status = 400;
    throw err;
  }
  await User.updateOne({ _id: userId }, { $addToSet: { missionFlags: flag } });
  triggerMissionCheck(userId);
}

// ======================================================================
//  Panel admin : retoucher l'habillage et le barème d'une mission.
// ======================================================================
// On ne touche jamais à la condition (elle vit dans le code) ni au palier.
// Chaque mission est renvoyée avec sa valeur EFFECTIVE et sa valeur d'ORIGINE,
// pour que le panel puisse afficher « modifié » et proposer une remise à zéro.
const EDITABLE = ["title", "description", "icon", "points"];

export async function listMissionsForAdmin() {
  const [overrides, counts] = await Promise.all([
    getOverrides(),
    MissionAward.aggregate([
      { $match: { status: "claimed" } },
      { $group: { _id: "$missionKey", n: { $sum: 1 } } },
    ]).catch(() => []),
  ]);
  const claimedBy = new Map(counts.map((c) => [c._id, c.n]));

  return MISSIONS.map((base) => {
    const ov = overrides.get(base.key);
    const eff = effective(base, ov);
    return {
      ...publicMission(eff),
      // Condition, affichée en lecture seule dans le panel.
      target: base.target,
      tier: base.tier,
      defaults: {
        title: base.title,
        description: base.description,
        icon: base.icon,
        points: base.points,
      },
      edited: EDITABLE.some((f) => ov?.[f] != null && ov[f] !== base[f]),
      claimedBy: claimedBy.get(base.key) || 0,
    };
  });
}

// Applique une retouche. Un champ à null/"" revient au défaut du code.
export async function updateMissionConfig(missionKey, patch) {
  const base = MISSIONS.find((m) => m.key === missionKey);
  if (!base) {
    const err = new Error("Mission inconnue.");
    err.status = 404;
    throw err;
  }

  const set = {};
  if (patch.title !== undefined)
    set.title = String(patch.title || "").trim().slice(0, 60) || null;
  if (patch.description !== undefined)
    set.description = String(patch.description || "").trim().slice(0, 200) || null;
  if (patch.icon !== undefined)
    set.icon = String(patch.icon || "").trim().slice(0, 40) || null;
  if (patch.points !== undefined) {
    if (patch.points === null || patch.points === "") set.points = null;
    else {
      const n = Math.round(Number(patch.points));
      if (!Number.isFinite(n) || n < 0 || n > 100000) {
        const err = new Error("Montant de points invalide.");
        err.status = 400;
        throw err;
      }
      set.points = n;
    }
  }

  await MissionConfig.findOneAndUpdate(
    { missionKey },
    { $set: set, $setOnInsert: { missionKey } },
    { upsert: true, new: true }
  );
  invalidateMissionOverrides();
  return (await listMissionsForAdmin()).find((m) => m.key === missionKey);
}

// Remise à zéro : la mission reprend intégralement les valeurs du code.
export async function resetMissionConfig(missionKey) {
  await MissionConfig.deleteOne({ missionKey });
  invalidateMissionOverrides();
  return (await listMissionsForAdmin()).find((m) => m.key === missionKey);
}

// À appeler (fire-and-forget) après une action susceptible de débloquer une
// mission : la notif tombe alors au moment du geste, pas seulement quand le
// joueur ouvre son onglet Badges. Idempotent et silencieux par nature.
export function triggerMissionCheck(userId) {
  if (!userId) return;
  evaluateMissions(userId, { award: true }).catch((e) =>
    console.error("mission trigger error:", e.message)
  );
}
