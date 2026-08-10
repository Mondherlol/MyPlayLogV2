import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  Coins,
  Loader2,
  Mic,
  Music,
  Play,
  RotateCcw,
  SkipForward,
  Swords,
  Timer,
  Trophy,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch, apiUpload } from "../lib/api";
import { openMic, closeMic, startTake, canRecord } from "../lib/soundTake";
import { useClipReel } from "../lib/clipReel";
import PerroquetHold from "../components/PerroquetHold";
import ContourChart from "../components/ContourChart";
import SoundLibrary from "../components/SoundLibrary";
import PerroquetDecor from "../components/PerroquetDecor";

// ======================================================================
//  Le Perroquet — imite le son, le plus proche gagne
// ======================================================================
// On fait entendre un son de jeu, le joueur le refait à la voix, le serveur
// note à quel point c'était proche.
//
// ------------------------------------------------- CE QUI PORTE LE JEU
// Ce n'est PAS le score. Un barème qui compare des voix humaines à des sons
// synthétisés est forcément approximatif (cf. server/src/lib/soundContour.js),
// et un nombre nu ferait contester chaque manche. Ce qui porte le jeu, c'est
// qu'on RÉÉCOUTE — d'où deux choix d'écran qui ne sont pas des ornements :
//
//   1. LA REVUE AUTOMATIQUE. Au verdict, l'original puis sa propre tentative
//      s'enchaînent tout seuls (lib/clipReel.js). Personne n'appuie sur deux
//      boutons de lecture pour se comparer ; tout le monde écoute une séquence
//      qui se déroule.
//   2. LA COURBE QUI SE DESSINE AU RYTHME DU SON. Un score devient acceptable
//      dès qu'on voit pourquoi on l'a eu — « ah oui, je suis parti trop haut ».
//      Le tracé fini et immobile ne reliait rien à rien ; celui qui court avec
//      la lecture montre à quel instant l'écart s'est creusé.
//
// ------------------------------------------------------------- le décor
// AUCUN FOND PEINT. La page tenait sur un brun de cabine qui la coupait du
// reste du site et virait au sale en thème clair. Elle vit désormais sur le
// fond de l'application et n'emprunte que ses jetons (même parti pris que le
// Grand Quiz) ; tout ce qu'elle ajoute passe par la couche `--pq-*` du CSS.

const HOLD_MIN_MS = 250; // en deçà, c'est un clic, pas une imitation

const BAND_LABEL = {
  perfect: "Parfait",
  great: "Très proche",
  close: "On y était",
  meh: "Pas tout à fait",
  miss: "Rien à voir",
};

