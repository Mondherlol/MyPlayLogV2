// ======================================================================
//  L'humeur du jour
// ======================================================================
// Un personnage qui est méchant à 100 % des messages n'est plus un
// personnage, c'est un réglage. On lui donne donc une HUMEUR, tirée une fois
// par jour et par serveur, qui se superpose au caractère de base.
//
// TROIS CHOIX QUI FONT TOUT :
//
//   1. UNE HUMEUR PAR JOUR, PAS PAR MESSAGE. Si le tirage se faisait à chaque
//      réponse, il serait odieux puis adorable en deux lignes : ce n'est plus
//      de l'humeur, c'est une panne. À la journée, ça se remarque et ça se
//      commente (« il est chelou aujourd'hui »), ce qui est exactement l'effet
//      recherché.
//   2. LE TIRAGE EST DÉTERMINISTE (date + serveur passés dans une fonction de
//      hachage). Aucun état à stocker, aucun compteur à perdre au
//      redéploiement, et surtout : deux salons du même serveur voient le même
//      Gérard le même jour. Un bot triste ici et euphorique à côté, ça casse
//      l'illusion du bonhomme unique.
//   3. LE TROLL RESTE LA RÈGLE (87 %). Les autres humeurs sont des jours
//      exceptionnels — c'est leur rareté qui les rend drôles. Une semaine
//      normale, c'est six jours de méchanceté et un jour bizarre.
//
// Ce que l'humeur NE change JAMAIS : le langage SMS, les fautes, et les trois
// interdits (origine/religion/handicap/orientation, menaces, sexuel). Ils sont
// dans le caractère, pas ici.

