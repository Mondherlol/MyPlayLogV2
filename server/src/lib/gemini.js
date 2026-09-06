// Client Gemini minimal (API REST generateContent, sans SDK).
// Clé gratuite : https://aistudio.google.com/apikey → GEMINI_API_KEY dans
// server/.env. Le modèle est surchargeable via GEMINI_MODEL ; l'alias
// « gemini-flash-latest » pointe toujours vers le Flash stable le plus récent.
//
// ----------------------------------------------------------------------
//  PLUSIEURS CLÉS, SI ON EN A
// ----------------------------------------------------------------------
// `GEMINI_API_KEYS` accepte une liste séparée par des virgules ; `GEMINI_API_KEY`
// (une seule) continue de marcher exactement comme avant.
//
// Le quota gratuit se compte PAR PROJET : deux clés issues de deux projets,
// c'est deux fois le débit. Ça ne sert à rien avec deux clés du même projet —
// elles partagent le même compteur.
//
// Quand une clé prend un 429, on la met AU FRAIS une minute et on passe à la
// suivante avec le même modèle : mieux vaut la même qualité sur une autre clé
// que le petit modèle sur une clé saturée.

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

function apiKeys() {
  const raw = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

export function isGeminiConfigured() {
  return apiKeys().length > 0;
}

// Les clés à court de quota, avec l'heure à laquelle on pourra les reprendre.
// La minute est le pas des quotas « par minute » de Gemini ; un quota
// journalier épuisé se retrouvera au frais toutes les minutes, ce qui est le
// comportement voulu — on retente, sans marteler.
const cooling = new Map();
const COOL_MS = 60_000;

// Tourniquet : on ne repart pas systématiquement de la première clé, sinon
// c'est toujours elle qui encaisse tout et les autres ne servent qu'en panne.
let turn = 0;

function nextKey(keys, tried) {
  const now = Date.now();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[(turn + i) % keys.length];
    if (tried.has(key)) continue;
    if ((cooling.get(key) || 0) > now) continue;
    turn = (turn + i + 1) % keys.length;
    return key;
  }
  // Toutes au frais ou déjà essayées : on rend la moins fraîche plutôt que de
  // renoncer — le quota s'est peut-être libéré avant l'heure qu'on avait notée.
  return keys.find((k) => !tried.has(k)) || null;
}

// Modèle de secours quand le principal est saturé (503 « high demand »),
// retiré (404) ou à court de quota (429, compté par modèle) : le Flash Lite
// est moins malin mais quasiment toujours disponible.
const FALLBACK_MODEL = "gemini-flash-lite-latest";

async function callModel(model, prompt, timeoutMs, temperature, apiKey) {
  const res = await fetch(`${API_ROOT}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        // Par défaut un peu de température : deux fournées avec les mêmes jeux
        // de départ doivent pouvoir surprendre différemment. Surchargeable :
        // une traduction, elle, veut rester fidèle (température basse).
        temperature,
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
  return parseLoose(text);
}

// ----------------------------------------------------------------------
//  Le JSON du modèle n'est pas toujours du JSON
// ----------------------------------------------------------------------
// `responseMimeType: application/json` est censé garantir une sortie propre,
// et il la garantit… la plupart du temps. Vu en vrai, dans les logs du bot :
// « Unexpected non-whitespace character after JSON at position 65 » — le
// modèle avait collé un deuxième objet (ou une phrase) derrière le premier.
// `JSON.parse` lève, l'appelant croit à une panne, et pour le bot ça se
// traduisait par un message perdu.
//
// On répare au lieu d'abandonner : on prend le PREMIER objet (ou tableau)
// complet du texte et on ignore ce qui traîne derrière. Le découpage compte
// les accolades en sautant ce qui est entre guillemets — sans ça, une accolade
// à l'intérieur d'une chaîne (« il a dit { » ) fausserait le compte.
function parseLoose(raw) {
  const text = String(raw || "").trim();
  try {
    return JSON.parse(text);
  } catch (err) {
    const cut = firstJson(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
    if (cut) {
      try {
        return JSON.parse(cut);
      } catch {
        /* on retombe sur l'erreur d'origine, plus parlante */
      }
    }
    err.message = `${err.message} — réponse: ${text.slice(0, 200)}`;
    throw err;
  }
}

function firstJson(text) {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Envoie un prompt et renvoie la réponse parsée en JSON.
// `responseMimeType: application/json` force le modèle à ne produire QUE du
// JSON valide (pas de prose ni de ```json autour). Si le modèle principal
// est indisponible (503/404/429), on retente une fois sur le modèle de secours.
// `model` : à surcharger quand un appelant a des besoins DIFFÉRENTS du reste du
// site. Le quota gratuit se compte PAR MODÈLE : un bavard (le bot, qui répond à
// chaque message) posé sur le même modèle que les Pépites ou les traductions
// leur mange leur journée. Le mettre sur le petit modèle, c'est autant de
// requêtes qui ne sont plus prises au gros — les deux compteurs sont séparés.
export async function geminiJson(
  prompt,
  { timeoutMs = 25_000, temperature = 0.9, model: forced = null } = {}
) {
  const keys = apiKeys();
  if (!keys.length) {
    const err = new Error("GEMINI_API_KEY manquant dans server/.env.");
    err.status = 503;
    throw err;
  }
  const model = forced || process.env.GEMINI_MODEL || "gemini-flash-latest";

  const tried = new Set();
  let last = null;

  // 1) Le modèle demandé, sur chaque clé encore disponible. Un 429 ne
  //    condamne QUE la clé : une autre a son propre compteur.
  while (tried.size < keys.length) {
    const key = nextKey(keys, tried);
    if (!key) break;
    tried.add(key);

    try {
      return await callModel(model, prompt, timeoutMs, temperature, key);
    } catch (err) {
      last = err;
      if (err.status === 429) {
        cooling.set(key, Date.now() + COOL_MS);
        if (keys.length > 1) {
          console.warn(`gemini: clé saturée (429), on passe à la suivante`);
          continue;
        }
      }
      // 404 / 503 : c'est le MODÈLE qui est en cause, pas la clé — changer de
      // clé n'y changerait rien, on descend d'un modèle.
      if ([404, 503, 429].includes(err.status)) break;
      throw err;
    }
  }

  // 2) Le modèle de secours : moins malin, mais quasiment toujours là.
  if (model !== FALLBACK_MODEL && [429, 404, 503].includes(last?.status)) {
    console.warn(
      `gemini: ${model} indisponible (${last.status}), repli sur ${FALLBACK_MODEL}`
    );
    const key = nextKey(keys, new Set()) || keys[0];
    return callModel(FALLBACK_MODEL, prompt, timeoutMs, temperature, key);
  }

  throw last;
}
