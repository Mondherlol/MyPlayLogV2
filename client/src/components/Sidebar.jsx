import { useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import {
  Gamepad2,
  Home,
  Compass,
  CalendarDays,
  MessagesSquare,
  List,
  Joystick,
  User,
  Palmtree,
  Shield,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Palette,
  Check,
  ChevronUp,
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useCosmetics } from "../context/CosmeticsContext";
import { useClickOutside } from "../hooks/useClickOutside";

// Version courante de l'app (affichée en bas de la sidebar).
const APP_VERSION = "1.1";

const NAV = [
  { to: "/app", label: "Accueil", Icon: Home, end: true },
  { to: "/explore", label: "Explorer", Icon: Compass },
  { to: "/releases", label: "Sorties", Icon: CalendarDays },
  // `badge` : la pastille de non-lus vient du contexte de messagerie.
  { to: "/messages", label: "Messages", Icon: MessagesSquare, badge: "chat" },
  { to: "/lists", label: "Listes", Icon: List },
  { to: "/arcade", label: "Arcade", Icon: Joystick },
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
  const { unread } = useChat();
  const { cosmetics } = useCosmetics();
  const arcadeTheme = cosmetics?.theme || null;
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
        {NAV.filter((n) => !n.adminOnly || user?.isAdmin).map(
          ({ to, label, Icon, end, adminOnly, badge }) => {
            const count = badge === "chat" ? unread : 0;
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `side-row clickable ${isActive ? "active" : ""} ${
                    adminOnly ? "side-row-admin" : ""
                  } ${badge === "chat" ? "side-row-chat" : ""}`
                }
                title={label}
              >
                <span className="side-icon">
                  <Icon size={20} strokeWidth={2} />
                  {/* Replié, la pastille se colle à l'icône : c'est tout ce qui
                      reste de visible. */}
                  {count > 0 && (
                    <span className="side-dot">{count > 9 ? "9+" : count}</span>
                  )}
                </span>
                <span className="side-label">{label}</span>
              </NavLink>
            );
          }
        )}
      </nav>

      <div className="side-bottom">
        {/* Un thème de l'arcade impose son mode clair/sombre : on remplace alors
            le bouton de bascule par un raccourci vers l'arcade (où on le change
            ou le retire). Sinon, la bascule clair/sombre habituelle. */}
        {arcadeTheme ? (
          <NavLink
            to="/arcade"
            className="side-row clickable"
            title={`Thème « ${arcadeTheme.name || "Arcade"} » équipé`}
          >
            <span className="side-icon">
              <Palette size={20} />
            </span>
            <span className="side-label">{arcadeTheme.name || "Thème équipé"}</span>
          </NavLink>
        ) : (
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
        )}

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
