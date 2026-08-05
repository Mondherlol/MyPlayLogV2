import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
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
  Search,
  Gamepad2,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import PsnIcon from "./PsnIcon";

// Les statuts sélectionnables pour un jeu « joué » lors de l'import (tous les
// titres PSN ont été lancés → pas de wishlist ici).
export const PLAYED_STATUSES = [
  { key: "finished", label: "Terminé", Icon: Trophy },
  { key: "paused", label: "En pause", Icon: Pause },
  { key: "dropped", label: "Abandonné", Icon: XCircle },
  { key: "endless", label: "Sans fin", Icon: InfinityIcon },
];

const STATUS_LABEL = {
  wishlist: "Wishlist",
  playing: "En cours",
  finished: "Terminé",
  paused: "En pause",
  dropped: "Abandonné",
  endless: "Sans fin",
};

export function fmtHours(h) {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${Math.round(h)} h`;
}

// Étapes du parcours d'import (gamifié). On saute automatiquement celles qui
// sont vides.
const STEPS = [
  { key: "played", title: "Déjà joués", color: "#2e6be6" },
  { key: "update", title: "À mettre à jour", color: "#7aa7ff" },
];

// Étape finale (ajoutée seulement s'il y a des jeux non reconnus) : l'utilisateur
// lie chaque jeu PSN à un vrai jeu IGDB à la main.
const UNMATCHED_STEP = { key: "unmatched", title: "À reconnaître", color: "#e0894a" };

// Consoles PlayStation (abréviation IGDB -> libellés). Sert à déduire, pour un
// jeu choisi à la main, les consoles PS3/PS4/PS5 sur lesquelles il est sorti.
const PS_CONSOLES = [
  { abbr: "PS5", label: "PS5", name: "PlayStation 5" },
  { abbr: "PS4", label: "PS4", name: "PlayStation 4" },
  { abbr: "PS3", label: "PS3", name: "PlayStation 3" },
];
export function psConsolesFromPlatforms(platforms = []) {
  const set = new Set(platforms);
  return PS_CONSOLES.filter((c) => set.has(c.abbr)).map((c) => ({
    label: c.label,
    name: c.name,
  }));
}

// Sélecteur de console (PS3/PS4/PS5) : n'affiche que les consoles où le jeu est
// sorti. `value`/`onChange` portent le nom IGDB (« PlayStation 5 »…).
export function ConsolePicker({ options, value, onChange }) {
  if (!options?.length) return null;
  return (
    <div className="psn-console-pick" onClick={(e) => e.stopPropagation()}>
      {options.map((c) => (
        <button
          key={c.name}
          type="button"
          className={`psn-console-btn clickable ${value === c.name ? "active" : ""}`}
          onClick={() => onChange(c.name)}
          title={c.name}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

export default function PsnImportModal({ onClose, onDone }) {
  const { token } = useAuth();
  const [phase, setPhase] = useState("scan"); // scan | steps | importing | done | error
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null); // { games, unmatched, counts }
  const [items, setItems] = useState({}); // id -> { include, status, updateHours, hours }
  // Jeux non reconnus liés à la main : uId -> { gameId, name, cover, status }.
  // Présence dans la map = jeu résolu → inclus à l'import.
  const [resolved, setResolved] = useState({});
  // Jeux non reconnus ignorés (croix) : uId -> true. Retirés de la liste.
  const [dismissed, setDismissed] = useState({});
  const [stepIdx, setStepIdx] = useState(0);
  const [result, setResult] = useState(null);
  const [importTrophies, setImportTrophies] = useState(true);

  // Charge l'aperçu (bibliothèque PSN matchée).
  useEffect(() => {
    let alive = true;
    apiFetch("/psn/preview", { method: "POST", token })
      .then((d) => {
        if (!alive) return;
        setPreview(d);
        const init = {};
        for (const g of d.games) {
          init[g.id] = {
            include: true,
            status: g.suggestedStatus,
            console: g.suggestedConsole || null, // console pré-sélectionnée
            // Maj des heures cochée par défaut seulement si PSN en sait plus.
            updateHours: g.category === "update" && g.playtimeHours > (g.currentHours || 0),
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
    const g = { played: [], update: [] };
    for (const it of preview?.games || []) {
      if (g[it.category]) g[it.category].push(it);
    }
    return g;
  }, [preview]);

  // Étapes réellement présentes (non vides), dans l'ordre. L'étape « À reconnaître »
  // ferme la marche s'il reste des jeux non matchés.
  const activeSteps = useMemo(() => {
    const s = STEPS.filter((st) => byStep[st.key]?.length);
    if (preview?.unmatched?.length) s.push(UNMATCHED_STEP);
    return s;
  }, [byStep, preview]);

  const step = activeSteps[stepIdx];

  function setItem(id, patch) {
    setItems((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  }

  // Ignorer un jeu non reconnu : on le masque et on annule sa liaison éventuelle.
  function dismissUnmatched(id) {
    setDismissed((m) => ({ ...m, [id]: true }));
    setResolved((m) => {
      const n = { ...m };
      delete n[id];
      return n;
    });
  }

  // Coche / décoche tous les jeux de l'étape courante.
  function setAll(stepKey, include) {
    setItems((m) => {
      const next = { ...m };
      for (const g of byStep[stepKey] || []) next[g.id] = { ...next[g.id], include };
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
      const it = items[g.id];
      if (!it?.include) continue;
      // Si l'utilisateur a corrigé le jeu détecté (bouton « Changer »), on
      // utilise le jeu IGDB choisi mais on garde le temps / les trophées PSN.
      const ov = it.override;
      payload.push({
        gameId: ov?.gameId ?? g.gameId,
        name: ov?.name ?? g.name,
        cover: ov?.cover ?? g.cover,
        platform: (ov ? ov.console : it.console) || null,
        status: it.status,
        playtimeHours: it.hours != null ? it.hours : g.playtimeHours,
        updateHours: !!it.updateHours,
        npCommunicationId: g.npCommunicationId,
        npServiceName: g.npServiceName,
        importTrophies: importTrophies && g.canImportTrophies,
        titleKey: g.titleKey,
        psnName: g.psnName,
      });
    }
    // Jeux non reconnus que l'utilisateur a liés à la main : on prend le jeu IGDB
    // choisi mais on garde le temps de jeu / les trophées PSN d'origine.
    for (const u of preview.unmatched || []) {
      const r = resolved[u.id];
      if (!r?.gameId) continue;
      payload.push({
        gameId: r.gameId,
        name: r.name,
        cover: r.cover,
        platform: r.console || null,
        status: r.status,
        playtimeHours: u.playtimeHours,
        updateHours: false,
        npCommunicationId: u.npCommunicationId,
        npServiceName: u.npServiceName,
        importTrophies: importTrophies && u.canImportTrophies,
        titleKey: u.titleKey,
        psnName: u.psnName,
      });
    }
    // Jeux « à reconnaître » ignorés (croix) : on les mémorise pour que les
    // synchros futures ne les reproposent plus.
    const ignored = (preview.unmatched || [])
      .filter((u) => dismissed[u.id])
      .map((u) => ({ titleKey: u.titleKey, psnName: u.psnName, icon: u.icon }));
    try {
      const r = await apiFetch("/psn/import", {
        method: "POST",
        token,
        body: { items: payload, ignored },
      });
      setResult(r);
      setPhase("done");
      onDone?.();
    } catch (e) {
      setError(e.message);
      setPhase("error");
    }
  }

  const selectedCount = useMemo(() => {
    const base = (preview?.games || []).filter((g) => items[g.id]?.include).length;
    const extra = Object.values(resolved).filter((r) => r?.gameId).length;
    return base + extra;
  }, [preview, items, resolved]);

  return (
    <div className="steam-modal-overlay" onClick={phase === "steps" ? undefined : onClose}>
      <div
        className="steam-modal psn-modal"
        onClick={(e) => e.stopPropagation()}
        style={step ? { "--step-color": step.color } : undefined}
      >
        <button className="steam-modal-close clickable" onClick={onClose}>
          <X size={18} />
        </button>

        <div className="steam-modal-head">
          <div className="steam-modal-brand">
            <PsnIcon size={22} />
            <span>Import PlayStation</span>
          </div>
          {phase === "steps" && activeSteps.length > 1 && (
            <div className="steam-steps-dots">
              {activeSteps.map((s, i) => (
                <span
                  key={s.key}
                  className={`step-dot ${i === stepIdx ? "active" : ""} ${i < stepIdx ? "done" : ""}`}
                />
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
            <button className="btn-psn-primary clickable" onClick={onClose}>
              Fermer
            </button>
          </div>
        )}

        {phase === "steps" && step && step.key === "unmatched" && (
          <UnmatchedScreen
            step={step}
            games={preview.unmatched}
            resolved={resolved}
            setResolved={setResolved}
            dismissed={dismissed}
            onDismiss={dismissUnmatched}
            token={token}
          />
        )}

        {phase === "steps" && step && step.key !== "unmatched" && (
          <StepScreen
            step={step}
            games={byStep[step.key]}
            items={items}
            setItem={setItem}
            setAll={setAll}
            token={token}
          />
        )}

        {phase === "steps" && !step && (
          <div className="steam-center">
            <PsnIcon size={40} />
            <h3>Rien à importer</h3>
            <p>
              Aucun jeu trouvé. Vérifie que tes trophées ne sont pas masqués dans
              la confidentialité de ton compte PlayStation, puis réessaie.
            </p>
            <button className="btn-psn-primary clickable" onClick={onClose}>
              Fermer
            </button>
          </div>
        )}

        {phase === "importing" && (
          <div className="steam-center">
            <div className="steam-import-spinner psn-spinner">
              <Loader2 size={44} className="spin" />
            </div>
            <h3>Import en cours…</h3>
            <p>On ajoute tes jeux et on récupère tes trophées.</p>
          </div>
        )}

        {phase === "done" && <DoneScreen result={result} onClose={onClose} />}

        {phase === "steps" && step && (
          <div className="steam-modal-foot">
            <button
              type="button"
              className="steam-switch clickable"
              role="switch"
              aria-checked={importTrophies}
              onClick={() => setImportTrophies((v) => !v)}
            >
              <span className={`steam-switch-track psn ${importTrophies ? "on" : ""}`}>
                <span className="steam-switch-thumb" />
              </span>
              <span className="steam-switch-label">
                <Trophy size={15} /> Importer les trophées des jeux joués
              </span>
            </button>
            <div className="steam-foot-actions">
              {stepIdx > 0 && (
                <button className="btn-ghost clickable" onClick={prev}>
                  Retour
                </button>
              )}
              <button className="btn-psn-primary clickable" onClick={next}>
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
      <div className="steam-scan-orbit psn-orbit">
        <PsnIcon size={40} />
      </div>
      <h3>Connexion à PlayStation…</h3>
      <p>On récupère ta bibliothèque et tes trophées, et on les relie à MyPlayLog.</p>
    </div>
  );
}

function StepScreen({ step, games, items, setItem, setAll, token }) {
  const includedCount = games.filter((g) => items[g.id]?.include).length;
  const allIncluded = includedCount === games.length;
  const intro = {
    played: (
      <>
        Ces {games.length} jeux, tu y as <strong>déjà joué</strong> sur PlayStation.
        Choisis leur statut — on a déjà deviné pour toi.
      </>
    ),
    update: (
      <>
        Ces {games.length} jeux sont <strong>déjà chez toi</strong>. On récupère
        leurs trophées et on met tes heures à jour quand PSN en sait plus.
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
            key={g.id}
            g={g}
            it={items[g.id]}
            setItem={setItem}
            step={step.key}
            index={i}
            token={token}
          />
        ))}
      </div>
    </div>
  );
}

function GameCard({ g, it, setItem, step, index, token }) {
  const included = it?.include;
  const [changing, setChanging] = useState(false);
  const toggle = () => setItem(g.id, { include: !included });
  const stop = (e) => e.stopPropagation();

  // Jeu détecté, éventuellement corrigé à la main via « Changer ».
  const override = it?.override;
  const cover = override?.cover ?? g.cover;
  const name = override?.name ?? g.name;
  // Consoles proposées : celles du jeu corrigé si override, sinon du jeu détecté.
  const consoles = override ? override.consoles : g.consoles;
  const consoleVal = override ? override.console : it?.console;
  function setConsole(nm) {
    if (override) setItem(g.id, { override: { ...override, console: nm } });
    else setItem(g.id, { console: nm });
  }

  function pickOverride(game) {
    const cons = psConsolesFromPlatforms(game.platforms);
    setItem(g.id, {
      override: {
        gameId: game.id,
        name: game.name,
        cover: game.cover,
        consoles: cons,
        console: cons[0]?.name || null,
      },
    });
    setChanging(false);
  }
  function resetOverride() {
    setItem(g.id, { override: null });
    setChanging(false);
  }

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

      <div className="steam-game-coverwrap">
        <div className="steam-game-cover">
          {cover ? (
            <img src={cover} alt="" loading="lazy" />
          ) : (
            <div className="steam-game-noart">
              <PsnIcon size={20} />
            </div>
          )}
        </div>
        <button
          type="button"
          className={`steam-change-btn clickable ${changing ? "active" : ""}`}
          onClick={(e) => {
            stop(e);
            setChanging((v) => !v);
          }}
          title="Ce n'est pas le bon jeu ? Le changer"
        >
          <RefreshCw size={11} /> Changer
        </button>
      </div>

      <div className="steam-game-body">
        <div className="steam-game-name">{name}</div>
        <div className="steam-game-meta">
          {step === "update" ? (
            <div className="steam-tag gold">
              <RefreshCw size={12} /> {STATUS_LABEL[g.currentStatus] || "Déjà présent"}
            </div>
          ) : g.playtimeHours > 0 ? (
            <span>{fmtHours(g.playtimeHours)} de jeu</span>
          ) : (
            <span className="steam-never">temps de jeu inconnu</span>
          )}
        </div>

        {g.definedTrophies > 0 && (
          <div className="psn-trophy-tag">
            <Trophy size={12} />
            {g.trophyProgress != null ? `${g.trophyProgress}%` : "trophées"}
            {g.hasPlatinum && <span className="psn-plat" title="Platine disponible" />}
          </div>
        )}

        {step === "played" && consoles?.length > 0 && (
          <ConsolePicker options={consoles} value={consoleVal} onChange={setConsole} />
        )}

        {step === "played" && (
          <div className="steam-status-pick" onClick={stop}>
            {PLAYED_STATUSES.map(({ key, label, Icon }) => (
              <button
                key={key}
                className={`steam-status-btn clickable ${it?.status === key ? "active" : ""}`}
                onClick={() => setItem(g.id, { status: key })}
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
              onClick={() => setItem(g.id, { updateHours: !it?.updateHours })}
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
                  setItem(g.id, {
                    hours: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <span className="steam-hours-unit">h</span>
            </span>
          </div>
        )}

        {changing && (
          <div className="steam-change-search" onClick={stop}>
            <GameSearchPicker query={g.psnName || name} token={token} onPick={pickOverride} />
            {override && (
              <button className="steam-change-reset clickable" onClick={resetOverride}>
                Remettre le jeu détecté
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Recherche IGDB réutilisable (débounce) : boîte de recherche + résultats.
// `onPick(game)` reçoit { id, name, cover, year, platforms }. Utilisée pour lier
// un jeu non reconnu et pour corriger un jeu mal détecté.
export function GameSearchPicker({ query, token, onPick }) {
  const [q, setQ] = useState(query || "");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const d = await apiFetch(`/games?search=${encodeURIComponent(term)}&limit=8`, {
          token,
        });
        if (alive) setResults(d.games || []);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, token]);

  return (
    <div className="psn-unmatched-search">
      <div className="psn-search-box">
        <Search size={15} />
        <input
          type="text"
          placeholder="Chercher le bon jeu…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {searching && <Loader2 size={14} className="spin" />}
      </div>
      {results && (
        <div className="psn-search-results">
          {results.length === 0 ? (
            <div className="psn-search-empty">Aucun résultat</div>
          ) : (
            results.map((game) => (
              <button
                key={game.id}
                className="psn-search-result clickable"
                onClick={() => onPick(game)}
              >
                {game.cover ? (
                  <img src={game.cover} alt="" loading="lazy" />
                ) : (
                  <div className="psn-search-noart">
                    <Gamepad2 size={14} />
                  </div>
                )}
                <span className="psn-search-result-name">
                  {game.name}
                  {game.year && <em> ({game.year})</em>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Étape « À reconnaître » : liste des jeux PSN non matchés, chacun à lier à un
// vrai jeu IGDB à la main. Un jeu non lié est simplement ignoré à l'import ; la
// croix retire complètement un jeu (ex: appli Dailymotion prise pour un jeu).
function UnmatchedScreen({ step, games, resolved, setResolved, dismissed, onDismiss, token }) {
  const visible = games.filter((g) => !dismissed[g.id]);
  const doneCount = visible.filter((g) => resolved[g.id]?.gameId).length;
  return (
    <div className="steam-step">
      <div className="steam-step-title">
        <h3>{step.title}</h3>
        <span className="steam-step-count">{visible.length}</span>
        {doneCount > 0 && (
          <span className="psn-unmatched-done">
            {doneCount} lié{doneCount > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <p className="steam-step-intro">
        On n'a pas reconnu automatiquement ces jeux. Associe chacun au bon jeu pour
        l'importer (avec son temps de jeu et ses trophées). Ignore avec la croix ceux
        qui ne sont pas des jeux, ou laisse-les vides pour les <strong>sauter</strong>.
      </p>

      {visible.length === 0 ? (
        <div className="psn-unmatched-empty">
          <Check size={18} /> Rien à reconnaître ici.
        </div>
      ) : (
        <div className="psn-unmatched-list">
          {visible.map((g) => (
            <UnmatchedCard
              key={g.id}
              g={g}
              r={resolved[g.id]}
              setResolved={setResolved}
              onDismiss={onDismiss}
              token={token}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UnmatchedCard({ g, r, setResolved, onDismiss, token }) {
  const clean = (g.psnName || "").replace(/[™®©℠]/g, "").trim();

  function pick(game) {
    const suggested =
      (g.trophyProgress ?? 0) >= 100 || (g.playtimeHours || 0) >= 30
        ? "finished"
        : "paused";
    const cons = psConsolesFromPlatforms(game.platforms);
    setResolved((m) => ({
      ...m,
      [g.id]: {
        gameId: game.id,
        name: game.name,
        cover: game.cover,
        status: suggested,
        consoles: cons,
        console: cons[0]?.name || null,
      },
    }));
  }
  function setStatus(status) {
    setResolved((m) => ({ ...m, [g.id]: { ...m[g.id], status } }));
  }
  function setConsole(nm) {
    setResolved((m) => ({ ...m, [g.id]: { ...m[g.id], console: nm } }));
  }
  function unlink() {
    setResolved((m) => {
      const n = { ...m };
      delete n[g.id];
      return n;
    });
  }

  const linked = !!r?.gameId;

  return (
    <div className={`psn-unmatched-card ${linked ? "linked" : ""}`}>
      <button
        className="psn-unmatched-dismiss clickable"
        onClick={() => onDismiss(g.id)}
        title="Ignorer ce jeu"
      >
        <X size={14} />
      </button>

      <div className="psn-unmatched-head">
        <div className="steam-game-cover psn-unmatched-icon">
          {g.icon ? <img src={g.icon} alt="" loading="lazy" /> : <PsnIcon size={18} />}
        </div>
        <div className="psn-unmatched-info">
          <div className="steam-game-name">{g.psnName}</div>
          <div className="steam-game-meta">
            {g.playtimeHours > 0 && <span>{fmtHours(g.playtimeHours)} de jeu</span>}
            {g.definedTrophies > 0 && (
              <span className="psn-unmatched-trophy">
                <Trophy size={12} />
                {g.trophyProgress != null ? `${g.trophyProgress}%` : "trophées"}
              </span>
            )}
          </div>
        </div>
      </div>

      {linked ? (
        <div className="psn-resolved">
          <div className="psn-resolved-game">
            {r.cover ? (
              <img src={r.cover} alt="" />
            ) : (
              <div className="psn-resolved-noart">
                <Gamepad2 size={16} />
              </div>
            )}
            <span className="psn-resolved-name">{r.name}</span>
            <button className="psn-relink clickable" onClick={unlink} title="Changer de jeu">
              <RefreshCw size={13} /> Changer
            </button>
          </div>
          <div className="steam-status-pick">
            {PLAYED_STATUSES.map(({ key, label, Icon }) => (
              <button
                key={key}
                className={`steam-status-btn clickable ${r.status === key ? "active" : ""}`}
                onClick={() => setStatus(key)}
                title={label}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          {r.consoles?.length > 0 && (
            <ConsolePicker options={r.consoles} value={r.console} onChange={setConsole} />
          )}
        </div>
      ) : (
        <GameSearchPicker query={clean} token={token} onPick={pick} />
      )}
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
          <span>jeux à trophées</span>
        </div>
      </div>
      <p>Retrouve tes trophées dans l'onglet « Succès » de ton profil.</p>
      <button className="btn-psn-primary clickable" onClick={onClose}>
        Génial <Check size={16} />
      </button>
    </div>
  );
}
