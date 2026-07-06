import { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "./AuthContext";

const LibraryContext = createContext();

// État partagé de la bibliothèque : gameId -> { status, favorite }
export function LibraryProvider({ children }) {
  const { token } = useAuth();
  const [map, setMap] = useState({});

  useEffect(() => {
    if (!token) {
      setMap({});
      return;
    }
    apiFetch("/library/map", { token })
      .then((d) => setMap(d.map || {}))
      .catch(() => {});
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
    <LibraryContext.Provider value={{ map, upsertLocal, removeLocal }}>
      {children}
    </LibraryContext.Provider>
  );
}

export const useLibrary = () => useContext(LibraryContext);
