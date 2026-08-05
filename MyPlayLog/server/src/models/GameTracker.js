import mongoose from "mongoose";

// Liaison d'un compte de jeu externe à des fins de TRACKING de performances
// (rang, top héros, winrate/KDA, historique de matchs). Générique : un document
// par utilisateur, par provider ET par slot (compte principal + smurfs).
// Marvel Rivals en premier ; LoL / Valorant… réutiliseront le même modèle
// (juste un autre `provider` + une autre lib).
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
      enum: ["marvel-rivals", "league-of-legends"],
    },
    // Emplacement du compte : 0 = compte principal, 1..3 = smurfs. Chaque slot
    // est un document indépendant (snapshot, curseurs, historique séparés).
    slot: { type: Number, default: 0, min: 0, max: 3 },
    // Identifiant du joueur chez le provider (uid stable) + pseudo affiché.
    externalUid: { type: String, required: true },
    externalName: { type: String, default: null },
    profileUrl: { type: String, default: null },
    // Région/plateforme chez le provider (League of Legends : euw1, na1, kr…).
    // null pour les providers sans notion de région (Marvel Rivals).
    region: { type: String, default: null },

    connectedAt: { type: Date, default: Date.now },
    // Dernière synchro réussie (sert au throttle d'ouverture de profil : resync
    // de fond si périmé). Mise à jour par TOUTE synchro, y compris de fond.
    lastSyncAt: { type: Date, default: null },
    // Dernier clic manuel sur « Actualiser » (cooldown du bouton). Distinct de
    // lastSyncAt pour que la resync de fond n'épuise pas le cooldown du bouton.
    lastRefreshAt: { type: Date, default: null },
    // Curseur anti-doublon pour le fil : matchUid de la partie la plus récente
    // déjà connue. Les matchs postérieurs génèrent des cartes de feed.
    lastMatchUid: { type: String, default: null },

    // Instantané normalisé (sortie de lib/marvelRivals.normalizeStats). Mixed :
    // shape spécifique au provider, on sert toujours le dernier connu si l'API
    // tombe (dégradation gracieuse).
    snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    snapshotAt: { type: Date, default: null },

    // Historique classé (League of Legends). Persiste HORS du snapshot (celui-ci
    // est intégralement réécrit à chaque synchro) :
    //  - seasons : rangs des saisons PASSÉES, backfill op.gg à la liaison (l'API
    //    Riot ne les expose pas), immuables. [{ season, tier, division, label, lp, image }]
    //  - peak    : PIC de rang par file (solo/flex), construit au fil des synchros
    //    (notre propre historique, indépendant d'op.gg). { solo: {...}, flex: {...} }
    // null pour les providers sans notion de saison (Marvel Rivals).
    rankHistory: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// Un seul compte lié par slot (principal + jusqu'à 3 smurfs par provider).
// L'ancien index unique { user, provider } est supprimé au démarrage
// (cf. migrateTrackerSlots dans index.js).
gameTrackerSchema.index({ user: 1, provider: 1, slot: 1 }, { unique: true });
// Empêcher de lier le même compte externe à deux utilisateurs.
gameTrackerSchema.index({ provider: 1, externalUid: 1 });

export default mongoose.model("GameTracker", gameTrackerSchema);
