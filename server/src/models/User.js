import mongoose from "mongoose";

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

    // --- Rôles ---
    // Le « super-admin » est un rôle stocké en base (un seul compte à la fois) :
    // il peut tout faire, se transférer, et n'est ni rétrogradable ni supprimable
    // par les autres. Au tout premier démarrage sans super-admin, il est
    // bootstrappé depuis ADMIN_EMAIL (server/.env) — ensuite la base fait foi.
    // `isAdmin` : administrateur « simple » nommé par le super-admin.
    isSuperAdmin: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    // Accès à l'onglet « Téléchargements » des fiches de jeu. Fermé par défaut :
    // il s'ouvre compte par compte depuis le panel admin (voir canUserDownload,
    // lib/admin.js — les administrateurs l'ont sans le drapeau).
    canDownload: { type: Boolean, default: false },

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
    // Colonne latérale de l'aperçu : ordre des widgets (drag & drop) et widgets
    // masqués par le propriétaire. Vide = disposition par défaut. Clés alignées
    // avec le registre client (ProfileOverviewAside) / ASIDE_WIDGETS côté route.
    asideOrder: { type: [String], default: [] },
    asideHidden: { type: [String], default: [] },
    // Réglage par widget de la colonne latérale : objet { widgetKey: { mode,
    // id/gameId/videoId/ids/platform/keys } }. Ex. épingler une playlist précise
    // plutôt que « la plus récente ». Absent = comportement automatique.
    asideConfig: { type: mongoose.Schema.Types.Mixed, default: {} },
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

    // --- Connexion PSN (modèle « compte de service » : le serveur lit les
    //     trophées PUBLICS via son propre compte. On ne stocke ici que
    //     l'identité du joueur, aucun secret). ---
    psn: {
      accountId: { type: String, default: null }, // id numérique interne PSN
      onlineId: { type: String, default: null }, // PSN ID (pseudo public)
      avatar: { type: String, default: null },
      connectedAt: { type: Date, default: null },
      lastSyncAt: { type: Date, default: null }, // dernière synchro (bouton)
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

    // --- Gamification : points, inventaire, cosmétiques équipés ---
    // `points` est le solde DÉPENSABLE (gagné au blind test, dépensé en
    // caisses) : c'est un porte-monnaie, à ne pas confondre avec le score
    // cumulé du classement blind test, qui lui ne bouge jamais. L'historique
    // détaillé vit dans le modèle PointEntry (voir lib/points.js).
    points: { type: Number, default: 0, min: 0 },
    // Lots gagnés. On stocke le SLUG du lot (Reward.key) et non son id : un lot
    // recréé sous le même slug reste possédé, et la lecture ne demande aucun
    // populate. `count` compte les doublons (gagnés puis reconvertis en points).
    inventory: {
      type: [
        {
          rewardKey: { type: String, required: true },
          obtainedAt: { type: Date, default: Date.now },
          count: { type: Number, default: 1 },
          _id: false,
        },
      ],
      default: [],
    },
    // Cosmétique équipé par famille : { cursor: "slug", ornament: …, badge: … }.
    // Une famille absente = rien d'équipé → l'app garde son apparence par défaut.
    equipped: {
      cursor: { type: String, default: null },
      ornament: { type: String, default: null },
      badge: { type: String, default: null },
      theme: { type: String, default: null },
    },

    // --- Abonnements (qui JE suis) ---
    following: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },

    // --- Confidentialité ---
    // `isPrivate` : seuls les abonnés voient le contenu du profil ; s'abonner
    // passe alors par une DEMANDE à valider. Les trois autres options sont des
    // SOUS-options : elles n'ont aucun effet tant que le compte est public
    // (voir privacyOf() dans lib/privacy.js, qui les neutralise).
    privacy: {
      isPrivate: { type: Boolean, default: false },
      hideAvatar: { type: Boolean, default: false }, // photo de profil masquée
      hideCover: { type: Boolean, default: false }, // bannière masquée
      hideReviews: { type: Boolean, default: false }, // reviews hors des pages de jeux
    },

    // Demandes d'abonnement REÇUES et encore en attente (comptes privés).
    // Acceptée → le demandeur passe dans SON `following` ; refusée → oubliée.
    followRequests: {
      type: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
          createdAt: { type: Date, default: Date.now },
          _id: false,
        },
      ],
      default: [],
    },

    // Gestes accomplis côté CLIENT et invisibles en base (passer en thème
    // sombre, par exemple) : le client les signale une fois via
    // POST /api/missions/event, et les missions concernées les lisent ici.
    // Liste de slugs libres, dédoublonnée ($addToSet).
    missionFlags: { type: [String], default: [] },

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
    asideOrder: this.asideOrder || [],
    asideHidden: this.asideHidden || [],
    asideConfig: this.asideConfig || {},
    psnConnected: !!(this.psn && this.psn.accountId),
    psn: this.psn?.accountId
      ? {
          onlineId: this.psn.onlineId || null,
          avatar: this.psn.avatar || null,
          connectedAt: this.psn.connectedAt || null,
        }
      : null,
    steamConnected: !!(this.steam && this.steam.steamId),
    steam: this.steam?.steamId
      ? {
          personaName: this.steam.personaName || null,
          avatar: this.steam.avatar || null,
          profileUrl: this.steam.profileUrl || null,
          connectedAt: this.steam.connectedAt || null,
        }
      : null,
    isAdmin: !!this.isSuperAdmin || !!this.isAdmin,
    isSuperAdmin: !!this.isSuperAdmin,
    // Pilote l'affichage de l'onglet « Téléchargements » ; le serveur refait le
    // contrôle sur chaque route concernée (masquer n'est pas protéger).
    canDownload: !!this.isSuperAdmin || !!this.isAdmin || !!this.canDownload,
    points: this.points || 0,
    // Slugs seulement : le détail des lots équipés (image, rareté…) se récupère
    // via /api/arcade/cosmetics, qui sait résoudre les slugs en lots.
    equipped: {
      cursor: this.equipped?.cursor || null,
      ornament: this.equipped?.ornament || null,
      badge: this.equipped?.badge || null,
      theme: this.equipped?.theme || null,
    },
    followingCount: (this.following || []).length,
    privacy: {
      isPrivate: !!this.privacy?.isPrivate,
      hideAvatar: !!this.privacy?.hideAvatar,
      hideCover: !!this.privacy?.hideCover,
      hideReviews: !!this.privacy?.hideReviews,
    },
    // Pastille « demandes d'abonnement en attente » (compte privé).
    followRequestCount: (this.followRequests || []).length,
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
