import crypto from "node:crypto";

import GameTrivia from "../models/GameTrivia.js";
import { geminiJson, isGeminiConfigured } from "./gemini.js";

// ======================================================================
//  Le mode Trivia : les histoires derrière le jeu
// ======================================================================
//
// Une fiche de jeu dit ce que le jeu EST. Elle ne dit jamais qu'il a été fait
// par cinq personnes en une semaine, que tel personnage porte le nom du chien
// du réalisateur, ou d'où vient la scène de tribunal qu'on n'oublie pas. Ce
// sont pourtant CES choses-là qu'on raconte aux copains.
//
// On les demande donc à Gemini, une fois par jeu, et on les garde : le premier
// qui ouvre le mode Trivia paie l'appel, tous les autres lisent la base — même
// patron que les traductions (lib/gameText.js).
//
// ⚠️ LE MODÈLE PEUT INVENTER, et une anecdote inventée est pire qu'une
// anecdote absente : elle se raconte, elle se répète, elle devient vraie. Le
// prompt est donc écrit autour de cette peur — température basse, interdiction
// explicite des chiffres incertains, et consigne de rendre MOINS de faits
// plutôt que d'en broder un.

// Les émojis proposés sous chaque carte. Une palette FERMÉE, et courte : un
// clavier d'émojis complet transformerait un geste d'une seconde (« ça, c'est
// dingue ») en une recherche. Le serveur refuse tout ce qui n'est pas dedans.
export const TRIVIA_EMOJIS = ["🤯", "😂", "❤️", "👀", "🤔"];

// Combien de fois on accepte de redemander « encore » sur le même jeu. Un jeu
// n'a pas cinquante histoires vraies : au-delà, le modèle se met à broder, ce
// qui est exactement ce qu'on veut éviter.
const MAX_BATCHES = 3;
const BATCH_SIZE = 10;

// L'empreinte à laquelle s'accrochent les réactions. Sur le TEXTE, pas sur un
// rang : une fournée suivante ajoute des cartes sans renuméroter les anciennes,
// et les réactions déjà posées restent sur leur anecdote.
function factKey(text) {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
}

// Ce qu'on sait du jeu, mis à plat pour le prompt. Sans ce contexte, le modèle
// confond les épisodes d'une saga et raconte l'histoire du mauvais jeu.
function contextOf(g) {
  const lines = [];
  const year = g.first_release_date
    ? new Date(g.first_release_date * 1000).getFullYear()
    : null;
  if (year) lines.push(`Année de sortie : ${year}`);

  const devs = (g.involved_companies || [])
    .filter((c) => c.developer)
    .map((c) => c.company?.name)
    .filter(Boolean);
  if (devs.length) lines.push(`Développé par : ${devs.join(", ")}`);

  const platforms = (g.platforms || []).map((p) => p.name).filter(Boolean);
  if (platforms.length) lines.push(`Plateformes : ${platforms.slice(0, 8).join(", ")}`);

  const genres = (g.genres || []).map((x) => x.name).filter(Boolean);
  if (genres.length) lines.push(`Genres : ${genres.join(", ")}`);

  if (g.summary) lines.push(`Résumé : ${String(g.summary).slice(0, 600)}`);
  return lines.join("\n");
}

