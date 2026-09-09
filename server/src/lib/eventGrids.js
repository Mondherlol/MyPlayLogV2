import EventBingo from "../models/EventBingo.js";
import User from "../models/User.js";
import { toComment } from "./commentThread.js";
import { privacyOf } from "./privacy.js";

// ======================================================================
//  LES GRILLES DE BINGO D'UN RENDEZ-VOUS, LUES DE PARTOUT
// ======================================================================
// Elles vivaient dans routes/bingo.js, qui était leur seul lecteur. Elles ont
// désormais DEUX portes : la fiche du rendez-vous (qui les montre avant et
// pendant l'émission) et la liste officielle de l'événement, dans
// l'explorateur — celle qui reste, une fois le direct fini, quand la fiche du
// rendez-vous n'est plus ce qu'on ouvre.
//
// ⚠️ ET UNE SEULE COPIE DES GRILLES, PAS DEUX. La liste ne les recopie pas :
// elle pointe vers le même `EventBingo` par l'identifiant IGDB de l'événement.
// Des grilles dupliquées dans le document de liste auraient figé au moment de
// la copie un contenu qui se coche pendant toute la diffusion.

export function serializeCells(cells, size) {
  const byIndex = new Map((cells || []).map((c) => [c.index, c]));
  // ⚠️ ON REND TOUJOURS UN TABLEAU DENSE. Le client dessine une grille : il lui
  // faut `size * size` cases, y compris celles que personne n'a remplies. Lui
  // laisser reconstituer les trous, c'est un `size` mal lu quelque part et une
  // grille de travers.
  return Array.from({ length: size * size }, (_, i) => {
    const c = byIndex.get(i);
    return {
      index: i,
      text: c?.text || "",
      image: c?.image || null,
      gameId: c?.gameId ?? null,
      gameName: c?.gameName || "",
      saga: c?.saga?.id ? { id: c.saga.id, kind: c.saga.kind, name: c.saga.name || "" } : null,
      pos: c?.pos || null,
      textStyle: c?.textStyle || "banner",
      free: !!c?.free,
      // ⚠️ LA CASE OFFERTE N'EST PLUS COCHÉE D'OFFICE. Elle l'était — c'est la
      // convention du bingo papier — mais dans une grille qu'on compose des
      // jours à l'avance, ça voulait dire ouvrir sur une case déjà « gagnée »
      // avant que l'émission existe. Elle porte son mot FREE, et c'est son
      // propriétaire qui la coche quand ça commence, comme les autres.
      checked: !!c?.checked,
      checkedAt: c?.checkedAt || null,
    };
  });
}

export function serialize(grid, userId, { withComments = false } = {}) {
  const cells = serializeCells(grid.cells, grid.size);
  const filled = cells.filter((c) => c.text || c.image || c.free).length;
  const author = grid.user && grid.user.username ? grid.user : null;
  return {
    id: String(grid._id),
    eventId: String(grid.event),
    title: grid.title || "",
    size: grid.size,
    cells,
    filled,
    checked: cells.filter((c) => c.checked).length,
    published: !!grid.published,
    publishedAt: grid.publishedAt || null,
    createdAt: grid.createdAt,
    updatedAt: grid.updatedAt,
    author: author
      ? { id: String(author._id), username: author.username, avatar: author.avatar || null }
      : { id: String(grid.user), username: null, avatar: null },
    mine: String(grid.user?._id || grid.user) === String(userId),
    likeCount: (grid.likes || []).length,
    liked: (grid.likes || []).some((u) => String(u) === String(userId)),
    commentCount: (grid.comments || []).length,
    ...(withComments
      ? { comments: (grid.comments || []).map((c) => toComment(c, grid.comments || [], userId)) }
      : null),
  };
}

/**
 * Les grilles publiées d'un rendez-vous, telles qu'on a le droit de les voir.
 *
 * ⚠️ LE CERCLE D'ABORD, LES POPULAIRES ENSUITE. « Les grilles de mes amis » est
 * la promesse ; un classement par likes seul la remplacerait par un palmarès,
 * où l'on ne retrouve jamais la grille de la personne pour qui on est venu.
 */
export async function gridsForEvent(eventId, userId, { limit = 40 } = {}) {
  const [mine, others, me] = await Promise.all([
    EventBingo.findOne({ event: eventId, user: userId })
      .populate("user", "username avatar")
      .lean(),
    EventBingo.find({ event: eventId, published: true, user: { $ne: userId } })
      .populate("user", "username avatar privacy")
      .sort({ createdAt: -1 })
      .limit(120)
      .lean(),
    User.findById(userId).select("following").lean(),
  ]);

  const following = new Set((me?.following || []).map(String));
  const visible = others.filter((g) => {
    // Un compte privé ne s'expose pas à toute l'application parce qu'il a
    // rempli une grille : elle ne sort que vers ses abonnés.
    if (!privacyOf(g.user).isPrivate) return true;
    return following.has(String(g.user?._id));
  });

  visible.sort((a, b) => {
    const fa = following.has(String(a.user?._id)) ? 1 : 0;
    const fb = following.has(String(b.user?._id)) ? 1 : 0;
    if (fa !== fb) return fb - fa;
    const la = (a.likes || []).length;
    const lb = (b.likes || []).length;
    if (la !== lb) return lb - la;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return {
    mine: mine ? serialize(mine, userId) : null,
    grids: visible.slice(0, limit).map((g) => serialize(g, userId)),
    total: visible.length,
  };
}
