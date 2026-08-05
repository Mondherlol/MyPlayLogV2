import * as THREE from "three";
import { paintCase, boxOf } from "./collection";

// ======================================================================
//  Le magasin de jaquettes — peinture, cache, ordonnancement
// ======================================================================
// UNE JAQUETTE COÛTE CHER ET NE CHANGE JAMAIS. Deux requêtes réseau (affiche,
// bandeau), un décodage, trois canvas peints à la main, une texture montée sur
// le GPU : entre un dixième et une demi-seconde par boîtier. C'est acceptable
// une fois. Ça ne l'est pas à chaque frappe dans le champ de recherche, ni à
// chaque retour sur la page — et c'était pourtant ce qui se passait, la
// peinture vivant dans un effet du composant, refaite dès que la liste changeait
// d'identité.
//
// Tout passe donc par ici, et trois règles :
//
//   1. UNE SEULE PEINTURE PAR BOÎTIER, gardée pour la session (`CACHE`). Un
//      filtre, un tri, un aller-retour vers une fiche : les boîtiers déjà peints
//      reviennent instantanément, sans réseau ni canvas.
//   2. EN FRONT, PAS EN FILE. Les jaquettes partaient une par une, chacune
//      attendant que la précédente ait fini son aller-retour réseau — vingt
//      boîtiers = vingt latences bout à bout. Elles partent maintenant par
//      groupes (`LANES`), ce qui met le réseau à profit au lieu de l'attendre.
//   3. ON N'AFFICHE RIEN À MOITIÉ. Le composant attend le lot complet avant de
//      montrer l'étagère (voir CollectionShelf) : c'est ce cache qui rend
//      l'attente assez courte pour que ce soit tenable.
//
// Les textures ne sont PAS libérées au démontage : c'est tout l'intérêt. Le
// magasin se borne lui-même (`trim`), en protégeant ce qui est à l'écran.

// Définition de peinture, en pixels de hauteur de feuille.
//
// LE RAYON N'A PAS BESOIN DE 1024. Un boîtier occupe au mieux 300 px de haut à
// l'écran (600 sur un écran dense) : au-delà de 640, on peint quatre fois plus
// de pixels que l'écran n'en montrera jamais, on remplit la mémoire vidéo pour
// rien et on paie le tout au premier affichage. La vitrine, elle, montre l'objet
// plein cadre et le laisse zoomer : elle repeint le seul boîtier qu'on tient,
// en grand, pendant qu'il vole (voir `HI_QUALITY` côté vitrine).
export const SHELF_QUALITY = 640;
export const HI_QUALITY = 1408;

// Combien de jaquettes en vol en même temps. Six : au-delà, le navigateur met
// de toute façon les requêtes en attente (six connexions par hôte) et les
// canvas se marchent dessus sur le fil principal.
const LANES = 6;

// Ce que le magasin garde en réserve. Une jaquette pèse ~1,5 Mo en mémoire à la
// définition du rayon : au-delà de cette réserve, les plus anciennes NON
// AFFICHÉES sont rendues. Une collection ordinaire tient entièrement dedans —
// la borne n'existe que pour les très grandes, et pour la vitrine qui ajoute des
// exemplaires haute définition.
const MAX_KEPT = 120;

// clé de cache : le boîtier ET ce qui le dessine. Deux titres différents ne
// partagent jamais une jaquette ; un même titre dont l'affiche a changé (retouche
// dans le panneau d'admin) en repeint une, sans qu'il y ait rien à invalider.
function keyOf(media, quality) {
  const box = boxOf(media);
  return [
    media.slug,
    quality,
    media.wrap || "",
    media.poster || "",
    media.backdrop || "",
    // Les dimensions taillent la feuille : un boîtier remesuré n'est plus le
    // même objet, et sa jaquette n'a plus les mêmes proportions.
    `${box.w}x${box.h}x${box.d}`,
  ].join("|");
}

// key -> { promise, art, at } — `at` est la dernière fois qu'on s'en est servi.
const CACHE = new Map();

function touch(key, entry) {
  entry.at = Date.now();
  // Map garde l'ordre d'insertion : la ressortir la remet en queue, ce qui fait
  // de l'itération un ordre d'ancienneté d'usage — un LRU sans structure à part.
  CACHE.delete(key);
  CACHE.set(key, entry);
}

