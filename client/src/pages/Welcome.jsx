import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Clapperboard,
  Settings,
  Check,
  Flame,
  CalendarDays,
  Sparkles,
  Brain,
  ChevronRight,
  ChevronLeft,
  Gamepad2,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useClickOutside } from "../hooks/useClickOutside";
import { apiFetch } from "../lib/api";
import QuizCard from "../components/QuizCard";
import DocumentaryModal from "../components/DocumentaryModal";
import DiscoverGemsModal, { GEMS_RESUME_KEY } from "../components/DiscoverGemsModal";
import HomeFeed, { FeedUserFilter } from "../components/HomeFeed";
import GameCard from "../components/GameCard";

// Réglages par défaut du feed documentaire, persistés en localStorage.
const PREFS_KEY = "mpl_doc_prefs";
const DEFAULT_PREFS = { lang: ["fr"], scope: "played" };
const QUIZ_KEY = "mpl_home_quiz_open";
// Même seuil que la bottom bar de l'app-shell (voir app-01-landing-shell.css).
const MOBILE_BP = 760;

// Sur mobile le rail latéral passe sous le feed (potentiellement long) : on
// ouvre le quiz dans une modale plutôt que de compter sur le scroll pour le
// révéler, sinon le bouton "Quiz" paraît ne rien faire.
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= MOBILE_BP
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BP}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (p && Array.isArray(p.lang) && p.lang.length) return p;
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

// "12 juil." — date courte FR pour les sorties.
function shortDate(ts) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

