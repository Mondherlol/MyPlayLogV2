import DiscordPuzzle from "../models/DiscordPuzzle.js";
import User from "../models/User.js";
import { grantPoints } from "./points.js";
import { isGuessableTitle, lettersOf, scramble } from "./quizRounds.js";
import { getFamousPool, sameGame, shuffle } from "../routes/blindtest.js";

// ======================================================================
//  « Lettres mêlées » — le jeu du salon Discord
// ======================================================================
// MINECRAFT → RFTAINEM. Le premier qui retape le titre marque 50 points sur son
// compte MyPlayLog. C'est la MÊME épreuve que celle du Grand Quiz : la fabrique
// d'anagramme et le juge de réponse sont importés, pas recopiés (un jeu qui
// accepterait « the witcher 3 » sur le site et le refuserait sur Discord serait
// perçu comme cassé, à juste titre).
//
// AUCUN APPEL À UN MODÈLE DE LANGAGE ICI, et il n'en faut pas : le pool de gros
// jeux vient d'IGDB (mis en cache une fois par jour, cf. getFamousPool), le
// mélange est un shuffle, et la correction est une comparaison de titres. Ce
// jeu peut tourner toute la journée sans consommer un seul jeton.

// Ce que rapporte une manche gagnée. Même ordre de grandeur qu'une bonne partie
// des mini-jeux du site — assez pour avoir envie de jouer, pas assez pour que
// Discord devienne le raccourci qui vide l'arcade de son intérêt.
export const WIN_POINTS = 50;

// Trois manches gagnantes par jour et par joueur, TOUS SERVEURS CONFONDUS. Le
// plafond n'est pas là contre les tricheurs mais contre l'évidence : sans lui,
// n'importe qui crée un serveur privé, lance des manches en boucle et se fait
// un stock de points en une soirée. Au-delà on gagne toujours la manche (la
// partie continue), simplement elle ne rapporte plus rien.
export const DAILY_WINS = 3;

// Bornes de longueur, reprises du Grand Quiz : sous six lettres l'anagramme se
// lit d'un coup d'œil, au-delà de quatorze c'est un exercice de patience.
const MIN_LETTERS = 6;
const MAX_LETTERS = 14;

// Une manche non résolue s'éteint au bout de ça : passé ce délai, « !jeu »
// donne un nouveau titre au lieu de ressortir celui que tout le monde a
// abandonné hier soir.
export const ROUND_TTL_MS = 30 * 60 * 1000;

// ------------------------------------------------------------------
//  Poser une manche
// ------------------------------------------------------------------

// La manche en cours dans ce salon, si elle est encore vivante.
export async function activePuzzle(channelId) {
  const p = await DiscordPuzzle.findOne({ channelId, solvedAt: null }).sort({
    createdAt: -1,
  });
  if (!p) return null;
  if (Date.now() - p.createdAt.getTime() > ROUND_TTL_MS) return null;
  return p;
}

// Tire un titre jouable et fabrique la grille. Renvoie null si le pool IGDB est
// vide (jeton Twitch expiré, IGDB en carafe) — l'appelant doit le dire plutôt
// que de poser une manche sans solution.
export async function newPuzzle({ guildId = null, channelId }) {
  const pool = await getFamousPool();
  if (!pool.length) return null;

  // On évite de reposer un titre déjà tombé récemment dans ce salon : retomber
  // sur le même jeu deux fois dans la soirée tue la manche instantanément.
  const recent = await DiscordPuzzle.find({ channelId })
    .sort({ createdAt: -1 })
    .limit(40)
    .select("gameId")
    .lean();
  const seen = new Set(recent.map((r) => r.gameId));

  for (const g of shuffle([...pool])) {
    if (seen.has(g.id)) continue;
    if (!isGuessableTitle(g.name)) continue;
    const letters = lettersOf(g.name);
    if (letters.length < MIN_LETTERS || letters.length > MAX_LETTERS) continue;

    return DiscordPuzzle.create({
      guildId,
      channelId,
      gameId: g.id,
      gameName: g.name,
      cover: g.cover || null,
      letters: scramble([...letters]).join(""),
      words: String(g.name)
        .split(/\s+/)
        .map((w) => lettersOf(w).length)
        .filter((n) => n > 0),
    });
  }
  return null;
}

// L'énoncé, tel qu'il s'affiche dans le salon. La FORME du titre (« 2 mots :
// 5 + 4 ») ne révèle aucune lettre mais rend jouable ce qui n'était qu'une
// bouillie de quatorze signes.
export function puzzleText(p) {
  const grid = p.letters.split("").join(" ");
  const shape =
    p.words.length > 1
      ? `${p.words.length} mots : ${p.words.join(" + ")} lettres`
      : `${p.letters.length} lettres`;
  const hint = p.hints > 0 ? `\nIndice : ça commence par **${p.gameName.slice(0, p.hints).toUpperCase()}**` : "";
  return `🔤 **${grid}**\n*${shape}* — c'est quel jeu ?${hint}`;
}

