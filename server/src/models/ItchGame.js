import mongoose from "mongoose";

// ======================================================================
//  Un jeu itch.io qu'IGDB ne connaît pas (encore)
// ======================================================================
//
// Le pendant de SteamGame pour itch.io : la page publique du jeu, lue une fois
// et rangée ici, sert de fiche PROVISOIRE (cf. lib/localGame.js, `coreFromItch`)
// en attendant qu'IGDB l'ajoute à son catalogue — ce que beaucoup de jeux
// itch.io (visual novels, démos, jeux de game jam) n'obtiennent jamais.
//
// L'identifiant de jeu correspondant est `-(1 000 000 000 + itchId)` : une
// plage à part des fiches Steam (`-appid`), cf. `itchLocalIdOf`.

const itchGameSchema = new mongoose.Schema(
  {
    // L'identifiant itch.io du jeu (`itch:path` = « games/3631685 »). Stable :
    // il survit au renommage du jeu ou du compte de son auteur.
    itchId: { type: Number, required: true, unique: true },
    // L'adresse canonique de la page (https://auteur.itch.io/jeu). C'est elle
    // qu'IGDB range dans les sites d'un jeu (type 15), donc elle qui permet de
    // le retrouver le jour où il y entre.
    url: { type: String, required: true },

    name: { type: String, required: true },
    shortDescription: { type: String, default: "" },
    description: { type: String, default: "" }, // texte brut, tronqué
    cover: { type: String, default: null }, // image d'origine (souvent paysage)
    screenshots: { type: [String], default: [] },
    authors: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    genre: { type: String, default: null },
    // Les plateformes telles qu'itch les écrit : « Windows », « macOS »,
    // « Linux », « Android », « HTML5 »…
    platforms: { type: [String], default: [] },
    // « Released », « In development », « Prototype », « On hold »…
    status: { type: String, default: null },
    releaseDate: { type: Number, default: null }, // timestamp secondes, comme IGDB
    isFree: { type: Boolean, default: false },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    igdbId: { type: Number, default: null },
    resolvedAt: { type: Date, default: null },
    checkedAt: { type: Date, default: null },
    checks: { type: Number, default: 0 },
  },
  { timestamps: true }
);

itchGameSchema.index({ igdbId: 1, checkedAt: 1 });
// La recherche de secours (routes/games.js) cherche par nom quand IGDB ne
// trouve rien.
itchGameSchema.index({ name: 1 });

export default mongoose.model("ItchGame", itchGameSchema);
