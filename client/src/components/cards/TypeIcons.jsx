import {
  PiBoxingGloveFill,
  PiCompassFill,
  PiPuzzlePieceFill,
  PiDiamondFill,
  PiCrosshairFill,
  PiVolleyballFill,
  PiMusicNotesFill,
  PiJoystickFill,
  PiPlantFill,
  PiBookOpenFill,
} from "react-icons/pi";
import { GiJumpAcross, GiSwordsEmblem, GiChessKnight, GiCheckeredFlag } from "react-icons/gi";

// ======================================================================
//  Les icônes des types de cartes
// ======================================================================
// Toutes PLEINES : dans une pastille de 20 px, un pictogramme au trait se tasse
// et devient illisible. Deux familles de react-icons :
//   - Phosphor (« Pi », licence MIT), en version pleine ;
//   - Game Icons (« Gi », game-icons.net, licence CC BY 3.0 — crédités dans
//     les conditions d'utilisation) là où Phosphor n'a pas mieux : le saut de
//     plateforme, l'épée sur bouclier, le cavalier d'échecs, le drapeau à damier.

// Simulation : le losange de Phosphor, étiré en hauteur — le « plumbob » des Sims.
function Plumbob(props) {
  return <PiDiamondFill {...props} style={{ transform: "scale(0.78, 1.25)" }} />;
}

export const TYPE_ICONS = {
  combat: PiBoxingGloveFill,
  tir: PiCrosshairFill,
  plateforme: GiJumpAcross,
  aventure: PiCompassFill,
  rpg: GiSwordsEmblem,
  strategie: GiChessKnight,
  reflexion: PiPuzzlePieceFill,
  course: GiCheckeredFlag,
  sport: PiVolleyballFill,
  simulation: Plumbob,
  rythme: PiMusicNotesFill,
  arcade: PiJoystickFill,
  inde: PiPlantFill,
  recit: PiBookOpenFill,
};
