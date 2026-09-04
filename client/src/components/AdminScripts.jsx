import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  Play,
  Terminal,
  FlaskConical,
} from "lucide-react";
import { apiFetch } from "../lib/api";

// ======================================================================
//  Onglet Scripts — les opérations de maintenance, sans passer par le SSH
// ======================================================================
// Les scripts sont déclarés côté serveur (server/src/lib/adminScripts.js) :
// cette page ne fait que les lister et les lancer. Chaque carte propose
// « Simuler » (aucune écriture, on voit ce qui serait touché) puis « Lancer ».

export default function ScriptsPanel({ token }) {
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // clé du script en cours
  const [results, setResults] = useState({}); // key -> { summary, log, dryRun } | { error }

  useEffect(() => {
    setLoading(true);
    apiFetch("/admin/scripts", { token })
      .then((d) => setScripts(d?.scripts || []))
      .catch(() => setScripts([]))
      .finally(() => setLoading(false));
  }, [token]);

  async function run(script, dryRun) {
    // Un script destructeur se confirme : la simulation, elle, part sans rien
    // demander puisqu'elle n'écrit rien.
    if (!dryRun && script.danger) {
      const ok = window.confirm(
        `Lancer « ${script.label} » pour de vrai ?\n\nL'opération modifie la base et n'est pas annulable.`
      );
      if (!ok) return;
    }
    setBusy(script.key);
    setResults((r) => ({ ...r, [script.key]: null }));
    try {
      const d = await apiFetch(`/admin/scripts/${script.key}/run`, {
        method: "POST",
        token,
        body: { dryRun },
      });
      setResults((r) => ({ ...r, [script.key]: d }));
    } catch (e) {
      setResults((r) => ({ ...r, [script.key]: { error: e.message } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <span className="admin-card-icon">
          <Terminal size={18} />
        </span>
        <div className="admin-card-titles">
          <h2>Scripts</h2>
          <p>
            Les opérations de maintenance ponctuelles, lançables d'ici plutôt
            qu'en SSH. « Simuler » n'écrit rien : il montre ce que le script
            toucherait.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="gp-troph-state">
          <Loader2 size={18} className="spin" /> Chargement…
        </div>
      ) : !scripts.length ? (
        <p className="pn-admin-empty">Aucun script déclaré.</p>
      ) : (
        <div className="adm-scr-list">
          {scripts.map((s) => {
            const res = results[s.key];
            const running = busy === s.key;
            return (
              <div className="adm-scr-card" key={s.key}>
                <div className="adm-scr-main">
                  <strong>
                    {s.label}
                    {s.danger && (
                      <span className="adm-scr-tag" title="Modifie la base">
                        <AlertTriangle size={11} /> destructeur
                      </span>
                    )}
                  </strong>
                  <code className="adm-scr-key">{s.key}</code>
                  <p>{s.description}</p>
                </div>

                <div className="adm-scr-actions">
                  <button
                    className="btn sm"
                    onClick={() => run(s, true)}
                    disabled={!!busy}
                  >
                    {running ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <FlaskConical size={14} />
                    )}
                    Simuler
                  </button>
                  <button
                    className={`btn sm ${s.danger ? "btn-danger" : "btn-primary"}`}
                    onClick={() => run(s, false)}
                    disabled={!!busy}
                  >
                    {running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                    Lancer
                  </button>
                </div>

                {res?.error && (
                  <p className="psn-err">
                    <AlertTriangle size={14} /> {res.error}
                  </p>
                )}
                {res && !res.error && (
                  <>
                    <p className={res.dryRun ? "admin-hint" : "admin-ok"}>
                      {res.dryRun ? <FlaskConical size={14} /> : <Check size={14} />}{" "}
                      {res.summary} <span className="adm-scr-ms">({res.ms} ms)</span>
                    </p>
                    {res.log?.length > 0 && (
                      <pre className="adm-ev-log">{res.log.join("\n")}</pre>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
