import { PartyPopper, Newspaper } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import QuizCard from "../components/QuizCard";

export default function Welcome() {
  const { user } = useAuth();

  return (
    <div className="home">
      {/* Colonne principale : futur flux (sorties, amis, listes, jeux gratuits…) */}
      <div className="home-main">
        <div className="home-hero">
          <div className="welcome-emoji">
            <PartyPopper size={34} strokeWidth={2} />
          </div>
          <h1 className="home-hero-title">
            Salut <span className="grad-text">{user?.username}</span>
          </h1>
          <p className="home-hero-sub">
            Ton journal de jeux est prêt. En attendant, teste tes connaissances
            dans le quiz et grimpe au classement.
          </p>
        </div>

        <div className="home-feed-placeholder card">
          <Newspaper size={18} />
          <span>
            Bientôt ici : sorties du moment, activité des amis, tes dernières
            listes et les jeux gratuits.
          </span>
        </div>
      </div>

      {/* Colonne flottante : le quiz */}
      <div className="home-aside">
        <QuizCard />
      </div>
    </div>
  );
}
