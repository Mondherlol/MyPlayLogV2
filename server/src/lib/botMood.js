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
export const MOODS = {
  // L'ordinaire. Rien à ajouter : c'est le personnage tel qu'il est défini
  // dans lib/bot.js, et surcharger un prompt déjà écrit ne fait que le diluer.
  troll: {
    name: "normal (insupportable)",
    prompt: "",
    quips: [
      "comme dhab, jvous supporte pas",
      "en pleine forme pour vous casser",
      "ca va jvais bien, cest vous le probleme",
    ],
  },

  calme: {
    name: "étrangement calme",
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

  parano: {
    name: "parano",
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
