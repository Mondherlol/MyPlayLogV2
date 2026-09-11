import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AuthShell from "../components/AuthShell";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  // `?next=` : où retourner une fois connecté. Un lien partagé (une séance
  // d'écoute, un profil) qui traverse l'écran de connexion doit revenir à ce
  // qu'on était venu voir — atterrir sur l'accueil, c'est perdre l'invitation.
  // Chemin interne uniquement : un `next` libre ferait de la page de connexion
  // un tremplin vers n'importe quel site.
  const [params] = useSearchParams();
  const raw = params.get("next") || "";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/app";
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(identifier, password, remember);
      navigate(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell aside={"Ta bibliothèque, tes heures, tes notes — tout est resté là où tu l'as laissé."}>
        <h1 className="auth-title">Content de te revoir</h1>
        <p className="auth-sub">Connecte-toi pour retrouver ta bibliothèque.</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="identifier">Identifiant ou email</label>
            <input
              id="identifier"
              type="text"
              autoComplete="username"
              placeholder="ton_pseudo ou toi@mail.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="auth-row">
            <label className="remember clickable">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>Se souvenir de moi</span>
            </label>
            <Link to="/forgot-password" className="link-accent clickable">
              Mot de passe oublié ?
            </Link>
          </div>

          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={busy}
          >
            {busy ? "Connexion…" : "Se connecter"}
          </button>
        </form>

        <p className="auth-switch">
          Pas encore de compte ?{" "}
          <Link to="/register" className="link-accent clickable">
            Crée-le en 30 secondes
          </Link>
        </p>
    </AuthShell>
  );
}
