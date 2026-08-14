// ======================================================================
//  La voix du bot dans le navigateur
// ======================================================================
// `speechSynthesis`, l'API de lecture vocale native : aucune dépendance, aucun
// fichier audio à fabriquer côté serveur, et toutes les voix installées sur la
// machine sont disponibles. Le serveur n'envoie donc qu'un texte (voir
// lib/botTts.js), jamais du son.
//
// DEUX PIÈGES, tous les deux rencontrés en vrai avec cette API :
//
//   1. LES VOIX ARRIVENT EN RETARD. Au premier appel, `getVoices()` renvoie
//      souvent une liste VIDE — elles sont chargées de façon asynchrone par le
//      navigateur. Sans l'attente ci-dessous, la toute première phrase de la
//      session est prononcée avec la voix par défaut (anglaise, sur beaucoup
//      d'installations), ce qui rend le français incompréhensible.
//   2. IL FAUT UN GESTE PRÉALABLE. Chrome refuse de parler tant que
//      l'utilisateur n'a rien cliqué sur la page. On ne peut pas le
//      contourner ; on se contente de ne pas planter, et le message reste
//      affiché à l'écran (la bulle du bot), donc rien n'est perdu.

let voicesReady = null;

function loadVoices() {
  if (voicesReady) return voicesReady;
  voicesReady = new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) return resolve([]);
    const now = synth.getVoices();
    if (now.length) return resolve(now);
    const onChange = () => {
      synth.removeEventListener("voiceschanged", onChange);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", onChange);
    // Filet : certains navigateurs n'émettent jamais l'évènement.
    setTimeout(() => resolve(synth.getVoices()), 1200);
  });
  return voicesReady;
}

// La meilleure voix française disponible. On préfère une voix locale (elle ne
// dépend pas du réseau et démarre instantanément) et, à qualité égale, une voix
// masculine — le personnage est un type qui gueule dans un salon.
async function frenchVoice() {
  const voices = await loadVoices();
  const fr = voices.filter((v) => /^fr(-|_|$)/i.test(v.lang));
  if (!fr.length) return null;
  return (
    fr.find((v) => v.localService && /thomas|paul|nicolas|male/i.test(v.name)) ||
    fr.find((v) => v.localService) ||
    fr[0]
  );
}

// Prononce un texte. Rend `true` si la lecture a été lancée.
export async function speak(text, { rate = 1.05, pitch = 0.9 } = {}) {
  const synth = window.speechSynthesis;
  if (!synth || !text) return false;
  try {
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 400));
    const voice = await frenchVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang || "fr-FR";
    // Un peu plus vite et un peu plus grave que le réglage par défaut : la voix
    // par défaut fait « lecteur de documentation », et le personnage non.
    u.rate = rate;
    u.pitch = pitch;
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

// Le message du bot, en deux temps : la phrase de l'expéditeur, puis la
// remarque du bot quand il y en a une. Deux énoncés distincts et non une seule
// phrase collée : la synthèse marque une vraie pause entre les deux, ce qui
// s'entend comme « untel te dit ça… » puis le commentaire.
export async function speakTts({ text, remark }) {
  const ok = await speak(text);
  if (ok && remark) await speak(remark, { rate: 1, pitch: 0.85 });
  return ok;
}
