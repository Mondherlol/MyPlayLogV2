import BotTts from "../models/BotTts.js";
import User from "../models/User.js";
import { emitTo, isOnline } from "./realtime.js";
import { canUseBot, BOT_USERNAME } from "./bot.js";
import { geminiJson, isGeminiConfigured } from "./gemini.js";

// ======================================================================
//  « TTS @machin salut gros con »
// ======================================================================
// On dicte une phrase au bot en message privé, il va la DIRE à voix haute dans
// le navigateur de quelqu'un d'autre. Connecté, ça tombe dans la seconde ;
// absent, ça l'attend à sa prochaine visite (models/BotTts.js).
//
// TROIS GARDE-FOUS, et aucun n'est décoratif :
//
//   1. LA CIBLE DOIT AUSSI AVOIR LE DROIT AU BOT. Le personnage est fermé par
//      défaut pour de bonnes raisons ; on ne va pas contourner cette porte en
//      faisant hurler des insultes chez quelqu'un qui n'a jamais accepté de
//      parler au bot. C'est la règle la plus importante du fichier.
//   2. UN QUOTA. Dix envois par heure et par expéditeur, quatre reçus par heure
//      et par cible. Sans plafond, la fonctionnalité s'appelle « harcèlement »
//      et se règle en console navigateur.
//   3. LA SOURCE EST TOUJOURS NOMMÉE. La phrase prononcée commence par le
//      pseudo de l'expéditeur : personne ne peut faire dire quelque chose
//      anonymement, ce qui coupe court à l'usage le plus désagréable.

const MAX_TEXT = 220;
const PER_SENDER_HOUR = 10;
const PER_TARGET_HOUR = 4;

// « TTS @machin le message », avec ou sans arobase, TTS ou tts.
const CMD_RE = /^\s*tts\s+@?([\p{L}\p{N}_.-]{2,32})\s+([\s\S]+)$/iu;

export function parseTts(text) {
  const m = CMD_RE.exec(String(text || ""));
  if (!m) return null;
  return { target: m[1], message: m[2].trim().slice(0, MAX_TEXT) };
}

// Les remarques du bot quand le modèle n'est pas disponible. La liste est
// volontairement courte : elles ne tombent qu'une fois sur deux, et le modèle
// prend le relais dès qu'il répond.
const CANNED = [
  "et il a pas tort je trouve",
  "moi je dis ça je dis rien",
  "franchement il est gentil là",
  "j'aurais pas dit mieux",
  "c'est toi qui vois mais bon",
  "voilà, c'est dit",
];

const pick = (a) => a[Math.floor(Math.random() * a.length)];

// La petite phrase que le bot ajoute après avoir transmis. Une fois sur deux :
// systématique, ça devient une signature qu'on n'entend plus ; jamais, le bot
// n'est qu'un haut-parleur.
async function remarkOn(message, fromName, toName) {
  if (Math.random() < 0.5) return "";
  if (!isGeminiConfigured()) return pick(CANNED);
  try {
    const out = await geminiJson(
      `Tu es « ${BOT_USERNAME} », un bot troll, vulgaire et moqueur, sur un site de jeux vidéo.
Tu viens de transmettre à voix haute ce message de ${fromName} destiné à ${toName} : « ${message} »
Ajoute TA remarque, comme un commentateur qui prend parti — style « et il a pas tort je trouve ».
UNE phrase, très courte (10 mots max), en minuscules, méchante envers ${toName}. Pas d'emoji.
Rien de raciste, sexiste, homophobe, aucune menace, rien de sexuel.
Réponds en JSON : {"reply": "ta remarque"}`,
      { timeoutMs: 8000, temperature: 1.1, model: process.env.BOT_GEMINI_MODEL || "gemini-flash-lite-latest" }
    );
    const r = String(out?.reply || "").trim();
    return r ? r.slice(0, 120) : pick(CANNED);
  } catch {
    // Une remarque ratée ne doit jamais empêcher le message de partir.
    return pick(CANNED);
  }
}

const sinceAnHour = () => new Date(Date.now() - 3600_000);

