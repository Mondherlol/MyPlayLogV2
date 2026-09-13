// ======================================================================
//  Les marques qui notent les jeux
// ======================================================================
// Port web de myplaylog-mobile/src/lib/scoreBrands.js : les mêmes couleurs et
// les mêmes libellés des deux côtés, pour qu'une note Metacritic se reconnaisse
// à l'identique sur le site et sur le téléphone.
//
// `color` est le fond de la pastille, `ink` ce qu'on écrit dessus. Faute de
// logo, deux ou trois lettres (`mono`) : mieux vaut un monogramme lisible
// qu'un logo approximatif.
const METACRITIC_PATH =
  "M11.99 0A12 12 0 1 0 24 12v-.014A12 12 0 0 0 11.99 0Zm-.055 2.564a9.399 9.399 0 0 1 9.407 9.389v.01a9.399 9.399 0 1 1-9.408-9.399Zm-1.61 17.198 2.046-2.046-3.94-3.94c-.165-.166-.345-.373-.442-.608-.221-.47-.318-1.203.221-1.742.664-.664 1.548-.387 2.406.47l3.788 3.788 2.046-2.046-3.954-3.954a2.48 2.48 0 0 1-.456-.622c-.263-.539-.25-1.216.235-1.7.677-.678 1.562-.429 2.544.553l3.677 3.677 2.046-2.046-3.982-3.982c-2.018-2.018-3.912-1.949-5.212-.65-.498.499-.802 1.024-.954 1.618a4.026 4.026 0 0 0-.055 1.686l-.027.028c-.996-.414-2.13-.166-3 .705-1.162 1.161-1.12 2.392-.982 3.11l-.042.043-1.009-.816-1.77 1.77a64.1 64.1 0 0 1 2.213 2.1z";

export const SCORE_BRANDS = {
  metacritic: {
    label: "Metacritic",
    sub: "presse",
    color: "#FFCC33",
    ink: "#2a1f00",
    icon: { viewBox: "0 0 24 24", d: METACRITIC_PATH },
  },
  opencritic: { label: "OpenCritic", sub: "presse", color: "#FF6900", ink: "#2a1000", mono: "OC" },
  jvc: { label: "jeuxvideo.com", sub: "lecteurs", color: "#E9312B", ink: "#ffffff", mono: "JV" },
  ign: { label: "IGN", sub: "test", color: "#BF1313", ink: "#ffffff", mono: "IGN" },
  steam: { label: "Steam", sub: "joueurs", color: "#66C0F4", ink: "#0b1a26", platform: "steam" },
  igdb: { label: "IGDB", sub: "monde", color: "#9147FF", ink: "#ffffff", mono: "IG" },
  igdbCritics: { label: "Presse IGDB", sub: "critiques", color: "#6d4bb8", ink: "#ffffff", mono: "PR" },
  community: { label: "MyPlayLog", sub: "ici", color: "#f2b70b", ink: "#1a1204", mono: "MPL" },
};

export function brandOf(key) {
  return (
    SCORE_BRANDS[key] || {
      label: key,
      color: "#8b8e9c",
      ink: "#ffffff",
      mono: String(key || "?").slice(0, 2).toUpperCase(),
    }
  );
}

// Les verdicts de Steam, en français : leur API répond en anglais dès que la
// langue demandée n'a pas assez d'avis, et « Overwhelmingly Positive » au
// milieu d'une fiche française fait tache.
const STEAM_VERDICTS = {
  "overwhelmingly positive": "Extrêmement positives",
  "very positive": "Très positives",
  positive: "Positives",
  "mostly positive": "Plutôt positives",
  mixed: "Moyennes",
  "mostly negative": "Plutôt négatives",
  negative: "Négatives",
  "very negative": "Très négatives",
  "overwhelmingly negative": "Extrêmement négatives",
};

export function steamVerdict(desc, percent) {
  const hit = STEAM_VERDICTS[String(desc || "").trim().toLowerCase()];
  if (hit) return hit;
  if (desc) return desc;
  if (percent == null) return "Avis Steam";
  if (percent >= 95) return "Extrêmement positives";
  if (percent >= 80) return "Très positives";
  if (percent >= 70) return "Plutôt positives";
  if (percent >= 40) return "Moyennes";
  return "Négatives";
}
