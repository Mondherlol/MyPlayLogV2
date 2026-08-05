import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { apiFetch } from "../lib/api";

// ======================================================================
//  Onglet Événements — synchro des listes officielles de conférences
// ======================================================================
// Les listes (Nintendo Direct, Summer Game Fest…) viennent de l'endpoint
// `events` d'IGDB. Ce bouton fait exactement ce que fait `npm run sync:events`
// côté serveur : après une conférence, on relance d'ici plutôt qu'en SSH.

const fmtDate = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default function EventsPanel({ token }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { summary, log } | { error }
  const [since, setSince] = useState(`${new Date().getFullYear()}-01-01`);

  function load() {
    setLoading(true);
    apiFetch("/admin/events", { token })
      .then(setState)
      .catch(() => setState(null))
      .finally(() => setLoading(false));
  }
  useEffect(load, [token]);

  async function sync() {
    setBusy(true);
    setResult(null);
    try {
      const d = await apiFetch("/admin/events/sync", {
        method: "POST",
        token,
        body: { since },
      });
      setResult(d);
      load();
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setBusy(false);
    }
  }

  const s = result?.summary;

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <span className="admin-card-icon">
          <CalendarDays size={18} />
        </span>
        <div className="admin-card-titles">
          <h2>Listes d'événements</h2>
          <p>
            Une liste officielle par conférence (Nintendo Direct, State of Play,
            Summer Game Fest…), avec les jeux montrés et la rediffusion. Source :
            l'endpoint <code>events</code> d'IGDB. À relancer après chaque
            conférence — les listes existantes sont mises à jour sur place, les
            likes et commentaires sont conservés.
          </p>
        </div>
        {!loading && state && (
          <span className="psn-status on">
            {state.count} liste{state.count > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="admin-field">
        <label>
          <RefreshCw size={14} /> Depuis quelle date chercher les événements
        </label>
        <div className="admin-field-row">
          <input
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            disabled={busy}
          />
          <button className="btn btn-primary sm" onClick={sync} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            {busy ? "Synchro en cours…" : "Lancer la synchro"}
          </button>
        </div>
        <p className="admin-hint">
          Une trentaine d'appels à IGDB : compte une poignée de secondes. Ne
          ferme pas l'onglet pendant l'opération.
        </p>
      </div>

      {result?.error && (
        <p className="psn-err">
          <AlertTriangle size={14} /> {result.error}
        </p>
      )}

      {s && (
        <>
          <p className="admin-ok">
            <Check size={14} /> {s.kept} événement{s.kept > 1 ? "s" : ""} retenu
            {s.kept > 1 ? "s" : ""} sur {s.scanned} — {s.created} créée
            {s.created > 1 ? "s" : ""}, {s.updated} mise{s.updated > 1 ? "s" : ""} à
            jour, {s.skipped} inchangée{s.skipped > 1 ? "s" : ""}
            {s.failed ? `, ${s.failed} en échec` : ""}.
          </p>
          {result.log?.length > 0 && (
            <pre className="adm-ev-log">{result.log.join("\n")}</pre>
          )}
        </>
      )}

      {loading ? (
        <div className="gp-troph-state">
          <Loader2 size={18} className="spin" /> Chargement…
        </div>
      ) : !state?.count ? (
        <p className="pn-admin-empty">
          Aucune liste d'événement pour l'instant — lance une première synchro.
        </p>
      ) : (
        <div className="adm-ev-list">
          {state.latest.map((l) => (
            <div className="adm-ev-row" key={l.title}>
              <div className="adm-ev-main">
                <strong>{l.title}</strong>
                <span>
                  {l.startTime ? fmtDate.format(new Date(l.startTime)) : "date inconnue"} ·{" "}
                  {l.items} jeux
                </span>
              </div>
            </div>
          ))}
          <Link to="/lists?sc=events" className="admin-drawer-profile clickable">
            <ExternalLink size={13} /> Voir l'onglet Événements ({state.count} listes,{" "}
            {state.gameCount} jeux)
          </Link>
        </div>
      )}
    </section>
  );
}
