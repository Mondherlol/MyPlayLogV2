import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  Check,
  Copy,
  Download,
  Gamepad2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";
import Navbar from "../components/Navbar";
import { apiFetch } from "../lib/api";

// L'URL de l'API, telle qu'elle est câblée au build (VITE_API_URL vaut « /api »
// en production). Le lien de téléchargement pointe dessus DIRECTEMENT plutôt
// que de passer par du JavaScript : un vrai <a href> se partage, s'ouvre dans
// un nouvel onglet, se reprend quand la connexion casse — un bouton qui
// déclenche un fetch ne fait rien de tout ça.
const API = (import.meta.env.VITE_API_URL || "http://localhost:4000/api").replace(/\/$/, "");
const DOWNLOAD_URL = `${API}/app/download`;

const STEPS = [
  {
    Icon: Download,
    title: "Télécharge le fichier",
    text: "Un .apk d'une centaine de mégaoctets. Ton navigateur le range dans tes téléchargements.",
  },
  {
    Icon: ShieldCheck,
    title: "Autorise l'installation",
    text: "Android demande la permission d'installer une app qui ne vient pas du Play Store. C'est un appui, et ça ne concerne que ce fichier.",
  },
  {
    Icon: Gamepad2,
    title: "Connecte-toi",
    text: "Le même compte que sur le site : ta bibliothèque, tes listes et tes messages sont déjà là.",
  },
];

const PERKS = [
  { Icon: RefreshCw, text: "Se met à jour toute seule" },
  { Icon: Bell, text: "Notifications de messages" },
  { Icon: Smartphone, text: "Widgets sur l'écran d'accueil" },
];

