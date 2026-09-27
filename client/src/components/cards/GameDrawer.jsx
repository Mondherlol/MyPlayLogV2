import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  X,
  Star,
  Clock,
  Play,
  Pause,
  Trophy,
  Infinity as InfinityIcon,
  Gamepad2,
  Heart,
  Bookmark,
  ListPlus,
  ArrowUpRight,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useLibrary } from "../../context/LibraryContext";
import { apiFetch } from "../../lib/api";
import { makeCache } from "../../lib/cache";
import { useBackClose } from "../../hooks/useBackClose";
import { cardArt, cardCover } from "../../lib/cards";
import PlayedModal from "../PlayedModal";
import AddToListModal from "../AddToListModal";
import MediaLightbox from "../MediaLightbox";
import { TrailerModal } from "../ListRowsView";

// ======================================================================
//  La fiche d'un jeu en panneau, sans quitter ce qu'on regarde
// ======================================================================
// On découvre un jeu PAR une carte : la carte reste là, le panneau glisse de
// la droite avec l'essentiel — l'image, la bande-annonce, les captures, trois
// lignes de résumé et les MÊMES boutons que la fiche de l'app (coup de cœur ou
// envie, « j'y ai joué », liste). La fiche complète reste à un clic.
//
// Les données sont celles de la fiche (`/games/:id/full`), dans le MÊME cache :
// un jeu déjà ouvert sur sa page s'affiche ici instantanément, et inversement.

const gameCache = makeCache("mpl_gamefull2_", 24 * 60 * 60 * 1000);

const PLAYED = ["playing", "finished", "paused", "dropped", "endless"];
const STATUS_META = {
  playing: { label: "En cours", Icon: Play },
  finished: { label: "Terminé", Icon: Trophy },
  paused: { label: "En pause", Icon: Pause },
  dropped: { label: "Abandonné", Icon: X },
  endless: { label: "Sans fin", Icon: InfinityIcon },
};

// La bande-annonce, pas la première vidéo venue (IGDB range aussi des
// making-of, des interviews, des extraits de musique).
function pickTrailer(media) {
  const score = (v) => {
    const n = String(v.name || "").toLowerCase();
    if (/launch|lancement/.test(n)) return 0;
    if (/official trailer|bande-annonce officielle/.test(n)) return 1;
    if (/trailer|bande-annonce/.test(n)) return 2;
    if (/teaser|reveal|gameplay/.test(n)) return 3;
    return 4;
  };
  return (media || [])
    .filter((m) => m.type === "video")
    .sort((a, b) => score(a) - score(b))[0];
}

