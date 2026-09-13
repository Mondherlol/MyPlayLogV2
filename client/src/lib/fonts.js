// ======================================================================
//  Les polices du site — choisies sur CET appareil
// ======================================================================
// Tout le site lit deux variables : `--font-body` (le texte) et
// `--font-display` (les titres), cf. index.css. Changer de police, c'est donc
// charger la famille voulue chez Google Fonts et réécrire ces deux variables
// sur <html> — aucune feuille de style n'a à savoir qu'on a changé.
//
// ⚠️ LES GRAISSES SONT CELLES QUI EXISTENT VRAIMENT. Google Fonts refuse la
// requête ENTIÈRE (erreur 400, aucune police servie) dès qu'on demande une
// graisse qu'une famille n'a pas : « Space Mono 500 » suffisait à tout casser.
// Chaque police déclare donc les siennes quand elles s'écartent du 400–700.
//
// ⚠️ `titleOnly` : des polices superbes en titre et illisibles en paragraphe
// (pixel, néon, affiche). Elles ne sont proposées que pour les titres.

const DEFAULT_WEIGHTS = "400;500;600;700";

export const FONT_GROUPS = [
  { key: "neutral", label: "Sobres & lisibles" },
  { key: "geometric", label: "Géométriques & modernes" },
  { key: "grotesk", label: "Grotesques à caractère" },
  { key: "rounded", label: "Arrondies & chaleureuses" },
  { key: "gaming", label: "Gaming & tech" },
  { key: "serif", label: "Serif & éditorial" },
  { key: "mono", label: "Monospace" },
];

