import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "./AuthContext";
import { useToast } from "./ToastContext";

const STATUS_LABEL = {
  wishlist: "ta wishlist",
  playing: "« En cours »",
  finished: "« Terminé »",
  paused: "« En pause »",
  dropped: "« Abandonné »",
  endless: "« Sans fin »",
};

// Ce qu'on remet dans un PUT pour rendre une entrée telle qu'elle était.
const RESTORE_KEYS = [
  "name", "cover", "status", "platform", "format", "store", "platinum",
  "plannedMonth", "bundleGames", "dlcs", "edition", "playtimeHours",
  "startedAt", "finishedAt", "note", "review", "reviewMedia", "spoiler",
  "favorite", "rating", "pros", "cons", "favoriteCharacter", "favoriteOst",
  "reviewedAt",
];

// Le message du toast, déduit de la requête et de l'état d'avant.
function describe({ method, body = {}, prev }) {
  if (method === "DELETE") {
    return prev?.status === "wishlist" ? "Retiré de ta wishlist" : "Retiré de tes jeux";
  }
  if (body.status && body.status !== prev?.status) {
    if (body.status === "wishlist") return "Ajouté à ta wishlist";
    if (!prev) return `Ajouté à tes jeux · ${STATUS_LABEL[body.status]}`;
    return `Passé en ${STATUS_LABEL[body.status]}`;
  }
  if (body.favorite !== undefined && body.favorite !== !!prev?.favorite) {
    return body.favorite ? "Ajouté à tes coups de cœur" : "Retiré de tes coups de cœur";
  }
  if (body.rating !== undefined) return body.rating ? "Note enregistrée" : "Note retirée";
  return "Modifications enregistrées";
}

const LibraryContext = createContext();

// État partagé de la bibliothèque : gameId -> { status, favorite }
export function LibraryProvider({ children }) {
  const { token } = useAuth();
  const toast = useToast();
  const [map, setMap] = useState({});

  // Recharge la carte complète depuis le serveur (après un import Steam massif,
  // par ex.) : la nouvelle référence de `map` déclenche le rafraîchissement des
  // écrans qui en dépendent (profil…).
  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    return apiFetch("/library/map", { token })
      .then((d) => setMap(d.map || {}))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) {
      setMap({});
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Chaque écriture marquée `undoable` (cf. lib/api.js) → un toast de
  // confirmation avec « Annuler ». Le serveur renvoie l'état d'AVANT (`prev`) :
  // annuler, c'est le remettre tel quel — ou supprimer l'entrée si elle
  // n'existait pas.
  useEffect(() => {
    function onWrite(e) {
      const { path, method, body, data, label } = e.detail;
      const gameId = Number(path.match(/^\/library\/(\d+)$/)?.[1]);
      if (!gameId || !token) return;
      const prev = data?.prev;
      const name = prev?.name || data?.entry?.name || body?.name || null;
      const cover = prev?.cover || data?.entry?.cover || body?.cover || null;
      // Ancien serveur (sans `prev`) : on confirme, sans proposer d'annuler.
      const canUndo = data && "prev" in data;

      async function undo() {
        let entry = null;
        if (prev) {
          const restore = { restore: true };
          for (const k of RESTORE_KEYS) if (prev[k] !== undefined) restore[k] = prev[k];
          ({ entry } = await apiFetch(`/library/${gameId}`, { method: "PUT", token, body: restore }));
          upsertLocal(gameId, { status: entry.status, favorite: entry.favorite });
        } else {
          await apiFetch(`/library/${gameId}`, { method: "DELETE", token });
          removeLocal(gameId);
        }
        // Les écrans qui tiennent leur propre copie de l'entrée (fiche jeu…)
        // se recalent là-dessus.
        window.dispatchEvent(
          new CustomEvent("mpl:library-restored", { detail: { gameId, entry } })
        );
      }

      toast.show({
        title: name,
        cover,
        text: typeof label === "string" ? label : describe({ method, body, prev }),
        undo: canUndo ? undo : null,
      });
    }
    window.addEventListener("mpl:library-write", onWrite);
    return () => window.removeEventListener("mpl:library-write", onWrite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, toast]);

  function upsertLocal(gameId, partial) {
    setMap((m) => ({ ...m, [gameId]: { ...(m[gameId] || {}), ...partial } }));
  }
  function removeLocal(gameId) {
    setMap((m) => {
      if (!(gameId in m)) return m;
      const next = { ...m };
      delete next[gameId];
      return next;
    });
  }

  // ⚠️ UNE VALEUR STABLE. Toutes les jaquettes du site lisent ce contexte :
  // un nouvel objet à chaque rendu du fournisseur (un toast qui passe, l'auth
  // qui se rafraîchit…) les faisait TOUTES se redessiner pour rien. Elle ne
  // change plus que quand la bibliothèque change vraiment.
  const value = useMemo(
    () => ({ map, upsertLocal, removeLocal, refresh }),
    // upsertLocal / removeLocal ne passent que par setMap : stables de fait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, refresh]
  );

  return (
    <LibraryContext.Provider value={value}>
      {children}
    </LibraryContext.Provider>
  );
}

export const useLibrary = () => useContext(LibraryContext);
