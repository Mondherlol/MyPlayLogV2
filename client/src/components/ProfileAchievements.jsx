import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Loader2,
  Trophy,
  Star,
  Gem,
  Award,
  Lock,
  X,
  Sparkles,
  Settings as SettingsIcon,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import SteamIcon from "./SteamIcon";

// Couleur de rareté d'un succès (façon "or / argent / bronze" par pourcentage).
function rarityClass(pct) {
  if (pct == null) return "";
  if (pct < 5) return "r-legendary";
  if (pct < 15) return "r-epic";
  if (pct < 40) return "r-rare";
  return "r-common";
}
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "";
}

export default function ProfileAchievements({ username, token, isMe }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openGame, setOpenGame] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`/users/${username}/achievements`, { token })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [username, token]);

  if (loading)
    return (
      <div className="lists-loading">
        <Loader2 size={20} className="spin" /> Chargement des succès…
      </div>
    );
  if (error) return <div className="profile-empty font-fun">{error}</div>;
  if (!data) return null;

  if (!data.games.length) {
    return (
      <div className="ach-empty">
        <Trophy size={40} />
        {isMe ? (
          <>
            <h3>Aucun succès importé</h3>
            <p>
              Relie ton compte Steam pour importer tes succès et voir tes stats
              ici.
            </p>
            <Link to="/settings" className="btn-steam-primary clickable">
              <SettingsIcon size={16} /> Aller dans Paramètres
            </Link>
          </>
        ) : (
          <>
            <h3>Aucun succès</h3>
            <p>Ce joueur n'a pas encore importé de succès.</p>
          </>
        )}
      </div>
    );
  }

  const s = data.stats;

  return (
    <div className="ach-tab">
      {/* Bandeau de statistiques */}
      <div className="ach-stats">
        <StatTile Icon={Trophy} value={s.totalUnlocked} label="Succès débloqués" accent />
        <StatTile Icon={Award} value={`${s.avgCompletion}%`} label="Complétion moyenne" />
        <StatTile Icon={Star} value={s.perfectGames} label="Jeux à 100 %" />
        <StatTile Icon={Gem} value={s.games} label="Jeux suivis" />
      </div>

      {/* Succès les plus rares */}
      {data.rarest.length > 0 && (
        <section className="ach-rail">
          <h3 className="ach-rail-title">
            <Gem size={16} /> Tes succès les plus rares
          </h3>
          <div className="ach-rail-row">
            {data.rarest.map((a, i) => (
              <div key={i} className={`ach-rare-card ${rarityClass(a.rarity)}`}>
                <div className="ach-rare-icon">
                  {a.icon ? <img src={a.icon} alt="" /> : <Trophy size={20} />}
                </div>
                <div className="ach-rare-info">
                  <strong>{a.name}</strong>
                  <span>{a.gameName}</span>
                </div>
                <div className="ach-rare-pct">{a.rarity}%</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Succès récents */}
      {data.recent.length > 0 && (
        <section className="ach-rail">
          <h3 className="ach-rail-title">
            <Sparkles size={16} /> Débloqués récemment
          </h3>
          <div className="ach-rail-row">
            {data.recent.map((a, i) => (
              <div key={i} className="ach-recent-card">
                <div className="ach-recent-icon">
                  {a.icon ? <img src={a.icon} alt="" /> : <Trophy size={18} />}
                </div>
                <div className="ach-rare-info">
                  <strong>{a.name}</strong>
                  <span>
                    {a.gameName} · {fmtDate(a.unlockedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Grille par jeu */}
      <section>
        <h3 className="ach-rail-title">
          <Trophy size={16} /> Par jeu
        </h3>
        <div className="ach-games">
          {data.games.map((g) => (
            <button
              key={`${g.platform}-${g.gameId}`}
              className="ach-game-card clickable"
              onClick={() => setOpenGame(g)}
            >
              <div className="ach-game-cover">
                {g.cover ? <img src={g.cover} alt="" loading="lazy" /> : null}
                <span className="ach-plat-badge" title={g.platform}>
                  {g.platform === "steam" ? <SteamIcon size={13} /> : <Trophy size={13} />}
                </span>
                {g.perfect && (
                  <span className="ach-perfect-badge">
                    <Star size={12} /> 100%
                  </span>
                )}
              </div>
              <div className="ach-game-info">
                <div className="ach-game-name">{g.name}</div>
                <div className="ach-game-count">
                  {g.unlocked} / {g.total}
                </div>
                <div className="ach-progress">
                  <div className="ach-progress-fill" style={{ width: `${g.percent}%` }} />
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {openGame && (
        <GameAchievementsModal
          username={username}
          token={token}
          game={openGame}
          onClose={() => setOpenGame(null)}
        />
      )}
    </div>
  );
}

function StatTile({ Icon, value, label, accent }) {
  return (
    <div className={`ach-stat-tile ${accent ? "accent" : ""}`}>
      <Icon size={20} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function GameAchievementsModal({ username, token, game, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    apiFetch(`/users/${username}/achievements/${game.gameId}`, { token })
      .then((d) => alive && setData(d))
      .catch(() => alive && setData({ achievements: [] }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [username, token, game.gameId]);

  return (
    <div className="ach-modal-overlay" onClick={onClose}>
      <div className="ach-modal" onClick={(e) => e.stopPropagation()}>
        <button className="steam-modal-close clickable" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="ach-modal-head">
          {game.cover && <img src={game.cover} alt="" className="ach-modal-cover" />}
          <div>
            <h3>{game.name}</h3>
            <div className="ach-modal-sub">
              {game.platform === "steam" ? <SteamIcon size={14} /> : <Trophy size={14} />}
              {game.unlocked} / {game.total} succès · {game.percent}%
            </div>
            <div className="ach-progress big">
              <div className="ach-progress-fill" style={{ width: `${game.percent}%` }} />
            </div>
          </div>
        </div>

        <div className="ach-modal-list">
          {loading ? (
            <div className="lists-loading">
              <Loader2 size={18} className="spin" /> Chargement…
            </div>
          ) : (
            (data?.achievements || []).map((a) => (
              <div
                key={a.apiName}
                className={`ach-row ${a.unlocked ? "unlocked" : "locked"} ${rarityClass(a.rarity)}`}
              >
                <div className="ach-row-icon">
                  {a.icon ? <img src={a.icon} alt="" /> : <Trophy size={20} />}
                  {!a.unlocked && (
                    <span className="ach-row-lock">
                      <Lock size={12} />
                    </span>
                  )}
                </div>
                <div className="ach-row-body">
                  <strong>{a.hidden && !a.unlocked ? "Succès caché" : a.name}</strong>
                  <span>{a.hidden && !a.unlocked ? "Débloque-le pour révéler sa description." : a.description}</span>
                  {a.unlocked && a.unlockedAt && (
                    <span className="ach-row-date">Débloqué le {fmtDate(a.unlockedAt)}</span>
                  )}
                </div>
                {a.rarity != null && (
                  <div className="ach-row-rarity" title="% de joueurs">
                    {a.rarity}%
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
