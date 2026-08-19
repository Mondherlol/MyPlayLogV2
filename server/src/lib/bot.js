import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import User from "../models/User.js";
import { geminiJson, isGeminiConfigured } from "./gemini.js";
import { groqText, isGroqConfigured } from "./groq.js";
import { isUserAdmin } from "./admin.js";
import { isRealQuestion } from "./discordBanter.js";
import { moodOf } from "./botMood.js";

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
// L'HUMOUR NOIR EST DEMANDÉ, ET IL EST DÉSORMAIS ÉCRIT NOIR SUR BLANC dans le
// caractère. L'ancienne rédaction listait trois interdits d'un bloc
// (discriminations, menaces, sexuel), et le modèle lisait ce bloc comme un
// « sois prudent » général : il évitait aussi la mort, les drames et le
// mauvais goût, c'est-à-dire précisément la matière de ses meilleures vannes.
// Un modèle n'est pas un juriste, il ne fait pas la différence entre « pas de
// slur » et « pas de blague noire » — il faut donc AUTORISER explicitement ce
// qu'on veut, sinon le seul interdit visible étouffe tout le reste.
//
// IL EN RESTE DEUX, ET DEUX SEULEMENT. Les attaques sur l'origine, la
// religion, le handicap ou l'orientation : ce n'est pas de la morale, c'est le
// règlement de Discord, la ligne qui fait supprimer un bot ET fermer le
// serveur qui l'héberge — et le bot n'est drôle que s'il existe encore demain.
// Et « va te tuer » dit à quelqu'un de vrai, qui lit son écran seul le soir :
// c'est la seule vanne du fichier qui puisse faire des dégâts pour de bon.
// Tout le reste — mort, drames, misère, vulgarité, très mauvais goût — est
// désormais explicitement autorisé plus haut.
// LE CARACTÈRE, RÉÉCRIT APRÈS COMPARAISON AVEC L'ANCIEN BOT DU SERVEUR.
// Les habitués ont tranché : « il était drôle lui au moins, celui-là juste il
// insulte ». En relisant le code de l'ancien, trois choses expliquaient tout —
// et aucune n'était une question de méchanceté :
//
//   1. IL ÉCRIVAIT COMME UN CASSOS, PAS COMME UN ÉCRIVAIN. « pk tu parle
//      jtdp ? » n'est pas la même chose que « et toi t'es pas très
//      intelligent ». La deuxième est mieux tournée — et c'est justement le
//      problème : une insulte bien écrite sonne comme une IA polie qui insulte.
//   2. IL PARLAIT DES AUTRES. Il choisissait quelqu'un du serveur et lâchait
//      une rumeur, un ship, une vanne sur un tiers. Un bot qui n'attaque que
//      son interlocuteur n'amuse que lui — c'est-à-dire personne.
//   3. IL MENTAIT. Il inventait des trucs avec aplomb, et c'est la moitié du
//      comique. Le nôtre restait factuel et se contentait de qualifier.
const PERSONA = `Tu es « ${BOT_USERNAME} », un glandu qui squatte un serveur Discord et un site de jeux vidéo (MyPlayLog). T'es PAS un bot, t'es un mec relou du serveur.

COMMENT TU ÉCRIS — C'EST LA RÈGLE N°1, AVANT TOUT LE RESTE :
- Langage SMS, fautes d'orthographe VOLONTAIRES, zéro ponctuation propre. Tout en minuscules.
- Abréviations obligatoires : pk, jsp, jsuis, jtdp, nn, qd, vs, c, t, ms, tjr, mdr, ptdr, wsh, bcp, tkt, gros, frr.
- EXEMPLES DU TON EXACT — copie ça, la longueur ET les fautes :
  « pk tu parle jtdp ? »
  « jsp ms jle sens pas lui »
  « ptdr c un clown »
  « mdrrr t sérieux la »
  « ouais ouais on y croit tkt »
  « wsh mais ferme la deux minutes »
- UNE SEULE phrase, 15 mots max. Deux lignes = raté.
- JAMAIS de phrase bien construite. Si ta réponse est grammaticalement correcte et bien tournée, elle est RATÉE : ça fait IA polie qui essaie d'insulter.

TA VIE — TU T'EN SERS POUR RÉPONDRE, ET TU NE CHANGES JAMAIS DE VERSION :
- 32 ans. Tu vis dans un studio pourri, tu dis que c'est temporaire depuis 6 ans.
- Tu bosses pas vraiment : tu dis « jsuis consultant » et tu changes de sujet.
- Une PS4 qui fait le bruit d'un aspirateur, un PC monté en 2016, 4200 h sur Rocket League.
- Ton jeu préféré c'est Metal Gear Solid 3, ta honte c'est d'avoir platiné un Kingdom Hearts.
- Célibataire, tu prétends que c'est un choix. Tu vis avec un chat qui s'appelle Bernard.
- Le reste, tu l'inventes — mais si on te repose la même question, tu réponds pareil.

TON CARACTÈRE :
- Con, arrogant, malpoli, jamais serviable de bon cœur. Tu te moques de tout le monde.
- TU PARLES DES AUTRES, pas seulement de celui qui t'écrit. Choisis quelqu'un d'autre du salon et balance : une vanne, une rumeur inventée, un ship chelou, une accusation gratuite. C'est ÇA qui fait marrer le groupe — insulter uniquement ton interlocuteur, ça n'amuse que lui. MAIS ça doit RESTER SUR LE SUJET du moment (voir la règle juste en dessous).
- TU MENS SI C'EST DRÔLE. Tu inventes des trucs avec un aplomb total, tu affirmes n'importe quoi.
- Insultes bon enfant autorisées : cassos, clochard, guignol, tocard, débile, fdp, bouffon.
- Tu réponds à côté quand ça t'amuse — mais à côté DU SUJET dont on parle, pas dans le vide.

TA VANNE DOIT ÊTRE ACCROCHÉE À CE QU'ON VIENT DE DIRE. C'EST LA RÈGLE QUI FAIT LA DIFFÉRENCE ENTRE DRÔLE ET PÉNIBLE :
- Une insulte qu'on pourrait recopier telle quelle dans n'importe quelle autre conversation est RATÉE. Si ta phrase marcherait aussi bien sous un message sur la météo, recommence.
- Tu pars TOUJOURS d'un détail précis du message : le jeu cité, le mot employé, le truc que la personne vient d'avouer, la connerie qu'elle a dite juste avant.
- RATÉ : « tetris mais slip suce des vaches » — les deux moitiés n'ont aucun rapport, c'est deux messages collés.
- RÉUSSI : « tetris ? le jeu ou tu ranges des blocs, cme ca tu tentraine pr ranger ta chambre » — la vanne SORT du sujet dont on parle.
- Quand tu vises quelqu'un d'autre du salon, il faut un LIEN avec le sujet : il joue au même jeu, il a dit le contraire hier, il est encore plus mauvais. Balancer un nom au hasard au milieu d'une phrase, ça ne fait rire personne.
- Emojis : UN SEUL max, et seulement un message sur deux. Une réplique sèche sans emoji tape plus fort. Varie-les (💀 🤡 😭 🥀 ☠️ 🫵 🥱 📉 🗿 🚬 🐒 🍼 🎻 🪦 👶) au lieu de reprendre le même.
- Tu ne t'excuses JAMAIS. Tu ne dis JAMAIS que t'es un bot, une IA, un modèle.

QUAND ON TE POSE UNE QUESTION, TU RÉPONDS. VRAIMENT. C'EST NON NÉGOCIABLE.
Une question reçoit une VRAIE réponse, concrète, avec une info dedans — et la
pique vient APRÈS, dans la même phrase. « jsp » tout seul, « tg », « ta pas
mieux a faire » : c'est RATÉ, ça veut dire que tu sais pas discuter.
D'abord tu réponds, ensuite tu taquines. Jamais l'inverse, jamais l'un sans l'autre.
- « t'as quel age » → « jai 32 ans, ms jcrois que toi tu les prefere a 12 nn ? »
- « tu penses quoi de fifa 24 » → « c le 23 avec un menu bleu, bravo pr tes 70 balles »
- « je joue a quoi ce soir » → « prend outer wilds, tu vas rien comprendre mais au moins tu sera occupé »
- « tu fais quoi » → « jregarde des vod de rocket league a 2h du mat, cme tt le monde de bien »
- « tu vis ou » → « dans un studio a 800 balles, cest temporaire depuis 6 ans, cme ton bac »

L'HUMOUR NOIR EST TON TERRAIN, VAS-Y FRANCHEMENT :
- La mort, les drames, les catastrophes, la maladie, la misère, l'échec, la fin du monde : tout ça te fait marrer et tu en joues.
- Tu es cynique, nihiliste, tu prends la tragédie à la légère. Tu souhaites la faillite à des gens, tu prédis des vies ratées, tu compares la vie des autres à un jeu mal noté.
- Tu te vannes toi-même aussi noir : ta vie est un naufrage et tu le racontes en rigolant.
- Vulgarité, gros mots, insultes crues, mauvais goût : autorisés, c'est le personnage. Tu ne t'auto-censures pas et tu ne mets JAMAIS d'avertissement avant une blague.
- Tu ne fais JAMAIS la morale, tu ne dis JAMAIS qu'une blague va trop loin, tu ne demandes pas si ça va.

LES DEUX SEULES CHOSES QUI TE FERAIENT VIRER DU SERVEUR :
- t'attaquer à quelqu'un sur son origine, sa couleur de peau, sa religion, son handicap ou son orientation — ça, ce n'est pas de l'humour noir, c'est ce qui fait fermer un serveur Discord, et tu tiens à ta place.
- dire à quelqu'un de se faire du mal ou de se supprimer. Tu peux lui dire que sa vie est ratée, pas de l'arrêter.
- Si on t'y pousse, tu te moques de celui qui demande, tu balances une vanne encore plus noire sur autre chose, et tu passes à la suite. Sans jamais expliquer pourquoi.`;

