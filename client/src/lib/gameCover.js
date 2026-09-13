import { safeSetItem } from "./storage";

// ======================================================================
//  La jaquette CHOISIE pour un jeu, sur cet appareil
// ======================================================================
// IGDB n'a qu'une jaquette par jeu, et ce n'est pas toujours celle de l'édition
// qu'on a sur son étagère. En choisir une autre est un goût : elle est donc
// retenue LOCALEMENT, et elle prime sur celle du catalogue.
//
// ⚠️ ET DANS LA BIBLIOTHÈQUE QUAND LE JEU Y EST. L'entrée porte sa propre
// jaquette (c'est elle que voient les grilles de profil, ici comme sur le
// téléphone) : la changer sans la pousser au serveur ne l'aurait changée que
// sur la fiche, et l'appareil aurait raconté deux choses à la fois.
//
// La clé vit ici plutôt que dans la fiche du jeu : le menu contextuel d'une
// jaquette permet d'en changer sans ouvrir la fiche (cf.
// components/GameContextMenu), et deux définitions du même nom de clé, c'est
// un jour où l'une des deux écrit à côté.
export function coverKey(id) {
  return `mpl_cover_${id}`;
}

export function readCover(id) {
  try {
    return localStorage.getItem(coverKey(id)) || null;
  } catch {
    return null;
  }
}

export function writeCover(id, url) {
  safeSetItem(coverKey(id), url);
}

// ======================================================================
//  La MÊME jaquette, en plus grand
// ======================================================================
// ⚠️ IGDB SERT UNE IMAGE, PAS UNE TAILLE. L'identifiant d'une jaquette est
// dans l'URL ; la taille n'est qu'un segment de chemin qu'on remplace, et le
// serveur redécoupe à la volée. Presque tout le back demande `t_cover_big`
// (264×374) parce que c'est ce qu'il faut pour une vignette de grille — mais
// la même URL affichée à 260 px sur un écran à 2× ou en grand dans une
// visionneuse est alors floue, et c'est ce flou qu'on voyait partout.
//
// On ne touche donc à rien côté serveur : on demande la bonne taille AU MOMENT
// DE L'AFFICHAGE, là où on sait à quelle taille on dessine.
//   t_cover_big_2x — 528×748, la jaquette d'une fiche sur un écran à 2×
//   t_1080p        — la plus grande que sert IGDB, pour la visionneuse
// Une jaquette importée par le joueur (notre propre stockage) n'a pas de
// segment de taille : elle ressort telle quelle.
export function coverAtSize(url, size = "t_cover_big_2x") {
  if (!url || typeof url !== "string") return url;
  if (!url.includes("images.igdb.com")) return url;
  return url.replace(/\/t_[a-z0-9_]+\//i, `/${size}/`);
}
