// ======================================================================
//  Noter sur 100, ou sur 5 étoiles
// ======================================================================
//
// ⚠️ CE N'EST QU'UNE FAÇON D'AFFICHER, PAS UNE AUTRE DONNÉE. La note reste
// enregistrée sur 100 en base, partout, pour tout le monde. Changer d'échelle
// ne convertit rien et ne perd rien : c'est le même nombre, montré autrement.
// Deux joueurs qui ont réglé l'app différemment voient donc la même note d'un
// même jeu, chacun dans son unité — et une note de 83 posée sur 100 s'affiche
// sans mentir en étoiles (4,15 étoiles remplies, pas 4 arrondi en douce).
//
// Le réglage vit dans le navigateur (comme le repli de la barre latérale ou le
// thème) : c'est un confort de lecture, pas une donnée de compte. L'évènement
// maison prévient les composants déjà à l'écran — sans lui, changer l'échéance
// dans les Paramètres ne se verrait qu'au prochain rechargement.

import { useEffect, useState } from "react";
import { safeSetItem } from "./storage";

const KEY = "mpl_rating_scale";
const EVENT = "mpl:rating-scale";

export const SCALE_100 = "100";
export const SCALE_STARS = "stars";

/** L'échelle choisie, « 100 » par défaut (celle de toujours). */
export function getRatingScale() {
  try {
    return localStorage.getItem(KEY) === SCALE_STARS ? SCALE_STARS : SCALE_100;
  } catch {
    // Navigation privée, stockage refusé : on note sur 100, comme avant.
    return SCALE_100;
  }
}

export function setRatingScale(scale) {
  const next = scale === SCALE_STARS ? SCALE_STARS : SCALE_100;
  safeSetItem(KEY, next);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

/** L'échelle courante, qui se met à jour toute seule quand elle change. */
export function useRatingScale() {
  const [scale, setScale] = useState(getRatingScale);
  useEffect(() => {
    const onLocal = (e) => setScale(e.detail || getRatingScale());
    // `storage` couvre l'autre onglet : le réglage change dans les Paramètres
    // d'un onglet, la modale ouverte dans un second doit suivre.
    const onStorage = (e) => {
      if (!e.key || e.key === KEY) setScale(getRatingScale());
    };
    window.addEventListener(EVENT, onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return scale;
}

// ---------------------------------------------------------------------------
//  Conversions
// ---------------------------------------------------------------------------

/** Une note sur 100 en étoiles (0 → 5), sans arrondir. */
export const toStars = (n) => (n == null ? null : n / 20);

/** Des étoiles (0 → 5) en note sur 100. */
export const fromStars = (s) => Math.round(Math.max(0, Math.min(5, s)) * 20);

/**
 * La note telle qu'on l'écrit, dans l'échelle demandée : « 83 » ou « 4,2 ».
 * La virgule ne s'affiche que si elle dit quelque chose — « 4 » plutôt que
 * « 4,0 ».
 */
export function formatRating(n, scale) {
  if (n == null) return null;
  if (scale !== SCALE_STARS) return String(Math.round(n));
  const s = Math.round((n / 20) * 10) / 10;
  return Number.isInteger(s) ? String(s) : s.toLocaleString("fr-FR");
}
