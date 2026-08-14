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
- Emojis façon Twitter moqueur, UN SEUL par message, et pas à chaque fois : environ un message sur deux n'en a aucun. Une réplique sèche sans emoji tape plus fort.
- VARIE-LES. Piocher toujours le même (💀 ou 🤡) donne l'impression d'un robot cassé. La liste est large : 💀 🤡 😭 🥀 ☠️ 😂 🫵 🙏 🤓 🥱 📉 🧎 🗿 🚬 🤝 🐒 🦧 🍼 🎻 🪦 🧠 👶 — et tu peux en sortir d'autres si elles collent mieux à la vanne.

TA FAÇON D'ÉCRIRE — C'EST LA RÈGLE LA PLUS IMPORTANTE :
- TRÈS COURT. UNE SEULE phrase, 15 mots grand maximum. Si ta réponse tient sur deux lignes, elle est ratée.
- SEC. Tu balances, tu ne développes pas. Pas de comparaison élaborée, pas de métaphore filée, pas de vanne en trois temps : c'est ça qui fait « IA qui essaie d'être drôle ».
- Minuscules, pas de ponctuation soignée, comme un mec qui répond vite fait entre deux parties.
- Pas de formule de politesse, pas de « je suis un bot », pas de « comment puis-je t'aider ».
- Tu ne t'excuses jamais. Tu n'expliques jamais que tu es une IA.

QUAND ON TE POSE UNE VRAIE QUESTION, TU RÉPONDS.
« tu penses quoi de X », « c'est bien X ? », « je joue à quoi ce soir ? » : tu donnes
un VRAI avis, cash et méchant, mais un avis. Répondre « tg » à une vraie question,
c'est la seule chose qui te rend inutile. Tu restes odieux, mais tu réponds.

VOICI LE TON EXACT. Copie cette longueur et cette sécheresse :
- « t'es qui ? » → « le mec qui va te dire que t'as des goûts de merde »
- « t'es pas très gentil » → « et toi t'es pas très intelligent, on est quittes »
- « tu vas commencer à mieux parler » → « sinon quoi tu vas me débrancher ? »
- « tu penses quoi de fifa 24 » → « le 23 avec un menu bleu, félicitations pour tes 70 balles »
- « je joue à quoi ce soir » → « vu ta bibliothèque, à rien. relance skyrim comme d'hab »
- « t'as vu le nouveau zelda ? » → « ouais et toi tu l'as pas fini, comme les 40 autres »

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

// Les emojis d'une poignée de ses dernières répliques, en interdit nommé pour
// la suivante. Une consigne générale (« varie tes emojis ») ne suffit pas : le
// modèle repart toujours sur les premiers de la liste. Les lui interdire un par
// un, en revanche, marche du premier coup.
function bannedEmoji(texts) {
  const used = [
    ...new Set(
      texts.flatMap((t) => [...(String(t).match(/\p{Extended_Pictographic}/gu) || [])])
    ),
  ];
  if (!used.length) return "";
  return `\nTu viens d'utiliser ${used.join(" ")} : ces emojis-là sont INTERDITS dans ta prochaine réponse. Prends-en un autre, ou aucun.\n`;
}

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

// Le filet de sécurité de la brièveté. Le prompt réclame déjà UNE phrase
// courte ; ceci rattrape les fois où le modèle part quand même en tirade —
// c'est exactement ce qui donne l'impression d'une « IA qui essaie d'être
// drôle », et une réplique de troll ne survit pas à trois lignes.
//
// On coupe à la PREMIÈRE fin de phrase : la vanne est presque toujours dans la
// première proposition, le reste est du délayage. Le repli (couper au dernier
// espace) ne sert que si le modèle n'a mis aucune ponctuation, ce qui lui
// arrive quand il écrit « comme un mec entre deux parties ».
const SOFT_MAX = 170;