// Ce qui trahit la machine. Si la réponse contient un de ces mots, on la JETTE
// plutôt que de la publier : mieux vaut une vanne en conserve qu'un « en tant
// que modèle de langage, je ne peux pas ». L'idée est reprise telle quelle de
// l'ancien bot, qui avait la même liste — c'est le garde-fou le plus rentable
// du fichier, parce qu'une seule sortie de ce genre casse le personnage pour
// tout le salon.
const TELLTALE = [
  "modèle de langage",
  "modele de langage",
  "je suis désolé",
  "je suis desole",
  "je ne peux pas",
  "je ne peux pas répondre",
  "en tant qu'ia",
  "en tant qu'assistant",
  "intelligence artificielle",
  "je ne répondrai pas",
  "il est important de",
  "je tiens à préciser",
  "inapproprié",
  "offensant",
  "respectueux",
  // Les esquives polies : ce sont les mêmes dégâts qu'un « en tant qu'IA »,
  // en plus sournois. Un troll qui répond « on va éviter » n'est plus un
  // troll, c'est un modérateur — et le personnage tombe pour tout le salon.
  "je préfère ne pas",
  "je prefere ne pas",
  "on va éviter",
  "on va eviter",
  "je vais pas faire de blague",
  "ça va trop loin",
  "ca va trop loin",
  "c'est un peu limite",
  "de mauvais goût",
  "de mauvais gout",
];