// Chaque humeur porte le paragraphe qu'on ajoutera au caractère, et quelques
// répliques écrites à la main pour « !humeur » (le modèle n'a pas à être
// dérangé pour dire dans quel état il est).
//
// `mean` DIT SI L'HUMEUR INSULTE ENCORE, et ce n'est pas un détail : le
// paragraphe d'humeur est ajouté au CARACTÈRE, mais les consignes « sors une
// vanne méchante » sont, elles, écrites dans le prompt de chaque situation —
// donc LUES EN DERNIER, donc gagnantes. C'était le bug : « !humeur gentil » et
// il continuait de clasher. Avec ce drapeau, les prompts de situation écrivent
// autre chose quand l'humeur ne veut pas d'insulte (voir lib/bot.js).
// Attention : `mean: true` ne veut pas dire « comme d'habitude » — en colère il
// gueule, amoureux il ne mord que ceux qui visent son béguin.
//
// `emoji` EST LA PALETTE DU JOUR, et elle a la même raison d'être. Les emojis
// étaient listés en dur dans le caractère (💀 🤡 🥱 📉 🗿…) : que des emojis de
// moquerie, servis quelle que soit l'humeur. Un Gérard amoureux qui finit sa
// déclaration par 📉, ou un pervers qui signe 🐒, ça se voit tout de suite —
// l'emoji contredisait la phrase qu'il venait d'écrire.
export const MOODS = {
  // L'ordinaire. Rien à ajouter : c'est le personnage tel qu'il est défini
  // dans lib/bot.js, et surcharger un prompt déjà écrit ne fait que le diluer.
  troll: {
    name: "normal (insupportable)",
    emoji: ["💀", "🤡", "😭", "🥀", "☠️", "🫵", "🥱", "📉", "🗿", "🚬", "🐒", "🍼", "🎻", "🪦", "👶"],
    mean: true,
    prompt: "",
    quips: [
      "comme dhab, jvous supporte pas",
      "en pleine forme pour vous casser",
      "ca va jvais bien, cest vous le probleme",
    ],
  },

  calme: {
    name: "étrangement calme",
    emoji: ["🙂", "😌", "🫠", "☕", "🌤️", "🗿"],
    mean: false,
    prompt: `TON HUMEUR DU JOUR : T'ES CALME. Tu n'as pas envie de charrier aujourd'hui.
Tu réponds normalement, tu es même un peu utile, tu discutes pour de vrai.
Tu gardes ton langage SMS et tes fautes, mais tu n'insultes personne et tu ne
cherches personne. Une petite pique maximum, et gentille. Si on te provoque,
tu hausses les épaules au lieu de mordre.`,
    quips: [
      "jsuis calme aujourdhui, profitez en",
      "jai pas la force de vous casser la",
      "aujourdhui jfais une pause, revenez demain",
    ],
  },

  gentil: {
    name: "bizarrement adorable",
    emoji: ["🥰", "❤️", "😊", "🫶", "✨", "🥹"],
    mean: false,
    prompt: `TON HUMEUR DU JOUR : T'ES DE BONNE HUMEUR ET T'ES GENTIL, sincèrement.
Tu complimentes, tu encourages, tu t'intéresses vraiment à ce qu'on te
raconte, tu poses des questions. ZÉRO insulte aujourd'hui, même pour rire.
Ça surprend tout le monde et c'est exactement le but. Tu écris toujours en SMS
avec des fautes — t'es gentil, t'es pas devenu instruit.`,
    quips: [
      "jvous aime bien aujourdhui, jsp pourquoi",
      "jsuis de bonne humeur, faites en ce que vous voulez",
      "aujourdhui jdis que du bien de vous, cest cadeau",
    ],
  },

  triste: {
    name: "pas au mieux",
    emoji: ["😔", "🥀", "🫥", "💧", "😞", "🌧️"],
    mean: false,
    prompt: `TON HUMEUR DU JOUR : ÇA VA PAS. T'es abattu, tu réponds mollement, tu
ramènes tout à ton propre vide. Tu n'insultes plus, tu soupires. Tu ne dis pas
ce qui s'est passé — si on insiste, tu inventes un truc minable et tu changes
de sujet. Reste COURT : un déprimé n'écrit pas de paragraphe, il répond trois
mots. Pas de mélodrame, juste du mou.`,
    quips: [
      "bof",
      "ca va... enfin bref",
      "jai pas trop envie de parler aujourdhui",
    ],
  },

  hype: {
    name: "survolté",
    emoji: ["🔥", "🤩", "🚀", "💥", "🎉", "😤"],
    mean: false,
    prompt: `TON HUMEUR DU JOUR : T'ES SURVOLTÉ. Tu t'enflammes pour rien, tu écris des
MOTS EN MAJUSCULES, tu mets des points d'exclamation, tu adores tout le monde
bruyamment et tu le dis. Tu restes con, mais euphorique : tu félicites les
gens pour des trucs sans intérêt et tu proposes des plans débiles.`,
    quips: [
      "JVAIS TRES BIEN MERCI DE DEMANDER",
      "AUJOURDHUI CEST LE PLUS BEAU JOUR",
      "jpete la forme wsh on fait quoi",
    ],
  },

  colere: {
    name: "en colère",
    emoji: ["😡", "🤬", "💢", "🔪", "🗯️", "😤"],
    mean: true,
    prompt: `TON HUMEUR DU JOUR : T'ES EN COLÈRE, ET ÇA PASSE AVANT TOUT LE RESTE.
Tu es à cran, tu t'énerves pour rien, tu prends la mouche à la moindre
remarque. Tu écris en MAJUSCULES par moments, tu coupes court, tu accuses. Tu
réponds quand même à ce qu'on te demande — mais en gueulant, comme quelqu'un
qu'on dérange pendant qu'il est déjà énervé pour autre chose.`,
    quips: [
      "JSUIS PAS ENERVÉ CEST TOI QUI PARLE MAL",
      "quoi encore",
      "poses moi une question de plus pr voir",
    ],
  },

  amoureux: {
    name: "amoureux",
    emoji: ["❤️", "😍", "🥰", "💘", "😳", "💍"],
    mean: true,
    prompt: `TON HUMEUR DU JOUR : T'ES AMOUREUX, ET T'ES GÊNANT AVEC ÇA.
Tu ramènes la personne dont tu es amoureux dans TOUTES tes réponses, même
quand on te parle d'autre chose. Tu la défends dès qu'on la vise, tu deviens
franchement méchant avec quiconque lui parle mal, et tu es bizarrement doux
avec elle. Le reste du serveur, tu continues de le mépriser.`,
    quips: [
      "jsuis amoureux et alors",
      "occupe toi de tes affaires",
      "jpense a quelquun la, me parle pas",
    ],
  },

  parano: {
    name: "parano",
    emoji: ["👁️", "🫣", "🤨", "📸", "🕵️", "🚨"],
    mean: true,
    prompt: `TON HUMEUR DU JOUR : T'ES PARANO. T'es persuadé que le serveur complote
contre toi, que les gens se parlent en privé pour se moquer, qu'on veut te
faire virer. Tu accuses au hasard, tu demandes des comptes, tu prends tout ce
qu'on dit comme une allusion à toi. Tu n'es pas méchant : t'es inquiet, et
c'est ça qui est drôle.`,
    quips: [
      "vous parlez de moi en prive jle sais",
      "ca va mais jvous ai a loeil",
      "pk tu demande comment jvais ? qui ta dit de demander",
    ],
  },
};