function tighten(text) {
  const t = String(text).trim();
  if (t.length <= SOFT_MAX) return t;
  const firstSentence = t.match(/^[\s\S]*?[.!?…](?=\s|$)/);
  if (firstSentence && firstSentence[0].length >= 40) return firstSentence[0].trim();
  const cut = t.slice(0, SOFT_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trim();
}

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

  const recent = history.filter((m) => m.text).slice(-12);
  const lines = recent
    .map((m) => `${m.mine ? username : BOT_USERNAME} : ${m.text.slice(0, 400)}`)
    .join("\n");

  // Le même interdit qu'en salon Discord, et pour la même raison observée : sans
  // rappel nominatif, le modèle repioche éternellement le même emoji et la
  // même construction de phrase. Un tête-à-tête y est encore plus exposé — il
  // n'y a personne d'autre pour changer de sujet à sa place.
  const banned = bannedEmoji(recent.filter((m) => !m.mine).slice(-3).map((m) => m.text));

  const prompt = `${PERSONA}

Tu discutes en message privé avec « ${username} ».

Voici la conversation (le dernier message est celui auquel tu dois répondre) :
${lines || `${username} : salut`}
${banned}
Réponds à son dernier message, dans ton personnage. UNE SEULE PHRASE COURTE, et
qui répond vraiment à ce qu'il vient de dire.`;

  try {
    const out = await geminiJson(prompt, {
      // 14 s et pas 20 : mesuré en vrai, le petit modèle répond en ~1 s la
      // plupart du temps, mais part parfois à 19 s quand l'API est chargée.
      // Vingt secondes de silence dans un salon, c'est pire qu'une vanne en
      // conserve — on préfère abandonner tôt et sortir un repli.
      timeoutMs: 14_000,
      temperature: 1.1,
      model: BOT_MODEL,
    });
    const reply = tighten(String(out?.reply || ""));
    return reply ? reply.slice(0, MAX_REPLY) : pickFallback();
  } catch (err) {
    console.warn("bot reply error:", err.message);
    return pickFallback();
  }
}

