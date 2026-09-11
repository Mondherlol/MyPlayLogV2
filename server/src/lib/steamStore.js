// ======================================================================
//  La page boutique d'un jeu Steam, lue et normalisée
// ======================================================================
//
// Ce fichier ne parle QU'À LA BOUTIQUE (store.steampowered.com), pas à la Web
// API des joueurs — qui est dans lib/steam.js et demande une clé. Ici, aucune
// clé n'est nécessaire : `appdetails` est public. C'est ce qui permet à
// n'importe quel utilisateur de coller un lien Steam, même sans compte lié.
//
// ⚠️ CETTE API N'EST PAS DOCUMENTÉE PAR VALVE et elle est bridée (environ 200
// appels par tranche de 5 minutes, par IP). Deux conséquences tenues ici :
// on met en cache ce qu'on lit, et on ne l'appelle jamais en boucle sur une
// liste — la synchro IGDB (lib/steamIgdbSync.js) relit NOS fiches en base, pas
// Steam.

import { createTtlCache } from "./ttlCache.js";

const STORE = "https://store.steampowered.com/api/appdetails";
// Les jaquettes portrait ne sont pas dans `appdetails` : Steam les sert à une
// adresse déduite de l'appid. Elle n'existe pas pour tous les jeux (les vieux
// titres n'ont que la bannière), d'où la vérification avant de l'enregistrer.
const ASSETS = "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps";

// Une page boutique ne change pas d'une minute à l'autre. Ce cache sert surtout
// aux liens collés plusieurs fois d'affilée (deux joueurs, le même jeu).
const detailsCache = createTtlCache({
  name: "steam:appdetails",
  max: 200,
  ttl: 6 * 60 * 60 * 1000,
});

/**
 * L'appid contenu dans ce que l'utilisateur a collé, ou `null`.
 *
 * On accepte tout ce qui traîne dans un presse-papier : l'URL complète avec sa
 * langue et son slug (`/app/3101040/_/?l=japanese`), l'adresse courte, celle du
 * client Steam (`steam://`), et l'appid nu.
 */
export function parseAppId(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  // Un nombre seul : l'appid tapé à la main.
  if (/^\d{1,8}$/.test(raw)) return Number(raw);

  const m = raw.match(
    /(?:store\.steampowered\.com|steamcommunity\.com)\/(?:app|agecheck\/app)\/(\d{1,8})/i
  );
  if (m) return Number(m[1]);

  // Lien du client lourd : steam://store/3101040 ou steam://openurl/…/app/3101040
  const proto = raw.match(/steam:\/\/(?:store|openurl\/.*?app)\/(\d{1,8})/i);
  if (proto) return Number(proto[1]);

  return null;
}

/** L'adresse publique de la fiche Steam d'un jeu. */
export const storeUrl = (appid) => `https://store.steampowered.com/app/${appid}/`;

// Steam renvoie la date en toutes lettres, dans la langue demandée (« 12 mars
// 2026 »). On veut un timestamp comme IGDB pour que les tris et les affichages
// existants fonctionnent sans distinction. `Date.parse` ne sait pas lire le
// français : on demande donc la date en anglais (voir `fetchAppDetails`, qui
// interroge Steam deux fois) et on garde le libellé localisé pour l'affichage.
function parseReleaseTs(dateStr) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (Number.isFinite(t)) return Math.floor(t / 1000);
  // « Mar 2026 » ou « 2026 » seuls : `Date.parse` les accepte mal selon le
  // moteur, on complète ce qui manque plutôt que de perdre l'année.
  const year = dateStr.match(/\b(19|20)\d{2}\b/);
  if (!year) return null;
  const withDay = Date.parse(`${dateStr} 1`);
  if (Number.isFinite(withDay)) return Math.floor(withDay / 1000);
  return Math.floor(Date.UTC(Number(year[0]), 0, 1) / 1000);
}

// Les descriptions Steam sont du HTML (balises de mise en forme, images, listes).
// On n'affiche jamais ce HTML : on en tire du texte, comme le `summary` d'IGDB.
function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Une liste de noms venue de Steam : espaces rognés, vides et doublons retirés.
const clean = (arr) => [
  ...new Set((arr || []).map((x) => String(x || "").trim()).filter(Boolean)),
].slice(0, 8);

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      // Sans en-tête de langue, Steam sert la page selon l'IP du serveur — donc
      // en anglais depuis un VPS, alors que l'app est en français.
      "Accept-Language": "fr-FR,fr;q=0.9",
      "User-Agent": "MyPlayLog/1.0 (+https://myplaylog.fr)",
    },
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// La jaquette portrait existe-t-elle ? Une requête HEAD, et on retombe sur la
// bannière si non : une fiche sans image du tout serait moche partout (listes,
// bibliothèque, résultats de recherche).
async function findCover(appid) {
  for (const file of ["library_600x900_2x.jpg", "library_600x900.jpg"]) {
    const url = `${ASSETS}/${appid}/${file}`;
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok) return url;
    } catch {
      /* réseau : on essaie la suivante, sinon la bannière */
    }
  }
  return null;
}

