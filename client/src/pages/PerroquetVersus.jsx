import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Ear,
  Loader2,
  Mic,
  MicOff,
  Play,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { apiFetch, apiUpload } from "../lib/api";
import { openMic, closeMic, startTake, canRecord } from "../lib/soundTake";
import { VersusInvite } from "../components/VersusRoom";
import PerroquetHold from "../components/PerroquetHold";
import ContourChart from "../components/ContourChart";

// ======================================================================
//  Le Perroquet — versus
// ======================================================================
// Le même son pour tout le monde, la même fenêtre pour enregistrer, puis on
// écoute les six tentatives classées.
//
// ---------------------------------------------- ce que le client ne fait PAS
// Il ne décide de rien. Les phases s'enchaînent côté serveur (routes/
// perroquetVersus.js) et arrivent par le flux SSE ; cette page les AFFICHE. La
// tentation serait de faire avancer la manche localement quand le chrono
// atteint zéro — ce serait un bug garanti : six navigateurs comptent six temps
// légèrement différents, et la fenêtre commune volerait en éclats.
//
// Le compte à rebours affiché est donc purement décoratif. Il se cale sur
// `phaseEndsAt` corrigé de l'écart d'horloge (`now` du serveur), et quand il
// atteint zéro… il ne se passe rien. C'est le serveur qui envoie la suite.

const PHASE_LABEL = {
  listen: "Écoute bien",
  record: "À toi !",
  reveal: "Le verdict",
};