export default function Welcome() {
  const { user, token } = useAuth();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [showDoc, setShowDoc] = useState(false);
  // Rouvre le deck de pépites là où on l'avait laissé si on revient d'une
  // fiche de jeu ouverte depuis le deck (état sauvé en sessionStorage).
  const [showGems, setShowGems] = useState(
    () => !!sessionStorage.getItem(GEMS_RESUME_KEY)
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showQuiz, setShowQuiz] = useState(
    () => localStorage.getItem(QUIZ_KEY) === "1"
  );
  const [quizModalOpen, setQuizModalOpen] = useState(false);
  const [discover, setDiscover] = useState(null);
  // Filtre du fil : id du joueur suivi dont on veut voir l'activité (null = tous).
  const [feedUser, setFeedUser] = useState(null);
  const isMobile = useIsMobile();
  const settingsRef = useRef(null);
  useClickOutside(settingsRef, () => setShowSettings(false), showSettings);

  // Le CTA « Chercher mes pépites aussi » des cartes du fil ouvre la modale.
  useEffect(() => {
    const open = () => setShowGems(true);
    window.addEventListener("mpl:open-gems", open);
    return () => window.removeEventListener("mpl:open-gems", open);
  }, []);

  useEffect(() => {
    let alive = true;
    apiFetch("/feed/discover", { token })
      .then((d) => alive && setDiscover(d))
      .catch(() => alive && setDiscover({ hot: [], upcoming: [], forYou: [] }));
    return () => {
      alive = false;
    };
  }, [token]);

  function savePrefs(next) {
    setPrefs(next);
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  }

  function toggleEn() {
    const hasEn = prefs.lang.includes("en");
    savePrefs({ ...prefs, lang: hasEn ? ["fr"] : ["fr", "en"] });
  }

  function toggleQuiz() {
    // Mobile : le rail latéral est sous le feed (potentiellement long), donc
    // on ouvre directement une modale au lieu de compter sur le scroll.
    if (isMobile) {
      setQuizModalOpen(true);
      return;
    }
    setShowQuiz((v) => {
      localStorage.setItem(QUIZ_KEY, v ? "0" : "1");
      return !v;
    });
  }

  return (
    <div className="home">
      <div className="home-main">
        {/* --- En-tête : salut + actions bien visibles --- */}
        <header className="hf-hero">
          <div className="hf-hello">
            <h1 className="hf-hello-title">
              Salut <span className="grad-text">{user?.username}</span>
            </h1>
            <p className="hf-hello-sub">
              Voici ce qui se passe sur ton radar à jeux.
            </p>
          </div>

          <div className="hf-hero-actions">
            <div className="doc-cta">
              <button className="doc-cta-btn clickable" onClick={() => setShowDoc(true)}>
                <Clapperboard size={19} /> Lancer un documentaire
              </button>
              <div className="doc-cta-settings" ref={settingsRef}>
                <button
                  className={`doc-cta-gear clickable ${showSettings ? "active" : ""}`}
                  onClick={() => setShowSettings((v) => !v)}
                  aria-label="Réglages du feed"
                  title="Réglages"
                >
                  <Settings size={18} />
                </button>
                {showSettings && (
                  <div className="doc-settings card">
                    <div className="doc-settings-group">
                      <span className="doc-settings-label">Langue</span>
                      <label className="doc-settings-opt disabled">
                        <span className="doc-check on">
                          <Check size={13} />
                        </span>
                        Français
                      </label>
                      <label className="doc-settings-opt clickable" onClick={toggleEn}>
                        <span className={`doc-check ${prefs.lang.includes("en") ? "on" : ""}`}>
                          {prefs.lang.includes("en") && <Check size={13} />}
                        </span>
                        Anglais
                      </label>
                    </div>
                    <div className="doc-settings-group">
                      <span className="doc-settings-label">Jeux</span>
                      <label
                        className="doc-settings-opt clickable"
                        onClick={() => savePrefs({ ...prefs, scope: "played" })}
                      >
                        <span className={`doc-radio ${prefs.scope === "played" ? "on" : ""}`} />
                        Jeux joués uniquement
                      </label>
                      <label
                        className="doc-settings-opt clickable"
                        onClick={() => savePrefs({ ...prefs, scope: "all" })}
                      >
                        <span className={`doc-radio ${prefs.scope === "all" ? "on" : ""}`} />
                        Tous mes jeux
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <button
              className={`hf-quiz-btn clickable ${
                (isMobile ? quizModalOpen : showQuiz) ? "on" : ""
              }`}
              onClick={toggleQuiz}
              title={
                isMobile
                  ? "Ouvrir le quiz"
                  : showQuiz
                    ? "Masquer le quiz"
                    : "Afficher le quiz"
              }
            >
              <Brain size={18} /> Quiz
            </button>

            <button
              className="hf-gems-btn clickable"
              onClick={() => setShowGems(true)}
              title="3 jeux que tu aimes → des pépites indés sur mesure"
            >
              Découvrir une pépite indé
            </button>
          </div>
        </header>

        {/* --- Jeux du moment : carrousel horizontal --- */}
        <section className="hf-sec">
          <div className="hf-sec-head">
            <h2 className="hf-sec-title">
              <Flame size={17} /> Jeux du moment
            </h2>
            <Link to="/explore" className="hf-sec-link clickable">
              Explorer <ChevronRight size={14} />
            </Link>
          </div>
          {discover === null ? (
            <div className="hf-carousel" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="gp-skel hf-carousel-skel" />
              ))}
            </div>
          ) : discover.hot.length > 0 ? (
            <DragCarousel>
              {discover.hot.map((g) => (
                <div className="hf-carousel-item" key={g.id}>
                  <GameCard game={g} />
                </div>
              ))}
            </DragCarousel>
          ) : null}
        </section>

        {/* --- Fil d'actualité --- */}
        <section className="hf-sec">
          <div className="hf-sec-head">
            <h2 className="hf-sec-title">
              <Sparkles size={17} /> Fil d'actualité
            </h2>
            {/* Avatars des joueurs suivis : filtre le fil sur un seul joueur */}
            <FeedUserFilter
              token={token}
              myId={user?.id}
              value={feedUser}
              onChange={setFeedUser}
            />
          </div>
          <HomeFeed token={token} me={user?.username} filterUser={feedUser} />
        </section>
      </div>

      {/* --- Rail latéral : quiz (sur demande), sorties, suggestions --- */}
      <div className="home-aside hf-aside">
        {/* Sur mobile, le quiz ne vit que dans la modale (voir toggleQuiz) —
            évite d'avoir deux instances qui se disputent le même localStorage. */}
        {showQuiz && !isMobile && <QuizCard />}

        <UpcomingWidget games={discover?.upcoming} loading={discover === null} />
        <ForYouWidget games={discover?.forYou} loading={discover === null} />
      </div>

      {showDoc && (
        <DocumentaryModal prefs={prefs} token={token} onClose={() => setShowDoc(false)} />
      )}
      {quizModalOpen && <QuizModal onClose={() => setQuizModalOpen(false)} />}
      {showGems && (
        <DiscoverGemsModal token={token} onClose={() => setShowGems(false)} />
      )}
    </div>
  );
}

// Modale mobile du quiz (voir toggleQuiz) : même carte que le rail latéral,
// juste encapsulée dans un overlay pour un accès immédiat.
function QuizModal({ onClose }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="quiz-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <QuizCard />
      </div>
    </div>,
    document.body
  );
}

