// Sérialisation partagée des reviews (réactions + réponses), utilisée par les
// routes /games (page d'un jeu) et /users (onglet activité d'un profil).

// Compte les réactions par type et repère celle de l'utilisateur courant.
export function summarizeReactions(reactions, meId) {
  const counts = { heart: 0, clap: 0, funny: 0 };
  let mine = null;
  for (const r of reactions || []) {
    if (counts[r.type] != null) counts[r.type]++;
    if (String(r.user) === String(meId)) mine = r.type;
  }
  return { counts, mine };
}

// Sérialise un commentaire (réponse) sous une review — résout l'aperçu du parent.
export function reviewComment(c, all, meId) {
  const parent = c.parent ? all.find((x) => String(x._id) === String(c.parent)) : null;
  const mine = String(c.user?._id || c.user) === String(meId);
  return {
    id: c._id,
    text: c.text || "",
    media: (c.media || []).map((m) => ({
      type: m.type,
      url: m.url,
      width: m.width,
      height: m.height,
    })),
    author: c.user?._id
      ? { id: c.user._id, username: c.user.username, avatar: c.user.avatar || null }
      : null,
    mine,
    // Seul l'auteur de la réponse peut la supprimer.
    canDelete: mine,
    likeCount: (c.likes || []).length,
    liked: meId ? (c.likes || []).some((u) => String(u) === String(meId)) : false,
    parent: c.parent ? String(c.parent) : null,
    replyTo: parent ? { id: parent._id, username: parent.user?.username || null } : null,
    mentions: (c.mentions || []).map((m) => m.username).filter(Boolean),
    createdAt: c.createdAt,
  };
}