function prompt(name, g, known) {
  return [
    `Tu écris des anecdotes de coulisses sur le jeu vidéo « ${name} ».`,
    contextOf(g),
    "",
    `Donne jusqu'à ${BATCH_SIZE} anecdotes VRAIES et vérifiables sur CE jeu précis.`,
    "",
    "Ce qu'on cherche — les histoires qu'un joueur raconte à ses amis :",
    "- la fabrication : équipe minuscule, délai absurde, budget, moteur bricolé,",
    "  une fonctionnalité sauvée ou coupée la veille de la sortie ;",
    "- l'origine d'un personnage, d'un décor, d'une scène : ce dont l'auteur",
    "  s'est inspiré (son enfance, un fait divers, un autre jeu, un accident) ;",
    "- les easter eggs, les bugs devenus cultes, les doublages, les caméos ;",
    "- l'accueil : un flop devenu culte, une polémique, un record de speedrun ;",
    "- les détails rigolos et les petites bizarreries qu'on ne remarque pas en jouant.",
    "",
    "Réponds en JSON strict :",
    '{"faits":[{"titre":"…","texte":"…","categorie":"…","spoiler":false}]}',
    "",
    "Règles impératives :",
    '- "titre" : 3 à 7 mots, accrocheur, sans point final.',
    '- "texte" : 1 à 3 phrases en français, ton complice de joueur, 400 caractères maximum.',
    '- "categorie" : exactement l\'une de "creation", "coulisses", "personnage",',
    '  "easter-egg", "record", "anecdote".',
    '- "spoiler" : true dès que l\'anecdote dévoile quoi que ce soit de l\'histoire —',
    "  une révélation, un retournement, la fin, la mort d'un personnage, un boss final.",
    "  Dans le doute, mets true : une carte cachée pour rien se retourne d'un doigt,",
    "  une fin gâchée ne se rattrape pas.",
    "- UNIQUEMENT des faits dont tu es certain. Aucun chiffre inventé (budget, ventes,",
    "  taille d'équipe, durée de développement) : s'il y a le moindre doute sur un",
    "  nombre, écris la phrase sans le nombre.",
    "- Ne paraphrase pas le résumé et ne raconte pas le scénario : ce ne sont pas",
    "  des anecdotes, c'est la fiche du jeu, qui est déjà affichée à côté.",
    "- Si tu ne connais pas assez ce jeu, renvoie moins d'anecdotes, ou une liste",
    "  vide. Mieux vaut trois vraies que dix brodées.",
    known.length
      ? `- Ne redis pas ce qui a déjà été raconté :\n${known.map((t) => `  · ${t}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const TAGS = new Set([
  "creation",
  "coulisses",
  "personnage",
  "easter-egg",
  "record",
  "anecdote",
]);

// ----------------------------------------------------------------------
//  L'écriture est NON BLOQUANTE
// ----------------------------------------------------------------------
// Gemini met dix à trente secondes à rendre dix anecdotes ; le mobile, lui,
// coupe ses appels à vingt (cf. mobile/src/lib/api.js). Une route qui attend
// la fournée répondrait donc « le serveur met trop de temps » sur un travail
// qui, lui, aboutit — et le joueur retenterait par-dessus.
//
// La route rend donc TOUT DE SUITE ce qu'elle a, avec un drapeau « ça
// travaille » ; l'écran affiche son attente et redemande toutes les deux
// secondes. Même choix que l'anecdote du mot du jour (cf. routes/mot.js).

// Une fournée en cours, par jeu. Sans ce verrou, trois joueurs qui ouvrent le
// mode Trivia du même jeu à la même seconde partent en trois appels Gemini
// concurrents — que l'API gratuite rejette tous les trois.
const inflight = new Map();

// La dernière panne, par jeu, avec son heure. Elle sert à DEUX choses : dire à
// l'écran pourquoi il n'a rien reçu, et empêcher la boucle de relance — sans
// elle, chaque sondage repartirait en appel, et un jeu qui fait échouer Gemini
// le rappellerait toutes les deux secondes.
const failures = new Map();
const RETRY_AFTER = 30_000;

function startBatch(gameId, game, doc) {
  const lock = String(gameId);
  if (inflight.has(lock)) return;
  failures.delete(lock);

  const run = (async () => {
    const name = game?.name || doc?.gameName || "";
    const known = (doc?.facts || []).map((f) => f.title || f.text.slice(0, 60));

    const out = await geminiJson(prompt(name, game || {}, known), {
      timeoutMs: 40_000,
      // Une anecdote factuelle ne veut pas d'imagination (cf. lib/gameText.js).
      temperature: 0.5,
    });

    const seen = new Set((doc?.facts || []).map((f) => f.key));
    const fresh = [];
    for (const raw of Array.isArray(out?.faits) ? out.faits : []) {
      const text = String(raw?.texte || "").trim().slice(0, 400);
      if (text.length < 40) continue; // une demi-phrase n'est pas une anecdote
      const key = factKey(text);
      if (seen.has(key)) continue;
      seen.add(key);
      const tag = String(raw?.categorie || "").trim();
      fresh.push({
        key,
        title: String(raw?.titre || "").trim().slice(0, 120),
        text,
        tag: TAGS.has(tag) ? tag : "anecdote",
        // Absent = on suppose le pire : une carte cachée pour rien se
        // retourne d'un doigt, une fin gâchée ne se rattrape pas.
        spoiler: raw?.spoiler !== false,
        reactions: [],
      });
    }

    // On compte la fournée MÊME VIDE : un jeu que le modèle ne connaît pas ne
    // doit pas relancer un appel à chaque ouverture de sa fiche.
    return GameTrivia.findOneAndUpdate(
      { gameId },
      {
        $set: { gameName: name },
        $push: { facts: { $each: fresh } },
        $inc: { batches: 1 },
      },
      { new: true, upsert: true }
    );
  })()
    .catch((err) => {
      console.error(`trivia ${gameId} :`, err.message);
      failures.set(lock, { message: err.message, at: Date.now() });
    })
    .finally(() => inflight.delete(lock));

  inflight.set(lock, run);
}

/**
 * Ce qu'on a des anecdotes de ce jeu, en lançant leur écriture au besoin.
 *
 * Rend `{ doc, pending, error }` sans jamais attendre l'IA : `pending` dit à
 * l'écran de redemander dans deux secondes.
 *
 *   • `more`  : une fournée SUPPLÉMENTAIRE (le bouton « encore » au bout du
 *     paquet) plutôt que de rendre le document tel quel ;
 *   • `retry` : passe outre le délai de garde après une panne — c'est le
 *     bouton « réessayer », donc un geste explicite, pas un sondage.
 */
export async function ensureTrivia(gameId, game, { more = false, retry = false } = {}) {
  const doc = await GameTrivia.findOne({ gameId });
  const lock = String(gameId);
  const batches = doc?.batches || 0;

  // Une fournée déjà écrite ne se réécrit pas. Un document à zéro anecdote
  // compte aussi : le modèle ne connaît pas ce jeu, et le rappeler à chaque
  // ouverture de sa fiche brûlerait le quota pour la même liste vide.
  const wanted = more ? batches < MAX_BATCHES : batches === 0;
  if (!wanted) return { doc, pending: inflight.has(lock), error: null };

  if (!isGeminiConfigured()) {
    if (doc) return { doc, pending: false, error: null };
    const err = new Error("Les anecdotes sont indisponibles pour le moment.");
    err.status = 503;
    throw err;
  }

  const failed = failures.get(lock);
  if (failed && !retry && Date.now() - failed.at < RETRY_AFTER) {
    return { doc, pending: false, error: failed.message };
  }

  startBatch(gameId, game, doc);
  return { doc, pending: true, error: null };
}

/** Le paquet tel que le mobile le lit : compteurs agrégés, ma réaction à part. */
export function serializeTrivia(doc, userId) {
  const me = String(userId || "");
  const facts = (doc?.facts || []).map((f) => {
    const counts = {};
    let mine = null;
    for (const r of f.reactions || []) {
      counts[r.emoji] = (counts[r.emoji] || 0) + 1;
      if (String(r.user) === me) mine = r.emoji;
    }
    return {
      key: f.key,
      title: f.title || "",
      text: f.text,
      tag: f.tag || "anecdote",
      spoiler: !!f.spoiler,
      counts,
      mine,
    };
  });
  return {
    facts,
    // De quoi savoir s'il reste des fournées à demander au bout du paquet.
    canAskMore: (doc?.batches || 0) < MAX_BATCHES,
  };
}

/**
 * Pose (ou retire) ma réaction sur une anecdote.
 *
 * Une seule par personne et par carte : recliquer le même emoji l'enlève, en
 * cliquer un autre le remplace — c'est ce que font déjà les réactions d'un
 * avis, et deux grammaires différentes pour le même geste, ça ne va pas.
 */
export async function reactToFact(gameId, key, emoji, userId) {
  if (emoji && !TRIVIA_EMOJIS.includes(emoji)) {
    const err = new Error("Émoji non pris en charge.");
    err.status = 400;
    throw err;
  }

  const doc = await GameTrivia.findOne({ gameId });
  const fact = doc?.facts?.find((f) => f.key === key);
  if (!fact) {
    const err = new Error("Anecdote introuvable.");
    err.status = 404;
    throw err;
  }

  const me = String(userId);
  const had = fact.reactions.find((r) => String(r.user) === me);
  fact.reactions = fact.reactions.filter((r) => String(r.user) !== me);
  // Le même emoji une deuxième fois, c'est un retrait — pas un doublon.
  if (emoji && had?.emoji !== emoji) fact.reactions.push({ user: userId, emoji });

  await doc.save();
  return doc;
}
