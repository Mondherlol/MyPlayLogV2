import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { pushToUsers, preview } from "./push.js";

// Formulation de chaque type, pour la notification PUSH. C'est le miroir de
// NOTIF_META dans client/src/components/Topbar.jsx : les deux surfaces doivent
// raconter la même chose, sinon une notification lue sur le téléphone ne
// correspondrait pas à celle retrouvée sur le site.
const VERBS = {
  mention: "t'a mentionné",
  gamemedia_mention: "t'a mentionné sur",
  gamemedia_like: "a aimé ton post sur",
  gamemedia_comment: "a commenté ton post sur",
  gamemedia_comment_reply: "a répondu à ton commentaire sur",
  gamemedia_comment_like: "a aimé ton commentaire sur",
  comment_reply: "a répondu à ton commentaire",
  comment_like: "a aimé ton commentaire",
  list_comment: "a commenté ta liste",
  list_like: "a aimé ta liste",
  playlist_listen: "a écouté ta playlist",
  review_comment: "a répondu à ta review",
  review_comment_reply: "a répondu à ton commentaire",
  review_comment_like: "a aimé ton commentaire",
  ost_comment: "a commenté ton OST",
  repost_comment: "a commenté ton fan art republié",
  repost_like: "a aimé ton fan art republié",
  video_comment: "a commenté une vidéo que tu as recommandée",
  recommendation: "t'a recommandé",
  recommendation_boost: "a fait +1 sur ta reco de",
  recommendation_comment: "a commenté la reco de",
  download_react: "se moque de ton téléchargement de",
  follow_request: "demande à s'abonner à toi",
  follow_accepted: "a accepté ta demande d'abonnement",
};

// Envoi push d'une notification fraîchement créée. Best-effort et sans await
// chez l'appelant : une notification push lente ne doit jamais retarder
// l'action qui l'a déclenchée (un like, un commentaire…).
async function pushNotification({ user, type, actor, gameName, snippet }) {
  try {
    const verb = VERBS[type];
    if (!verb) return; // type système : pas d'acteur, pas de phrase à composer

    const who = await User.findById(actor).select("username").lean();
    const name = who?.username || "Quelqu'un";

    // `gameName` porte selon les cas le nom du jeu, de la liste ou du badge :
    // il complète le verbe quand celui-ci attend un complément.
    const tail = gameName ? ` ${gameName}` : "";
    const body = snippet ? preview(snippet) : undefined;

    await pushToUsers([user], {
      title: "MyPlayLog",
      body: body ? `${name} ${verb}${tail} — ${body}` : `${name} ${verb}${tail}`,
      data: { type: "notification" },
    });
  } catch (err) {
    console.error("notify push error:", err.message);
  }
}

// Crée une notification (best-effort). N'auto-notifie jamais l'acteur.
export async function notify({
  user,
  type,
  actor,
  list = null,
  comment = null,
  game = null,
  gameName = "",
  ostOwner = null,
  repostOwner = null,
  videoOwner = null,
  gameMedia = null,
  collectionSlug = null,
  snippet = "",
}) {
  if (!user || !actor || String(user) === String(actor)) return;
  try {
    await Notification.create({
      user,
      type,
      actor,
      list,
      comment,
      game,
      gameName: String(gameName || "").slice(0, 160),
      ostOwner,
      repostOwner,
      videoOwner,
      gameMedia,
      collectionSlug,
      snippet: String(snippet || "").slice(0, 120),
    });

    // Volontairement pas attendu : la notification est déjà en base, elle
    // s'affichera de toute façon à l'ouverture de l'app.
    pushNotification({ user, type, actor, gameName, snippet }).catch(() => {});
  } catch (err) {
    console.error("notify error:", err.message);
  }
}
