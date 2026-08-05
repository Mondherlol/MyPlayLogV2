import mongoose from "mongoose";

// ======================================================================
//  Réglages de l'application — un magasin clé/valeur, et rien de plus
// ======================================================================
// Ce qui se règle DEPUIS L'APP (contrairement aux secrets, qui vivent dans le
// .env et demandent un accès serveur) : les drapeaux de fonctionnalités, les
// petits choix d'exploitation. Une ligne par réglage, la valeur libre.
//
// C'est volontairement minuscule : le jour où il y aura dix drapeaux, ils
// tiendront tous ici sans qu'on ait à inventer un modèle par sujet.

const appSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    // Qui a changé quoi, la dernière fois : de quoi comprendre pourquoi une
    // page a disparu sans avoir à fouiller les journaux.
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("AppSetting", appSettingSchema);
