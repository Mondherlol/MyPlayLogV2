import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Bot, Link2, Loader2, Play, Swords, UserPlus, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useToast } from "../context/ToastContext";
import { apiFetch } from "../lib/api";
import DuelFriends, { FriendFace } from "../components/cards/battle/DuelFriends";
import TeamArena from "../components/cards/battle/TeamArena";
import { teamDriver } from "../components/cards/battle/drivers";

// ======================================================================
//  2 contre 2 — la table, puis l'arène
// ======================================================================
// Une adresse par table (/cartes/equipe/<code>). Quatre places : deux or,
// deux roses. On s'assoit où on veut (un clic sur une place libre), on invite
// ses potes, et l'hôte lance : chaque place restée vide devient un bot. On
// peut donc jouer seul avec un bot contre deux bots, à deux contre deux bots,
// à trois avec un bot, ou à quatre.

function Seat({ s, room, me, busy, onSit, onInvite }) {
  const u = s.user;
  const mine = room.seat === s.seat;
  const open = room.status === "lobby" && !u;
  return (
    <div className={`tl-seat ${s.team === "a" ? "you" : "bot"} ${u ? "full" : "empty"} ${mine ? "mine" : ""}`}>
      <span className="tl-face">
        {u ? <FriendFace u={u} size={58} dot={u.online && !mine} /> : <Bot />}
      </span>
      <b className="tl-name">{u ? (mine ? me?.username : u.username) : "Bot"}</b>
      {open && (
        <span className="tl-seat-actions">
          <button className="tl-btn clickable" onClick={() => onSit(s.seat)} disabled={busy} title="M'asseoir ici">
            {room.member ? "Ici" : "Rejoindre"}
          </button>
          {room.member && (
            <button className="tl-btn icon clickable" onClick={() => onInvite(s.seat)} title="Inviter un pote">
              <UserPlus />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function CardTeamRoom() {
  const { code } = useParams();
  const { token, user, updateUser } = useAuth();
  const { subscribe } = useChat();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [room, setRoom] = useState(null);
  const [err, setErr] = useState("");
  const [gone, setGone] = useState(false);
  const [game, setGame] = useState(null); // { view, resumed, run }
  const [driver, setDriver] = useState(null);
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(null); // la place à remplir
  const [rematch, setRematch] = useState(null);
  const started = useRef(false);

  const begin = useCallback((view, resumed) => {
    if (started.current || !view) return;
    started.current = true;
    setGame({ view, resumed, run: Date.now() });
  }, []);

  const load = useCallback(() => {
    if (!token) return Promise.resolve(null);
    return apiFetch(`/cards/team/${code}`, { token })
      .then((d) => {
        setRoom(d.room);
        if (d.room.member && d.state && d.room.status !== "lobby") begin(d.state, true);
        return d;
      })
      .catch((e) => {
        if (e.status === 404) setGone(true);
        else setErr(e.message);
        return null;
      });
  }, [code, token, begin]);

  // ⚠️ UNE REQUÊTE À LA FOIS : un double clic ne s'assoit pas deux fois.
  const sitRef = useRef(null);
  const sit = useCallback(
    (seat) => {
      if (sitRef.current) return sitRef.current;
      setBusy(true);
      sitRef.current = apiFetch(`/cards/team/${code}/sit`, { method: "POST", token, body: { seat } })
        .then((d) => {
          setErr("");
          setRoom(d.room);
        })
        .catch((e) => setErr(e.message))
        .finally(() => {
          sitRef.current = null;
          setBusy(false);
        });
      return sitRef.current;
    },
    [code, token]
  );

  useEffect(() => {
    let alive = true;
    load().then((d) => {
      // Arrivé par une invitation (ou une revanche) : on s'assoit directement.
      const m = location.search.match(/place=(\d)/);
      if (alive && d && !d.room.member && d.room.status === "lobby" && (m || location.search.includes("rejoindre")))
        sit(m ? Number(m[1]) : null);
    });
    return () => {
      alive = false;
    };
    // Une fois par table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, token]);

  // Le direct : la table bouge, la partie part, l'hôte ferme.
  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((event, data) => {
      if (event !== "cardteam" || data?.code !== code) return;
      if (data.kind === "room" && data.room) setRoom(data.room);
      else if (data.kind === "start") {
        if (data.room) setRoom(data.room);
        begin(data.state, false);
      } else if (data.kind === "closed") {
        setGone(true);
        toast.show({ title: "2 contre 2", text: "L'hôte a fermé la table", error: true });
      }
    });
  }, [subscribe, code, begin, toast]);

  // En attendant : le direct peut décrocher, on regarde quand même.
  useEffect(() => {
    if (game || gone || !room || room.status !== "lobby") return undefined;
    const iv = setInterval(() => {
      if (document.visibilityState !== "hidden") load();
    }, 5000);
    return () => clearInterval(iv);
  }, [game, gone, room, load]);

  useEffect(() => {
    if (!game) return undefined;
    const d = teamDriver({ token, code, seat: game.view.seat, subscribe });
    d.on("rematch", (x) => setRematch({ next: x.next, by: x.by, seat: x.seat }));
    setDriver(d);
    return () => {
      d.destroy();
      setDriver(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.run]);

  async function invite(f) {
    const d = await apiFetch(`/cards/team/${code}/invite`, { method: "POST", token, body: { user: f.id, seat: inviting } });
    setInviting(null);
    toast.show({ title: f.username, text: d.online ? "Invitation envoyée" : "Hors ligne : envoie-lui le lien" });
    if (!d.online) copyLink(true);
  }

  async function copyLink(quiet = false) {
    const url = `${window.location.origin}/cartes/equipe/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      if (!quiet) toast.show({ title: "2 contre 2", text: "Lien copié" });
    } catch {
      if (!quiet) toast.show({ title: "2 contre 2", text: url });
    }
  }

  const startRef = useRef(null);
  function start() {
    if (startRef.current) return;
    setBusy(true);
    startRef.current = apiFetch(`/cards/team/${code}/start`, { method: "POST", token })
      .then((d) => {
        setErr("");
        setRoom(d.room);
        begin(d.state, false);
      })
      .catch((e) => setErr(e.message))
      .finally(() => {
        startRef.current = null;
        setBusy(false);
      });
  }

  async function leave() {
    try {
      await apiFetch(`/cards/team/${code}/quit`, { method: "POST", token });
    } catch {
      /* déjà fermée */
    }
    navigate("/cartes/combat");
  }

  const againRef = useRef(null);
  function again() {
    if (againRef.current) return;
    againRef.current = apiFetch(`/cards/team/${code}/rematch`, { method: "POST", token })
      .then((d) => navigate(`/cartes/equipe/${d.next}${d.mine ? "" : `?place=${d.seat}`}`))
      .catch((e) => toast.show({ title: "Revanche", text: e.message, error: true }))
      .finally(() => {
        againRef.current = null;
      });
  }

  if (game && driver) {
    return (
      <TeamArena
        key={game.run}
        me={user}
        initial={game.view}
        resumed={game.resumed}
        driver={driver}
        rematch={rematch}
        onExit={() => navigate("/cartes/combat")}
        onReplay={again}
        onBalance={(points) => updateUser?.({ points })}
      />
    );
  }

  const lobby = room?.status === "lobby";
  const seats = room?.seats || [];
  const humans = seats.filter((s) => s.user).length;

  return (
    <div className="bl-page tl-page">
      <header className="bl-head">
        <Link to="/cartes/combat" className="bl-back clickable" title="Combat">
          <ArrowLeft />
        </Link>
        <h1 className="bl-title">2 contre 2</h1>
        {room && <span className="dl-code">{code.toUpperCase()}</span>}
      </header>

      {gone ? (
        <section className="bl-hero dl-hero">
          <p className="dl-msg">Cette table n'existe plus.</p>
          <Link to="/cartes/combat" className="bl-play clickable">
            <Swords />
            Combat
          </Link>
        </section>
      ) : !room ? (
        <section className="bl-hero dl-hero">
          <Loader2 className="spin" />
        </section>
      ) : (
        <section className="bl-hero tl-hero">
          <div className="tl-table">
            <div className="tl-team you">
              {seats.slice(0, 2).map((s) => (
                <Seat key={s.seat} s={s} room={room} me={user} busy={busy} onSit={sit} onInvite={setInviting} />
              ))}
            </div>
            <span className="tl-vs">VS</span>
            <div className="tl-team bot">
              {seats.slice(2).map((s) => (
                <Seat key={s.seat} s={s} room={room} me={user} busy={busy} onSit={sit} onInvite={setInviting} />
              ))}
            </div>
          </div>

          {err && <p className="cd-err">{err}</p>}

          <div className="bl-actions">
            {lobby && room.isHost ? (
              <>
                <button className="bl-play clickable" onClick={start} disabled={busy}>
                  {busy ? <Loader2 className="spin" /> : <Play />}
                  Lancer
                  {humans < 4 && (
                    <span className="tl-bots" title="Les places vides seront jouées par des bots">
                      <Bot />
                      {4 - humans}
                    </span>
                  )}
                </button>
                <div className="dl-row">
                  <button className="bl-new clickable" onClick={() => copyLink()}>
                    <Link2 />
                    Copier le lien
                  </button>
                  <button className="bl-new clickable" onClick={leave}>
                    <X />
                    Fermer
                  </button>
                </div>
              </>
            ) : lobby && room.member ? (
              <>
                <p className="dl-msg tl-wait">
                  <FriendFace u={room.host} size={26} />
                  {room.host?.username} lance la partie
                  <i className="dl-dots">
                    <i />
                    <i />
                    <i />
                  </i>
                </p>
                <div className="dl-row">
                  <button className="bl-new clickable" onClick={() => copyLink()}>
                    <Link2 />
                    Copier le lien
                  </button>
                  <button className="bl-new clickable" onClick={leave}>
                    <X />
                    Quitter
                  </button>
                </div>
              </>
            ) : !lobby ? (
              <>
                <p className="dl-msg">{room.status === "done" ? "Cette partie est terminée." : "Cette partie a déjà commencé."}</p>
                <Link to="/cartes/combat" className="bl-new clickable">
                  <ArrowLeft />
                  Combat
                </Link>
              </>
            ) : null}
          </div>
        </section>
      )}

      {inviting != null && room?.member && lobby && (
        <DuelFriends
          token={token}
          title="Inviter un pote"
          action="Inviter"
          onPick={invite}
          onLink={() => copyLink().then(() => setInviting(null))}
          onClose={() => setInviting(null)}
        />
      )}
    </div>
  );
}

export default function CardTeam() {
  const { code } = useParams();
  return <CardTeamRoom key={code} />;
}
