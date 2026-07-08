/**
 * Crée le BROUILLON du patch note V1.1 (non publié).
 * À lancer une fois : `node src/scripts/seedPatchnoteV11.js` depuis /server.
 *
 * Il n'écrase rien : si la v1.1 existe déjà, le script s'arrête pour ne pas
 * effacer tes retouches (images, texte). Supprime-la depuis l'admin si tu veux
 * repartir de zéro. Les images avant/après sont à ajouter toi-même via l'éditeur
 * admin (bouton "Image" / "Après" sur la nouveauté concernée).
 */
import "dotenv/config";
import mongoose from "mongoose";
import Patchnote from "../models/Patchnote.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";

const DRAFT = {
  version: "1.1",
  title: "MyPlayLog passe en mode poche",
  intro:
    "Quelques nouveautés fraîches pour rendre l'appli plus agréable, surtout sur téléphone.",
  published: false,
  items: [
    {
      icon: "Smartphone",
      title: "Une appli pensée pour le mobile",
      description:
        "Toute l'interface s'adapte désormais à ton téléphone : la barre latérale devient une barre de navigation en bas de l'écran (comme sur Android), les filtres de l'explorateur s'ouvrent dans un joli panneau coulissant, et les jeux s'affichent proprement deux par ligne. Glisse-toi partout, même d'une seule main.",
      images: [], // ⬅️ Ajoute ici tes 2 captures AVANT / APRÈS depuis l'éditeur admin
    },
    {
      icon: "BarChart3",
      title: "Une page Statistiques plus vivante",
      description:
        "Ta page de stats a été retravaillée pour mieux mettre en valeur ton parcours de joueur : des chiffres plus lisibles, une présentation plus soignée et de nouveaux détails sur tes habitudes de jeu.",
      images: [],
    },
  ],
};

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connecté à MongoDB");

  const existing = await Patchnote.findOne({ version: DRAFT.version });
  if (existing) {
    console.log(
      `ℹ️  Le patch note v${DRAFT.version} existe déjà (id ${existing._id}). ` +
        "Rien n'a été modifié."
    );
  } else {
    const note = await Patchnote.create(DRAFT);
    console.log(`✅ Brouillon v${note.version} créé (id ${note._id}).`);
    console.log(
      "👉 Ouvre la page Admin pour ajouter tes images avant/après, compléter, " +
        "puis publier quand tu es prêt."
    );
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Échec du seed :", err.message);
  process.exit(1);
});