export const FONTS = [
  // --- Sobres & lisibles ----------------------------------------------
  // ⚠️ `local` : pas de Google Fonts pour elle. Segoe UI vient du système,
  // Selawik (sa jumelle libre) est servie par le site (cf. index.css) — et
  // `stack` donne la pile complète, qu'un simple nom de famille ne dit pas.
  {
    id: "segoe",
    family: "Selawik",
    group: "neutral",
    label: "Segoe UI",
    note: "Style Xbox · par défaut",
    local: true,
    stack: '"Segoe UI Variable Display", "Segoe UI", "Selawik", system-ui, sans-serif',
  },
  { id: "inter", family: "Inter", group: "neutral", note: "Ancien texte" },
  { id: "system", family: null, group: "neutral", label: "Police du système", note: "Aucun téléchargement" },
  { id: "geist", family: "Geist", group: "neutral" },
  { id: "onest", family: "Onest", group: "neutral" },
  { id: "figtree", family: "Figtree", group: "neutral" },
  { id: "public-sans", family: "Public Sans", group: "neutral" },
  { id: "ibm-plex-sans", family: "IBM Plex Sans", group: "neutral" },
  { id: "instrument-sans", family: "Instrument Sans", group: "neutral" },
  { id: "albert-sans", family: "Albert Sans", group: "neutral" },
  { id: "nunito-sans", family: "Nunito Sans", group: "neutral" },
  { id: "source-sans-3", family: "Source Sans 3", group: "neutral" },
  { id: "atkinson", family: "Atkinson Hyperlegible", group: "neutral", weights: "400;700", note: "Lisibilité maximale" },

  // --- Géométriques & modernes ----------------------------------------
  { id: "manrope", family: "Manrope", group: "geometric" },
  { id: "plus-jakarta-sans", family: "Plus Jakarta Sans", group: "geometric" },
  { id: "dm-sans", family: "DM Sans", group: "geometric" },
  { id: "outfit", family: "Outfit", group: "geometric" },
  { id: "urbanist", family: "Urbanist", group: "geometric" },
  { id: "sora", family: "Sora", group: "geometric" },
  { id: "lexend", family: "Lexend", group: "geometric" },
  { id: "poppins", family: "Poppins", group: "geometric" },
  { id: "montserrat", family: "Montserrat", group: "geometric" },
  { id: "red-hat-display", family: "Red Hat Display", group: "geometric" },
  { id: "be-vietnam-pro", family: "Be Vietnam Pro", group: "geometric" },
  { id: "kumbh-sans", family: "Kumbh Sans", group: "geometric" },

  // --- Grotesques à caractère -----------------------------------------
  { id: "space-grotesk", family: "Space Grotesk", group: "grotesk", note: "Anciens titres" },
  { id: "hanken-grotesk", family: "Hanken Grotesk", group: "grotesk" },
  { id: "schibsted-grotesk", family: "Schibsted Grotesk", group: "grotesk" },
  { id: "bricolage-grotesque", family: "Bricolage Grotesque", group: "grotesk" },
  { id: "familjen-grotesk", family: "Familjen Grotesk", group: "grotesk" },
  { id: "work-sans", family: "Work Sans", group: "grotesk" },
  { id: "archivo", family: "Archivo", group: "grotesk" },
  { id: "syne", family: "Syne", group: "grotesk", titleOnly: true },

  // --- Arrondies & chaleureuses ---------------------------------------
  { id: "nunito", family: "Nunito", group: "rounded" },
  { id: "rubik", family: "Rubik", group: "rounded" },
  { id: "quicksand", family: "Quicksand", group: "rounded" },
  { id: "fredoka", family: "Fredoka", group: "rounded" },
  { id: "varela-round", family: "Varela Round", group: "rounded", weights: "400" },
  { id: "m-plus-rounded", family: "M PLUS Rounded 1c", group: "rounded", weights: "400;500;700" },

  // --- Gaming & tech ---------------------------------------------------
  { id: "chakra-petch", family: "Chakra Petch", group: "gaming" },
  { id: "rajdhani", family: "Rajdhani", group: "gaming" },
  { id: "exo-2", family: "Exo 2", group: "gaming" },
  { id: "oxanium", family: "Oxanium", group: "gaming" },
  { id: "saira", family: "Saira", group: "gaming" },
  { id: "kanit", family: "Kanit", group: "gaming" },
  { id: "barlow", family: "Barlow", group: "gaming" },
  { id: "titillium-web", family: "Titillium Web", group: "gaming", weights: "400;600;700" },
  { id: "orbitron", family: "Orbitron", group: "gaming", titleOnly: true },
  { id: "audiowide", family: "Audiowide", group: "gaming", weights: "400", titleOnly: true },
  { id: "russo-one", family: "Russo One", group: "gaming", weights: "400", titleOnly: true },
  { id: "bungee", family: "Bungee", group: "gaming", weights: "400", titleOnly: true },
  { id: "silkscreen", family: "Silkscreen", group: "gaming", weights: "400;700", titleOnly: true, note: "Pixel" },
  { id: "press-start-2p", family: "Press Start 2P", group: "gaming", weights: "400", titleOnly: true, note: "Rétro 8-bit" },

  // --- Serif & éditorial -----------------------------------------------
  { id: "fraunces", family: "Fraunces", group: "serif", category: "serif" },
  { id: "newsreader", family: "Newsreader", group: "serif", category: "serif" },
  { id: "source-serif-4", family: "Source Serif 4", group: "serif", category: "serif" },
  { id: "lora", family: "Lora", group: "serif", category: "serif" },
  { id: "playfair-display", family: "Playfair Display", group: "serif", category: "serif", titleOnly: true },
  { id: "dm-serif-display", family: "DM Serif Display", group: "serif", category: "serif", weights: "400", titleOnly: true },
  { id: "instrument-serif", family: "Instrument Serif", group: "serif", category: "serif", weights: "400", titleOnly: true },

  // --- Monospace --------------------------------------------------------
  { id: "jetbrains-mono", family: "JetBrains Mono", group: "mono", category: "mono" },
  { id: "geist-mono", family: "Geist Mono", group: "mono", category: "mono" },
  { id: "ibm-plex-mono", family: "IBM Plex Mono", group: "mono", category: "mono" },
  { id: "dm-mono", family: "DM Mono", group: "mono", category: "mono", weights: "400;500" },
  { id: "space-mono", family: "Space Mono", group: "mono", category: "mono", weights: "400;700" },
];

const BY_ID = new Map(FONTS.map((f) => [f.id, f]));

// Segoe UI partout, comme sur une Xbox (cf. index.css). Quelqu'un qui avait
// gardé les anciennes polices par défaut n'avait rien enregistré : il passe à
// la nouvelle. Celui qui avait CHOISI Inter ou Space Grotesk les garde.
export const DEFAULT_FONTS = { body: "segoe", display: "segoe" };

/** Les polices proposées pour un rôle (« body » ou « display »). */
export function fontsFor(role) {
  return role === "body" ? FONTS.filter((f) => !f.titleOnly) : FONTS;
}

export function fontById(id) {
  return BY_ID.get(id) || null;
}

export function fontLabel(font) {
  return font?.label || font?.family || "";
}