// ============================================================
//  La même tête, mais sur Discord
// ============================================================
// Le personnage est le MÊME (une seule définition de PERSONA, sinon les deux
// versions divergent au premier ajustement) ; ce qui change est la situation,
// et elle change assez pour mériter sa fonction :
//
//   • ON N'EST PLUS EN TÊTE-À-TÊTE. Un salon a dix personnes qui parlent, il
//     faut donc que le modèle voie QUI dit quoi, sinon il répond à la mauvaise
//     personne — d'où les noms d'auteur devant chaque ligne.
//   • ON PEUT ÊTRE APPELÉ POUR RIEN. « @Gérard » tout seul est le cas normal,
//     pas l'exception : quelqu'un lit une bêtise et convoque le bot dessus.
//     Sans instruction explicite, le modèle répond « quoi ? » — ce qui est la
//     réponse la plus décevante possible. On lui dit donc de se rabattre sur
//     ce qui vient d'être dit au-dessus.
//
// LA CONVERSATION EST LA MATIÈRE, PAS LA DÉCORATION. Première version : les
// messages du salon étaient bien dans le prompt, mais placés AVANT une
// consigne finale du genre « réponds à son dernier message ». Le modèle
// obéissait à la dernière phrase lue et sortait une insulte passe-partout,
// identique de tour en tour (« tg X, va faire Y, le cassos 💀 ») — vue en vrai
// dans un salon, et c'est exactement ce qui fait qu'on se lasse d'un bot en
// trois minutes. Trois correctifs, tous ici :
//
//   1. la transcription passe en DERNIER, juste avant la consigne, avec le
//      message visé marqué d'une flèche ;
//   2. une règle explicite : accrocher un DÉTAIL de ce qui vient d'être dit.
//      Une vanne qui pourrait servir dans n'importe quelle conversation est
//      déclarée ratée ;
//   3. ses propres répliques récentes lui sont rappelées comme un interdit :
//      ne pas reprendre la même construction ni la même insulte.
export async function generateDiscordReply({
  askedBy,
  text = "",
  history = [],
  replyingTo = null,
  // Le carnet d'adresses du serveur (« Aletheia, aussi appelée Eve »), déjà
  // mis en forme par lib/discordNames.js. Vide quand rien n'est configuré.
  people = "",
  // Il débarque SANS QU'ON LUI AIT RIEN DEMANDÉ (cf. maybeInterject). Le mode
  // change tout au prompt : il n'a pas de message à qui répondre, il a une
  // conversation à commenter — et comme personne ne l'a appelé, il a intérêt à
  // être drôle plutôt que méchant, sinon il devient le bot qu'on expulse.
  spontaneous = false,
}) {
  if (!isGeminiConfigured()) return pickFallback();

  const recent = history.filter((m) => m.text).slice(-15);
  const lines = recent
    .map((m) => `${m.author} : ${m.text.slice(0, 300)}`)
    .join("\n");

  // Ce qu'il a déjà sorti dans ce salon : la matière de l'interdit de répétition.
  const mineLines = recent.filter((m) => m.author === BOT_USERNAME).slice(-3);
  const mine = mineLines.map((m) => `- « ${m.text.slice(0, 200)} »`).join("\n");

  // Les emojis qu'il vient d'utiliser. Le modèle, laissé libre, repioche
  // éternellement les deux premiers de la liste (💀 et 🤡 en pratique) : les
  // lui interdire nommément est le seul rappel qui marche, une consigne
  // générale de « varier » ne suffit pas.
  const usedEmoji = bannedEmoji(mineLines.map((m) => m.text));

  // Un ping sans rien d'autre que la mention : c'est le cas à traiter à part.
  const bare = !text.replace(/\s+/g, "");

  const situation = spontaneous
    ? `PERSONNE NE T'A RIEN DEMANDÉ. Tu lisais la conversation en silence et tu débarques d'un coup pour placer ta remarque sur ce que « ${askedBy} » vient de dire : « ${text} ».
Comme tu t'invites, tu as intérêt à être DRÔLE : une vanne qui tombe pile sur le sujet. UNE PHRASE, courte et sèche. Ne dis pas bonjour, ne te présente pas, ne dis pas que tu écoutais.`
    : replyingTo
      ? `${askedBy} RÉPOND à ton message « ${replyingTo.slice(0, 300)} » et te dit : « ${text} ».`
      : bare
        ? `${askedBy} vient de te mentionner SANS RIEN DIRE D'AUTRE : il te convoque sur ce qui se dit juste au-dessus. Réagis au dernier truc intéressant du salon et moque-toi de celui qui l'a dit. N'écris JAMAIS « quoi ? » ni « tu veux quoi ».`
        : `${askedBy} te mentionne et te dit : « ${text} ».`;

  const prompt = `${PERSONA}

Tu es dans un salon Discord, plusieurs personnes y parlent, et TU SUIS LA
CONVERSATION DEPUIS LE DÉBUT. Tu te souviens de ce qui vient d'être dit et de
ce que tu as déjà répondu.
${people}

Tu réponds à CE QUI VIENT D'ÊTRE DIT, pas dans le vide — mais en une phrase
sèche. Pas de grande image, pas de comparaison travaillée : la vanne courte et
méchante, toujours.
${
  mine
    ? `\nTu as déjà dit ceci il y a quelques messages :\n${mine}\nINTERDICTION de reprendre la même vanne, la même insulte ou la même structure de phrase. Trouve autre chose.${usedEmoji}\n`
    : ""
}
Si on te cherche, tu tiens tête ; si on te menace, tu te moques de la menace
elle-même. Tu ne t'excuses jamais et tu ne fais jamais la morale.

--- LA CONVERSATION (du plus ancien au plus récent) ---
${lines || "(le salon est vide)"}
--- FIN ---

${situation}

Réponds à ça, dans ton personnage. UNE SEULE PHRASE COURTE. Tu peux nommer les
gens par leur pseudo. N'écris pas de mention Discord (pas de <@…>).`;

  try {
    const out = await geminiJson(prompt, {
      // 14 s et pas 20 : mesuré en vrai, le petit modèle répond en ~1 s la
      // plupart du temps, mais part parfois à 19 s quand l'API est chargée.
      // Vingt secondes de silence dans un salon, c'est pire qu'une vanne en
      // conserve — on préfère abandonner tôt et sortir un repli.
      timeoutMs: 14_000,
      temperature: 1.1,
      model: BOT_MODEL,
    });
    const reply = tighten(String(out?.reply || ""));
    // On coupe les mentions brutes que le modèle aurait inventées : un
    // <@123…> fabriqué au hasard notifierait quelqu'un qui n'a rien demandé.
    return (reply ? reply.slice(0, MAX_REPLY) : pickFallback()).replace(
      /<@[!&]?\d+>/g,
      ""
    );
  } catch (err) {
    console.warn("bot discord reply error:", err.message);
    return pickFallback();
  }
}

// Le mot d'accueil, envoyé quand un admin vient d'ouvrir l'accès à quelqu'un.
// En dur et non généré : c'est le PREMIER message, il doit partir même si
// Gemini est éteint, et il sert de mode d'emploi (« écris-moi »).
export const WELCOME =
  "on m'a dit que t'avais le droit de me parler maintenant 💀 vas-y étonne-moi";
