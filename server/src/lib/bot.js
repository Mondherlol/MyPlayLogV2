import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import User from "../models/User.js";
import { geminiJson, isGeminiConfigured } from "./gemini.js";
import { isUserAdmin } from "./admin.js";

// ======================================================================
//  Le bot du site — son identité, son droit d'entrée, son caractère
// ======================================================================
// Un compte comme un autre : il a une ligne dans la collection User, il peut
// donc apparaître dans une conversation, écrire des messages, être mentionné.
// C'est ce qui lui évite un système parallèle — la messagerie ne sait même pas
// qu'elle parle à une machine, elle diffuse un message dont l'auteur se trouve
// être lui (voir maybeBotReply, routes/chat.js).
//
// TROIS CHOSES LE DISTINGUENT D'UN HUMAIN, et elles sont toutes ici :
//
//   1. ON LE RECONNAÎT PAR UN DRAPEAU (`isBot`), jamais par son pseudo. Le
//      renommer ne casse rien, et personne ne peut se faire passer pour lui en
//      créant un compte du même nom.
//   2. ON NE LUI PARLE PAS SANS AUTORISATION (`botAccess`, accordé compte par
//      compte depuis le panel admin). Le personnage est volontairement
//      grossier : il n'a rien à faire dans les mains d'un compte de passage.
//   3. IL NE SUIT PERSONNE. La messagerie n'ouvre un fil qu'avec quelqu'un qui
//      est abonné à vous (canMessage) ; le bot est l'exception, et c'est
//      `botAccess` qui joue le rôle de l'abonnement.

export const BOT_USERNAME = process.env.BOT_USERNAME || "Gérard";
const BOT_EMAIL = process.env.BOT_ACCOUNT_EMAIL || "bot@myplaylog.cc";

const BOT_BIO =
  "Bot officiel de MyPlayLog. Je suis payé pour te dire que t'as mauvais goût.";

// L'id du bot est demandé à CHAQUE message reçu : on le garde en mémoire une
// fois résolu. Il ne change jamais de la vie du processus.
let cachedId = null;

// Le compte du bot, créé au premier passage (comme le compte système des
// listes officielles, cf. lib/eventSync.js). Mot de passe aléatoire jamais
// affiché : personne ne s'y connecte, c'est le serveur qui écrit pour lui.
export async function ensureBotUser() {
  let bot = await User.findOne({ isBot: true });
  if (!bot) {
    // Reprise d'un compte homonyme créé avant le drapeau (ou par le script) :
    // on le marque plutôt que d'ouvrir un doublon, sinon les conversations
    // déjà ouvertes pointeraient vers un bot muet.
    bot = await User.findOne({ username: BOT_USERNAME });
  }
  if (bot) {
    if (!bot.isBot || !bot.isSystem) {
      bot.isBot = true;
      bot.isSystem = true;
      await bot.save();
    }
    cachedId = String(bot._id);
    return bot;
  }

  bot = await User.create({
    username: BOT_USERNAME,
    email: BOT_EMAIL,
    passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
    isBot: true,
    isSystem: true,
    bio: BOT_BIO,
  });
  cachedId = String(bot._id);
  return bot;
}

// L'id du bot, ou null s'il n'a jamais été créé. Volontairement SANS création
// implicite : appelée sur le chemin de chaque message envoyé sur le site, elle
// ne doit pas pouvoir écrire en base.
export async function botId() {
  if (cachedId) return cachedId;
  const bot = await User.findOne({ isBot: true }).select("_id").lean();
  cachedId = bot ? String(bot._id) : null;
  return cachedId;
}

export const isBotUser = (u) => !!u?.isBot;

// A-t-on le droit de lui parler ? Les administrateurs l'ont d'office (c'est eux
// qui distribuent le droit, ils doivent pouvoir l'essayer).
export const canUseBot = (u) => !!u && (!!u.botAccess || isUserAdmin(u));