function formatSize(bytes) {
  if (!bytes) return null;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/**
 * La page de téléchargement de l'app Android.
 *
 * MyPlayLog n'est pas sur le Play Store : cette page EST le magasin
 * d'applications. Elle doit donc en faire le travail — dire ce qu'on
 * télécharge, en quelle version, et pourquoi Android va rouspéter — sans quoi
 * la moitié des gens abandonnent devant l'avertissement de sécurité.
 */
export default function DownloadApp() {
  const [release, setRelease] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | none | error
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch("/app/latest")
      .then((data) => {
        if (!alive) return;
        setRelease(data?.available ? data : null);
        setState(data?.available ? "ready" : "none");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  // Sur un ordinateur, le bouton ne sert pas à grand-chose : c'est le téléphone
  // qui doit recevoir le fichier. On propose donc aussi l'adresse à recopier.
  const onPhone = /android/i.test(navigator.userAgent);

  function copyLink() {
    navigator.clipboard?.writeText("https://myplaylog.cc/download").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const published = release?.publishedAt
    ? new Date(release.publishedAt).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="page landing dl-page">
      <Navbar />

      <section className="hero dl-hero">
        <div className="hero-glow" aria-hidden="true" />

        <div className="hero-badge font-fun">
          <Sparkles size={14} /> Android · gratuit · sans pub
        </div>
        <h1 className="hero-title">
          MyPlayLog
          <br />
          <span className="grad-text">dans ta poche.</span>
        </h1>
        <p className="hero-sub">
          Ta bibliothèque, tes notes, tes listes et tes messages — la même chose
          que sur le site, mais faite pour le pouce, avec les notifications et
          les widgets en plus.
        </p>

        <div className="dl-cta">
          {state === "loading" && (
            <span className="dl-status">Recherche de la dernière version…</span>
          )}

          {state === "ready" && (
            <>
              <a className="btn btn-primary dl-btn" href={DOWNLOAD_URL} download>
                <Download size={18} /> Télécharger l'APK
              </a>
              <p className="dl-meta">
                Version {release.version} (build {release.versionCode})
                {formatSize(release.size) ? ` · ${formatSize(release.size)}` : ""}
                {published ? ` · ${published}` : ""}
              </p>
            </>
          )}

          {state === "none" && (
            <>
              <span className="btn btn-ghost dl-btn is-disabled">Bientôt disponible</span>
              <p className="dl-meta">Aucune version n'est encore publiée. Reviens très vite.</p>
            </>
          )}

          {state === "error" && (
            <>
              <span className="btn btn-ghost dl-btn is-disabled">Indisponible</span>
              <p className="dl-meta">
                Impossible de joindre le serveur pour le moment. Réessaie dans un instant.
              </p>
            </>
          )}

          {!onPhone && state === "ready" && (
            <button type="button" className="dl-copy clickable" onClick={copyLink}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Lien copié" : "Ouvre myplaylog.cc/download sur ton téléphone"}
            </button>
          )}
        </div>

        <ul className="dl-perks">
          {PERKS.map(({ Icon, text }) => (
            <li key={text}>
              <Icon size={15} /> {text}
            </li>
          ))}
        </ul>
      </section>

      {/* INSTALLATION */}
      <section className="steps-section">
        <h2 className="section-title">
          Trois étapes, <span className="grad-text">deux minutes.</span>
        </h2>
        <p className="section-sub">
          MyPlayLog n'est pas sur le Play Store : l'app s'installe directement
          depuis ce site. Une fois posée, elle se met à jour toute seule.
        </p>
        <div className="steps">
          {STEPS.map(({ Icon, title, text }, i) => (
            <div className="step card" key={title}>
              <span className="step-num font-fun">{i + 1}</span>
              <div className="step-icon">
                <Icon size={22} strokeWidth={2} />
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* NOUVEAUTÉS DE LA VERSION */}
      {state === "ready" && !!release.notes && (
        <section className="dl-notes-section">
          <div className="dl-notes card">
            <h2>
              Nouveautés <span className="grad-text">de la version {release.version}</span>
            </h2>
            <pre className="dl-notes-body">{release.notes}</pre>
          </div>
        </section>
      )}

      {/* LES TROIS QUESTIONS QUE TOUT LE MONDE SE POSE */}
      <section className="dl-faq">
        <div className="dl-faq-item card">
          <h3>
            <ShieldCheck size={18} /> Pourquoi Android me met en garde&nbsp;?
          </h3>
          <p>
            Parce que le fichier ne vient pas du Play Store. L'avertissement est
            le même pour toute app installée hors magasin et ne dit rien de son
            contenu : ici, le fichier est servi par myplaylog.cc — le serveur du
            site sur lequel tu es en ce moment.
          </p>
        </div>
        <div className="dl-faq-item card">
          <h3>
            <RefreshCw size={18} /> Et les mises à jour&nbsp;?
          </h3>
          <p>
            L'app regarde d'elle-même, quelques secondes après son ouverture,
            s'il existe une version plus récente — et propose de l'installer. Tu
            peux aussi la chercher à la main dans{" "}
            <em>Réglages &rsaquo; Mise à jour</em>, ou y couper la vérification
            automatique.
          </p>
        </div>
        <div className="dl-faq-item card">
          <h3>
            <Smartphone size={18} /> Et sur iPhone&nbsp;?
          </h3>
          <p>
            Pas encore : iOS n'autorise pas l'installation hors App Store. En
            attendant, le site fonctionne très bien depuis Safari, et s'ajoute à
            l'écran d'accueil comme une app.
          </p>
        </div>
      </section>

      <section className="final-cta">
        <div className="final-card">
          <h2>Pas encore de compte&nbsp;?</h2>
          <p>Il en faut un pour utiliser l'app — et il se crée en trente secondes.</p>
          <Link to="/register" className="btn btn-primary">
            Créer mon compte <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      <footer className="footer">
        <span className="brand-mini">
          <Gamepad2 size={16} strokeWidth={2.5} style={{ color: "var(--accent-ink)" }} />
          MyPlayLog — {new Date().getFullYear()}
        </span>
        <span className="footer-retro font-fun">
          {release?.downloads
            ? `${release.downloads} téléchargements`
            : "fait avec ♥ et une pointe de nostalgie"}
        </span>
      </footer>
    </div>
  );
}
