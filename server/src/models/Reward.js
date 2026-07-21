import mongoose from "mongoose";
import { RARITY_KEYS } from "../lib/rarity.js";

// ======================================================================
//  Un LOT gagnable dans une caisse (curseur, ornement, badge…).
// ======================================================================
// Le modèle est volontairement générique : `type` dit ce que c'est, et `data`
// porte ce qui est propre à ce type. Ajouter une famille de lots = ajouter une
// entrée dans REWARD_TYPES + un rendu côté client, SANS toucher au schéma.
//
//   cursor   → data: { url, hotspotX, hotspotY }  (image + point actif)
//   ornament → data: { url }                      (cadre autour de l'avatar)
//   badge    → data: { icon, color }              (pastille sur le profil)
export const REWARD_TYPES = {
  cursor: { label: "Curseur", plural: "Curseurs" },
  ornament: { label: "Ornement", plural: "Ornements" },
  badge: { label: "Badge", plural: "Badges" },
};
export const REWARD_TYPE_KEYS = Object.keys(REWARD_TYPES);

const rewardSchema = new mongoose.Schema(
  {
    // Slug stable : c'est LUI qu'on stocke dans l'inventaire des joueurs, pas
    // l'ObjectId — un lot supprimé puis recréé sous le même slug reste équipé.
    key: { type: String, required: true, unique: true, trim: true },
    type: { type: String, enum: REWARD_TYPE_KEYS, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", maxlength: 200 },
    rarity: { type: String, enum: RARITY_KEYS, default: "common" },

    // Poids de tirage propre à ce lot. null = celui de sa rareté (cas normal).
    weight: { type: Number, default: null },

    // Charge utile dépendante du `type` (voir plus haut).
    data: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Un lot désactivé ne sort plus des caisses, mais reste équipable par ceux
    // qui l'ont déjà gagné (on ne dépossède jamais un joueur).
    enabled: { type: Boolean, default: true },

    // ⚠ PROVISOIRE (démo vidéo) : le lot ainsi marqué sort de TOUTES les caisses
    // à chaque ouverture, en ignorant les poids. Un seul lot à la fois (le panel
    // admin démarque l'ancien). À retirer avant la mise en prod : ce champ, la
    // route /admin/demo-force, et le bloc « Tirage truqué » d'AdminRewards.
    demoForce: { type: Boolean, default: false },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

rewardSchema.index({ type: 1, rarity: 1 });

rewardSchema.methods.toPublic = function () {
  return {
    id: String(this._id),
    key: this.key,
    type: this.type,
    name: this.name,
    description: this.description || "",
    rarity: this.rarity,
    data: this.data || {},
    enabled: this.enabled,
  };
};

export default mongoose.model("Reward", rewardSchema);