export default function GameDrawer({ card, onClose }) {
  const id = String(card.id);
  const { token } = useAuth();
  const { map, upsertLocal, removeLocal } = useLibrary();
  useBackClose(onClose, "game-drawer");

  const [game, setGame] = useState(() => gameCache.get(id)?.data || null);
  const [err, setErr] = useState(null);
  const [more, setMore] = useState(false);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [showPlayed, setShowPlayed] = useState(false);
  const [showList, setShowList] = useState(false);
  const [viewer, setViewer] = useState(null);
  const scrollRef = useRef(null);

  // Une autre carte (flèches de la visionneuse) : le panneau suit.
  useEffect(() => {
    let alive = true;
    const cached = gameCache.get(id)?.data || null;
    setGame(cached);
    setErr(null);
    setMore(false);
    scrollRef.current?.scrollTo({ top: 0 });
    apiFetch(`/games/${id}/full`, { token })
      .then((d) => {
        if (!alive) return;
        gameCache.set(id, d);
        setGame(d);
      })
      .catch((e) => alive && !cached && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [id, token]);

  const entry = map[id];
  const status = entry?.status || "";
  const played = PLAYED.includes(status);
  const wished = status === "wishlist";
  const favorite = !!entry?.favorite;
  const name = game?.name || card.name;
  const cover = game?.cover || cardCover(card.cover, "t_cover_big");

  // Écrire SANS faire attendre (comme l'app) : le bouton change d'état tout
  // de suite, la requête part derrière, et on revient en arrière si elle échoue.
  const write = useCallback(
    async (optimistic, request) => {
      const before = map[id];
      if (optimistic) upsertLocal(id, optimistic);
      else removeLocal(id);
      try {
        await request();
      } catch (e) {
        if (before) upsertLocal(id, before);
        else removeLocal(id);
        setErr(e.message);
      }
    },
    [map, id, upsertLocal, removeLocal]
  );

  const toggleWish = () =>
    wished
      ? write(null, () => apiFetch(`/library/${id}`, { method: "DELETE", token, undoable: true }))
      : write({ status: "wishlist" }, () =>
          apiFetch(`/library/${id}`, {
            method: "PUT",
            token,
            undoable: true,
            body: { status: "wishlist", name, cover },
          })
        );

  const toggleFavorite = () =>
    write({ ...(entry || {}), favorite: !favorite }, () =>
      apiFetch(`/library/${id}`, {
        method: "PUT",
        token,
        undoable: true,
        body: { favorite: !favorite, name, cover },
      })
    );

  const trailer = pickTrailer(game?.media);
  const hero = game?.backdrop || cardArt(card.art, true) || null;
  // L'image d'en-tête ne rouvre PAS la galerie : elle passe à la fin, sinon
  // on voit deux fois la même image l'une au-dessus de l'autre.
  const gallery = (game?.media || []).filter((m) => m.type !== "video");
  const heroAt = gallery.findIndex((m) => m.full === game?.backdrop);
  const images = (heroAt >= 0 ? [...gallery.slice(0, heroAt), ...gallery.slice(heroAt + 1), gallery[heroAt]] : gallery).slice(0, 10);
  const summary = game?.summaryFr || game?.summary || null;
  const ttb = game?.timeToBeat?.normally || game?.timeToBeat?.hastily || null;
  const studio = game?.developers?.[0] || card.studio;
  const releaseTs = game?.releaseDate ? game.releaseDate * 1000 : null;
  const unreleased = releaseTs != null && releaseTs > Date.now();
  const StatusIcon = STATUS_META[status]?.Icon || Gamepad2;
  const loading = !game && !err;

  // Le panneau est rendu DANS l'arbre de la visionneuse : sans ce barrage, ses
  // clics et ses glissés remonteraient jusqu'à elle (fermer, changer de carte).
  const stop = (e) => e.stopPropagation();
  return createPortal(
    <div className="gd-root" onClick={stop} onTouchStart={stop} onTouchEnd={stop} onPointerDown={stop}>
      <aside className="gd">
        <div className="gd-scroll" ref={scrollRef}>
          <div className={`gd-hero ${hero ? "" : "sk"}`}>
            {hero && <img key={hero} src={hero} alt="" draggable="false" />}
            <div className="gd-hero-txt">
              <h2 className="gd-name">{name}</h2>
              <div className="gd-meta">
                {[card.year || game?.year, studio].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>

          <div className="gd-body">
            {loading ? (
              <div className="gd-facts">
                <span className="sk sk-chip" />
                <span className="sk sk-chip" />
                <span className="sk sk-chip short" />
                <span className="sk sk-chip short" />
              </div>
            ) : (
              <div className="gd-facts">
                {(game?.rating ?? card.rating) != null && (
                  <span className="gd-fact" title="Note">
                    <Star size={15} /> {Math.round(game?.rating ?? card.rating)}
                  </span>
                )}
                {ttb && (
                  <span className="gd-fact" title="Temps pour finir">
                    <Clock size={15} /> {ttb} h
                  </span>
                )}
                {(game?.platforms || []).slice(0, 6).map((p) => (
                  <span className="gd-plat" key={p.id} title={p.name}>
                    {p.abbr}
                  </span>
                ))}
              </div>
            )}

            {/* La rangée de l'app : [envie ou coup de cœur] [j'y ai joué] [liste].
                Le bouton de gauche change de nature : tant qu'on n'y a pas
                joué, « je le veux ? » ; une fois joué, « je l'ai aimé ? ». */}
            <div className="gd-actions">
              {played ? (
                <button
                  className={`gd-act side clickable ${favorite ? "fav" : ""}`}
                  onClick={toggleFavorite}
                  aria-pressed={favorite}
                  title={favorite ? "Retirer des coups de cœur" : "Coup de cœur"}
                >
                  <Heart size={19} strokeWidth={2.2} fill={favorite ? "currentColor" : "none"} />
                </button>
              ) : (
                <button
                  className={`gd-act side clickable ${wished ? "on" : ""}`}
                  onClick={toggleWish}
                  aria-pressed={wished}
                  title={wished ? "Retirer de mes envies" : "Je veux y jouer"}
                >
                  <Bookmark size={19} strokeWidth={2.2} fill={wished ? "currentColor" : "none"} />
                </button>
              )}
              {!unreleased && (
                <button
                  className={`gd-act main clickable ${played ? "on" : ""}`}
                  onClick={() => setShowPlayed(true)}
                >
                  <StatusIcon size={18} strokeWidth={2.4} />
                  <span>{played ? STATUS_META[status]?.label || "Dans ma bibliothèque" : "J'y ai joué"}</span>
                </button>
              )}
              <button
                className={`gd-act clickable ${unreleased ? "main" : "side"}`}
                onClick={() => setShowList(true)}
                title="Ajouter à une liste"
              >
                <ListPlus size={19} strokeWidth={2.2} />
              </button>
            </div>

            {err && <p className="gd-err">{err}</p>}

            {/* La bande-annonce : la vignette ici, la vidéo dans la modale du
                site, avec notre lecteur (même rendu que sur la fiche). */}
            {loading ? (
              <div className="gd-trailer sk" />
            ) : (
              trailer && (
                <div className="gd-trailer">
                  <button className="gd-trailer-thumb clickable" onClick={() => setTrailerOpen(true)}>
                    <img src={trailer.thumb} alt="" draggable="false" />
                    <span className="gd-play">
                      <Play size={26} fill="currentColor" />
                    </span>
                  </button>
                </div>
              )
            )}

            {loading ? (
              <div className="gd-shots">
                <span className="gd-shot sk" />
                <span className="gd-shot sk" />
              </div>
            ) : (
              images.length > 0 && (
                <div className="gd-shots">
                  {images.map((m, i) => (
                    <button key={m.id} className="gd-shot clickable" onClick={() => setViewer(i)}>
                      <img src={m.thumb} alt="" loading="lazy" draggable="false" />
                    </button>
                  ))}
                </div>
              )
            )}

            {loading ? (
              <div className="gd-lines">
                <span className="sk sk-line" />
                <span className="sk sk-line" />
                <span className="sk sk-line" />
                <span className="sk sk-line short" />
              </div>
            ) : (
              summary && (
                <p className={`gd-summary ${more ? "open" : ""}`} onClick={() => setMore((v) => !v)}>
                  {summary}
                </p>
              )
            )}

            {game?.genres?.length > 0 && (
              <div className="gd-genres">
                {game.genres.slice(0, 4).map((g) => (
                  <span key={g.id}>{g.name}</span>
                ))}
              </div>
            )}

            <Link to={`/game/${game?.slug || card.slug || id}`} className="gd-full clickable">
              Fiche complète <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>

        <button className="gd-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
      </aside>

      {/* Les modales du site s'ouvrent par-dessus (cf. l'empilement en CSS). */}
      {trailerOpen && trailer && (
        <TrailerModal trailer={trailer} gameName={name} onClose={() => setTrailerOpen(false)} />
      )}
      {showPlayed && (
        <PlayedModal game={{ id: Number(id), name, cover }} onClose={() => setShowPlayed(false)} />
      )}
      {showList && (
        <AddToListModal game={{ id: Number(id), name, cover }} onClose={() => setShowList(false)} />
      )}
      {viewer != null && (
        <MediaLightbox
          items={images}
          index={viewer}
          onIndex={setViewer}
          onClose={() => setViewer(null)}
          title={name}
        />
      )}
    </div>,
    document.body
  );
}

// Une modale du site ouverte par-dessus (bande-annonce, liste, visionneuse) :
// les raccourcis des cartes (flèches, Échap, I) la laissent tranquille.
// ⚠️ CES RACCOURCIS ÉCOUTENT EN CAPTURE. La modale ferme sur Échap depuis son
// propre écouteur ; React la retire du DOM avant l'écouteur suivant — un
// écouteur ordinaire la trouvait déjà partie et fermait tout le reste avec.
export const siteModalOpen = () => !!document.querySelector(".modal-overlay, .mlb");

// Ouvrir / fermer le panneau : un état, plus « I » au clavier.
export function useGameDrawer() {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  useEffect(() => {
    const on = (e) => {
      if (e.target.closest?.("input, textarea, [contenteditable]") || siteModalOpen()) return;
      if (e.key === "i" || e.key === "I") toggle();
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [toggle]);
  return { open, setOpen, toggle };
}
