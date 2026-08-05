import { Link, useNavigate } from "react-router-dom";
import { Gamepad2, LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import ThemeToggle from "./ThemeToggle";

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="brand clickable">
          <span className="brand-logo">
            <Gamepad2 size={20} strokeWidth={2.5} />
          </span>
          <span className="brand-name">
            My<span className="grad-text">PlayLog</span>
          </span>
        </Link>

        <nav className="nav-actions">
          <ThemeToggle />
          {user ? (
            <>
              <Link to="/app" className="btn btn-ghost">
                {user.username}
              </Link>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  logout();
                  navigate("/");
                }}
              >
                <LogOut size={16} /> Déconnexion
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost">
                Connexion
              </Link>
              <Link to="/register" className="btn btn-primary">
                S'inscrire
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
