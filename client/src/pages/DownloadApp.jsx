import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Download, Gamepad2, Link2, Loader2 } from "lucide-react";
import CoverDrift from "../components/CoverDrift";
import ThemeToggle from "../components/ThemeToggle";
import { apiFetch } from "../lib/api";

// ======================================================================
//  La page de téléchargement de l'app Android
// ======================================================================
// ⚠️ UN BOUTON, PAS UNE NOTICE. La version précédente était une page de vente
// complète — héros, trois étapes d'installation, trois questions fréquentes,
// appel final — pour un geste qui tient en un appui. On arrive ici par un lien
// qu'un ami a envoyé : on veut le fichier, pas une brochure.
//
// Il reste ce qui décide du clic, et rien d'autre :
//   • le bouton ;
//   • la version, sa taille, sa date — « est-ce que c'est à jour ? » ;
//   • combien de gens l'ont déjà prise — « est-ce que c'est sérieux ? » ;
//   • ce qui a changé récemment — « est-ce que ça bouge ? ».
//
// La mise en page est celle de l'accueil visiteur (`.lp`) : même décor de
// jaquettes, même voile, même comportement clair/sombre. On passe de l'une à
// l'autre sans changer de maison.

// L'URL de l'API, telle qu'elle est câblée au build (VITE_API_URL vaut « /api »
// en production). Le lien pointe dessus DIRECTEMENT plutôt que de passer par du
// JavaScript : un vrai <a href> se partage, s'ouvre dans un nouvel onglet, se
// reprend quand la connexion casse — un bouton qui déclenche un fetch ne fait
// rien de tout ça.
const API = (import.meta.env.VITE_API_URL || "http://localhost:4000/api").replace(/\/$/, "");
const DOWNLOAD_URL = `${API}/app/download`;
const PAGE_URL = "https://myplaylog.cc/download";

// Combien de versions le changelog montre. Trois suffisent à dire « ça bouge
// souvent » ; au-delà, c'est une archive, et elle ferait défiler la page.
const SHOWN = 3;
// Et combien de lignes par version avant de replier : les notes automatiques
// reprennent jusqu'à quinze sujets de commit.
const LINES = 4;

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

function formatSize(bytes) {
  if (!bytes) return null;
  return `${Math.round(bytes / 1024 / 1024)} Mo`;
}

function formatDate(iso, long = false) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(
    "fr-FR",
    long ? { day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short" }
  );
}

/**
 * Les notes d'une version, en lignes.
 *
 * Le script de publication les écrit « - sujet du commit » une par ligne (cf.
 * myplaylog-mobile/scripts/release.mjs) ; un texte tapé à la main peut avoir
 * n'importe quelle forme. On retire donc les puces quelles qu'elles soient, et
 * chaque ligne non vide devient une entrée.
 */
