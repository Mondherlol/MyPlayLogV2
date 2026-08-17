// ======================================================================
//  Les réflexes — réponses instantanées à des mots-clés
// ======================================================================
// Repris de l'ancien bot du serveur, où c'était une bonne part de son
// caractère : certaines phrases déclenchent une réplique TIRÉE D'UNE LISTE,
// sans passer par le moindre modèle de langage.
//
// TROIS RAISONS QUI EN FONT AUTRE CHOSE QU'UNE FACILITÉ :
//
//   1. C'EST INSTANTANÉ. Un « tg » qui reçoit sa réponse en 40 ms fait rire ;
//      le même après deux secondes de réflexion tombe à plat. C'est le seul
//      endroit où la latence change la blague.
//   2. ÇA NE COÛTE RIEN. Ni jeton, ni quota, ni panne d'API possible.
//   3. C'EST ÉCRIT PAR UN HUMAIN, donc c'est vraiment drôle et vraiment
//      irrégulier — un modèle produit une moyenne, une liste produit des
//      perles.
//
// Toutes les réactions sont PROBABILISTES. Répondre à chaque « salut » du
// serveur ferait de lui un concierge insupportable ; une fois sur deux, il
// paraît d'humeur changeante, ce qui est exactement le personnage.

const rand = (a) => a[Math.floor(Math.random() * a.length)];
const roll = (p) => Math.random() < p;

// Sans accent, sans ponctuation : « ta gueule !! » et « ta geule » doivent
// tomber dans le même panier.
const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// Un mot présent en tant que MOT (pas au milieu d'un autre).
const has = (text, words) => {
  const t = ` ${text} `;
  return words.some((w) => t.includes(` ${w} `));
};

// ======================================================================
//  Le rire n'est pas un message
// ======================================================================
// « MDRRRR », « ahahah », « jss mort 😭 » : ce n'est pas une prise de parole,
// c'est une RÉACTION. Personne, dans une vraie conversation, ne répond à
// quelqu'un qui rit — on enchaîne, ou on se tait.
//
// Or c'était le cas le plus fréquent chez nous : le bot sort une vanne, trois
// personnes répondent « mdrrr » EN CITANT SON MESSAGE, et il repart pour trois
// réponses. Résultat : il commente les rires qu'il vient de provoquer, ce qui
// est à la fois pénible et le plus sûr moyen de casser la blague qui venait de
// marcher.
//
// D'où cette détection, volontairement STRICTE : le message doit être
// ENTIÈREMENT fait de rire (mots de rire, ponctuation, emojis de rire) pour
// être ignoré. « mdr mais t'as vu le prix » contient une vraie phrase, il
// répond.

// Les mots de rire, avec leurs allongements (« mdrrrrr », « ahahahah »). On
// écrit les motifs plutôt qu'une liste : personne n'écrit le même nombre de r.
const LAUGH_WORD = [
  /^m+d+r+s?$/, // mdr, mdrrr, mdrs
  /^p+t+d+r+s?$/, // ptdr
  /^l+o+l+$/,
  /^lmao+$/,
  /^x+d+$/,
  /^j+p+p+$/, // jpp
  /^(a?h+[aeu]+)+h*$/, // ahah, hahaha, hihi, hehe, ahahah
  /^k+e+k+w*$/, // kek, kekw
  /^r+i+p+$/,
  // « jss mooort », « je suis morte », « jpleure » : la façon la plus courante
  // de dire qu'on a ri, et elle ne contient aucun « mdr ». Les voyelles
  // allongées sont dans le motif, personne n'écrit le même nombre de o.
  /^m+o+r+t+e?s?$/,
  /^j?p+l+e+u+r+e*$/,
  /^j?r+i+g+o+l+e*$/,
  /^decede+e?$/,
];

// Ce qui accompagne le rire sans rien ajouter : « jss mort frr », « mdr trop
// drole gros ». Ces mots-là ne comptent pas comme du contenu.
const LAUGH_FILLER = new Set([
  "je", "j", "jss", "jsuis", "jsui", "chui", "suis", "on", "est",
  "mdrt", "ri", "de", "rire",
  "trop", "drole", "marrant", "grave", "vrai", "vraiment", "la", "putain", "ptn",
  "frr", "frere", "gros", "wsh", "oe", "ouais", "nan", "non", "mais", "meme",
  "excellent", "enorme", "genial",
]);

// Les emojis qui ne veulent dire que « j'ai ri ». Un 🤡 ou un 🫵 seul, en
// revanche, est une vraie réplique — il a le droit de rebondir dessus.
const LAUGH_EMOJI = /^[\s😂🤣💀😭😹🥲😅😆🙃🤪⚰️🪦☠️!?.…]*$/u;