// Envoie (ou met en file). Renvoie ce que le bot doit répondre à l'expéditeur —
// c'est lui qui parle à l'utilisateur, ce fichier ne fait que lui souffler le
// texte.
export async function sendTts({ fromUser, targetName, message }) {
  if (!message) return "et je dis quoi ? « tts @machin ton message », c'est pas la mer à boire";

  const target = await User.findOne({
    username: new RegExp(`^${targetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  })
    .select("_id username botAccess isAdmin isSuperAdmin")
    .lean();

  if (!target) return `« ${targetName} » ça existe pas sur le site, apprends à écrire`;

  // Se viser soi-même : autorisé, et c'est VOLONTAIRE. C'était refusé au
  // départ, mais c'est le seul moyen d'essayer la fonctionnalité sans mobiliser
  // un deuxième compte — et une fonctionnalité qu'on ne peut pas essayer seul
  // ne se teste jamais. Le bot se moque, puis il le fait quand même.
  const isSelf = String(target._id) === String(fromUser._id);
  // Garde-fou n°1 : la porte du bot est fermée par défaut, on ne la contourne pas.
  if (!canUseBot(target))
    return `${target.username} a pas le droit au bot, donc j'ai pas le droit de lui gueuler dessus. Va voir un admin`;

  // Garde-fou n°2 : les quotas.
  const [sent, received] = await Promise.all([
    BotTts.countDocuments({ from: fromUser._id, createdAt: { $gte: sinceAnHour() } }),
    BotTts.countDocuments({ user: target._id, createdAt: { $gte: sinceAnHour() } }),
  ]);
  if (sent >= PER_SENDER_HOUR) return "calme-toi t'as pas que ça à faire, reviens dans une heure";
  if (received >= PER_TARGET_HOUR)
    return `${target.username} en a déjà pris plein les oreilles cette heure-ci, laisse-le respirer`;

  // Garde-fou n°3 : la phrase dit toujours qui l'a commandée.
  const spoken = `${fromUser.username} te dit : ${message}`;
  const remark = await remarkOn(message, fromUser.username, target.username);

  const doc = await BotTts.create({
    user: target._id,
    from: fromUser._id,
    fromName: fromUser.username,
    text: spoken,
    remark,
  });

  if (isOnline(target._id)) {
    emitTo([String(target._id)], "tts", {
      id: String(doc._id),
      text: spoken,
      remark,
      from: fromUser.username,
    });
    await BotTts.updateOne({ _id: doc._id }, { $set: { deliveredAt: new Date() } });
    return isSelf
      ? "tu t'insultes tout seul, faut consulter — bon, écoute 🔊"
      : `c'est dit, ${target.username} l'entend en direct 🔊`;
  }

  return isSelf
    ? "t'es même pas connecté à toi-même, bravo. tu l'entendras en revenant"
    : `${target.username} est pas là, je lui gueulerai dessus dès qu'il se connecte`;
}

// À l'ouverture du flux temps réel : on vide la file de cet utilisateur.
//
// Volontairement ESPACÉ dans le temps (2,5 s entre chaque) : trois messages
// prononcés en même temps par la synthèse vocale se recouvrent et deviennent
// inaudibles — et l'effet comique tient justement à ce qu'on comprenne la
// phrase. Le premier attend aussi un peu, le temps que la page finisse de se
// charger.
export async function flushPendingTts(userId) {
  try {
    const pending = await BotTts.find({ user: userId, deliveredAt: null })
      .sort({ createdAt: 1 })
      .limit(5);
    if (!pending.length) return;

    pending.forEach((doc, i) => {
      setTimeout(
        () => {
          emitTo([String(userId)], "tts", {
            id: String(doc._id),
            text: doc.text,
            remark: doc.remark,
            from: doc.fromName,
            late: true,
          });
        },
        1500 + i * 2500
      );
    });

    await BotTts.updateMany(
      { _id: { $in: pending.map((p) => p._id) } },
      { $set: { deliveredAt: new Date() } }
    );
  } catch (err) {
    console.error("flushPendingTts error:", err.message);
  }
}
