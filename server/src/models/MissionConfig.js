import mongoose from "mongoose";

// ======================================================================
//  Retouches admin d'une mission : habillage + récompense, rien d'autre.
// ======================================================================
// Le CATALOGUE (quelles missions existent, et surtout à quelle CONDITION elles
// s'accomplissent) reste dans le code — lib/missions.js. On ne stocke ici que
// ce qu'un admin peut retoucher depuis le panel : titre, description, icône et
// nombre de points. Un champ à null = « garde la valeur du code ».
//
// Conséquence voulue : impossible de créer ou supprimer une mission depuis
// l'admin, et impossible d'en changer la condition. Une mission retirée du code
// laisse au pire une ligne orpheline ici, sans effet.
const missionConfigSchema = new mongoose.Schema(
  {
    missionKey: { type: String, required: true, unique: true },
    title: { type: String, default: null, maxlength: 60 },
    description: { type: String, default: null, maxlength: 200 },
    icon: { type: String, default: null, maxlength: 40 },
    points: { type: Number, default: null, min: 0, max: 100000 },
  },
  { timestamps: true }
);

export default mongoose.model("MissionConfig", missionConfigSchema);
