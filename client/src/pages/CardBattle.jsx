import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bot,
  Check,
  Coins,
  Flame,
  Gift,
  Lock,
  Medal,
  Package,
  Play,
  RotateCcw,
  Star,
  Swords,
  Trophy,
  Users,
  UsersRound,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { TYPE_KEYS } from "../lib/cards";
import { TypeBadge } from "../components/cards/TcgCard";
import Arena from "../components/cards/battle/Arena";
import BoosterPack from "../components/cards/BoosterPack";
import PackOpening from "../components/cards/PackOpening";
import DuelFriends, { FriendFace } from "../components/cards/battle/DuelFriends";
import { useToast } from "../context/ToastContext";

// ======================================================================
//  Combat — le hall avant la partie, puis l'arène plein écran
// ======================================================================
// Le hall : moi contre le bot (et son niveau), mon palmarès, un gros bouton.
// Puis la PASSE : dix paliers, un booster au bout de chacun (le dernier est
// doré), qu'on ouvre d'un clic. En dessous, le tableau des types en
// pictogrammes : qui bat qui.

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

// Miroir de BEATS (server/src/lib/cardBattle.js) — pour le tableau seulement.
const BEATS = {
  combat: ["sport", "tir"],
  tir: ["course", "rpg"],
  plateforme: ["tir", "sport"],
  course: ["aventure", "strategie"],
  strategie: ["combat", "rythme"],
  simulation: ["course", "strategie"],
  aventure: ["reflexion", "plateforme"],
  rpg: ["arcade", "aventure"],
  reflexion: ["arcade", "rythme"],
  sport: ["simulation", "reflexion"],
  rythme: ["plateforme", "recit"],
  arcade: ["recit", "simulation"],
  recit: ["combat", "rpg"],
};

