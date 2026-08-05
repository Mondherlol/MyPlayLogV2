import { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "./AuthContext";

const LibraryContext = createContext();

// État partagé de la bibliothèque : gameId -> { status, favorite }
export function LibraryProvider({ children }) {
  const { token } = useAuth();
  const [map, setMap] = useState({});

  // Recharge la carte complète depuis le serveur (après un import Steam massif,
  // par ex.) : la nouvelle référence de `map` déclenche le rafraîchissement des
  // écrans qui en dépendent (profil…).
  function refresh() {
    if (!token) return Promise.resolve();
    return apiFetch("/library/map", { token })
      .then((d) => setMap(d.map || {}))
      .catch(() => {});
  }

  useEffect(() => {
    if (!token) {
      setMap({});
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function upsertLocal(gameId, partial) {
    setMap((m) => ({ ...m, [gameId]: { ...(m[gameId] || {}), ...partial } }));
  }
  function removeLocal(gameId) {
    setMap((m) => {
      const next = { ...m };
      delete next[gameId];
      return next;
    });
  }

  return (
    <LibraryContext.Provider value={{ map, upsertLocal, removeLocal, refresh }}>
      {children}
    </LibraryContext.Provider>
  );
}

export const useLibrary = () => useContext(LibraryContext);
