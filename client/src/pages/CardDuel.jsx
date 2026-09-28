import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Link2, Loader2, Swords, Users, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useToast } from "../context/ToastContext";
import { apiFetch } from "../lib/api";
import DuelFriends from "../components/cards/battle/DuelFriends";
import Arena from "../components/cards/battle/Arena";
import { duelDriver } from "../components/cards/battle/drivers";

// ======================================================================
//  Duel — 1 contre 1 avec un pote, en temps réel
// ======================================================================
// Une adresse par duel (/cartes/duel/<code>), qu'on envoie à qui on veut :
//   - l'hôte attend dans le salon (inviter, copier le lien) ;
//   - l'invité arrive, accepte : la partie part aussitôt chez les deux ;
//   - ensuite, c'est l'arène du combat contre le bot, avec mon pote en face.
// Revenir sur l'adresse en pleine partie la reprend.

function Face({ u, empty = false }) {
  return (
    <span className={`bl-ava ${empty ? "empty" : ""}`}>
      {empty ? <i className="dl-dots"><i /><i /><i /></i> : u?.avatar ? (
        <img src={u.avatar} alt="" draggable="false" />
      ) : (
        <b>{(u?.username || "?")[0]}</b>
      )}
    </span>
  );
}

function CardDuelRoom() {
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
  const [inviting, setInviting] = useState(() => location.search.includes("inviter"));
  const [rematch, setRematch] = useState(null); // { next, by }
  const started = useRef(false);
  const joinRef = useRef(null);

  const begin = useCallback((view, resumed) => {
    if (started.current || !view) return;
    started.current = true;
    setGame({ view, resumed, run: Date.now() });
  }, []);

  // ⚠️ UNE SEULE ENTRÉE : un double clic se rebranche sur la même requête.
  const join = useCallback(() => {
    if (joinRef.current) return joinRef.current;
    setBusy(true);
    joinRef.current = apiFetch(`/cards/duel/${code}/join`, { method: "POST", token })
      .then((d) => {
        setErr("");
        setRoom(d.room);
        begin(d.state, false);
      })
      .catch((e) => setErr(e.message))
      .finally(() => {
        joinRef.current = null;
        setBusy(false);
      });
    return joinRef.current;
  }, [code, token, begin]);

  const load = useCallback(() => {
    if (!token) return Promise.resolve();
    return apiFetch(`/cards/duel/${code}`, { token })
      .then((d) => {
        setRoom(d.room);
        if (d.room.member && d.state) begin(d.state, true);
        return d;
      })
      .catch((e) => {
        if (e.status === 404) setGone(true);
        else setErr(e.message);
        return null;
      });
  }, [code, token, begin]);

  useEffect(() => {
    let alive = true;
    load().then((d) => {
      // Arrivé par « Accepter la revanche » : on entre directement.
      if (alive && d && !d.room.member && d.room.status === "lobby" && location.search.includes("rejoindre")) join();
    });
    return () => {
      alive = false;
    };
    // Une fois par salon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, token]);

  // Le direct : l'invité est arrivé (la partie part), ou une revanche est
  // proposée. Le reste de la partie passe par le pilote de l'arène.
  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((event, data) => {
      if (event !== "cardduel" || data?.code !== code) return;
      if (data.kind === "start") {
        if (data.room) setRoom(data.room);
        begin(data.state, false);
      } else if (data.kind === "rematch") {
        setRematch({ next: data.next, by: data.by });
      } else if (data.kind === "declined") {
        setRoom((r) => r && { ...r, rival: null });
        toast.show({ title: data.by?.username || "Duel", text: "a refusé le défi", error: true });
      }
    });
  }, [subscribe, code, begin, toast]);

  // Défier un pote depuis le salon (il devient celui qu'on attend).
  async function challenge(f) {
    const d = await apiFetch(`/cards/duel/${code}/challenge`, { method: "POST", token, body: { user: f.id } });
    setRoom(d.room);
    setInviting(false);
    toast.show({
      title: f.username,
      text: d.online ? "Défi envoyé" : "Hors ligne : le défi l'attend dans ses messages",
    });
  }

  // En attendant dans le salon : le direct peut décrocher, on regarde quand
  // même de temps en temps si la partie est partie.
  useEffect(() => {
    if (game || !room?.member || room.status !== "lobby") return undefined;
    const iv = setInterval(() => {
      if (document.visibilityState !== "hidden") load();
    }, 5000);
    return () => clearInterval(iv);
  }, [game, room?.member, room?.status, load]);

  // Le pilote de la partie : un par partie, défait en sortant.
  useEffect(() => {
    if (!game) return undefined;
    const d = duelDriver({ token, code, opponent: game.view.opponent, subscribe });
    d.on("rematch", (x) => setRematch({ next: x.next, by: x.by }));
    setDriver(d);
    return () => {
      d.destroy();
      setDriver(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.run]);

  async function copyLink() {
    const url = `${window.location.origin}/cartes/duel/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ title: "Duel", text: "Lien copié" });
    } catch {
      toast.show({ title: "Duel", text: url });
    }
  }

  async function cancel() {
    try {
      await apiFetch(`/cards/duel/${code}/quit`, { method: "POST", token });
    } catch {
      /* déjà fermé */
    }
    navigate("/cartes/combat");
  }

  // La revanche : la mienne (un nouveau salon, il est prévenu), ou la sienne.
  const againRef = useRef(null);
  function again() {
    if (againRef.current) return;
    againRef.current = apiFetch(`/cards/duel/${code}/rematch`, { method: "POST", token })
      .then((d) => navigate(`/cartes/duel/${d.next}${d.mine ? "" : "?rejoindre"}`))
      .catch((e) => toast.show({ title: "Revanche", text: e.message, error: true }))
      .finally(() => {
        againRef.current = null;
      });
  }

  if (game && driver) {
    return (
      <Arena
        key={game.run}
        token={token}
        me={user}
        initial={game.view}
        resumed={game.resumed}
        driver={driver}
        replayLabel="Revanche"
        rematch={rematch}
        onExit={() => navigate("/cartes/combat")}
        onReplay={again}
        onBalance={(points) => updateUser?.({ points })}
      />
    );
  }

  const host = room?.host;
  const guest = room?.guest;
  const rival = room?.rival;
  const mine = room?.member;
  const lobby = room?.status === "lobby";

  return (
    <div className="bl-page dl-page">
      <header className="bl-head">
        <Link to="/cartes/combat" className="bl-back clickable" title="Combat">
          <ArrowLeft />
        </Link>
        <h1 className="bl-title">Duel</h1>
        {room && <span className="dl-code">{code.toUpperCase()}</span>}
      </header>

      {gone ? (
        <section className="bl-hero dl-hero">
          <p className="dl-msg">Ce duel n'existe plus.</p>
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
        <section className="bl-hero dl-hero">
          <div className="bl-vs">
            <span className="bl-fighter me">
              <Face u={mine ? (room.isHost ? host : guest) || user : user} />
              <b>{user?.username}</b>
            </span>
            <span className="bl-vs-x">
              <Swords />
            </span>
            <span className={`bl-fighter opp ${mine && lobby ? "waiting" : ""}`}>
              {mine && lobby && room.rival ? (
                <>
                  <span className="dl-rival">
                    <Face u={room.rival} />
                    <i className="dl-dots">
                      <i />
                      <i />
                      <i />
                    </i>
                  </span>
                  <b>{room.rival.username}</b>
                </>
              ) : mine && lobby ? (
                <>
                  <Face empty />
                  <b>En attente</b>
                </>
              ) : (
                <>
                  <Face u={room.isHost ? guest : host} />
                  <b>{(room.isHost ? guest : host)?.username}</b>
                </>
              )}
            </span>
          </div>

          {mine && lobby && rival && (
            <span className={`dl-sent ${rival.online ? "on" : ""}`}>
              {rival.online ? "Défi envoyé" : "Hors ligne · le défi l'attend dans ses messages"}
            </span>
          )}

          {err && <p className="cd-err">{err}</p>}

          <div className="bl-actions">
            {mine && lobby ? (
              <>
                {!rival && (
                  <button className="bl-duel cta clickable" onClick={() => setInviting(true)}>
                    <Swords />
                    Défier un pote
                  </button>
                )}
                <div className="dl-row">
                  {rival && (
                    <button className="bl-new clickable" onClick={() => setInviting(true)}>
                      <Users />
                      Quelqu'un d'autre
                    </button>
                  )}
                  <button className="bl-new clickable" onClick={copyLink}>
                    <Link2 />
                    Copier le lien
                  </button>
                  <button className="bl-new clickable" onClick={cancel}>
                    <X />
                    Annuler
                  </button>
                </div>
              </>
            ) : !mine && lobby ? (
              <button className="bl-play clickable" onClick={join} disabled={busy}>
                {busy ? <Loader2 className="spin" /> : <Swords />}
                Accepter le duel
              </button>
            ) : (
              <>
                <p className="dl-msg">{room.status === "done" ? "Ce duel est terminé." : "Ce duel a déjà ses deux joueurs."}</p>
                <Link to="/cartes/combat" className="bl-new clickable">
                  <ArrowLeft />
                  Combat
                </Link>
              </>
            )}
          </div>
        </section>
      )}

      {inviting && room && mine && lobby && (
        <DuelFriends
          token={token}
          title={rival ? "Défier quelqu'un d'autre" : "Défier un pote"}
          onPick={challenge}
          onClose={() => setInviting(false)}
        />
      )}
    </div>
  );
}

// Changer de salon (une revanche) repart de zéro : une clé par code.
export default function CardDuel() {
  const { code } = useParams();
  return <CardDuelRoom key={code} />;
}
