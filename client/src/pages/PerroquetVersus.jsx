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
  Music,
  Play,
  SkipForward,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { apiFetch, apiUpload } from "../lib/api";
import { openMic, closeMic, startTake, canRecord } from "../lib/soundTake";
import { useClipReel } from "../lib/clipReel";
import { useEffectedUrls } from "../lib/clipFx";
import { FxTag } from "../components/VoiceFxPicker";
import { VersusInvite } from "../components/VersusRoom";
import PerroquetHold from "../components/PerroquetHold";
import ContourChart from "../components/ContourChart";
import SoundLibrary from "../components/SoundLibrary";
import PerroquetDecor from "../components/PerroquetDecor";

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
  const [showLib, setShowLib] = useState(false);
  // Ce que les librairies des joueurs présents apportent au tirage. Compté par
  // le serveur (GET /pool) et pas déduit du salon : c'est une requête, on ne la
  // colle pas dans chaque diffusion du salon.
  const [pool, setPool] = useState(null);

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

  // ---------- « J'ai fini d'écouter » ----------
  // Le vote qui abrège la révélation quand tout le monde a fini de rire. Le
  // serveur décide (routes/perroquetVersus.js) : ici on lève la main, et l'état
  // revient par le direct comme tout le reste.
  const [voting, setVoting] = useState(false);
  const voteNext = useCallback(async () => {
    setVoting(true);
    try {
      await apiFetch(`/perroquet/versus/${code}/next`, { method: "POST", token });
    } catch {
      /* la phase a déjà tourné : le direct remettra l'écran d'aplomb */
    } finally {
      setVoting(false);
    }
  }, [code, token]);

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

  // ---------- Les sons des joueurs ----------
  const loadPool = useCallback(async () => {
    try {
      setPool(await apiFetch(`/perroquet/versus/${code}/pool`, { token }));
    } catch {
      /* le décompte est indicatif : son échec ne casse pas le lobby */
    }
  }, [code, token]);

  // Recompté quand la table change : quelqu'un qui arrive apporte ses sons, et
  // l'hôte doit voir ce qu'il embarque au moment où il coche.
  const playerCount = room?.players?.filter((p) => !p.left).length || 0;
  useEffect(() => {
    if (phase === "lobby") loadPool();
  }, [phase, playerCount, loadPool]);

  const setCustomSounds = useCallback(
    async (on) => {
      setBusy(true);
      try {
        const d = await apiFetch(`/perroquet/versus/${code}/options`, {
          method: "POST",
          token,
          body: { customSounds: on },
        });
        applyRoom(d.room);
        setErr("");
      } catch (e) {
        setErr(e.message || "Réglage impossible.");
      } finally {
        setBusy(false);
      }
    },
    [code, token, applyRoom]
  );

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
    <div className={`pq-page pq-versus ${phase !== "lobby" ? "in-game" : ""}`}>
      <PerroquetDecor />
      <header className="pq-top">
        {/* Depuis le versus, le retour naturel est le solo — c'est de là qu'on
            arrive en cliquant « À plusieurs » — et non l'arcade. */}
        <Link to="/perroquet" className="pq-back clickable">
          <ArrowLeft size={17} /> <span>Solo</span>
        </Link>
        <span className="pq-title">
          <Users size={15} /> Perroquet · versus
        </span>
        {phase !== "lobby" && phase !== "done" ? (
          <span className="pq-progress">
            {(round?.index ?? 0) + 1}
            <em>/{round?.total ?? room.roundCount}</em>
          </span>
        ) : (
          <span className="pq-progress ghost" />
        )}
      </header>

      <div className="pq-stage">

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
            pool={pool}
            onCustomSounds={setCustomSounds}
            onLibrary={() => setShowLib(true)}
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
            <p>Mémorise la mélodie.</p>
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
          <Reveal
            round={round}
            byId={byId}
            meId={user?.id}
            players={room.players}
            onNext={voteNext}
            voting={voting}
          />
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

      {/* La librairie s'ouvre DEPUIS le salon : c'est là qu'on apprend que
          l'hôte a coché les sons personnalisés, donc là qu'on a envie d'en
          déposer un avant le départ. Le décompte du salon se recompte à la
          fermeture. */}
      {showLib && (
        <SoundLibrary
          token={token}
          onClose={() => setShowLib(false)}
          onChanged={loadPool}
        />
      )}
    </div>
  );
}

