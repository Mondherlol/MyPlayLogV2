import User from "../models/User.js";
import UserGame from "../models/UserGame.js";
import List from "../models/List.js";
import MotPlay from "../models/MotPlay.js";
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

// ----------------------------------------------------------------------
//  Familles & couleurs — l'identité visuelle d'un badge.
// ----------------------------------------------------------------------
// Le PALIER (bronze/argent/or) a disparu de l'affichage : il classait les
// badges sur une échelle de mérite que personne ne lisait, et peignait tout
// en marron ou en gris. Ce qui distingue vraiment deux badges, c'est ce
// qu'ils récompensent — d'où une FAMILLE, sa couleur, et un mur de badges
// qui se lit par thème plutôt que par rang.
//
// `tier` reste dans le catalogue : le panel admin et le site s'en servent
// encore, et il continue de dire la difficulté d'une mission.
export const BADGE_FAMILIES = {
  social: { label: "Social", color: "#e2574c" },
  library: { label: "Bibliothèque", color: "#4a90d9" },
  review: { label: "Critique", color: "#8b5cf6" },
  profile: { label: "Profil", color: "#3fb27f" },
  lists: { label: "Listes", color: "#ef8b3c" },
  discovery: { label: "Découverte", color: "#2bb3c0" },
  streak: { label: "Assiduité", color: "#f2b70b" },
};

