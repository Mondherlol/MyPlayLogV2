// ======================================================================
//  « + Log un jeu » — noter un jeu sans quitter la page où l'on est
// ======================================================================
//
// LE CHEMIN QUE ÇA RACCOURCIT. Pour enregistrer un jeu auquel on vient de
// jouer, il fallait jusqu'ici partir à l'Explorateur, chercher, ouvrir la fiche,
// puis la modale — quatre écrans pour une action qu'on fait tous les jours. Ici :
// un bouton, on tape, on clique, la modale s'ouvre. Et pour un jeu qu'on veut
// seulement mettre de côté, un bouton sur la ligne suffit — pas de modale du
// tout.
//
// ⚠️ CE N'EST PAS LA RECHERCHE DE LA BARRE DU HAUT, et ça ne doit pas le
// devenir. Celle-là sert à ALLER quelque part (une fiche, un joueur) ; celle-ci
// sert à FAIRE quelque chose. D'où le champ au centre de l'écran, seul, sans
// onglets ni historique : un geste, une intention.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  Loader2,
  Gamepad2,
  X,
  Bookmark,
  CornerDownLeft,
  Play,
  Trophy,
  Pause,
  Infinity as InfinityIcon,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { useBackClose } from "../hooks/useBackClose";
import PlayedModal from "./PlayedModal";

const LIMIT = 7;

// Ce qu'on affiche sur un jeu DÉJÀ dans la bibliothèque. Mêmes libellés et
// mêmes icônes que partout ailleurs (la fiche, les vignettes) : le statut d'un
// jeu doit se reconnaître d'un coup d'œil, pas se relire.
const STATUS_META = {
  playing: { label: "En cours", Icon: Play },
  finished: { label: "Terminé", Icon: Trophy },
  paused: { label: "En pause", Icon: Pause },
  dropped: { label: "Abandonné", Icon: X },
  endless: { label: "Sans fin", Icon: InfinityIcon },
};

export default function LogGameOverlay({ onClose }) {
  const { token } = useAuth();
  const { map, upsertLocal } = useLibrary();
  const inputRef = useRef(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0); // ligne survolée au clavier
  const [picked, setPicked] = useState(null); // jeu dont la modale est ouverte
  const [wishing, setWishing] = useState(null); // id en cours d'ajout aux envies

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Recherche instantanée, même cadence que la barre du haut (250 ms) : en
  // dessous on tape plus vite qu'IGDB ne répond, et les réponses se doublent.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const d = await apiFetch(
          `/games?search=${encodeURIComponent(term)}&limit=${LIMIT}`,
          { token }
        );
        if (!alive) return;
        setResults(d.games || []);
        setCursor(0);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, token]);

  // Échap ferme — mais la modale d'abord si elle est ouverte, sinon on
  // refermerait les deux couches d'un coup en perdant une saisie en cours.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !picked) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, picked]);

  useBackClose(() => !picked && onClose(), "logGame");

  // Le corps ne défile plus derrière le voile.
  //
  // ⚠️ DÉPEND DE `picked`, ET CE N'EST PAS UN OUBLI. La modale de notation pose
  // le même verrou et le RELÂCHE en se fermant — sans cette dépendance, fermer
  // la modale rendait le défilement à la page alors que notre voile est encore
  // là. On le repose donc à chaque aller-retour.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [picked]);

  function onKeyDown(e) {
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const g = results[cursor];
      if (g) setPicked(g);
    }
  }

  // Mise en envies : le geste rapide, sans passer par la modale. On ne referme
  // PAS l'overlay — on en ajoute souvent plusieurs d'affilée.
  async function addToWishlist(e, g) {
    e.stopPropagation();
    if (wishing) return;
    setWishing(g.id);
    try {
      await apiFetch(`/library/${g.id}`, {
        method: "PUT",
        token,
        body: { status: "wishlist", name: g.name, cover: g.cover },
      });
      upsertLocal(g.id, { status: "wishlist" });
    } catch (err) {
      alert(err.message);
    } finally {
      setWishing(null);
    }
  }

  return createPortal(
    <>
      <div
        className="logoverlay"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="logoverlay-box" onMouseDown={(e) => e.stopPropagation()}>
          <button className="logoverlay-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>

          <div className="logoverlay-field">
            <Search size={20} className="logoverlay-icon" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Quel jeu as-tu joué ?"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {searching && <Loader2 size={17} className="spin logoverlay-spin" />}
          </div>

          {!!query.trim() && (
            <div className="logoverlay-results">
              {!searching && !results.length && (
                <p className="logoverlay-empty">Aucun jeu à ce nom.</p>
              )}

              {results.map((g, i) => {
                const entry = map[g.id];
                const isWish = entry?.status === "wishlist";
                // ⚠️ UN JEU DÉJÀ NOTÉ NE SE PROPOSE PAS EN ENVIE. Lui montrer
                // un signet, c'était proposer de vouloir jouer à ce qu'on a
                // déjà fini. À sa place, son statut — et le bouton ouvre la
                // modale pour le corriger, ce qui est la seule chose qu'on
                // vienne y faire.
                const played = STATUS_META[entry?.status] || null;
                return (
                  <div
                    key={g.id}
                    className={`logoverlay-res clickable ${i === cursor ? "on" : ""}`}
                    role="button"
                    tabIndex={0}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => setPicked(g)}
                    onKeyDown={(e) => e.key === "Enter" && setPicked(g)}
                  >
                    <span className="logoverlay-cover">
                      {g.cover ? (
                        <img src={g.cover} alt="" loading="lazy" draggable="false" />
                      ) : (
                        <Gamepad2 size={17} />
                      )}
                    </span>

                    <span className="logoverlay-text">
                      <span className="logoverlay-name">{g.name}</span>
                      <span className="logoverlay-meta">
                        {[g.year, g.platforms?.slice(0, 3).join(" · ")]
                          .filter(Boolean)
                          .join(" — ")}
                      </span>
                    </span>

                    {played ? (
                      <button
                        type="button"
                        className={`logoverlay-status clickable st-${entry.status}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPicked(g);
                        }}
                        title="Modifier mon suivi de ce jeu"
                      >
                        <played.Icon size={13} />
                        {played.label}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`logoverlay-wish clickable ${isWish ? "on" : ""}`}
                        onClick={(e) => addToWishlist(e, g)}
                        disabled={wishing === g.id || isWish}
                        title={isWish ? "Déjà dans tes envies" : "Ajouter à mes envies"}
                      >
                        {wishing === g.id ? (
                          <Loader2 size={15} className="spin" />
                        ) : (
                          <Bookmark size={15} fill={isWish ? "currentColor" : "none"} />
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="logoverlay-hint">
            <kbd>↑</kbd> <kbd>↓</kbd> pour naviguer · <kbd><CornerDownLeft size={11} /></kbd>{" "}
            pour noter · <kbd>Échap</kbd> pour fermer
          </p>
        </div>
      </div>

      {/* La modale complète, par-dessus. En la refermant on retombe sur la
          recherche : on enchaîne souvent plusieurs jeux d'une même session. */}
      {picked && (
        <PlayedModal
          game={picked}
          onClose={() => setPicked(null)}
          onSaved={() => setPicked(null)}
        />
      )}
    </>,
    document.body
  );
}
