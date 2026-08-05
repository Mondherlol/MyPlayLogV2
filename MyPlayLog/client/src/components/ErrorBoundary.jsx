import { Component } from "react";
import { reportClientError } from "../lib/reportError";

// Filet de sécurité : sans lui, la MOINDRE erreur de rendu démonte toute la SPA
// et ne laisse que le fond de page (écran « noir »). Ici on rattrape l'erreur,
// on la remonte au backend (indispensable pour les crashs qu'on ne reproduit
// pas soi-même), et on affiche un écran de secours au lieu du vide.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportClientError("react.render", error, {
      componentStack: info?.componentStack,
    });
  }

  handleReload = () => {
    // Un rechargement dur : repart d'un bundle propre (utile si un asset en
    // cache était corrompu / désynchronisé).
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="app-crash">
        <div className="app-crash-card">
          <h1>Oups, un pépin est survenu</h1>
          <p>
            L'application a rencontré une erreur. Recharge la page pour
            reprendre là où tu en étais.
          </p>
          <button className="btn btn-primary" onClick={this.handleReload}>
            Recharger
          </button>
          {/* En dev, on montre le détail pour debug immédiat ; en prod on
              reste sobre (l'erreur est déjà partie au serveur). */}
          {import.meta.env.DEV && (
            <pre className="app-crash-detail">
              {String(this.state.error?.stack || this.state.error?.message)}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