export const MISSIONS = [
  // --- Social ---------------------------------------------------------
  {
    key: "follow-one",
    title: "Premier contact",
    label: "Premier contact",
    caption: "a suivi un joueur",
    description: "Abonne-toi à un autre joueur.",
    icon: "UserPlus",
    family: "social",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (_id, { user }) => (user.following || []).length,
  },
  {
    key: "social-butterfly",
    title: "Papillon social",
    label: "Papillon",
    caption: "a suivi 5 joueurs",
    description: "Suis 5 joueurs.",
    icon: "Users",
    family: "social",
    tier: "gold",
    points: 800,
    target: 5,
    progress: (_id, { user }) => (user.following || []).length,
  },
  {
    key: "chat-group",
    title: "Bande organisée",
    label: "Bande organisée",
    caption: "a rejoint un groupe",
    description: "Crée ou rejoins ton premier groupe dans la messagerie.",
    icon: "MessagesSquare",
    family: "social",
    tier: "bronze",
    points: 200,
    target: 1,
    // Créé par soi ou rejoint sur invitation : dans les deux cas on est dans
    // les participants — c'est la seule chose qui compte.
    progress: (id) => Conversation.countDocuments({ isGroup: true, participants: id }),
  },
  {
    key: "like-list",
    title: "Bon public",
    label: "Bon public",
    caption: "a aimé une liste",
    description: "Aime la liste d'un autre joueur.",
    icon: "Heart",
    family: "social",
    tier: "bronze",
    points: 120,
    target: 1,
    progress: (id) => List.countDocuments({ likes: id }),
  },
  {
    key: "comment-list",
    title: "Mot de la fin",
    label: "Mot de la fin",
    caption: "a commenté une liste",
    description: "Commente la liste d'un joueur.",
    icon: "MessageSquare",
    family: "social",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (id) => List.countDocuments({ "comments.user": id }),
  },
  {
    key: "reply-review",
    title: "Droit de réponse",
    label: "Droit de réponse",
    caption: "a répondu à un avis",
    description: "Réponds à l'avis d'un autre joueur.",
    icon: "Reply",
    family: "social",
    tier: "bronze",
    points: 200,
    target: 1,
    // Les réponses vivent dans l'entrée de biblio qui porte l'avis : on cherche
    // donc mes commentaires posés chez QUELQU'UN D'AUTRE.
    progress: (id) =>
      UserGame.countDocuments({ "comments.user": id, user: { $ne: id } }),
  },
  {
    key: "boost-reco",
    title: "Je plussoie",
    label: "Je plussoie",
    caption: "a boosté une reco",
    description: "Fais +1 sur une recommandation de jeu.",
    icon: "Flame",
    family: "social",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (id) => Recommendation.countDocuments({ boosters: id }),
  },
  {
    key: "recommend-game",
    title: "Passeur de jeux",
    label: "Passeur",
    caption: "a recommandé un jeu",
    description: "Recommande un jeu à un autre joueur.",
    icon: "Send",
    family: "social",
    tier: "silver",
    points: 300,
    target: 1,
    progress: (id) => Recommendation.countDocuments({ "recommenders.user": id }),
  },
  {
    key: "recommend-10",
    title: "Bouche à oreille",
    label: "Bouche à oreille",
    caption: "a recommandé 10 jeux",
    description: "Recommande 10 jeux à d'autres joueurs.",
    icon: "Megaphone",
    family: "social",
    tier: "silver",
    points: 500,
    target: 10,
    progress: (id) => Recommendation.countDocuments({ "recommenders.user": id }),
  },
  {
    key: "republish-fanart",
    title: "Galeriste",
    label: "Galeriste",
    caption: "a republié un fan art",
    description: "Republie un fan art sur ton feed.",
    icon: "Repeat2",
    family: "social",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (id) => Repost.countDocuments({ user: id }),
  },

  // --- Bibliothèque ---------------------------------------------------
  {
    key: "finish-game",
    title: "Générique de fin",
    label: "Générique de fin",
    caption: "a terminé un jeu",
    description: "Termine un jeu de ta bibliothèque.",
    icon: "Trophy",
    family: "library",
    tier: "bronze",
    points: 300,
    target: 1,
    progress: (id) => UserGame.countDocuments({ user: id, status: "finished" }),
  },
  {
    key: "collector",
    title: "Collectionneur",
    label: "Collectionneur",
    caption: "a réuni 10 jeux",
    description: "Réunis 10 jeux dans ta bibliothèque.",
    icon: "Library",
    family: "library",
    tier: "gold",
    points: 1000,
    target: 10,
    progress: (id) => UserGame.countDocuments({ user: id }),
  },
  {
    key: "favorite-character",
    title: "Chouchou",
    label: "Chouchou",
    caption: "a élu un personnage",
    description: "Choisis ton personnage préféré sur un jeu.",
    icon: "UserRound",
    family: "library",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (id) =>
      UserGame.countDocuments({ user: id, "favoriteCharacter.name": { $nin: [null, ""] } }),
  },
  {
    key: "wishlist-played-10",
    title: "Souhait exaucé",
    label: "Souhait exaucé",
    caption: "a joué 10 souhaits",
    description: "Joue à 10 jeux venus de ta wishlist.",
    icon: "BookmarkCheck",
    family: "library",
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
    key: "wishlist-played-50",
    title: "Backlog en fumée",
    label: "Backlog en fumée",
    caption: "a joué 50 souhaits",
    description: "Joue à 50 jeux venus de ta wishlist.",
    icon: "Rocket",
    family: "library",
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
    key: "wishlist-played-100",
    title: "Rien ne se perd",
    label: "Rien ne se perd",
    caption: "a joué 100 souhaits",
    description: "Joue à 100 jeux venus de ta wishlist.",
    icon: "Crown",
    family: "library",
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

  // --- Critique -------------------------------------------------------
  {
    key: "rate-game",
    title: "À mon humble avis",
    label: "Humble avis",
    caption: "a noté un jeu",
    description: "Attribue une note à un jeu.",
    icon: "Star",
    family: "review",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (id) => UserGame.countDocuments({ user: id, rating: { $ne: null } }),
  },
  {
    key: "rate-10",
    title: "Jury populaire",
    label: "Jury populaire",
    caption: "a noté 10 jeux",
    description: "Note 10 jeux.",
    icon: "Stars",
    family: "review",
    tier: "silver",
    points: 400,
    target: 10,
    progress: (id) => UserGame.countDocuments({ user: id, rating: { $ne: null } }),
  },
  {
    key: "rate-50",
    title: "Critique assermenté",
    label: "Assermenté",
    caption: "a noté 50 jeux",
    description: "Note 50 jeux.",
    icon: "Gauge",
    family: "review",
    tier: "gold",
    points: 800,
    target: 50,
    progress: (id) => UserGame.countDocuments({ user: id, rating: { $ne: null } }),
  },
  {
    key: "rate-100",
    title: "Barème absolu",
    label: "Barème absolu",
    caption: "a noté 100 jeux",
    description: "Note 100 jeux.",
    icon: "Scale",
    family: "review",
    tier: "platinum",
    points: 1500,
    target: 100,
    progress: (id) => UserGame.countDocuments({ user: id, rating: { $ne: null } }),
  },
  {
    key: "write-review",
    title: "Plume acérée",
    label: "Plume acérée",
    caption: "a écrit une review",
    description: "Écris une review sur un jeu.",
    icon: "PenLine",
    family: "review",
    tier: "bronze",
    points: 300,
    target: 1,
    progress: (id) => UserGame.countDocuments({ user: id, review: { $nin: [null, ""] } }),
  },
  {
    key: "review-5",
    title: "Chroniqueur",
    label: "Chroniqueur",
    caption: "a écrit 5 reviews",
    description: "Écris 5 reviews.",
    icon: "Feather",
    family: "review",
    tier: "silver",
    points: 500,
    target: 5,
    progress: (id) => UserGame.countDocuments({ user: id, review: { $nin: [null, ""] } }),
  },
  {
    key: "review-20",
    title: "Éditorialiste",
    label: "Éditorialiste",
    caption: "a écrit 20 reviews",
    description: "Écris 20 reviews.",
    icon: "ScrollText",
    family: "review",
    tier: "gold",
    points: 1000,
    target: 20,
    progress: (id) => UserGame.countDocuments({ user: id, review: { $nin: [null, ""] } }),
  },
  {
    key: "review-100",
    title: "Œuvre complète",
    label: "Œuvre complète",
    caption: "a écrit 100 reviews",
    description: "Écris 100 reviews.",
    icon: "NotebookPen",
    family: "review",
    tier: "platinum",
    points: 2000,
    target: 100,
    progress: (id) => UserGame.countDocuments({ user: id, review: { $nin: [null, ""] } }),
  },

  // --- Listes ---------------------------------------------------------
  {
    key: "tier-list",
    title: "Grand ordonnateur",
    label: "Ordonnateur",
    caption: "a créé une tier list",
    description: "Crée une tier list.",
    icon: "ListOrdered",
    family: "lists",
    tier: "silver",
    points: 400,
    target: 1,
    progress: (id) => List.countDocuments({ user: id, type: "tier" }),
  },
  {
    key: "ranked-list",
    title: "Podium personnel",
    label: "Podium",
    caption: "a créé un classement",
    description: "Crée une liste classée.",
    icon: "Medal",
    family: "lists",
    tier: "silver",
    points: 400,
    target: 1,
    progress: (id) => List.countDocuments({ user: id, type: "ranked" }),
  },

  // --- Découverte -----------------------------------------------------
  {
    key: "discover-gem",
    title: "Chercheur d'or",
    label: "Chercheur d'or",
    caption: "a déniché une pépite",
    description: "Déniche une pépite indé depuis l'accueil.",
    icon: "Sparkles",
    family: "discovery",
    tier: "bronze",
    points: 200,
    target: 1,
    // Une fournée de pépites = un document du jour (cf. models/GemDiscovery).
    progress: (id) => GemDiscovery.countDocuments({ user: id }),
  },
  {
    key: "watch-doc",
    title: "Ciné-club",
    label: "Ciné-club",
    caption: "a vu un documentaire",
    description: "Lance un documentaire depuis l'accueil et regarde-le.",
    icon: "Film",
    family: "discovery",
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
    label: "Pouce en l'air",
    caption: "a aimé une vidéo",
    description: "Aime une vidéo recommandée par un joueur.",
    icon: "ThumbsUp",
    family: "discovery",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (id) => Documentary.countDocuments({ user: id, liked: true }),
  },
  {
    key: "recommend-video",
    title: "Bon plan vidéo",
    label: "Bon plan",
    caption: "a partagé une vidéo",
    description: "Recommande une vidéo depuis ton profil.",
    icon: "Clapperboard",
    family: "discovery",
    tier: "silver",
    points: 300,
    target: 1,
    progress: (id) => Documentary.countDocuments({ user: id, recommended: true }),
  },
  {
    key: "game-media-post",
    title: "Reporter de terrain",
    label: "Reporter",
    caption: "a posté sur un mur",
    description: "Publie un post sur le mur d'un jeu.",
    icon: "ImagePlus",
    family: "discovery",
    tier: "bronze",
    points: 250,
    target: 1,
    progress: (id) => GameMedia.countDocuments({ user: id }),
  },

  // --- Profil ---------------------------------------------------------
  {
    key: "write-bio",
    title: "Présentations",
    label: "Présentations",
    caption: "a écrit sa bio",
    description: "Écris ta bio sur ton profil.",
    icon: "Quote",
    family: "profile",
    tier: "bronze",
    points: 150,
    target: 1,
    progress: (_id, { user }) => ((user.bio || "").trim() ? 1 : 0),
  },
  {
    key: "profile-character",
    title: "Si j'étais un perso",
    label: "Alter ego",
    caption: "a choisi son perso",
    description: "Choisis le personnage de jeu qui te représente.",
    icon: "VenetianMask",
    family: "profile",
    tier: "bronze",
    points: 150,
    target: 1,
    // La « tagline » du profil : le personnage choisi dans la modale d'édition,
    // celle-là même où l'on écrit sa bio.
    progress: (_id, { user }) => ((user.tagline || "").trim() ? 1 : 0),
  },
  {
    key: "two-covers",
    title: "Galerie perso",
    label: "Galerie perso",
    caption: "a posé deux bannières",
    description: "Mets deux photos de couverture sur ton profil.",
    icon: "Images",
    family: "profile",
    tier: "bronze",
    points: 250,
    target: 2,
    progress: (_id, { user }) => (user.covers || []).length,
  },
  {
    key: "dark-mode",
    title: "Côté obscur",
    label: "Côté obscur",
    caption: "est passé au sombre",
    description: "Passe l'application en thème sombre.",
    icon: "Moon",
    family: "profile",
    tier: "bronze",
    points: 100,
    target: 1,
    // Geste purement client : signalé une fois via POST /missions/event.
    progress: (_id, { user }) => ((user.missionFlags || []).includes("dark-mode") ? 1 : 0),
  },
  {
    key: "explorer-list",
    title: "Vue d'ensemble",
    label: "Vue d'ensemble",
    caption: "a exploré en liste",
    description: "Essaie l'affichage en liste dans l'Explorer.",
    icon: "List",
    family: "profile",
    tier: "bronze",
    points: 100,
    target: 1,
    // Geste purement client : signalé via POST /missions/event.
    progress: (_id, { user }) =>
      (user.missionFlags || []).includes("explorer-list") ? 1 : 0,
  },
  {
    key: "favorite-platform",
    title: "Team console",
    label: "Team console",
    caption: "a épinglé sa console",
    description: "Épingle ta console favorite.",
    icon: "Joystick",
    family: "profile",
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
    label: "Fidèle au studio",
    caption: "a épinglé un studio",
    description: "Épingle un studio ou un éditeur favori.",
    icon: "Building2",
    family: "profile",
    tier: "silver",
    points: 300,
    target: 1,
    progress: (_id, { user }) => (user.favoriteCompanies || []).length,
  },
  {
    key: "link-account",
    title: "Tout est relié",
    label: "Tout est relié",
    caption: "a relié son compte",
    description: "Relie ton compte Steam ou PlayStation.",
    icon: "Link2",
    family: "profile",
    tier: "silver",
    points: 600,
    target: 1,
    progress: (_id, { user }) =>
      user.steam?.steamId || user.psn?.accountId ? 1 : 0,
  },
  {
    key: "link-tracker",
    title: "Sous surveillance",
    label: "Sous surveillance",
    caption: "a relié un tracker",
    description: "Relie un compte de tracking (Marvel Rivals, LoL…).",
    icon: "Swords",
    family: "profile",
    tier: "silver",
    points: 600,
    target: 1,
    progress: (id) => GameTracker.countDocuments({ user: id }),
  },

  // --- Assiduité ------------------------------------------------------
  {
    key: "mot",
    title: "Le mot juste",
    label: "Le mot juste",
    caption: "a trouvé le mot",
    description: "Trouve le mot du jour.",
    icon: "Thermometer",
    family: "streak",
    tier: "bronze",
    points: 250,
    target: 1,
    // Seules les parties GAGNÉES comptent : abandonner n'est pas trouver.
    progress: (id) => MotPlay.countDocuments({ user: id, solved: true }),
  },
  {
    key: "streak-3",
    title: "Petit rituel",
    label: "Petit rituel",
    caption: "3 jours d'affilée",
    description: "Connecte-toi 3 jours d'affilée.",
    icon: "CalendarDays",
    family: "streak",
    tier: "bronze",
    points: 200,
    target: 3,
    progress: (_id, { user }) => bestStreak(user),
  },
  {
    key: "streak-7",
    title: "Semaine pleine",
    label: "Semaine pleine",
    caption: "7 jours d'affilée",
    description: "Connecte-toi 7 jours d'affilée.",
    icon: "CalendarRange",
    family: "streak",
    tier: "silver",
    points: 500,
    target: 7,
    progress: (_id, { user }) => bestStreak(user),
  },
  {
    key: "streak-30",
    title: "Pilier de comptoir",
    label: "Pilier",
    caption: "30 jours d'affilée",
    description: "Connecte-toi 30 jours d'affilée.",
    icon: "Flame",
    family: "streak",
    tier: "gold",
    points: 1200,
    target: 30,
    progress: (_id, { user }) => bestStreak(user),
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
    // Le nom gravé sur le jeton suit le titre retouché : garder l'ancien
    // afficherait deux noms différents pour le même badge.
    label: ov.title ?? m.label,
    description: ov.description ?? m.description,
    icon: ov.icon ?? m.icon,
    points: ov.points ?? m.points,
  };
}

// Vue publique d'une mission : on retire la fonction `progress`, ajoutée au fil
// de l'évaluation.
//
// `label` / `caption` sont les deux lignes gravées AUTOUR du jeton, façon
// badge cousu : le nom en haut, le fait d'armes en bas. Elles retombent sur
// title/description quand une mission n'en déclare pas — un badge sans
// gravure vaut mieux qu'un badge muet.
function publicMission(m) {
  const fam = BADGE_FAMILIES[m.family] || BADGE_FAMILIES.social;
  return {
    key: m.key,
    title: m.title,
    label: m.label || m.title,
    caption: m.caption || m.description,
    description: m.description,
    icon: m.icon,
    family: m.family || "social",
    familyLabel: fam.label,
    color: fam.color,
    tier: m.tier,
    points: m.points,
    target: m.target,
  };
}

// ----------------------------------------------------------------------
//  Rareté d'un badge : la part des joueurs qui l'ont décroché.
// ----------------------------------------------------------------------
// C'est ce qui donne sa valeur à un badge — « 3 % des joueurs l'ont » se lit
// d'un coup d'œil là où « 1 sur 34 » demande de calculer. Deux agrégats pour
// TOUT le catalogue, mis en cache : sans ça, afficher la page des badges
// coûterait une trentaine de `countDocuments` à chaque ouverture.
const RARITY_TTL = 10 * 60 * 1000;
let rarityCache = { at: 0, map: new Map(), players: 0 };

export async function missionRarity() {
  if (Date.now() - rarityCache.at < RARITY_TTL) return rarityCache;
  const [rows, players] = await Promise.all([
    MissionAward.aggregate([
      { $group: { _id: "$missionKey", holders: { $addToSet: "$user" } } },
      { $project: { holders: { $size: "$holders" } } },
    ]),
    User.estimatedDocumentCount(),
  ]);
  rarityCache = {
    at: Date.now(),
    map: new Map(rows.map((r) => [r._id, r.holders])),
    players: Math.max(players, 1),
  };
  return rarityCache;
}

// Champs de User que lisent les `progress` (et le solde affiché).
const USER_FIELDS =
  "following inventory steam psn points equipped equippedBadge favoritePlatforms favoriteCompanies missionFlags covers cover ostOrder asideConfig bio tagline streak";

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
  const [user, awards, overrides, rarity] = await Promise.all([
    User.findById(targetUserId).select(USER_FIELDS),
    MissionAward.find({ user: targetUserId })
      .select("missionKey status readyAt claimedAt")
      .lean(),
    getOverrides(),
    missionRarity(),
  ]);
  if (!user)
    return {
      missions: [],
      balance: 0,
      equippedBadge: null,
      done: 0,
      claimed: 0,
      claimable: 0,
      newlyReady: [],
    };

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
      // Rareté : part des joueurs qui l'ont décroché, et leur nombre. Un badge
      // que personne n'a vaut 0 — pas `null`, pour que le client n'ait pas à
      // distinguer « inconnu » de « personne ».
      holders: rarity.map.get(m.key) || 0,
      rarity: Math.round(((rarity.map.get(m.key) || 0) / rarity.players) * 1000) / 10,
    });
  }

  const balance = await getBalance(targetUserId);
  return {
    missions,
    balance,
    // Le badge épinglé sur le profil : la page des badges en a besoin pour
    // marquer celui qui est déjà en vitrine.
    equippedBadge: user.equippedBadge || null,
    done: missions.filter((x) => x.done).length,
    claimed: missions.filter((x) => x.claimed).length,
    claimable: missions.filter((x) => x.claimable).length,
    newlyReady,
  };
}