// Révèle une lettre de plus. Plafonné à la moitié du titre : au-delà ce n'est
// plus un indice, c'est la réponse.
export async function addHint(p) {
  const max = Math.max(1, Math.floor(p.gameName.length / 2));
  if (p.hints >= max) return null;
  p.hints += 1;
  await p.save();
  return p;
}

// ------------------------------------------------------------------
//  Répondre
// ------------------------------------------------------------------

const startOfDay = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// Combien de manches ce joueur a-t-il déjà gagnées aujourd'hui ?
const winsToday = (discordId) =>
  DiscordPuzzle.countDocuments({
    "solver.discordId": discordId,
    solvedAt: { $gte: startOfDay() },
  });

// Une proposition. Renvoie :
//   { correct: false }                              → à ignorer en silence
//   { correct: true, points, capped, linked, user } → manche gagnée
//
// La manche est refermée par un `findOneAndUpdate` CONDITIONNEL sur
// `solvedAt: null` : deux personnes qui répondent juste à la même seconde ne
// peuvent pas gagner toutes les deux, c'est la base qui départage et non
// l'ordre d'arrivée des évènements Discord.
export async function tryGuess(p, text, { discordId, username }) {
  const guess = String(text || "").trim();
  if (!guess || guess.length > 120) return { correct: false };
  if (!sameGame({ gameId: p.gameId, gameName: p.gameName }, null, guess))
    return { correct: false };

  const linkedUser = await User.findOne({ "discord.discordId": discordId })
    .select("_id username points")
    .lean();

  const capped = (await winsToday(discordId)) >= DAILY_WINS;
  const points = capped ? 0 : WIN_POINTS;

  const claimed = await DiscordPuzzle.findOneAndUpdate(
    { _id: p._id, solvedAt: null },
    {
      $set: {
        solvedAt: new Date(),
        solver: { discordId, username, user: linkedUser?._id || null },
        points,
        // Les points d'un joueur non lié ne sont pas perdus : ils attendent
        // qu'il lie son compte (cf. claimPendingPoints).
        pending: points > 0 && !linkedUser,
      },
    },
    { new: true }
  );
  // Quelqu'un a été plus rapide d'un cheveu : sa réponse était juste, mais la
  // manche ne lui appartient pas.
  if (!claimed) return { correct: true, tooLate: true };

  if (points > 0 && linkedUser) {
    await grantPoints(linkedUser._id, points, "discordmot", {
      guildId: p.guildId,
      gameId: p.gameId,
      gameName: p.gameName,
    });
  }

  return {
    correct: true,
    answer: p.gameName,
    points,
    capped,
    linked: !!linkedUser,
    siteUsername: linkedUser?.username || null,
  };
}

// ------------------------------------------------------------------
//  Le classement
// ------------------------------------------------------------------
// Par serveur : c'est le classement de la bande, pas celui du site (qui a déjà
// le sien dans l'arcade). Trié par victoires puis par points — deux personnes à
// dix victoires, celle qui n'a pas encore lié son compte passe derrière, ce qui
// est un rappel discret de plus.
export async function leaderboard(guildId, limit = 10) {
  const rows = await DiscordPuzzle.aggregate([
    { $match: { guildId, solvedAt: { $ne: null } } },
    {
      $group: {
        _id: "$solver.discordId",
        username: { $last: "$solver.username" },
        wins: { $sum: 1 },
        points: { $sum: "$points" },
        pending: { $sum: { $cond: ["$pending", "$points", 0] } },
        user: { $last: "$solver.user" },
      },
    },
    { $sort: { wins: -1, points: -1 } },
    { $limit: limit },
  ]);
  return rows;
}

// ------------------------------------------------------------------
//  Solder l'ardoise
// ------------------------------------------------------------------
// Appelée quand quelqu'un vient de lier son compte Discord : toutes les
// victoires qu'il a remportées AVANT d'être lié lui sont enfin créditées. C'est
// la promesse que le bot a faite dans le salon (« tes points t'attendent ») ;
// si elle n'était pas tenue, autant ne pas la faire.
//
// Best-effort : appelée depuis la liaison, elle ne doit jamais la faire échouer.
export async function claimPendingPoints(discordId, userId) {
  try {
    const owed = await DiscordPuzzle.find({
      pending: true,
      "solver.discordId": String(discordId),
    }).select("points gameName guildId");
    if (!owed.length) return { wins: 0, points: 0 };

    const total = owed.reduce((n, p) => n + (p.points || 0), 0);
    await DiscordPuzzle.updateMany(
      { _id: { $in: owed.map((p) => p._id) } },
      { $set: { pending: false, "solver.user": userId } }
    );
    if (total > 0) {
      await grantPoints(userId, total, "discordmot", {
        claimed: owed.length,
        discordId: String(discordId),
      });
    }
    return { wins: owed.length, points: total };
  } catch (err) {
    console.error("claimPendingPoints error:", err.message);
    return { wins: 0, points: 0 };
  }
}
