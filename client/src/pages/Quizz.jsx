import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Check,
  Coins,
  Crown,
  Grid2x2,
  Home,
  Keyboard,
  Layers,
  ListChecks,
  Loader2,
  Play,
  RotateCcw,
  Share2,
  Shuffle,
  SkipForward,
  Smile,
  Swords,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { useLiveStatus } from "../lib/presence";
import { useGameSfx } from "../lib/useGameSfx";
import {
  checkLocal,
  estimateQuizPoints,
  triesFor,
  typeHint,
} from "../lib/quizGame";
import QuizRound from "../components/quiz/QuizRound";
import QuizTimer from "../components/quiz/QuizTimer";

// ======================================================================
//  Le Grand Quiz — solo
// ======================================================================
// Huit épreuves qui s'enchaînent, tirées au hasard : une question à quatre
// propositions, des emojis à décoder, un studio dont il faut citer trois jeux,
// un duel de cartes à ranger, une capture pixelisée, une pile à trier en
// trente secondes, un titre en lettres mêlées, un mot à trouver en cinq essais.
//
// ----------------------------------------------------- le décor, et pourquoi
// PAS le plateau de Pixel Rush. Pixel Rush occupe déjà le registre « plateau de
// quiz télé avec projecteurs et public en ombres chinoises » ; le reprendre
// ferait de ce jeu-ci sa variante plutôt qu'un jeu à part.
//
// On prend donc l'autre moitié du même imaginaire : LE PUPITRE DE CANDIDAT.
// Fond bleu nuit de studio, la question posée sur un bandeau qui occupe la
// largeur, et en bas d'écran un rail de pupitres — un par joueur. En solo il
// n'y en a qu'un, le sien, mais il est là dès le début : c'est ce qui fait que
// la page a l'air du même jeu qu'on jouera à six.
//
// -------------------------------------------- comment une manche se déroule
// cue (on annonce l'épreuve) → round (le chrono tourne) → reveal (la solution)
//
// Le `cue` compte plus ici que dans les autres mini-jeux. Ailleurs, toutes les
// manches se ressemblent et l'annonce est une politesse ; ici on change de jeu
// toutes les trente secondes, et arriver sur un duel de cartes sans avoir eu
// le temps de comprendre qu'on jouait au duel, c'est une manche perdue.
const CUE_MS = 2600;
const REVEAL_MS = 5200;

// ============================================================
//  L'écran d'accueil
// ============================================================
// Une icône par épreuve. Le libellé vient du serveur (il fait autorité sur ce
// qui existe), l'icône est une affaire d'interface et vit donc ici.
const TYPE_ICONS = {
  qcm: ListChecks,
  emoji: Smile,
  studio: Building2,
  duel: Swords,
  pixel: Grid2x2,
  swipe: Layers,
  anagram: Shuffle,
  motus: Keyboard,
};

// ------------------------------------------------------------ le décor
// Des jaquettes qui flottent autour du logo, piochées dans LA BIBLIOTHÈQUE DU
// JOUEUR (/quiz/covers). C'est ce détail qui fait que l'écran d'accueil parle
// de SES jeux plutôt que d'être une affiche générique — et ça ne coûte qu'une
// requête déjà écrite pour la carte de Pixel Rush.
//
// Les positions sont fixes et choisies pour encadrer le logo sans jamais le
// toucher. Elles sont en pourcentages du bloc, donc elles se resserrent d'
// elles-mêmes sur un petit écran ; en dessous de 760 px le décor disparaît
// complètement (cf. le CSS) : sur téléphone il n'y a pas la place, et une
// jaquette qui chevauche le titre est pire que pas de jaquette du tout.
const SPOTS = [
  { top: "4%", left: "3%", rot: -10, delay: 0 },
  { top: "16%", right: "4%", rot: 12, delay: 1.1 },
  { top: "52%", left: "1%", rot: 8, delay: 2.2 },
  { top: "63%", right: "2%", rot: -13, delay: 0.5 },
  { top: "33%", left: "9%", rot: 5, delay: 3 },
  { top: "6%", right: "18%", rot: -6, delay: 1.7 },
];
const MARKS = [
  { top: "26%", left: "20%", size: 30, delay: 0.3 },
  { top: "12%", right: "30%", size: 22, delay: 1.4 },
  { top: "70%", left: "17%", size: 26, delay: 2.1 },
  { top: "46%", right: "12%", size: 34, delay: 0.9 },
];