// ============================================================
//  Le salon d'attente
// ============================================================
function Lobby({
  room,
  armed,
  onArm,
  onStart,
  onInvite,
  busy,
  copied,
  onCopy,
  code,
  pool,
  onCustomSounds,
  onLibrary,
}) {
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

      {/* ---------- Les sons des joueurs ----------
          Un réglage d'hôte, mais affiché à TOUT LE MONDE : les autres doivent
          savoir que leurs propres sons vont sortir (et aller en déposer avant
          le départ). Le montrer au seul hôte ferait de la case une surprise au
          milieu de la partie. */}
      <div className="pq-custom">
        <div className="pq-custom-head">
          <span className="pq-custom-txt">
            <b>
              <Music size={15} /> Sons des joueurs
            </b>
            <em>
              {room.customSounds
                ? pool?.custom
                  ? `+${pool.custom} son(s) des joueurs présents`
                  : "personne n'a encore déposé de son"
                : "sons officiels seulement"}
            </em>
          </span>
          {room.isHost ? (
            <button
              className={`pq-sw clickable ${room.customSounds ? "on" : ""}`}
              onClick={() => onCustomSounds(!room.customSounds)}
              disabled={busy}
              role="switch"
              aria-checked={!!room.customSounds}
              aria-label="Sons des joueurs"
            >
              <i />
            </button>
          ) : (
            <span className={`pq-custom-state ${room.customSounds ? "on" : ""}`}>
              {room.customSounds ? "activés" : "désactivés"}
            </span>
          )}
        </div>

        {room.customSounds && pool?.contributors?.length > 0 && (
          <ul className="pq-custom-who">
            {pool.contributors.map((c) => (
              <li key={c.name}>
                {c.name} <em>{c.count}</em>
              </li>
            ))}
          </ul>
        )}

        <button className="pq-custom-lib clickable" onClick={onLibrary}>
          <Music size={14} /> Ma librairie de sons
        </button>
      </div>

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
          <Loader2 size={14} className="spin" /> L'hôte lance la partie.
        </p>
      )}

      <p className="pq-mic-note">Le micro s'autorise avant le départ.</p>
    </section>
  );
}