function noteLines(notes) {
  return String(notes || "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean);
}

export default function DownloadApp() {
  const [release, setRelease] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | none | error
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(null); // version dépliée

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

  // Sur un ordinateur, c'est le téléphone qui doit recevoir le fichier : on
  // propose en plus de copier l'adresse de la page, discrètement.
  const onPhone = /android/i.test(navigator.userAgent);

  function copyLink() {
    navigator.clipboard
      ?.writeText(PAGE_URL)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  }

  // La version en ligne, puis les précédentes : un seul fil, du plus récent au
  // plus ancien. Une version sans notes n'a rien à raconter, elle n'y est pas.
  const versions = release
    ? [
        {
          version: release.version,
          versionCode: release.versionCode,
          notes: release.notes,
          publishedAt: release.publishedAt,
          current: true,
        },
        ...(release.history || []),
      ]
        .filter((v) => noteLines(v.notes).length > 0)
        .slice(0, SHOWN)
    : [];

  const total = release?.downloadsTotal ?? release?.downloads ?? 0;

  return (
    <div className="lp dlp">
      <CoverDrift />

      <header className="lp-top">
        <Link to="/" className="brand clickable">
          <span className="brand-logo">
            <Gamepad2 size={20} strokeWidth={2.5} />
          </span>
          <span className="brand-name">
            My<span className="grad-text">PlayLog</span>
          </span>
        </Link>
        <ThemeToggle />
      </header>

      <main className="dlp-main">
        {/* L'icône de l'app : c'est elle qu'on retrouvera sur son téléphone,
            autant la montrer tout de suite. */}
        <span className="dlp-icon" aria-hidden="true">
          <Gamepad2 size={40} strokeWidth={2.2} />
        </span>

        <h1 className="dlp-title">
          MyPlayLog <span className="grad-text">pour Android</span>
        </h1>

        <div className="dlp-cta">
          {state === "loading" && (
            <span className="dlp-btn is-idle">
              <Loader2 size={18} className="spin" />
            </span>
          )}

          {state === "ready" && (
            <>
              <a className="dlp-btn clickable" href={DOWNLOAD_URL} download>
                <Download size={19} strokeWidth={2.4} /> Télécharger
              </a>
              {!onPhone && (
                <button
                  type="button"
                  className="dlp-copy clickable"
                  onClick={copyLink}
                  title="Copier le lien pour l'ouvrir sur ton téléphone"
                  aria-label="Copier le lien de la page"
                >
                  {copied ? <Check size={17} /> : <Link2 size={17} />}
                </button>
              )}
            </>
          )}

          {(state === "none" || state === "error") && (
            <span className="dlp-btn is-idle">
              {state === "none" ? "Bientôt disponible" : "Indisponible pour le moment"}
            </span>
          )}
        </div>

        {state === "ready" && (
          <ul className="dlp-facts">
            <li>
              <b>v{release.version}</b>
              <i>version</i>
            </li>
            {!!release.publishedAt && (
              <li>
                <b>{formatDate(release.publishedAt)}</b>
                <i>mise à jour</i>
              </li>
            )}
            {!!formatSize(release.size) && (
              <li>
                <b>{formatSize(release.size)}</b>
                <i>taille</i>
              </li>
            )}
            {total > 0 && (
              <li>
                <b>{fmt(total)}</b>
                <i>téléchargements</i>
              </li>
            )}
          </ul>
        )}

        {/* --- Le changelog --------------------------------------------
            ⚠️ UNE FRISE, PAS UN BLOC DE TEXTE. Les notes étaient affichées en
            `<pre>` brut : quinze sujets de commit en police à chasse fixe, que
            personne ne lisait. Ici chaque version a sa pastille et sa date, les
            lignes sont des puces, et seules les quatre premières s'affichent —
            la version en ligne dépliée, les précédentes repliées. */}
        {versions.length > 0 && (
          <section className="dlp-log" aria-label="Dernières mises à jour">
            {versions.map((v, i) => {
              const lines = noteLines(v.notes);
              // ⚠️ LE NUMÉRO DE BUILD, PAS LA VERSION AFFICHÉE. Deux builds peuvent
              // porter le même « 1.4 » (un correctif republié) : indexés sur ce
              // libellé, ils auraient partagé leur clé et se seraient dépliés
              // ensemble. Le numéro de build, lui, est unique par construction.
              const id = String(v.versionCode ?? v.version);
              const expanded = open === id || (open === null && i === 0);
              const shown = expanded ? lines.slice(0, LINES) : [];
              const more = expanded ? lines.length - shown.length : 0;
              return (
                <article key={id} className={`dlp-rel ${expanded ? "open" : ""}`}>
                  <button
                    type="button"
                    className="dlp-rel-head clickable"
                    onClick={() => setOpen(expanded ? "" : id)}
                    aria-expanded={expanded}
                  >
                    <span className={`dlp-rel-dot ${v.current ? "now" : ""}`} />
                    <span className="dlp-rel-ver">v{v.version}</span>
                    {v.current && <span className="dlp-rel-now">Actuelle</span>}
                    <span className="dlp-rel-date">{formatDate(v.publishedAt, true)}</span>
                  </button>

                  {expanded && (
                    <ul className="dlp-rel-lines">
                      {shown.map((l, n) => (
                        <li key={n}>{l}</li>
                      ))}
                      {more > 0 && (
                        <li className="dlp-rel-more">
                          + {more} autre{more > 1 ? "s" : ""} changement{more > 1 ? "s" : ""}
                        </li>
                      )}
                    </ul>
                  )}
                </article>
              );
            })}
          </section>
        )}
      </main>

      <footer className="lp-foot">
        {/* minSdk 24 dans le projet mobile (cf. android/gradle.properties) :
            c'est Android 7.0, pas 8 — la page ne doit pas écarter des
            téléphones qui peuvent l'installer. */}
        <span>Android 7.0 et plus</span>
        <span className="lp-foot-dot">·</span>
        <span>Mises à jour automatiques</span>
      </footer>
    </div>
  );
}
