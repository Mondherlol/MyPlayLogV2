// Helpers partagés pour les fils de commentaires (listes ET OST de profil) :
// même schéma de commentaire, mêmes règles de médias / mentions / sérialisation.
import User from "../models/User.js";

// Normalise les médias reçus du client (GIF GIPHY ou images uploadées).
// Max 4 par message ; accepte un objet unique ou un tableau.
export function sanitizeMediaList(raw) {
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return arr
    .map((m) => {
      if (!m || (m.type !== "gif" && m.type !== "image") || !m.url) return null;
      return {
        type: m.type,
        url: String(m.url).slice(0, 1000),
        width: m.width != null ? Number(m.width) || null : null,
        height: m.height != null ? Number(m.height) || null : null,
      };
    })
    .filter(Boolean)
    .slice(0, 4);
}

// Extrait les @pseudo d'un texte et ne garde que ceux qui existent en base.
// Renvoie [{ user, username }] (username canonique tel que stocké).
const MENTION_RE = /@([\p{L}\p{N}_.-]{2,32})/gu;
export async function resolveMentions(text) {
  const names = [...new Set([...(text || "").matchAll(MENTION_RE)].map((m) => m[1]))];
  if (!names.length) return [];
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const rx = new RegExp(`^(${escaped.join("|")})$`, "i");
  const users = await User.find({ username: rx }).select("username").limit(20).lean();
  return users.map((u) => ({ user: u._id, username: u.username }));
}

// Sérialise un commentaire (résout l'aperçu du parent pour les réponses).
export function toComment(c, all, userId) {
  const parent = c.parent
    ? all.find((x) => String(x._id) === String(c.parent))
    : null;
  return {
    id: c._id,
    text: c.text || "",
    media: (c.media || []).map((m) => ({
      type: m.type,
      url: m.url,
      width: m.width,
      height: m.height,
    })),
    author: c.user
      ? { id: c.user._id, username: c.user.username, avatar: c.user.avatar || null }
      : null,
    mine: userId ? String(c.user?._id || c.user) === String(userId) : false,
    parent: c.parent ? String(c.parent) : null,
    replyTo: parent
      ? {
          id: parent._id,
          username: parent.user?.username || null,
          text: (parent.text || "").slice(0, 80),
          hasMedia: !!(parent.media && parent.media.length),
        }
      : null,
    mentions: (c.mentions || []).map((m) => m.username).filter(Boolean),
    likeCount: (c.likes || []).length,
    liked: userId ? (c.likes || []).some((u) => String(u) === String(userId)) : false,
    edited: (c.editCount || 0) > 0,
    editCount: c.editCount || 0,
    editedAt: c.editedAt || null,
    history: (c.history || []).map((h) => ({
      text: h.text || "",
      media: (h.media || []).map((m) => ({
        type: m.type,
        url: m.url,
        width: m.width,
        height: m.height,
      })),
      at: h.at,
    })),
    createdAt: c.createdAt,
  };
}
