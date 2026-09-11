// ======================================================================
//  Ce que l'accueil raconte de MA bibliothèque
// ======================================================================
// Port web des lectures de l'accueil mobile (myplaylog-mobile/src/lib/home.js).
// L'accueil ne demande RIEN de spécial au serveur : `GET /library` rend déjà
// tout ce qu'il montre — les statuts, les temps de jeu, les dates de dernier
// changement. Ce qui manquait, ce n'est pas de la donnée, c'est une LECTURE :
// « ce que je joue en ce moment », « ce que j'ai laissé en plan », « ce à quoi
// je jouerais bien ce soir » sont trois façons de regarder la même liste.
//
// Ces fonctions sont pures et sans React : elles se lisent, se relisent et se
// corrigent sans avoir à ouvrir l'écran. Elles vivent ici plutôt que dans le
// rendu, parce qu'un écran qui calcule ce qu'il affiche pendant qu'il l'affiche
// devient très vite le seul endroit où l'on comprend encore l'application.
//
// ⚠️ CES RÈGLES SONT LES MÊMES QUE CELLES DU TÉLÉPHONE, VOLONTAIREMENT. Deux
// écrans d'accueil qui disent « en cours » pour deux listes différentes, c'est
// un utilisateur qui cesse de croire les deux.

const DAY = 86400000;

// Au bout de combien de temps sans y toucher un jeu « en cours » cesse d'être
// en cours ? Deux mois. En dessous, on est simplement passé à autre chose une
// semaine ou deux ; au-dessus, on ne se souvient plus d'où on en était — et
// c'est précisément ça qu'il faut rappeler.
export const STALE_DAYS = 60;

const timeOf = (e) => {
  const ms = new Date(e?.updatedAt || 0).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

const isStale = (e, now) => now - timeOf(e) >= STALE_DAYS * DAY;

/**
 * Les jeux EN COURS, du plus récemment touché au plus ancien.
 *
 * Ceux qui dorment depuis plus de deux mois n'y sont pas : ils ont leur propre
 * rayon (`dustyGames`). La partition est stricte — un jeu ne peut pas être à la
 * fois « ce que je joue » et « ce que j'ai oublié ».
 *
 * ⚠️ SAUF SI ÇA VIDE LA SECTION. Quelqu'un qui reprend l'app après six mois a
 * TOUS ses jeux en cours périmés : l'accueil s'ouvrirait alors sur un vide,
 * avec la vraie réponse cachée trois sections plus bas.
 */
export function nowPlaying(entries, now = Date.now(), limit = 8) {
  const playing = (entries || [])
    .filter((e) => e.status === "playing")
    .sort((a, b) => timeOf(b) - timeOf(a));
  const fresh = playing.filter((e) => !isStale(e, now));
  return (fresh.length ? fresh : playing).slice(0, limit);
}

/**
 * Ce qu'on a laissé en plan : commencé ou mis en pause, et plus touché depuis
 * deux mois. Du plus vieux au moins vieux — c'est le plus enterré qu'on a le
 * plus de chances d'avoir vraiment oublié.
 */
export function dustyGames(entries, now = Date.now(), limit = 14) {
  const playing = (entries || []).filter((e) => e.status === "playing");
  const fresh = playing.filter((e) => !isStale(e, now));
  // Le repli de `nowPlaying` ci-dessus : quand il n'y a QUE du périmé, ces
  // jeux-là sont déjà en haut de l'écran, on ne les redescend pas ici.
  const claimed = new Set(
    fresh.length ? [] : nowPlaying(entries, now).map((e) => e.gameId)
  );

  return (entries || [])
    .filter(
      (e) =>
        (e.status === "playing" || e.status === "paused") &&
        isStale(e, now) &&
        !claimed.has(e.gameId)
    )
    .sort((a, b) => timeOf(a) - timeOf(b))
    .slice(0, limit);
}

/** « Il y a 4 mois » — la distance, pas la date : c'est elle qui pique. */
export function sinceLabel(value, now = Date.now()) {
  const ms = new Date(value || 0).getTime();
  if (!ms || Number.isNaN(ms)) return "";
  const days = Math.floor((now - ms) / DAY);
  if (days < 1) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 30) return `il y a ${days} j`;
  const months = Math.round(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.floor(days / 365);
  return years <= 1 ? "il y a un an" : `il y a ${years} ans`;
}

/**
 * LE jeu qu'on a adoré, celui dont on peut tirer des recommandations.
 *
 * Les coups de cœur d'abord, puis les mieux notés — et parmi eux, un différent
 * chaque jour. La rotation est calée sur la date et non sur un tirage au sort :
 * rouvrir l'accueil trois fois dans la matinée ne doit pas donner trois rayons
 * différents, sinon on ne retrouve jamais ce qu'on y avait vu.
 */
export function lovedSeed(entries, now = Date.now(), shift = 0) {
  const pool = (entries || [])
    .filter(
      (e) =>
        (e.status === "finished" || e.status === "endless") &&
        (e.favorite || (e.rating ?? 0) >= 80)
    )
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) || (b.rating ?? 0) - (a.rating ?? 0)
    )
    // Au-delà des dix meilleurs, on n'est plus dans « j'ai adoré ».
    .slice(0, 10);
  if (!pool.length) return null;
  // `shift` fait tourner le choix SANS casser la règle du jour : le rayon
  // change tout seul chaque jour, le bouton « un autre » avance d'un cran.
  return pool[(Math.floor(now / DAY) + shift) % pool.length];
}

