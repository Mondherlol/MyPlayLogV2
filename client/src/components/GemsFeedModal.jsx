import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  X,
  Gem,
  Gamepad2,
  Gamepad,
  Star,
  Loader2,
  Bookmark,
  BookmarkPlus,
  CircleCheck,
  CirclePause,
  CircleX,
  Check,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";

// Statut du découvreur sur chaque pépite (« il l'a gardée ou pas »).
const OWNER_STATUS = {
  wishlist: { label: "dans sa wishlist", Icon: BookmarkPlus, cls: "wishlist" },
  playing: { label: "il y joue", Icon: Gamepad, cls: "playing" },
  finished: { label: "terminé", Icon: CircleCheck, cls: "finished" },
  paused: { label: "en pause", Icon: CirclePause, cls: "paused" },
  dropped: { label: "abandonné", Icon: CircleX, cls: "dropped" },
};

const PLAYED = ["playing", "finished", "paused", "dropped"];

// Modale « les pépites de X » : ouverte depuis la carte du fil, elle liste la
// dernière fournée du joueur (liste verticale) avec son statut sur chaque jeu,
// pour piquer ses découvertes — bouton wishlist rapide pour soi.
export default function GemsFeedModal({ item, onClose }) {
  const navigate = useNavigate();
  const { token } = useAuth();
  const { map, upsertLocal, removeLocal } = useLibrary();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    apiFetch(`/feed/gems/${item.gemsId}`, { token })
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err.message || "Erreur de chargement."))
      .finally(() => {});
    return () => {
      alive = false;
    };
  }, [item.gemsId, token]);

  function openGame(id) {
    onClose();
    navigate(`/game/${id}`);
  }

  // Wishlist rapide pour MOI (même logique que GameCard.toggleWishlist).
  async function toggleWish(e, g) {
    e.stopPropagation();
    if (busyId) return;
    const entry = map[g.id];
    if (entry && PLAYED.includes(entry.status)) return; // déjà joué : rien à faire
    setBusyId(g.id);
    try {
      if (entry?.status === "wishlist") {
        await apiFetch(`/library/${g.id}`, { method: "DELETE", token });
        removeLocal(g.id);
      } else {
        await apiFetch(`/library/${g.id}`, {
          method: "PUT",
          token,
          body: { status: "wishlist", name: g.name, cover: g.cover },
        });
        upsertLocal(g.id, { status: "wishlist" });
      }
    } catch {
      /* best-effort */
    } finally {
      setBusyId(null);
    }
  }

  const u = item.user;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal gfm-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        <header className="gfm-head">
          <span className="gfm-avatar">
            {u.avatar ? (
              <img src={u.avatar} alt="" draggable="false" />
            ) : (
              (u.username || "?")[0].toUpperCase()
            )}
          </span>
          <div className="gfm-head-txt">
            <h2 className="gfm-title">
              <Gem size={17} /> Les pépites de {u.username}
            </h2>
            {data?.seeds?.length > 0 && (
              <p className="gfm-sub">
                À partir de {data.seeds.map((s) => s.name).join(", ")}
              </p>
            )}
          </div>
          {data?.seeds?.length > 0 && (
            <div className="gfm-seeds">
              {data.seeds.map((s) => (
                <span key={s.id} className="gfm-seed" title={s.name}>
                  {s.cover ? (
                    <img src={s.cover} alt="" loading="lazy" draggable="false" />
                  ) : (
                    <Gamepad2 size={12} />
                  )}
                </span>
              ))}
            </div>
          )}
        </header>

        {error ? (
          <p className="gfm-empty font-fun">{error}</p>
        ) : !data ? (
          <div className="gfm-loading" aria-busy="true">
            <Loader2 size={22} className="spin" />
          </div>
        ) : data.games.length === 0 ? (
          <p className="gfm-empty font-fun">
            Cette fournée n'a pas été enregistrée — relance-le pour voir ses
            prochaines trouvailles !
          </p>
        ) : (
          <div className="gfm-list">
            {data.games.map((g) => {
              const owner = OWNER_STATUS[g.ownerStatus];
              const mine = map[g.id];
              const iPlayed = mine && PLAYED.includes(mine.status);
              const iWish = mine?.status === "wishlist";
              return (
                <div
                  key={g.id}
                  className="gfm-row clickable"
                  onClick={() => openGame(g.id)}
                >
                  <div className="gfm-cover">
                    {g.cover ? (
                      <img src={g.cover} alt="" loading="lazy" draggable="false" />
                    ) : (
                      <span className="gfm-cover-ph">
                        <Gamepad2 size={18} />
                      </span>
                    )}
                  </div>

                  <div className="gfm-info">
                    <span className="gfm-name">{g.name}</span>
                    <span className="gfm-meta">
                      {g.rating != null && (
                        <i className="gfm-rating">
                          <Star size={11} fill="currentColor" strokeWidth={0} />
                          {Math.round((g.rating / 20) * 10) / 10}
                        </i>
                      )}
                      {g.year && <i>{g.year}</i>}
                      {g.genres.slice(0, 2).map((ge) => (
                        <i key={ge}>{ge}</i>
                      ))}
                    </span>
                    {owner ? (
                      <span className={`gfm-owner st-${owner.cls}`}>
                        <owner.Icon size={12} /> {owner.label}
                      </span>
                    ) : (
                      <span className="gfm-owner none">pas gardée</span>
                    )}
                  </div>

                  <button
                    className={`gfm-wish clickable ${iWish || iPlayed ? "on" : ""}`}
                    onClick={(e) => toggleWish(e, g)}
                    disabled={busyId === g.id || iPlayed}
                    title={
                      iPlayed
                        ? "Déjà dans ta bibliothèque"
                        : iWish
                          ? "Retirer de ma wishlist"
                          : "Ajouter à ma wishlist"
                    }
                  >
                    {busyId === g.id ? (
                      <Loader2 size={16} className="spin" />
                    ) : iPlayed ? (
                      <Check size={16} />
                    ) : (
                      <Bookmark size={16} fill={iWish ? "currentColor" : "none"} />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
