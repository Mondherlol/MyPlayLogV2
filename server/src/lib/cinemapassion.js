// ======================================================================
//  Cinéma Passion — les jaquettes DVD / Blu-ray dépliées
// ======================================================================
// LE PROBLÈME QUE ÇA RÉSOUT. Le boîtier 3D de la collection se peint avec une
// jaquette DÉPLIÉE (dos + tranche + couverture d'un seul tenant). Ce n'est pas
// ce que servent TMDB ou TVmaze — eux ne connaissent que l'affiche portrait.
// Il fallait donc aller chercher l'objet ailleurs, à la main, et cinemapassion
// est le fonds francophone de référence : des milliers de jaquettes scannées,
// en pleine définition, avec les éditions (SLIM, coffret, Blu-ray, custom).
//
// CE QU'ON PREND, ET COMMENT. Deux pages, rien de plus :
//
//   • `moteur2.php` en POST (le formulaire du site) renvoie une page de
//     résultats découpée en sections. Seuls les liens `jaquettesdvd/…` nous
//     intéressent — le reste, ce sont des fiches de films et des stickers.
//   • la page d'une jaquette porte l'image en clair dans un `<img>`, et cette
//     image EST la pleine définition (le site la rétrécit à l'affichage avec
//     des attributs `width`/`height`, d'où le rapport qu'on relève au passage
//     pour dessiner la vignette du sélecteur sans avoir à charger l'image).
//
// Rien n'est enregistré ici : la route renvoie des ADRESSES, et c'est le
// chemin d'import déjà en place (`downloadArtwork`) qui rapatrie celle que
// l'admin a désignée. Une source de plus, pas un circuit de plus.
//
// LATIN-1. Le site est en iso-8859-1 et l'annonce dans ses en-têtes. Lu en
// UTF-8, « Amélie » revient en « Am?lie » — et c'est le TITRE, la seule chose
// qui permette de reconnaître la bonne édition dans une liste de trente.

const BASE = "https://www.cinemapassion.com/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Au-delà, ce n'est plus une recherche : c'est un catalogue qu'on fait défiler.
const MAX_RESULTS = 60;
// Les pages d'une jaquette ne changent jamais : une fois relue, on la garde
// pour la session. Ce cache est ce qui rend la deuxième recherche instantanée
// (« Matrix » en aligne trente et une, et on y revient en tâtonnant).
const MAX_CACHE = 800;
const imageCache = new Map();