/** Combien de jeux adorés on peut faire défiler — pour cacher le bouton à 1. */
export function lovedPoolSize(entries) {
  return (entries || []).filter(
    (e) =>
      (e.status === "finished" || e.status === "endless") &&
      (e.favorite || (e.rating ?? 0) >= 80)
  ).length;
}

/**
 * « Et si je jouais à ça ? »
 *
 * On pioche dans ce qui ATTEND : d'abord la liste d'envies (c'est écrit dessus
 * qu'on en a envie), sinon ce qui est en pause, sinon ce qui est en cours mais
 * dort. Un jeu terminé n'y est jamais — la proposition doit ouvrir quelque
 * chose, pas rappeler ce qui est fini.
 */
export function tonightPick(entries, salt = 0, now = Date.now()) {
  const all = entries || [];
  const wish = all.filter((e) => e.status === "wishlist");
  const paused = all.filter((e) => e.status === "paused");
  const sleeping = all.filter((e) => e.status === "playing" && isStale(e, now));
  const pool = wish.length ? wish : paused.length ? paused : sleeping;
  if (!pool.length) return null;
  return pool[(Math.floor(now / DAY) + salt) % pool.length];
}

/** Pourquoi CE jeu-là est proposé — une ligne, honnête. */
export function pickReason(entry, now = Date.now()) {
  if (!entry) return "";
  const since = sinceLabel(entry.updatedAt, now);
  if (entry.status === "wishlist") return `Dans tes envies depuis ${since}`;
  if (entry.status === "paused") return `En pause depuis ${since}`;
  return entry.playtimeHours
    ? `${Math.round(entry.playtimeHours)} h de jeu, puis plus rien depuis ${since}`
    : `Plus touché depuis ${since}`;
}

/**
 * Le bilan de la semaine.
 *
 * ⚠️ CE N'EST PAS UNE PHRASE, CE SONT DES JEUX. Ce qui donne envie de la
 * regarder, ce sont les JAQUETTES : on reconnaît sa semaine d'un coup d'œil,
 * sans lire, et chacune est un chemin vers sa fiche.
 *
 * Rend `null` quand la semaine est vide — un bilan à zéro ne fait envie à
 * personne, et un rayon vide vaut mieux qu'un rayon qui dit « rien ».
 */