/**
 * Tout ce que la boutique Steam sait du jeu `appid`, au format de notre modèle
 * `SteamGame` — ou `null` si l'appid n'existe pas / n'est pas consultable.
 *
 * Les jeux non sortis, réservés à une région ou soumis à une vérification d'âge
 * répondent parfois `success: false`. On ne peut rien y faire : l'appelant
 * remonte alors un message clair plutôt qu'une fiche vide.
 */
export async function fetchAppDetails(appid) {
  const id = Number(appid);
  if (!Number.isInteger(id) || id <= 0) return null;

  // ⚠️ Le loader rend `undefined` (et pas `null`) quand la page est illisible :
  // le cache n'enregistre pas `undefined`, donc un jeu momentanément
  // inaccessible (Steam en vrac, page en cours de publication) sera redemandé
  // au prochain essai au lieu d'être réputé inexistant pendant six heures.
  const data = await detailsCache.remember(String(id), async () => {
    // Deux appels : la version française pour le texte, l'anglaise UNIQUEMENT
    // pour la date (que `Date.parse` sait lire). Ils partent ensemble.
    const [fr, en] = await Promise.all([
      getJson(`${STORE}?appids=${id}&l=french&cc=fr`),
      // ⚠️ `filters=basic` SEUL NE RAMÈNE PAS LA DATE DE SORTIE — et son absence
      // ne se voit pas : on retombait alors sur la date française, que
      // `Date.parse` ne sait pas lire, et « 18 juil. 2025 » devenait le
      // 1er janvier 2025. Il faut demander `release_date` explicitement.
      getJson(`${STORE}?appids=${id}&l=english&cc=us&filters=basic,release_date`),
    ]);

    const entry = fr?.[id] || fr?.[String(id)];
    if (!entry?.success || !entry.data) return undefined;
    const d = entry.data;
    const dEn = (en?.[id] || en?.[String(id)])?.data || null;

    const releaseHuman = d.release_date?.date || null;
    const releaseDate = parseReleaseTs(dEn?.release_date?.date || releaseHuman);

    const oses = Object.entries(d.platforms || {})
      .filter(([, ok]) => ok)
      .map(([os]) => os);

    return {
      appid: id,
      name: dEn?.name || d.name || `Jeu Steam ${id}`,
      // Le titre localisé : c'est celui qui empêchait de retrouver le jeu à la
      // recherche quand la page s'affichait en japonais. Gardé s'il diffère.
      nameOriginal: d.name && d.name !== dEn?.name ? d.name : null,
      shortDescription: stripHtml(d.short_description).slice(0, 600),
      // Le même résumé en anglais : c'est celui qu'attend le formulaire d'IGDB,
      // dont le catalogue est anglophone. Sans lui on proposait de soumettre un
      // texte français, que la modération aurait refusé ou réécrit.
      shortDescriptionEn: stripHtml(dEn?.short_description).slice(0, 600),
      description: stripHtml(d.detailed_description).slice(0, 8000),
      cover: await findCover(id),
      header: d.header_image || null,
      background: d.background_raw || d.background || null,
      screenshots: (d.screenshots || []).slice(0, 20).map((s) => ({
        thumb: s.path_thumbnail || null,
        full: s.path_full || s.path_thumbnail || null,
        w: null,
        h: null,
      })),
      videos: (d.movies || [])
        .slice(0, 6)
        .map((v) => v.mp4?.max || v.mp4?.["480"] || null)
        .filter(Boolean),
      // Steam laisse traîner des espaces dans ces champs saisis à la main
      // (« ␣Rubika Supinfogame ») : sans `trim`, le studio ne se recoupe avec
      // rien — ni son logo, ni sa page, ni les autres jeux qu'il a faits.
      developers: clean(d.developers),
      publishers: clean(d.publishers),
      genres: clean((d.genres || []).map((g) => g.description)),
      oses,
      website: d.website || null,
      releaseDate,
      releaseHuman,
      comingSoon: !!d.release_date?.coming_soon,
      isFree: !!d.is_free,
      appType: d.type || "game",
    };
  });

  return data || null;
}
