import mongoose from "mongoose";

// ======================================================================
//  Un essai de Perroquet — une imitation, un fichier, un joueur
// ======================================================================
// POURQUOI UNE COLLECTION À PART alors que les tentatives sont déjà dans les
// parties. Parce que les deux modes ne les gardent pas de la même façon :
//
//   - en solo (models/PerroquetGame.js), la tentative vit dans la manche, et la
//     partie ne s'efface jamais : c'est durable, mais c'est enfoui dans un
//     tableau imbriqué, donc illisible autrement qu'en dépliant toutes les
//     parties de tout le monde ;
//   - en versus (models/PerroquetVersus.js), le salon porte un TTL de six
//     heures. Les enregistrements de la soirée disparaissent de la base pendant
//     la nuit — en laissant leurs fichiers sur le disque.
//
// Un doc par essai, écrit au moment où l'imitation est notée, règle les deux :
// le versus survit à son salon, et « tous les essais de ce joueur » redevient
// une requête indexée. C'est cette collection que le wrapped annuel lira — elle
// est faite pour être parcourue par joueur et par date, pas pour rejouer une
// partie.
//
// L'écriture est BEST-EFFORT côté routes : si elle échoue, la manche est notée
// quand même. Perdre une ligne d'archive ne doit jamais coûter une partie.
const perroquetTakeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    mode: { type: String, enum: ["solo", "versus"], default: "solo" },

    // Le fichier de l'imitation (/uploads/perroquet/…), relatif comme partout
    // ailleurs : stocker l'absolu figerait le domaine du jour.
    url: { type: String, required: true },

    // ------------------------------------------------ le son qu'on imitait
    // Recopié et pas seulement référencé : un clip peut être renommé, éteint ou
    // supprimé, et un essai doit rester lisible tel qu'il a été joué.
    clip: { type: mongoose.Schema.Types.ObjectId, ref: "SoundClip", default: null },
    label: { type: String, default: "" },
    clipUrl: { type: String, default: "" },
    imageUrl: { type: String, default: "" },

    score: { type: Number, default: 0 },
    band: { type: String, default: "miss" },

    // D'où vient l'essai. En solo on garde la partie et le rang de la manche :
    // c'est ce qui permet, quand un admin efface le fichier, de couper aussi la
    // référence dans le récap au lieu de le laisser pointer dans le vide.
    game: { type: mongoose.Schema.Types.ObjectId, ref: "PerroquetGame", default: null },
    roundIndex: { type: Number, default: null },
    // En versus, le code du salon : il ne sert qu'à regrouper une soirée, le
    // salon lui-même aura disparu.
    versusCode: { type: String, default: "" },
  },
  { timestamps: true }
);

// La liste d'un joueur, du plus récent au plus ancien : l'onglet d'admin et le
// wrapped lisent tous les deux dans ce sens.
perroquetTakeSchema.index({ user: 1, createdAt: -1 });
// Le regroupement « qui a laissé des essais » et les tris par date.
perroquetTakeSchema.index({ createdAt: -1 });

export default mongoose.model("PerroquetTake", perroquetTakeSchema);
