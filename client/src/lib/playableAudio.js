import { apiUploadForBlob } from "./api";

// ======================================================================
//  Rendre un fichier audio décodable par le navigateur
// ======================================================================
// Le dépôt d'un son du Perroquet suppose que le NAVIGATEUR sache décoder le
// fichier : le rogneur (components/AudioTrimmer.jsx) dessine la forme d'onde
// depuis un AudioBuffer, et le son sera ensuite rejoué en partie dans un
// `<audio>`. Or l'AMR des mémos vocaux Android n'est décodé par aucun
// navigateur, et ne le sera pas.
//
// Plutôt que de tester une liste de formats — qui serait fausse dès le prochain
// navigateur — ON ESSAIE DE DÉCODER. C'est la seule question qui compte
// (« celui-ci y arrive-t-il ? »), elle se pose au moteur lui-même, et elle
// couvre du même coup tous les formats exotiques qu'on n'a pas prévus. En cas
// d'échec, le serveur transcode en mp3 (ffmpeg décode l'AMR sans problème) et on
// repart avec un fichier ordinaire : la suite du dépôt ne sait même pas qu'il y
// a eu une conversion.

// Le décodage complet d'un fichier de trois minutes coûte quelques dizaines de
// millisecondes ; c'est le prix d'une question à laquelle on répond juste.
async function decodable(file) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return false;
  const ctx = new Ctx();
  try {
    await ctx.decodeAudioData(await file.arrayBuffer());
    return true;
  } catch {
    return false;
  } finally {
    ctx.close().catch(() => {});
  }
}

/**
 * Rend le fichier tel quel s'il est décodable, sinon sa version mp3 convertie
 * par le serveur. Lève une erreur porteuse d'un message affichable si même
 * ffmpeg n'en tire rien.
 *
 * `onConverting` est appelé quand une conversion démarre : l'attente est visible
 * (un aller-retour réseau plus un ffmpeg), il faut pouvoir le dire à l'écran.
 */
export async function playableAudioFile(file, token, { onConverting } = {}) {
  if (await decodable(file)) return file;

  onConverting?.();
  const fd = new FormData();
  fd.append("clip", file, file.name || "memo");
  const mp3 = await apiUploadForBlob("/perroquet/sounds/convert", fd, token);

  // On garde le nom d'origine (sans son extension) : c'est lui qui pré-remplit
  // le nom du son dans le formulaire, et « memo-vocal-3 » vaut mieux que
  // « converti ».
  const base = (file.name || "son").replace(/\.[^.]+$/, "");
  return new File([mp3], `${base}.mp3`, { type: "audio/mpeg" });
}