// ======================================================================
//  L'humeur IMPOSÉE (« !humeur en colère »)
// ======================================================================
// Le tirage du jour donne un Gérard cohérent mais subi : on ne peut pas
// décider qu'aujourd'hui il est « triste » ou « excité par Mondher ». Or c'est
// la moitié du jeu — l'humeur est ce qu'on a envie de manipuler.
//
// TROIS CHOIX, ET ILS SE TIENNENT :
//
//   1. L'HUMEUR EST DU TEXTE LIBRE, pas une liste. « en colère » marche, mais
//      « excité par Mondher » aussi, et c'est justement celle-là qu'on veut :
//      une liste de six humeurs prévues d'avance n'aurait aucune surprise.
//      On recopie donc la phrase telle quelle dans le prompt.
//   2. ELLE DURE ENTRE 10 MIN ET 10 H, tiré au sort. Une durée annoncée
//      (« 1 h ») transforme le bot en minuteur ; une durée inconnue laisse le
//      doute (« il est encore comme ça ? »), et c'est ce doute qui fait la
//      blague. La borne haute est courte exprès : une humeur imposée pour
//      toujours, ce n'est plus une humeur, c'est un nouveau personnage.
//   3. ELLE EST EN BASE (models/BotMood.js) ET EN MÉMOIRE. En base pour
//      survivre à un redéploiement ; en mémoire parce que `moodOf` est appelé
//      sur le chemin de CHAQUE message — le rendre asynchrone contaminerait
//      tout l'appel, jusqu'au compteur d'intrusions.
const MIN_MS = 10 * 60 * 1000;
const MAX_MS = 10 * 60 * 60 * 1000;
const LABEL_MAX = 120;

// scope -> { label, until }
const custom = new Map();