// Le chemin d'une jaquette, tel qu'il sort de la page de résultats. Validé
// AVANT toute requête : sans ce filet, le chemin renvoyé par le client
// deviendrait une URL arbitraire à faire visiter au serveur.
const PAGE_RE = /^jaquettesdvd\/[A-Za-z0-9%._'()!,+-]+\.php$/;

export const isJaquettePage = (p) => PAGE_RE.test(String(p || ""));

// Le site répond en iso-8859-1 : on décode nous-mêmes, `r.text()` supposerait
// de l'UTF-8 et abîmerait tous les accents.
async function getPage(url, init) {
  const r = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      "Accept-Language": "fr-FR,fr;q=0.9",
      ...(init?.headers || {}),
    },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`cinemapassion ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return new TextDecoder("iso-8859-1").decode(buf);
}

// Les entités HTML des titres (&amp;, &#39;, &eacute;…). Le site en sème peu,
// mais un « Marley &amp; moi » affiché tel quel se remarque tout de suite.
const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
function decodeText(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s{2,}/g, " ")
    .trim();
}

// L'édition se lit dans le titre, et c'est SOUVENT elle qu'on cherche : entre
// « Matrix », « Matrix - SLIM » et « Matrix (BLU-RAY) », la bonne est celle du
// boîtier qu'on est en train de poser. On la sort du titre pour en faire une
// pastille, plutôt que de laisser l'œil la repêcher dans trente lignes.
function editionOf(title) {
  const t = title.toLowerCase();
  if (/blu-?ray/.test(t)) return "Blu-ray";
  if (/\b4k\b|ultra hd/.test(t)) return "4K";
  if (/coffret|trilogie|integrale|intégrale/.test(t)) return "Coffret";
  if (/\bslim\b/.test(t)) return "Slim";
  if (/custom/.test(t)) return "Custom";
  return "";
}

// GET la page de résultats, et n'en garder que les jaquettes.
//
// Le site range ses réponses par famille (Films, Bandes annonces, Jaquettes
// DVD, Stickers) mais sans conteneur autour de chacune : les sections ne sont
// séparées que par un titre. Inutile de découper — le PRÉFIXE du lien suffit à
// reconnaître une jaquette, et il est le même pour les Blu-ray.
export async function searchJaquettes(query) {
  const q = String(query || "").trim();
  if (q.length < 2) return [];

  const html = await getPage(`${BASE}moteur2.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    // Le formulaire du site poste en latin-1 ; `URLSearchParams` encode en
    // UTF-8. Pour les accents d'une recherche (« amélie »), le site s'en
    // accommode — il cherche sur une forme normalisée.
    body: new URLSearchParams({ recherche: q }).toString(),
  });

  const out = [];
  const seen = new Set();
  const re = /href=['"]([^'"]*jaquettesdvd\/[^'"]+\.php)['"][^>]*>([^<]*)</gi;
  let m;
  while ((m = re.exec(html)) && out.length < MAX_RESULTS) {
    const page = m[1].replace(/^\.?\//, "");
    if (!isJaquettePage(page) || seen.has(page)) continue;
    seen.add(page);
    const title = decodeText(m[2]);
    if (!title) continue;
    out.push({ page, title, edition: editionOf(title) });
  }
  return out;
}

// L'image d'UNE jaquette. La page en contient d'autres (bandeaux du site,
// vignettes de la colonne de droite) : celle qu'on veut est dans le dossier
// des couvertures, et son `alt` commence par « Jaquette ».
export async function jaquetteImage(page) {
  if (!isJaquettePage(page)) return null;
  if (imageCache.has(page)) return imageCache.get(page);

  let found = null;
  try {
    const html = await getPage(BASE + page);
    const re = /<img[^>]+>/gi;
    let m;
    while ((m = re.exec(html))) {
      const tag = m[0];
      const src = /\bsrc=['"]([^'"]+)['"]/i.exec(tag)?.[1];
      if (!src) continue;
      // Les miniatures de la colonne de droite passent par `miniature.php` :
      // ce sont des images de 140 px, pas des jaquettes.
      if (/miniature\d*\.php/i.test(src)) continue;
      // Deux repères plutôt qu'un : le dossier des couvertures (il a changé de
      // nom plusieurs fois — covers, covers3, coverstemp5…) et le texte de
      // remplacement, que le site écrit toujours « Jaquette DVD … ».
      const alt = /\balt=['"]([^'"]*)['"]/i.exec(tag)?.[1] || "";
      if (!/\/covers/i.test(src) && !/^jaquette/i.test(alt.trim())) continue;
      const w = Number(/\bwidth=['"]?(\d+)/i.exec(tag)?.[1] || 0);
      const h = Number(/\bheight=['"]?(\d+)/i.exec(tag)?.[1] || 0);
      found = {
        // Le site sert ses images en http dans son propre HTML ; on remonte
        // en https, sinon le navigateur bloque la vignette sur une page qui,
        // elle, est servie en sécurisé.
        image: src.replace(/^http:\/\//i, "https://"),
        // Le rapport de l'image, relevé sur les attributs d'affichage : il
        // permet à la vignette du sélecteur de garder la forme de l'objet
        // (une jaquette dépliée est large, une affiche est haute) sans avoir
        // à charger le fichier pour le savoir.
        ratio: w > 0 && h > 0 ? Number((w / h).toFixed(4)) : null,
      };
      break;
    }
  } catch {
    found = null;
  }

  // Les échecs sont mis en cache eux aussi : une page morte le reste, et sans
  // ça chaque affichage de la liste la redemanderait.
  if (imageCache.size > MAX_CACHE) imageCache.clear();
  imageCache.set(page, found);
  return found;
}

// Les images de PLUSIEURS jaquettes d'un coup — une page par résultat, donc
// une trentaine de requêtes pour une recherche large. Elles partent par petits
// paquets : d'un seul bloc on se ferait rejeter, une par une on attendrait
// trente allers-retours.
export async function jaquetteImages(pages, concurrency = 6) {
  const list = [...new Set((pages || []).filter(isJaquettePage))].slice(0, MAX_RESULTS);
  const out = {};
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const page = list[i++];
      out[page] = await jaquetteImage(page);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return out;
}