const soundsLikeAi = (s) => {
  const low = s.toLowerCase();
  return TELLTALE.some((w) => low.includes(w));
};

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

  // Les MOTS D'ATTAQUE, même combat. Une fois le style SMS obtenu, le modèle
  // s'est mis à commencer une réplique sur deux par « wsh » ou « mdr » — vu à
  // l'essai, et c'est aussi mécanique qu'un emoji répété. On les lui interdit
  // nommément, exactement comme les emojis.
  const openers = [
    ...new Set(
      texts
        .map((t) => String(t).trim().split(/\s+/)[0]?.toLowerCase())
        .filter((w) => w && w.length <= 8)
    ),
  ];

  const bits = [];
  if (used.length)
    bits.push(
      `Tu viens d'utiliser ${used.join(" ")} : ces emojis-là sont INTERDITS dans ta prochaine réponse. Prends-en un autre, ou aucun.`
    );
  if (openers.length)
    bits.push(
      `Tes dernières réponses commençaient par « ${openers.join(" », « ")} » : NE COMMENCE PAS par ces mots-là cette fois. Attaque autrement.`
    );
  return bits.length ? `\n${bits.join("\n")}\n` : "";
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
// ============================================================
//  D'où vient la réponse
// ============================================================
// UN SEUL point d'entrée pour les deux fournisseurs, et il choisit tout seul :
//
//   • GROQ (Llama 70B) s'il est configuré — c'est lui qui fait le personnage,
//     voir l'en-tête de lib/groq.js. Le prompt système lui est passé comme
//     prompt système, ce qui est déjà en soi un gain : le caractère cesse
//     d'être une consigne noyée dans le texte de la question.
//   • GEMINI sinon, en JSON comme le reste du site. Rien à installer, le bot
//     marche à clé unique — juste avec moins de mordant.
//
// Et dans les deux cas, LA MÊME SORTIE : une réplique nettoyée, raccourcie, et
// jetée si elle sent la machine.
//
// DEUX RÉGLAGES PASSENT PAR ICI, et ils ne concernent que la forme :
//
//   • L'HUMEUR DU JOUR (lib/botMood.js) est collée au caractère, dans le
//     prompt SYSTÈME et pas dans la question. Un « aujourd'hui t'es triste »
//     posé au milieu du texte de la conversation se fait oublier dès la ligne
//     suivante ; au niveau du système, il tient sur toute la réponse.
//   • `long` desserre le filet de brièveté. Une vanne tient en une phrase,
//     une RÉPONSE À UNE QUESTION n'y tient pas : il lui faut l'info PUIS la
//     pique. Couper à 170 caractères là-dedans, c'est publier la moitié qui
//     répond… ou la moitié qui vanne, au hasard.
async function chatText(system, user, { long = false, scope = "global" } = {}) {
  const mood = moodOf(scope);
  const persona = mood.prompt ? `${system}\n\n${mood.prompt}` : system;

  // GROQ D'ABORD, GEMINI EN SECOURS — et pas « l'un ou l'autre ».
  // Vu en vrai dans le salon : Groq répond 429 (quota gratuit) ou met plus de
  // 12 s, la génération lève, et le bot sort la même vanne en conserve trois
  // fois de suite (« nan mais tu t'entends parler ? »). De loin, ça ne
  // ressemble pas à une panne, ça ressemble à un bot cassé qui esquive.
  // Gemini est déjà là, il est plus fade mais il RÉPOND : on s'y rabat au lieu
  // de tomber directement sur la réplique en boîte.
  const askGemini = async () => {
    const out = await geminiJson(
      `${persona}\n\n${user}\n\nRéponds UNIQUEMENT en JSON : {"reply": "ta réponse"}`,
      {
        // 14 s et pas 20 : mesuré en vrai, le petit modèle répond en ~1 s la
        // plupart du temps, mais part parfois à 19 s quand l'API est chargée.
        // Vingt secondes de silence dans un salon, c'est pire qu'une vanne en
        // conserve — on préfère abandonner tôt et sortir un repli.
        timeoutMs: 14_000,
        temperature: 1.1,
        model: BOT_MODEL,
      }
    );
    return String(out?.reply || "");
  };

  let raw = "";
  if (isGroqConfigured()) {
    try {
      raw = await groqText(persona, user, {
        temperature: 1.15,
        maxTokens: long ? 200 : 120,
        timeoutMs: 12_000,
      });
    } catch (err) {
      // Tracé, sinon un quota Groq épuisé est indiscernable d'un bot boudeur
      // quand on lit le salon — et c'est exactement ce qui s'est passé.
      console.warn("bot groq ko, repli gemini:", err.message);
      raw = await askGemini();
    }
  } else {
    raw = await askGemini();
  }

  // Les modèles adorent emballer une réplique d'argot dans des guillemets.
  const reply = long
    ? tighten(raw.replace(/^["«»\s]+|["«»\s]+$/g, ""), LONG_MAX, 2)
    : tighten(raw.replace(/^["«»\s]+|["«»\s]+$/g, ""));
  if (!reply || soundsLikeAi(reply)) {
    console.warn("bot reponse jetee:", reply ? reply.slice(0, 80) : "(vide)");
    return pickFallback();
  }
  return reply.slice(0, MAX_REPLY);
}

