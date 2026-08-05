import mongoose from "mongoose";

// Un média joint à une review (image uploadée ou GIF GIPHY), même format
// que les médias de commentaires.
const reviewMediaSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["gif", "image"], required: true },
    url: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
  },
  { _id: false }
);

// Réaction d'un autre utilisateur à cette review (une seule par utilisateur).
const reviewReactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["heart", "clap", "funny"], required: true },
  },
  { _id: false }
);

// Mention @user résolue à la création (coloration / lien).
const reviewMentionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    username: { type: String },
  },
  { _id: false }
);

// Réponse (commentaire) sous une review — fil à un niveau, façon commentaires de liste.
const reviewCommentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, default: "", trim: true, maxlength: 300 },
    media: { type: [reviewMediaSchema], default: [] },
    mentions: { type: [reviewMentionSchema], default: [] },
    parent: { type: mongoose.Schema.Types.ObjectId, default: null },
    likes: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
  },
  { _id: true, timestamps: true }
);

// Progression dans un bundle/compilation : chaque jeu inclus porte SON statut
// (en cours / terminé / en pause / abandonné) — on peut finir un jeu du bundle
// sans avoir fini les autres. Le statut se reporte sur l'entrée de bibliothèque
// du jeu inclus (voir routes/library.js, syncBundleChildren).
const bundleGameSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true }, // id IGDB du jeu inclus
    name: { type: String, required: true },
    cover: { type: String, default: null },
    status: {
      type: String,
      enum: ["playing", "finished", "paused", "dropped", null],
      default: null,
    },
    // Héritage V1 (simple case à cocher) : gardé synchronisé avec
    // status === "finished" pour les documents déjà enregistrés.
    done: { type: Boolean, default: false },
  },
  { _id: false }
);

// Une entrée de bibliothèque : le lien entre un utilisateur et un jeu IGDB.
const userGameSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    gameId: { type: Number, required: true }, // id IGDB
    name: { type: String, required: true },
    cover: { type: String, default: null }, // url (peut être une cover custom)

    // "wishlist" = je veux y jouer ; les autres = j'y ai joué.
    // "endless" = jeu sans fin (multi/service : Rocket League, Overwatch…) —
    // il ne compte ni comme terminé ni comme abandonné dans le backlog.
    status: {
      type: String,
      enum: ["wishlist", "playing", "finished", "paused", "dropped", "endless"],
      default: "wishlist",
    },
    // Ce jeu est passé par la wishlist à un moment de sa vie. Le statut seul ne
    // le dirait pas (il est écrasé quand on se met à y jouer) : on le retient
    // donc ici, une bonne fois — c'est ce qui permet de savoir qu'un jeu joué
    // était un souhait (missions « Souhait exaucé »). Voir aussi le rattrapage
    // des entrées d'avant ce champ : scripts/backfillWishlisted.js.
    wasWishlisted: { type: Boolean, default: false },
    platform: { type: String, default: null },
    // Format d'achat sur console : dématérialisé ou boîte physique.
    format: { type: String, enum: ["digital", "physical"], default: "digital" },
    // Origine « import Steam » : appid Steam rattaché, et vrai UNIQUEMENT si
    // l'entrée a été CRÉÉE par un import Steam (pas juste mise à jour). Sert à
    // proposer de retirer les jeux ajoutés lors d'une déliaison du compte Steam.
    steamAppId: { type: Number, default: null },
    steamImported: { type: Boolean, default: false },
    // Origine « import PSN » : npCommunicationId PSN rattaché, et vrai UNIQUEMENT
    // si l'entrée a été CRÉÉE par un import PSN (même logique que Steam). Sert à
    // proposer de retirer les jeux ajoutés lors d'une déliaison du compte PSN.
    psnCommunicationId: { type: String, default: null },
    psnImported: { type: Boolean, default: false },
    // Planning perso : mois où je compte jouer à ce jeu ("2026-08"), ou null.
    // Alimenté par le mode Planning de la page Sorties.
    plannedMonth: { type: String, default: null },
    // Si le jeu est un bundle : progression jeu par jeu (cases de la modale).
    bundleGames: { type: [bundleGameSchema], default: [] },
    // Entrée créée/gérée via un bundle : id IGDB du bundle parent. Sert à
    // nettoyer l'entrée si son statut est décoché dans la modale du bundle
    // (uniquement si elle est restée vierge : pas de note/avis ajoutés à la main).
    bundleParentId: { type: Number, default: null },
    playtimeHours: { type: Number, default: null },
    // Dernier temps de jeu RAPPORTÉ par PSN (à l'import / à la dernière synchro).
    // Sert à ne mettre à jour `playtimeHours` automatiquement que si l'utilisateur
    // ne l'a pas modifié à la main (playtimeHours === psnPlaytimeHours).
    psnPlaytimeHours: { type: Number, default: null },
    note: { type: String, default: "" }, // (déprécié) où je me suis arrêté
    review: { type: String, default: "" }, // texte de review
    reviewMedia: { type: [reviewMediaSchema], default: [] }, // GIF / images joints
    spoiler: { type: Boolean, default: false }, // la review dévoile l'intrigue
    // Date de publication/dernière édition du CONTENU de la review (texte,
    // médias, points forts/faibles). Distincte de `updatedAt` : changer une
    // note, une jaquette ou un temps de jeu ne doit pas rajeunir la review.
    reviewedAt: { type: Date, default: null },
    favorite: { type: Boolean, default: false },
    rating: { type: Number, min: 0, max: 100, default: null }, // note en %
    pros: { type: [String], default: [] },
    cons: { type: [String], default: [] },
    favoriteCharacter: {
      name: { type: String },
      image: { type: String },
    },
    favoriteOst: {
      name: { type: String },
      artist: { type: String },
      preview: { type: String },
      artwork: { type: String },
      youtube: { type: Boolean },
      url: { type: String },
    },
    // Réactions des autres joueurs sur cette review (cœur / bravo / rigolo).
    reactions: { type: [reviewReactionSchema], default: [] },
    // Réponses (commentaires) des autres joueurs sous cette review.
    comments: { type: [reviewCommentSchema], default: [] },
  },
  { timestamps: true }
);

// Un seul enregistrement par (utilisateur, jeu)
userGameSchema.index({ user: 1, gameId: 1 }, { unique: true });
// « Dernières OST mises en favori », tous joueurs confondus (accueil) : sans
// cet index, le tri par date se ferait en mémoire sur toute la collection —
// qui grossit vite avec les imports Steam/PSN.
userGameSchema.index({ "favoriteOst.name": 1, updatedAt: -1 });

export default mongoose.model("UserGame", userGameSchema);
