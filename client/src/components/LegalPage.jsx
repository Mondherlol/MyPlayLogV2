import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import Navbar from "./Navbar";

// ======================================================================
//  La coquille des pages légales (/privacy, /services)
// ======================================================================
// Deux textes qu'on ne lit pas d'une traite : on y vient chercher UNE réponse
// (« est-ce que vous revendez mon email ? », « comment je supprime mon
// compte ? »). D'où un sommaire cliquable à côté du texte, et des titres de
// section qui sont des questions de lecteur plutôt que des articles de loi.
//
// Publiques et hors de toute coquille d'app : Google, Discord ou n'importe qui
// d'autre doit pouvoir les ouvrir sans compte — c'est même la première raison
// pour laquelle elles existent.

export const CONTACT_EMAIL = "myplaylog.support@gmail.com";

export default function LegalPage({ eyebrow, title, intro, updated, sections, other }) {
  // On arrive souvent ici par un lien externe (écran de consentement Google,
  // bas de page) : on démarre en haut, et le titre de l'onglet dit où l'on est.
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · MyPlayLog`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  return (
    <div className="page landing legal-page">
      <Navbar />

      <header className="legal-head">
        <span className="legal-eyebrow">{eyebrow}</span>
        <h1 className="legal-title">{title}</h1>
        <p className="legal-intro">{intro}</p>
        <p className="legal-updated">Dernière mise à jour : {updated}</p>
      </header>

      <div className="legal-layout">
        <nav className="legal-toc" aria-label="Sommaire">
          <span className="legal-toc-label">Sommaire</span>
          <ol>
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="clickable">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="legal-body">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="legal-section">
              <h2>{s.title}</h2>
              {s.body}
            </section>
          ))}

          <aside className="legal-contact">
            <strong>Une question sur ce texte ?</strong>
            <span>
              Écris-nous à{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="link-accent">
                {CONTACT_EMAIL}
              </a>
              . Une vraie personne te répond.
            </span>
          </aside>

          {other && (
            <Link to={other.to} className="legal-other clickable">
              {other.label} <ArrowRight size={15} />
            </Link>
          )}
        </article>
      </div>

      <footer className="lp-foot legal-foot">
        <Link to="/privacy" className="lp-foot-link clickable">
          Confidentialité
        </Link>
        <span className="lp-foot-dot">·</span>
        <Link to="/services" className="lp-foot-link clickable">
          Conditions d'utilisation
        </Link>
        <span className="lp-foot-dot">·</span>
        <span>MyPlayLog {new Date().getFullYear()}</span>
      </footer>
    </div>
  );
}
