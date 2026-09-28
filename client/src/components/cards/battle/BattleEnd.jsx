import { useEffect, useState } from "react";
import {
  Coins,
  Flame,
  RotateCcw,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Crown,
  Hourglass,
  Star,
  Gift,
  Swords,
  LogOut,
} from "lucide-react";
import { playBattleChips, playBattleTier } from "../../../lib/sfx";
import Burst from "../../Burst";

// ======================================================================
//  Fin de partie : le mot en grand, le score, les gains qui défilent,
//  et la barre de la passe qui avance
// ======================================================================

const TITLES = { you: "Victoire", bot: "Défaite", draw: "Égalité" };

function CountUp({ to, delay = 700, dur = 900 }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    let t0 = 0;
    const start = setTimeout(() => {
      const tick = (t) => {
        if (!t0) t0 = t;
        const k = Math.min(1, (t - t0) / dur);
        setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      if (to > 0) playBattleChips();
    }, delay);
    return () => {
      clearTimeout(start);
      cancelAnimationFrame(raf);
    };
  }, [to, delay, dur]);
  return <>{v.toLocaleString("fr-FR")}</>;
}

// La barre du palier en cours : elle part de là où on en était, et se remplit
// des étoiles gagnées. Un palier franchi : elle termine pleine, et le booster
// débloqué s'annonce.
function PassProgress({ pass }) {
  const tiers = pass.tiers || [];
  const unlocked = pass.unlocked || [];
  // Le palier à montrer : le dernier franchi pendant cette partie, sinon
  // celui qu'on est en train de remplir.
  const shown = unlocked.length
    ? tiers.find((t) => t.n === unlocked[unlocked.length - 1])
    : tiers.find((t) => pass.stars < t.need) || tiers[tiers.length - 1];
  const span = Math.max(1, shown.need - shown.from);
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const p0 = clamp((pass.before - shown.from) / span);
  const p1 = clamp((pass.stars - shown.from) / span);
  const [p, setP] = useState(p0);
  const [pop, setPop] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setP(p1), 1300);
    const b = setTimeout(() => {
      if (!unlocked.length) return;
      setPop(true);
      playBattleTier();
    }, 2100);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
    // Une seule animation par écran de fin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="ba-pass">
      <div className="ba-pass-row">
        <span className="ba-pass-gain">
          <Star />+{pass.gained}
        </span>
        <span className="ba-pass-bar">
          <i style={{ "--p": p }} />
        </span>
        <span className="ba-pass-tier">{shown.n}</span>
      </div>
      {pop && (
        <span className="ba-chip gold ba-pass-unlock">
          <Gift />
          {unlocked.length > 1 ? `${unlocked.length} boosters débloqués` : "Booster débloqué"}
        </span>
      )}
    </div>
  );
}

// Contre un pote : « Revanche » plutôt que « Rejouer » ; et s'il l'a déjà
// proposée, le bouton l'accepte (`rematch` = { by }).
export default function BattleEnd({ end, onReplay, onExit, opp = null, replayLabel = "Rejouer", rematch = null }) {
  const w = end.winner;
  const r = end.reward || {};
  const title = end.cancelled ? "Annulé" : end.quit ? "Abandon" : TITLES[w] || "Fin";
  const again = rematch ? "Accepter" : replayLabel;
  const AgainIcon = opp ? Swords : RotateCcw;
  const lvl = r.level;
  const up = lvl && lvl.to > lvl.from;
  const down = lvl && lvl.to < lvl.from;
  const unlocked = end.pass?.unlocked?.length > 0;
  return (
    <div className={`ba-end w-${w}`}>
      {w === "you" && (
        <span className="ba-end-burst">
          <Burst colors={["#f2b70b", "#ffffff", "#ff5470"]} count={34} spread={220} />
        </span>
      )}
      <div className="ba-end-box">
        {w === "you" && <Crown className="ba-end-crown" />}
        <h2 className="ba-end-title">
          {title.split("").map((c, i) => (
            <span key={i} style={{ animationDelay: `${120 + i * 55}ms` }}>
              {c}
            </span>
          ))}
        </h2>
        <div className="ba-end-score">
          <b className="you">{end.score?.you ?? 0}</b>
          <i />
          <b className="bot">{end.score?.bot ?? 0}</b>
        </div>

        <div className="ba-end-gain">
          <Coins />
          <span>
            +<CountUp to={r.points || 0} />
          </span>
        </div>

        {end.pass && <PassProgress pass={end.pass} />}

        <div className="ba-end-chips">
          {r.perfect && <span className="ba-chip gold">Parfait</span>}
          {w === "you" && r.streak > 1 && (
            <span className="ba-chip flame">
              <Flame />×{r.streak}
            </span>
          )}
          {lvl && (
            <span className={`ba-chip lvl ${up ? "up" : down ? "down" : ""}`}>
              Bot niv. {lvl.from}
              {(up || down) && (
                <>
                  {up ? <ArrowUp /> : <ArrowDown />}
                  {lvl.to}
                </>
              )}
            </span>
          )}
          {end.forfeit === "bot" && (
            <span className="ba-chip dim">
              <LogOut />
              {opp?.username || "Ton adversaire"} a quitté
            </span>
          )}
          {r.tired && (
            <span className="ba-chip dim" title="Au-delà de 12 parties par jour, les points sont divisés par 4 et une victoire ne rapporte plus qu'une étoile">
              <Hourglass />÷4
            </span>
          )}
        </div>

        {rematch && (
          <div className="ba-end-rematch">
            <span className="ba-end-rematch-ava">
              {rematch.by?.avatar ? <img src={rematch.by.avatar} alt="" draggable="false" /> : <b>{(rematch.by?.username || "?")[0]}</b>}
            </span>
            <span>
              <b>{rematch.by?.username}</b> veut sa revanche
            </span>
          </div>
        )}

        <div className="ba-end-actions">
          {unlocked && !rematch ? (
            <button className="ba-btn gold clickable" onClick={onExit}>
              <Gift />
              Récupérer
            </button>
          ) : (
            <button className="ba-btn gold clickable" onClick={onReplay}>
              <AgainIcon />
              {again}
            </button>
          )}
          {unlocked && !rematch ? (
            <button className="ba-btn ghost clickable" onClick={onReplay}>
              <AgainIcon />
              {again}
            </button>
          ) : (
            <button className="ba-btn ghost clickable" onClick={onExit}>
              <ArrowLeft />
              Retour
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
