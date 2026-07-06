import { Link } from "react-router-dom";
import {
  Gamepad2,
  Library,
  Star,
  Timer,
  Trophy,
  Users,
  ListOrdered,
  MessageCircle,
  Download,
  MonitorPlay,
  Sparkles,
  ArrowRight,
  Check,
} from "lucide-react";
import Navbar from "../components/Navbar";

const FEATURES = [
  {
    Icon: Library,
    title: "Track tes parties",
    text: "En cours, terminés, à jouer, abandonnés — ta bibliothèque enfin rangée.",
  },
  {
    Icon: Star,
    title: "Note & ressens",
    text: "Mets tes notes, écris tes ressentis, garde une trace de chaque jeu.",
  },
  {
    Icon: Timer,
    title: "Stats de temps de jeu",
    text: "Combien d'heures sur ce RPG ? Tes stats parlent pour toi.",
  },
  {
    Icon: Trophy,
    title: "Trophées & succès",
    text: "Suis ta progression et compare tes complétions.",
  },
  {
    Icon: Users,
    title: "Feed d'amis",
    text: "Vois ce que tes potes jouent, notent et débloquent en temps réel.",
  },
  {
    Icon: ListOrdered,
    title: "Listes & tops",
    text: "Crée tes classements, tes backlogs et tes tops de tous les temps.",
  },
  {
    Icon: MessageCircle,
    title: "Ressenti & chat",
    text: "Discute solo ou en groupe autour d'un jeu, façon communauté.",
  },
  {
    Icon: Download,
    title: "Import PSN & Steam",
    text: "Récupère ta bibliothèque et tes trophées automatiquement.",
  },
  {
    Icon: MonitorPlay,
    title: "Joue dans le navigateur",
    text: "Certains jeux rétro se lancent direct depuis le web. Nostalgie garantie.",
  },
];

export default function Landing() {
  return (
    <div className="page">
      <Navbar />

      {/* HERO */}
      <section className="hero">
        <div className="hero-badge font-fun">
          <Sparkles size={14} /> Le journal de tes jeux vidéo
        </div>
        <h1 className="hero-title">
          Tous tes jeux.
          <br />
          <span className="grad-text">Une seule légende.</span>
        </h1>
        <p className="hero-sub">
          MyPlayLog, c'est ton carnet de bord gaming : track, note, partage et
          reviens sur tout ce que tu as joué. Comme un TV Time, mais pour les
          manettes.
        </p>
        <div className="hero-cta">
          <Link to="/register" className="btn btn-primary">
            Commencer gratuitement <ArrowRight size={18} />
          </Link>
          <Link to="/login" className="btn btn-ghost">
            J'ai déjà un compte
          </Link>
        </div>

        <div className="hero-mock card">
          <div className="mock-head">
            <span className="mock-dot" />
            <span className="mock-dot" />
            <span className="mock-dot" />
            <span className="mock-head-label font-fun">ma bibliothèque</span>
          </div>
          <MockRow
            Icon={Library}
            title="Elden Ring"
            meta="En cours · 47h · ★★★★½"
            tag="Bientôt fini"
          />
          <MockRow
            Icon={Trophy}
            title="Hollow Knight"
            meta="Terminé · 32h · ★★★★★"
            tag="100%"
            tone="done"
          />
          <MockRow
            Icon={ListOrdered}
            title="Celeste"
            meta="À jouer · dans ta liste"
            tag="Backlog"
            tone="soon"
          />
        </div>
      </section>

      {/* FEATURES */}
      <section className="features">
        <h2 className="section-title">
          Tout ce qu'un <span className="grad-text">gamer</span> veut suivre
        </h2>
        <p className="section-sub">
          Une plateforme pensée pour les joueurs, du casual au complétionniste.
        </p>
        <div className="feature-grid">
          {FEATURES.map(({ Icon, title, text }) => (
            <div className="feature-card card clickable" key={title}>
              <div className="feature-icon">
                <Icon size={22} strokeWidth={2} />
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="final-cta">
        <div className="final-card">
          <h2>Prêt à écrire ta légende&nbsp;?</h2>
          <p>Rejoins MyPlayLog et commence à logger tes parties dès ce soir.</p>
          <Link to="/register" className="btn btn-primary">
            Créer mon compte <ArrowRight size={18} />
          </Link>
          <div className="final-perks">
            <span>
              <Check size={15} /> Gratuit
            </span>
            <span>
              <Check size={15} /> Sans pub
            </span>
            <span>
              <Check size={15} /> 30 secondes
            </span>
          </div>
        </div>
      </section>

      <footer className="footer">
        <span className="brand-mini">
          <Gamepad2 size={16} strokeWidth={2.5} style={{ color: "var(--accent-ink)" }} />
          MyPlayLog — {new Date().getFullYear()}
        </span>
        <span className="footer-retro font-fun">
          fait avec ♥ et une pointe de nostalgie
        </span>
      </footer>
    </div>
  );
}

function MockRow({ Icon, title, meta, tag, tone }) {
  return (
    <div className="mock-row">
      <span className="mock-cover">
        <Icon size={20} strokeWidth={2} />
      </span>
      <div className="mock-info">
        <strong>{title}</strong>
        <span className="mock-meta">{meta}</span>
      </div>
      <span className={`mock-tag ${tone || ""}`}>{tag}</span>
    </div>
  );
}
