import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { CURSOR_ROLES } from "../lib/cursorRoles";
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
const CosmeticsContext = createContext({
  cosmetics: {},
  setCosmetic: () => {},
  testCursor: () => {},
  endTest: () => {},
});

// `data` (curseur équipé) → map { role: état }. Le rôle « normal » est à la
// racine (rétro-compat) ; les rôles en plus sont dans `data.roles`.
function resolveRoles(data) {
  const roles = {};
  if (data?.roles && typeof data.roles === "object") Object.assign(roles, data.roles);
  if (!roles.normal && data?.url)
    roles.normal = {
      url: data.url,
      hotspotX: data.hotspotX,
      hotspotY: data.hotspotY,
      frames: data.frames,
      durationsMs: data.durationsMs,
      animated: data.animated,
    };
  return roles;
}

// Pose une variable de rôle : `url("…") x y`. Les rôles « externes » (normal,
// survol) laissent index.css écrire le repli après la variable ; les autres
// l'intègrent (`…, text`).
function setRoleVar(role, state, frameUrl) {
  const x = Number(state.hotspotX) || 0;
  const y = Number(state.hotspotY) || 0;
  const base = `url("${frameUrl}") ${x} ${y}`;
  document.documentElement.style.setProperty(
    role.cssVar,
    role.external ? base : `${base}, ${role.fallback}`
  );
}

// Timers des animations en cours (un par rôle .ani). Chaque holder garde l'id
// courant pour qu'on puisse tout couper au changement de curseur.
let cursorAnims = [];
function clearCursorAnims() {
  cursorAnims.forEach((h) => clearTimeout(h.id));
  cursorAnims = [];
}

function applyCursor(cursor) {
  clearCursorAnims();
  const root = document.documentElement;
  const roles = resolveRoles(cursor?.data);
  if (!roles.normal?.url) {
    // Plus de curseur équipé : on retire toutes les surcharges, les valeurs
    // par défaut de la feuille de style reprennent d'elles-mêmes.
    for (const role of CURSOR_ROLES) root.style.removeProperty(role.cssVar);
    return;
  }
  for (const role of CURSOR_ROLES) {
    let state = roles[role.key];
    // Rôle jumeau (Saisir ⇄ Glisser) : il prête son image tant que celui-ci
    // n'a rien à lui. Un seul niveau de repli, donc pas de renvoi circulaire.
    if (!state?.url && role.twin && roles[role.twin]?.url) state = roles[role.twin];
    if (!state?.url) {
      // Rôle non assigné : on RETIRE la surcharge, il reprend son curseur par
      // défaut. Aucun rôle ne se rabat sur la flèche Normale : « Survol lien »
      // et « Survol déplaçable » restent deux choses DISTINCTES, chacune
      // réglable à part (sinon tout finirait par afficher la même flèche).
      root.style.removeProperty(role.cssVar);
      continue;
    }
    const frames =
      state.animated && Array.isArray(state.frames) && state.frames.length > 1
        ? state.frames
        : null;
    if (!frames) {
      setRoleVar(role, state, state.url);
      continue;
    }
    // Curseur animé (.ani) : on cycle la variable CSS d'une image à l'autre.
    // Préchargement pour éviter tout clignotement au premier tour.
    frames.forEach((u) => {
      const im = new Image();
      im.src = u;
    });
    const durations =
      Array.isArray(state.durationsMs) && state.durationsMs.length === frames.length
        ? state.durationsMs
        : frames.map(() => 100);
    const holder = { id: 0 };
    cursorAnims.push(holder);
    let i = 0;
    const tick = () => {
      setRoleVar(role, state, frames[i]);
      const d = Math.max(16, durations[i] || 100);
      i = (i + 1) % frames.length;
      holder.id = setTimeout(tick, d);
    };
    tick();
  }
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

  // Coupe les animations du curseur au démontage (évite un timer orphelin).
  useEffect(() => () => clearCursorAnims(), []);

  // Appelé par l'arcade au moment d'équiper : effet immédiat, sans refetch.
  const setCosmetic = useCallback((type, reward) => {
    setCosmetics((c) => ({ ...c, [type]: reward || undefined }));
    if (type === "cursor") applyCursor(reward);
  }, []);

  // Aperçu ÉPHÉMÈRE (panel admin) : applique un curseur sans toucher à ce qui
  // est équipé. `endTest` remet le curseur réellement équipé (ou celui par
  // défaut). Rien n'est persisté ; un rechargement rend l'apparence normale.
  const testCursor = useCallback((reward) => applyCursor(reward || null), []);
  const endTest = useCallback(
    () => applyCursor(cosmetics.cursor || null),
    [cosmetics.cursor]
  );

  return (
    <CosmeticsContext.Provider value={{ cosmetics, setCosmetic, testCursor, endTest }}>
      {children}
    </CosmeticsContext.Provider>
  );
}

export const useCosmetics = () => useContext(CosmeticsContext);
