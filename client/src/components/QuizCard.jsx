import { useEffect, useRef, useState } from "react";
import {
  Check,
  X,
  Star,
  RotateCcw,
  Loader2,
  CircleQuestionMark,
  Sparkles,
  Gamepad2,
  Flame,
  Trophy,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

const BASE = "https://opentdb.com/api.php?amount=10&category=15&type=boolean";

const DIFFS = [
  { key: "any", label: "Toutes" },
  { key: "easy", label: "Facile" },
  { key: "medium", label: "Moyen" },
  { key: "hard", label: "Difficile" },
];
const DIFF_LABEL = { easy: "Facile", medium: "Moyen", hard: "Difficile" };

// Distance de glissement (px) au-delà de laquelle on valide la réponse.
const THRESHOLD = 96;
// Grab GAUCHE = Faux, grab DROITE = Vrai.
const LEFT_VALUE = "False";
const RIGHT_VALUE = "True";
const QUIZ_STATE_PREFIX = "mpl_quiz_state_";

function readStoredQuizState(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.questions) || !parsed.questions.length) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Décode les entités HTML renvoyées par l'API (&#039; &quot; …)
function decodeEntities(str = "") {
  const el = document.createElement("textarea");
  el.innerHTML = str;
  return el.value;
}

export default function QuizCard() {
  const { user } = useAuth();
  const scoreKey = `mpl_quiz_score_${user?.id || user?._id || "guest"}`;
  const quizStateKey = `${QUIZ_STATE_PREFIX}${user?.id || user?._id || "guest"}`;
  const savedQuiz = readStoredQuizState(quizStateKey);

  const [difficulty, setDifficulty] = useState(savedQuiz?.difficulty || "any");
  const [questions, setQuestions] = useState(savedQuiz?.questions || []);
  const [status, setStatus] = useState(
    savedQuiz?.questions?.length ? "ready" : "loading"
  ); // loading | ready | error
  const [index, setIndex] = useState(
    savedQuiz?.index < (savedQuiz?.questions?.length || 0) ? savedQuiz.index : 0
  );
  const [answered, setAnswered] = useState(null); // null | "correct" | "wrong"
  const [picked, setPicked] = useState(null); // "True" | "False"
  const [flying, setFlying] = useState(null); // null | "left" | "right"
  const [plusOne, setPlusOne] = useState(false);
  const [streak, setStreak] = useState(savedQuiz?.streak || 0);
  const [score, setScore] = useState(() => {
    const s = Number(localStorage.getItem(scoreKey));
    return Number.isFinite(s) ? s : 0;
  });

  // Drag (grab) — état géré hors React pour la fluidité, miroir en state.
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const timers = useRef([]);

  function pushTimer(id) {
    timers.current.push(id);
  }

  function clearSavedQuiz() {
    localStorage.removeItem(quizStateKey);
  }

  function persistQuizProgress(nextState = {}) {
    if (!questions.length) return;
    const payload = {
      difficulty,
      questions,
      index,
      streak,
      score,
      ...nextState,
    };
    localStorage.setItem(quizStateKey, JSON.stringify(payload));
  }

  async function load(diff = difficulty, { resetSavedState = false } = {}) {
    setStatus("loading");
    setIndex(0);
    setAnswered(null);
    setPicked(null);
    setFlying(null);
    setDragX(0);
    setStreak(0);
    setPlusOne(false);
    if (resetSavedState) {
      clearSavedQuiz();
    }
    try {
      const url = diff === "any" ? BASE : `${BASE}&difficulty=${diff}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.response_code !== 0 || !data.results?.length) {
        throw new Error("empty");
      }
      const mappedQuestions = data.results.map((q) => ({
        question: decodeEntities(q.question),
        answer: q.correct_answer, // "True" | "False"
        difficulty: q.difficulty,
      }));
      setQuestions(mappedQuestions);
      localStorage.setItem(
        quizStateKey,
        JSON.stringify({
          difficulty: diff,
          questions: mappedQuestions,
          index: 0,
          streak: 0,
          score,
        })
      );
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    if (!savedQuiz?.questions?.length) {
      load();
    }
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== "ready" || !questions.length) return;
    persistQuizProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, questions, difficulty, index, streak, score]);

  function changeDifficulty(diff) {
    if (diff === difficulty || status === "loading") return;
    setDifficulty(diff);
    load(diff, { resetSavedState: true });
  }

  function persistScore(next) {
    setScore(next);
    localStorage.setItem(scoreKey, String(next));
  }

  // Valide une réponse. dir = sens d'envol de la carte ("left" | "right").
  function commit(value, dir) {
    if (answered || !current) return;
    const correct = current.answer === value;
    setPicked(value);
    setAnswered(correct ? "correct" : "wrong");
    setDragX(0);
    setDragging(false);

    if (correct) {
      persistScore(score + 1);
      setStreak((s) => s + 1);
      setPlusOne(true);
      pushTimer(setTimeout(() => setPlusOne(false), 900));
    } else {
      setStreak(0);
    }

    // On laisse le verdict s'afficher, puis la carte s'envole, puis suivante.
    pushTimer(setTimeout(() => setFlying(dir), 720));
    pushTimer(
      setTimeout(() => {
        setFlying(null);
        setAnswered(null);
        setPicked(null);
        setIndex((i) => i + 1);
      }, 1080)
    );
  }

  // ----- Grab / swipe -----
  function onPointerDown(e) {
    if (answered) return;
    setDragging(true);
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragging) return;
    setDragX(e.clientX - startX.current);
  }
  function endDrag() {
    if (!dragging) return;
    if (dragX <= -THRESHOLD) commit(LEFT_VALUE, "left");
    else if (dragX >= THRESHOLD) commit(RIGHT_VALUE, "right");
    else {
      setDragging(false);
      setDragX(0); // retour élastique
    }
  }

  const total = questions.length;
  const finished = status === "ready" && index >= total;
  const current = questions[index];

  // Intensités de glissement (0 → 1) pour les stamps et le halo.
  const leftI = Math.min(Math.max(-dragX, 0) / THRESHOLD, 1);
  const rightI = Math.min(Math.max(dragX, 0) / THRESHOLD, 1);

  // Transform de la carte active selon la phase.
  let activeStyle;
  if (flying) {
    const off = flying === "left" ? -1 : 1;
    activeStyle = {
      transform: `translateX(${off * 135}%) rotate(${off * 16}deg)`,
      opacity: 0,
    };
  } else if (answered) {
    const off = picked === LEFT_VALUE ? -1 : 1;
    activeStyle = { transform: `translateX(${off * 26}px) rotate(${off * 3}deg)` };
  } else {
    activeStyle = {
      transform: `translateX(${dragX}px) rotate(${dragX * 0.05}deg)`,
      transition: dragging ? "none" : undefined,
    };
  }

  return (
    <aside className="quiz card">
      <header className="quiz-head">
        <div className="quiz-head-title">
          <span className="quiz-badge">
            ?
            </span>
          <div>
            <h3 className="quiz-title">Quiz </h3>
            <p className="quiz-sub">Vrai ou Faux</p>
          </div>
        </div>
        <div className="quiz-score" title="Ton score total">
          <Star size={14} strokeWidth={2.6} />
          <span>{score}</span>
        </div>
      </header>

      {/* Sélecteur de difficulté */}
      {/* <div className="quiz-diffs" role="tablist" aria-label="Difficulté">
        {DIFFS.map((d) => (
          <button
            key={d.key}
            role="tab"
            aria-selected={difficulty === d.key}
            className={`quiz-diff-pill ${difficulty === d.key ? "active" : ""}`}
            onClick={() => changeDifficulty(d.key)}
            disabled={status === "loading"}
          >
            {d.label}
          </button>
        ))}
      </div> */}

      {status === "loading" && (
        <div className="quiz-state">
          <Loader2 size={26} className="quiz-spin" />
          <p>Chargement des questions…</p>
        </div>
      )}

      {status === "error" && (
        <div className="quiz-state">
          <p>Impossible de charger le quiz.</p>
          <button className="btn btn-ghost quiz-retry" onClick={() => load()}>
            <RotateCcw size={16} /> Réessayer
          </button>
        </div>
      )}

      {status === "ready" && !finished && (
        <>
          <div className="quiz-progress">
            <span
              className="quiz-progress-fill"
              style={{ width: `${(index / total) * 100}%` }}
            />
          </div>

          <div className="quiz-stack">
            {/* Indices de sens */}
            <span className="quiz-hint left" style={{ opacity: 0.5 + leftI * 0.5 }}>
              Faux
            </span>
            <span
              className="quiz-hint right"
              style={{ opacity: 0.5 + rightI * 0.5 }}
            >
              Vrai
            </span>

            {plusOne && (
              <span className="quiz-plusone">
                +1 <Sparkles size={15} strokeWidth={2.6} />
              </span>
            )}

            {/* Cartes du dessous — le deck */}
            {[2, 1].map((offset) =>
              questions[index + offset] ? (
                <div
                  key={`b${index + offset}`}
                  className={`quiz-qcard quiz-qcard-behind depth-${offset}`}
                  aria-hidden="true"
                />
              ) : null
            )}

            {/* Carte active — glissable */}
            {current && (
              <div
                key={index}
                className={[
                  "quiz-qcard quiz-qcard-active",
                  dragging ? "is-dragging" : "",
                  answered ? `is-${answered}` : "",
                ].join(" ")}
                style={activeStyle}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                {/* Halo directionnel */}
                <span
                  className="quiz-glow"
                  data-side={dragX < 0 ? "left" : "right"}
                  style={{ opacity: Math.max(leftI, rightI) * 0.9 }}
                />
                {/* Stamps de grab */}
                <span className="quiz-stamp faux" style={{ opacity: leftI }}>
                  <Check size={16} strokeWidth={3} /> Faux
                </span>
                <span className="quiz-stamp vrai" style={{ opacity: rightI }}>
                  <X size={16} strokeWidth={3} /> Vrai
                </span>

                <div className="quiz-qcard-top">
                  <span className={`quiz-badge-diff diff-${current.difficulty}`}>
                    {DIFF_LABEL[current.difficulty]}
                  </span>
                  <span className="quiz-count">
                    {index + 1}
                    <i>/{total}</i>
                  </span>
                </div>

                <p className="quiz-question">{current.question}</p>

                <div className="quiz-qcard-foot">
                  <Gamepad2 size={13} /> Glisse la carte ou tape
                </div>

                {/* Voile de résultat */}
                {answered && (
                  <div className={`quiz-result is-${answered}`}>
                    <span className="quiz-result-icon">
                      {answered === "correct" ? (
                        <Check size={26} strokeWidth={3} />
                      ) : (
                        <X size={26} strokeWidth={3} />
                      )}
                    </span>
                    <strong>
                      {answered === "correct" ? "Bien joué !" : "Raté !"}
                    </strong>
                    <span className="quiz-result-sub">
                      Réponse :{" "}
                      {current.answer === "True" ? "Vrai" : "Faux"}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="quiz-actions">
            <button
              className="quiz-answer quiz-false"
              onClick={() => commit(LEFT_VALUE, "left")}
              disabled={!!answered}
            >
              Faux <X size={17} strokeWidth={2.6} />
            </button>
            {streak >= 2 && (
              <span className="quiz-streak" title="Série de bonnes réponses">
                <Flame size={14} strokeWidth={2.6} /> {streak}
              </span>
            )}
            <button
              className="quiz-answer quiz-true"
              onClick={() => commit(RIGHT_VALUE, "right")}
              disabled={!!answered}
            >
              <Check size={17} strokeWidth={2.6} /> Vrai
            </button>
          </div>
        </>
      )}

      {finished && (
        <div className="quiz-state quiz-done">
          <div className="quiz-done-badge">
            <Trophy size={30} strokeWidth={2} />
          </div>
          <h3 className="quiz-done-title">Série terminée !</h3>
          <p className="quiz-done-sub">
            Score total : <strong>{score}</strong> point
            {score > 1 ? "s" : ""}
          </p>
          <button
            className="btn btn-primary quiz-replay"
            onClick={() => load(difficulty, { resetSavedState: true })}
          >
            <RotateCcw size={16} /> Nouvelle série
          </button>
        </div>
      )}
    </aside>
  );
}