function FloatingDecor({ games }) {
  return (
    <div className="qz-float" aria-hidden="true">
      {SPOTS.map((sp, i) => {
        const g = games[i % Math.max(1, games.length)];
        if (!g?.cover) return null;
        return (
          <span
            key={`c${i}`}
            className="qz-float-cover"
            style={{
              top: sp.top,
              left: sp.left,
              right: sp.right,
              "--rot": `${sp.rot}deg`,
              animationDelay: `${sp.delay}s`,
            }}
          >
            <img src={g.cover} alt="" draggable="false" />
          </span>
        );
      })}
      {MARKS.map((m, i) => (
        <span
          key={`q${i}`}
          className="qz-float-q"
          style={{
            top: m.top,
            left: m.left,
            right: m.right,
            fontSize: `${m.size}px`,
            animationDelay: `${m.delay}s`,
          }}
        >
          ?
        </span>
      ))}
    </div>
  );
}

function Intro({
  challengeId,
  covers,
  roundCount,
  setRoundCount,
  types,
  picked,
  toggleType,
  onStart,
  onVersus,
  opening,
}) {
  return (
    <div className="qz-intro">
      <FloatingDecor games={covers} />

      {/* LE LOGO. Il remplace l'empilement d'avant — un pupitre décoratif, un
          sur-titre et un titre qui répétaient tous les trois la même chose.
          Un seul objet, en police ronde, avec le « ? » qui rebondit. */}
      {challengeId && <span className="qz-badge-defi">Défi entre joueurs</span>}
      <h1 className="qz-logo">
        <span className="qz-logo-le">Le</span>
        <span className="qz-logo-main">
          Grand Quiz
          <i className="qz-logo-q" aria-hidden="true">
            ?
          </i>
        </span>
      </h1>

      <p className="qz-sub">
        {challengeId
          ? "Les mêmes épreuves qu'un autre joueur. À toi de faire mieux."
          : "Huit épreuves pour découvrir que tu connais moins bien les jeux que tu ne le crois."}
      </p>

      {!challengeId && (
        <>
          <div className="qz-rounds-pick">
            <span className="qz-rounds-label">Nombre d'épreuves</span>
            <div className="qz-rounds-opts">
              {[5, 8, 12].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`qz-round-opt clickable ${roundCount === n ? "on" : ""}`}
                  onClick={() => setRoundCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Décocher une épreuve est un vrai réglage, pas un gadget : certains
              détestent taper au clavier, d'autres ne supportent pas le chrono
              du tri. Autant qu'ils puissent jouer quand même. */}
          {types.length > 0 && (
            <div className="qz-types">
              <span className="qz-rounds-label">Les épreuves</span>
              <div className="qz-types-grid">
                {types.map((t) => {
                  const on = picked.includes(t.key);
                  const Icon = TYPE_ICONS[t.key] || ListChecks;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      className={`qz-type clickable ${on ? "on" : ""}`}
                      data-qz-type={t.key}
                      onClick={() => toggleType(t.key)}
                      aria-pressed={on}
                      title={typeHint(t.key)}
                    >
                      <span className="qz-type-ic">
                        <Icon size={19} />
                      </span>
                      <b>{t.label}</b>
                      {on && (
                        <span className="qz-type-mark" aria-hidden="true">
                          <Check size={12} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <button type="button" className="qz-start clickable" onClick={onStart}>
        {challengeId ? <Swords size={20} /> : <Play size={20} />}
        {challengeId ? "Relever le défi" : "Lancer le quiz"}
      </button>
      <span className="qz-kbd-hint">
        ou appuie sur <kbd>Entrée</kbd>
      </span>

      {!challengeId && (
        <button type="button" className="qz-versus-cta clickable" onClick={onVersus} disabled={opening}>
          {opening ? <Loader2 size={16} className="spin" /> : <Users size={16} />}
          Jouer en plateau
          <em>jusqu'à 6 candidats · buzzer</em>
        </button>
      )}
    </div>
  );
}

export default function Quizz() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const challengeId = params.get("challenge");
  const sfx = useGameSfx();

  // phase : intro | loading | cue | playing | reveal | done | error
  const [phase, setPhase] = useState("intro");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [roundCount, setRoundCount] = useState(8);
  const [types, setTypes] = useState([]);
  const [picked, setPicked] = useState([]);
  // Les jaquettes qui flottent autour du logo. Purement décoratif : si la
  // requête échoue, l'écran s'affiche sans elles et personne ne le remarque.
  const [covers, setCovers] = useState([]);

  // Données de la partie
  const [sessionId, setSessionId] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [challengeInfo, setChallengeInfo] = useState(null);

  // Déroulé
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [locked, setLocked] = useState(false);
  const [lives, setLives] = useState(3);
  const [reveal, setReveal] = useState(null);
  const [nextIn, setNextIn] = useState(5);
  const [final, setFinal] = useState(null);
  const [copied, setCopied] = useState(false);

  useLiveStatus("quiz", rounds.length ? `épreuve ${idx + 1}/${rounds.length}` : "", { token });

  // Refs de contrôle
  const answersRef = useRef([]);
  const startRef = useRef(0);
  // Deux verrous, et ils ne disent pas la même chose :
  //   `lockedRef`  — le chrono est arrêté, l'épreuve ne prend plus de geste.
  //   `closedRef`  — la manche est CLOSE, la solution est affichée.
  // Entre les deux il y a une fenêtre de quelques centièmes pendant laquelle
  // les épreuves qui composent une copie (duel, tri) la rendent encore.
  const lockedRef = useRef(false);
  const closedRef = useRef(false);
  const triesRef = useRef(0);
  const finishingRef = useRef(false);
  const advanceRef = useRef(() => {});
  const revealAtRef = useRef(0);

  const round = rounds[idx] || null;
  const durationMs = round ? round.durationSec * 1000 : 0;
  const timeLeftMs = Math.max(0, durationMs - elapsedMs);
  const secondsLeft = Math.ceil(timeLeftMs / 1000);

  useEffect(() => {
    sfx.setMuted(muted);
  }, [muted, sfx]);

  // Mode immersif sur mobile : la barre de navigation du bas chevauche le
  // champ dès que le clavier virtuel s'ouvre (mêmes symptômes que le blind
  // test, même remède).
  useEffect(() => {
    document.body.classList.add("bt-immersive");
    return () => document.body.classList.remove("bt-immersive");
  }, []);

  // Le catalogue des épreuves vient du serveur : ajouter une huitième épreuve
  // ne doit demander de toucher qu'un fichier, côté serveur.
  useEffect(() => {
    let alive = true;
    apiFetch("/quiz/types", { token })
      .then((d) => {
        if (!alive) return;
        setTypes(d.types || []);
        setPicked((d.types || []).map((t) => t.key));
      })
      .catch(() => {
        /* l'écran de réglage disparaît, la partie se lance avec tout */
      });
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    let alive = true;
    apiFetch("/quiz/covers", { token })
      .then((d) => alive && setCovers((d.games || []).filter((g) => g.cover)))
      .catch(() => {
        /* décor : jamais bloquant */
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const goBack = useCallback(() => {
    if (location.key !== "default") navigate(-1);
    else navigate("/arcade");
  }, [location.key, navigate]);

  const toggleType = useCallback((key) => {
    setPicked((p) => {
      // On refuse de tout décocher : une partie sans épreuve ne se lance pas,
      // autant ne jamais y arriver.
      if (p.includes(key)) return p.length > 1 ? p.filter((k) => k !== key) : p;
      return [...p, key];
    });
  }, []);

  // --- Ouverture d'un plateau à plusieurs ---
  const [opening, setOpening] = useState(false);
  async function openVersus() {
    if (opening) return;
    setOpening(true);
    sfx.resume();
    try {
      const d = await apiFetch("/quiz/versus", { method: "POST", token, body: {} });
      navigate(`/quiz/versus/${d.room.code}`);
    } catch (e) {
      setError(e.message || "Impossible d'ouvrir un plateau.");
      setPhase("error");
    } finally {
      setOpening(false);
    }
  }

  // --- Démarrage ---
  async function startGame() {
    sfx.resume();
    sfx.play("launch");
    setError("");
    setPhase("loading");
    setFinal(null);
    setReveal(null);
    setIdx(0);
    setScore(0);
    answersRef.current = [];
    try {
      const d = challengeId
        ? await apiFetch(`/quiz/challenge/${challengeId}`, { token })
        : await apiFetch("/quiz/start", {
            method: "POST",
            token,
            body: { rounds: roundCount, types: picked },
          });
      setSessionId(d.sessionId);
      setRounds(d.rounds || []);
      setCandidates(d.candidates || []);
      setChallengeInfo(d.challenge || null);
      answersRef.current = new Array((d.rounds || []).length).fill(null);
      setPhase("cue");
    } catch (e) {
      setError(e.message || "Impossible de lancer la partie.");
      setPhase("error");
    }
  }

  // --- Fin de manche : on verrouille et on montre la solution ---
  const closeRound = useCallback(
    (given, res) => {
      if (closedRef.current) return;
      closedRef.current = true;
      setLocked(true);
      const r = rounds[idx];
      if (!r) return;
      const timeMs = Date.now() - startRef.current;
      const points = Math.max(0, estimateQuizPoints(r, scoreShape(r, given, res), timeMs));
      setScore((s) => s + points);
      sfx.play(res?.correct ? "correct" : "wrong");
      revealAtRef.current = Date.now();
      setReveal({ round: r, res: res || { correct: false, ratio: 0 }, points, given });
      setPhase("reveal");
    },
    [rounds, idx, sfx]
  );

  // --- Clore la manche sur ce qui a été fait, sans réponse à valider ---
  // Deux chemins y mènent, et ils doivent se comporter EXACTEMENT pareil : le
  // chrono qui tombe à zéro, et le bouton « Je passe ».
  //
  // On verrouille l'écran d'abord, on ne clôt qu'un battement plus tard : les
  // épreuves qui composent une copie (le duel, le tri) la rendent en réaction à
  // `locked`, et il leur faut ce laps pour le faire. C'est ce qui permet à
  // « Je passe » de conserver le travail déjà accompli — quatre cartes bien
  // déposées sur six restent quatre cartes payées, on ne renonce qu'au reste.
  const flushAndClose = useCallback(() => {
    if (closedRef.current) return;
    lockedRef.current = true;
    setLocked(true);
    setTimeout(() => {
      const r = rounds[idx];
      if (!r || closedRef.current) return;
      const given = answersRef.current[idx]?.given ?? null;
      closeRound(given, given ? checkLocal(r, given) : { correct: false, ratio: 0 });
    }, 280);
  }, [rounds, idx, closeRound]);

  // Le chrono de la manche vit dans un effet qui ne se réabonne qu'au
  // changement de manche : appeler `flushAndClose` directement depuis son
  // intervalle y figerait la version d'il y a une manche. Même remède que pour
  // `advanceRef` plus bas — une ref tenue à jour à chaque rendu.
  const flushAndCloseRef = useRef(() => {});
  flushAndCloseRef.current = flushAndClose;

  // « Je passe » : on ne sait pas, on veut voir la réponse et enchaîner.
  // Pas de bruitage ici — `closeRound` en joue déjà un au verdict, et les deux
  // se chevauchaient.
  const skipRound = useCallback(() => {
    if (phase !== "playing" || closedRef.current) return;
    flushAndClose();
  }, [phase, flushAndClose]);

  // --- Une tentative. C'est la charnière commune aux huit épreuves ---
  // (cf. components/quiz/QuizRound.jsx). En solo, elle corrige sur place : le
  // serveur a envoyé la solution avec la manche.
  const attempt = useCallback(
    async (given) => {
      const r = rounds[idx];
      // On teste `closedRef` et NON `lockedRef` : entre la sonnerie et la
      // révélation, la manche est verrouillée à l'écran mais elle accepte
      // encore la copie que le duel ou le tri sont en train de rendre. Le
      // contraire jetait trente secondes de travail à la poubelle sur le gong.
      if (!r || closedRef.current) return { correct: false, settled: true, lives: 0 };
      const res = checkLocal(r, given);
      const timeMs = Date.now() - startRef.current;
      // On enregistre à chaque essai : le dernier état connu est celui qu'on
      // enverra au /finish, même si le chrono coupe la manche juste après.
      answersRef.current[idx] = { id: idx, given, timeMs };

      const max = triesFor(r.type);
      triesRef.current += 1;
      const remaining = Math.max(0, max - triesRef.current);
      setLives(remaining);

      // Le studio est la seule épreuve où l'on répond en PLUSIEURS FOIS : ses
      // six essais ne se referment qu'au triplé (`res.correct`) ou à
      // épuisement. Pour les autres, `max` vaut 1 ou 3 et la règle est la même
      // ligne — d'où l'absence de cas particulier ici.
      const settled = res.correct || triesRef.current >= max;
      if (settled) closeRound(given, res);
      return { ...res, lives: remaining, settled };
    },
    [rounds, idx, closeRound]
  );

  // --- Le « 3, 2, 1 » qui annonce l'épreuve ---
  useEffect(() => {
    if (phase !== "cue") return undefined;
    sfx.play("start");
    const t = setTimeout(() => setPhase("playing"), CUE_MS);
    return () => clearTimeout(t);
  }, [phase, idx, sfx]);

  // --- Le chrono de la manche ---
  useEffect(() => {
    if (phase !== "playing") return undefined;
    const r = rounds[idx];
    if (!r) return undefined;
    lockedRef.current = false;
    closedRef.current = false;
    triesRef.current = 0;
    setLocked(false);
    setLives(triesFor(r.type));
    setElapsedMs(0);
    startRef.current = Date.now();

    const total = r.durationSec * 1000;
    let ticked = -1;
    const iv = setInterval(() => {
      if (lockedRef.current) {
        clearInterval(iv);
        return;
      }
      const el = Date.now() - startRef.current;
      setElapsedMs(Math.min(el, total));
      const left = Math.max(0, total - el);
      if (left <= 5000 && left > 0) {
        const sec = Math.ceil(left / 1000);
        if (sec !== ticked) {
          ticked = sec;
          sfx.play("tick-hot");
        }
      }
      if (left <= 0) {
        clearInterval(iv);
        // Temps écoulé : même chemin que « Je passe » (cf. flushAndClose).
        flushAndCloseRef.current();
      }
    }, 100);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx]);

  // --- Envoi final ---
  const finishGame = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setPhase("loading");
    try {
      const res = await apiFetch("/quiz/finish", {
        method: "POST",
        token,
        body: { sessionId, answers: answersRef.current.filter(Boolean) },
      });
      setFinal(res);
      setPhase("done");
      sfx.play("finish");
    } catch (e) {
      // Repli : le tableau reconstruit localement. Le score affiché est celui
      // du miroir, pas celui du serveur — on le dit en toutes lettres en bas
      // de l'écran plutôt que de laisser croire qu'il a été enregistré.
      const localRounds = rounds.map((r, i) => {
        const a = answersRef.current[i];
        const res_ = a ? checkLocal(r, a.given) : { correct: false, ratio: 0 };
        return {
          index: i,
          type: r.type,
          label: r.label,
          correct: res_.correct,
          ratio: res_.ratio,
          points: Math.max(0, estimateQuizPoints(r, scoreShape(r, a?.given, res_), a?.timeMs ?? null)),
          timeMs: a?.timeMs ?? null,
          recap: localRecap(r),
        };
      });
      const total = localRounds.reduce((s, r) => s + r.points, 0);
      setFinal({
        quizGameId: null,
        score: total,
        correctCount: localRounds.filter((r) => r.correct).length,
        roundCount: localRounds.length,
        challenge: challengeInfo
          ? {
              username: challengeInfo.user?.username,
              score: challengeInfo.score,
              beaten: total > (challengeInfo.score ?? 0),
            }
          : null,
        rounds: localRounds,
        _offline: e.message,
      });
      setPhase("done");
      sfx.play("finish");
    } finally {
      finishingRef.current = false;
    }
  }, [sessionId, token, rounds, sfx, challengeInfo]);

  // --- Manche suivante ---
  const goNext = useCallback(() => {
    setReveal(null);
    // DÉVERROUILLER ICI, et pas seulement dans l'effet du chrono. L'effet ne
    // tourne qu'APRÈS le premier rendu de la manche suivante : jusque-là,
    // `locked` gardait la valeur `true` héritée de la manche qui vient de se
    // clore. Or le duel et le tri rendent leur copie EN RÉACTION à `locked` —
    // ils en envoyaient donc une vide dès leur montage, et la manche affichait
    // son verdict avant d'avoir commencé. C'est ce qui donnait l'impression
    // qu'une épreuve ratée « cassait » toutes les suivantes.
    lockedRef.current = false;
    closedRef.current = false;
    setLocked(false);
    if (idx + 1 < rounds.length) {
      setIdx((i) => i + 1);
      setPhase("cue");
    } else finishGame();
  }, [idx, rounds.length, finishGame]);
  advanceRef.current = goNext;

  // Décompte après la révélation, puis enchaînement automatique.
  useEffect(() => {
    if (!reveal) return undefined;
    let left = REVEAL_MS;
    let last = Date.now();
    setNextIn(Math.ceil(REVEAL_MS / 1000));
    const iv = setInterval(() => {
      const now = Date.now();
      left -= now - last;
      last = now;
      if (left <= 0) {
        clearInterval(iv);
        advanceRef.current();
        return;
      }
      setNextIn(Math.ceil(left / 1000));
    }, 100);
    return () => clearInterval(iv);
  }, [reveal]);

  // --- Raccourcis clavier ---
  useEffect(() => {
    function onKey(e) {
      if (e.repeat) return;
      if (phase === "intro" && e.key === "Enter") {
        e.preventDefault();
        startGame();
        return;
      }
      if (reveal && (e.key === "Enter" || e.key === " ")) {
        // Une Entrée tapée « en retard » ne doit pas zapper le résultat.
        if (Date.now() - revealAtRef.current < 450) return;
        e.preventDefault();
        advanceRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function copyChallenge() {
    const id = final?.quizGameId;
    if (!id) return;
    navigator.clipboard?.writeText(`${window.location.origin}/quiz?challenge=${id}`).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {}
    );
  }

  const inGame = phase === "cue" || phase === "playing" || phase === "reveal";
  const hot = phase === "playing" && secondsLeft <= 5;

  return (
    <div className={`qz-page ${inGame ? "in-game" : ""}`}>
      <header className="qz-topbar">
        <button type="button" className="qz-back clickable" onClick={goBack}>
          <ArrowLeft size={17} /> <span>Retour</span>
        </button>
        <div className="qz-brand">
          <Trophy size={17} /> Le Grand Quiz
        </div>
        <button
          type="button"
          className="qz-vol-btn clickable"
          onClick={() => setMuted((m) => !m)}
          title={muted ? "Réactiver les sons" : "Couper les sons"}
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
      </header>

      <div className="qz-body">
        {phase === "intro" && (
          <Intro
            challengeId={challengeId}
            covers={covers}
            roundCount={roundCount}
            setRoundCount={setRoundCount}
            types={types}
            picked={picked}
            toggleType={toggleType}
            onStart={startGame}
            onVersus={openVersus}
            opening={opening}
          />
        )}

        {phase === "loading" && (
          <div className="qz-loading">
            <Loader2 size={34} className="spin" />
            <p>{final || finishingRef.current ? "On compte les points…" : "On prépare tes épreuves…"}</p>
          </div>
        )}

        {phase === "error" && (
          <div className="qz-loading qz-err">
            <p>{error}</p>
            <div className="qz-err-actions">
              <button type="button" className="qz-start sm clickable" onClick={() => setPhase("intro")}>
                <RotateCcw size={16} /> Réessayer
              </button>
              <Link to="/arcade" className="qz-ghost clickable">
                Retour à l'arcade
              </Link>
            </div>
          </div>
        )}

        {inGame && round && (
          <div className="qz-play" data-qz-type={round.type}>
            {/* Le bandeau d'état : où on en est, et ce qu'on a marqué. */}
            <div className="qz-play-head">
              {/* Les manches FRANCHIES sont colorées elles aussi. Seule la
                  courante l'était, ce qui ne disait pas où on en est : une
                  rangée de points gris avec un point jaune se lit comme « une
                  seule compte », pas comme « on en a fait trois ». */}
              <div className="qz-pips" aria-hidden="true">
                {rounds.map((r, i) => (
                  <i
                    key={i}
                    className={i < idx ? "done" : i === idx ? "cur" : ""}
                    data-qz-type={i <= idx ? r.type : undefined}
                  />
                ))}
              </div>
              <span className="qz-round-count">
                Épreuve <b>{idx + 1}</b>
                <em>/ {rounds.length}</em>
              </span>
              <span className="qz-head-right">
                <span className="qz-live-score">
                  <Trophy size={14} /> {score} pts
                </span>
                <QuizTimer
                  seconds={phase === "playing" ? secondsLeft : round.durationSec}
                  total={round.durationSec}
                  hot={hot}
                />
              </span>
            </div>

            {/* L'annonce de l'épreuve. C'est le moment le plus important de
                l'enchaînement : on change de jeu, il faut que ça se voie. */}
            {phase === "cue" && (
              <div className="qz-cue" key={idx}>
                <span className="qz-cue-n">Épreuve {idx + 1}</span>
                <b className="qz-cue-label">{round.label}</b>
                <em className="qz-cue-hint">{typeHint(round.type)}</em>
              </div>
            )}

            {phase !== "cue" && (
              <QuizRound
                round={round}
                elapsedMs={elapsedMs}
                timeLeftMs={timeLeftMs}
                locked={locked}
                reveal={phase === "reveal" ? reveal?.res : null}
                lives={lives}
                candidates={candidates}
                onAttempt={attempt}
                sfx={sfx}
              />
            )}

            {/* « Je passe ». Sous l'épreuve, en retrait — c'est une sortie de
                secours, pas une action qu'on propose au même rang que
                répondre. Le libellé change selon l'épreuve : sur un duel ou un
                tri on ne renonce pas, on rend sa copie en l'état, et ce qui est
                déjà fait reste payé (cf. flushAndClose). */}
            {phase === "playing" && !locked && (
              <button type="button" className="qz-chip clickable" onClick={skipRound}>
                <SkipForward size={15} />
                {round.mode === "parallel" ? "Je rends ma copie" : "Je passe"}
                <em>
                  {round.mode === "parallel"
                    ? "on garde ce qui est fait"
                    : "voir la réponse"}
                </em>
              </button>
            )}

            {/* La bannière de résultat, posée en bas : la manche reste visible
                derrière, c'est là qu'on comprend ce qu'on a raté. */}
            {reveal && (
              <div className={`qz-verdict ${reveal.res.correct ? "good" : "bad"}`}>
                <i className="qz-verdict-bar" aria-hidden="true" />
                <span className="qz-verdict-badge">
                  {reveal.res.correct ? <Check size={18} /> : <X size={18} />}
                </span>
                <div className="qz-verdict-txt">
                  <b>
                    {reveal.res.correct
                      ? "Trouvé !"
                      : reveal.res.ratio > 0
                        ? "Presque…"
                        : "Raté !"}
                  </b>
                  {reveal.res.ratio > 0 && reveal.res.ratio < 1 && (
                    <em>{Math.round(reveal.res.ratio * 100)}% de réussite</em>
                  )}
                </div>
                <span className={`qz-verdict-pts ${reveal.points > 0 ? "up" : ""}`}>
                  {reveal.points > 0 ? `+${reveal.points}` : "0"}
                </span>
                <button type="button" className="qz-next clickable" onClick={goNext}>
                  {idx + 1 < rounds.length ? "Suivant" : "Mon score"}
                  <span>{nextIn}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {phase === "done" && final && (
          <Scoreboard
            final={final}
            challengeId={challengeId}
            copied={copied}
            onCopy={copyChallenge}
            onReplay={() => {
              if (challengeId) navigate("/quiz");
              setPhase("intro");
            }}
            token={token}
          />
        )}
      </div>
    </div>
  );
}

// Traduit une réponse en ce qu'attend le barème (miroir de `toScoreInput`
// côté serveur, cf. lib/quizCheck.js).
function scoreShape(round, given, res) {
  switch (round.type) {
    case "qcm":
      return { correct: res?.correct };
    case "emoji":
    case "pixel":
    case "anagram":
      return { correct: res?.correct, misses: given?.misses || 0 };
    case "motus":
      return { correct: res?.correct, tries: given?.tries || 1 };
    case "studio":
      return { found: Math.round((res?.ratio || 0) * (round.need || 3)) };
    case "duel":
      return { placed: Math.round((res?.ratio || 0) * (round.cards?.length || 0)) };
    case "swipe":
      return { good: res?.detail?.good || 0, bad: res?.detail?.bad || 0 };
    default:
      return {};
  }
}

// Le résumé d'une manche pour le récap hors-ligne (miroir de `recapOf` côté
// serveur — le serveur reste la source pour une partie enregistrée).
function localRecap(r) {
  switch (r.type) {
    case "qcm":
      return { title: r.text, answer: r.choices?.[r.answerIndex] || "", explain: r.explain, cover: r.cover };
    case "emoji":
      return { title: (r.emojis || []).join(" "), answer: r.gameName, gameId: r.gameId, cover: r.cover };
    case "studio":
      return { title: r.studio, answer: `${r.need} jeux à trouver`, examples: r.examples || [] };
    case "duel":
      return { title: (r.games || []).map((g) => g.name).join("  vs  "), answer: `${(r.cards || []).length} cartes` };
    case "pixel":
      return { title: "Capture pixelisée", answer: r.gameName, gameId: r.gameId, cover: r.cover };
    case "swipe":
      return { title: r.criterion?.label || "", answer: `${(r.deck || []).length} jeux` };
    case "anagram":
      return { title: (r.letters || []).join(" "), answer: r.gameName, gameId: r.gameId, cover: r.cover };
    case "motus":
      return {
        title: `${r.length} lettres · ${r.hint || ""}`.trim(),
        answer: r.gameName,
        gameId: r.gameId,
        cover: r.cover,
      };
    default:
      return { title: "", answer: "" };
  }
}

// ============================================================
//  Le tableau final
// ============================================================
function Scoreboard({ final, challengeId, copied, onCopy, onReplay, token }) {
  const [board, setBoard] = useState(null);
  const pct = final.roundCount ? Math.round((final.correctCount / final.roundCount) * 100) : 0;
  const ch = final.challenge;

  useEffect(() => {
    let alive = true;
    apiFetch("/quiz/leaderboard", { token })
      .then((d) => alive && setBoard(d.entries || []))
      .catch(() => alive && setBoard([]));
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <div className="qz-done">
      <div className="qz-done-hero">
        <div className="qz-done-badge">
          <Trophy size={32} />
        </div>
        <h1 className="qz-done-score">{final.score}</h1>
        <span className="qz-done-score-label">points</span>
        <p className="qz-done-sub">
          {final.correctCount} / {final.roundCount} épreuves réussies · {pct}%
        </p>

        {final.pointsEarned > 0 && (
          <Link to="/arcade" className="qz-earned clickable">
            <Coins size={15} />
            <span>
              <b>+{final.pointsEarned}</b> points gagnés
            </span>
            <em>Ouvre une caisse à l'arcade →</em>
          </Link>
        )}

        {ch && (
          <div className={`qz-versus-res ${ch.beaten ? "win" : "lose"}`}>
            <Swords size={16} />
            {ch.beaten ? (
              <span>
                Battu&nbsp;! Tu dépasses <b>{ch.username}</b> ({ch.score} pts)
              </span>
            ) : (
              <span>
                <b>{ch.username}</b> tient bon avec {ch.score} pts — retente ta chance&nbsp;!
              </span>
            )}
          </div>
        )}

        <div className="qz-done-actions">
          <button type="button" className="qz-start sm clickable" onClick={onReplay}>
            <RotateCcw size={16} /> Rejouer
          </button>
          {final.quizGameId && !challengeId && (
            <button type="button" className="qz-ghost clickable" onClick={onCopy}>
              {copied ? <Check size={16} /> : <Share2 size={16} />}
              {copied ? "Lien copié !" : "Défier un ami"}
            </button>
          )}
          <Link to="/arcade" className="qz-ghost clickable">
            <Home size={16} /> Arcade
          </Link>
        </div>
        {final._offline && (
          <p className="qz-offline-note">Score affiché en local (enregistrement indisponible).</p>
        )}
      </div>

      <div className="qz-done-cols">
        <div className="qz-recap">
          <h2 className="qz-recap-title">Le détail</h2>
          <ul className="qz-recap-list">
            {final.rounds.map((r) => (
              <li
                key={r.index}
                className={`qz-recap-row ${r.correct ? "good" : r.ratio > 0 ? "half" : "bad"}`}
                data-qz-type={r.type}
              >
                <span className="qz-recap-type">{r.label}</span>
                <span className="qz-recap-info">
                  <b className="qz-recap-q">{r.recap?.title}</b>
                  {r.recap?.answer && (
                    <span className="qz-recap-a">
                      {r.recap.gameId ? (
                        <Link to={`/game/${r.recap.gameId}`} className="clickable">
                          {r.recap.answer}
                        </Link>
                      ) : (
                        r.recap.answer
                      )}
                    </span>
                  )}
                  {r.recap?.explain && <em className="qz-recap-x">{r.recap.explain}</em>}
                </span>
                {r.recap?.cover ? (
                  <img className="qz-recap-cover" src={r.recap.cover} alt="" loading="lazy" />
                ) : null}
                <span className={`qz-recap-pts ${r.points > 0 ? "up" : ""}`}>
                  {r.points > 0 ? `+${r.points}` : "0"}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="qz-board">
          <h2 className="qz-recap-title">
            <Crown size={16} /> Classement
          </h2>
          {board === null ? (
            <div className="qz-board-loading">
              <Loader2 size={20} className="spin" />
            </div>
          ) : board.length === 0 ? (
            <p className="qz-board-empty">
              Sois le premier à marquer&nbsp;! Suis des amis pour les défier.
            </p>
          ) : (
            <ol className="qz-board-list">
              {board.map((e, i) => (
                <li key={e.quizGameId} className={`qz-board-row ${e.isMe ? "me" : ""}`}>
                  <span className={`qz-board-rank r${i + 1}`}>{i + 1}</span>
                  <Link to={`/u/${e.user.username}`} className="qz-board-user clickable">
                    {e.user.avatar ? (
                      <img src={e.user.avatar} alt="" loading="lazy" draggable="false" />
                    ) : (
                      <span className="qz-board-av">{e.user.username[0].toUpperCase()}</span>
                    )}
                    <span className="qz-board-name">{e.user.username}</span>
                  </Link>
                  {!e.isMe && (
                    <Link
                      to={`/quiz?challenge=${e.quizGameId}`}
                      className="qz-board-fight clickable"
                      title={`Défier ${e.user.username}`}
                    >
                      <Swords size={14} />
                    </Link>
                  )}
                  <span
                    className="qz-board-score"
                    title={
                      e.games != null
                        ? `Total cumulé · ${e.games} partie${e.games > 1 ? "s" : ""}` +
                          (e.bestScore != null ? ` · record ${e.bestScore}` : "")
                        : undefined
                    }
                  >
                    {e.score}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
