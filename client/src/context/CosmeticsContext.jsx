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
function cursorValue(cursor) {
  if (!cursor?.data?.url) return null;
  const x = Number(cursor.data.hotspotX) || 0;
  const y = Number(cursor.data.hotspotY) || 0;
  return `url("${cursor.data.url}") ${x} ${y}`;
}

function applyCursor(cursor) {
  const root = document.documentElement;
  const value = cursorValue(cursor);
  if (!value) {
    // Retour au curseur pixel d'origine : on retire la surcharge, la valeur
    // par défaut de la feuille de style reprend d'elle-même.
    root.style.removeProperty("--cursor-default");
    root.style.removeProperty("--cursor-pointer");
    return;
  }
  root.style.setProperty("--cursor-default", value);
  root.style.setProperty("--cursor-pointer", value);
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
