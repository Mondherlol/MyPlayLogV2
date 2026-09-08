import mongoose from "mongoose";

import { commentSchema } from "./List.js";

// ======================================================================
//  LA GRILLE DE BINGO D'UN RENDEZ-VOUS
// ======================================================================
//
// Ce qu'on fabrique ici est vieux comme les Directs : avant l'émission, on
// écrit ce qu'on espère voir — « quelque chose Metroid », « F-ZERO PLEASE
// NINTENDO » — et pendant, on coche. Ce qui rendait ça pénible, c'est qu'il
// fallait le faire à la main dans un éditeur d'images et le poster ailleurs.
//
// ⚠️ UNE SEULE GRILLE PAR PERSONNE ET PAR RENDEZ-VOUS, et c'est un index
// unique qui le garantit, pas une vérification applicative. Deux appuis rapides
// sur « créer » depuis deux écrans ouverts en même temps créeraient sinon deux
// grilles concurrentes, dont une seule serait ensuite retrouvée — l'autre
// deviendrait un pronostic fantôme, coché par personne.
//
// LES DEUX ÂGES D'UNE GRILLE. Avant le début de l'émission elle se compose et
// se recompose librement, mais rien ne se coche : cocher avant, c'est se
// féliciter d'une annonce qui n'a pas eu lieu. Une fois l'émission commencée,
// c'est l'inverse — la composition est gelée (sinon le jeu n'en est plus un :
// on ajouterait la case après l'annonce) et les cases se cochent. Cette bascule
// n'est PAS un champ du document : elle se déduit de l'heure de l'événement, et
// c'est la route qui l'applique (cf. routes/bingo.js, `editable`). Un drapeau
// stocké aurait demandé un travail de fond pour le retourner à l'heure dite —
// et un travail de fond qui ne tourne pas, c'est une grille qu'on peut encore
// modifier pendant le Direct.

const cellSchema = new mongoose.Schema(
  {
    // La position dans la grille, en lecture ligne par ligne. On stocke un
    // TABLEAU DENSE de `size * size` cases, vides comprises : une case vide est
    // un trou dans le dessin, elle doit donc exister comme les autres.
    index: { type: Number, required: true, min: 0, max: 24 },
    text: { type: String, default: "", maxlength: 120 },
    // L'image de fond. Soit une photo envoyée depuis le téléphone (servie par
    // /uploads/bingo), soit un visuel de jeu piqué à IGDB — dans les deux cas
    // une URL, le reste n'intéresse personne au moment de l'afficher.
    image: { type: String, default: null },
    // D'où vient l'image, quand elle vient d'un jeu. Sert au crédit (« Metroid
    // Prime 4 ») et, un jour, à ouvrir la fiche depuis la case.
    gameId: { type: Number, default: null },
    gameName: { type: String, default: "", maxlength: 120 },
    // La case offerte du milieu, celle qui est cochée d'avance. C'est la
    // convention du bingo et elle n'existe que sur les grilles impaires.
    free: { type: Boolean, default: false },
    checked: { type: Boolean, default: false },
    checkedAt: { type: Date, default: null },
  },
  { _id: false }
);

const bingoSchema = new mongoose.Schema(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GameEvent",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, default: "", maxlength: 80 },
    // De 2×2 à 5×5. Au-delà, les cases deviennent illisibles sur un téléphone
    // et personne ne trouve vingt-cinq pronostics à faire — c'est déjà beaucoup.
    size: { type: Number, default: 3, min: 2, max: 5 },
    cells: { type: [cellSchema], default: [] },
    // Publiée = visible par les autres. Une grille se compose souvent en
    // plusieurs fois : tant qu'elle n'est pas publiée, elle n'appartient qu'à
    // son auteur, et un brouillon à trois cases ne part pas dans le fil.
    published: { type: Boolean, default: false },
    publishedAt: { type: Date, default: null },
    likes: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
    // Le même schéma que les commentaires de liste (médias, mentions,
    // réponses, historique d'édition) : le fil du téléphone est le MÊME
    // composant, il attend donc exactement la même forme.
    comments: { type: [commentSchema], default: [] },
  },
  { timestamps: true }
);

bingoSchema.index({ event: 1, user: 1 }, { unique: true });
// Le classement de la page d'un rendez-vous : les grilles publiées, les plus
// aimées d'abord. `likeCount` n'existe pas — on trie en mémoire sur quelques
// dizaines de documents — mais l'index sert la sélection.
bingoSchema.index({ event: 1, published: 1, createdAt: -1 });

export default mongoose.models.EventBingo || mongoose.model("EventBingo", bingoSchema);
