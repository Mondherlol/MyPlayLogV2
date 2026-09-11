import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowRight, Gamepad2, Smartphone } from "lucide-react";
import CoverDrift from "../components/CoverDrift";
import ThemeToggle from "../components/ThemeToggle";
import { useAuth } from "../context/AuthContext";
import { loadPublicStats } from "../lib/publicStats";

// ======================================================================
//  La page d'accueil des visiteurs
// ======================================================================
// ⚠️ UNE SEULE PAGE-ÉCRAN, ET RIEN À FAIRE DÉFILER. La version précédente était
// une page de vente : héros, maquette, bandeau de mots-clés, neuf arguments,
// trois étapes, appel à l'action final, pied de page. Six écrans de défilement
// pour un site qui est encore en chantier et qu'on rejoint parce qu'un ami
// envoie le lien — personne ne lit une brochure quand on lui a dit « tiens,
// essaie ça ».
//
// Ce qu'il reste est ce qu'il faut : ce que c'est, où ça en est, et deux
// boutons. Le décor fait le reste — des jaquettes qui glissent derrière le
// texte, qui disent « des jeux » sans une ligne d'argumentaire.
//
// ⚠️ LES CHIFFRES SONT VRAIS ET VIENNENT DE LA BASE (GET /api/stats, publique).
// C'est la seule chose sur cette page qui se vérifie, donc la seule qui mérite
// d'être lue deux fois. Aucun ne s'affiche s'il vaut zéro : une page qui annonce
// « 0 jeu suivi » n'inspire rien à personne.

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

export default function Landing() {
  const { user, loading } = useAuth();
  const [stats, setStats] = useState(null);

  // Une seule requête pour la page entière : elle porte les chiffres ET les
  // jaquettes du fond (le décor lit le même dépôt, cf. lib/publicStats).
  useEffect(() => {
    let alive = true;
    loadPublicStats().then((d) => alive && setStats(d));
    return () => {
      alive = false;
    };
  }, []);

  // Déjà connecté → on file direct dans l'app.
  if (loading) return <div className="center-screen">Chargement…</div>;
  if (user) return <Navigate to="/app" replace />;

  const numbers = [
    { value: stats?.games, label: "jeux suivis" },
    { value: stats?.osts, label: "bandes-son" },
    { value: stats?.characters, label: "personnages" },
    { value: stats?.hours, label: "heures de jeu" },
  ].filter((n) => n.value > 0);

  return (
    <div className="lp">
      <CoverDrift />

      <header className="lp-top">
        <span className="brand">
          <span className="brand-logo">
            <Gamepad2 size={20} strokeWidth={2.5} />
          </span>
          <span className="brand-name">
            My<span className="grad-text">PlayLog</span>
          </span>
        </span>
        <ThemeToggle />
      </header>

      <main className="lp-main">
        <span className="lp-badge">Alpha</span>

        <h1 className="lp-title">
          Bienvenue dans la bêta de <span className="grad-text">MyPlayLog</span>
        </h1>

        <p className="lp-sub">
          Le journal de tes jeux vidéo. C'est encore une alpha : ça bouge tous
          les jours, et c'est déjà utilisable.
        </p>

        <div className="lp-cta">
          <Link to="/register" className="lp-btn primary clickable">
            Créer un compte <ArrowRight size={17} />
          </Link>
          <Link to="/login" className="lp-btn ghost clickable">
            Se connecter
          </Link>
        </div>

        {numbers.length > 0 && (
          <ul className="lp-stats">
            {numbers.map((n) => (
              <li key={n.label}>
                <b>{fmt(n.value)}</b>
                <i>{n.label}</i>
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="lp-foot">
        {/* L'app Android n'est dans aucun magasin : cette ligne est le seul
            chemin qu'un visiteur ait pour apprendre qu'elle existe. */}
        <Link to="/download" className="lp-foot-link clickable">
          <Smartphone size={14} /> Aussi sur Android
        </Link>
        <span className="lp-foot-dot">·</span>
        <span>MyPlayLog {new Date().getFullYear()}</span>
      </footer>
    </div>
  );
}
