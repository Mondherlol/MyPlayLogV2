import { useEffect, useState } from "react";
import { Shield, Trophy, Check, Loader2, ExternalLink, Link2Off } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function Admin() {
  const { token, updateUser } = useAuth();
  return (
    <div className="admin-page">
      <header className="admin-head">
        <span className="admin-head-icon">
          <Shield size={22} />
        </span>
        <div>
          <h1>Admin</h1>
          <p>Réglages avancés de ton compte.</p>
        </div>
      </header>

      <PsnManager token={token} updateUser={updateUser} />
    </div>
  );
}

function PsnManager({ token, updateUser }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ connected: false });
  const [npsso, setNpsso] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function load() {
    setLoading(true);
    apiFetch("/users/me/psn", { token })
      .then(setStatus)
      .catch(() => setStatus({ connected: false }))
      .finally(() => setLoading(false));
  }
  useEffect(load, [token]);

  async function connect() {
    const val = npsso.trim();
    if (!val || busy) return;
    setBusy(true);
    setErr(null);
    try {
      // Certains collent le JSON entier {"npsso":"..."} → on extrait la valeur.
      const m = val.match(/"npsso"\s*:\s*"([^"]+)"/);
      await apiFetch("/users/me/psn", {
        method: "POST",
        token,
        body: { npsso: m ? m[1] : val },
      });
      setNpsso("");
      updateUser?.({ psnConnected: true });
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("Déconnecter ton compte PSN ?")) return;
    try {
      await apiFetch("/users/me/psn", { method: "DELETE", token });
      updateUser?.({ psnConnected: false });
      setStatus({ connected: false });
    } catch (e) {
      alert(e.message);
    }
  }

  const state = status.connected ? "on" : status.expired ? "warn" : "off";

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <span className="admin-card-icon">
          <Trophy size={18} />
        </span>
        <div className="admin-card-titles">
          <h2>Gestion du PSN</h2>
          <p>
            Le compte PlayStation connecté ici sert de <strong>source des trophées</strong> :
            la liste des trophées à débloquer devient visible par tous les utilisateurs sur
            les pages de jeux.
          </p>
        </div>
        {!loading && status.isAdmin && (
          <span className={`psn-status ${state}`}>
            {status.connected ? "Connecté" : status.expired ? "Session expirée" : "Non connecté"}
          </span>
        )}
      </div>

      {loading ? (
        <div className="gp-troph-state">
          <Loader2 size={18} className="spin" /> Chargement…
        </div>
      ) : !status.isAdmin ? (
        <p className="psn-err">
          Section réservée à l'administrateur (défini par <code>ADMIN_EMAIL</code> côté serveur).
        </p>
      ) : status.connected ? (
        <div className="psn-connected-row">
          <p>
            Ton compte PSN est connecté
            {status.connectedAt
              ? ` depuis le ${new Date(status.connectedAt).toLocaleDateString("fr-FR")}`
              : ""}
            .
          </p>
          <button className="btn btn-ghost" onClick={disconnect}>
            <Link2Off size={16} /> Déconnecter
          </button>
        </div>
      ) : (
        <>
          {status.expired && (
            <p className="psn-err">
              Ta session PSN a expiré — colle un nouveau NPSSO pour te reconnecter.
            </p>
          )}
          <ol className="psn-steps">
            <li>
              Connecte-toi sur{" "}
              <a href="https://www.playstation.com" target="_blank" rel="noreferrer">
                playstation.com <ExternalLink size={12} />
              </a>
            </li>
            <li>
              Dans le même navigateur, ouvre{" "}
              <a
                href="https://ca.account.sony.com/api/v1/ssocookie"
                target="_blank"
                rel="noreferrer"
              >
                ce lien <ExternalLink size={12} />
              </a>
            </li>
            <li>
              Copie la valeur de <code>npsso</code> et colle-la ci-dessous
            </li>
          </ol>
          <div className="psn-connect-form">
            <input
              type="password"
              placeholder="Ton token NPSSO…"
              value={npsso}
              onChange={(e) => setNpsso(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect()}
            />
            <button
              className="btn btn-primary"
              onClick={connect}
              disabled={busy || !npsso.trim()}
            >
              {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Connecter
            </button>
          </div>
          {err && <p className="psn-err">{err}</p>}
        </>
      )}
    </section>
  );
}
