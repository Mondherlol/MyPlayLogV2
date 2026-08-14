// ======================================================================
//  Client Groq minimal (API compatible OpenAI, sans SDK)
// ======================================================================
// Clé gratuite : https://console.groq.com/keys → GROQ_API_KEY dans server/.env.
//
// POURQUOI UN DEUXIÈME FOURNISSEUR alors que le site tourne déjà sur Gemini :
// ce n'est pas une question de goût, c'est une question de TAILLE DE MODÈLE. Le
// bot du site tourne sur un « flash lite » (le plus petit, choisi pour le
// quota) ; l'ancien bot du serveur Discord, celui que tout le monde trouvait
// drôle, tournait sur un Llama 70B. Sur ce registre précis — l'argot, les
// fautes volontaires, le second degré, la vanne qui rebondit — un 70B est
// simplement d'une autre catégorie, et aucun réglage de prompt ne rattrape
// l'écart.
//
// Groq est gratuit, très rapide (quelques centaines de ms), et sa limite est
// large. S'il n'est pas configuré, tout continue de marcher sur Gemini : c'est
// un bonus, jamais une dépendance (voir chatText, lib/bot.js).

const API = "https://api.groq.com/openai/v1/chat/completions";

export function isGroqConfigured() {
  return Boolean(process.env.GROQ_API_KEY);
}

// Renvoie du TEXTE BRUT, et pas du JSON comme le client Gemini.
//
// C'est délibéré : forcer un modèle à emballer sa réponse dans du JSON le rend
// mesurablement plus scolaire (il « rédige » au lieu de balancer), et on veut
// exactement l'inverse ici. Une réplique de trois mots avec des fautes n'a
// besoin d'aucune structure.
export async function groqText(
  system,
  user,
  { temperature = 1.15, maxTokens = 120, timeoutMs = 12_000 } = {}
) {
  if (!isGroqConfigured()) {
    const err = new Error("GROQ_API_KEY manquant.");
    err.status = 503;
    throw err;
  }

  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: maxTokens,
      top_p: 0.95,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Erreur Groq (${res.status}). ${text.slice(0, 200)}`.trim());
    err.status = res.status;
    throw err;
  }

  const json = await res.json();
  return String(json.choices?.[0]?.message?.content || "").trim();
}