// Carrousel horizontal : drag à la souris + flèches gauche/droite.
// Le tactile scrolle nativement ; à la souris on translate le scroll et on
// avale le clic qui suit un drag pour ne pas ouvrir une fiche jeu par erreur.
function DragCarousel({ children }) {
  const ref = useRef(null);
  const drag = useRef({ down: false, startX: 0, left: 0, moved: false });
  const [dragging, setDragging] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  };

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  function onDown(e) {
    drag.current = {
      down: true,
      startX: e.pageX,
      left: ref.current.scrollLeft,
      moved: false,
    };
  }

  function onMove(e) {
    const d = drag.current;
    if (!d.down) return;
    const dx = e.pageX - d.startX;
    if (!d.moved && Math.abs(dx) > 6) {
      d.moved = true;
      setDragging(true);
    }
    if (d.moved) {
      e.preventDefault();
      ref.current.scrollLeft = d.left - dx;
    }
  }

  function onUp() {
    drag.current.down = false;
    setDragging(false);
  }

  // Après un drag, le mouseup génère quand même un click sur la carte
  // survolée : on l'intercepte en phase de capture.
  function onClickCapture(e) {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  }

  const nudge = (dir) =>
    ref.current?.scrollBy({
      left: dir * ref.current.clientWidth * 0.75,
      behavior: "smooth",
    });

  return (
    <div className="hf-carousel-wrap">
      <button
        className={`hf-car-arrow left clickable ${canLeft ? "" : "off"}`}
        onClick={() => nudge(-1)}
        aria-label="Défiler vers la gauche"
        tabIndex={canLeft ? 0 : -1}
      >
        <ChevronLeft size={20} />
      </button>
      <div
        className={`hf-carousel ${dragging ? "dragging" : ""}`}
        ref={ref}
        onScroll={update}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onClickCapture={onClickCapture}
        onDragStart={(e) => e.preventDefault()}
      >
        {children}
      </div>
      <button
        className={`hf-car-arrow right clickable ${canRight ? "" : "off"}`}
        onClick={() => nudge(1)}
        aria-label="Défiler vers la droite"
        tabIndex={canRight ? 0 : -1}
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}

// Widget « Prochaines sorties » : les sorties les plus attendues, par date.
function UpcomingWidget({ games, loading }) {
  if (loading) {
    return (
      <div className="hf-widget card" aria-busy="true">
        <span className="gp-skel gp-skel-bar" style={{ width: "60%" }} />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="hf-up-row">
            <span className="gp-skel" style={{ width: 38, height: 50, borderRadius: 8 }} />
            <div style={{ flex: 1, display: "grid", gap: 6 }}>
              <span className="gp-skel gp-skel-bar" style={{ width: "80%" }} />
              <span className="gp-skel gp-skel-bar sm" style={{ width: "35%" }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!games?.length) return null;
  return (
    <div className="hf-widget card">
      <h3 className="hf-w-title">
        <CalendarDays size={15} /> Sorties à venir
      </h3>
      <ul className="hf-up-list">
        {games.slice(0, 6).map((g) => (
          <li key={g.id}>
            <Link to={`/game/${g.id}`} className="hf-up-row clickable" title={g.name}>
              {g.cover ? (
                <img src={g.cover} alt="" loading="lazy" draggable="false" />
              ) : (
                <span className="hf-up-ph">
                  <Gamepad2 size={14} />
                </span>
              )}
              <span className="hf-up-info">
                <span className="hf-up-name">{g.name}</span>
                <span className="hf-up-meta">
                  {g.hypes > 0 && (
                    <i className="hf-up-hype">
                      <Flame size={11} /> {g.hypes}
                    </i>
                  )}
                </span>
              </span>
              <span className="hf-up-date">{shortDate(g.releaseDate)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/releases" className="hf-w-more clickable">
        Calendrier des sorties <ChevronRight size={14} />
      </Link>
    </div>
  );
}

// Widget « Pour toi » : suggestions selon les genres de la bibliothèque.
function ForYouWidget({ games, loading }) {
  if (loading) {
    return (
      <div className="hf-widget card" aria-busy="true">
        <span className="gp-skel gp-skel-bar" style={{ width: "50%" }} />
        <div className="hf-fy-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="gp-skel hf-fy-skel" />
          ))}
        </div>
      </div>
    );
  }
  if (!games?.length) return null;
  return (
    <div className="hf-widget card">
      <h3 className="hf-w-title">
        <Sparkles size={15} /> Pour toi
      </h3>
      <p className="hf-w-sub">Selon les genres de ta bibliothèque</p>
      <div className="hf-fy-grid">
        {games.slice(0, 6).map((g) => (
          <Link
            key={g.id}
            to={`/game/${g.id}`}
            className="hf-fy-item clickable"
            title={g.name}
          >
            {g.cover ? (
              <img src={g.cover} alt={g.name} loading="lazy" draggable="false" />
            ) : (
              <span className="hf-fy-ph">
                <Gamepad2 size={16} />
              </span>
            )}
            <span className="hf-fy-name">{g.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