const SYSTEM_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** La pile CSS d'une police, avec un repli du même genre qu'elle. */
export function fontStack(font) {
  if (font?.stack) return font.stack;
  if (!font?.family) return SYSTEM_STACK;
  const fallback =
    font.category === "serif"
      ? 'Georgia, "Times New Roman", serif'
      : font.category === "mono"
        ? "ui-monospace, Menlo, Consolas, monospace"
        : "system-ui, sans-serif";
  return `"${font.family}", ${fallback}`;
}

function familyParam(font, weights) {
  return `family=${encodeURIComponent(font.family).replace(/%20/g, "+")}:wght@${weights}`;
}

function cssUrl(fonts, weightsOf) {
  // Les polices `local` ne passent jamais par Google (cf. l'entrée Segoe UI).
  const params = fonts
    .filter((f) => f.family && !f.local)
    .map((f) => familyParam(f, weightsOf(f)));
  return params.length ? `https://fonts.googleapis.com/css2?${params.join("&")}&display=swap` : null;
}

function setLink(id, href) {
  let link = document.getElementById(id);
  if (!href) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}

// --- Préférences ----------------------------------------------------------

const KEYS = { body: "mpl_font_body", display: "mpl_font_display" };

export function getFontPrefs() {
  const prefs = { ...DEFAULT_FONTS };
  try {
    for (const role of ["body", "display"]) {
      const saved = localStorage.getItem(KEYS[role]);
      // Une police retirée de la liste depuis : on retombe sur la valeur par
      // défaut plutôt que sur une variable vide.
      if (saved && fontsFor(role).some((f) => f.id === saved)) prefs[role] = saved;
    }
  } catch {
    /* stockage bloqué : les polices par défaut feront l'affaire */
  }
  return prefs;
}

export function saveFontPrefs(prefs) {
  try {
    for (const role of ["body", "display"]) {
      if (prefs[role] === DEFAULT_FONTS[role]) localStorage.removeItem(KEYS[role]);
      else localStorage.setItem(KEYS[role], prefs[role]);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Appliquer les polices choisies à tout le site.
 *
 * ⚠️ À APPELER AVANT LE PREMIER RENDU (cf. main.jsx). Appliquée depuis un
 * composant, la police choisie n'arriverait qu'après une première image en
 * Inter — le site « sauterait » à chaque chargement.
 */
export function applyFonts(prefs) {
  const body = fontById(prefs.body) || fontById(DEFAULT_FONTS.body);
  const display = fontById(prefs.display) || fontById(DEFAULT_FONTS.display);
  const root = document.documentElement.style;

  // Les valeurs par défaut sont déjà écrites dans index.css : on n'écrase rien
  // pour elles, et la feuille reste la seule source de vérité.
  if (body.id === DEFAULT_FONTS.body) root.removeProperty("--font-body");
  else root.setProperty("--font-body", fontStack(body));
  if (display.id === DEFAULT_FONTS.display) root.removeProperty("--font-display");
  else root.setProperty("--font-display", fontStack(display));

  // Inter et Space Grotesk sont déjà chargées par index.css dans leur rôle
  // d'origine ; toute autre combinaison passe par notre propre feuille.
  const toLoad = [];
  if (body.id !== DEFAULT_FONTS.body) toLoad.push(body);
  if (display.id !== DEFAULT_FONTS.display && display.id !== body.id) toLoad.push(display);
  setLink("mpl-fonts", cssUrl(toLoad, (f) => f.weights || DEFAULT_WEIGHTS));
}

/**
 * Charger TOUTES les polices de la liste, pour que chaque tuile du sélecteur
 * s'affiche dans la sienne.
 *
 * Par paquets de huit : une famille refusée par Google ne coûte que les tuiles
 * de son paquet, pas l'aperçu entier. Seules les graisses 400 et 700 (ou ce qui
 * existe) : c'est tout ce que montre une tuile.
 */
export function loadFontPreviews() {
  const fonts = FONTS.filter((f) => f.family);
  const previewWeights = (f) => {
    const own = (f.weights || DEFAULT_WEIGHTS).split(";");
    const kept = own.filter((w) => w === "400" || w === "700");
    return (kept.length ? kept : own.slice(0, 1)).join(";");
  };
  for (let i = 0; i < fonts.length; i += 8) {
    setLink(`mpl-font-preview-${i / 8}`, cssUrl(fonts.slice(i, i + 8), previewWeights));
  }
}