export default function Perroquet() {
  const { token, user } = useAuth();
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

  // La librairie personnelle : combien de sons prêts, et est-ce qu'on joue
  // avec. En solo le joueur est son propre hôte — mais la règle ne change pas :
  // rien n'entre dans le tirage sans un geste explicite.
  const [showLib, setShowLib] = useState(false);
  const [myCount, setMyCount] = useState(0);
  const [useMine, setUseMine] = useState(false);

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

  const loadMine = useCallback(async () => {
    try {
      const d = await apiFetch("/perroquet/sounds", { token });
      const n = (d.items || []).filter((c) => c.active).length;
      setMyCount(n);
      if (!n) setUseMine(false);
    } catch {
      /* la librairie est un bonus : son échec ne bloque pas le jeu */
    }
  }, [token]);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  // ---------- Lancement ----------
  const start = useCallback(async () => {
    setErr("");
    if (!canRecord()) {
      setErr("Ce navigateur ne sait pas enregistrer (il faut https).");
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
        // Un défi rejoue le set exact de l'autre partie : y ajouter ses propres
        // sons n'aurait aucun sens, ce ne serait plus le même défi.
        body: challengeId ? { challenge: challengeId } : { mine: useMine },
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
  }, [token, challengeId, useMine]);

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
      const data = await apiUpload(`/perroquet/${game.gameId}/round/${index}`, fd, token);
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
      const data = await apiUpload(`/perroquet/${game.gameId}/round/${index}`, fd, token);
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
    if (phase !== "play") return undefined;
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

  const inGame = phase === "play";

  return (
    <div className={`pq-page ${inGame ? "in-game" : ""}`}>
      <PerroquetDecor />

      <header className="pq-top">
        {/* Plus de bouton « Arcade » ici : la barre latérale y ramène déjà, et
            il alourdissait le coin haut-gauche. Un espace muet tient la balance
            à gauche du titre, en miroir du compteur. Le retour vers le solo, lui,
            n'a de sens que depuis le versus — il y est. */}
        <span className="pq-progress ghost" aria-hidden="true" />
        <span className="pq-title">
          <Mic size={15} /> Le Perroquet
        </span>
        {inGame ? (
          <span className="pq-progress">
            {index + 1}<em>/{game.rounds.length}</em>
          </span>
        ) : (
          <span className="pq-progress ghost" />
        )}
      </header>

      <div className="pq-stage">
        {err && <p className="pq-err">{err}</p>}

        {phase === "intro" && (
          <Intro
            onStart={start}
            onVersus={openVersus}
            busy={sending}
            challengeId={challengeId}
            myCount={myCount}
            useMine={useMine}
            onToggleMine={() => setUseMine((v) => !v)}
            onLibrary={() => setShowLib(true)}
          />
        )}

        {phase === "play" && round && (
          <>
            <Pips total={game.rounds.length} index={index} results={results} />
            {result ? (
              <RoundResult
                key={index}
                result={result}
                onNext={next}
                last={index + 1 >= game.rounds.length}
                busy={sending}
                user={user}
              />
            ) : (
              <Round
                recording={recording}
                level={level}
                sending={sending}
                onListen={() => playClip(round.url)}
                onHoldStart={beginHold}
                onHoldEnd={endHold}
                onSkip={skip}
              />
            )}
          </>
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
            user={user}
          />
        )}
      </div>

      {showLib && (
        <SoundLibrary token={token} onClose={() => setShowLib(false)} onChanged={loadMine} />
      )}
    </div>
  );
}

// ============================================================
//  Écran d'accueil
// ============================================================
function Intro({
  onStart,
  onVersus,
  busy,
  challengeId,
  myCount,
  useMine,
  onToggleMine,
  onLibrary,
}) {
  return (
    <section className="pq-intro">
      <span className="pq-logo-orb" aria-hidden="true">
        <i className="pq-ring r1" />
        <i className="pq-ring r2" />
        <i className="pq-ring r3" />
        <Mic size={38} />
      </span>

      <h1 className="pq-logo">
        Le <b>Perroquet</b>
      </h1>
      <p className="pq-lead">
        {challengeId
          ? "Les mêmes sons qu'un autre joueur. À toi de crier plus juste."
          : "Écoute le son. Refais-le à la voix. Le plus proche gagne."}
      </p>

      <div className="pq-intro-actions">
        <button className="pq-go clickable" onClick={onStart} disabled={busy}>
          {busy ? <Loader2 size={18} className="spin" /> : <Play size={18} />}
          {challengeId ? "Relever le défi" : "Jouer"}
        </button>
        {/* Le multi est sur le MÊME PLAN que le solo : c'est là que le jeu est
            le plus drôle — on y écoute les cris des autres. */}
        <button className="pq-go alt clickable" onClick={onVersus} disabled={busy}>
          <Users size={18} /> À plusieurs
          <em>jusqu'à 6</em>
        </button>
      </div>

      {!challengeId && (
        <div className="pq-mine">
          <button className="pq-mine-open clickable" onClick={onLibrary}>
            <Music size={15} /> Mes sons
            {myCount > 0 && <em>{myCount}</em>}
          </button>
          {myCount > 0 && (
            <button
              className={`pq-sw-line clickable ${useMine ? "on" : ""}`}
              onClick={onToggleMine}
              role="switch"
              aria-checked={useMine}
            >
              <i />
              les ajouter au tirage
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ============================================================
//  La progression de la partie
// ============================================================
function Pips({ total, index, results }) {
  return (
    <div className="pq-pips" aria-hidden="true">
      {Array.from({ length: total }).map((_, i) => (
        <i
          key={i}
          className={i === index ? "cur" : results[i] ? `done band-${results[i].band}` : ""}
        />
      ))}
    </div>
  );
}

// ============================================================
//  Une manche
// ============================================================
function Round({ recording, level, sending, onListen, onHoldStart, onHoldEnd, onSkip }) {
  return (
    <section className="pq-round">
      <button className="pq-listen clickable" onClick={onListen} disabled={recording}>
        <Play size={15} /> Réécouter
      </button>

      <PerroquetHold
        recording={recording}
        level={level}
        busy={sending}
        onStart={onHoldStart}
        onEnd={onHoldEnd}
      />

      <button className="pq-skip clickable" onClick={onSkip} disabled={sending || recording}>
        <SkipForward size={14} /> Passer
      </button>
    </section>
  );
}

// ============================================================
//  Le résultat d'une manche
// ============================================================
// L'original puis sa propre tentative s'enchaînent tout seuls, et la courbe se
// dessine avec celui qui joue (cf. lib/clipReel.js). Le score se compte en
// montant : un nombre qui s'installe se lit comme un verdict, un nombre qui
// grimpe se regarde.
function RoundResult({ result, onNext, last, busy, user }) {
  const skipped = result.skipped;
  const reel = useMemo(
    () =>
      [
        { id: "target", url: result.clip?.url },
        { id: "me", url: result.attemptUrl },
      ].filter((x) => x.url),
    [result]
  );
  const { current, progress, play } = useClipReel({
    items: reel,
    restartKey: result.clip?.id || "r",
    enabled: !skipped,
  });

  const score = useCountUp(skipped ? 0 : result.score, 700);

  return (
    <section className={`pq-result band-${result.band}`}>
      <div className="pq-verdict">
        {result.clip?.image ? (
          <span className="pq-face">
            <img src={result.clip.image} alt="" draggable="false" />
          </span>
        ) : (
          <span className="pq-face ph" aria-hidden="true">
            <Music size={26} />
          </span>
        )}
        <span className="pq-verdict-txt">
          <b className="pq-band">{BAND_LABEL[result.band] || "—"}</b>
          <span className="pq-answer">
            {result.clip.label}
            {result.clip.addedBy ? <em>proposé par {result.clip.addedBy}</em> : null}
          </span>
        </span>
        {!skipped && <span className="pq-score">{score}</span>}
      </div>

      {result.reason && <p className="pq-reason">{result.reason}</p>}

      {!skipped && result.contour && result.clip.contour && (
        <>
          <ContourChart
            target={result.clip.contour.pitch}
            attempt={result.contour.pitch}
            band={result.band}
            progress={current ? progress : null}
            progressOn={current === "target" ? "target" : "attempt"}
          />
          <div className="pq-detail">
            <Bar Icon={Music} label="Mélodie" value={result.pitch} />
            <Bar Icon={Activity} label="Rythme" value={result.energy} />
            <Bar Icon={Timer} label="Durée" value={result.duration} />
          </div>
        </>
      )}

      <div className="pq-replay">
        <button
          className={`pq-clip clickable k-target ${current === "target" ? "on" : ""}`}
          onClick={() => play("target", result.clip.url)}
        >
          <Play size={13} /> L'original
        </button>
        {result.attemptUrl && (
          <button
            className={`pq-clip clickable k-attempt ${current === "me" ? "on" : ""}`}
            onClick={() => play("me", result.attemptUrl)}
          >
            {user?.avatar ? (
              <img className="pq-clip-av" src={user.avatar} alt="" loading="lazy" />
            ) : (
              <span className="pq-clip-av ph">
                {(user?.username || "?")[0].toUpperCase()}
              </span>
            )}
            Toi
          </button>
        )}
      </div>

      <button className="pq-next clickable" onClick={onNext} disabled={busy}>
        {busy ? <Loader2 size={16} className="spin" /> : null}
        {last ? "Mon résultat" : "Suivant"} <ArrowRight size={16} />
      </button>
    </section>
  );
}

// Un compteur qui monte. Amorti sur la fin (courbe en sortie), sinon il a
// l'air de s'arrêter net au lieu de se poser.
function useCountUp(target, ms) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Bar({ Icon, label, value }) {
  return (
    <span className="pq-bar">
      <em>
        <Icon size={12} /> {label}
      </em>
      <i>
        <b style={{ width: `${Math.max(2, value)}%` }} />
      </i>
      <span>{value}</span>
    </span>
  );
}

function ClipButton({ url, label, kind, av, avName }) {
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
      {kind === "attempt" ? (
        av ? (
          <img className="pq-clip-av" src={av} alt="" loading="lazy" />
        ) : (
          <span className="pq-clip-av ph">{(avName || "?")[0].toUpperCase()}</span>
        )
      ) : (
        <Play size={13} />
      )}{" "}
      {label}
    </button>
  );
}

// ============================================================
//  Fin de partie
// ============================================================
function Recap({ recap, onReplay, onHome, user }) {
  const avg = useCountUp(recap.average, 900);
  return (
    <section className="pq-recap">
      <div className="pq-recap-hero">
        <span className="pq-recap-badge">
          <Trophy size={26} />
        </span>
        <b className="pq-recap-avg">{avg}</b>
        <span className="pq-recap-unit">de moyenne</span>
        <span className="pq-recap-pts">
          <Coins size={14} /> +{recap.average} points d'arcade
        </span>
      </div>

      <ul className="pq-recap-list">
        {recap.rounds.map((r, i) => (
          <li key={i} className={`pq-recap-row band-${r.band}`}>
            {r.image ? (
              <img className="pq-recap-img" src={r.image} alt="" loading="lazy" />
            ) : (
              <span className="pq-recap-n">{i + 1}</span>
            )}
            <span className="pq-recap-label">
              <b>{r.label}</b>
              {r.addedBy ? <em className="by">par {r.addedBy}</em> : null}
            </span>
            <span className="pq-recap-clips">
              <ClipButton url={r.clipUrl} label="L'original" kind="target" />
              {r.attemptUrl && (
                <ClipButton
                  url={r.attemptUrl}
                  label="Toi"
                  kind="attempt"
                  av={user?.avatar}
                  avName={user?.username}
                />
              )}
            </span>
            <span className="pq-recap-score">{r.skipped ? "—" : r.score}</span>
          </li>
        ))}
      </ul>

      <div className="pq-recap-actions">
        <button className="pq-go clickable" onClick={onReplay}>
          <RotateCcw size={17} /> Rejouer
        </button>
        <Link to={`/perroquet?challenge=${recap.gameId}`} className="pq-challenge clickable">
          <Swords size={16} /> Défier un ami
        </Link>
        <button className="pq-quit clickable" onClick={onHome}>
          Arcade
        </button>
      </div>
    </section>
  );
}
