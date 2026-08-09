import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Coins,
  Loader2,
  Mic,
  MicOff,
  Play,
  RotateCcw,
  SkipForward,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch, apiUpload } from "../lib/api";
import { openMic, closeMic, startTake, canRecord } from "../lib/soundTake";
import PerroquetHold from "../components/PerroquetHold";
import ContourChart from "../components/ContourChart";

// ======================================================================
//  Le Perroquet — imite le son, le plus proche gagne
// ======================================================================
// On fait entendre un son de jeu (le cri de Yoshi, le « wahoo » de Mario), le
// joueur le refait à la voix, le serveur note à quel point c'était proche.
// Inspiré des vieux Mario où il fallait crier dans le micro de la console.
//
// ------------------------------------------------- CE QUI PORTE LE JEU
// Ce n'est PAS le score. Un barème qui compare des voix humaines à des sons
// synthétisés est forcément approximatif (cf. server/src/lib/soundContour.js),
// et afficher un nombre nu ferait contester chaque manche.
//
// Ce qui porte le jeu, c'est qu'on RÉÉCOUTE. D'où deux choix d'écran qui ne
// sont pas des ornements :
//
//   1. LES DEUX COURBES SUPERPOSÉES. Un score devient acceptable dès qu'on voit
//      pourquoi on l'a eu — « ah oui, je suis parti trop haut ». Sans le
//      dessin, 62/100 est une sentence ; avec, c'est une explication.
//   2. LES DEUX SONS REJOUÉS CÔTE À CÔTE, l'original et sa propre tentative.
//      C'est le moment où on rit, et c'est la raison de garder les
//      enregistrements en base plutôt que de ne stocker qu'un nombre.
//
// ------------------------------------------------------ le maintien
// On enregistre TANT QU'ON APPUIE, comme les messages vocaux de la messagerie.
// Un mode « clic pour démarrer / clic pour arrêter » obligerait à décider quand
// on a fini alors qu'on est en train de crier — et la durée fait partie de la
// note. Maintenir, c'est le geste juste : on relâche quand le cri est fini.

const HOLD_MIN_MS = 250; // en deçà, c'est un clic, pas une imitation

const BAND_LABEL = {
  perfect: "Parfait",
  great: "Très proche",
  close: "On y était",
  meh: "Pas tout à fait",
  miss: "Rien à voir",
};

