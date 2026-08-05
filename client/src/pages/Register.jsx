import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Gamepad2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import ThemeToggle from "../components/ThemeToggle";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 3) {
      setError("Le mot de passe doit faire au moins 3 caractères.");
      return;
    }
    setBusy(true);
    try {
      await register(email, username, password);
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
        <h1 className="auth-title">Rejoins l'aventure</h1>
        <p className="auth-sub">Trois champs, et c'est parti.</p>

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

          <div className="field">
            <label htmlFor="username">Identifiant</label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              placeholder="ton_pseudo"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="min. 3 caractères"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={busy}
          >
            {busy ? "Création…" : "Créer mon compte"}
          </button>
        </form>

        <p className="auth-switch">
          Déjà inscrit ?{" "}
          <Link to="/login" className="link-accent clickable">
            Connecte-toi
          </Link>
        </p>
      </div>
    </div>
  );
}
