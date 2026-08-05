import GameText from "../models/GameText.js";
import { geminiJson, isGeminiConfigured } from "./gemini.js";

// Traduction FR à la demande du résumé (« À propos ») et du scénario d'un jeu.
// Le texte source vient d'IGDB en anglais ; on le traduit une seule fois via
// Gemini puis on le stocke dans GameText (partagé entre tous les utilisateurs).
// On garde le texte EN source pour n'utiliser le cache que s'il correspond
// toujours au texte IGDB courant (invalidation si IGDB met à jour la fiche).

// Renvoie la traduction déjà en cache pour ce jeu, mais uniquement pour les
// champs dont la source EN correspond encore au texte IGDB actuel. Aucun appel
// réseau : juste une lecture Mongo. { summaryFr, storylineFr } (null si absent).
export async function getCachedTranslation(gameId, summaryEn, storylineEn) {
  const doc = await GameText.findOne({ gameId }).lean();
  if (!doc) return { summaryFr: null, storylineFr: null };
  return {
    summaryFr: summaryEn && doc.summaryEn === summaryEn ? doc.summaryFr : null,
    storylineFr:
      storylineEn && doc.storylineEn === storylineEn ? doc.storylineFr : null,
  };
}

// Traduit (ou relit en cache) le résumé et le scénario, met à jour GameText et
// renvoie { summaryFr, storylineFr }. Ne rappelle Gemini que pour les champs
// pas encore traduits (ou dont la source a changé). Best-effort par champ.
export async function translateGameText(gameId, summaryEn, storylineEn) {
  if (!isGeminiConfigured()) {
    const err = new Error("Traduction indisponible (Gemini non configuré).");
    err.status = 503;
    throw err;
  }

  const cached = await getCachedTranslation(gameId, summaryEn, storylineEn);
  const needSummary = Boolean(summaryEn) && !cached.summaryFr;
  const needStoryline = Boolean(storylineEn) && !cached.storylineFr;

  let summaryFr = cached.summaryFr;
  let storylineFr = cached.storylineFr;

  if (needSummary || needStoryline) {
    const out = await translateParts({
      summary: needSummary ? summaryEn : null,
      storyline: needStoryline ? storylineEn : null,
    });
    if (needSummary) summaryFr = out.summary || summaryFr;
    if (needStoryline) storylineFr = out.storyline || storylineFr;

    const set = {};
    if (needSummary) {
      set.summaryEn = summaryEn;
      set.summaryFr = summaryFr;
    }
    if (needStoryline) {
      set.storylineEn = storylineEn;
      set.storylineFr = storylineFr;
    }
    if (Object.keys(set).length) {
      await GameText.updateOne({ gameId }, { $set: set }, { upsert: true });
    }
  }

  return { summaryFr, storylineFr };
}

// Un seul appel Gemini pour les deux textes (économise le quota). On demande du
// JSON strict ; la clé n'est renvoyée que si on l'a fournie.
async function translateParts({ summary, storyline }) {
  const blocks = [];
  if (summary) blocks.push(`SUMMARY:\n${summary}`);
  if (storyline) blocks.push(`STORYLINE:\n${storyline}`);

  const prompt = `Tu es traducteur professionnel de jeux vidéo. Traduis en français les textes ci-dessous, fidèlement et dans un français naturel et fluide. Garde les noms propres (personnages, studios, licences) tels quels. Ne résume pas, ne commente pas, ne rajoute rien.

Réponds en JSON avec uniquement les clés fournies : ${
    summary && storyline ? `"summary" et "storyline"` : summary ? `"summary"` : `"storyline"`
  }.

${blocks.join("\n\n")}`;

  const out = await geminiJson(prompt, { timeoutMs: 30_000, temperature: 0.2 });
  return {
    summary: typeof out?.summary === "string" ? out.summary.trim() : null,
    storyline: typeof out?.storyline === "string" ? out.storyline.trim() : null,
  };
}
