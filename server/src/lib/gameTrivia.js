import crypto from "node:crypto";

import GameTrivia from "../models/GameTrivia.js";
import { geminiJson, isGeminiConfigured } from "./gemini.js";
import { collectLore, originalGame } from "./gameLore.js";

// ======================================================================
//  Le mode Trivia : les histoires derrière le jeu
// ======================================================================
//
// Une fiche de jeu dit ce que le jeu EST. Elle ne dit jamais qu'il a été fait
// par cinq personnes en une semaine, que tel personnage porte le nom du chien
// du réalisateur, ou d'où vient la scène de tribunal qu'on n'oublie pas. Ce
// sont pourtant CES choses-là qu'on raconte aux copains.
//
// ⚠️ LE MODÈLE NE RACONTE PLUS DE MÉMOIRE. Il DÉCOUPE du texte écrit par des
// humains — Wikipédia, Fandom, MobyGames, Giant Bomb (cf. lib/gameLore.js).
// C'est toute la différence entre résumer et inventer, et elle est invisible à
// la lecture : une anecdote fausse est aussi bien écrite qu'une vraie. Quand
// aucune source ne répond, on le DIT au modèle, et il n'a plus le droit de
// donner que ce dont il est absolument certain.
//
// Écrit une fois par jeu, puis partagé par tout le monde — même patron que les
// traductions (lib/gameText.js).

// Les émojis proposés sous chaque carte, avec leur intitulé côté mobile
// (« Amusé », « J'adore »…). Une palette FERMÉE et courte : un clavier complet
// transformerait un geste d'une seconde en une recherche. Le serveur refuse
// tout ce qui n'est pas dedans.
export const TRIVIA_EMOJIS = ["😂", "❤️", "🤯", "🤓", "😴"];

// Une seule fournée par jeu. Il y avait un bouton « encore » au bout du
// paquet : il partait chercher une deuxième fournée sur les MÊMES sources, et
// tout ce qu'elles avaient de bon était déjà pris — la suite ne pouvait donc
// venir que de l'imagination du modèle. On demande large une fois, et c'est
// tout.
const BATCH_SIZE = 14;

// L'empreinte à laquelle s'accrochent les réactions. Sur le TEXTE, pas sur un
// rang : elle survit à tout ce qui pourrait réordonner le paquet.
function factKey(text) {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
}

const IMG = "https://images.igdb.com/igdb/image/upload";

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

  if (g.summary) lines.push(`Résumé : ${String(g.summary).slice(0, 500)}`);
  return lines.join("\n");
}

// La consigne de fiabilité change du tout au tout selon qu'on a des sources ou
// non : avec, « n'écris que ce qui est dans le texte » ; sans, « n'écris que ce
// dont tu es certain ». La deuxième est bien plus faible — d'où l'effort de
// lib/gameLore.js pour ne presque jamais y arriver.
function rulesFor(lore) {
  if (lore.length) {
    return [
      "⚠️ RÈGLE ABSOLUE : chaque anecdote doit se trouver DANS LES SOURCES",
      "ci-dessus. Tu ne racontes pas ce que tu sais du jeu, tu découpes ce qui",
      "est écrit. Rien dans les sources = rien sur la carte.",
      '- "source" : le nom exact de la source d\'où vient l\'anecdote, tel qu\'il',
      `  est écrit dans les blocs (${lore.map((l) => l.label).join(", ")}).`,
      "- Fandom est la source la moins sûre : de la spéculation de fan y passe",
      "  pour un fait. N'en prends que ce qui est vérifiable et concret.",
      "- Aucun chiffre qui ne soit pas écrit noir sur blanc dans les sources.",
    ];
  }
  return [
    "⚠️ AUCUNE SOURCE N'A RÉPONDU sur ce jeu. Tu travailles donc de mémoire, et",
    "c'est le cas dangereux : n'écris QUE ce dont tu es absolument certain.",
    "Aucun chiffre inventé (budget, ventes, taille d'équipe, durée de",
    "développement) : au moindre doute sur un nombre, écris la phrase sans lui.",
    "Trois anecdotes sûres valent mieux que dix brodées — et zéro vaut mieux",
    "que trois inventées.",
    '- "source" : null.',
  ];
}

