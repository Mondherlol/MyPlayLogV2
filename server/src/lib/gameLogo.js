// ======================================================================
//  Le logo d'un jeu, rogné au plus près du dessin
// ======================================================================
//
// Le logo vient de Steam (`/steam/apps/<appid>/logo.png`), et Steam ne le
// livre pas cadré : certains fichiers portent une marge transparente énorme
// autour du dessin. Posé en `contain` dans une case, le logo ne remplit alors
// qu'un coin de sa place — sur l'accueil et sur la fiche, on voyait des logos
// minuscules à côté d'autres bien lisibles.
//
// L'app ne sait pas lire les pixels d'une image : c'est donc ici qu'on rogne,
// UNE fois par jeu. Le résultat est gardé sur le disque — un logo ne change
// pas — et servi par GET /api/games/logo/:appid.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "../../cache/logos");

// Un jeu Steam sans logo répond 404 : on s'en souvient une semaine, sinon
// chaque carte qui l'affiche relancerait la même requête pour rien.
const MISS_TTL = 7 * 24 * 3600 * 1000;
const MISS_MAX = 5000;
const misses = new Map(); // appid -> instant du 404
// Dix cartes qui demandent le même logo au même instant : un seul
// téléchargement, un seul rognage.
const inflight = new Map(); // appid -> Promise<Buffer | null>

// La plus grande taille servie. Un logo Steam fait 640 px de large au mieux ;
// la borne ne fait que protéger d'un fichier aberrant.
const MAX_W = 1000;
const MAX_H = 500;

export const steamLogoSource = (appid) =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/logo.png`;

/** Le chemin PUBLIC du logo rogné, relatif à l'API (`/api`). */
export const logoPath = (appid) => `/games/logo/${appid}`;

async function trim(input) {
  try {
    // `trim` prend le pixel du coin haut-gauche comme fond : sur un logo
    // détouré, c'est la transparence — exactement ce qu'on veut retirer. Le
    // seuil tolère un halo presque invisible laissé par l'export.
    return await sharp(input)
      .trim({ threshold: 10 })
      .resize({ width: MAX_W, height: MAX_H, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    // Image uniforme (rien à rogner) ou format inattendu : `trim` lève. Le
    // logo d'origine vaut toujours mieux que pas de logo.
    return input;
  }
}

/** Le PNG rogné du logo Steam de cet appid, ou null s'il n'existe pas. */
export async function trimmedLogo(appid) {
  const id = String(appid || "");
  if (!/^\d{1,10}$/.test(id)) return null;

  const file = path.join(DIR, `${id}.png`);
  try {
    return await fs.readFile(file);
  } catch {
    /* pas encore rogné */
  }

  const miss = misses.get(id);
  if (miss && Date.now() - miss < MISS_TTL) return null;
  if (inflight.has(id)) return inflight.get(id);

  const job = (async () => {
    try {
      const res = await fetch(steamLogoSource(id), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        // Seul un VRAI « pas de logo » est retenu ; une panne réseau, non.
        if (res.status === 404 || res.status === 403) {
          if (misses.size >= MISS_MAX) misses.clear();
          misses.set(id, Date.now());
        }
        return null;
      }
      const out = await trim(Buffer.from(await res.arrayBuffer()));
      await fs.mkdir(DIR, { recursive: true });
      await fs.writeFile(file, out).catch(() => {});
      return out;
    } catch {
      return null;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, job);
  return job;
}
