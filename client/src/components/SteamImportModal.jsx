import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Heart,
  Trophy,
  Pause,
  XCircle,
  Infinity as InfinityIcon,
  RefreshCw,
  Check,
  Sparkles,
  ChevronRight,
  X,
  PartyPopper,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import SteamIcon from "./SteamIcon";

// Les statuts sélectionnables pour un jeu « lancé » lors de l'import
// (wishlist inclus : on peut renvoyer un jeu joué vers les envies).
const PLAYED_STATUSES = [
  { key: "finished", label: "Terminé", Icon: Trophy },
  { key: "paused", label: "En pause", Icon: Pause },
  { key: "dropped", label: "Abandonné", Icon: XCircle },
  { key: "endless", label: "Sans fin", Icon: InfinityIcon },
  { key: "wishlist", label: "Wishlist", Icon: Heart },
];

const STATUS_LABEL = {
  wishlist: "Wishlist",
  playing: "En cours",
  finished: "Terminé",
  paused: "En pause",
  dropped: "Abandonné",
  endless: "Sans fin",
};

function fmtHours(h) {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${Math.round(h)} h`;
}

// Étapes du parcours d'import (gamifié). On saute automatiquement celles qui
// sont vides.
const STEPS = [
  { key: "wishlist", title: "Jamais lancés", color: "#e0679b" },
  { key: "played", title: "Déjà joués", color: "#5aa9e6" },
  { key: "update", title: "Temps de jeu à jour", color: "#eaa908" },
];

export default function SteamImportModal({ onClose, onDone }) {
  const { token } = useAuth();
  const [phase, setPhase] = useState("scan"); // scan | steps | importing | done | error
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null); // { games, unmatched, counts }
  const [items, setItems] = useState({}); // appid -> { include, status, updateHours, importAchievements }
  const [stepIdx, setStepIdx] = useState(0);
  const [result, setResult] = useState(null);
  const [importAch, setImportAch] = useState(true);

  // Charge l'aperçu (bibliothèque Steam matchée).
  useEffect(() => {
    let alive = true;
    apiFetch("/steam/preview", { method: "POST", token })
      .then((d) => {
        if (!alive) return;
        setPreview(d);
        // État initial des sélections : tout coché, statut = suggestion serveur.
        const init = {};
        for (const g of d.games) {
          init[g.appid] = {
            include: g.category !== "synced",
            status: g.suggestedStatus,
            // Maj des heures cochée par défaut seulement si Steam en sait plus.
            updateHours: g.category === "update" && g.playtimeHours > (g.currentHours || 0),
            importAchievements: g.canImportAchievements,
            hours: g.playtimeHours, // valeur éditable (étape « update »)
          };
        }
        setItems(init);
        setPhase("steps");
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setPhase("error");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  // Répartit les jeux par étape.
  const byStep = useMemo(() => {
    const g = { wishlist: [], played: [], update: [] };
    for (const it of preview?.games || []) {
      if (g[it.category]) g[it.category].push(it);
    }
    return g;
  }, [preview]);

  // Étapes réellement présentes (non vides), dans l'ordre.
  const activeSteps = useMemo(
    () => STEPS.filter((s) => byStep[s.key]?.length),
    [byStep]
  );

  const step = activeSteps[stepIdx];

  function setItem(appid, patch) {
    setItems((m) => ({ ...m, [appid]: { ...m[appid], ...patch } }));
  }

  // Coche / décoche tous les jeux de l'étape courante.
  function setAll(stepKey, include) {
    setItems((m) => {
      const next = { ...m };
      for (const g of byStep[stepKey] || [])
        next[g.appid] = { ...next[g.appid], include };
      return next;
    });
  }

  function next() {
    if (stepIdx < activeSteps.length - 1) setStepIdx((i) => i + 1);
    else runImport();
  }
  function prev() {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  }

  async function runImport() {
    setPhase("importing");
    const payload = [];
    for (const g of preview.games) {
      const it = items[g.appid];
      if (!it?.include) continue;
      payload.push({
        appid: g.appid,
        gameId: g.gameId,
        name: g.name,
        cover: g.cover,
        status: g.category === "wishlist" ? "wishlist" : it.status,
        // Heures éditables à l'étape « update », sinon celles de Steam.
        playtimeHours: it.hours != null ? it.hours : g.playtimeHours,
        updateHours: !!it.updateHours,
        importAchievements: importAch && g.canImportAchievements,
      });
    }
    try {
      const r = await apiFetch("/steam/import", {
        method: "POST",
        token,
        body: { items: payload },
      });
      setResult(r);
      setPhase("done");
      onDone?.();
    } catch (e) {
      setError(e.message);
      setPhase("error");
    }
  }

  const selectedCount = useMemo(
    () =>
      (preview?.games || []).filter((g) => items[g.appid]?.include).length,
    [preview, items]
  );

  return (
    <div className="steam-modal-overlay" onClick={phase === "steps" ? undefined : onClose}>
      <div
        className="steam-modal"
        onClick={(e) => e.stopPropagation()}
        style={step ? { "--step-color": step.color } : undefined}
      >
        <button className="steam-modal-close clickable" onClick={onClose}>
          <X size={18} />
        </button>

        {/* En-tête commun */}
        <div className="steam-modal-head">
          <div className="steam-modal-brand">
            <SteamIcon size={22} />
            <span>Import Steam</span>
          </div>
          {phase === "steps" && activeSteps.length > 1 && (
            <div className="steam-steps-dots">
              {activeSteps.map((s, i) => (
                <span key={s.key} className={`step-dot ${i === stepIdx ? "active" : ""} ${i < stepIdx ? "done" : ""}`} />
              ))}
            </div>
          )}
        </div>

        {phase === "scan" && <ScanScreen />}
        {phase === "error" && (
          <div className="steam-center">
            <XCircle size={40} className="steam-error-icon" />
            <h3>Oups</h3>
            <p>{error}</p>
            <button className="btn-steam-primary clickable" onClick={onClose}>
              Fermer
            </button>
          </div>
        )}

        {phase === "steps" && step && (
          <StepScreen
            step={step}
            games={byStep[step.key]}
            items={items}
            setItem={setItem}
            setAll={setAll}
          />
        )}

        {phase === "importing" && (
          <div className="steam-center">
            <div className="steam-import-spinner">
              <Loader2 size={44} className="spin" />
            </div>
            <h3>Import en cours…</h3>
            <p>On ajoute tes jeux et on récupère tes succès.</p>
          </div>
        )}

        {phase === "done" && <DoneScreen result={result} onClose={onClose} />}

        {/* Barre d'action des étapes */}
        {phase === "steps" && step && (
          <div className="steam-modal-foot">
            <button
              type="button"
              className="steam-switch clickable"
              role="switch"
              aria-checked={importAch}
              onClick={() => setImportAch((v) => !v)}
            >
              <span className={`steam-switch-track ${importAch ? "on" : ""}`}>
                <span className="steam-switch-thumb" />
              </span>
              <span className="steam-switch-label">
                <Trophy size={15} /> Importer les succès des jeux joués
              </span>
            </button>
            <div className="steam-foot-actions">
              {stepIdx > 0 && (
                <button className="btn-ghost clickable" onClick={prev}>
                  Retour
                </button>
              )}
              <button className="btn-steam-primary clickable" onClick={next}>
                {stepIdx < activeSteps.length - 1 ? (
                  <>
                    Suivant <ChevronRight size={16} />
                  </>
                ) : (
                  <>
                    Importer ({selectedCount}) <Sparkles size={16} />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScanScreen() {
  return (
    <div className="steam-center steam-scan">
      <div className="steam-scan-orbit">
        <SteamIcon size={40} />
      </div>
      <h3>Connexion à Steam…</h3>
      <p>On récupère ta bibliothèque et on la relie à MyPlayLog.</p>
    </div>
  );
}

function StepScreen({ step, games, items, setItem, setAll }) {
  const includedCount = games.filter((g) => items[g.appid]?.include).length;
  const allIncluded = includedCount === games.length;
  // Message d'intro façon "gros texte" selon l'étape.
  const intro = {
    wishlist: (
      <>
        Tu n'as <strong>jamais lancé</strong> ces {games.length} jeux. On les
        met dans ta <span className="hl-pink">wishlist</span>. Décoche ceux que
        tu ne veux pas.
      </>
    ),
    played: (
      <>
        Ces {games.length} jeux, tu y as <strong>déjà joué</strong>. Choisis leur
        statut — on a déjà deviné pour toi.
      </>
    ),
    update: (
      <>
        Ces {games.length} jeux sont <strong>déjà chez toi</strong>. On récupère
        leurs succès et on met tes heures à jour quand Steam en sait plus.
      </>
    ),
  }[step.key];

  return (
    <div className="steam-step">
      <div className="steam-step-title">
        <h3>{step.title}</h3>
        <span className="steam-step-count">{games.length}</span>
        <button
          className="steam-selectall clickable"
          onClick={() => setAll(step.key, !allIncluded)}
        >
          {allIncluded ? "Tout décocher" : "Tout cocher"}
        </button>
      </div>
      <p className="steam-step-intro">{intro}</p>

      <div className="steam-cards">
        {games.map((g, i) => (
          <GameCard
            key={g.appid}
            g={g}
            it={items[g.appid]}
            setItem={setItem}
            step={step.key}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}

function GameCard({ g, it, setItem, step, index }) {
  const included = it?.include;
  // Cliquer n'importe où sur la carte coche/décoche (les contrôles internes
  // stoppent la propagation pour ne pas déclencher ce toggle).
  const toggle = () => setItem(g.appid, { include: !included });
  const stop = (e) => e.stopPropagation();

  return (
    <div
      className={`steam-game-card ${included ? "" : "excluded"}`}
      style={{ animationDelay: `${Math.min(index * 45, 900)}ms` }}
      onClick={toggle}
      role="button"
      aria-pressed={included}
    >
      <span className="steam-game-check" aria-hidden="true">
        {included ? <Check size={14} /> : null}
      </span>

      <div className="steam-game-cover">
        {g.cover ? (
          <img src={g.cover} alt="" loading="lazy" />
        ) : (
          <div className="steam-game-noart">
            <SteamIcon size={20} />
          </div>
        )}
      </div>

      <div className="steam-game-body">
        <div className="steam-game-name">{g.name}</div>
        <div className="steam-game-meta">
          {step === "update" ? (
            <div className="steam-tag gold">
              <RefreshCw size={12} /> {STATUS_LABEL[g.currentStatus] || "Déjà présent"}
            </div>
          ) : g.playtimeHours > 0 ? (
            <span>{fmtHours(g.playtimeHours)} de jeu</span>
          ) : (
            <span className="steam-never">jamais lancé</span>
          )}
        </div>

        {step === "wishlist" && (
          <div className="steam-tag pink">
            <Heart size={12} /> Wishlist
          </div>
        )}

        {step === "played" && (
          <div className="steam-status-pick" onClick={stop}>
            {PLAYED_STATUSES.map(({ key, label, Icon }) => (
              <button
                key={key}
                className={`steam-status-btn clickable ${it?.status === key ? "active" : ""}`}
                onClick={() => setItem(g.appid, { status: key })}
                title={label}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        )}

        {step === "update" && (
          <div className="steam-update-hours" onClick={stop}>
            <button
              type="button"
              className={`steam-hours-toggle clickable ${it?.updateHours ? "on" : ""}`}
              onClick={() => setItem(g.appid, { updateHours: !it?.updateHours })}
            >
              <span className="steam-hours-check">
                {it?.updateHours ? <Check size={12} /> : null}
              </span>
              Maj des heures
            </button>
            <span className="steam-hours-edit">
              <span className="steam-hours-current">{fmtHours(g.currentHours)}</span>
              <ChevronRight size={12} />
              <input
                type="number"
                min="0"
                step="0.5"
                value={it?.hours ?? ""}
                disabled={!it?.updateHours}
                onChange={(e) =>
                  setItem(g.appid, {
                    hours: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <span className="steam-hours-unit">h</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function DoneScreen({ result, onClose }) {
  return (
    <div className="steam-center steam-done">
      <div className="steam-done-burst">
        <PartyPopper size={46} />
      </div>
      <h3>C'est importé !</h3>
      <div className="steam-done-stats">
        <div className="steam-done-stat">
          <strong>{result?.added || 0}</strong>
          <span>ajoutés</span>
        </div>
        <div className="steam-done-stat">
          <strong>{result?.updated || 0}</strong>
          <span>mis à jour</span>
        </div>
        <div className="steam-done-stat">
          <strong>{result?.achievements || 0}</strong>
          <span>jeux à succès</span>
        </div>
      </div>
      <p>Retrouve tes succès dans l'onglet « Succès » de ton profil.</p>
      <button className="btn-steam-primary clickable" onClick={onClose}>
        Génial <Check size={16} />
      </button>
    </div>
  );
}