// Le message n'est-il QUE du rire ? Utilisé avant toute réponse (Discord comme
// messagerie du site) : si oui, le bot ne dit rien du tout.
export function isJustLaughing(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;

  // Que des emojis de rire (et de la ponctuation) : c'est un rire.
  if (LAUGH_EMOJI.test(raw)) return true;

  const t = norm(raw);
  if (!t) return false;

  const words = t.split(" ");
  // Au-delà d'une poignée de mots, ce n'est plus un rire mais une phrase qui
  // commence par un rire.
  if (words.length > 6) return false;

  let laughs = 0;
  for (const w of words) {
    if (LAUGH_WORD.some((re) => re.test(w))) {
      laughs += 1;
      continue;
    }
    if (!LAUGH_FILLER.has(w)) return false;
  }
  // Il faut au moins un vrai rire : « ouais non » n'est pas drôle, c'est une
  // réponse, et elle mérite qu'on lui réponde.
  return laughs > 0;
}

// ======================================================================
//  Les vraies questions
// ======================================================================
// L'autre gros défaut relevé : on lui demande son âge, il répond « jsp mais tu
// fais pitié ». C'est drôle une fois, et au bout de trois fois on comprend
// qu'il ne répond JAMAIS à rien — donc qu'on ne peut pas discuter avec lui.
//
// Repérer la question ici, en amont du modèle, plutôt que de laisser le prompt
// s'en charger : le modèle ne « voit » une question que si on lui dit qu'il
// vient d'en recevoir une, et une consigne générale (« réponds aux questions »)
// se fait écraser par les dix lignes qui lui demandent d'être odieux.
const QUESTION_STARTS = [
  "qui", "que", "quoi", "quest ce", "qu est ce", "c quoi", "cest quoi", "c koi",
  "ct quoi", "comment", "pourquoi", "pk", "pq", "quel", "quelle", "quels",
  "quelles", "combien", "cb", "quand", "ou est", "ou t", "est ce que", "es ce que",
  "tu penses", "tu pense", "t davis", "ton avis", "tu prefere", "tu preferes",
  "tu connais", "tu joue", "tu joues", "tu fais", "tu as", "t as", "ta quel",
  "tas quel", "tu crois", "tu veux", "tu sais", "dis moi", "explique", "raconte",
  "cetait quoi", "ct koi",
];

// En français parlé, le mot interrogatif finit souvent la phrase : « tu vis
// où », « t'as fait quoi », « ça coûte combien ». Sans ce second test, la
// moitié des questions du salon passeraient pour des affirmations.
const QUESTION_ENDS = [
  "ou", "quoi", "koi", "comment", "combien", "cb", "quand", "pk", "pq",
  "pourquoi", "qui", "non", "nn",
];

// Une vraie question : un point d'interrogation, ou une tournure interrogative
// en tête ou en fin de phrase (le point d'interrogation se perd très souvent
// en SMS).
export function isRealQuestion(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length < 3) return false;
  if (isJustLaughing(raw)) return false;
  if (raw.includes("?")) return true;
  const t = norm(raw);
  if (QUESTION_STARTS.some((q) => t === q || t.startsWith(`${q} `))) return true;
  // « … non » / « … nn » ne compte qu'avec un « tu » devant : sinon « ah bah
  // non » deviendrait une question.
  // « jsp où », « je sais pas quoi faire » : la tournure interrogative est là,
  // mais c'est un aveu d'ignorance, pas une question posée.
  if (/^(jsp|je sais pas|jss? sais pas|aucune idee)\b/.test(t)) return false;
  const words = t.split(" ");
  const last = words[words.length - 1];
  if (!QUESTION_ENDS.includes(last) || words.length < 3) return false;
  if (last === "non" || last === "nn") return /\bt(u|as|es)?\b/.test(t);
  return true;
}