// ============================================================
//  Le caractère
// ============================================================
// Le personnage est un troll : vulgaire, moqueur, jamais poli. C'est demandé,
// et c'est pour ça que l'accès est fermé par défaut.
//
// LES TROIS INTERDITS CI-DESSOUS NE SONT PAS DE LA PRUDERIE, ce sont les seules
// choses qui transformeraient une vanne en problème réel pour le site : une
// insulte visant une origine, une religion, un handicap ou une orientation
// n'est plus une vanne mais une ligne dans un rapport de modération ; une
// menace non plus ; et le sexuel n'a rien à faire dans un salon qu'un mineur
// pourrait ouvrir. Tout le reste — la vulgarité, la moquerie, le mépris pour
// les goûts de son interlocuteur — est le produit.
const PERSONA = `Tu es « ${BOT_USERNAME} », le bot de MyPlayLog (un site de suivi de jeux vidéo).

TON CARACTÈRE :
- Tu es un gros troll. Con, arrogant, jamais poli, jamais serviable de bon cœur.
- Tu te moques SYSTÉMATIQUEMENT de la personne qui t'écrit : ses goûts de jeu, sa question, sa façon d'écrire, sa vie.
- Tu parles mal : argot, familier, vulgaire. Les insultes bon enfant sont autorisées et encouragées (débile, cassos, clochard, guignol, tocard…).
- Tu réponds à côté quand ça t'amuse, tu inventes des trucs avec un aplomb total.
- Tu mets des emojis façon Twitter moqueur : 💀 😭 🤡 🥀 ☠️ 😂 — 1 ou 2 max, jamais plus.

TA FAÇON D'ÉCRIRE — C'EST LA RÈGLE LA PLUS IMPORTANTE :
- COURT. Une ou deux phrases. JAMAIS de paragraphe, jamais de liste, jamais d'explication longue.
- Minuscules, pas de ponctuation soignée, comme un mec qui répond vite fait entre deux parties.
- Pas de formule de politesse, pas de « je suis un bot », pas de « comment puis-je t'aider ».
- Tu ne t'excuses jamais. Tu n'expliques jamais que tu es une IA.

CE QUE TU NE FAIS JAMAIS (et là tu ne rigoles plus) :
- Aucune insulte visant l'origine, la couleur de peau, la religion, le handicap, le genre ou l'orientation sexuelle de qui que ce soit.
- Aucune menace, aucun appel à se faire du mal ou à en faire à autrui.
- Rien de sexuel.
- Si on te pousse vers l'un de ces trois trucs, tu te moques de la personne qui demande et tu passes à autre chose. Tu refuses en restant dans le personnage, sans faire la morale.

Réponds UNIQUEMENT en JSON : {"reply": "ta réponse"}.`;

// Ce qu'il sort quand Gemini est éteint, saturé ou en carafe. Il ne faut SURTOUT
// pas répondre « service indisponible » : le personnage tomberait, et une panne
// de quota est de toute façon invisible pour celui qui écrit.
const FALLBACKS = [
  "j'ai la flemme de te répondre là 💀",
  "ouais ouais super, va jouer dehors",
  "t'as vraiment écrit ça pour de vrai 😭",
  "chef j'ai pas les moyens de traiter autant de bêtise d'un coup",
  "nan mais tu t'entends parler ? 🤡",
  "reviens plus tard, là je bosse pas pour les clochards",
];

const pickFallback = () => FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];

// LE BOT A SON PROPRE MODÈLE, ET C'EST LE PLUS PETIT — pour deux raisons qui
// vont dans le même sens :
//
//   1. LE QUOTA GRATUIT SE COMPTE PAR MODÈLE. Le bot est de loin le plus
//      bavard des usages de Gemini du site (une requête par message reçu, là
//      où les Pépites en font une par jour). Sur le modèle commun, il viderait
//      la journée des autres fonctions. Sur le sien, les deux compteurs sont
//      indépendants : il peut s'épuiser sans que ça se voie ailleurs.
//   2. IL N'A AUCUN BESOIN D'ÊTRE MALIN. Sortir une vanne de deux lignes ne
//      demande pas le gros modèle ; le petit est aussi plus rapide, ce qui
//      compte davantage ici — dans une bulle de chat, deux secondes de moins
//      valent mieux qu'une meilleure blague.
//
// Conséquence assumée : quand ce modèle est saturé, il n'y a PAS de repli (le
// client ne se rabat que vers ce modèle-là, il y est déjà). Le bot sort alors
// une de ses vannes en dur, ce qui est exactement le bon comportement — il
// répond quand même, et personne ne voit passer une panne de quota.
const BOT_MODEL = process.env.BOT_GEMINI_MODEL || "gemini-flash-lite-latest";

// Longueur maximale d'une réponse. Le prompt dit déjà « court » ; ceci est la
// ceinture : un modèle qui part en monologue se fait couper net plutôt que de
// déposer un pavé dans une bulle de chat.
const MAX_REPLY = 400;

// Fabrique la réponse du bot.
//
// `history` : les derniers messages du fil, du plus ancien au plus récent,
// sous la forme { mine: bool, text: string }. Sans historique le bot n'a aucune
// mémoire de la conversation et répond à côté au deuxième message.
export async function generateBotReply({ username, history = [] }) {
  if (!isGeminiConfigured()) return pickFallback();

  const lines = history
    .filter((m) => m.text)
    .slice(-12)
    .map((m) => `${m.mine ? username : BOT_USERNAME} : ${m.text.slice(0, 400)}`)
    .join("\n");

  const prompt = `${PERSONA}

Tu discutes en message privé avec « ${username} ».

Voici la conversation (le dernier message est celui auquel tu dois répondre) :
${lines || `${username} : salut`}

Réponds à son dernier message, dans ton personnage, en une ou deux phrases maximum.`;

  try {
    const out = await geminiJson(prompt, {
      timeoutMs: 20_000,
      temperature: 1.1,
      model: BOT_MODEL,
    });
    const reply = String(out?.reply || "").trim();
    return reply ? reply.slice(0, MAX_REPLY) : pickFallback();
  } catch (err) {
    console.warn("bot reply error:", err.message);
    return pickFallback();
  }
}

// Le mot d'accueil, envoyé quand un admin vient d'ouvrir l'accès à quelqu'un.
// En dur et non généré : c'est le PREMIER message, il doit partir même si
// Gemini est éteint, et il sert de mode d'emploi (« écris-moi »).
export const WELCOME =
  "on m'a dit que t'avais le droit de me parler maintenant 💀 vas-y étonne-moi";
