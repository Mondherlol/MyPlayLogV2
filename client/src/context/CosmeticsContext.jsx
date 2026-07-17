import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "./AuthContext";

// ======================================================================
//  Cosmétiques équipés — applique le curseur gagné à l'arcade.
// ======================================================================
// Le curseur par défaut est posé en CSS (index.css) via deux variables ; on se
// contente ici de les SURCHARGER sur <html> quand un curseur est équipé. Rien
// à recalculer, aucun re-rendu : le navigateur reprend la main.
//
// Pour brancher une future famille (ornement, badge), il n'y a rien à faire
// ici : `cosmetics.ornament` est déjà exposé, il suffit de le lire là où on
// veut le peindre.
const CosmeticsContext = createContext({ cosmetics: {}, setCosmetic: () => {} });

// Valeur d'une variable CSS de curseur : `url("…") x y`. Le point actif
// (hotspot) est là où « clique » vraiment la pointe de l'image.
function frameValue(url, x, y) {
  return `url("${url}") ${x} ${y}`;
}

function setCursorVars(value) {
  const root = document.documentElement;
  root.style.setProperty("--cursor-default", value);
  root.style.setProperty("--cursor-pointer", value);
}

// Timer de l'animation en cours (curseur .ani). Un seul à la fois : on le coupe
// à chaque changement de curseur.
let cursorAnim = null;
function clearCursorAnim() {
  if (cursorAnim) {
    clearTimeout(cursorAnim);
    cursorAnim = null;
  }
}

function applyCursor(cursor) {
  clearCursorAnim();
  const root = document.documentElement;
  const data = cursor?.data;
  if (!data?.url) {
    // Retour au curseur pixel d'origine : on retire la surcharge, la valeur
    // par défaut de la feuille de style reprend d'elle-même.
    root.style.removeProperty("--cursor-default");
    root.style.removeProperty("--cursor-pointer");
    return;
  }
  const x = Number(data.hotspotX) || 0;
  const y = Number(data.hotspotY) || 0;
  const frames =
    data.animated && Array.isArray(data.frames) && data.frames.length > 1
      ? data.frames
      : null;
  if (!frames) {
    setCursorVars(frameValue(data.url, x, y));
    return;
  }
  // Curseur animé (.ani) : on cycle la variable CSS d'une image à l'autre.
  // Préchargement pour éviter tout clignotement au premier tour.
  frames.forEach((u) => {
    const im = new Image();
    im.src = u;
  });
  const durations =
    Array.isArray(data.durationsMs) && data.durationsMs.length === frames.length
      ? data.durationsMs
      : frames.map(() => 100);
  let i = 0;
  const tick = () => {
    setCursorVars(frameValue(frames[i], x, y));
    const d = Math.max(16, durations[i] || 100);
    i = (i + 1) % frames.length;
    cursorAnim = setTimeout(tick, d);
  };
  tick();
}

export function CosmeticsProvider({ children }) {
  const { token, user } = useAuth();
  const [cosmetics, setCosmetics] = useState({});

  useEffect(() => {
    if (!token) {
      setCosmetics({});
      applyCursor(null); // déconnexion : on rend son curseur au visiteur
      return;
    }
    let alive = true;
    apiFetch("/arcade/cosmetics", { token })
      .then((d) => {
        if (!alive) return;
        setCosmetics(d.cosmetics || {});
        applyCursor(d.cosmetics?.cursor || null);
      })
      .catch(() => {
        /* pas de cosmétiques : l'app garde son apparence par défaut */
      });
    return () => {
      alive = false;
    };
    // `user?.id` : on refait le tour après une reconnexion sur un autre compte.
  }, [token, user?.id]);

  // Coupe l'animation du curseur au démontage (évite un timer orphelin).
  useEffect(() => () => clearCursorAnim(), []);

  // Appelé par l'arcade au moment d'équiper : effet immédiat, sans refetch.
  const setCosmetic = useCallback((type, reward) => {
    setCosmetics((c) => ({ ...c, [type]: reward || undefined }));
    if (type === "cursor") applyCursor(reward);
  }, []);

  return (
    <CosmeticsContext.Provider value={{ cosmetics, setCosmetic }}>
      {children}
    </CosmeticsContext.Provider>
  );
}

export const useCosmetics = () => useContext(CosmeticsContext);
