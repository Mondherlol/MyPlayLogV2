import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Gamepad2, ShieldAlert } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import ThemeToggle from "../components/ThemeToggle";

export default function ResetPassword() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      // Connecté automatiquement → direction l'app.
      navigate("/app");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page center-screen">
      <div className="auth-topbar">
        <Link to="/" className="brand clickable">
          <span className="brand-logo">
            <Gamepad2 size={20} strokeWidth={2.5} />
          </span>
          <span className="brand-name">
            My<span className="grad-text">PlayLog</span>
          </span>
        </Link>
        <ThemeToggle />
      </div>

      <div className="auth-card card">
        {!token ? (
          <div className="auth-done">
            <div className="auth-done-icon danger">
              <ShieldAlert size={30} strokeWidth={2} />
            </div>
            <h1 className="auth-title">Lien invalide</h1>
            <p className="auth-sub">
              Ce lien de réinitialisation est incomplet ou a expiré. Refais une
              demande depuis la page de connexion.
            </p>
            <Link to="/forgot-password" className="btn btn-primary btn-block">
              Refaire une demande
            </Link>
          </div>
        ) : (
          <>
            <h1 className="auth-title">Nouveau mot de passe</h1>
            <p className="auth-sub">
              Choisis un nouveau mot de passe pour ton compte.
            </p>

            {error && <div className="alert alert-error">{error}</div>}

            <form onSubmit={onSubmit}>
              <div className="field">
                <label htmlFor="password">Nouveau mot de passe</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="confirm">Confirme le mot de passe</label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>

              <button
                className="btn btn-primary btn-block"
                type="submit"
                disabled={busy}
              >
                {busy ? "Enregistrement…" : "Réinitialiser mon mot de passe"}
              </button>
            </form>

            <p className="auth-switch">
              <Link to="/login" className="link-accent clickable">
                Retour à la connexion
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