export default function Perroquet() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const challengeId = params.get("challenge");

  const [phase, setPhase] = useState("intro"); // intro | play | recap
  const [game, setGame] = useState(null);      // { gameId, rounds[], challenge }
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState([]);  // un par manche jouée
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [recap, setRecap] = useState(null);

  const streamRef = useRef(null);
  const takeRef = useRef(null);
  const startedAtRef = useRef(0);
  const audioRef = useRef(null);

  const round = game?.rounds?.[index] || null;
  const result = results[index] || null;

  // Le micro reste ouvert pour toute la partie (cf. lib/soundTake.js). On le
  // referme en quittant la page : un onglet qui garde le micro actif après
  // qu'on soit parti est un comportement qu'on n'accepterait de personne.
  useEffect(
    () => () => {
      takeRef.current?.cancel();
      closeMic(streamRef.current);
      streamRef.current = null;
    },
    []
  );

  // ---------- Lancement ----------
  const start = useCallback(async () => {
    setErr("");
    if (!canRecord()) {
      setErr(
        "Ce navigateur ne sait pas enregistrer. Il faut Chrome, Firefox ou Safari, et une connexion sécurisée (https)."
      );
      return;
    }
    setSending(true);
    try {
      // Le micro AVANT la partie : si l'autorisation est refusée, autant le
      // savoir maintenant plutôt qu'après avoir écouté le premier son.
      streamRef.current = await openMic();
      const data = await apiFetch("/perroquet/start", {
        method: "POST",
        token,
        body: challengeId ? { challenge: challengeId } : {},
      });
      setGame(data);
      setIndex(0);
      setResults([]);
      setPhase("play");
    } catch (e) {
      closeMic(streamRef.current);
      streamRef.current = null;
      setErr(
        e.name === "NotAllowedError"
          ? "Sans micro, pas de perroquet : autorise l'accès puis réessaie."
          : e.message || "Impossible de lancer la partie."
      );
    } finally {
      setSending(false);
    }
  }, [token, challengeId]);

  // ---------- Ouvrir un salon à plusieurs ----------
  const openVersus = useCallback(async () => {
    setSending(true);
    try {
      const d = await apiFetch("/perroquet/versus", { method: "POST", token, body: {} });
      navigate(`/perroquet/versus/${d.room.code}`);
    } catch (e) {
      setErr(e.message || "Impossible de créer le salon.");
      setSending(false);
    }
  }, [token, navigate]);

  // ---------- Écoute du son à imiter ----------
  const playClip = useCallback((url) => {
    if (!url) return;
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = url;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
  }, []);

  // On rejoue le son dès qu'on arrive sur une manche : le geste attendu est
  // d'écouter puis d'imiter, pas de chercher un bouton « écouter ».
  useEffect(() => {
    if (phase === "play" && round && !result) playClip(round.url);
  }, [phase, round, result, playClip]);

  // ---------- La prise ----------
  const beginHold = useCallback(() => {
    if (recording || sending || result || !streamRef.current) return;
    // On coupe le son de référence : sinon le micro le réenregistre et on
    // noterait le joueur sur un mélange de sa voix et de l'original.
    audioRef.current?.pause();
    setRecording(true);
    startedAtRef.current = Date.now();
    takeRef.current = startTake(streamRef.current, { onLevel: setLevel });
  }, [recording, sending, result]);

  const endHold = useCallback(async () => {
    if (!recording || !takeRef.current) return;
    const held = Date.now() - startedAtRef.current;
    setRecording(false);
    setLevel(0);
    const take = takeRef.current;
    takeRef.current = null;

    if (held < HOLD_MIN_MS) {
      take.cancel();
      setErr("Maintiens le bouton pendant que tu imites.");
      return;
    }

    setErr("");
    setSending(true);
    try {
      const out = await take.stop();
      if (!out?.blob?.size) throw new Error("Rien n'a été enregistré.");
      const fd = new FormData();
      // L'extension suit le type MIME réel : Safari rend du mp4, pas du webm.
      fd.append("attempt", out.blob, `attempt.${out.mimeType.includes("mp4") ? "m4a" : "webm"}`);
      const data = await apiUpload(
        `/perroquet/${game.gameId}/round/${index}`,
        fd,
        token
      );
      setResults((r) => {
        const next = [...r];
        next[index] = data;
        return next;
      });
    } catch (e) {
      setErr(e.message || "Impossible d'envoyer l'imitation.");
    } finally {
      setSending(false);
    }
  }, [recording, game, index, token]);

  // ---------- Passer / avancer ----------
  const skip = useCallback(async () => {
    if (sending || result) return;
    setSending(true);
    try {
      const fd = new FormData(); // sans fichier = manche passée
      const data = await apiUpload(
        `/perroquet/${game.gameId}/round/${index}`,
        fd,
        token
      );
      setResults((r) => {
        const next = [...r];
        next[index] = data;
        return next;
      });
    } catch (e) {
      setErr(e.message || "Impossible de passer.");
    } finally {
      setSending(false);
    }
  }, [sending, result, game, index, token]);

  const next = useCallback(async () => {
    if (index + 1 < game.rounds.length) {
      setIndex((i) => i + 1);
      return;
    }
    setSending(true);
    try {
      const data = await apiFetch(`/perroquet/${game.gameId}/finish`, {
        method: "POST",
        token,
      });
      setRecap(data);
      setPhase("recap");
      closeMic(streamRef.current);
      streamRef.current = null;
    } catch (e) {
      setErr(e.message || "Impossible de clore la partie.");
    } finally {
      setSending(false);
    }
  }, [index, game, token]);

  // ---------- Barre d'espace : le même geste au clavier ----------
  useEffect(() => {
    if (phase !== "play") return;
    const down = (e) => {
      if (e.code !== "Space" || e.repeat) return;
      e.preventDefault();
      beginHold();
    };
    const up = (e) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      endHold();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [phase, beginHold, endHold]);

  // ============================================================
  //  Rendu
  // ============================================================
  return (
    <div className="pq-page">
      <div className="pq-stage">
        <header className="pq-top">
          <Link to="/arcade" className="pq-back clickable">
            <ArrowLeft size={18} /> Arcade
          </Link>
          <span className="pq-title">Le Perroquet</span>
          {phase === "play" && (
            <span className="pq-progress">
              {index + 1} / {game.rounds.length}
            </span>
          )}
        </header>

        {err && <p className="pq-err">{err}</p>}

        {phase === "intro" && (
          <Intro
            onStart={start}
            onVersus={openVersus}
            busy={sending}
            challenge={game?.challenge}
            challengeId={challengeId}
          />
        )}

        {phase === "play" && round && (
          <Round
            round={round}
            result={result}
            recording={recording}
            level={level}
            sending={sending}
            onListen={() => playClip(round.url)}
            onHoldStart={beginHold}
            onHoldEnd={endHold}
            onSkip={skip}
            onNext={next}
            last={index + 1 >= game.rounds.length}
          />
        )}

        {phase === "recap" && recap && (
          <Recap
            recap={recap}
            onReplay={() => {
              setGame(null);
              setRecap(null);
              setPhase("intro");
            }}
            onHome={() => navigate("/arcade")}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================
//  Écran d'accueil
// ============================================================
function Intro({ onStart, onVersus, busy, challengeId }) {
  return (
    <section className="pq-intro">
      <span className="pq-bird" aria-hidden="true">
        <i className="pq-bird-wave a" />
        <i className="pq-bird-wave b" />
        <Mic size={34} />
      </span>
      <h1>Imite le son.</h1>
      <p className="pq-lead">
        On te fait entendre un bruit de jeu. Tu le refais à la voix, en
        maintenant le bouton. Le plus proche gagne.
      </p>
      <ul className="pq-rules">
        <li>
          <b>La mélodie compte</b>, pas ta voix : monter et redescendre au bon
          endroit vaut mieux que d'avoir le bon timbre.
        </li>
        <li>
          <b>Le rythme aussi</b> : une attaque sèche ne s'imite pas avec un
          soupir.
        </li>
        <li>
          Cinq sons, une note sur 100 par son. Ta moyenne devient des points
          d'arcade.
        </li>
      </ul>
      <div className="pq-intro-actions">
        <button className="pq-go clickable" onClick={onStart} disabled={busy}>
          {busy ? <Loader2 size={18} className="spin" /> : <Play size={18} />}
          {challengeId ? "Relever le défi" : "Jouer seul"}
        </button>
        {/* Le multi est mis SUR LE MÊME PLAN que le solo, pas relégué dans un
            coin : c'est là que le jeu est le plus drôle — on y écoute les cris
            des autres, ce que le solo ne peut pas offrir. */}
        <button className="pq-go alt clickable" onClick={onVersus} disabled={busy}>
          <Users size={18} /> Jouer à plusieurs
        </button>
      </div>
      <p className="pq-mic-note">
        <MicOff size={13} /> Le micro s'ouvre au lancement et se referme en
        quittant la page.
      </p>
    </section>
  );
}

// ============================================================
//  Une manche
// ============================================================
function Round({
  round,
  result,
  recording,
  level,
  sending,
  onListen,
  onHoldStart,
  onHoldEnd,
  onSkip,
  onNext,
  last,
}) {
  if (result) return <RoundResult result={result} onNext={onNext} last={last} busy={sending} />;

  return (
    <section className="pq-round">
      <button className="pq-listen clickable" onClick={onListen} disabled={recording}>
        <Play size={18} /> Réécouter
      </button>

      <div className="pq-hint">
        Difficulté&nbsp;
        {"●".repeat(round.difficulty)}
        <span className="pq-hint-off">{"●".repeat(5 - round.difficulty)}</span>
      </div>

      <PerroquetHold
        recording={recording}
        level={level}
        busy={sending}
        onStart={onHoldStart}
        onEnd={onHoldEnd}
      />

      <button className="pq-skip clickable" onClick={onSkip} disabled={sending || recording}>
        <SkipForward size={15} /> Passer ce son
      </button>
    </section>
  );
}

// ============================================================
//  Le résultat d'une manche
// ============================================================
function RoundResult({ result, onNext, last, busy }) {
  const skipped = result.skipped;
  return (
    <section className={`pq-result band-${result.band}`}>
      <span className="pq-band">{BAND_LABEL[result.band] || "—"}</span>
      {!skipped && <span className="pq-score">{result.score}</span>}
      {result.reason && <p className="pq-reason">{result.reason}</p>}

      <p className="pq-answer">
        C'était <b>{result.clip.label}</b>
        {result.clip.game ? <em> — {result.clip.game}</em> : null}
      </p>

      {!skipped && result.contour && result.clip.contour && (
        <>
          {/* LE cœur de l'écran : on VOIT l'écart. Voir la note de tête. */}
          <ContourChart
            target={result.clip.contour.pitch}
            attempt={result.contour.pitch}
          />
          <div className="pq-detail">
            <Bar label="Mélodie" value={result.pitch} />
            <Bar label="Rythme" value={result.energy} />
            <Bar label="Durée" value={result.duration} />
          </div>
        </>
      )}

      <div className="pq-replay">
        <ClipButton url={result.clip.url} label="L'original" kind="target" />
        {result.attemptUrl && (
          <ClipButton url={result.attemptUrl} label="Toi" kind="attempt" />
        )}
      </div>

      <button className="pq-next clickable" onClick={onNext} disabled={busy}>
        {busy ? <Loader2 size={16} className="spin" /> : null}
        {last ? "Voir le résultat" : "Son suivant"} <ArrowRight size={16} />
      </button>
    </section>
  );
}

function Bar({ label, value }) {
  return (
    <span className="pq-bar">
      <em>{label}</em>
      <i>
        <b style={{ width: `${Math.max(2, value)}%` }} />
      </i>
      <span>{value}</span>
    </span>
  );
}

function ClipButton({ url, label, kind }) {
  const ref = useRef(null);
  return (
    <button
      className={`pq-clip clickable k-${kind}`}
      onClick={() => {
        if (!ref.current) ref.current = new Audio(url);
        ref.current.currentTime = 0;
        ref.current.play().catch(() => {});
      }}
    >
      <Play size={14} /> {label}
    </button>
  );
}

// ============================================================
//  Fin de partie
// ============================================================
function Recap({ recap, onReplay, onHome }) {
  return (
    <section className="pq-recap">
      <h2>
        <Trophy size={20} /> {recap.average} de moyenne
      </h2>
      <p className="pq-recap-pts">
        <Coins size={15} /> +{recap.average} points d'arcade
      </p>

      <ul className="pq-recap-list">
        {recap.rounds.map((r, i) => (
          <li key={i} className={`pq-recap-row band-${r.band}`}>
            <span className="pq-recap-n">{i + 1}</span>
            <span className="pq-recap-label">
              <b>{r.label}</b>
              {r.game ? <em>{r.game}</em> : null}
            </span>
            <span className="pq-recap-clips">
              <ClipButton url={r.clipUrl} label="L'original" kind="target" />
              {r.attemptUrl && <ClipButton url={r.attemptUrl} label="Toi" kind="attempt" />}
            </span>
            <span className="pq-recap-score">{r.skipped ? "—" : r.score}</span>
          </li>
        ))}
      </ul>

      <div className="pq-recap-actions">
        <button className="pq-go clickable" onClick={onReplay}>
          <RotateCcw size={17} /> Rejouer
        </button>
        <Link
          to={`/perroquet?challenge=${recap.gameId}`}
          className="pq-challenge clickable"
        >
          <Swords size={16} /> Lien de défi
        </Link>
        <button className="pq-quit clickable" onClick={onHome}>
          Retour à l'arcade
        </button>
      </div>
    </section>
  );
}
