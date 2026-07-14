import mongoose from "mongoose";

// Liaison d'un compte de jeu externe à des fins de TRACKING de performances
// (rang, top héros, winrate/KDA, historique de matchs). Générique : un document
// par utilisateur ET par provider. Marvel Rivals en premier ; LoL / Valorant…
// réutiliseront le même modèle (juste un autre `provider` + une autre lib).
//
// La clé d'API vit côté serveur (jamais ici) : on ne stocke que l'identifiant
// public du joueur chez le provider + un instantané normalisé de ses stats.
const gameTrackerSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    provider: {
      type: String,
      required: true,
      enum: ["marvel-rivals"],
    },
    // Identifiant du joueur chez le provider (uid stable) + pseudo affiché.
    externalUid: { type: String, required: true },
    externalName: { type: String, default: null },
    profileUrl: { type: String, default: null },

    connectedAt: { type: Date, default: Date.now },
    // Dernière synchro réussie (sert au throttle d'ouverture + cooldown refresh).
    lastSyncAt: { type: Date, default: null },
    // Curseur anti-doublon pour le fil : matchUid de la partie la plus récente
    // déjà connue. Les matchs postérieurs génèrent des cartes de feed.
    lastMatchUid: { type: String, default: null },

    // Instantané normalisé (sortie de lib/marvelRivals.normalizeStats). Mixed :
    // shape spécifique au provider, on sert toujours le dernier connu si l'API
    // tombe (dégradation gracieuse).
    snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    snapshotAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Un seul compte lié par provider et par utilisateur.
gameTrackerSchema.index({ user: 1, provider: 1 }, { unique: true });
// Empêcher de lier le même compte externe à deux utilisateurs.
gameTrackerSchema.index({ provider: 1, externalUid: 1 });

export default mongoose.model("GameTracker", gameTrackerSchema);
