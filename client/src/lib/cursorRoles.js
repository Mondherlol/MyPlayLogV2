// ======================================================================
//  Les RÔLES d'un thème de curseur.
// ======================================================================
// Un lot « curseur » n'est plus une seule image : c'est un thème qui peut
// définir plusieurs états (la flèche normale, la main au survol, la barre de
// texte, la saisie/glisser d'un élément déplaçable). Chaque rôle surcharge une
// variable CSS ; celles-ci sont posées par CosmeticsContext et lues par
// index.css. Ce fichier est la SEULE source de vérité partagée entre l'admin
// (assignation) et le runtime (application) — ajouter un rôle ici suffit à le
// faire remonter dans l'éditeur.
//
//  `cssVar`   : variable surchargée sur <html> quand ce rôle est fourni.
//  `fallback` : mot-clé CSS de repli (curseur système) si aucune image.
//  `external` : true quand index.css écrit déjà le repli APRÈS la variable
//               (`cursor: var(--x), auto`) — dans ce cas le JS pose une valeur
//               SANS repli ; sinon il l'intègre lui-même (`url(...) x y, text`).
//  `required` : le thème ne vaut rien sans lui (c'est le curseur de base).
export const CURSOR_ROLES = [
  {
    key: "normal",
    label: "Normal",
    desc: "La flèche, partout",
    cssVar: "--cursor-default",
    fallback: "auto",
    external: true,
    required: true,
  },
  // ATTENTION : « Survol lien » et « Survol déplaçable » sont DEUX choses
  // différentes, réglables séparément — survoler un bouton n'est pas survoler
  // une zone qu'on peut attraper.
  {
    key: "pointer",
    label: "Survol lien",
    desc: "Au survol d'un lien ou d'un bouton",
    cssVar: "--cursor-pointer",
    fallback: "pointer",
    external: true,
  },
  {
    key: "text",
    label: "Texte",
    desc: "Champs de saisie",
    cssVar: "--cursor-text",
    fallback: "text",
    external: false,
  },
  // `twin` : rôle jumeau qui prête son image quand celui-ci n'a rien. Saisir et
  // Glisser vont par paire — en définir un seul habille les deux, mais dès que
  // l'autre a sa propre image, elle gagne (le repli ne l'écrase jamais).
  {
    key: "grab",
    label: "Survol déplaçable",
    desc: "Au survol d'une zone attrapable (main ouverte)",
    cssVar: "--cursor-grab",
    fallback: "grab",
    external: false,
    twin: "grabbing",
  },
  {
    key: "grabbing",
    label: "En train de glisser",
    desc: "Pendant le déplacement (main fermée)",
    cssVar: "--cursor-grabbing",
    fallback: "grabbing",
    external: false,
    twin: "grab",
  },
];

export const CURSOR_ROLE_KEYS = CURSOR_ROLES.map((r) => r.key);
export const CURSOR_ROLE_BY_KEY = Object.fromEntries(CURSOR_ROLES.map((r) => [r.key, r]));

// Devine à quel rôle un fichier correspond d'après son nom — les packs de
// curseurs suivent des conventions assez stables (Windows & custom-cursor.com).
// L'ordre compte : on teste du plus spécifique au plus générique, et « normal »
// ramasse la flèche par défaut (souvent nommée « pointer » sous Windows).
const GUESS = [
  ["grabbing", /grabb?ing|closed|closehand|\bdrag/i],
  ["grab", /grab|openhand/i],
  ["text", /beam|ibeam|\btext\b|caret|edit/i],
  ["pointer", /link|hand|hover|hyperlink|clickable/i],
  ["normal", /arrow|normal|default|standard|select|precision|working|busy|wait|pointer/i],
];

// Renvoie une clé de rôle, ou null si le nom n'évoque rien (l'admin choisira).
export function guessRole(filename = "") {
  const base = (filename.split(/[\\/]/).pop() || filename).toLowerCase();
  for (const [role, re] of GUESS) if (re.test(base)) return role;
  return null;
}