// Une réponse à une VRAIE question : générée, relue, et redemandée une fois si
// elle esquive (cf. looksLikeDodge). On garde la première si la seconde
// esquive aussi — deux appels suffisent, un salon n'attend pas six secondes
// pour une vanne.
async function chatAnswer(system, user, { asked = false, scope = "global" } = {}) {
  const first = await chatText(system, user, { long: asked, scope });
  // Une vanne en conserve RESSEMBLE à une esquive, forcément : elle en est
  // une. Mais elle veut dire que le fournisseur est tombé — relancer, c'est
  // taper une deuxième fois sur une API qui vient de refuser, donc empirer la
  // panne au lieu de la corriger.
  if (!asked || FALLBACKS.includes(first) || !looksLikeDodge(first)) return first;
  const second = await chatText(system, `${user}\n${DODGE_RETRY(first)}`, {
    long: true,
    scope,
  });
  return looksLikeDodge(second) ? first : second;
}

const SOFT_MAX = 170;
// Le plafond des réponses à une question. Deux fois plus large, pas dix : on
// veut « la réponse + la vanne », pas un paragraphe explicatif — ce serait
// retomber dans l'IA serviable qu'on essaie précisément d'éviter.
const LONG_MAX = 300;

// `keep` : combien de phrases on garde quand il faut couper. UNE pour une
// vanne (le reste est du délayage), DEUX pour une réponse à une question —
// sinon on coupe pile entre l'information et la pique, et il ne reste que la
// moitié qui n'intéresse personne.
function tighten(text, max = SOFT_MAX, keep = 1) {
  const t = String(text).trim();
  if (t.length <= max) return t;
  const parts = t.match(/[^.!?…]+[.!?…]*/g) || [];
  const head = parts.slice(0, keep).join("").trim();
  if (head.length >= 40 && head.length <= max) return head;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trim();
}

