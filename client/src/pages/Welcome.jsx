import { useRef, useState } from "react";
import { PartyPopper, Newspaper, Clapperboard, Settings, Check } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useClickOutside } from "../hooks/useClickOutside";
import QuizCard from "../components/QuizCard";
import DocumentaryModal from "../components/DocumentaryModal";

// Réglages par défaut du feed documentaire, persistés en localStorage.
const PREFS_KEY = "mpl_doc_prefs";
const DEFAULT_PREFS = { lang: ["fr"], scope: "played" };

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (p && Array.isArray(p.lang) && p.lang.length) return p;
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

export default function Welcome() {
  const { user, token } = useAuth();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [showDoc, setShowDoc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef(null);
  useClickOutside(settingsRef, () => setShowSettings(false), showSettings);

  function savePrefs(next) {
    setPrefs(next);
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  }

  function toggleEn() {
    const hasEn = prefs.lang.includes("en");
    savePrefs({ ...prefs, lang: hasEn ? ["fr"] : ["fr", "en"] });
  }

  return (
    <div className="home">
      {/* Colonne principale : futur flux (sorties, amis, listes, jeux gratuits…) */}
      <div className="home-main">
        <div className="home-hero">
          <div className="welcome-emoji">
            <PartyPopper size={34} strokeWidth={2} />
          </div>
          <h1 className="home-hero-title">
            Salut <span className="grad-text">{user?.username}</span>
          </h1>
          <p className="home-hero-sub">
            Ton journal de jeux est prêt. En attendant, teste tes connaissances
            dans le quiz et grimpe au classement.
          </p>

          {/* CTA : lancer un mini-feed de documentaires jeux vidéo */}
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
        </div>

        <div className="home-feed-placeholder card">
          <Newspaper size={18} />
          <span>
            Bientôt ici : sorties du moment, activité des amis, tes dernières
            listes et les jeux gratuits.
          </span>
        </div>
      </div>

      {/* Colonne flottante : le quiz */}
      <div className="home-aside">
        <QuizCard />
      </div>

      {showDoc && (
        <DocumentaryModal prefs={prefs} token={token} onClose={() => setShowDoc(false)} />
      )}
    </div>
  );
}