export default function CardBattle() {
  const { token, user, updateUser } = useAuth();
  const [home, setHome] = useState(null);
  const [err, setErr] = useState("");
  const [game, setGame] = useState(null); // { view, run, resumed }
  const [starting, setStarting] = useState(false);
  const [opening, setOpening] = useState(null); // { tier, edition, origin, run }
  const navigate = useNavigate();
  const startRef = useRef(null);

  const load = useCallback(() => {
    if (!token) return () => {};
    let alive = true;
    apiFetch("/cards/battle", { token })
      .then((d) => {
        if (!alive) return;
        setErr("");
        setHome(d);
      })
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [token]);
  useEffect(() => load(), [load]);

  // ⚠️ UNE PARTIE PAR CLIC : la requête vit dans une ref, un double clic (ou
  // un double rendu) se rebranche sur la même promesse.
  async function start() {
    if (startRef.current) return startRef.current;
    setStarting(true);
    startRef.current = apiFetch("/cards/battle", { method: "POST", token })
      .then((view) => {
        setErr("");
        setGame({ view, run: Date.now(), resumed: false });
      })
      .catch((e) => setErr(e.message))
      .finally(() => {
        startRef.current = null;
        setStarting(false);
      });
    return startRef.current;
  }

  // Un duel contre un pote : la liste de mes potes s'ouvre, un clic le défie
  // (salon ouvert + défi envoyé d'un coup), et on file au salon l'attendre.
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [friends, setFriends] = useState(null);
  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    apiFetch("/cards/duel/friends", { token })
      .then((d) => alive && setFriends(d.friends || []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);
  const available = (friends || []).filter((f) => f.online && f.ready && !f.busy);
  async function challenge(f) {
    const d = await apiFetch("/cards/duel", { method: "POST", token, body: { invite: f.id } });
    toast.show({ title: f.username, text: d.online ? "Défi envoyé" : "Hors ligne : le défi l'attend dans ses messages" });
    navigate(`/cartes/duel/${d.room.code}`);
  }
  async function duelLink() {
    const d = await apiFetch("/cards/duel", { method: "POST", token });
    const url = `${window.location.origin}/cartes/duel/${d.room.code}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ title: "Duel", text: "Lien copié : envoie-le à ton pote" });
    } catch {
      toast.show({ title: "Duel", text: url });
    }
    navigate(`/cartes/duel/${d.room.code}`);
  }

  // Le 2 contre 2 : une table s'ouvre, j'y suis assis, j'invite qui je veux.
  const teamRef = useRef(null);
  function openTeam() {
    if (teamRef.current) return;
    teamRef.current = apiFetch("/cards/team", { method: "POST", token })
      .then((d) => navigate(`/cartes/equipe/${d.room.code}`))
      .catch((e) => toast.show({ title: "2 contre 2", text: e.message, error: true }))
      .finally(() => {
        teamRef.current = null;
      });
  }

  function resume() {
    if (!home?.live) return;
    setGame({ view: home.live, run: Date.now(), resumed: true });
  }

  function exit() {
    setGame(null);
    load();
  }

  // Ouvrir le booster d'un palier : il s'envole depuis la piste.
  function claim(t, el) {
    if (!t.done || t.claimed || opening) return;
    setOpening({ tier: t.n, edition: t.edition, origin: el?.getBoundingClientRect?.() || null, run: Date.now() });
  }

  const s = home?.stats;
  const pass = home?.pass;
  // Il faut un deck complet de SES cartes pour combattre.
  const minCards = home?.minCards || 15;
  const locked = !!home && (home.cards ?? 0) < minCards;
  const covers = (home?.packCovers || []).slice(0, 8);
  const level = s?.level || 1;
  const maxLevel = s?.maxLevel || 10;

  return (
    <div className="bl-page">
      <header className="bl-head">
        <Link to="/arcade" className="bl-back clickable" title="Arcade">
          <ArrowLeft />
        </Link>
        <h1 className="bl-title">Combat</h1>
        <Link to="/arcade" className="cd-wallet clickable" title="Points d'arcade">
          <Coins size={18} />
          <b>{fmt(user?.points)}</b>
        </Link>
      </header>

      {err && <p className="cd-err">{err}</p>}

      <section className="bl-hero">
        <div className="bl-vs">
          <span className="bl-fighter me">
            <span className="bl-ava">
              {user?.avatar ? <img src={user.avatar} alt="" draggable="false" /> : <b>{(user?.username || "?")[0]}</b>}
            </span>
            <b>{user?.username}</b>
          </span>
          <span className="bl-vs-x">
            <Swords />
          </span>
          <span className="bl-fighter bot">
            <span className="bl-ava">
              <Bot />
            </span>
            <b>Bot · niv. {level}</b>
          </span>
        </div>

        <div className="bl-level" title={`Niveau du bot : ${level}/${maxLevel}`}>
          {Array.from({ length: maxLevel }, (_, i) => (
            <i key={i} className={i < level ? "on" : ""} />
          ))}
        </div>

        <div className="bl-actions">
          {locked ? (
            <div className="bl-lock">
              <span className="bl-lock-row">
                <Lock />
                <b>
                  {home.cards} / {minCards}
                </b>
                <span className="bl-lock-bar">
                  <i style={{ "--p": Math.min(1, (home.cards || 0) / minCards) }} />
                </span>
              </span>
              <p>Il te faut {minCards} cartes pour combattre.</p>
              <Link to="/cartes" className="bl-play clickable">
                <Package />
                Ouvrir des boosters
              </Link>
            </div>
          ) : home?.live && !home.live.end ? (
            <>
              <button className="bl-play clickable" onClick={resume}>
                <Play />
                Reprendre
              </button>
              <button className="bl-new clickable" onClick={start} disabled={starting}>
                <RotateCcw />
                Nouvelle partie
              </button>
            </>
          ) : (
            <button className="bl-play clickable" onClick={start} disabled={starting || !home}>
              <Swords />
              Jouer
            </button>
          )}
          {!locked && home && (
            home.duel ? (
              <Link to={`/cartes/duel/${home.duel.code}`} className="bl-duel live clickable">
                <span className="bl-duel-ava">
                  {home.duel.opponent?.avatar ? (
                    <img src={home.duel.opponent.avatar} alt="" draggable="false" />
                  ) : (
                    <b>{(home.duel.opponent?.username || "?")[0]}</b>
                  )}
                </span>
                Duel contre {home.duel.opponent?.username}
                <b>
                  {home.duel.score.you}–{home.duel.score.bot}
                </b>
              </Link>
            ) : (
              <button className="bl-duel cta clickable" onClick={() => setPicking(true)}>
                <Users />
                Défier un pote
                {available.length > 0 && (
                  <span className="bl-duel-faces" title={`${available.length} en ligne`}>
                    {available.slice(0, 3).map((f) => (
                      <FriendFace key={f.id} u={f} size={26} dot />
                    ))}
                  </span>
                )}
              </button>
            )
          )}
          {!locked && home && (
            home.team ? (
              <Link to={`/cartes/equipe/${home.team.code}`} className="bl-duel team live clickable">
                <UsersRound />
                2 contre 2 en cours
                <b>
                  {home.team.score.you}–{home.team.score.bot}
                </b>
              </Link>
            ) : (
              <button className="bl-duel team clickable" onClick={openTeam}>
                <UsersRound />
                2 contre 2
              </button>
            )
          )}
        </div>

        <div className="bl-stats">
          <span title="Victoires">
            <Trophy />
            <b>{fmt(s?.wins)}</b>
          </span>
          <span title="Série en cours" className={s?.streak ? "hot" : ""}>
            <Flame />
            <b>{fmt(s?.streak)}</b>
          </span>
          <span title="Meilleure série">
            <Medal />
            <b>{fmt(s?.best)}</b>
          </span>
          {home?.duels?.wins + home?.duels?.losses + home?.duels?.draws > 0 && (
            <span title="Duels gagnés contre des potes" className="duel">
              <Users />
              <b>{fmt(home.duels.wins)}</b>
            </span>
          )}
          {home?.teams?.wins + home?.teams?.losses + home?.teams?.draws > 0 && (
            <span title="Victoires en 2 contre 2" className="duel team">
              <UsersRound />
              <b>{fmt(home.teams.wins)}</b>
            </span>
          )}
        </div>
      </section>

      {pass && (
        <section className="bp">
          <header className="bp-head">
            <h2 className="bl-h2">
              Passe <em>Saison {pass.season}</em>
            </h2>
            <span className="bp-stars">
              <Star />
              {pass.stars}
              <small>/ {pass.total}</small>
            </span>
          </header>
          <div className="bp-track">
            {pass.tiers.map((t) => {
              const span = Math.max(1, t.need - t.from);
              const fill = Math.max(0, Math.min(1, (pass.stars - t.from) / span));
              const ready = t.done && !t.claimed;
              return (
                <div
                  key={t.n}
                  className={`bp-tier ${t.done ? "done" : ""} ${t.claimed ? "claimed" : ""} ${ready ? "ready" : ""} ${
                    t.golden ? "gold" : ""
                  }`}
                >
                  <button
                    className="bp-pack clickable"
                    disabled={!ready}
                    onClick={(e) => claim(t, e.currentTarget)}
                    title={ready ? "Ouvrir" : t.claimed ? "Récupéré" : `${t.need} étoiles`}
                  >
                    <BoosterPack edition={t.edition} golden={t.golden} covers={covers} />
                    {t.claimed && (
                      <span className="bp-badge ok">
                        <Check />
                      </span>
                    )}
                    {!t.done && (
                      <span className="bp-badge">
                        <Lock />
                      </span>
                    )}
                  </button>
                  <span className="bp-seg" style={{ "--p": fill }}>
                    <i />
                  </span>
                  {ready ? (
                    <span className="bp-go">
                      <Gift />
                      <span>Ouvrir</span>
                    </span>
                  ) : (
                    <span className="bp-need">{t.need}</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="bl-types">
        <h2 className="bl-h2">Types</h2>
        <div className="bl-type-grid">
          {TYPE_KEYS.filter((k) => BEATS[k]).map((k) => (
            <div className="bl-type-row" key={k}>
              <TypeBadge type={k} />
              <span className="bl-beats">×2</span>
              {BEATS[k].map((t) => (
                <TypeBadge key={t} type={t} />
              ))}
            </div>
          ))}
        </div>
      </section>

      {opening && (
        <PackOpening
          key={opening.run}
          token={token}
          edition={opening.edition}
          covers={home?.packCovers || []}
          origin={opening.origin}
          price={0}
          request={() =>
            apiFetch("/cards/battle/pass/claim", { method: "POST", token, body: { tier: opening.tier } })
          }
          onOpened={(res) =>
            setHome((h) =>
              h ? { ...h, pass: res.pass, stats: { ...h.stats, claimable: res.pass.claimable } } : h
            )
          }
          onAgain={() => {}}
          onBinder={() => navigate("/cartes")}
          onClose={() => setOpening(null)}
        />
      )}

      {picking && (
        <DuelFriends token={token} onPick={challenge} onLink={duelLink} onClose={() => setPicking(false)} />
      )}

      {game && (
        <Arena
          key={game.run}
          token={token}
          me={user}
          initial={game.view}
          resumed={game.resumed}
          onExit={exit}
          onReplay={() => {
            setGame(null);
            start();
          }}
          onBalance={(points) => updateUser({ points })}
        />
      )}
    </div>
  );
}
