import express from "express";
import mongoose from "mongoose";
import List from "../models/List.js";

// Rendu HTML "Open Graph" pour les aperçus de partage (WhatsApp, Facebook,
// Twitter/X, Discord, Telegram, iMessage…). Ces robots ne lisent QUE le <head>
// et n'exécutent pas de JS : ils ne voient donc jamais le rendu React. Caddy
// ne route vers cette route QUE les requêtes de robots sociaux (cf. Caddyfile) ;
// les vraies personnes reçoivent toujours la SPA statique.

const router = express.Router();

const SITE_NAME = "MyPlayLog";
const SITE_URL = "https://myplaylog.cc";
const DEFAULT_DESC =
  "Track, note et partage tes jeux vidéo. Le journal de tes parties.";

// Libellés FR par type de liste et par nature d'élément.
const TYPE_LABEL = {
  classic: "Liste",
  ranked: "Classement",
  tier: "Tier list",
  playlist: "Playlist",
};
const KIND_NOUN = {
  game: ["jeu", "jeux"],
  character: ["personnage", "personnages"],
  ost: ["morceau", "morceaux"],
};

const escapeHtml = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Normalise une URL d'image en absolu https (les jaquettes IGDB sont parfois
// stockées en protocol-relative `//images.igdb.com/...`).
const absImage = (url) => {
  if (!url) return null;
  if (url.startsWith("//")) return "https:" + url;
  return url;
};

// Compose la page HTML minimale porteuse des balises méta OG/Twitter.
function renderOgPage({ title, description, image, url, type = "website" }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(url);
  const img = image ? escapeHtml(absImage(image)) : null;
  const imageTags = img
    ? `
    <meta property="og:image" content="${img}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${img}" />`
    : `
    <meta name="twitter:card" content="summary" />`;

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <link rel="canonical" href="${u}" />

    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:type" content="${type}" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />${imageTags}
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />

    <!-- Sécurité : si une vraie personne atterrit ici (rare : UA mal détecté),
         on la renvoie vers l'appli. Les robots ignorent le script. -->
    <script>window.location.replace(${JSON.stringify(url)});</script>
  </head>
  <body>
    <p>${t}</p>
    <p>${d}</p>
    <p><a href="${u}">Ouvrir sur ${SITE_NAME}</a></p>
  </body>
</html>`;
}

// Page générique (liste privée / introuvable / erreur) : aucun détail fuité.
function genericPage(url) {
  return renderOgPage({
    title: `${SITE_NAME} — Ton journal de jeux vidéo`,
    description: DEFAULT_DESC,
    image: `${SITE_URL}/pwa-icon.svg`,
    url,
  });
}

// GET /lists/:id — aperçu de partage d'une liste (publique uniquement).
router.get("/lists/:id", async (req, res) => {
  const url = `${SITE_URL}/lists/${req.params.id}`;
  res.set("Cache-Control", "public, max-age=300");
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.type("html").send(genericPage(url));

    const l = await List.findById(req.params.id)
      .populate("user", "username")
      .lean();
    // On n'expose que les listes publiques (une privée reste générique).
    if (!l || l.visibility !== "public")
      return res.type("html").send(genericPage(url));

    const items = l.items || [];
    const kind = l.itemKind || "game";
    const [singular, plural] = KIND_NOUN[kind] || KIND_NOUN.game;
    const count = items.length;
    const typeLabel = TYPE_LABEL[l.type] || TYPE_LABEL.classic;
    const author = l.user?.username ? `@${l.user.username}` : null;

    // Résumé : « Tier list · 24 jeux · par @mondher » puis la description libre.
    const parts = [
      typeLabel,
      `${count} ${count > 1 ? plural : singular}`,
      author ? `par ${author}` : null,
    ].filter(Boolean);
    let description = parts.join(" · ");
    if (l.description) description += ` — ${l.description}`;
    if (description.length > 300) description = description.slice(0, 297) + "…";

    // Image : la couverture uploadée, sinon la première jaquette d'élément.
    const image =
      l.cover || items.find((i) => i.image)?.image || `${SITE_URL}/pwa-icon.svg`;

    res.type("html").send(
      renderOgPage({
        title: `${l.title} · ${SITE_NAME}`,
        description,
        image,
        url,
        type: "article",
      })
    );
  } catch (err) {
    console.error("share og error:", err.message);
    res.type("html").send(genericPage(url));
  }
});

export default router;
