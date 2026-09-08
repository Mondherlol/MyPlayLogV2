// ======================================================================
//  La boutique de Valorant — la VITRINE, pas le magasin personnel
// ======================================================================
// ⚠️ LA DISTINCTION EST TOUT LE MODULE, ET ELLE N'EST PAS NÉGOCIABLE.
//
// Ce qu'un joueur appelle « mon shop du jour » — les quatre skins proposés
// rien qu'à lui, renouvelés toutes les 24 h — appartient à SON compte. Riot ne
// l'expose par aucune API publique : les « store checkers » passent par les
// endpoints internes du client de jeu, avec les identifiants Riot de
// l'utilisateur, ce que Riot classe explicitement comme usage non approuvé et
// qui peut coûter le compte. On ne le fait pas, et ce n'est pas un manque de
// courage : on n'a aucun droit de demander son mot de passe Riot à quelqu'un
// pour lui éviter d'ouvrir son jeu.
//
// Ce qu'on peut montrer honnêtement, c'est la VITRINE : le pack mis en avant
// dans la boutique, identique pour tous les joueurs du monde, avec ses skins,
// ses prix et le temps qu'il lui reste. C'est ce que sert HenrikDev — dont
// l'endpoint s'appelle d'ailleurs « store (no daily stores) ».
//
// -------------------------------------------------------------- deux sources
//   1. HenrikDev (clé gratuite, VALORANT_API_KEY) — QUEL pack est en vitrine,
//      à quel prix, jusqu'à quand.
//   2. valorant-api.com (sans clé) — CE QU'EST ce pack : son nom, son visuel.
//      HenrikDev ne renvoie que son uuid.
//
// Sans clé, le module se déclare non configuré et la fiche du jeu n'affiche
// simplement pas la section — jamais un bloc vide ni une erreur.

import { createTtlCache } from "./ttlCache.js";

const HENRIK_FEATURED = "https://api.henrikdev.xyz/valorant/v2/store-featured";
const VALAPI_BUNDLE = "https://valorant-api.com/v1/bundles";

// La vitrine tourne une fois par jour ; une heure de cache est déjà dix fois
// plus fin que la source, et met le service à l'abri d'un rail qu'on fait
// défiler. Le cache est partagé par tous les joueurs : la vitrine est la même
// pour tout le monde, c'est précisément ce qui la rend affichable.
const cache = createTtlCache({ max: 8, ttl: 3600_000, name: "valorant-store" });

export function isConfigured() {
  return Boolean(process.env.VALORANT_API_KEY);
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers } });
  if (!res.ok) throw new Error(`${url.split("/").slice(2, 3)} ${res.status}`);
  return res.json();
}

/** Le nom et le visuel du pack, que HenrikDev ne donne pas. */
async function bundleInfo(uuid, language = "fr-FR") {
  try {
    const d = await getJson(`${VALAPI_BUNDLE}/${uuid}?language=${language}`);
    return {
      name: d?.data?.displayName || null,
      image: d?.data?.displayIcon || d?.data?.verticalPromoImage || null,
    };
  } catch {
    // Le pack reste affichable sans son nom : ce sont ses skins qu'on vient
    // voir, et ils viennent de l'autre source.
    return { name: null, image: null };
  }
}

/**
 * La vitrine du moment.
 *
 * Rend `null` quand la source ne renvoie aucun pack — ce qui arrive pendant
 * les quelques minutes de bascule quotidienne. `null` n'est pas une erreur :
 * la fiche n'affiche alors rien, ce qui vaut mieux qu'un pack périmé.
 */
export async function featuredStore({ language = "fr-FR" } = {}) {
  if (!isConfigured()) return null;

  return cache.remember(`featured:${language}`, async () => {
    const d = await getJson(HENRIK_FEATURED, {
      Authorization: process.env.VALORANT_API_KEY,
    });
    const bundle = (d?.data?.FeaturedBundle?.Bundles || d?.data || [])[0];
    if (!bundle) return null;

    const uuid = bundle.bundle_uuid || bundle.uuid || null;
    const info = uuid ? await bundleInfo(uuid, language) : { name: null, image: null };

    const seconds = Number(bundle.seconds_remaining) || 0;
    return {
      uuid,
      name: info.name,
      image: info.image,
      price: Number(bundle.bundle_price) || null,
      // On rend une DATE, pas un décompte. Un « il reste 43 200 s » calculé sur
      // le serveur vieillit dans le cache et se retrouve faux d'une heure à
      // l'écran ; une date d'expiration, elle, reste vraie (cf. le décompte
      // côté client, comme pour les événements).
      expiresAt: bundle.expires_at
        ? new Date(bundle.expires_at).toISOString()
        : seconds
          ? new Date(Date.now() + seconds * 1000).toISOString()
          : null,
      items: (bundle.items || [])
        .map((it) => ({
          uuid: it.uuid || null,
          name: it.name || "",
          image: it.image || null,
          type: it.type || null,
          basePrice: Number(it.base_price) || null,
          price: Number(it.discounted_price) || null,
          discount: Number(it.discount_percent) || 0,
        }))
        // Les skins d'abord : un pack contient aussi des porte-bonheurs et des
        // sprays, qui ne sont pas ce qu'on vient regarder.
        .sort((a, b) => (b.basePrice || 0) - (a.basePrice || 0))
        .slice(0, 12),
    };
  });
}
