import mongoose from "mongoose";

// ======================================================================
//  Une séance à plusieurs — la « watchparty »
// ======================================================================
// Une salle : un hôte, ce qu'on y regarde, qui est entré, où en est la lecture,
// et ce qui s'y dit. Rien de tout ça n'a de valeur passé la soirée — c'est un
// document de PASSAGE, et il est écrit comme tel : les messages vivent dans la
// salle (pas dans la messagerie de personne), et la salle se ferme.
//
// POURQUOI PAS UNE CONVERSATION DE LA MESSAGERIE ? Parce qu'un fil de chat de
// séance n'est pas une discussion qu'on retrouve : il commente une image qui
// défile, il est illisible hors contexte, et il polluerait la liste des
// conversations (et ses compteurs de non-lus) d'un fil par soirée. L'invitation,
// elle, passe bien par un DM — c'est le seul morceau qui doit survivre.

// L'adresse de la salle : ce qui s'écrit dans le lien qu'on copie. Alphabet
// sans caractères ambigus (ni 0/O, ni 1/l/I) — un code se dicte parfois à voix
// haute, et il se retape à la main quand le lien casse dans un copier-coller.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LEN = 10;

export function makeCode() {
  let out = "";
  for (let i = 0; i < CODE_LEN; i += 1)
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

// ------------------------------------------------------------ ce qu'on regarde
// DEUX NATURES, ET C'EST TOUT CE QUI LES DISTINGUE : un titre du rayon (on
// connaît son slug, ses épisodes, ses hébergeurs) ou une vidéo YouTube libre
// collée à la volée (un trailer, un Direct Nintendo). Le titre et l'affiche sont
// RECOPIÉS ici : la carte d'invitation dans le DM et le salon d'attente doivent
// pouvoir s'afficher sans aller chercher la fiche.
const contentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["collection", "youtube"], default: "collection" },
    // Rayon vidéo
    media: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CollectionMedia",
      default: null,
    },
    slug: { type: String, default: "" },
    episodeIndex: { type: Number, default: 0 },
    // Vidéo libre
    videoId: { type: String, default: "" },
    url: { type: String, default: "" },
    author: { type: String, default: "" }, // la chaîne YouTube
    // Recopiés pour l'affichage (les deux natures)
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" }, // « Épisode 03 · Le pont »
    poster: { type: String, default: "" },
  },
  { _id: false }
);

// ------------------------------------------------------------ l'état de lecture
// L'HÔTE EST L'HORLOGE. `at` est sa position au moment `updatedAt` : un invité
// qui arrive en retard rejoue le calcul (`at` + le temps écoulé si ça joue) et
// tombe à la bonne seconde sans que personne n'ait rien à faire.
const stateSchema = new mongoose.Schema(
  {
    playing: { type: Boolean, default: false },
    at: { type: Number, default: 0 }, // secondes dans la vidéo
    episodeIndex: { type: Number, default: 0 },
    sourceAt: { type: Number, default: 0 }, // quel hébergeur, dans la liste
    updatedAt: { type: Date, default: Date.now },
    // Le TOP DE DÉPART commun (« 3, 2, 1, lecture ! »), en millisecondes
    // d'horloge murale : c'est la seule façon de faire partir ensemble des gens
    // dont le lecteur ne se pilote pas. Voir le mode « synchro guidée ».
    cueAt: { type: Number, default: 0 },
  },
  { _id: false }
);

const partyMessageSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    text: { type: String, default: "", maxlength: 2000 },
    media: {
      type: [
        {
          kind: { type: String, enum: ["image", "gif"], default: "image" },
          url: { type: String, required: true },
          width: { type: Number, default: null },
          height: { type: Number, default: null },
          _id: false,
        },
      ],
      default: [],
    },
    reactions: {
      type: [
        {
          emoji: { type: String, required: true },
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
          _id: false,
        },
      ],
      default: [],
    },
    // Ligne de service, centrée sans bulle : « X a rejoint », « on regarde
    // maintenant Y ». C'est le fil de la soirée autant que la conversation.
    system: { type: String, default: null },
    systemData: { type: mongoose.Schema.Types.Mixed, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const watchPartySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: contentSchema, default: () => ({}) },
    members: {
      type: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
          joinedAt: { type: Date, default: Date.now },
          _id: false,
        },
      ],
      default: [],
    },
    state: { type: stateSchema, default: () => ({}) },
    // LA CONVERSATION RESTE DANS LA SALLE, et bornée : on garde les derniers
    // messages pour que celui qui arrive en cours de route ait de quoi lire, pas
    // pour archiver la soirée.
    messages: { type: [partyMessageSchema], default: [] },
    // « Tout le monde peut piloter » : l'hôte lâche la télécommande. Pratique à
    // deux, indispensable quand l'hôte s'endort.
    openControl: { type: Boolean, default: false },
    endedAt: { type: Date, default: null },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Les salles mortes ne s'accumulent pas : Mongo les efface tout seul six heures
// après le dernier signe de vie. Rien à purger à la main, aucune tâche de fond
// (le TTL de Mongo tourne de son côté toutes les minutes).
watchPartySchema.index({ lastActiveAt: 1 }, { expireAfterSeconds: 6 * 3600 });

export const MAX_PARTY_MESSAGES = 200;

export default mongoose.model("WatchParty", watchPartySchema);
