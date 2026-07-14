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
    // Photos de couverture multiples (carrousel de la bannière, max 6).
    // Chaque entrée garde son propre cadrage. `cover`/`coverPos` restent
    // synchronisés sur la 1re entrée (rétrocompat : partage, anciens clients).
    covers: {
      type: [
        {
          url: { type: String, required: true },
          pos: { type: String, default: null },
          _id: false,
        },
      ],
      default: [],
    },
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
    // Ordre manuel des jeux À L'INTÉRIEUR d'une section (favoris, en cours…) :
    // objet { sectionKey: [gameId,…] }. Une section présente ici est en tri
    // « manuel » (les jeux suivent cet ordre, les nouveaux tombent à la fin) ;
    // une section absente reste en tri « récemment modifié » (par défaut).
    overviewGameOrder: { type: mongoose.Schema.Types.Mixed, default: {} },

    // --- Connexion Steam (liaison OpenID « Sign in through Steam ») ---
    // On garde le SteamID64 + un instantané du profil public (pseudo, avatar).
    // La clé Steam Web API vit côté serveur ; aucun secret n'est stocké ici.
    steam: {
      steamId: { type: String, default: null },
      personaName: { type: String, default: null },
      avatar: { type: String, default: null },
      profileUrl: { type: String, default: null },
      connectedAt: { type: Date, default: null },
    },

    // --- Connexion PSN (tokens de l'API non officielle, jamais renvoyés au client) ---
    psn: {
      accessToken: { type: String, default: null },
      refreshToken: { type: String, default: null },
      expiresAt: { type: Number, default: 0 },
      refreshExpiresAt: { type: Number, default: 0 },
      connectedAt: { type: Date, default: null },
    },

    // --- Passkey C411 personnel (onglet Pack HD) ---
    // Le serveur récupère le .torrent avec sa clé partagée puis réécrit l'URL
    // d'annonce vers ce passkey → le téléchargement compte sur le ratio de
    // l'utilisateur. select:false → jamais renvoyé par les requêtes par défaut,
    // uniquement via l'endpoint dédié /me/c411.
    c411Passkey: { type: String, default: null, select: false },

    // --- Studios / éditeurs favoris ---
    // Épinglés depuis leur page /company/:name, affichés dans l'aperçu du profil.
    // On garde nom + logo + pays pour un rendu direct (pas de refetch IGDB).
    favoriteCompanies: {
      type: [
        {
          name: { type: String, required: true },
          logo: { type: String, default: null },
          country: { type: String, default: null },
          addedAt: { type: Date, default: Date.now },
          _id: false,
        },
      ],
      default: [],
    },

    // --- Consoles / plateformes favorites ---
    // Épinglées depuis leur page /platform/:id. On garde nom + logo + abréviation
    // pour un rendu direct (pas de refetch IGDB).
    favoritePlatforms: {
      type: [
        {
          platformId: { type: Number, required: true },
          name: { type: String, required: true },
          logo: { type: String, default: null },
          abbr: { type: String, default: null },
          addedAt: { type: Date, default: Date.now },
          _id: false,
        },
      ],
      default: [],
    },

    // --- Abonnements (qui JE suis) ---
    following: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },

    // Dernière version de patch note vue par l'utilisateur : sert à n'afficher
    // la pop-up des nouveautés qu'UNE SEULE fois, à sa prochaine ouverture.
    seenPatchnote: { type: String, default: null },

    // Dernier passage sur le site (mis à jour par requireAuth, throttlé) :
    // alimente le « En ligne / Dernière activité il y a … » du profil.
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Couvertures effectives : le tableau s'il existe, sinon l'ancienne couverture
// unique (profils créés avant le carrousel — pas de migration nécessaire).
userSchema.methods.effectiveCovers = function () {
  if (this.covers?.length)
    return this.covers.map((c) => ({ url: c.url, pos: c.pos || null }));
  return this.cover ? [{ url: this.cover, pos: this.coverPos || null }] : [];
};

// Version "self" : renvoyée à l'utilisateur connecté (inclut l'email).
userSchema.methods.toPublic = function () {
  return {
    id: this._id,
    email: this.email,
    username: this.username,
    avatar: this.avatar,
    cover: this.cover,
    coverPos: this.coverPos,
    covers: this.effectiveCovers(),
    bio: this.bio,
    tagline: this.tagline,
    taglineImage: this.taglineImage,
    ostOrder: this.ostOrder || [],
    overviewOrder: this.overviewOrder || [],
    overviewCards: this.overviewCards || [],
    overviewGameOrder: this.overviewGameOrder || {},
    psnConnected: !!(this.psn && this.psn.refreshToken),
    steamConnected: !!(this.steam && this.steam.steamId),
    steam: this.steam?.steamId
      ? {
          personaName: this.steam.personaName || null,
          avatar: this.steam.avatar || null,
          profileUrl: this.steam.profileUrl || null,
          connectedAt: this.steam.connectedAt || null,
        }
      : null,
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
