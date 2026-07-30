import mongoose from "mongoose";

// Où en est CE joueur sur CE média de la collection.
// Un doc par (user, media) : la reprise de lecture (« la cassette redémarre
// là où tu l'as arrêtée ») et les épisodes déjà vus, qui cochent la liste
// d'épisodes et alimentent la rangée « Reprendre » de la page Collection.
const collectionProgressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    media: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CollectionMedia",
      required: true,
    },

    // Épisode en cours (index absolu dans CollectionMedia.episodes ; 0 pour
    // un film) et position dans cet épisode.
    episodeIndex: { type: Number, default: 0 },
    positionSeconds: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: 0 },

    // Index des épisodes terminés (vus à ~90 %, ou cochés à la main).
    watched: { type: [Number], default: [] },

    // Papier : la planche où l'on s'est arrêté. Séparée de `episodeIndex`
    // exprès — un même document ne mélange jamais les deux, mais partager le
    // champ rendrait toute lecture ambiguë, et une reprise à la mauvaise unité
    // renvoie le lecteur n'importe où dans le volume.
    page: { type: Number, default: 0 },

    // Les marque-pages, en planches. RIEN À VOIR AVEC `page` : celui-ci dit où
    // l'on s'est arrêté (il se déplace tout seul, à chaque planche tournée),
    // ceux-là disent où l'on veut REVENIR — un chapitre, une double page, une
    // case. Un même nombre ne peut pas porter les deux sens, d'où la liste.
    bookmarks: { type: [Number], default: [] },

    // Jeu : le temps passé sur la cartouche, cumulé. C'est ce qui range le
    // boîtier dans la rangée « Reprendre » comme les autres, et ce qui s'écrit
    // sous la vignette d'une sauvegarde.
    //
    // LA PARTIE ELLE-MÊME N'EST PAS ICI. Elle vit dans CollectionSave : un état
    // de machine par emplacement, fichier sur notre disque. C'est un document à
    // part parce qu'il pèse des centaines de kilo-octets — le mettre ici
    // alourdirait chaque lecture de l'étagère, qui charge toutes les
    // progressions d'un coup.
    playSeconds: { type: Number, default: 0 },

    completed: { type: Boolean, default: false },
    lastWatchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

collectionProgressSchema.index({ user: 1, media: 1 }, { unique: true });
collectionProgressSchema.index({ user: 1, lastWatchedAt: -1 }); // « Reprendre »

export default mongoose.model("CollectionProgress", collectionProgressSchema);
