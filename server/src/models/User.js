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
    // `isStaff` : modérateur du catalogue. Ne donne AUCUN accès au panel admin,
    // seulement le droit de toucher aux données partagées d'une fiche de jeu
    // (OST, personnages) — que tout le monde pouvait modifier avant.
    isSuperAdmin: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    isStaff: { type: Boolean, default: false },
    // Compte de service du site (« MyPlayLog »), propriétaire des listes
    // officielles générées automatiquement — les listes d'événements, par
    // exemple. Personne ne s'y connecte : il est créé par script avec un mot de
    // passe aléatoire jamais communiqué. Le drapeau sert surtout à l'afficher
    // avec sa pastille de compte vérifié.
    isSystem: { type: Boolean, default: false },
    // Le bot du site (un seul compte porte ce drapeau, cf. lib/bot.js). C'est
    // LUI et non le pseudo qui identifie le bot : on peut le rebaptiser sans
    // rien casser, et un plaisantin qui créerait un compte « Gérard » ne se
    // ferait pas passer pour lui.
    isBot: { type: Boolean, default: false },
    // Droit de PARLER au bot. Fermé par défaut, ouvert compte par compte depuis
    // le panel admin : le personnage est volontairement grossier, il n'a rien à
    // faire dans les mains de n'importe qui (mineurs, comptes de passage).
    botAccess: { type: Boolean, default: false },
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

    // Ordre d'affichage de MES listes sur mon profil (identifiants de listes
    // rangés à la main). Le reste — une liste créée depuis, une liste absente
    // de ce rangement — vient à la suite, de la plus récemment modifiée à la
    // plus ancienne. C'est un rangement de VITRINE : il ne change rien au
    // contenu des listes, seulement à celles qu'on voit en premier.
    listOrder: { type: [mongoose.Schema.Types.ObjectId], default: [] },

    // --- Personnalisation de l'onglet « Aperçu » du profil ---
    // Ordre des sections (favoris + statuts) glissées-déposées par le
    // propriétaire ; ex. ["favorites","playing","finished",…]. Vide = ordre par
    // défaut. `overviewCards` : détails affichés sur les jaquettes (note, heures…).
    overviewOrder: { type: [String], default: [] },
    overviewCards: { type: [String], default: [] },
    // --- Mise en page complète de l'aperçu (application mobile) ---
    // `overviewOrder` ne connaît que les huit sections de statuts : le site les
    // filtre à l'enregistrement, et n'importe quelle clé qu'il ne connaît pas
    // y serait effacée au premier glisser-déposer. L'app, elle, range dans le
    // même flux les listes de l'utilisateur promues en section, ses avis et
    // ses listes — d'où un second champ, que le site ne touche jamais.
    //
    // Les clés : les huit statuts, « lists », « reviews », et « list:<id> »
    // pour une liste montrée comme une section à part entière. Vide = on
    // retombe sur `overviewOrder`, puis sur l'ordre par défaut.
    overviewLayout: { type: [String], default: [] },
    // Les sections que le propriétaire a masquées, mêmes clés que ci-dessus.
    overviewHidden: { type: [String], default: [] },
    // L'emoji choisi pour une section, par clé : { "list:65f…": "🎮" }. Les
    // sections de statuts ont une icône dessinée ; une liste promue, elle, n'a
    // que son titre — d'où le choix d'un emoji, qui tient la même place.
    overviewIcons: { type: mongoose.Schema.Types.Mixed, default: {} },
    // La RÈGLE de tri d'une section, par clé : { "favorites": "rating",
    // "finished": "-release" }. Le tiret inverse le sens.
    //
    // ⚠️ UNE RÈGLE, PAS UN ORDRE FIGÉ. `overviewGameOrder` retient une suite
    // d'identifiants — le rangement à la main, qui ne vaut que pour SA propre
    // bibliothèque. Une règle, elle, s'applique à n'importe quelle liste de
    // jeux : c'est ce qui permet de voir le profil des autres rangé comme le
    // sien (cf. `overviewApplyToAll`).
    overviewGameSort: { type: mongoose.Schema.Types.Mixed, default: {} },
    // « Je veux voir les profils des autres comme le mien » : même ordre de
    // sections, mêmes sections masquées, mêmes tris. Leurs listes promues en
    // section restent affichées — ce sont leurs listes, pas ma disposition.
    overviewApplyToAll: { type: Boolean, default: false },
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

    // --- Ma collection de boîtiers (page /collection) ---
    // CE QUE J'AI SORTI DE LA MACHINE, et rien d'autre. Le catalogue reste
    // commun (CollectionMedia, garni par l'admin) ; cette liste dit lesquels de
    // ses boîtiers sont À MOI — un seul exemplaire de chacun, jamais de
    // doublon (la machine ne tire que parmi ceux qui manquent, voir
    // routes/collection.js).
    //
    // Le SLUG et non l'identifiant : c'est la clé de toutes les routes du
    // rayon, elle survit à un titre supprimé puis reposé, et lire une étagère
    // ne demande alors aucun `populate`.
    //
    // PAS `collection` : Mongoose réserve ce nom (`Model.collection` est la
    // poignée du pilote natif, dont lib/activity.js se sert ailleurs), et un
    // champ qui le porte sabote cet accès en silence. Le mot du domaine est de
    // toute façon « boîtier ».
    ownedCases: {
      type: [
        {
          slug: { type: String, required: true },
          obtainedAt: { type: Date, default: Date.now },
          _id: false,
        },
      ],
      default: [],
    },

    // --- Mon étagère de collection (page /collection, vue 3D) ---
    // LE MEUBLE EST À CELUI QUI LE REGARDE. Ce qui se règle ici n'est que la
    // façon dont ma collection est présentée — l'ordre où j'ai rangé mes
    // boîtiers, l'essence de la planche, le nombre de boîtiers par rangée. Un
    // boîtier débloqué depuis se range à la fin sans rien casser (voir
    // l'application de l'ordre côté page).
    shelfOrder: { type: [String], default: [] },
    shelfSkin: { type: String, default: "" },
    shelfPerPlank: { type: Number, default: 0 }, // 0 = la densité par défaut

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

    // --- Connexion Discord (OAuth2 « identify ») ---
    // On ne garde que l'identité publique : l'id Discord (immuable, c'est LUI
    // la clé — un pseudo Discord se change), le pseudo affiché et l'avatar.
    // Aucun jeton n'est stocké : on n'a besoin d'aucune permission après la
    // liaison, le bot parle aux gens par leur id.
    discord: {
      discordId: { type: String, default: null },
      username: { type: String, default: null }, // pseudo global (@toto)
      globalName: { type: String, default: null }, // nom affiché
      avatar: { type: String, default: null }, // URL complète (cdn.discordapp.com)
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

    // --- Sonnerie d'appel ---
    // Ce qu'ON entend quand quelqu'un nous appelle. C'est un réglage de
    // RÉCEPTION, jamais d'émission : l'appelant n'impose pas sa sonnerie, sinon
    // le premier plaisantin venu réveillerait la moitié du site avec un cri de
    // Wilhelm.
    //
    //   default la sonnerie par défaut de l'app — celle que l'administrateur a
    //           désignée dans la banque (models/Ringtone.js) ;
    //   preset  une autre sonnerie de la banque, choisie explicitement ;
    //   custom  son propre fichier, `url` porte alors son chemin.
    //
    // « synth » est l'ancien nom de `default`, du temps où la sonnerie d'origine
    // était fabriquée par oscillateurs. Il reste accepté pour ne pas invalider
    // les comptes créés avant, et se lit partout comme `default`.
    //
    // DEUX URLS, ET C'EST VOULU :
    //
    //   `url`   ce qui JOUE. Recopiée depuis la banque quand on choisit une
    //           sonnerie commune — ainsi une sonnerie retirée de la banque
    //           continue de sonner chez ceux qui l'avaient prise, au lieu de les
    //           rendre muets sans prévenir.
    //   `file`  MON fichier à moi, gardé même quand je n'écoute pas avec.
    //           Sans lui, essayer une sonnerie de la banque effacerait le
    //           fichier qu'on vient d'envoyer, et il faudrait le renvoyer pour
    //           revenir dessus.
    ringtone: {
      source: {
        type: String,
        enum: ["default", "preset", "custom", "synth"],
        default: "default",
      },
      preset: { type: mongoose.Schema.Types.ObjectId, ref: "Ringtone", default: null },
      url: { type: String, default: null },
      file: { type: String, default: null },
      name: { type: String, default: "" },
    },

    // --- Personnalisation du fil d'accueil ---
    // Familles de cartes que ce joueur ne veut PAS voir dans son fil (clés de
    // FEED_CATEGORIES, cf. lib/feedCategories.js). On garde la liste des
    // familles coupées et non celle des familles gardées : rien à migrer sur
    // les comptes existants, et une famille ajoutée plus tard s'affiche
    // d'office chez tout le monde.
    feedHidden: { type: [String], default: [] },

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

    // Série de connexions : jours civils CONSÉCUTIFS où le joueur est passé
    // (cf. lib/streak.js, tenu à jour par requireAuth). `best` ne redescend
    // jamais — c'est lui que lisent les missions « Connecte-toi N jours
    // d'affilée », pour qu'un badge mérité ne se reperde pas à la première
    // journée sautée. `lastDay` : jour civil (Europe/Paris) du dernier passage.
    streak: {
      current: { type: Number, default: 0 },
      best: { type: Number, default: 0 },
      lastDay: { type: String, default: null },
    },

    // Jetons de notification push des appareils mobiles (app Expo). Un même
    // compte peut être installé sur plusieurs téléphones, d'où la liste.
    // Le ménage est automatique : un jeton refusé par Expo (app désinstallée)
    // est retiré à l'envoi suivant — cf. lib/push.js.
    pushTokens: {
      type: [
        {
          token: { type: String, required: true },
          platform: { type: String, enum: ["ios", "android"], default: "android" },
          addedAt: { type: Date, default: Date.now },
          _id: false,
        },
      ],
      default: [],
      select: false, // jamais renvoyé dans un profil : c'est une adresse d'appareil
    },
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
    listOrder: (this.listOrder || []).map(String),
    overviewOrder: this.overviewOrder || [],
    overviewCards: this.overviewCards || [],
    overviewLayout: this.overviewLayout || [],
    overviewHidden: this.overviewHidden || [],
    overviewIcons: this.overviewIcons || {},
    overviewGameSort: this.overviewGameSort || {},
    overviewApplyToAll: !!this.overviewApplyToAll,
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
    discordConnected: !!(this.discord && this.discord.discordId),
    discord: this.discord?.discordId
      ? {
          username: this.discord.username || null,
          globalName: this.discord.globalName || null,
          avatar: this.discord.avatar || null,
          connectedAt: this.discord.connectedAt || null,
        }
      : null,
    // Le droit de parler au bot : le client s'en sert pour montrer (ou non) le
    // bot dans la messagerie. Le serveur revérifie à chaque message.
    botAccess: !!this.isSuperAdmin || !!this.isAdmin || !!this.botAccess,
    isAdmin: !!this.isSuperAdmin || !!this.isAdmin,
    isSuperAdmin: !!this.isSuperAdmin,
    // Pilote l'affichage des outils d'édition de l'OST et des personnages ; les
    // administrateurs l'ont d'office. Le serveur revérifie sur chaque route.
    isStaff: !!this.isSuperAdmin || !!this.isAdmin || !!this.isStaff,
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
    // La sonnerie voyage avec le compte : le client en a besoin AVANT le
    // premier appel (on ne va pas charger un réglage pendant que ça sonne).
    ringtone: {
      source: this.ringtone?.source === "synth" ? "default" : this.ringtone?.source || "default",
      preset: this.ringtone?.preset ? String(this.ringtone.preset) : null,
      url: this.ringtone?.url || null,
      file: this.ringtone?.file || null,
      name: this.ringtone?.name || "",
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
    feedHidden: this.feedHidden || [],
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
