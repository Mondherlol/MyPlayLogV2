import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import PatchnotePopup from "./PatchnotePopup";
import MiniPlayer from "./MiniPlayer";
import { PlayerProvider } from "../context/PlayerContext";

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("mpl_sidebar") === "collapsed"
  );

  function toggle() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("mpl_sidebar", next ? "collapsed" : "expanded");
      return next;
    });
  }

  return (
    <PlayerProvider>
      <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        <div className="app-main">
          <Topbar />
          <main className="app-content">
            <Outlet />
          </main>
        </div>
        <PatchnotePopup />
        <MiniPlayer />
      </div>
    </PlayerProvider>
  );
}