export default function PerroquetVersus() {
  const { code } = useParams();
  const { token, user } = useAuth();
  const { subscribe } = useChat();
  const navigate = useNavigate();

  const [room, setRoom] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const streamRef = useRef(null);
  const takeRef = useRef(null);
  const audioRef = useRef(null);
  // L'écart entre l'horloge du serveur et celle de cette machine. Sans lui, un
  // poste en avance de 30 s afficherait « 0 s » alors que la fenêtre vient de
  // s'ouvrir, et son joueur ne tenterait même pas.
  const skewRef = useRef(0);
  const playedRef = useRef(-1);

  const phase = room?.phase || "lobby";
  const round = room?.round || null;
  const me = room?.players?.find((p) => p.isMe) || null;

  const applyRoom = useCallback((r) => {
    if (!r) return;
    if (r.now) skewRef.current = r.now - Date.now();
    setRoom(r);
  }, []);

  // ---------- Chargement + adhésion ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await apiFetch(`/perroquet/versus/${code}/join`, {
          method: "POST",
          token,
        });
        if (alive) applyRoom(d.room);
      } catch (e) {
        // Déjà commencé, salon plein, introuvable : on montre l'état plutôt
        // qu'un écran vide, et on tente quand même une lecture seule.
        if (!alive) return;
        setErr(e.message || "Impossible de rejoindre ce salon.");
        try {
          const d = await apiFetch(`/perroquet/versus/${code}`, { token });
          if (alive) applyRoom(d.room);
        } catch {
          /* le message d'erreur suffit */
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, token, applyRoom]);

  // ---------- Le direct ----------
  useEffect(() => {
    if (!subscribe || !code) return undefined;
    return subscribe((event, data) => {
      if (event !== "pqversus" || data?.code !== code) return;
      if (data.room) applyRoom(data.room);
      if (data.kind === "record") {
        // Nouvelle fenêtre : on repart d'une copie non rendue.
        setSent(false);
        setErr("");
      }
    });
  }, [subscribe, code, applyRoom]);

  // ---------- Micro : ouvert une fois, pour toute la partie ----------
  const arm = useCallback(async () => {
    if (!canRecord()) {
      setErr("Ce navigateur ne sait pas enregistrer (il faut https).");
      return;
    }
    try {
      streamRef.current = await openMic();
      await apiFetch(`/perroquet/versus/${code}/armed`, {
        method: "POST",
        token,
        body: { armed: true },
      });
      setErr("");
    } catch (e) {
      setErr(
        e.name === "NotAllowedError"
          ? "Autorise le micro pour participer."
          : e.message || "Micro indisponible."
      );
    }
  }, [code, token]);

  useEffect(
    () => () => {
      takeRef.current?.cancel();
      closeMic(streamRef.current);
      streamRef.current = null;
      audioRef.current?.pause();
    },
    []
  );

  // ---------- Écoute du son de la manche ----------
  // Une seule fois par manche, à l'entrée en phase d'écoute. La condition sur
  // l'index est indispensable : chaque diffusion SSE (une par joueur qui rend
  // sa copie) rejouerait sinon le son depuis le début.
  useEffect(() => {
    if (phase !== "listen" || !round?.clipUrl) return;
    if (playedRef.current === round.index) return;
    playedRef.current = round.index;
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = round.clipUrl;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
  }, [phase, round?.clipUrl, round?.index]);

  // ---------- Compte à rebours (décoratif : voir la note de tête) ----------
  const [remain, setRemain] = useState(0);
  useEffect(() => {
    if (!room?.phaseEndsAt) {
      setRemain(0);
      return undefined;
    }
    const end = new Date(room.phaseEndsAt).getTime();
    const tick = () =>
      setRemain(Math.max(0, (end - (Date.now() + skewRef.current)) / 1000));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [room?.phaseEndsAt]);

  const total = room?.timings?.[phase] || 1;
  const pct = Math.max(0, Math.min(100, (remain / total) * 100));

  // ---------- La prise ----------
  const beginHold = useCallback(() => {
    if (recording || sent || phase !== "record" || !streamRef.current) return;
    audioRef.current?.pause();
    setRecording(true);
    takeRef.current = startTake(streamRef.current, { onLevel: setLevel });
  }, [recording, sent, phase]);

  const endHold = useCallback(async () => {
    if (!recording || !takeRef.current) return;
    setRecording(false);
    setLevel(0);
    const take = takeRef.current;
    takeRef.current = null;
    setBusy(true);
    try {
      const out = await take.stop();
      if (!out?.blob?.size) throw new Error("Rien n'a été enregistré.");
      const fd = new FormData();
      fd.append(
        "attempt",
        out.blob,
        `take.${out.mimeType.includes("mp4") ? "m4a" : "webm"}`
      );
      await apiUpload(`/perroquet/versus/${code}/take`, fd, token);
      setSent(true);
    } catch (e) {
      setErr(e.message || "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }, [recording, code, token]);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      const d = await apiFetch(`/perroquet/versus/${code}/start`, {
        method: "POST",
        token,
      });
      applyRoom(d.room);
      setErr("");
    } catch (e) {
      setErr(e.message || "Impossible de lancer.");
    } finally {
      setBusy(false);
    }
  }, [code, token, applyRoom]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const p of room?.players || []) m.set(p.id, p);
    return m;
  }, [room?.players]);

  if (!room)
    return (
      <div className="pq-page">
        <div className="pq-stage pq-center">
          {err ? <p className="pq-err">{err}</p> : <Loader2 size={22} className="spin" />}
        </div>
      </div>
    );

  return (
    <div className="pq-page pq-versus">
      <div className="pq-stage">
        <header className="pq-top">
          <Link to="/arcade" className="pq-back clickable">
            <ArrowLeft size={18} /> Arcade
          </Link>
          <span className="pq-title">Perroquet · versus</span>
          {phase !== "lobby" && phase !== "done" && (
            <span className="pq-progress">
              {(round?.index ?? 0) + 1} / {round?.total ?? room.roundCount}
            </span>
          )}
        </header>

        {err && <p className="pq-err">{err}</p>}

        {/* La barre de phase : le battement commun de la partie. */}
        {phase !== "lobby" && phase !== "done" && (
          <div className={`pq-phase ph-${phase}`}>
            <span className="pq-phase-name">
              {phase === "listen" ? <Ear size={15} /> : phase === "record" ? <Mic size={15} /> : <Trophy size={15} />}
              {PHASE_LABEL[phase]}
            </span>
            <span className="pq-phase-bar">
              <i style={{ width: `${pct}%` }} />
            </span>
            <span className="pq-phase-sec">{Math.ceil(remain)}s</span>
          </div>
        )}

        {phase === "lobby" && (
          <Lobby
            room={room}
            code={code}
            armed={!!me?.armed}
            onArm={arm}
            onStart={start}
            busy={busy}
            copied={copied}
            onInvite={() => setShowInvite(true)}
            onCopy={() => {
              navigator.clipboard?.writeText(window.location.href).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
          />
        )}

        {phase === "listen" && (
          <section className="pq-listen-stage">
            <span className="pq-listen-ring" aria-hidden="true">
              <Ear size={38} />
            </span>
            <p>Mémorise la mélodie. Tu vas devoir la refaire.</p>
            <PlayerStrip players={room.players} />
          </section>
        )}

        {phase === "record" && (
          <section className="pq-record-stage">
            {sent ? (
              <div className="pq-waiting">
                <Check size={26} />
                <b>Copie rendue</b>
                <span>
                  On attend{" "}
                  {room.players.filter(
                    (p) => !p.left && !(round?.done || []).includes(p.id)
                  ).length}{" "}
                  joueur(s)…
                </span>
              </div>
            ) : !streamRef.current ? (
              <div className="pq-waiting">
                <MicOff size={26} />
                <b>Micro fermé</b>
                <button className="pq-go clickable" onClick={arm}>
                  Autoriser le micro
                </button>
              </div>
            ) : (
              <PerroquetHold
                recording={recording}
                level={level}
                busy={busy}
                onStart={beginHold}
                onEnd={endHold}
                hint="Maintiens et imite"
              />
            )}
            <PlayerStrip players={room.players} done={round?.done || []} />
          </section>
        )}

        {phase === "reveal" && round && (
          <Reveal round={round} byId={byId} meId={user?.id} />
        )}

        {phase === "done" && <Final room={room} onQuit={() => navigate("/arcade")} />}
      </div>

      {/* La modale d'invitation est celle des quatre autres salons
          (components/VersusRoom.jsx), pilotée par son `endpoint` : elle ne sait
          rien du Perroquet et n'a besoin de rien savoir. */}
      {showInvite && (
        <VersusInvite
          token={token}
          meId={user?.id}
          room={room}
          endpoint={`/perroquet/versus/${room.code}/invite`}
          title="Inviter au Perroquet"
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  );
}

// ============================================================
//  Le salon d'attente
// ============================================================
function Lobby({ room, armed, onArm, onStart, onInvite, busy, copied, onCopy, code }) {
  const active = room.players.filter((p) => !p.left);
  const ready = active.filter((p) => p.armed).length;
  const canStart = room.isHost && active.length >= 2;

  return (
    <section className="pq-lobby">
      <div className="pq-code" onClick={onCopy} role="button" tabIndex={0}>
        <span className="pq-code-lbl">Code du salon</span>
        <b>{code}</b>
        <span className="pq-code-copy">
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Lien copié" : "Copier le lien"}
        </span>
      </div>

      <ul className="pq-lobby-list">
        {active.map((p) => (
          <li key={p.id} className={p.armed ? "armed" : ""}>
            <Avatar p={p} />
            <b>
              {p.username}
              {p.isHost && <Crown size={13} className="pq-crown" />}
            </b>
            <span className={`pq-mic-state ${p.armed ? "ok" : ""}`}>
              {p.armed ? <Mic size={14} /> : <MicOff size={14} />}
              {p.armed ? "prêt" : "micro fermé"}
            </span>
          </li>
        ))}
        {Array.from({ length: Math.max(0, 2 - active.length) }).map((_, i) => (
          <li key={`e${i}`} className="empty">
            <Users size={16} /> en attente d'un joueur…
          </li>
        ))}
      </ul>

      <button className="pq-go alt clickable" onClick={onInvite}>
        <UserPlus size={17} /> Inviter des amis
      </button>

      {!armed && (
        <button className="pq-go clickable" onClick={onArm}>
          <Mic size={17} /> Autoriser mon micro
        </button>
      )}

      {room.isHost ? (
        <button className="pq-go clickable" onClick={onStart} disabled={!canStart || busy}>
          {busy ? <Loader2 size={17} className="spin" /> : <Play size={17} />}
          Lancer ({ready}/{active.length} prêts)
        </button>
      ) : (
        <p className="pq-lobby-wait">
          <Loader2 size={14} className="spin" /> L'hôte lance la partie quand tout
          le monde est prêt.
        </p>
      )}

      <p className="pq-mic-note">
        Le micro s'autorise <b>avant</b> le départ : une fois la fenêtre ouverte,
        il n'y a pas de rattrapage.
      </p>
    </section>
  );
}

// ============================================================
//  Le verdict d'une manche — le moment du jeu
// ============================================================
function Reveal({ round, byId, meId }) {
  // Quelle courbe s'affiche en grand. On part de la SIENNE — c'est celle qu'on
  // vient de faire et la première question qu'on se pose — puis un clic sur
  // n'importe quelle ligne bascule dessus.
  //
  // POURQUOI PAS LES SIX SUPERPOSÉES : à deux courbes on lit un écart, à six on
  // lit un plat de spaghettis. La vignette de chaque ligne donne déjà la forme
  // d'un coup d'œil ; le grand graphique sert à comparer VRAIMENT, donc une à
  // la fois contre l'original.
  const [pick, setPick] = useState(null);

  // ---------------------------------------------------------------- la revue
  // On enchaîne les enregistrements TOUT SEUL, sans rien cliquer. C'est ce qui
  // transforme un tableau de scores en moment de jeu : personne n'appuie sur
  // six boutons de lecture pour écouter ses camarades, alors que tout le monde
  // écoute une séquence qui se déroule.
  //
  // L'ORDRE VA DU PIRE AU MEILLEUR, à rebours de la liste affichée. C'est la
  // règle de tous les jeux télévisés : on garde le vainqueur pour la fin. Le
  // surlignage remonte donc les lignes, et la dernière entendue est celle du
  // gagnant — la révélation tombe au bon moment au lieu d'être passée en
  // premier.
  //
  // L'original ouvre la séquence : sans lui, on écoute six imitations sans
  // avoir en tête ce qu'elles imitaient.
  const [nowPlaying, setNowPlaying] = useState(null); // userId, ou "target"
  const audioRef = useRef(null);
  const timerRef = useRef(null);

  const queue = useMemo(() => {
    const takes = (round.takes || []).filter((t) => t.attemptUrl);
    // `takes` arrive trié par rang (1 = meilleur) : on le renverse.
    const worstFirst = [...takes].sort((a, b) => (b.rank || 99) - (a.rank || 99));
    return [
      { id: "target", url: round.clipUrl },
      ...worstFirst.map((t) => ({ id: t.userId, url: t.attemptUrl })),
    ];
  }, [round.takes, round.clipUrl]);

  // Relancé à chaque MANCHE, pas à chaque rendu : `round.index` est la seule
  // dépendance qui doive redémarrer la revue.
  useEffect(() => {
    let alive = true;
    let i = 0;
    const audio = new Audio();
    audioRef.current = audio;

    const next = () => {
      if (!alive || i >= queue.length) {
        if (alive) setNowPlaying(null);
        return;
      }
      const item = queue[i];
      i += 1;
      setNowPlaying(item.id);
      // Le grand graphique suit la lecture : on ENTEND et on VOIT la même
      // tentative. Les regarder se désynchroniser serait pire que pas de
      // graphique du tout.
      if (item.id !== "target") setPick(item.id);
      audio.src = item.url;
      audio.currentTime = 0;
      audio.play().catch(() => {
        // Lecture refusée (onglet en arrière-plan, politique d'autoplay) : on
        // n'insiste pas et on passe au suivant, sinon la revue se bloque net.
        timerRef.current = setTimeout(next, 300);
      });
    };

    // Un silence entre deux extraits : collés, on ne sait plus où finit l'un et
    // où commence l'autre — et c'est précisément la comparaison qu'on veut.
    const onEnd = () => {
      timerRef.current = setTimeout(next, 450);
    };
    audio.addEventListener("ended", onEnd);
    next();

    return () => {
      alive = false;
      clearTimeout(timerRef.current);
      audio.removeEventListener("ended", onEnd);
      audio.pause();
      audioRef.current = null;
    };
  }, [round.index, queue]);

  // Un clic reprend la main sur la revue : on écoute ce qu'on veut, quand on
  // veut. La séquence automatique ne doit jamais empêcher d'y revenir.
  const playOne = (id, url) => {
    clearTimeout(timerRef.current);
    setPick(id === "target" ? null : id);
    if (!url) return;
    const a = audioRef.current;
    if (!a) return;
    setNowPlaying(id);
    a.src = url;
    a.currentTime = 0;
    a.play().catch(() => {});
  };

  const shownId = pick || String(meId);
  const shown = round.takes?.find((t) => t.userId === shownId && t.contour);

  return (
    <section className="pq-reveal">
      <p className="pq-answer">
        C'était <b>{round.label}</b>
        {round.game ? <em> — {round.game}</em> : null}
      </p>

      <ol className="pq-podium">
        {(round.takes || []).map((t) => {
          const p = byId.get(t.userId);
          const mine = t.userId === String(meId);
          return (
            <li
              key={t.userId}
              className={`pq-podium-row band-${t.band} ${mine ? "me" : ""} ${
                t.userId === shownId ? "picked" : ""
              } ${t.userId === nowPlaying ? "playing" : ""} clickable`}
              onClick={() => playOne(t.userId, t.attemptUrl)}
            >
              <span className={`pq-podium-rank r${t.rank}`}>{t.rank}</span>
              {p && <Avatar p={p} />}
              <span className="pq-podium-who">{p?.username || "…"}</span>
              {/* La forme de SA mélodie, en vignette. C'est ce qui manquait :
                  on entendait les autres sans jamais voir où ils étaient
                  partis, alors que c'est précisément ce que le barème note. */}
              {round.contour && t.contour && (
                <ContourChart
                  target={round.contour.pitch}
                  attempt={t.contour.pitch}
                  name={p?.username}
                  compact
                />
              )}
              {t.attemptUrl ? (
                // Un indicateur, pas un bouton : c'est la LIGNE ENTIÈRE qui se
                // clique. Deux cibles côte à côte dont l'une est incluse dans
                // l'autre, c'est la garantie de clics qui ne font pas ce qu'on
                // croyait.
                <span className="pq-podium-wave" aria-hidden="true">
                  <i /><i /><i />
                </span>
              ) : (
                <span className="pq-podium-none">rien rendu</span>
              )}
              <span className="pq-podium-score">{t.score}</span>
            </li>
          );
        })}
      </ol>

      {/* La courbe sélectionnée contre l'originale : même justification qu'en
          solo, mais on peut désormais regarder celle de n'importe qui. */}
      {round.contour && shown && (
        <ContourChart
          target={round.contour.pitch}
          attempt={shown.contour.pitch}
          name={shownId === String(meId) ? "toi" : byId.get(shownId)?.username}
        />
      )}
      {round.takes?.some((t) => t.contour) && (
        <p className="pq-pick-hint">
          On les écoute du dernier au premier. Touche une ligne pour la rejouer.
        </p>
      )}

      <div className="pq-replay">
        <button
          className={`pq-clip clickable k-target ${nowPlaying === "target" ? "on" : ""}`}
          onClick={() => playOne("target", round.clipUrl)}
        >
          <Play size={13} /> L'original
        </button>
      </div>
    </section>
  );
}

// ============================================================
//  Le tableau final
// ============================================================
function Final({ room, onQuit }) {
  const n = room.round?.total || room.roundCount || 1;
  const table = [...room.players]
    .filter((p) => !p.left)
    .sort((a, b) => b.score - a.score);
  const champ = table[0];

  return (
    <section className="pq-final">
      {champ && (
        <div className="pq-champ">
          <Crown size={22} />
          <Avatar p={champ} big />
          <b>{champ.username}</b>
          <span>meilleur perroquet</span>
        </div>
      )}

      <ol className="pq-final-list">
        {table.map((p, i) => (
          <li key={p.id} className={p.isMe ? "me" : ""}>
            <span className={`pq-podium-rank r${i + 1}`}>{i + 1}</span>
            <Avatar p={p} />
            <span className="pq-podium-who">{p.username}</span>
            <span className="pq-final-wins">{p.wins} manche(s)</span>
            <span className="pq-podium-score">{Math.round(p.score / n)}</span>
          </li>
        ))}
      </ol>

      <div className="pq-recap-actions">
        <Link to="/perroquet" className="pq-challenge clickable">
          Rejouer en solo
        </Link>
        <button className="pq-quit clickable" onClick={onQuit}>
          Retour à l'arcade
        </button>
      </div>
    </section>
  );
}

// ============================================================
//  Communs
// ============================================================
function Avatar({ p, big }) {
  return p.avatar ? (
    <img className={`pq-av ${big ? "big" : ""}`} src={p.avatar} alt="" loading="lazy" />
  ) : (
    <span className={`pq-av ph ${big ? "big" : ""}`}>
      {(p.username || "?")[0].toUpperCase()}
    </span>
  );
}

// La bande de têtes en bas d'écran : qui est là, et qui a déjà rendu. C'est ce
// qui fait qu'on joue AVEC des gens plutôt que devant un chrono.
function PlayerStrip({ players, done }) {
  return (
    <ul className="pq-strip">
      {players
        .filter((p) => !p.left)
        .map((p) => (
          <li key={p.id} className={done?.includes(p.id) ? "done" : ""}>
            <Avatar p={p} />
            <span>{p.username}</span>
            {done?.includes(p.id) && <Check size={12} className="pq-strip-ok" />}
          </li>
        ))}
    </ul>
  );
}
