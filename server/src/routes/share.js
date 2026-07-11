import express from "express";
import mongoose from "mongoose";
import List from "../models/List.js";
import User from "../models/User.js";
import UserGame from "../models/UserGame.js";
import { igdbQuery } from "../lib/igdb.js";

// Rendu HTML "Open Graph" pour les aperçus de partage (WhatsApp, Facebook,
// Twitter/X, Discord, Telegram, iMessage…). Ces robots ne lisent QUE le <head>
// et n'exécutent pas de JS : ils ne voient donc jamais le rendu React. Caddy
// ne route vers ces routes QUE les requêtes de robots sociaux (cf. Caddyfile) ;
// les vraies personnes reçoivent toujours la SPA statique.

const router = express.Router();

const SITE_NAME = "MyPlayLog";
const SITE_URL = "https://myplaylog.cc";
const DEFAULT_IMAGE = `${SITE_URL}/og-default.png`;
const DEFAULT_DESC =
  "Track, note et partage tes jeux vidéo. Le journal de tes parties.";
const IMG_BASE = "https://images.igdb.com/igdb/image/upload";

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

const clip = (s, n) => {
  const t = String(s || "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

// Compose la page HTML minimale porteuse des balises méta OG/Twitter.
function renderOgPage({
  title,
  description,
  image,
  url,
  type = "website",
  imageSize = null, // { w, h } pour l'image de repli (dimensions connues)
}) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(url);
  const img = escapeHtml(absImage(image) || DEFAULT_IMAGE);
  const sizeTags = imageSize
    ? `
    <meta property="og:image:width" content="${imageSize.w}" />
    <meta property="og:image:height" content="${imageSize.h}" />`
    : "";

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
    <meta property="og:url" content="${u}" />
    <meta property="og:image" content="${img}" />${sizeTags}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${img}" />
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

// Page générique (privé / introuvable / erreur) : aucun détail fuité.
function genericPage(url) {
  return renderOgPage({
    title: `${SITE_NAME} — Ton journal de jeux vidéo`,
    description: DEFAULT_DESC,
    image: DEFAULT_IMAGE,
    url,
    imageSize: { w: 1200, h: 630 },
  });
}

const sendHtml = (res, html) => res.type("html").send(html);

// ============================================================
//  Listes  — GET /lists/:id
// ============================================================
router.get("/lists/:id", async (req, res) => {
  const url = `${SITE_URL}/lists/${req.params.id}`;
  res.set("Cache-Control", "public, max-age=300");
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return sendHtml(res, genericPage(url));

    const l = await List.findById(req.params.id)
      .populate("user", "username")
      .lean();
    // On n'expose que les listes publiques (une privée reste générique).
    if (!l || l.visibility !== "public")
      return sendHtml(res, genericPage(url));

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
    description = clip(description, 300);

    // Image : la couverture uploadée, sinon la première jaquette d'élément.
    const image = l.cover || items.find((i) => i.image)?.image || null;

    sendHtml(
      res,
      renderOgPage({
        title: `${l.title} · ${SITE_NAME}`,
        description,
        image,
        url,
        type: "article",
        imageSize: image ? null : { w: 1200, h: 630 },
      })
    );
  } catch (err) {
    console.error("share list og error:", err.message);
    sendHtml(res, genericPage(url));
  }
});

// ============================================================
//  Profils  — GET /u/:username
// ============================================================
router.get("/u/:username", async (req, res) => {
  const url = `${SITE_URL}/u/${encodeURIComponent(req.params.username)}`;
  res.set("Cache-Control", "public, max-age=300");
  try {
    const user = await User.findOne({ username: req.params.username })
      .select("username avatar cover bio tagline")
      .lean();
    if (!user) return sendHtml(res, genericPage(url));

    // Quelques stats légères pour étoffer l'aperçu.
    const [gameCount, followerCount] = await Promise.all([
      UserGame.countDocuments({ user: user._id }),
      User.countDocuments({ following: user._id }),
    ]);

    const bits = [];
    if (gameCount) bits.push(`${gameCount} jeu${gameCount > 1 ? "x" : ""}`);
    if (followerCount)
      bits.push(`${followerCount} abonné${followerCount > 1 ? "s" : ""}`);
    let description = user.tagline || user.bio || "";
    const stats = bits.join(" · ");
    if (stats) description = description ? `${stats} · ${description}` : stats;
    if (!description) description = `Le profil de @${user.username} sur ${SITE_NAME}.`;
    description = clip(description, 300);

    // Image : la bannière de couverture (paysage, idéale), sinon l'avatar.
    const image = user.cover || user.avatar || null;

    sendHtml(
      res,
      renderOgPage({
        title: `@${user.username} · ${SITE_NAME}`,
        description,
        image,
        url,
        type: "profile",
        imageSize: image ? null : { w: 1200, h: 630 },
      })
    );
  } catch (err) {
    console.error("share profile og error:", err.message);
    sendHtml(res, genericPage(url));
  }
});

// ============================================================
//  Jeux  — GET /game/:id  (id IGDB numérique)
// ============================================================
router.get("/game/:id", async (req, res) => {
  const url = `${SITE_URL}/game/${encodeURIComponent(req.params.id)}`;
  res.set("Cache-Control", "public, max-age=600");
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return sendHtml(res, genericPage(url));

    const rows = await igdbQuery(
      "games",
      `fields name,alternative_names.name,alternative_names.comment,summary,cover.image_id,artworks.image_id,screenshots.image_id,first_release_date,total_rating,genres.name; where id = ${id};`
    );
    const g = rows?.[0];
    if (!g) return sendHtml(res, genericPage(url));

    // Titre français si IGDB en a un (comme mapGame côté /api/games).
    const fr = (g.alternative_names || []).find((a) =>
      /french/i.test(a.comment || "")
    );
    const name = fr?.name || g.name;
    const year = g.first_release_date
      ? new Date(g.first_release_date * 1000).getFullYear()
      : null;
    const genres = (g.genres || []).map((x) => x.name).slice(0, 3);

    // Résumé : la phrase d'accroche IGDB, sinon un descriptif composé.
    let description = g.summary
      ? clip(g.summary, 300)
      : clip(
          [year, genres.join(", ")].filter(Boolean).join(" · ") ||
            `Découvre ${name} sur ${SITE_NAME}.`,
          300
        );

    // Image : une artwork paysage (idéale pour l'aperçu), sinon un screenshot,
    // sinon la jaquette (portrait, mais mieux que rien).
    const artId = g.artworks?.[0]?.image_id;
    const shotId = g.screenshots?.[0]?.image_id;
    const image = artId
      ? `${IMG_BASE}/t_1080p/${artId}.jpg`
      : shotId
        ? `${IMG_BASE}/t_1080p/${shotId}.jpg`
        : g.cover?.image_id
          ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg`
          : null;

    sendHtml(
      res,
      renderOgPage({
        title: `${name}${year ? ` (${year})` : ""} · ${SITE_NAME}`,
        description,
        image,
        url,
        type: "article",
        imageSize: image ? null : { w: 1200, h: 630 },
      })
    );
  } catch (err) {
    console.error("share game og error:", err.message);
    sendHtml(res, genericPage(url));
  }
});

export default router;