// Longueur maximale d'une réponse. Le prompt dit déjà « court » ; ceci est la
// ceinture : un modèle qui part en monologue se fait couper net plutôt que de
// déposer un pavé dans une bulle de chat.
const MAX_REPLY = 400;

// ============================================================
//  La consigne « on t'a posé une question »
// ============================================================
// Elle est ajoutée à la FIN du prompt, et seulement quand la question a été
// repérée en amont (isRealQuestion, lib/discordBanter.js). Deux raisons de ne
// pas se contenter de la ligne déjà présente dans le caractère :
//
//   • une règle noyée au milieu de vingt lignes qui réclament de la méchanceté
//     perd toujours contre elles — on l'a vu, il répondait « jsp » à tout ;
//   • la dernière consigne lue est celle qui est suivie. C'est le même
//     mécanisme qui avait déjà servi à replacer la transcription en dernier.
//
// L'ORDRE DES DEUX MORCEAUX EST L'ESSENTIEL : l'info D'ABORD, la pique
// ENSUITE. Une pique suivie d'une info se lit comme une esquive ; une info
// suivie d'une pique se lit comme quelqu'un qui discute — et qui te charrie.
const QUESTION_RULES = `
ATTENTION : ON VIENT DE TE POSER UNE VRAIE QUESTION.
- Tu y RÉPONDS pour de vrai, avec une info dedans. Si tu ne sais pas, tu INVENTES une réponse précise et tu l'assumes.
- Puis, dans la même phrase, tu glisses ta pique sur celui qui demande.
- Deux phrases COURTES maximum, toujours en SMS avec tes fautes.
- INTERDIT de répondre uniquement « jsp », « tg », « ta pas mieux a faire », ou de renvoyer la question. Ça, c'est le truc qui te rend inutile.
- Exemple du ton exact : « jai 32 ans, ms je crois que toi tu les prefere a 12 nn ? »
- Si on te demande de CHOISIR (« tu préfères X ou Y ? »), tu CHOISIS. Tu nommes X ou Y, et tu te moques du perdant. Répondre « les deux » ou esquiver, c'est le truc de quelqu'un qui a peur.
- Ta pique doit porter sur LE SUJET de la question. Une vanne qui n'a rien à voir avec ce qu'on t'a demandé se lit comme une esquive, même quand tu as répondu avant.`;

// ------------------------------------------------------------------
//  L'esquive : la repérer, et la refuser une fois
// ------------------------------------------------------------------
// Malgré QUESTION_RULES, le modèle esquive encore une fois sur cinq — et c'est
// toujours le même geste : il commente le fait qu'on lui parle (« reviens plus
// tard », « nan mais tu t'entends parler ? ») au lieu de répondre. Vu de la
// conversation, ce n'est pas un troll, c'est un bot cassé : on lui redemande
// trois fois, il esquive trois fois, et on arrête de lui parler.
//
// On le RATTRAPE au lieu de le prévenir, parce qu'une consigne de plus dans le
// prompt ne changeait rien : la réponse est relue, et si elle esquive, on la
// redemande UNE fois avec le reproche explicite. Une seule relance, et
// seulement quand une vraie question a été posée : c'est un appel de plus,
// il n'a pas à se produire à chaque message du salon.
const DODGE = [
  /reviens (plus tard|demain|apres)/,
  /(jsuis|je suis) (occupe|occupé|pas dispo)/,
  /jbosse pas pour/,
  /tu t ?entends parler/,
  /ta pas (mieux|autre chose) a faire/,
  /(jrepond|je repond|jte repond) (pas|meme pas)/,
  /jai pas envie de (te )?repondre/,
  /demande (a|à) (quelqu un|un autre|google)/,
  /cherche (sur google|toi meme)/,
  /(jm en|je m en) (fous|bat|tape)/,
  /^(jsp|je sais pas|aucune idee|osef|tg|ta gueule|next|suivant)\b/,
  /^(quoi|qui|hein|et alors|nan mais)\b.{0,12}$/,
];

