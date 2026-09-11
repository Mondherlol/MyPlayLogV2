import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Disc3, Music2, Pause, Play } from "lucide-react";
import { usePlayer } from "../../context/PlayerContext";
import { apiFetch } from "../../lib/api";
import { extractVideoId } from "../../lib/youtube";
import Section from "./Rail";

/**
 * « Coups de cœur OST » — les dernières bandes-son mises en favori par
 * n'importe quel joueur.
 *
 * On reprend telles quelles les cards pochette + CD de l'onglet OST du profil
 * (classes `.pfo-*`) : le CD sort au survol et tourne à la lecture, pilotée par
 * le mini-lecteur global. Un rail plutôt qu'une grille — c'est la grammaire de
 * toute la page maintenant.
 */
export default function OstRail({ token }) {
  const [items, setItems] = useState(null);
  const player = usePlayer();

  useEffect(() => {
    let alive = true;
    apiFetch("/ost/recent?limit=8", { token })
      .then((d) => alive && setItems(d.items || []))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [token]);

  if (!items?.length) return null;

  // Une piste n'est jouable que si on sait en tirer une vidéo YouTube.
  const playable = (t) => !!(t?.videoId || extractVideoId(t?.url || ""));
  // La file de lecture = les OST affichées, chacune enrichie de son jeu (le
  // mini-lecteur en a besoin pour son lien « voir la fiche »).
  const withGame = (i) => ({ ...i.ost, gameId: i.gameId, gameName: i.gameName });

  return (
    <Section
      kicker="Dans les oreilles"
      title="Coups de cœur OST"
      hint="Les dernières bandes-son adoubées par la communauté"
      className="s-ost"
    >
      {items.map((item) => {
        const t = item.ost;
        const playing = player.isPlaying(t);
        const canPlay = playable(t);
        return (
          <div key={item.gameId} className={`pfo-card mh-ost ${playing ? "playing" : ""}`}>
            <div className="pfo-sleeve">
              <div className="pfo-cd">
                <div className="pfo-disc">
                  <span className="pfo-disc-label">
                    {t.artwork ? (
                      <img src={t.artwork} alt="" loading="lazy" draggable="false" />
                    ) : (
                      <Music2 size={18} />
                    )}
                    <span className="pfo-disc-hole" />
                  </span>
                </div>
              </div>

              <div className="pfo-album">
                {item.cover ? (
                  <img src={item.cover} alt={item.gameName} loading="lazy" draggable="false" />
                ) : (
                  <span className="pfo-album-ph">{item.gameName?.[0] || "?"}</span>
                )}
                <span className="pfo-album-mouth" />
              </div>

              <button
                className={`pfo-play clickable ${canPlay ? "" : "mute"}`}
                onClick={canPlay ? () => player.toggleTrack(t, items.map(withGame), {}) : undefined}
                disabled={!canPlay}
                title={canPlay ? (playing ? "Pause" : "Écouter") : "Extrait indisponible"}
              >
                {playing ? (
                  <Pause size={18} />
                ) : (
                  <Play size={18} fill="currentColor" strokeWidth={0} />
                )}
              </button>
            </div>

            <div className="pfo-body">
              <span className="pfo-name" title={t.name}>
                {t.name}
              </span>
              {!!t.artist && (
                <span className="pfo-artist" title={t.artist}>
                  {t.artist}
                </span>
              )}
              <div className="pfo-foot">
                <Link to={`/game/${item.gameId}`} className="pfo-game clickable" title={item.gameName}>
                  <Disc3 size={13} />
                  <span className="pfo-game-name">{item.gameName}</span>
                </Link>
                {/* Qui l'a mise en favori — le clin d'œil « communauté ». */}
                <Link
                  to={`/u/${item.user.username}?tab=ost`}
                  className="mh-ost-by clickable"
                  title={`Choisie par ${item.user.username}`}
                >
                  {item.user.avatar ? (
                    <img src={item.user.avatar} alt="" loading="lazy" />
                  ) : (
                    item.user.username[0].toUpperCase()
                  )}
                </Link>
              </div>
            </div>
          </div>
        );
      })}
    </Section>
  );
}
