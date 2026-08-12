import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Gamepad2,
  Star,
  Users,
  ArrowRight,
  Loader2,
  Clock,
  Sparkles,
} from "lucide-react";
import { apiFetch } from "../lib/api";

// ======================================================================
//  La cartouche et sa fiche de jeu, enfin reliées
// ======================================================================
// LE RAYON JEU ÉTAIT UN CUL-DE-SAC. On posait une cartouche sur l'étagère, on y
// jouait — et c'était tout : ni note, ni avis, ni OST, ni « qui d'autre y a
// joué », alors que TOUT ÇA EXISTE dans l'application, sur la fiche du jeu, à
// une page de distance. Une application qui ne parle que de jeux vidéo ne
// pouvait pas laisser son rayon de jeux ignorer les jeux.
//
// LE RATTACHEMENT EST POSÉ EN ADMIN (voir AdminIgdbPicker : on désigne le titre
// sur IGDB, on ne le devine pas), et c'est lui qui ouvre cette section.
//
// ON RAMÈNE PEU, ET DU VIVANT. Pas de recopie de la fiche du jeu ici : ce serait
// deux vérités pour un même titre, et la seconde vieillirait. On montre ce qui
// donne envie d'aller voir — les notes, quelques images, ce que la communauté
// en dit — et un bouton pour y aller. La fiche du jeu reste la fiche du jeu.

export default function CollectionGameLink({ game, token }) {
  const [full, setFull] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | error

  useEffect(() => {
    let alive = true;
    setState("loading");
    apiFetch(`/games/${game.igdbId}/full`, { token })
      .then((d) => {
        if (!alive) return;
        setFull(d);
        setState("ready");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [game.igdbId, token]);

  // IGDB muet ou hors service : on garde le LIEN, qui est l'essentiel — la
  // section ne disparaît pas pour une requête ratée.
  const shots = (full?.media || [])
    .filter((m) => m.type === "screenshot" || m.type === "artwork")
    .slice(0, 6);

  return (
    <section className="coll-gamecard">
      <div className="coll-gamecard-head">
        <h2 className="coll-section-title">
          La fiche du jeu
          {full?.year && <em>{full.year}</em>}
        </h2>
        <Link to={`/game/${game.igdbId}`} className="coll-gamecard-cta clickable">
          Ouvrir <ArrowRight size={15} />
        </Link>
      </div>

      <Link to={`/game/${game.igdbId}`} className="coll-gamecard-body clickable">
        <span className="coll-gamecard-cover">
          {full?.cover ? (
            <img src={full.cover} alt="" loading="lazy" />
          ) : (
            <Gamepad2 size={22} />
          )}
        </span>

        <span className="coll-gamecard-txt">
          <strong>{full?.name || game.name}</strong>

          {state === "loading" ? (
            <em>
              <Loader2 size={12} className="spin" /> On va chercher sa fiche…
            </em>
          ) : state === "error" ? (
            <em>Sa fiche complète t'attend — notes, avis, OST, listes.</em>
          ) : (
            <>
              <span className="coll-gamecard-stats">
                {full.criticRating != null && (
                  <span title={`${full.criticRatingCount} critiques`}>
                    <Star size={12} /> {full.criticRating}
                    <i>presse</i>
                  </span>
                )}
                {full.playerRating != null && (
                  <span title={`${full.playerRatingCount} joueurs`}>
                    <Users size={12} /> {full.playerRating}
                    <i>joueurs</i>
                  </span>
                )}
                {/* Le temps de jeu annoncé : sur une cartouche qu'on vient de
                    poser, c'est l'information qui décide si on la lance ce soir
                    ou un autre jour. */}
                {full.timeToBeat?.main > 0 && (
                  <span title="Durée annoncée pour l'histoire principale">
                    <Clock size={12} /> {Math.round(full.timeToBeat.main / 3600)} h
                    <i>pour finir</i>
                  </span>
                )}
              </span>

              {(full.developers?.length > 0 || full.publishers?.length > 0) && (
                <em>
                  {[full.developers?.[0], full.publishers?.[0]]
                    .filter(Boolean)
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .join(" · ")}
                </em>
              )}
            </>
          )}
        </span>
      </Link>

      {/* LES IMAGES DU JEU, PAS CELLES DU BOÎTIER. La fiche de l'étagère montre
          une jaquette et un bandeau ; ici on montre le JEU en action, ce qu'aucun
          scan de boîte ne fait. C'est aussi le seul endroit de la fiche où l'on
          voit à quoi la partie ressemble avant de l'allumer. */}
      {shots.length > 0 && (
        <div className="coll-gamecard-shots">
          {shots.map((s, i) => (
            <Link
              key={s.thumb || i}
              to={`/game/${game.igdbId}`}
              className="clickable"
              tabIndex={-1}
              aria-hidden="true"
            >
              <img src={s.thumb || s.full} alt="" loading="lazy" />
            </Link>
          ))}
        </div>
      )}

      {full?.genres?.length > 0 && (
        <div className="coll-gamecard-tags">
          <Sparkles size={12} />
          {full.genres.slice(0, 4).map((g) => (
            <span key={g.id}>{g.name}</span>
          ))}
        </div>
      )}
    </section>
  );
}