// ============================================================
//  Le verdict d'une manche — le moment du jeu
// ============================================================
// LA REVUE. Les enregistrements s'enchaînent tout seuls, un à la fois, DU PIRE
// AU MEILLEUR — la règle de tous les jeux télévisés : on garde le vainqueur
// pour la fin. Le surlignage remonte donc les lignes, et la dernière voix
// entendue est celle du gagnant. L'original ouvre la séquence, sinon on écoute
// six imitations sans avoir en tête ce qu'elles imitaient.
//
// La mécanique est dans lib/clipReel.js, partagée avec le solo ; ce qu'elle
// ajoute ici, c'est `progress` : la grande courbe se dessine au rythme exact du
// son qui joue. On ENTEND et on VOIT la même tentative avancer.
//
// POURQUOI PAS LES SIX COURBES SUPERPOSÉES : à deux courbes on lit un écart, à
// six on lit un plat de spaghettis. La vignette de chaque ligne donne la forme
// d'un coup d'œil ; le grand graphique compare vraiment, une à la fois.
function Reveal({ round, byId, meId, players = [], onNext, voting }) {
  const [pick, setPick] = useState(null);

  // L'effet du son déguise TOUTES les voix de la manche, pas seulement la sienne
  // — c'est le meilleur moment du mode : six personnes en robot d'affilée. On
  // prépare les six rendus d'un coup et la séquence attend qu'ils soient prêts
  // (cf. lib/clipFx.js) ; démarrée avant, elle passerait la première voix en
  // clair, et c'est justement celle-là qui lance le fou rire.
  const effect = round.effect || "none";
  const urls = useMemo(
    () => (round.takes || []).map((t) => t.attemptUrl).filter(Boolean),
    [round.takes]
  );
  const { fx, spanOf, ready } = useEffectedUrls(urls, effect);

  const queue = useMemo(() => {
    const takes = (round.takes || []).filter((t) => t.attemptUrl);
    // `takes` arrive trié par rang (1 = meilleur) : on le renverse.
    const worstFirst = [...takes].sort((a, b) => (b.rank || 99) - (a.rank || 99));
    return [
      { id: "target", url: round.clipUrl },
      ...worstFirst.map((t) => ({
        id: t.userId,
        url: fx(t.attemptUrl),
        span: spanOf(t.attemptUrl),
      })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.takes, round.clipUrl, ready]);

  const { current, progress, waiting, play } = useClipReel({
    items: queue,
    restartKey: round.index,
    enabled: ready,
    // Deux secondes entre chaque voix : le temps de rire, de dire « n'importe
    // quoi » et de se retourner vers le suivant. C'est la raison d'être de cette
    // phase — l'enchaînement serré la transformait en carrousel.
    gapMs: 2000,
    onItem: (id) => {
      // Le grand graphique suit la lecture. Les regarder se désynchroniser
      // serait pire que pas de graphique du tout.
      if (id !== "target") setPick(id);
    },
  });

  const shownId = pick || String(meId);
  const shown = round.takes?.find((t) => t.userId === shownId && t.contour);
  const live = current === shownId || current === "target";

  return (
    <section className="pq-reveal">
      <div className="pq-verdict">
        {round.image ? (
          <span className="pq-face">
            <img src={round.image} alt="" draggable="false" />
          </span>
        ) : (
          <span className="pq-face ph" aria-hidden="true">
            <Music size={24} />
          </span>
        )}
        <span className="pq-verdict-txt">
          <b className="pq-band">C'était</b>
          <span className="pq-answer">
            {round.label}
            {round.addedBy ? <em>proposé par {round.addedBy}</em> : null}
          </span>
        </span>
        <button
          className={`pq-clip clickable k-target ${current === "target" ? "on" : ""}`}
          onClick={() => play("target", round.clipUrl)}
        >
          <Play size={13} /> L'original
        </button>
        <FxTag id={effect} />
      </div>

      {/* La courbe de celui qu'on écoute, contre l'originale. */}
      {round.contour && shown && (
        <ContourChart
          target={round.contour.pitch}
          attempt={shown.contour.pitch}
          targetEnergy={round.contour.energy}
          targetVoiced={round.contour.voiced}
          attemptVoiced={shown.contour.voiced}
          name={shownId === String(meId) ? "toi" : byId.get(shownId)?.username}
          band={shown.band}
          progress={live ? progress : null}
          progressOn={current === "target" ? "target" : "attempt"}
        />
      )}

      <ol className="pq-podium">
        {(round.takes || []).map((t) => {
          const p = byId.get(t.userId);
          const mine = t.userId === String(meId);
          return (
            <li
              key={t.userId}
              className={`pq-podium-row band-${t.band} ${mine ? "me" : ""} ${
                t.userId === shownId ? "picked" : ""
              } ${t.userId === current ? "playing" : ""} clickable`}
              onClick={() => play(t.userId, fx(t.attemptUrl), spanOf(t.attemptUrl))}
            >
              <span className={`pq-podium-rank r${t.rank}`}>{t.rank}</span>
              {p && <Avatar p={p} />}
              <span className="pq-podium-who">{p?.username || "…"}</span>
              {round.contour && t.contour && (
                <ContourChart
                  target={round.contour.pitch}
                  attempt={t.contour.pitch}
                  targetVoiced={round.contour.voiced}
                  attemptVoiced={t.contour.voiced}
                  name={p?.username}
                  compact
                />
              )}
              {t.attemptUrl ? (
                // Un indicateur, pas un bouton : c'est la LIGNE ENTIÈRE qui se
                // clique. Deux cibles imbriquées, c'est la garantie de clics qui
                // ne font pas ce qu'on croyait.
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

      <p className={`pq-pick-hint ${waiting ? "waiting" : ""}`}>
        {waiting
          ? "On en parle… la voix suivante arrive"
          : "Du dernier au premier · touche une ligne pour la rejouer"}
      </p>

      <NextVote
        round={round}
        players={players}
        meId={meId}
        onNext={onNext}
        voting={voting}
      />
    </section>
  );
}

// ============================================================
//  « On passe à la suite ? »
// ============================================================
// La révélation a un chrono de 18 secondes, et c'est le seul moment creux de la
// partie : quand tout le monde a fini d'écouter, on regarde un classement figé en
// attendant que le temps passe. Ce bouton laisse la table décider.
//
// UNE VOIX PAR JOUEUR, et il faut TOUT LE MONDE. C'est ce qui le rend acceptable :
// personne ne se fait couper son propre cri par trois impatients. Tant qu'il
// manque quelqu'un, le bouton dit sur qui on attend — patienter sans savoir
// pourquoi est bien plus long que patienter en connaissant la raison.
function NextVote({ round, players, meId, onNext, voting }) {
  const here = players.filter((p) => !p.left);
  const votes = round.ready || [];
  const mine = votes.includes(String(meId));
  const waiting = here.filter((p) => !votes.includes(p.id));

  return (
    <div className="pq-nextvote">
      <button
        className={`pq-next clickable ${mine ? "voted" : ""}`}
        onClick={onNext}
        disabled={mine || voting}
      >
        {voting ? (
          <Loader2 size={16} className="spin" />
        ) : mine ? (
          <Check size={16} />
        ) : (
          <SkipForward size={16} />
        )}
        {mine ? "En attente des autres" : "Passer à la suite"}
        {here.length > 1 && (
          <em>
            {votes.length}/{here.length}
          </em>
        )}
      </button>
      {mine && waiting.length > 0 && (
        <span className="pq-nextvote-who">
          on attend {waiting.map((p) => p.username).join(", ")}
        </span>
      )}
    </div>
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
