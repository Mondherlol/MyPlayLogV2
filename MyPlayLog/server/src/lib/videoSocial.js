import Documentary from "../models/Documentary.js";
import VideoSocial from "../models/VideoSocial.js";
import User from "../models/User.js";

// Outils de la couche sociale GLOBALE des vidéos (models/VideoSocial.js).
// Les cards du fil / du profil portent l'_id d'un Documentary (compat), mais
// likes & commentaires vivent sur le videoId → on résout l'un vers l'autre.

// Résout un videoId YouTube depuis soit un videoId (11 car.), soit un _id de
// Documentary (les endpoints acceptent les deux pour rester rétro-compatibles).
export async function resolveVideoId(param) {
  const p = String(param || "");
  if (/^[\w-]{11}$/.test(p)) return p;
  const doc = await Documentary.findById(p).select("videoId").lean();
  return doc?.videoId || null;
}

// find-or-create la couche sociale d'une vidéo (jamais deux docs par videoId).
export async function getOrCreateSocial(videoId) {
  return VideoSocial.findOneAndUpdate(
    { videoId },
    { $setOnInsert: { videoId } },
    { upsert: true, new: true }
  );
}

// Recommandeurs distincts d'une vidéo (pour notifier « on a commenté ta reco »).
export async function recommendersOf(videoId) {
  const docs = await Documentary.find({ videoId, recommended: true })
    .select("user")
    .lean();
  return [...new Map(docs.map((d) => [String(d.user), d.user])).values()];
}

// Map videoId -> { likeCount, liked, commentCount } pour un lot de vidéos.
export async function loadSocialCounts(videoIds, viewerId) {
  const ids = [...new Set((videoIds || []).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const socials = await VideoSocial.find({ videoId: { $in: ids } })
    .select("videoId likes comments")
    .lean();
  const uid = String(viewerId || "");
  for (const s of socials) {
    map.set(s.videoId, {
      likeCount: (s.likes || []).length,
      liked: (s.likes || []).some((u) => String(u) === uid),
      commentCount: (s.comments || []).length,
    });
  }
  return map;
}

// Map videoId -> relation PERSONNELLE du viewer (recommandée / plus tard), afin
// que les boutons reflètent MON état même sur le profil d'un autre joueur.
export async function loadMyRelations(videoIds, viewerId) {
  const ids = [...new Set((videoIds || []).filter(Boolean))];
  const map = new Map();
  if (!ids.length || !viewerId) return map;
  const mine = await Documentary.find({ user: viewerId, videoId: { $in: ids } })
    .select("videoId recommended later watched")
    .lean();
  for (const d of mine) {
    map.set(d.videoId, {
      recommended: !!d.recommended,
      later: !!d.later,
      watched: !!d.watched,
    });
  }
  return map;
}

// Map videoId -> avatars des AMIS (joueurs suivis par le viewer) ayant déjà
// regardé ou liké la vidéo — preuve sociale affichée sur la card.
export async function loadEngagedFriends(videoIds, viewerId, { limit = 6 } = {}) {
  const ids = [...new Set((videoIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length || !viewerId) return out;

  const me = await User.findById(viewerId).select("following").lean();
  const following = new Set((me?.following || []).map(String));
  if (!following.size) return out;

  const [watched, socials] = await Promise.all([
    Documentary.find({ videoId: { $in: ids }, watched: true, user: { $in: [...following] } })
      .select("videoId user")
      .lean(),
    VideoSocial.find({ videoId: { $in: ids } })
      .select("videoId likes")
      .lean(),
  ]);

  const byVideo = new Map(); // videoId -> Set(userId ami)
  const add = (vid, u) => {
    const s = String(u);
    if (!following.has(s)) return;
    if (!byVideo.has(vid)) byVideo.set(vid, new Set());
    byVideo.get(vid).add(s);
  };
  watched.forEach((d) => add(d.videoId, d.user));
  socials.forEach((s) => (s.likes || []).forEach((u) => add(s.videoId, u)));
  if (!byVideo.size) return out;

  const allIds = new Set();
  byVideo.forEach((set) => set.forEach((u) => allIds.add(u)));
  const users = await User.find({ _id: { $in: [...allIds] } })
    .select("username avatar")
    .lean();
  const userMap = new Map(
    users.map((u) => [String(u._id), { username: u.username, avatar: u.avatar || null }])
  );

  byVideo.forEach((set, vid) => {
    const people = [...set].map((u) => userMap.get(u)).filter(Boolean);
    out.set(vid, { friends: people.slice(0, limit), total: people.length });
  });
  return out;
}
