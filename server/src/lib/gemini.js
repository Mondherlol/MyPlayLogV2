// Client Gemini minimal (API REST generateContent, sans SDK).
// Clé gratuite : https://aistudio.google.com/apikey → GEMINI_API_KEY dans
// server/.env. Le modèle est surchargeable via GEMINI_MODEL ; l'alias
// « gemini-flash-latest » pointe toujours vers le Flash stable le plus récent.

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

// Modèle de secours quand le principal est saturé (503 « high demand »),
// retiré (404) ou à court de quota (429, compté par modèle) : le Flash Lite
// est moins malin mais quasiment toujours disponible.
const FALLBACK_MODEL = "gemini-flash-lite-latest";

async function callModel(model, prompt, timeoutMs) {
  const res = await fetch(`${API_ROOT}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": process.env.GEMINI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        // Un peu de température : deux fournées avec les mêmes jeux de départ
        // doivent pouvoir surprendre différemment.
        temperature: 0.9,
        responseMimeType: "application/json",
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      res.status === 429
        ? `Quota Gemini atteint (${model}) — réessaie dans une minute.`
        : `Erreur Gemini (${res.status}, ${model}). ${text.slice(0, 300)}`.trim()
    );
    err.status = res.status;
    throw err;
  }

  const json = await res.json();
  const text = (json.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("");
  return JSON.parse(text);
}

// Envoie un prompt et renvoie la réponse parsée en JSON.
// `responseMimeType: application/json` force le modèle à ne produire QUE du
// JSON valide (pas de prose ni de ```json autour). Si le modèle principal
// est indisponible (503/404/429), on retente une fois sur le modèle de secours.
export async function geminiJson(prompt, { timeoutMs = 25_000 } = {}) {
  if (!isGeminiConfigured()) {
    const err = new Error("GEMINI_API_KEY manquant dans server/.env.");
    err.status = 503;
    throw err;
  }
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";

  try {
    return await callModel(model, prompt, timeoutMs);
  } catch (err) {
    const retryable = [429, 404, 503].includes(err.status);
    if (!retryable || model === FALLBACK_MODEL) throw err;
    console.warn(
      `gemini: ${model} indisponible (${err.status}), repli sur ${FALLBACK_MODEL}`
    );
    return callModel(FALLBACK_MODEL, prompt, timeoutMs);
  }
}
