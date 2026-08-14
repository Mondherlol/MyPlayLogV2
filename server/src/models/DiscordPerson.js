import mongoose from "mongoose";

// ======================================================================
//  Le carnet d'adresses du bot, par serveur Discord
// ======================================================================
// « Eve » sur Discord s'appelle Aletheia dans la vraie vie, et tout le monde
// dans le salon le sait sauf le bot. Résultat, il répond à côté : il parle à
// « Eve » quand les autres parlent d'« Aletheia », et il ne comprend pas qu'on
// s'adresse à la même personne.
//
// Ce carnet corrige les deux sens à la fois :
//   • le NOM PRINCIPAL est celui que le bot emploie quand il parle de
//     quelqu'un (Aletheia), quel que soit son pseudo Discord du moment ;
//   • les SURNOMS sont ce qu'il doit reconnaître dans les messages des autres
//     (Eve, Evie…) comme désignant cette même personne.
//
// PAR SERVEUR, et pas globalement : le même pseudo peut désigner deux personnes
// différentes sur deux serveurs, et les surnoms d'une bande ne regardent pas
// les autres.
//
// `discordId` est FACULTATIF : on veut aussi pouvoir décrire quelqu'un qui
// n'est pas (ou plus) sur le serveur mais dont on parle sans arrêt.
const discordPersonSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    discordId: { type: String, default: null },

    // Ce que le bot dit. C'est la seule valeur obligatoire.
    name: { type: String, required: true, maxlength: 60 },
    // Ce que le bot comprend. Stockés tels que saisis (l'affichage compte),
    // comparés sans accent ni casse (voir lib/discordNames.js).
    aliases: { type: [String], default: [] },

    // Qui a configuré, pour pouvoir remonter à la source d'une bêtise.
    updatedBy: { type: String, default: null },
  },
  { timestamps: true }
);

// Un membre n'a qu'une fiche par serveur. L'index partiel laisse coexister
// autant de fiches « sans identifiant » qu'on veut (les gens de l'extérieur),
// là où un index unique simple les aurait toutes refusées sauf une.
discordPersonSchema.index(
  { guildId: 1, discordId: 1 },
  { unique: true, partialFilterExpression: { discordId: { $type: "string" } } }
);
discordPersonSchema.index({ guildId: 1, name: 1 });

export default mongoose.model("DiscordPerson", discordPersonSchema);
