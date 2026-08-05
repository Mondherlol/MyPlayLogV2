import mongoose from "mongoose";
import { commentSchema } from "./List.js";

// Fil de commentaires attaché à un titre de la collection. Un document par
// titre commenté ; réutilise exactement le schéma de commentaire des listes.
//
// LE FIL NE VIT PAS DANS LA FICHE. Les commentaires auraient pu tenir dans un
// tableau de CollectionMedia, mais la fiche est lue en entier à chaque
// ouverture — et l'étagère lit TOUS les titres d'un coup : deux cents messages
// par titre voyageraient à chaque affichage du rayon pour n'être affichés nulle
// part. Un document à part se charge quand on le demande, et lui seul.
//
// LA NATURE DU TITRE NE CHANGE RIEN. Un manga, un film et une cartouche se
// commentent de la même façon : c'est le seul endroit de la section où les
// quatre supports se comportent enfin pareil.
const collectionThreadSchema = new mongoose.Schema(
  {
    media: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CollectionMedia",
      required: true,
      unique: true,
    },
    comments: { type: [commentSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("CollectionThread", collectionThreadSchema);
