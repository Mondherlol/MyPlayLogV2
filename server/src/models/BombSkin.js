import mongoose from "mongoose";

// ======================================================================
//  La bombe de chacun (La Bombe, routes/bomb.js)
// ======================================================================
// Chaque joueur dessine le motif de SA bombe : quand c'est lui qui la tient,
// c'est sa bombe que toute la table voit. Sans dessin, une tête de mort.
//
// On garde deux choses :
//   - `png` : le dessin rendu (512 × 512, fond transparent), servi tel quel
//     en image (GET /api/bombe/skin/:id.png) ;
//   - `strokes` : les traits eux-mêmes, pour rouvrir le dessin et continuer
//     là où on l'avait laissé (annuler compris). C'est le même format que
//     celui du canevas de dessin (client/src/components/draw/DrawCanvas.jsx).
//
// `v` change à chaque enregistrement : il entre dans l'URL de l'image, ce qui
// permet de la mettre en cache pour un an sans jamais montrer l'ancienne.
const bombSkinSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    color: { type: String, default: "#1d1d23" },
    png: { type: Buffer, default: null },
    strokes: { type: mongoose.Schema.Types.Mixed, default: [] },
    v: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("BombSkin", bombSkinSchema);