// ------------------------------------------------------------------
//  Les familles de déclencheurs
// ------------------------------------------------------------------
const TRIGGERS = [
  {
    key: "tg",
    chance: 0.5,
    words: ["tg", "ta gueule", "ta geule", "ta guele", "ferme la", "chut"],
    replies: [
      "toi meme",
      "mais tg toi",
      "mdrrrr calmos",
      "c a moi que tu dis tg ?",
      "apres tout ce que jai fait pour toi",
      "generation de fragile",
      "pk tu clc comme ca frr",
      "t tarpin genant",
      "relation toxique a ce que je vois",
      "jparle si je veux dabord",
      "toi ftg parle mieux",
      "chaque fois tu parle tu fais laguer le serveur",
    ],
  },
  {
    key: "hello",
    chance: 0.35,
    words: ["salut", "bonjour", "hey", "coucou", "slt", "bonsoir", "wsh", "yo"],
    replies: [
      "ouais salut",
      "on ta pas sonné",
      "slt (jtaime pas)",
      "encore toi",
      "bonjour a toi aussi glandu",
      "wsh",
      "ah non pas lui",
      "salut le boss (jrigole)",
      "tiens revoila le clown",
    ],
  },
  {
    key: "love",
    chance: 0.7,
    words: ["je taime", "jtaime", "jtm", "on taime", "jtmm", "je t aime"],
    replies: [
      "je taime aussi",
      "FRERE JE TAIME AUSSI",
      "fragile va",
      "je taime aussi mais en ami",
      "mon coeur est pris desolé",
      "pas de ca ici",
      "pk moi jai pas de copine",
      "personne maime",
      "...",
      "je suis jaloux",
      "jsp pk mais je taime pas",
      "ooooh... desolé pour tout a lheure",
    ],
  },
  {
    key: "quit",
    chance: 0.6,
    words: ["je quitte", "je me casse", "je pars", "jarrete tout", "jquitte"],
    replies: [
      "si tu pars je te ban",
      "moi aussi",
      "si tu quitte je quitte aussi",
      "bon debarras",
      "tu me laissera seul...? 🥹",
      "stp reste 😿",
      "si c'est ma faute je mexcuse",
      "reviens pas surtout",
      "ok a jamais",
    ],
  },
  {
    key: "insult",
    chance: 0.4,
    words: [
      "connard", "batard", "batârd", "abruti", "debile", "cretin", "clown",
      "nul", "naze", "bouffon", "fdp", "encule", "tocard", "cassos",
    ],
    replies: [
      "cest celui qui dit qui y est",
      "wow calme toi",
      "et ta mere elle va bien ?",
      "jvais le dire a mondher",
      "ok et alors",
      "tu te crois ou la",
      "jnote, tinquiete",
      "capture faite, jai des preuves",
      "mdr il senerve le petit",
      "dis le en face pour voir",
    ],
  },
  {
    key: "thanks",
    chance: 0.5,
    words: ["merci", "mrc", "thx", "gg", "bien joue"],
    replies: [
      "de rien (jai rien fait)",
      "ouais ouais",
      "cest normal jsuis le meilleur",
      "tu peux remercier mondher",
      "de rien le clochard",
      "jattendais mieux comme remerciement",
    ],
  },
];

// La réplique réflexe pour ce message, ou null. La PREMIÈRE famille qui
// correspond gagne — pas de cumul : deux réponses coup sur coup au même
// message, ça ne ressemble plus à quelqu'un qui parle.
export function banterFor(text) {
  const t = norm(text);
  if (!t || t.length > 120) return null; // un pavé n'est pas un réflexe
  for (const trig of TRIGGERS) {
    if (!has(t, trig.words)) continue;
    // Le tirage se fait APRÈS la correspondance : sinon un mot rare qui ne
    // sort qu'une fois par semaine ne se déclencherait quasiment jamais.
    return roll(trig.chance) ? rand(trig.replies) : null;
  }
  return null;
}

// ======================================================================
//  « silence » / « parle » — le faire taire dans un salon
// ======================================================================
// Une soupape indispensable dès qu'un bot s'invite tout seul : sans elle, la
// seule façon de le calmer pendant une conversation sérieuse est de l'expulser
// du serveur.
//
// MAIS IL NÉGOCIE, et c'est ce qui rend la commande amusante plutôt
// qu'administrative : une fois sur cinq il refuse, râle, et continue. Reprise
// telle quelle de l'ancien bot, où c'était une des blagues récurrentes.
const SILENCE_MS = 5 * 60 * 1000;
const OBEY_CHANCE = 0.8;

const REFUSALS = [
  "pourquoi...? 🥺",
  "et si je disais non ?",
  "jsuis pas dhumeur",
  "nn jai un truc a dire avant",
  "apres tout ce que jai fait pour vous",
  "ouais mais non",
  "jsuis en greve",
  "ok mais je te boude",
];

const OBEYS = [
  "ok jme tais 🤐",
  "bon ok. mais vous allez me regretter",
  "5 min et je reviens",
  "jvais bouder dans mon coin alors",
  "ta gagné pour cette fois",
];

const BACKS = [
  "jsuis de retour vous mavez manqué (nn)",
  "bon jen ai marre du silence",
  "MDR vous croyiez que jallais rester muet",
  "me revoila, remettez vous en",
];

// channelId -> instant de fin
const muted = new Map();

export const isMuted = (channelId) => {
  const until = muted.get(channelId);
  if (!until) return false;
  if (Date.now() > until) {
    muted.delete(channelId);
    return false;
  }
  return true;
};

// Traite « silence » / « parle ». Renvoie la phrase à envoyer, ou null si le
// message n'était pas une de ces deux commandes.
export function handleSilence(channelId, text) {
  const t = norm(text);

  if (t === "silence" || t === "tais toi" || t === "la ferme") {
    if (!roll(OBEY_CHANCE)) return rand(REFUSALS);
    muted.set(channelId, Date.now() + SILENCE_MS);
    return rand(OBEYS);
  }

  if (t === "parle" || t === "reviens") {
    if (!isMuted(channelId)) return null; // il n'était pas muet, rien à dire
    muted.delete(channelId);
    return rand(BACKS);
  }

  return null;
}