function prompt(name, g, lore) {
  const blocks = lore.map((l) => `=== SOURCE : ${l.label} ===\n${l.text}`).join("\n\n");

  return [
    `Tu écris des anecdotes de coulisses sur le jeu vidéo « ${name} ».`,
    contextOf(g),
    "",
    blocks ? `${blocks}\n` : "",
    `Donne jusqu'à ${BATCH_SIZE} anecdotes sur CE jeu.`,
    "",
    "Ce qu'on cherche — les histoires qu'un joueur raconte à ses amis :",
    "- la fabrication : équipe minuscule, délai absurde, budget, moteur bricolé,",
    "  une fonctionnalité sauvée ou coupée la veille de la sortie ;",
    "- l'origine d'un personnage, d'un décor, d'une scène : ce dont l'auteur",
    "  s'est inspiré (son enfance, un fait divers, un autre jeu, un accident) ;",
    "- les easter eggs, les bugs devenus cultes, les doublages, les caméos ;",
    "- l'accueil : un flop devenu culte, une polémique, un record de speedrun ;",
    "- les détails rigolos qu'on ne remarque pas en jouant.",
    "",
    "Réponds en JSON strict :",
    '{"faits":[{"titre":"…","texte":"…","categorie":"…","spoiler":false,',
    '  "illustration":"…","source":"…"}]}',
    "",
    "Règles impératives :",
    ...rulesFor(lore),
    '- "titre" : 3 à 7 mots, accrocheur, sans point final.',
    '- "texte" : 2 à 4 phrases en français, ton complice de joueur, 420 caractères',
    "  maximum. METS EN VALEUR avec des doubles astérisques les deux ou trois",
    "  éclats de l'anecdote — le nom propre, le chiffre, la chute : **Shigeru",
    "  Miyamoto**, **six semaines**, **le chien du réalisateur**. Deux ou trois",
    "  par carte, pas davantage : tout souligner, c'est ne rien souligner.",
    '- "categorie" : exactement l\'une de "creation", "coulisses", "personnage",',
    '  "easter-egg", "record", "anecdote".',
    '- "spoiler" : true dès que l\'anecdote dévoile quoi que ce soit de l\'histoire —',
    "  une révélation, un retournement, la fin, la mort d'un personnage, un boss",
    "  final. Dans le doute, mets true : une carte cachée pour rien se retourne",
    "  d'un doigt, une fin gâchée ne se rattrape pas.",
    '- "illustration" : de QUOI on pourrait montrer une photo pour illustrer —',
    "  une personne réelle (« Hideo Kojima »), un lieu, un objet, une console, une",
    "  œuvre citée. Écris-le comme un titre d'article d'encyclopédie, sans phrase",
    "  autour. null si l'anecdote ne cite rien de montrable : une image qui ne",
    "  correspond pas à ce qu'on lit est pire que pas d'image du tout.",
    "- Ne paraphrase pas le résumé et ne raconte pas le scénario : ce n'est pas",
    "  une anecdote, c'est la fiche du jeu, déjà affichée à côté.",
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
//  L'image d'une carte
// ----------------------------------------------------------------------
// Le modèle dit ce qu'il faudrait montrer (« Hideo Kojima », « la Dreamcast ») ;
// on va chercher la photo sur Wikipédia, avec son lien — une image reprise sans
// crédit ni source, ce n'est pas une illustration, c'est un emprunt.
//
// Rien trouvé ? Une capture du jeu, prise à tour de rôle pour que deux cartes
// voisines ne se ressemblent pas. Une carte sans image reste une bonne carte,
// mais un paquet sans aucune image est un mur de texte.
async function wikiImage(query) {
  for (const lang of ["fr", "en"]) {
    try {
      const url =
        `https://${lang}.wikipedia.org/w/api.php?action=query&format=json` +
        `&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=1` +
        `&prop=pageimages|info&piprop=thumbnail&pithumbsize=900&inprop=url`;
      const res = await fetch(url, {
        headers: { "User-Agent": "MyPlayLog/1.0 (trivia)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const page = Object.values(json?.query?.pages || {})[0];
      if (page?.thumbnail?.source) {
        return {
          url: page.thumbnail.source,
          credit: `Wikipédia — ${page.title}`,
          link: page.fullurl || null,
        };
      }
    } catch {
      /* une image manquante n'est pas une panne */
    }
  }
  return null;
}

// Les captures et artworks du jeu, en grand : le filet de sécurité.
function gameShots(g) {
  return [
    ...(g.artworks || []).map((a) => a.image_id),
    ...(g.screenshots || []).map((s) => s.image_id),
  ]
    .filter(Boolean)
    .map((id) => `${IMG}/t_1080p/${id}.jpg`);
}

async function illustrate(facts, g) {
  const shots = gameShots(g);
  let next = 0;

  for (const fact of facts) {
    if (fact.query) {
      // eslint-disable-next-line no-await-in-loop -- en série exprès : une
      // rafale de quinze requêtes vers Wikipédia se ferait jeter.
      fact.image = await wikiImage(fact.query);
    }
    if (!fact.image && shots.length) {
      fact.image = { url: shots[next % shots.length], credit: null, link: null };
      next += 1;
    }
    delete fact.query;
  }
  return facts;
}

// ----------------------------------------------------------------------
//  L'écriture est NON BLOQUANTE
// ----------------------------------------------------------------------
// Les sources mettent dix secondes à répondre, Gemini dix à trente, les images
// encore dix ; le mobile, lui, coupe ses appels à vingt (cf.
// mobile/src/lib/api.js). Une route qui attend la fournée répondrait donc « le
// serveur met trop de temps » sur un travail qui, lui, aboutit.
//
// La route rend donc TOUT DE SUITE ce qu'elle a, avec un drapeau « ça
// travaille » ; l'écran affiche son attente et redemande toutes les deux
// secondes. Même choix que l'anecdote du mot du jour (cf. routes/mot.js).

// Une fournée en cours, par jeu. Sans ce verrou, trois joueurs qui ouvrent le
// mode Trivia du même jeu à la même seconde partent en trois fournées
// concurrentes — que l'API gratuite de Gemini rejette toutes les trois.
const inflight = new Map();

// La dernière panne, par jeu, avec son heure. Elle sert à DEUX choses : dire à
// l'écran pourquoi il n'a rien reçu, et empêcher la boucle de relance — sans
// elle, chaque sondage repartirait en fournée.
const failures = new Map();
const RETRY_AFTER = 30_000;

function startBatch(gameId, game) {
  const lock = String(gameId);
  if (inflight.has(lock)) return;
  failures.delete(lock);

  const run = (async () => {
    // ⚠️ LES ANECDOTES SONT CELLES DU JEU SOUCHE. Ouvrir un remake ou une
    // édition « Definitive » et recevoir les coulisses de l'original est
    // voulu : c'est là qu'est l'histoire (cf. lib/gameLore.js).
    const og = await originalGame(game);
    const name = og.name || game.name || "";
    const lore = await collectLore(og);

    const out = await geminiJson(prompt(name, og, lore), {
      timeoutMs: 60_000,
      // Un découpage de sources ne veut pas d'imagination (cf. lib/gameText.js).
      temperature: lore.length ? 0.35 : 0.5,
    });

    const byLabel = new Map(lore.map((l) => [l.label.toLowerCase(), l]));
    const seen = new Set();
    const fresh = [];

    for (const raw of Array.isArray(out?.faits) ? out.faits : []) {
      const text = String(raw?.texte || "").trim().slice(0, 460);
      if (text.length < 40) continue; // une demi-phrase n'est pas une anecdote
      const key = factKey(text);
      if (seen.has(key)) continue;
      seen.add(key);

      const tag = String(raw?.categorie || "").trim();
      const src = byLabel.get(String(raw?.source || "").trim().toLowerCase());
      const query = String(raw?.illustration || "").trim();

      fresh.push({
        key,
        title: String(raw?.titre || "").trim().slice(0, 120),
        text,
        tag: TAGS.has(tag) ? tag : "anecdote",
        // Absent = on suppose le pire : une carte cachée pour rien se
        // retourne d'un doigt, une fin gâchée ne se rattrape pas.
        spoiler: raw?.spoiler !== false,
        sourceLabel: src?.label || null,
        sourceUrl: src?.url || null,
        image: null,
        // Temporaire : `illustrate` s'en sert puis l'efface.
        query: query && query.toLowerCase() !== "null" ? query.slice(0, 90) : null,
        reactions: [],
      });
    }

    await illustrate(fresh, og);

    // On compte la fournée MÊME VIDE : un jeu sur lequel personne n'a rien
    // écrit ne doit pas relancer tout ce travail à chaque ouverture.
    return GameTrivia.findOneAndUpdate(
      { gameId },
      {
        $set: {
          gameName: game.name || name,
          originalId: og.id,
          originalName: name,
        },
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
 * Rend `{ doc, pending, error }` sans jamais attendre le travail : `pending`
 * dit à l'écran de redemander dans deux secondes. `retry` passe outre le délai
 * de garde après une panne — c'est le bouton « réessayer », donc un geste
 * explicite, pas un sondage.
 */
export async function ensureTrivia(gameId, game, { retry = false } = {}) {
  const doc = await GameTrivia.findOne({ gameId });
  const lock = String(gameId);

  // Une fournée déjà écrite ne se réécrit pas. Un document à zéro anecdote
  // compte aussi : personne n'a rien écrit sur ce jeu, et refaire le tour des
  // sources à chaque ouverture de sa fiche ne changerait rien.
  if (doc?.batches > 0) return { doc, pending: false, error: null };

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

  startBatch(gameId, game);
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
      image: f.image ? { url: f.image.url, credit: f.image.credit, link: f.image.link } : null,
      source: f.sourceLabel ? { label: f.sourceLabel, url: f.sourceUrl } : null,
      counts,
      mine,
    };
  });
  return {
    facts,
    // Le jeu sur lequel les anecdotes ont été cherchées, quand ce n'est pas
    // celui d'où l'on vient : l'écran le dit, sinon recevoir les coulisses de
    // 2005 sur la fiche du remake passe pour une erreur.
    original:
      doc?.originalId && doc.originalId !== doc.gameId
        ? { id: doc.originalId, name: doc.originalName }
        : null,
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