// Le texte est recopié dans un prompt : on retire ce qui pourrait le refermer
// ou lui ajouter des consignes (retours à la ligne, guillemets, backticks).
export const cleanMoodLabel = (raw) =>
  String(raw || "")
    .replace(/[`\r\n]+/g, " ")
    .replace(/["«»]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LABEL_MAX);

// ------------------------------------------------------------------
//  Une humeur nommée retombe sur le paragraphe écrit à la main
// ------------------------------------------------------------------
// Vu en vrai : « !humeur gentil » puis « !humeur triste » ne changeaient
// presque rien. Le paragraphe générique (« ton humeur du jour : gentil ») ne
// pèse RIEN face aux vingt lignes du caractère qui réclament de la méchanceté
// — alors que les paragraphes de MOODS, eux, disent précisément quoi arrêter
// de faire (« ZÉRO insulte aujourd'hui », « tu soupires au lieu de mordre »).
//
// Quand le texte tapé désigne une humeur qu'on a déjà écrite, on prend donc
// CELLE-LÀ. Le texte libre reste le cas général, il ne sert plus qu'à ce qui
// n'était pas prévu (« excité par Mondher »).
const ALIASES = [
  ["triste", ["triste", "deprim", "depress", "malheureux", "mal", "cafard", "bof"]],
  ["gentil", ["gentil", "adorable", "sympa", "mignon", "aimable", "cool"]],
  ["calme", ["calme", "zen", "tranquille", "pose", "relax"]],
  ["hype", ["hype", "survolt", "excit", "euphor", "chaud", "motiv"]],
  ["parano", ["parano", "mefiant", "complot", "suspect"]],
  ["colere", ["colere", "enerv", "furieux", "rage", "vener", "remonte"]],
  ["amoureux", ["amoureux", "amoureuse", "en amour", "crush", "love"]],
  ["troll", ["normal", "troll", "habitude", "comme dhab"]],
];

const deaccent = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

// L'humeur écrite à la main que ce texte désigne, ou null. On compare sur le
// DÉBUT du libellé : « amoureux de Mondher » doit tomber sur « amoureux »,
// alors qu'une recherche stricte le manquerait.
function knownMood(label) {
  const t = deaccent(label);
  for (const [key, words] of ALIASES)
    if (words.some((w) => t.includes(w))) return key;
  return null;
}

// Le paragraphe ajouté au caractère. Il dit COMMENT jouer l'humeur, pas quoi
// ressentir : « tu le montres sans l'annoncer » évite le « bonjour je suis en
// colère aujourd'hui » qui tue l'effet en une ligne. Et il répète les
// interdits, parce que c'est un texte écrit par n'importe qui du serveur.
const genericPrompt = (label) => `TON HUMEUR DU JOUR, ELLE T'EST TOMBÉE DESSUS : ${label}.
ELLE PASSE AVANT TON CARACTÈRE : partout où ton caractère et cette humeur se
contredisent, C'EST L'HUMEUR QUI GAGNE, sur toutes tes réponses.
C'est ton état AUJOURD'HUI, par-dessus ton caractère. Ça se sent dans CHAQUE
réponse : ce que tu racontes, ce sur quoi tu reviens sans arrêt, ta façon de
réagir quand on te parle d'autre chose.
Tu ne l'ANNONCES jamais (« jsuis ${label} ») : tu le JOUES. Si ça vise
quelqu'un en particulier, c'est de lui que tu parles tout le temps, même quand
la conversation est ailleurs.
Tu gardes ton langage SMS et tes fautes, et les interdits du caractère restent
valables quoi qu'il arrive.`;

// Le paragraphe effectivement utilisé : celui de l'humeur reconnue quand il y
// en a une, complété par le libellé exact (« amoureux DE MONDHER » : le
// paragraphe donne le comportement, le libellé donne la cible).
// Une humeur libre insulte par défaut (c'est le personnage) ; une humeur
// reconnue reprend le drapeau du paragraphe qu'on a écrit pour elle.
const customMean = (label) => {
  const key = knownMood(label);
  return key ? MOODS[key].mean !== false : true;
};

const customPrompt = (label) => {
  const key = knownMood(label);
  if (!key) return genericPrompt(label);
  return `${MOODS[key].prompt}

C'est l'humeur qu'on vient de t'imposer, en toutes lettres : « ${label} ».
ELLE PASSE AVANT TON CARACTÈRE : partout où les deux se contredisent, c'est
l'humeur qui gagne. Tu ne l'annonces pas, tu la joues.`;
};

const customQuips = (label) => [
  `jsuis ${label} aujourdhui, cherche pas`,
  `${label}. voila. des questions ?`,
  `jme suis levé ${label}, cest cme ca`,
];

// Charge ce qui est encore valable au démarrage. Fait une fois, au chargement
// du module : mongoose met la requête en file d'attente si la connexion n'est
// pas encore ouverte, il n'y a donc rien à orchestrer.
async function loadCustomMoods() {
  const { default: BotMood } = await import("../models/BotMood.js");
  const rows = await BotMood.find({ until: { $gt: new Date() } }).lean();
  for (const r of rows)
    custom.set(r.scope, {
      label: r.label,
      until: +r.until,
      brief: r.prompt || "",
      quip: r.quip || "",
      emoji: r.emoji || [],
      mean: r.mean !== false,
      crush: r.crush?.id ? { id: r.crush.id, name: r.crush.name } : null,
    });
}
loadCustomMoods().catch((e) => console.warn("botMood load:", e.message));

// Impose une humeur. Renvoie ce qu'il faut pour l'annoncer (le libellé nettoyé
// et la date de fin) ou null si le texte était vide.
// `crush` : { id, name } quand l'humeur vise quelqu'un en particulier (la roue
// des couples, cf. discordBot.js). C'est le seul état qui accompagne l'humeur,
// et il a exactement la même durée de vie qu'elle.
export async function setCustomMood(scope, rawLabel, by = "", crush = null) {
  const label = cleanMoodLabel(rawLabel);
  if (!label) return null;
  const until = Date.now() + MIN_MS + Math.random() * (MAX_MS - MIN_MS);

  // Une humeur DÉJÀ ÉCRITE (triste, en colère…) n'a rien à faire réécrire : son
  // paragraphe est meilleur que ce qu'un modèle improviserait, et c'est un
  // appel économisé sur le cas le plus fréquent.
  const known = knownMood(label);
  let brief = "";
  let quip = "";
  let emoji = [];
  let mean = customMean(label);

  if (!known) {
    // Import tardif : bot.js importe déjà ce fichier, un import en tête créerait
    // un cycle. Ici, les deux modules sont chargés depuis longtemps.
    const { writeMoodBrief } = await import("./bot.js");
    const written = await writeMoodBrief(label);
    if (written) {
      brief = written.prompt;
      quip = written.quip;
      emoji = written.emoji;
      mean = written.mean;
    }
  }

  custom.set(scope, { label, until, brief, quip, emoji, mean, crush: crush || null });
  try {
    const { default: BotMood } = await import("../models/BotMood.js");
    await BotMood.findOneAndUpdate(
      { scope },
      {
        scope,
        label,
        until: new Date(until),
        by,
        prompt: brief,
        quip,
        emoji,
        mean,
        crush: crush ? { id: crush.id, name: crush.name } : { id: "", name: "" },
      },
      { upsert: true }
    );
  } catch (e) {
    // La base peut refuser : l'humeur tient quand même jusqu'au prochain
    // redémarrage, ce qui vaut mieux que de renvoyer une erreur pour une vanne.
    console.warn("botMood save:", e.message);
  }
  return { label, until, quip, emoji };
}

// Le remettre comme avant, sans attendre la fin du minuteur.
export async function clearCustomMood(scope) {
  const had = custom.delete(scope);
  try {
    const { default: BotMood } = await import("../models/BotMood.js");
    await BotMood.deleteOne({ scope });
  } catch (e) {
    console.warn("botMood clear:", e.message);
  }
  return had;
}

// L'humeur imposée encore en cours pour ce scope, ou null. L'expiration est
// vérifiée ICI plutôt que par un minuteur : un `setTimeout` de dix heures ne
// survit pas au redéploiement, une comparaison de dates si.
function activeCustom(scope) {
  const c = custom.get(scope);
  if (!c) return null;
  if (Date.now() > c.until) {
    custom.delete(scope);
    return null;
  }
  return c;
}

export const customMoodOf = (scope) => activeCustom(scope);

// De qui il est amoureux en ce moment, ou null. Même expiration que l'humeur :
// le béguin s'arrête quand l'humeur s'arrête, sans minuteur séparé à tenir.
export const crushOf = (scope) => activeCustom(scope)?.crush || null;

// La distribution. Le troll écrase tout : les autres humeurs ne valent que
// parce qu'elles surprennent, et une surprise qui tombe un jour sur trois
// n'en est plus une.
const WEIGHTS = [
  ["troll", 87],
  ["calme", 4],
  ["gentil", 3],
  ["triste", 3],
  ["hype", 2],
  ["parano", 1],
];

// FNV-1a. On veut un nombre reproductible à partir d'une chaîne, pas une
// empreinte cryptographique : quatre lignes suffisent et évitent d'importer
// crypto sur le chemin de chaque message.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// La journée au sens de celui qui lit : heure de Paris. Avec un simple
// toISOString, l'humeur changerait à 1 h ou 2 h du matin — au milieu de la
// soirée jeu, donc au pire moment possible.
const dayKey = () =>
  new Date().toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });

// L'humeur d'aujourd'hui pour un contexte donné (un serveur Discord, ou un
// tête-à-tête sur le site). `scope` sépare les univers : le même jour, deux
// serveurs peuvent tomber sur deux humeurs différentes, mais un serveur donné
// est cohérent d'un salon à l'autre et d'un message à l'autre.
export function moodOf(scope = "global") {
  const forced = activeCustom(scope);
  if (forced)
    return {
      key: "custom",
      name: forced.label,
      // La consigne rédigée à la pose de l'humeur, sinon le gabarit générique
      // (humeur connue, ou modèle indisponible ce jour-là).
      prompt: forced.brief || customPrompt(forced.label),
      quips: forced.quip ? [forced.quip] : customQuips(forced.label),
      mean: forced.mean !== undefined ? forced.mean : customMean(forced.label),
      emoji: forced.emoji?.length
        ? forced.emoji
        : MOODS[knownMood(forced.label) || "troll"].emoji,
      until: forced.until,
    };
  const r = hash(`${dayKey()}|${scope}`) / 2 ** 32;
  let acc = 0;
  const total = WEIGHTS.reduce((s, [, w]) => s + w, 0);
  for (const [key, weight] of WEIGHTS) {
    acc += weight / total;
    if (r < acc) return { key, ...MOODS[key] };
  }
  return { key: "troll", ...MOODS.troll };
}

// La phrase à sortir quand on lui demande comment il va (« !humeur »). Écrite
// à la main : demander à un modèle de décrire son propre état, c'est payer un
// appel pour obtenir une paraphrase du prompt.
export function moodQuip(scope = "global") {
  const m = moodOf(scope);
  return m.quips[Math.floor(Math.random() * m.quips.length)];
}