// Combien de badges ce joueur a-t-il RÉELLEMENT gagnés (récompense récupérée) —
// c'est ce compteur qui s'affiche sur l'onglet du profil.
export function countBadges(userId) {
  // Restreint au catalogue COURANT : des missions retirées (l'arcade, les OST)
  // ont laissé des récompenses en base, et les compter gonflerait un total
  // que la page des badges ne peut plus justifier.
  return MissionAward.countDocuments({
    user: userId,
    status: "claimed",
    missionKey: { $in: MISSIONS.map((m) => m.key) },
  });
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
//  Badge mis en avant (« équipé »)
// ======================================================================
// Un seul badge à la fois, affiché à côté du pseudo. On n'accepte que des
// badges RÉELLEMENT décrochés : sinon n'importe qui s'épinglerait « Œuvre
// complète » sans avoir écrit une ligne. `null` retire le badge.
export async function setEquippedBadge(userId, missionKey) {
  const key = missionKey ? String(missionKey) : null;
  if (key) {
    if (!MISSIONS.some((m) => m.key === key)) {
      const err = new Error("Badge inconnu.");
      err.status = 404;
      throw err;
    }
    const owned = await MissionAward.exists({ user: userId, missionKey: key });
    if (!owned) {
      const err = new Error("Ce badge n'est pas encore débloqué.");
      err.status = 403;
      throw err;
    }
  }
  await User.updateOne({ _id: userId }, { $set: { equippedBadge: key } });
  return key ? publicBadgeOf(key) : null;
}

// La forme légère d'un badge, telle qu'elle voyage avec un profil : de quoi
// dessiner le jeton à côté d'un pseudo, rien de plus. Retouches admin
// comprises, mais SANS attendre la base — le cache d'overrides suffit et il
// est déjà chaud à ce stade.
export function publicBadgeOf(missionKey) {
  const base = MISSIONS.find((m) => m.key === missionKey);
  if (!base) return null;
  const m = effective(base, overridesCache.map.get(missionKey));
  const { key, label, caption, title, icon, color, family } = publicMission(m);
  return { key, label, caption, title, icon, color, family };
}

// ----------------------------------------------------------------------
//  Qui d'autre a ce badge ?
// ----------------------------------------------------------------------
// « 3 % des joueurs l'ont » reste abstrait ; « Léa et Tom l'ont » ne l'est
// pas. On remonte donc d'abord les gens que le spectateur SUIT — ce sont les
// visages qu'il reconnaît —, puis on complète avec les derniers venus pour
// que la rangée ne soit jamais vide.
export async function badgeHolders(missionKey, viewerId, { limit = 18 } = {}) {
  if (!MISSIONS.some((m) => m.key === missionKey)) {
    const err = new Error("Badge inconnu.");
    err.status = 404;
    throw err;
  }

  const viewer = viewerId
    ? await User.findById(viewerId).select("following").lean()
    : null;
  const following = (viewer?.following || []).map(String);

  const rows = await MissionAward.find({ missionKey })
    .sort({ claimedAt: -1, readyAt: -1 })
    .limit(400)
    .select("user claimedAt readyAt")
    .lean();

  const seen = new Set();
  const ordered = [];
  for (const r of rows) {
    const id = String(r.user);
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push({ id, at: r.claimedAt || r.readyAt || null });
  }

  const friendSet = new Set(following);
  // Les amis d'abord, l'ordre d'obtention ensuite.
  ordered.sort((a, b) => {
    const fa = friendSet.has(a.id);
    const fb = friendSet.has(b.id);
    if (fa !== fb) return fa ? -1 : 1;
    return new Date(b.at || 0) - new Date(a.at || 0);
  });

  const page = ordered.slice(0, limit);
  const users = await User.find({ _id: { $in: page.map((p) => p.id) } })
    .select("username avatar")
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  return {
    total: ordered.length >= 400 ? null : ordered.length,
    friends: ordered.filter((p) => friendSet.has(p.id)).length,
    holders: page
      .map((p) => {
        const u = byId.get(p.id);
        if (!u) return null;
        return {
          id: p.id,
          username: u.username,
          avatar: u.avatar || null,
          friend: friendSet.has(p.id),
          at: p.at,
        };
      })
      .filter(Boolean),
  };
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