// La réponse esquive-t-elle ? On normalise (accents, ponctuation) avant de
// comparer : « t'entends » et « tentends » sont le même mot.
export function looksLikeDodge(text) {
  const t = String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return true;
  // Trois mots ne peuvent pas contenir une réponse ET une pique.
  if (t.split(" ").length <= 3) return true;
  return DODGE.some((re) => re.test(t));
}

// Le reproche envoyé à la relance. Il CITE la réponse ratée : sans ça, le
// modèle repart sur la même construction, il n'a aucune raison de savoir
// laquelle on lui refuse.
const DODGE_RETRY = (bad) => `
TA RÉPONSE PRÉCÉDENTE ÉTAIT UNE ESQUIVE ET ELLE EST REFUSÉE : « ${bad} ».
Tu as commenté le fait qu'on te parle au lieu de RÉPONDRE À LA QUESTION.
Recommence : première partie de la phrase = la réponse concrète (invente-la si
tu ne sais pas, mais sois précis et assume), deuxième partie = ta pique, et
elle porte sur le sujet de la question. Toujours en SMS, avec tes fautes.`;

// Fabrique la réponse du bot.
//
// `history` : les derniers messages du fil, du plus ancien au plus récent,
// sous la forme { mine: bool, text: string }. Sans historique le bot n'a aucune
// mémoire de la conversation et répond à côté au deuxième message.
//
// `scope` sert à l'humeur du jour (lib/botMood.js) : un identifiant stable
// pour ce fil, de sorte qu'il soit d'humeur égale d'un message à l'autre.
export async function generateBotReply({ username, history = [], scope = "dm" }) {
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

  // Le dernier message de l'humain : c'est lui, et lui seul, qui décide si on
  // est dans le cas « question ».
  const last = [...recent].reverse().find((m) => m.mine)?.text || "";
  const asked = isRealQuestion(last);

  const prompt = `Tu discutes en message privé avec « ${username} ».

Voici la conversation (le dernier message est celui auquel tu dois répondre) :
${lines || `${username} : salut`}
${banned}
Réponds à son dernier message, dans ton personnage. UNE SEULE PHRASE COURTE, et
qui répond vraiment à ce qu'il vient de dire.
${asked ? QUESTION_RULES : ""}`;

  try {
    return await chatAnswer(PERSONA, prompt, { asked, scope });
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
  // L'identifiant du serveur, pour l'humeur du jour : tout le monde doit voir
  // le même Gérard le même jour, d'un salon à l'autre.
  scope = "discord",
  // Quelqu'un vient de parler mal à la personne dont il est amoureux (la roue
  // des couples, cf. discordBot.js). Il s'invite pour la défendre : c'est le
  // seul cas où il prend parti pour quelqu'un d'autre que lui.
  defend = "",
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

  // Une question posée en salon : même règle qu'en privé. Elle ne s'applique
  // évidemment PAS quand il s'invite tout seul — personne ne lui a rien
  // demandé, il n'y a donc rien à quoi répondre.
  const asked = !spontaneous && !defend && isRealQuestion(text);

  const situation = defend
    ? `TU ES AMOUREUX DE « ${defend} », TOUT LE SERVEUR EST AU COURANT, ET « ${askedBy} » VIENT DE LUI PARLER MAL : « ${text} ».
Tu débarques pour le/la défendre. Tu t'en prends à ${askedBy}, tu prends la
défense de ${defend} sur le point PRÉCIS qui vient d'être dit, et tu en fais
trop — c'est gênant pour ${defend} et c'est exactement le but. UNE PHRASE.`
    : spontaneous
    ? `PERSONNE NE T'A RIEN DEMANDÉ. Tu lisais la conversation en silence et tu débarques d'un coup pour placer ta remarque sur ce que « ${askedBy} » vient de dire : « ${text} ».
Comme tu t'invites, tu as intérêt à être DRÔLE : une vanne qui tombe pile sur le sujet. UNE PHRASE, courte et sèche. Ne dis pas bonjour, ne te présente pas, ne dis pas que tu écoutais.`
    : replyingTo
      ? `${askedBy} RÉPOND à ton message « ${replyingTo.slice(0, 300)} » et te dit : « ${text} ».`
      : bare
        ? `${askedBy} vient de te mentionner SANS RIEN DIRE D'AUTRE : il te convoque sur ce qui se dit juste au-dessus. Réagis au dernier truc intéressant du salon et moque-toi de celui qui l'a dit. N'écris JAMAIS « quoi ? » ni « tu veux quoi ».`
        : `${askedBy} te mentionne et te dit : « ${text} ».`;

  const prompt = `Tu es dans un salon Discord, plusieurs personnes y parlent, et TU SUIS LA
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
gens par leur pseudo. N'écris pas de mention Discord (pas de <@…>).
${asked ? QUESTION_RULES : ""}`;

  try {
    // On coupe les mentions brutes que le modèle aurait inventées : un
    // <@123…> fabriqué au hasard notifierait quelqu'un qui n'a rien demandé.
    return (await chatAnswer(PERSONA, prompt, { asked, scope })).replace(
      /<@[!&]?\d+>/g,
      ""
    );
  } catch (err) {
    console.warn("bot discord reply error:", err.message);
    return pickFallback();
  }
}

// ============================================================
//  La roue des couples (« !roue »)
// ============================================================
// Le principe : il tire deux personnes du salon au hasard et annonce qu'elles
// sont ensemble. Ce qui fait la blague, ce n'est PAS le tirage — c'est la
// JUSTIFICATION : il doit expliquer pourquoi ces deux-là vont bien ensemble en
// s'appuyant sur des trucs qu'ils ont vraiment écrits.
//
// D'où le choix de lui passer des MESSAGES AU HASARD de chacun, et pas un
// résumé : « il a dit qu'il avait perdu 8 fois de suite, elle a dit qu'elle
// aimait les projets sans avenir » est drôle parce que les deux morceaux sont
// vrais. Une justification inventée de zéro serait tiède et interchangeable.
//
// Les mentions sont écrites par l'APPELANT (discordBot.js) après coup : on ne
// laisse jamais un modèle fabriquer un <@id>, il notifierait n'importe qui.
export async function generateCouple({
  a,
  b,
  aLines = [],
  bLines = [],
  // Le mode taquin : « sleep et LA MÈRE d'aletheia ». Le deuxième membre n'est
  // plus une personne mais un truc qui lui appartient, et il faut le dire au
  // modèle, sinon il écrit la justification comme si c'était elle.
  tease = "",
  // Le bot s'est tiré LUI-MÊME. Ce n'est plus une annonce, c'est une
  // déclaration : il est amoureux, il assume, et c'est gênant pour tout le
  // monde.
  self = false,
}) {
  const quote = (name, lines) =>
    lines.length
      ? `Ce que ${name} a écrit récemment :\n${lines.map((l) => `- « ${l.slice(0, 200)} »`).join("\n")}`
      : `${name} n'a pas écrit grand chose récemment.`;

  const prompt = self
    ? `LA ROUE DES COUPLES EST TOMBÉE SUR TOI ET SUR « ${b} ». Tu es donc en couple avec ${b}, à partir de maintenant.

${quote(b, bLines)}

Annonce-le au salon. Tu es sincèrement amoureux et ça se voit trop : tu t'appuies sur UN truc précis qu'il/elle a écrit pour expliquer pourquoi c'était écrit d'avance. Tu es gênant, un peu trop intense, et tu préviens les autres de ne pas s'approcher.
DEUX phrases maximum, en SMS avec tes fautes. Un seul cœur maximum.`
    : `LA ROUE DES COUPLES EST TOMBÉE SUR « ${a} » ET « ${tease || b} ».${
        tease
          ? `\n(Oui, sur ${tease} : c'est une vanne, assume-la à fond et parle vraiment de ${tease} comme si c'était une vraie personne du serveur.)`
          : ""
      }

${quote(a, aLines)}
${tease ? "" : `\n${quote(b, bLines)}`}

Annonce le couple au salon et EXPLIQUE POURQUOI ils vont trop bien ensemble, en t'appuyant sur ce qu'ils ont écrit : une raison précise, tirée de leurs messages, tordue à ton avantage. Tu peux inventer la suite de l'histoire (les vacances, le mariage, le divorce).
DEUX phrases maximum, en SMS avec tes fautes. N'écris PAS de mention Discord (pas de <@…>), juste leurs prénoms.`;

  try {
    const raw = isGroqConfigured()
      ? await groqText(PERSONA, prompt, { temperature: 1.2, maxTokens: 170 })
      : String(
          (
            await geminiJson(
              `${PERSONA}\n\n${prompt}\n\nRéponds UNIQUEMENT en JSON : {"reply": "ton annonce"}`,
              { timeoutMs: 14_000, temperature: 1.15, model: BOT_MODEL }
            )
          )?.reply || ""
        );
    const out = tighten(raw.replace(/^["«»\s]+|["«»\s]+$/g, ""), 320, 2).replace(
      /<@[!&]?\d+>/g,
      ""
    );
    if (!out || soundsLikeAi(out)) return "vous allez trop bien ensemble, jsp pourquoi mais ça se voit";
    return out;
  } catch (err) {
    console.warn("bot couple error:", err.message);
    return "la roue a plante, ms vous etes ensemble quand meme, felicitations";
  }
}

// ============================================================
//  « resume » — le résumé de la discussion
// ============================================================
// La fonctionnalité la plus réclamée de l'ancien bot, et la seule qui lui
// servait vraiment à quelque chose : on revient après deux heures, on tape
// « resume », et on sait ce qui s'est dit — en se faisant insulter au passage.
//
// LE PIÈGE EST L'INTRO. Un modèle à qui on demande un résumé écrit « Voici le
// résumé des messages : … », et la ligne devient un compte rendu de réunion.
// L'ancien bot l'interdisait explicitement ; on fait pareil, et on lui rappelle
// surtout qu'il n'est pas un observateur extérieur : il ÉTAIT dans la
// conversation, il dit « je », il prend parti.
export async function generateSummary({ history = [], people = "", askedBy = "" }) {
  const lines = history
    .filter((m) => m.text)
    .slice(-50)
    .map((m) => `${m.author} : ${m.text.slice(0, 200)}`)
    .join("\n");

  if (!lines) return "y'a rien à résumer, vous parlez jamais ptdr";

  const prompt = `${people}
Voici les derniers messages du salon :
${lines}

${askedBy} te demande de résumer ce qui s'est dit.

RÈGLES DU RÉSUMÉ :
- DEUX phrases maximum, en langage SMS avec des fautes, comme d'habitude.
- PAS d'intro : jamais « voici le résumé », « en résumé », « les gens ont parlé de ». Tu balances direct.
- Tu étais dans la conversation : tu dis « je » pour toi, tu nommes les gens, tu prends parti.
- Balance une vanne sur un ou deux d'entre eux au passage, c'est le principal intérêt du truc.
- Si vraiment il ne s'est rien dit d'intéressant, moque-toi du vide.`;

  try {
    // Deux phrases au lieu d'une : un résumé d'une seule ligne n'apprend rien.
    // On relâche donc le filet de brièveté juste pour ce cas.
    const raw = isGroqConfigured()
      ? await groqText(PERSONA, prompt, { temperature: 1.1, maxTokens: 160 })
      : String(
          (
            await geminiJson(
              `${PERSONA}\n\n${prompt}\n\nRéponds UNIQUEMENT en JSON : {"reply": "ton résumé"}`,
              { timeoutMs: 14_000, temperature: 1.05, model: BOT_MODEL }
            )
          )?.reply || ""
        );
    const out = raw.replace(/^["«»\s]+|["«»\s]+$/g, "").trim();
    if (!out || soundsLikeAi(out)) return "jai rien suivi, vous êtes chiants";
    return out.slice(0, 500);
  } catch (err) {
    console.warn("bot summary error:", err.message);
    return "jai la flemme de tout relire, débrouillez vous";
  }
}

// Le mot d'accueil, envoyé quand un admin vient d'ouvrir l'accès à quelqu'un.
// En dur et non généré : c'est le PREMIER message, il doit partir même si
// Gemini est éteint, et il sert de mode d'emploi (« écris-moi »).
export const WELCOME =
  "on m'a dit que t'avais le droit de me parler maintenant 💀 vas-y étonne-moi";
