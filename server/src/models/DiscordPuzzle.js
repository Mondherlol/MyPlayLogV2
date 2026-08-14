import mongoose from "mongoose";

// ======================================================================
//  Une manche de « lettres mêlées » jouée sur Discord
// ======================================================================
// MINECRAFT → RFTAINEM, et le premier qui retrouve le titre marque. Un
// document par manche : c'est lui qui porte la solution (jamais envoyée dans
// le salon, évidemment), qui dit si elle est déjà trouvée, et qui sert ensuite
// à dresser le classement du serveur — pas besoin d'une seconde collection de
// scores, le classement est une agrégation de ces manches.
//
// LE POINT DÉLICAT EST LE GAGNANT NON LIÉ. Quelqu'un peut très bien trouver le
// titre sans avoir de compte MyPlayLog rattaché à son Discord. On enregistre
// alors la victoire avec `user: null` et `pending: true` : les points ne sont
// pas perdus, ils attendent. Le jour où cette personne lie son compte, on
// solde l'ardoise (claimPendingPoints). C'est ce qui permet au bot de dire
// « tes points t'attendent » au lieu de « tant pis pour toi » — la première
// phrase donne envie de lier son compte, la seconde donne envie de partir.
const discordPuzzleSchema = new mongoose.Schema(
  {
    guildId: { type: String, default: null }, // null = message privé Discord
    channelId: { type: String, required: true },
    messageId: { type: String, default: null }, // le message qui porte la grille

    // La solution. `gameId` sert à comparer par identifiant IGDB quand le
    // joueur passe par une suggestion, `gameName` au reste du temps.
    gameId: { type: Number, required: true },
    gameName: { type: String, required: true },
    cover: { type: String, default: null },

    // Ce qui est affiché : les lettres mélangées et la forme du titre.
    letters: { type: String, required: true },
    words: { type: [Number], default: [] },
    // Combien de lettres ont déjà été révélées par « !indice ». Les indices ne
    // coûtent rien en points : une manche bloquée ne rapporte rien à personne.
    hints: { type: Number, default: 0 },

    solvedAt: { type: Date, default: null },
    solver: {
      discordId: { type: String, default: null },
      username: { type: String, default: null },
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    points: { type: Number, default: 0 },
    // Victoire dont les points n'ont pas encore été crédités (compte non lié).
    pending: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// La manche en cours d'un salon (il n'y en a qu'une à la fois).
discordPuzzleSchema.index({ channelId: 1, solvedAt: 1, createdAt: -1 });
// Le classement d'un serveur, et le plafond quotidien d'un joueur.
discordPuzzleSchema.index({ guildId: 1, solvedAt: -1 });
discordPuzzleSchema.index({ "solver.discordId": 1, solvedAt: -1 });
// Les ardoises à solder quand quelqu'un lie enfin son compte.
discordPuzzleSchema.index({ pending: 1, "solver.discordId": 1 });

export default mongoose.model("DiscordPuzzle", discordPuzzleSchema);
