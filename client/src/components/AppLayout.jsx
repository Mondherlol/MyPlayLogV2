import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import PatchnotePopup from "./PatchnotePopup";
import MiniPlayer from "./MiniPlayer";
import ChatDock from "./ChatDock";

export default function AppLayout({ children }) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("mpl_sidebar") === "collapsed"
  );
  // Repli DEMANDÉ par une page immersive (GeoGamer), distinct du repli choisi
  // par l'utilisateur : on ne touche pas à sa préférence en localStorage, elle
  // reprend la main dès qu'il quitte la page.
  const [forced, setForced] = useState(false);

  useEffect(() => {
    const onForce = (e) => setForced(!!e.detail);
    window.addEventListener("mpl:sidebar-force", onForce);
    return () => window.removeEventListener("mpl:sidebar-force", onForce);
  }, []);

  function toggle() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("mpl_sidebar", next ? "collapsed" : "expanded");
      return next;
    });
  }

  const shown = collapsed || forced;

  return (
    <div className={`app-shell ${shown ? "is-collapsed" : ""}`}>
      <Sidebar collapsed={shown} onToggle={toggle} />
      <div className="app-main">
        <Topbar />
        <main className="app-content">
          {children || <Outlet />}
        </main>
      </div>
      <PatchnotePopup />
      <MiniPlayer />
      {/* Fenêtres de discussion flottantes : disponibles sur toutes les pages
          de l'espace connecté. */}
      <ChatDock />
    </div>
  );
}
