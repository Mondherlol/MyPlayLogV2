import mongoose from "mongoose";

// ======================================================================
//  Un rendez-vous du jeu vidéo — Direct, State of Play, showcase…
// ======================================================================
// ⚠️ CE N'EST PAS LA MÊME CHOSE QUE LES LISTES D'ÉVÉNEMENTS (lib/eventSync).
// Celles-là racontent ce qui a ÉTÉ montré à une conférence PASSÉE : elles ont
// besoin de la liste des jeux, donc elles ne peuvent exister qu'après coup.
// Ce modèle-ci fait l'inverse : il annonce ce qui ARRIVE, avec une date et un
// compte à rebours, et se moque de savoir ce qui y sera montré — personne ne le
// sait encore, c'est justement pour ça qu'on l'attend.
//
// Les deux se rejoignent naturellement : une fois la conférence passée, IGDB la
// renseigne avec ses jeux, la synchro des listes en fait une liste officielle,
// et l'entrée d'ici sort du compte à rebours parce que sa date est derrière.

const gameEventSchema = new mongoose.Schema(
  {
    // ⚠️ L'IDENTITÉ STABLE D'UN ÉVÉNEMENT, ET LA CLÉ DE TOUT LE MÉCANISME.
    //
    // La synchro tourne tous les jours et revoit les mêmes événements : sans
    // une clé qui ne bouge pas, chaque passage en créerait des doublons, et
    // les « ça m'intéresse » se disperseraient entre les copies. Elle est
    // construite par le fournisseur (cf. lib/eventCalendar) à partir de ce
    // qu'il a de plus stable : l'UID iCal de l'agenda (qui survit à un report
    // de date), ou l'identifiant IGDB.
    key: { type: String, required: true, unique: true, index: true },

    // D'où ça vient. « manual » protège l'entrée : la synchro ne la touche pas
    // (cf. syncEventCalendar). C'est le filet quand aucune source ne connaît
    // encore un rendez-vous dont on sait, nous, qu'il arrive.
    source: {
      type: String,
      enum: ["igdb", "gameconfguide", "manual"],
      required: true,
    },

    // ⚠️ UN SALON N'EST PAS UN SHOWCASE, ET ON NE LES MONTRE PAS AU MÊME
    // ENDROIT. Un showcase se REGARDE : il dure trente minutes, il a une heure
    // et un lien. Un salon se VISITE : il dure quatre jours, il a une ville.
    // L'accueil ne montre que ce qui se regarde (plus les quelques salons qui
    // parlent aux joueurs) ; l'agenda complet montre tout, et laisse filtrer.
    kind: {
      type: String,
      enum: ["showcase", "conference"],
      default: "showcase",
    },

    name: { type: String, required: true, trim: true, maxlength: 160 },
    // Ce que l'événement va montrer : « The Legend of Zelda 40th anniversary »,
    // « Nintendo Switch 2 games ». C'est la ligne qui donne envie — le nom seul
    // (« Nintendo Direct ») ne distingue pas deux Directs à un jour d'écart.
    subtitle: { type: String, default: "", trim: true, maxlength: 240 },

    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, default: null },

    // ⚠️ ON NE PRÉTEND PAS SAVOIR L'HEURE QUAND ON NE LA SAIT PAS.
    // Un showcase est horodaté à la seconde ; un salon de quatre jours n'a
    // qu'une date de début.
    // Afficher « 14 h 03 min 12 s » sur une date sans heure serait un compte à
    // rebours inventé — le client lit ce champ pour choisir entre « J-3 » et un
    // vrai décompte (cf. mobile lib/events).
    precision: { type: String, enum: ["time", "day"], default: "day" },

    // « nintendo », « playstation », « xbox »… Sert à colorer la carte et à
    // choisir le logo côté client, qui a déjà ces marques en SVG.
    brand: { type: String, default: null },

    // Le résumé donné par la source. C'est ce qui remplit la fiche d'un
    // événement — et ce qui permet de savoir, avant de bloquer sa soirée, si
    // ce Direct parle du jeu qu'on attend.
    description: { type: String, default: "", maxlength: 1200 },

    // « YouTube », « YouTube / Twitch », « Cologne, Germany ». Le mot dit déjà
    // de quel genre d'événement il s'agit.
    location: { type: String, default: "", maxlength: 160 },

    // La durée annoncée, en minutes. Un Direct de 30 min et une conférence de
    // 2 h ne s'attendent pas de la même façon.
    durationMin: { type: Number, default: null },

    logo: { type: String, default: null },
    liveUrl: { type: String, default: null },
    // La page d'où l'information vient. Elle est AFFICHÉE : un compte à rebours
    // sur une date qu'on ne peut pas vérifier ne vaut pas grand-chose.
    sourceUrl: { type: String, default: null },

    // Les jeux annoncés, quand la source les connaît (IGDB seulement, et donc
    // presque jamais pour un événement à venir).
    gameIds: { type: [Number], default: [] },

    // Retiré à la main depuis l'admin : la synchro peut bien le retrouver
    // chaque jour, il ne remontera plus.
    hidden: { type: Boolean, default: false },

    // « Ça m'intéresse ». Un tableau d'identifiants plutôt qu'une collection à
    // part : on lit toujours les deux ensemble (la liste des événements ET mon
    // état sur chacun), et un rendez-vous concerne au plus quelques centaines
    // de personnes.
    interested: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },

    // Dernier passage de synchro qui a revu cet événement. Ce qui n'a pas été
    // revu ET qui est encore à venir a disparu de sa source (annulé, corrigé) :
    // on le retire (cf. pruneStale).
    seenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// La question posée à chaque ouverture de l'accueil : « qu'est-ce qui arrive ? »
gameEventSchema.index({ hidden: 1, startsAt: 1 });
// « Sur quoi ai-je coché ? » — tableau, donc index multiclé.
gameEventSchema.index({ interested: 1 });

export default mongoose.model("GameEvent", gameEventSchema);
