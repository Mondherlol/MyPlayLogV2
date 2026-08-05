import { useState } from "react";
import { Link } from "react-router-dom";
import { Gamepad2, ArrowLeft, MailCheck, AlertTriangle } from "lucide-react";
import { apiFetch } from "../lib/api";
import ThemeToggle from "../components/ThemeToggle";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await apiFetch("/auth/forgot-password", {
        method: "POST",
        body: { email },
      });
      setSent(true);
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
        {sent ? (
          <div className="auth-done">
            <div className="auth-done-icon">
              <MailCheck size={30} strokeWidth={2} />
            </div>
            <h1 className="auth-title">Vérifie tes mails</h1>
            <p className="auth-sub">
              Si un compte existe avec <strong>{email}</strong>, tu vas recevoir
              un lien pour réinitialiser ton mot de passe.
            </p>
            <div className="auth-hint">
              <AlertTriangle size={18} />
              <span>
                Pense à vérifier tes <strong>spams</strong> / courriers
                indésirables : l'email peut s'y glisser.
              </span>
            </div>
            <Link to="/login" className="btn btn-primary btn-block">
              Retour à la connexion
            </Link>
          </div>
        ) : (
          <>
            <h1 className="auth-title">Mot de passe oublié&nbsp;?</h1>
            <p className="auth-sub">
              Entre ton email : on t'envoie un lien pour en choisir un nouveau.
            </p>

            {error && <div className="alert alert-error">{error}</div>}

            <form onSubmit={onSubmit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="toi@mail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <button
                className="btn btn-primary btn-block"
                type="submit"
                disabled={busy}
              >
                {busy ? "Envoi…" : "Envoyer le lien"}
              </button>
            </form>

            <p className="auth-switch">
              <Link to="/login" className="link-accent clickable auth-back">
                <ArrowLeft size={15} /> Retour à la connexion
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
