import { useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import {
  Gamepad2,
  Home,
  Compass,
  CalendarDays,
  List,
  User,
  Palmtree,
  Shield,
  Joystick,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Check,
  ChevronUp,
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { useClickOutside } from "../hooks/useClickOutside";

// Version courante de l'app (affichée en bas de la sidebar).
const APP_VERSION = "1.1";

const NAV = [
  { to: "/app", label: "Accueil", Icon: Home, end: true },
  { to: "/explore", label: "Explorer", Icon: Compass },
  { to: "/releases", label: "Sorties", Icon: CalendarDays },
  { to: "/lists", label: "Listes", Icon: List },
  { to: "/arcade", label: "Arcade", Icon: Joystick, adminOnly: true },
  { to: "/profile", label: "Profil", Icon: User },
  { to: "/admin", label: "Admin", Icon: Shield, adminOnly: true },
];

// Petit drapeau FR en CSS (net, pas d'emoji)
function FlagFR() {
  return <span className="flag flag-fr" aria-hidden="true" />;
}

export default function Sidebar({ collapsed, onToggle }) {
  const { theme, toggle } = useTheme();
  const { user } = useAuth();
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef(null);
  useClickOutside(langRef, () => setLangOpen(false), langOpen);

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      {/* Flèche flottante qui dépasse du bord droit */}
      <button
        className="side-toggle clickable"
        onClick={onToggle}
        title={collapsed ? "Déplier" : "Replier"}
        aria-label={collapsed ? "Déplier la barre" : "Replier la barre"}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      <div className="sidebar-head">
        <Link to="/app" className="brand side-brand clickable" title="MyPlayLog">
          <span className="brand-logo">
            <Gamepad2 size={20} strokeWidth={2.5} />
          </span>
          <span className="brand-name side-label">
            My<span className="grad-text">PlayLog</span>
          </span>
        </Link>
      </div>

      <nav className="side-nav">
        {NAV.filter((n) => !n.adminOnly || user?.isAdmin).map(({ to, label, Icon, end, adminOnly }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `side-row clickable ${isActive ? "active" : ""} ${
                adminOnly ? "side-row-admin" : ""
              }`
            }
            title={label}
          >
            <span className="side-icon">
              <Icon size={20} strokeWidth={2} />
            </span>
            <span className="side-label">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="side-bottom">
        <button
          className="side-row clickable"
          onClick={toggle}
          title={theme === "light" ? "Thème sombre" : "Thème clair"}
        >
          <span className="side-icon">
            {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
          </span>
          <span className="side-label">
            {theme === "light" ? "Thème sombre" : "Thème clair"}
          </span>
        </button>

        <div className="lang-wrap" ref={langRef}>
          {langOpen && (
            <div className="lang-menu card">
              <button className="lang-item active clickable">
                <FlagFR /> Français <Check size={15} className="lang-check" />
              </button>
              <button className="lang-item disabled" disabled>
                <span className="flag flag-en" aria-hidden="true" /> English
                <span className="soon-pill">bientôt</span>
              </button>
            </div>
          )}
          <button
            className="side-row clickable"
            onClick={() => setLangOpen((v) => !v)}
            title="Langue"
          >
            <span className="side-icon">
              <FlagFR />
            </span>
            <span className="side-label">Français</span>
            <ChevronUp size={15} className="side-label lang-caret" />
          </button>
        </div>

        <div className="side-version" title={`Version ${APP_VERSION}`}>
          v{APP_VERSION}
        </div>
      </div>
    </aside>
  );
}
