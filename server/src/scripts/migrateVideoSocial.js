/**
 * Fusionne les likes & commentaires par-recommandation (Documentary) dans la
 * couche sociale GLOBALE par vidéo (VideoSocial). NON destructif : on ne touche
 * pas aux Documentary, on agrège seulement leurs interactions vers le videoId.
 * À lancer une fois : `npm run migrate:video-social` depuis /server.
 *
 * Après ça, un like/commentaire posé sur n'importe quelle recommandation de la
 * même vidéo apparaît partout (fil + tous les profils).
 */
import "dotenv/config";
import mongoose from "mongoose";
import Documentary from "../models/Documentary.js";
import VideoSocial from "../models/VideoSocial.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connecté à MongoDB");

  // On ne prend que les docs qui portent au moins un like ou un commentaire.
  const docs = await Documentary.find({
    $or: [
      { "likes.0": { $exists: true } },
      { "comments.0": { $exists: true } },
    ],
  }).lean();
  console.log(`🎬 Documentary avec interactions : ${docs.length}`);

  // Regroupement par videoId.
  const byVideo = new Map(); // videoId -> { likes:Set, comments:[] }
  for (const d of docs) {
    if (!d.videoId) continue;
    let acc = byVideo.get(d.videoId);
    if (!acc) {
      acc = { likes: new Set(), comments: [] };
      byVideo.set(d.videoId, acc);
    }
    (d.likes || []).forEach((u) => acc.likes.add(String(u)));
    (d.comments || []).forEach((c) => acc.comments.push(c));
  }

  let created = 0;
  let merged = 0;
  for (const [videoId, acc] of byVideo) {
    const social = await VideoSocial.findOne({ videoId });
    if (!social) {
      // Nouveau doc social : on trie les commentaires par date pour garder le fil.
      const comments = acc.comments
        .slice()
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
      await VideoSocial.create({
        videoId,
        likes: [...acc.likes],
        comments,
      });
      created++;
    } else {
      // Doc existant : on n'ajoute que ce qui manque (idempotent).
      const have = new Set((social.likes || []).map(String));
      acc.likes.forEach((u) => !have.has(u) && social.likes.push(u));
      const seen = new Set(
        (social.comments || []).map((c) => String(c._id))
      );
      for (const c of acc.comments) {
        if (!seen.has(String(c._id))) social.comments.push(c);
      }
      social.comments.sort(
        (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
      );
      await social.save();
      merged++;
    }
  }

  console.log(
    `✨ Terminé : ${created} vidéos créées, ${merged} fusionnées (${byVideo.size} videoId).`
  );
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ migrate:video-social", err);
  process.exit(1);
});
