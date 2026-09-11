import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import AuthShell from "../components/AuthShell";

// ======================================================================
//  Le retour de Google / Discord
// ======================================================================
// Une page de PASSAGE : on y atterrit une seconde, le temps de ranger le jeton
// et d'aller là où l'on allait. Elle n'a donc pas de contenu à elle — juste de
// quoi ne pas montrer un écran blanc, et de quoi dire ce qui s'est passé si ça
// a échoué.
//
// ⚠️ LE JETON ARRIVE DANS LE FRAGMENT (#token=…), jamais dans la requête. Ce
// qui suit le « # » ne part pas au serveur, ne s'écrit pas dans les journaux
// d'accès, et ne fuit pas en `Referer`. Première chose faite ici : l'effacer de
// la barre d'adresse, pour qu'il ne traîne ni dans l'historique ni dans un
// copier-coller d'URL.

export default function OAuthCallback() {
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  // React monte deux fois en mode strict (développement) : sans ce verrou, le
  // jeton serait consommé deux fois et la seconde passe verrait une URL déjà
  // nettoyée — donc « lien invalide » sur une connexion parfaitement réussie.
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = hash.get("token");
    const next = hash.get("next") || "/app";
    const remember = hash.get("remember") !== "0";

    // Nettoyage immédiat de la barre d'adresse (avant même l'appel réseau).
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      /* navigateur récalcitrant : tant pis, on continue */
    }

    if (!token) {
      setError("Lien de connexion incomplet. Reprends depuis la page de connexion.");
      return;
    }

    loginWithToken(token, remember)
      .then(() => navigate(next, { replace: true }))
      .catch(() =>
        setError("Ta session n'a pas pu être ouverte. Réessaie depuis la page de connexion.")
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthShell aside={"Encore une seconde, et tu es chez toi."}>
      {error ? (
        <>
          <h1 className="auth-title">Connexion interrompue</h1>
          <div className="alert alert-error">{error}</div>
          <button
            className="btn btn-primary btn-block"
            type="button"
            onClick={() => navigate("/login", { replace: true })}
          >
            Retour à la connexion
          </button>
        </>
      ) : (
        <div className="auth-done">
          <Loader2 size={30} className="spin" />
          <h1 className="auth-title">Connexion en cours…</h1>
          <p className="auth-sub">On récupère ta bibliothèque.</p>
        </div>
      )}
    </AuthShell>
  );
}
