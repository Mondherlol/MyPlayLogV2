import mongoose from "mongoose";
import { isAdminEmail } from "../lib/admin.js";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },

    // --- Réinitialisation de mot de passe ---
    // On stocke le HASH du token (jamais le token en clair) + son expiration.
    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpires: { type: Date, default: null, select: false },

    // --- Profil ---
    avatar: { type: String, default: null }, // photo de profil (upload)
    cover: { type: String, default: null }, // photo de couverture (image de jeu)
    // Cadrage de la couverture : position CSS façon "50% 30%" (défaut = centré).
    coverPos: { type: String, default: null },
    bio: { type: String, default: "", maxlength: 300 },
    // "Si j'étais un perso de jeu vidéo, je serais…" : nom d'un personnage
    // existant + son image (pour l'afficher dans le profil).
    tagline: { type: String, default: "", maxlength: 120 },
    taglineImage: { type: String, default: null },

    // Ordre de préférence des OST favorites : liste d'ids de jeux (IGDB) rangés
    // manuellement par l'utilisateur dans l'onglet OST de son profil. Les jeux
    // absents de la liste sont considérés comme « pas encore classés ».
    ostOrder: { type: [Number], default: [] },

    // --- Personnalisation de l'onglet « Aperçu » du profil ---
    // Ordre des sections (favoris + statuts) glissées-déposées par le
    // propriétaire ; ex. ["favorites","playing","finished",…]. Vide = ordre par
    // défaut. `overviewCards` : détails affichés sur les jaquettes (note, heures…).
    overviewOrder: { type: [String], default: [] },
    overviewCards: { type: [String], default: [] },

    // --- Connexion PSN (tokens de l'API non officielle, jamais renvoyés au client) ---
    psn: {
      accessToken: { type: String, default: null },
      refreshToken: { type: String, default: null },
      expiresAt: { type: Number, default: 0 },
      refreshExpiresAt: { type: Number, default: 0 },
      connectedAt: { type: Date, default: null },
    },

    // --- Abonnements (qui JE suis) ---
    following: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },

    // Dernière version de patch note vue par l'utilisateur : sert à n'afficher
    // la pop-up des nouveautés qu'UNE SEULE fois, à sa prochaine ouverture.
    seenPatchnote: { type: String, default: null },
  },
  { timestamps: true }
);

// Version "self" : renvoyée à l'utilisateur connecté (inclut l'email).
userSchema.methods.toPublic = function () {
  return {
    id: this._id,
    email: this.email,
    username: this.username,
    avatar: this.avatar,
    cover: this.cover,
    coverPos: this.coverPos,
    bio: this.bio,
    tagline: this.tagline,
    taglineImage: this.taglineImage,
    ostOrder: this.ostOrder || [],
    overviewOrder: this.overviewOrder || [],
    overviewCards: this.overviewCards || [],
    psnConnected: !!(this.psn && this.psn.refreshToken),
    isAdmin: isAdminEmail(this.email),
    followingCount: (this.following || []).length,
    createdAt: this.createdAt,
  };
};

// Carte légère (listes d'abonnés/abonnements, auteurs…).
userSchema.methods.toCard = function () {
  return {
    id: this._id,
    username: this.username,
    avatar: this.avatar,
    bio: this.bio,
  };
};

export default mongoose.model("User", userSchema);