export function weekRecap(entries, now = Date.now()) {
  const from = now - 7 * DAY;
  const games = (entries || [])
    .filter((e) => timeOf(e) >= from && e.status)
    .sort((a, b) => timeOf(b) - timeOf(a));
  if (!games.length) return null;

  const finished = games.filter((e) => e.status === "finished").length;
  const started = games.filter((e) => e.status === "playing").length;

  // Le titre dit CE QUI COMPTE en premier : une fin de jeu est un événement,
  // « j'ai touché cinq jeux » ne l'est pas.
  const bits = [];
  if (finished) bits.push(`${finished} terminé${finished > 1 ? "s" : ""}`);
  if (started) bits.push(`${started} en cours`);
  bits.push(`${games.length} jeu${games.length > 1 ? "x" : ""}`);

  return { games: games.slice(0, 14), finished, started, summary: bits.join(" · ") };
}

/** « 24 h » / « 1 h 30 » — lisible d'un coup d'œil. */
export function hoursLabel(hours) {
  if (hours == null) return null;
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const whole = Math.floor(hours);
  const mins = Math.round((hours - whole) * 60);
  return mins ? `${whole} h ${String(mins).padStart(2, "0")}` : `${whole} h`;
}

/** La salutation du moment. Elle date la visite mieux qu'une horloge. */
export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Bonne nuit";
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
}

/** La date du jour en toutes lettres : « mardi 11 septembre ». */
export function todayLabel(date = new Date()) {
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** La couleur d'un statut — la même que les liserés du profil. */
export const STATUS_TINT = {
  playing: "#4a9eff",
  finished: "#3ecf8e",
  paused: "#f2b70b",
  dropped: "#ef4444",
  endless: "#a78bfa",
  wishlist: "#9a9dab",
};

export const STATUS_LABEL = {
  playing: "En cours",
  finished: "Terminé",
  paused: "En pause",
  dropped: "Abandonné",
  endless: "Sans fin",
  wishlist: "Dans les envies",
};

/**
 * La fenêtre « aujourd'hui », telle que le serveur la découpe.
 *
 * ⚠️ MINUIT UTC, PAS MINUIT CHEZ MOI. Le serveur cale ses journées de sorties
 * sur UTC (cf. GET /games/releases) : lui demander une fenêtre locale
 * renverrait deux moitiés de journées et un jeu de la veille.
 */
export function todayReleasesPath() {
  const start = Math.floor(Date.now() / 1000 / 86400) * 86400;
  return `/games/releases?from=${start}&to=${start + 86399}`;
}

// ======================================================================
//  Les bandes tirées de la bibliothèque
// ======================================================================
// ⚠️ AUCUNE DE CES TROIS NE COÛTE UNE REQUÊTE. `GET /library` est déjà chargé
// pour les parties en cours, le placard et la proposition du soir : ce sont
// trois LECTURES de plus de la même liste, donc trois rayons qui s'affichent
// à la milliseconde où la page s'ouvre. C'est ce qui les distingue des rayons
// de catalogue, qui attendent IGDB.

/** Ce qu'on veut jouer, du plus récemment ajouté au plus ancien. */
export function wishlistGames(entries, limit = 16) {
  return (entries || [])
    .filter((e) => e.status === "wishlist")
    .sort((a, b) => timeOf(b) - timeOf(a))
    .slice(0, limit);
}

/**
 * Ce qu'on vient de terminer.
 *
 * ⚠️ TRIÉ SUR LA DATE DE FIN, PAS SUR LA DERNIÈRE MODIFICATION. Corriger la
 * note d'un jeu fini il y a trois ans le ferait sinon remonter en tête d'un
 * rayon qui raconte les dernières semaines.
 */
export function recentlyFinished(entries, limit = 16) {
  const endOf = (e) => {
    const ms = new Date(e?.finishedAt || e?.updatedAt || 0).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  };
  return (entries || [])
    .filter((e) => e.status === "finished")
    .sort((a, b) => endOf(b) - endOf(a))
    .slice(0, limit);
}

/**
 * Les coups de cœur — le cœur explicite d'abord, les très bien notés ensuite.
 *
 * Le même critère que `lovedSeed`, mais rendu en entier : celui-là choisit UN
 * jeu pour en recommander d'autres, celui-ci montre l'étagère.
 */
export function favoriteGames(entries, limit = 16) {
  return (entries || [])
    .filter((e) => e.favorite || (e.rating ?? 0) >= 85)
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) || (b.rating ?? 0) - (a.rating ?? 0)
    )
    .slice(0, limit);
}