// LA JAQUETTE D'UN BOÎTIER, peinte une fois pour toutes. Renvoie toujours la
// même promesse pour la même clé : deux scènes qui réclament le même titre en
// même temps (le rayon et la vitrine) ne le peignent pas deux fois.
export function caseArt(media, quality = SHELF_QUALITY) {
  const key = keyOf(media, quality);
  const hit = CACHE.get(key);
  if (hit) {
    touch(key, hit);
    return hit.promise;
  }

  const entry = { promise: null, art: null, at: Date.now() };
  entry.promise = (async () => {
    const painted = await paintCase(media, quality);
    // `Texture` et non `CanvasTexture` : la feuille peut être un canvas
    // (jaquette composée) comme une image (jaquette fournie telle quelle,
    // qu'on ne recopie plus dans un canvas pour rien).
    const sheet = new THREE.Texture(painted.sheet);
    sheet.colorSpace = THREE.SRGBColorSpace;
    sheet.anisotropy = 8;
    sheet.needsUpdate = true;
    entry.art = { sheet, cuts: painted.cuts, artwork: !!painted.artwork };
    return entry.art;
  })();
  CACHE.set(key, entry);
  return entry.promise;
}

// Ce qui est DÉJÀ prêt, tout de suite et sans promesse : de quoi dresser
// l'étagère au premier rendu quand on revient dessus, plutôt que de repasser par
// un état d'attente pour des jaquettes qu'on a en main.
export function readyArt(list, quality = SHELF_QUALITY) {
  const out = {};
  for (const m of list) {
    const hit = CACHE.get(keyOf(m, quality));
    if (hit?.art) out[m.slug] = hit.art;
  }
  return out;
}

export function isReady(list, quality = SHELF_QUALITY) {
  return list.every((m) => CACHE.get(keyOf(m, quality))?.art);
}

// TOUT UN RAYON, EN FRONT. Les boîtiers partent par groupes de `LANES` ; le
// résultat n'est rendu qu'à la fin, et l'avancement au fil de l'eau (pour la
// jauge du squelette, seule chose qui bouge pendant ce temps-là).
//
// `alive` coupe court : changer de filtre pendant le chargement ne doit pas
// laisser tourner un lot devenu inutile.
export async function dressAll(
  list,
  { quality = SHELF_QUALITY, onProgress, onPainted, alive = () => true } = {}
) {
  const out = {};
  let cursor = 0;
  let done = 0;

  async function lane() {
    while (cursor < list.length && alive()) {
      const m = list[cursor++];
      try {
        const art = await caseArt(m, quality);
        out[m.slug] = art;
        // Prête, mais pas encore montée sur la carte graphique : c'est le
        // rayon qui s'en charge, au fil de l'eau (voir `Warmer`).
        onPainted?.(art);
      } catch {
        /* une jaquette qui ne se peint pas laisse un boîtier nu, pas une
           étagère bloquée : le rayon compte les manquantes et le dit. */
      }
      done += 1;
      onProgress?.(done, list.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(LANES, list.length) }, () => lane())
  );
  return out;
}

// LE RESTE DU RAYON, PENDANT QU'ON REGARDE. Les titres masqués par le filtre
// courant se peignent au ralenti (deux fronts, et seulement quand le navigateur
// n'a rien de mieux à faire) : quand on retire le filtre, l'étagère est déjà
// prête. Rien n'attend ce travail — il s'interrompt sans conséquence.
export function prefetch(list, quality = SHELF_QUALITY) {
  const todo = list.filter((m) => !CACHE.get(keyOf(m, quality))?.art);
  if (!todo.length || CACHE.size > MAX_KEPT) return;
  const idle =
    window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 300));
  let cursor = 0;
  const step = () => {
    if (cursor >= todo.length) return;
    caseArt(todo[cursor++], quality).finally(() => idle(step));
  };
  idle(step);
  idle(step);
}

// Rendre la mémoire des jaquettes qu'on ne montre plus — les moins récemment
// servies d'abord (l'ordre de `Map`, entretenu par `touch`).
//
// `keep` est ce qui est à l'écran À CET INSTANT, tel que le composant l'a en
// main : une texture libérée alors qu'un matériau s'en sert laisse un boîtier
// noir, et c'est la seule erreur qu'un cache de ce genre puisse commettre.
export function trim(keep = []) {
  if (CACHE.size <= MAX_KEPT) return;
  const spared = new Set(keep);
  for (const [key, entry] of CACHE) {
    if (CACHE.size <= MAX_KEPT) break;
    if (spared.has(entry.art)) continue;
    entry.art?.sheet?.dispose();
    CACHE.delete(key);
  }
}
