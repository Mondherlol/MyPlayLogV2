import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  X,
  Check,
  Star,
  Gamepad2,
  Bookmark,
  ListPlus,
  Gamepad,
  Play,
  Pause,
  Skull,
  Infinity as InfinityIcon,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { useClickOutside } from "../hooks/useClickOutside";
import { apiFetch } from "../lib/api";
import PlayedModal from "./PlayedModal";
import AddToListModal from "./AddToListModal";

const PLAYED = ["playing", "finished", "paused", "dropped", "endless"];

// Icône + libellé du bouton principal selon le statut du jeu dans la
// bibliothèque : on voit d'un coup d'œil où on en est, comme sur la page jeu.
const STATUS_META = {
  wishlist: { label: "Dans ma wishlist", Icon: Bookmark },
  playing: { label: "En cours", Icon: Play },
  finished: { label: "Terminé", Icon: Check },
  paused: { label: "En pause", Icon: Pause },
  dropped: { label: "Abandonné", Icon: Skull },
  endless: { label: "Sans fin", Icon: InfinityIcon },
};

export default function GameCard({ game, variant = "grid" }) {
  const navigate = useNavigate();
  const { token } = useAuth();
  const { map, upsertLocal, removeLocal } = useLibrary();
  const entry = map[game.id];

  const [fanOpen, setFanOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showListModal, setShowListModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const fanRef = useRef(null);
  useClickOutside(fanRef, () => setFanOpen(false), fanOpen);

  const inLibrary = !!entry;
  const isWishlist = entry?.status === "wishlist";
  const isPlayed = entry && PLAYED.includes(entry.status);
  const statusMeta = entry ? STATUS_META[entry.status] : null;

  async function toggleWishlist(e) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      if (isWishlist) {
        await apiFetch(`/library/${game.id}`, { method: "DELETE", token });
        removeLocal(game.id);
      } else {
        await apiFetch(`/library/${game.id}`, {
          method: "PUT",
          token,
          body: { status: "wishlist", name: game.name, cover: game.cover },
        });
        upsertLocal(game.id, { status: "wishlist" });
      }
      setFanOpen(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  const platforms = game.platforms || [];
  const marquee = platforms.length > 0 ? [...platforms, ...platforms] : [];

  // --- Vue liste : mise en page horizontale, plus de détails visibles ---
  if (variant === "list") {
    const genres = game.genres || [];
    return (
      <>
      <article
        className="game-row clickable"
        onClick={() => navigate(`/game/${game.id}`)}
      >
        <div className="game-row-cover">
          {game.cover ? (
            <img src={game.cover} alt={game.name} loading="lazy" draggable="false" />
          ) : (
            <div className="game-nocover">
              <Gamepad2 size={22} />
            </div>
          )}
        </div>

        <div className="game-row-info">
          <h3 className="game-row-title">{game.name}</h3>
          <p className="game-row-meta">
            {game.year && <span>{game.year}</span>}
            {genres.length > 0 && <span>{genres.slice(0, 3).join(", ")}</span>}
          </p>
          {platforms.length > 0 && (
            <div className="game-row-plats">
              {platforms.slice(0, 6).map((p, i) => (
                <span className="game-row-plat" key={`${p}-${i}`}>
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>

        {game.rating != null && (
          <span className="game-row-rating">
            <Star size={13} fill="currentColor" strokeWidth={0} />
            {Math.round((game.rating / 20) * 10) / 10}
          </span>
        )}

        <div className="game-row-actions">
          <button
            className={`game-row-btn ${isPlayed ? "active" : ""}`}
            title={isPlayed ? statusMeta.label : "J'y ai joué"}
            onClick={(e) => {
              e.stopPropagation();
              setShowModal(true);
            }}
          >
            {isPlayed ? <statusMeta.Icon size={17} /> : <Gamepad size={17} />}
          </button>
          <button
            className={`game-row-btn ${isWishlist ? "active" : ""}`}
            title="Je veux y jouer"
            onClick={toggleWishlist}
            disabled={busy}
          >
            <Bookmark size={17} fill={isWishlist ? "currentColor" : "none"} />
          </button>
          <button
            className="game-row-btn"
            title="Ajouter à une liste"
            onClick={(e) => {
              e.stopPropagation();
              setShowListModal(true);
            }}
          >
            <ListPlus size={17} />
          </button>
        </div>
      </article>

      {/* Modales rendues HORS de l'article : via un portail React, leurs
          évènements remontent l'arbre React — les laisser enfants de l'article
          déclencherait sa navigation au moindre clic. */}
      {showModal && (
        <PlayedModal game={game} onClose={() => setShowModal(false)} />
      )}
      {showListModal && (
        <AddToListModal game={game} onClose={() => setShowListModal(false)} />
      )}
      </>
    );
  }

  return (
    <>
    <article
      className="game-card clickable"
      onClick={() => navigate(`/game/${game.id}`)}
    >
      <div className={`game-cover ${fanOpen ? "fan-open" : ""}`}>
        {game.cover ? (
          <img src={game.cover} alt={game.name} loading="lazy" draggable="false" />
        ) : (
          <div className="game-nocover">
            <Gamepad2 size={30} />
          </div>
        )}

        {game.rating != null && (
          <span className="game-rating">
            <Star size={12} fill="currentColor" strokeWidth={0} />
            {Math.round((game.rating / 20) * 10) / 10}
          </span>
        )}

        <div className="game-overlay">
          <h3 className="game-title">{game.name}</h3>
          <p className="game-meta">
            {[game.year, game.genres?.[0]].filter(Boolean).join(" · ")}
          </p>
          {marquee.length > 0 && (
            <div className="game-chips">
              <div className={`game-chips-track ${platforms.length > 3 ? "scroll" : ""}`}>
                {marquee.map((p, i) => (
                  <span className="game-chip" key={`${p}-${i}`}>
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Menu radial d'ajout (hors de la cover pour pouvoir dépasser) */}
      <div className={`add-fan ${fanOpen ? "open" : ""}`} ref={fanRef}>
        <button
          className="fan-btn b1"
          title="Ajouter à une liste"
          onClick={(e) => {
            e.stopPropagation();
            setShowListModal(true);
            setFanOpen(false);
          }}
        >
          <ListPlus size={19} />
        </button>
        <button
          className={`fan-btn b2 ${isPlayed ? "active" : ""}`}
          title="J'y ai joué"
          onClick={(e) => {
            e.stopPropagation();
            setShowModal(true);
            setFanOpen(false);
          }}
        >
          <Gamepad size={19} />
        </button>
        <button
          className={`fan-btn b3 ${isWishlist ? "active" : ""}`}
          title="Je veux y jouer"
          onClick={toggleWishlist}
        >
          <Bookmark size={19} fill={isWishlist ? "currentColor" : "none"} />
        </button>

        <button
          className={`game-add ${inLibrary ? "added" : ""} ${fanOpen ? "open" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setFanOpen((v) => !v);
          }}
          title={statusMeta ? statusMeta.label : "Ajouter"}
          aria-label={statusMeta ? statusMeta.label : "Ajouter le jeu"}
        >
          {fanOpen ? (
            <X size={20} />
          ) : statusMeta ? (
            <statusMeta.Icon size={20} />
          ) : (
            <Plus size={20} />
          )}
        </button>
      </div>
    </article>

    {/* Modales hors de l'article (voir vue liste) pour éviter que leurs clics,
        remontant l'arbre React via le portail, ne déclenchent la navigation. */}
    {showModal && (
      <PlayedModal game={game} onClose={() => setShowModal(false)} />
    )}
    {showListModal && (
      <AddToListModal game={game} onClose={() => setShowListModal(false)} />
    )}
    </>
  );
}
