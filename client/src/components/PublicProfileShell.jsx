import { Link } from "react-router-dom";
import { Gamepad2, ArrowRight } from "lucide-react";
import Navbar from "./Navbar";
import MiniPlayer from "./MiniPlayer";
import { PlayerProvider } from "../context/PlayerContext";

// Coquille publique pour un profil partagé consulté SANS être connecté.
// Pas de sidebar/topbar de l'app (réservés aux membres) : un simple bandeau
// avec le logo + les boutons Connexion / Inscription, et un appel à l'action
// discret en bas pour inviter le visiteur à créer son propre journal.
export default function PublicProfileShell({ children }) {
  return (
    <PlayerProvider>
      <div className="public-shell">
        <Navbar />
        <main className="public-main">{children}</main>

        <footer className="public-cta">
          <div className="public-cta-inner">
            <span className="public-cta-logo">
              <Gamepad2 size={22} strokeWidth={2.5} />
            </span>
            <div className="public-cta-text">
              <strong>
                Toi aussi, garde une trace de tes jeux sur My
                <span className="grad-text">PlayLog</span>
              </strong>
              <span>Track, note et partage tes parties. C'est gratuit.</span>
            </div>
            <Link to="/register" className="btn btn-primary public-cta-btn">
              Créer mon journal <ArrowRight size={16} />
            </Link>
          </div>
        </footer>

        <MiniPlayer />
      </div>
    </PlayerProvider>
  );
}
