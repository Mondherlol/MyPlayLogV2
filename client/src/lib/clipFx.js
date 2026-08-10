import { useEffect, useMemo, useRef, useState } from "react";
import { canApplyEffects, renderVoice } from "./voiceFx";

// ======================================================================
//  Rejouer un enregistrement DÉGUISÉ
// ======================================================================
// Le Perroquet attache un effet de voix à certains sons de la banque (« Wall-E »
// veut une voix de robot, cf. server/src/models/SoundClip.js). À la révélation,
// c'est LA VOIX DU JOUEUR qui passe par l'effet : on vient de crier normalement,
// et on s'entend en robot. C'est là qu'on rit — et c'est tout l'intérêt de ne
// pas l'appliquer plus tôt.
//
// ------------------------------------------------- pourquoi À LA LECTURE
// Rien n'est transformé à l'enregistrement, ni au stockage :
//
//   - LE BARÈME NOTE LA VOIX BRUTE. Tout le score tient à la courbe de hauteur
//     (server/src/lib/soundContour.js) ; un modulateur en anneau la démolit. Une
//     voix déguisée avant mesure obtiendrait des points au hasard, et le
//     déguisement — censé être une blague — deviendrait une pénalité.
//   - LE FICHIER GARDÉ RESTE LA VOIX. Changer l'effet d'un son demain n'invalide
//     donc aucune archive, et l'onglet « sons des joueurs » de l'admin fait
//     entendre ce qui a réellement été crié.
//
// Le rendu se fait dans le navigateur, hors-ligne (lib/voiceFx.js) : quelques
// dizaines de millisecondes pour un cri de deux secondes. Assez rapide pour que
// la révélation attende le résultat sans qu'on le remarque, ce qui est le bon
// arbitrage — mieux vaut 80 ms de plus que d'entendre la voix nue là où la
// blague était promise.

// Les rendus déjà faits, réutilisés d'une écoute à l'autre : on réécoute
// beaucoup dans ce jeu (c'est le principe), et refaire le rendu à chaque clic
// ferait ramer la révélation d'un versus à six.
//
// Borné et purgé du plus ancien : un objet-URL retient son blob en mémoire
// jusqu'à révocation, et une partie de vingt manches en fabriquerait autant.
const CACHE_MAX = 24;
// `${url}|${effet}` -> { url: objet-URL, span: part du rendu qui porte la voix }
const cache = new Map();

function remember(key, entry) {
  cache.set(key, entry);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    URL.revokeObjectURL(cache.get(oldest).url);
    cache.delete(oldest);
  }
}

// Ce qu'on sait d'un enregistrement déguisé : où l'écouter, et sur quelle
// fraction de sa durée la voix parle encore. `span` vaut 1 partout sauf pour la
// cathédrale, dont la queue résonne après le dernier mot — et c'est cette
// fraction qui permet à la courbe de suivre LA VOIX plutôt que la durée totale.
const AS_IS = (url) => ({ url, span: 1 });

/**
 * L'URL de `url` passée à l'effet, ou `url` elle-même si rien n'est à faire
 * (pas d'effet, navigateur incapable, fichier illisible).
 *
 * NE JETTE JAMAIS : un effet est un ornement. S'il échoue on entend la voix
 * telle quelle, ce qui est exactement ce qui se passait avant qu'il existe.
 */
export async function effectedClip(url, effectId) {
  if (!url || !effectId || effectId === "none" || !canApplyEffects()) return AS_IS(url);
  const key = `${url}|${effectId}`;
  const known = cache.get(key);
  if (known) return known;
  try {
    const res = await fetch(url);
    if (!res.ok) return AS_IS(url);
    const out = await renderVoice(await res.blob(), { effectId });
    if (!out?.blob) return AS_IS(url);
    const entry = {
      url: URL.createObjectURL(out.blob),
      span: out.voiceRatio || 1,
    };
    remember(key, entry);
    return entry;
  } catch {
    return AS_IS(url);
  }
}

/** La même chose quand seule l'URL intéresse l'appelant (un bouton d'écoute). */
export async function effectedUrl(url, effectId) {
  return (await effectedClip(url, effectId)).url;
}

const NO_SWAP = new Map();

/**
 * Prépare plusieurs enregistrements d'un coup (la révélation d'un versus en
 * joue jusqu'à six) et rend :
 *
 *   fx(url)  l'URL à jouer à la place de `url`
 *   ready    tous les rendus sont faits — sert à RETENIR la séquence de lecture
 *            le temps du rendu. Sans ce verrou, la bande-son démarre sur la voix
 *            nue et l'effet n'arrive qu'au deuxième passage : la blague tombe à
 *            l'eau précisément la fois où elle comptait.
 *
 * `ready` vaut vrai tout de suite quand il n'y a pas d'effet : le cas normal ne
 * doit rien attendre.
 */
export function useEffectedUrls(urls, effectId) {
  const list = useMemo(() => (urls || []).filter(Boolean), [urls]);
  // Les tableaux changent d'identité à chaque rendu ; c'est leur CONTENU qui
  // décide s'il y a quelque chose à refaire. La clé sert de dépendance, la
  // référence sert à lire la liste — on ne la reconstruit PAS depuis la clé, ce
  // qui casserait sur une URL contenant le séparateur.
  const key = list.join("|");
  const listRef = useRef(list);
  listRef.current = list;

  const active = !!effectId && effectId !== "none";
  const [state, setState] = useState(() => ({ map: NO_SWAP, ready: !active }));

  useEffect(() => {
    if (!active || !key) {
      setState({ map: NO_SWAP, ready: true });
      return undefined;
    }
    let alive = true;
    setState({ map: NO_SWAP, ready: false });
    Promise.all(
      listRef.current.map(async (u) => [u, await effectedClip(u, effectId)])
    ).then((pairs) => {
      if (alive) setState({ map: new Map(pairs), ready: true });
    });
    return () => {
      alive = false;
    };
  }, [key, effectId, active]);

  return {
    fx: (u) => (u ? state.map.get(u)?.url || u : u),
    // La part de la lecture pendant laquelle la voix parle encore : à passer à
    // la bande-son pour que la courbe ne se traîne pas pendant la réverbération.
    spanOf: (u) => (u ? state.map.get(u)?.span || 1 : 1),
    ready: state.ready,
  };
}
