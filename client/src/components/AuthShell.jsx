import { Link } from "react-router-dom";
import { ArrowLeft, Gamepad2 } from "lucide-react";
import CoverDrift from "./CoverDrift";
import ThemeToggle from "./ThemeToggle";

// ======================================================================
//  La coquille des pages de compte
// ======================================================================
// Connexion, inscription, mot de passe oublié, réinitialisation : quatre pages
// qui posent la même question (« qui es-tu ? ») et qui montraient jusqu'ici une
// carte seule au milieu d'un fond vide.
//
// Deux panneaux, donc : à gauche le décor — les mêmes jaquettes qui glissent
// que sur l'accueil visiteur, pour qu'on sache qu'on est au même endroit — et à
// droite le formulaire, seul, sur fond plein. C'est cette séparation nette qui
// fait « pro » : le décor ne passe JAMAIS derrière les champs, où il ne ferait
// que gêner la lecture.
//
// ⚠️ SUR TÉLÉPHONE, LE PANNEAU DE GAUCHE DISPARAÎT (cf. la feuille de style).
// Un décor qui pousse le formulaire sous la ligne de flottaison, sur la page
// qu'on ouvre pour taper un mot de passe, ne rend service à personne.
//
// Les pages gardent leur contenu tel quel (`.auth-title`, `.auth-sub`, les
// champs, les boutons) : la coquille ne s'occupe que de l'autour.

export default function AuthShell({ children, aside }) {
  return (
    <div className="mpl-auth">
      <aside className="mpl-auth-side">
        <CoverDrift />
        <div className="mpl-auth-side-in">
          <Link to="/" className="brand clickable">
            <span className="brand-logo">
              <Gamepad2 size={20} strokeWidth={2.5} />
            </span>
            <span className="brand-name">
              My<span className="grad-text">PlayLog</span>
            </span>
          </Link>
          <p className="mpl-auth-pitch">
            {aside || "Le journal de tes jeux vidéo."}
          </p>
          <span className="mpl-auth-tag">Alpha — ça bouge tous les jours</span>
        </div>
      </aside>

      <main className="mpl-auth-main">
        <div className="mpl-auth-top">
          <Link to="/" className="mpl-auth-back clickable">
            <ArrowLeft size={15} /> Accueil
          </Link>
          <ThemeToggle />
        </div>

        <div className="mpl-auth-card">{children}</div>
      </main>
    </div>
  );
}
