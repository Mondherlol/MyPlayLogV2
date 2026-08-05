import { useEffect, useState } from "react";
import { Loader2, Copy, Check, Swords, Crown } from "lucide-react";
import { apiFetch } from "../lib/api";

// Scoreboard détaillé d'une partie, affiché EN LIGNE (dans la carte de match
// dépliée — plus de modale). Charge le détail depuis le serveur à l'ouverture,
// puis rend les deux équipes (la mienne d'abord), chaque joueur avec héros,
// rang, K/D/A, dégâts, dégâts subis et soin. MVP/SVP mis en avant.

function PlayerRow({ p, isMe, ranked }) {
  return (
    <tr className={`sb-row ${isMe ? "me" : ""} ${p.win ? "win" : "loss"}`}>
      <td className="sb-c-hero">
        <div className="sb-hero-wrap">
          <span className="sb-hero-thumb" title={p.heroName}>
            {p.heroThumb ? (
              <img src={p.heroThumb} alt={p.heroName} loading="lazy" />
            ) : (
              <span className="sb-hero-fb">{(p.heroName || "?")[0]}</span>
            )}
          </span>
          <span className="sb-name">
            {p.name}
            {p.isMvp && <span className="sb-badge mvp">MVP</span>}
            {p.isSvp && <span className="sb-badge svp">SVP</span>}
          </span>
        </div>
      </td>
      {ranked && (
        <td className="sb-c-rank">
          <div className="sb-rank">
            {p.rankImage && <img className="sb-rank-img" src={p.rankImage} alt="" />}
            <span className="sb-rank-tier">{p.rankTier || "—"}</span>
            {p.rankDelta != null && p.rankDelta !== 0 && (
              <span className="sb-rank-score">
                <b className={p.rankDelta > 0 ? "up" : "down"}>
                  {p.rankDelta > 0 ? "+" : ""}
                  {p.rankDelta}
                </b>
              </span>
            )}
          </div>
        </td>
      )}
      <td className="sb-c-kda">
        <b>
          {p.k} / {p.d} / {p.a}
        </b>
        <span className="sb-kda-ratio">{p.kda} KDA</span>
      </td>
      <td className="sb-c-num">{p.damage.toLocaleString("fr-FR")}</td>
      <td className="sb-c-num">{p.damageTaken.toLocaleString("fr-FR")}</td>
      <td className="sb-c-num">{p.healing.toLocaleString("fr-FR")}</td>
    </tr>
  );
}

function TeamTable({ team, label, meUid, ranked }) {
  return (
    <div className={`sb-team ${team.win ? "win" : "loss"}`}>
      <div className="sb-team-head">
        <span className="sb-team-label">
          {team.win && <Crown size={13} />}
          {label}
        </span>
        <span className={`sb-team-res ${team.win ? "win" : "loss"}`}>
          {team.win ? "Victoire" : "Défaite"}
        </span>
      </div>
      <div className="sb-table-wrap">
        <table className="sb-table">
          <thead>
            <tr>
              <th>Joueur</th>
              {ranked && <th>Rang</th>}
              <th>K / D / A</th>
              <th>Dégâts</th>
              <th>Subis</th>
              <th>Soin</th>
            </tr>
          </thead>
          <tbody>
            {team.players.map((p) => (
              <PlayerRow
                key={p.uid}
                p={p}
                isMe={String(p.uid) === String(meUid)}
                ranked={ranked}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MatchScoreboard({ match, meUid, token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    const q = match.mapId ? `?map=${match.mapId}` : "";
    apiFetch(`/trackers/marvel-rivals/match/${encodeURIComponent(match.matchUid)}${q}`, {
      token,
    })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message || "Détail indisponible."));
    return () => {
      alive = false;
    };
  }, [match.matchUid, match.mapId, token]);

  // Mon équipe (celle qui me contient) d'abord, puis les adversaires.
  const teams = data?.teams || [];
  const myTeam = teams.find((t) => t.players.some((p) => String(p.uid) === String(meUid)));
  const ordered = myTeam ? [myTeam, ...teams.filter((t) => t !== myTeam)] : teams;

  function copyReplay() {
    if (!data?.replayId) return;
    navigator.clipboard?.writeText(data.replayId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (error) return <div className="sb-msg">{error}</div>;
  if (!data)
    return (
      <div className="sb-msg">
        <Loader2 size={18} className="spin" /> Chargement du scoreboard…
      </div>
    );

  return (
    <div className="sb-body">
      {ordered.map((t, i) => (
        <TeamTable
          key={t.camp}
          team={t}
          meUid={meUid}
          ranked={data.ranked}
          label={myTeam ? (i === 0 ? "Mon équipe" : "Adversaires") : `Équipe ${t.camp + 1}`}
        />
      ))}

      {data.replayId && (
        <div className="sb-replay">
          <Swords size={13} /> Replay&nbsp;: <code>{data.replayId}</code>
          <button className="sb-copy clickable" onClick={copyReplay}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copié" : "Copier"}
          </button>
        </div>
      )}
    </div>
  );
}
