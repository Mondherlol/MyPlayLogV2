// ======================================================================
//  Bruitages courts, synthétisés à la volée (Web Audio) — aucun fichier.
// ======================================================================
// Pas de .mp3 à charger : les sons sont générés par oscillateurs, donc ils
// pèsent zéro octet, ne cassent jamais un déploiement et sonnent identiques
// hors ligne. Toujours déclenchés par un geste utilisateur (clic), ce qui
// satisfait les politiques d'autoplay des navigateurs.

const MUTE_KEY = "mpl_sfx_muted";

let ctx = null;

// L'AudioContext se crée paresseusement, au premier son : en créer un au
// chargement le laisse « suspended » et pollue la console.
function audio() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  // Revenu d'un onglet en arrière-plan : le contexte peut être suspendu.
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function isSfxMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSfxMuted(muted) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// LE PAPIER EST ENREGISTRÉ, PAS SYNTHÉTISÉ — et c'est la seule exception du
// fichier. Un bip, un relais, un arpège ONT une hauteur : une formule les
// écrit. Une feuille qui se retourne n'en a aucune — c'est un frottement, un
// grain, un claquement d'air —, et aucun filtre de bruit ne fait illusion plus
// de trois pages. Ces sept prises (freesound, communauté) pèsent 95 Ko à elles
// toutes, se téléchargent une fois et se rejouent depuis la mémoire.
//
// EN AJOUTER UNE : la déposer dans `public/sfx/turning_page/` et écrire son nom
// ici. Le tirage et le sac s'adaptent tout seuls.
const PAPER = [
  "1pX4dkeX",
  "42uVrgv6",
  "4fbMOt22",
  "I0sYqCQh",
  "SDfBiVoP",
  "sWAN4tch",
  "y5foysnr",
].map((id) => `/sfx/turning_page/freesound-community-book-page-turning-95959_${id}.mp3`);

// Les prises décodées, à leur rang dans `PAPER`. Une case vide = une prise qui
// n'est pas (encore) arrivée : le tirage l'ignore, il ne l'attend pas.
const sheets = [];
let loading = null;

// LES PRISES ARRIVENT AVANT LE GESTE. Décoder un mp3 prend quelques
// millisecondes de trop : demandées à la première page tournée, elles la
// laisseraient muette — et la première est celle qui donne le ton. Les lecteurs
// appellent donc ceci à l'ouverture, pendant que le volume fait son vol.
//
// (L'AudioContext naît ici, donc hors du clic — il démarre « suspended » et se
// réveille au premier son, ce dont `audio()` se charge déjà. Le décodage, lui,
// n'en a pas besoin.)
export function primePaperSounds() {
  if (loading || isSfxMuted()) return loading;
  const ac = audio();
  if (!ac) return null;
  loading = Promise.all(
    PAPER.map(async (url, i) => {
      try {
        const res = await fetch(url);
        sheets[i] = await ac.decodeAudioData(await res.arrayBuffer());
      } catch {
        /* une prise manquante : le sac tire parmi les six autres */
      }
    })
  );
  return loading;
}

// LE SAC, ET POURQUOI PAS UN TIRAGE AU HASARD. Sept prises tirées au sort
// redonnent la même deux fois de suite une fois sur sept — et c'est
// précisément ce coup-là qui trahit l'échantillon : tant qu'elles alternent,
// on entend du papier ; répétée à l'identique, on entend un fichier. On tire
// donc SANS REMISE — les sept passent avant qu'aucune ne revienne —, et à la
// couture entre deux sacs on écarte la prise qui vient de sortir. Deux fois
// d'affilée devient alors impossible, pas seulement improbable.
let bag = [];
let last = -1;
function draw() {
  if (!bag.length) {
    bag = PAPER.map((_, i) => i).filter((i) => sheets[i]);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    // On tire par la fin : c'est donc la dernière case qui sort en premier.
    if (bag.length > 1 && bag[bag.length - 1] === last)
      [bag[bag.length - 1], bag[0]] = [bag[0], bag[bag.length - 1]];
  }
  if (!bag.length) return null;
  last = bag.pop();
  return sheets[last];
}

// Une prise lâchée telle quelle : pas d'enveloppe, la feuille en a déjà une —
// elle a été enregistrée, pas fabriquée. `rate` sert autant à varier la
// hauteur qu'à changer d'objet : ralentie, la même feuille devient une
// couverture.
function shot(ac, buf, { at, gain = 1, rate = 1 }) {
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const env = ac.createGain();
  env.gain.value = gain;
  src.connect(env).connect(ac.destination);
  src.start(at ?? ac.currentTime);
}

// Une note : oscillateur + enveloppe douce (attaque courte, longue descente)
// pour éviter le « clic » d'un démarrage/arrêt brutal.
function note(ac, { freq, start, dur, gain = 0.16, type = "triangle" }) {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(gain, start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(env).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

// Message reçu : deux notes claires qui montent (une tierce), courtes et
// discrètes — le « toc-ding » d'une messagerie, pas une fanfare.
export function playMessageSound() {
  if (isSfxMuted()) return;
  try {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.01;
    // La5 → Do#6, en sinus : rond, jamais agressif même à répétition.
    note(ac, { freq: 880, start: t, dur: 0.12, gain: 0.1, type: "sine" });
    note(ac, { freq: 1108.73, start: t + 0.09, dur: 0.22, gain: 0.09, type: "sine" });
  } catch {
    /* le son est un bonus : jamais bloquant */
  }
}

// Message envoyé : une seule note brève et basse, en retrait — on confirme
// l'envoi sans jamais couvrir le son de réception.
export function playSentSound() {
  if (isSfxMuted()) return;
  try {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.01;
    note(ac, { freq: 523.25, start: t, dur: 0.1, gain: 0.05, type: "sine" });
  } catch {
    /* idem */
  }
}

// Bouton de la télé cathodique (Collection) : le « clac » sec d'une touche
// mécanique. Un carré très bref et très bas, presque pas une note — juste de
// la matière, pour que la carrosserie ait du poids sous le doigt.
export function playClackSound() {
  if (isSfxMuted()) return;
  try {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.005;
    note(ac, { freq: 165, start: t, dur: 0.05, gain: 0.07, type: "square" });
    note(ac, { freq: 92, start: t + 0.008, dur: 0.07, gain: 0.05, type: "triangle" });
  } catch {
    /* idem */
  }
}

// Allumage / extinction du tube : le coup sourd du relais, doublé du sifflement
// aigu de la haute tension qui monte (allumage) ou retombe (extinction).
export function playTubeSound(on = true) {
  if (isSfxMuted()) return;
  try {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.01;
    note(ac, { freq: on ? 70 : 55, start: t, dur: 0.16, gain: 0.09, type: "triangle" });

    // Le sifflement : un glissando, donc on ne peut pas passer par note().
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(on ? 3200 : 15600, t);
    osc.frequency.exponentialRampToValueAtTime(on ? 15600 : 2400, t + 0.34);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.022, t + 0.06);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    osc.connect(env).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.38);
  } catch {
    /* idem */
  }
}

// ---------------------------------------------------------------- papier --
//
// COMBIEN FORT. Les deux seuls réglages à toucher si le papier est trop
// présent ou trop timide : les prises sont lâchées telles quelles, c'est donc
// ici et nulle part ailleurs que se règle le volume du rayon.
const PAGE_GAIN = 0.6; // une page qu'on tourne pour la lire
const RIFFLE_GAIN = 0.26; // la même, feuilletée au pouce (défilé, règle tirée)

// LE VOLUME QU'ON OUVRE (Collection). Trois temps, et ils sont dans cet ordre
// parce que c'est celui du geste : le dos qui CRAQUE en se dépliant, le bloc de
// pages qui se déploie, puis la couverture qui SE POSE de l'autre côté. Le tout
// tient dans le temps d'ouverture de la scène 3D (OPEN_TIME, ~0,95 s) : le
// silence retombe quand le volume est à plat.
export function playBookOpenSound() {
  if (isSfxMuted()) return;
  try {
    const ac = audio();
    if (!ac) return;
    primePaperSounds();
    const t = ac.currentTime + 0.01;
    // Le dos, et lui seul reste synthétisé : ce n'est pas du papier, c'est une
    // charnière et de la colle qui cède. Deux basses très courtes le disent
    // mieux qu'aucune prise de feuille.
    note(ac, { freq: 96, start: t, dur: 0.15, gain: 0.055, type: "triangle" });
    note(ac, { freq: 61, start: t + 0.03, dur: 0.22, gain: 0.045, type: "sine" });
    // LE BLOC QUI SE DÉPLOIE : deux prises RALENTIES et décalées. Une seule
    // feuille au ralenti s'entend comme une feuille au ralenti ; deux qui se
    // chevauchent à des vitesses différentes s'entendent comme une ÉPAISSEUR —
    // ce qui est exactement ce qui s'ouvre.
    const a = draw();
    const b = draw();
    if (a) shot(ac, a, { at: t + 0.02, gain: PAGE_GAIN * 0.85, rate: 0.72 });
    if (b) shot(ac, b, { at: t + 0.17, gain: PAGE_GAIN * 0.55, rate: 0.88 });
    // Le plat qui retombe de l'autre côté, et le poids qui s'installe.
    note(ac, { freq: 118, start: t + 0.62, dur: 0.1, gain: 0.03, type: "triangle" });
  } catch {
    /* le son est un bonus : jamais bloquant */
  }
}

// DEUX PAGES NE SE TOURNENT PAS À CINQ MILLISECONDES D'INTERVALLE. Le défilé
// rapide (flèche maintenue) et le curseur de la règle en demandent des dizaines
// par seconde : sans ce plancher, ce n'est plus un feuilletage mais un
// grésillement, et autant de sources audio empilées pour rien. À ce seuil, les
// froissements se chevauchent encore — c'est exactement le bruit d'un pouce
// qui fait défiler la tranche.
const TURN_GAP = 55;
let lastTurn = 0;

// UNE PAGE QUI SE TOURNE : une prise, tirée du sac.
//
// Et deux tours de main par-dessus, parce que sept prises finissent quand même
// par s'entendre comme sept prises au bout d'un volume entier : un rien de
// vitesse (±4 %, sous le seuil où l'on entend un changement de HAUTEUR, juste
// assez pour que la feuille ne soit jamais tout à fait la même) et un rien de
// volume. Ce n'est plus un catalogue de sept sons, c'est du papier.
//
// `soft` : la même feuille passée au pouce — plus vive, deux fois plus
// discrète. C'est ce qu'on entend quand on CHERCHE une planche au lieu de la
// lire (défilé rapide, règle tirée).
export function playPageTurnSound({ soft = false } = {}) {
  if (isSfxMuted()) return;
  const now = typeof performance === "undefined" ? Date.now() : performance.now();
  if (now - lastTurn < TURN_GAP) return;
  lastTurn = now;
  try {
    const ac = audio();
    if (!ac) return;
    // Premier appel : les prises partent au téléchargement et celui-ci reste
    // muet. En pratique les lecteurs ont déjà amorcé à l'ouverture — c'est
    // tout l'objet de `primePaperSounds`.
    primePaperSounds();
    const buf = draw();
    if (!buf) return;
    shot(ac, buf, {
      rate: (soft ? 1.28 : 1) * (0.96 + Math.random() * 0.08),
      gain: (soft ? RIFFLE_GAIN : PAGE_GAIN) * (0.9 + Math.random() * 0.2),
    });
  } catch {
    /* idem */
  }
}

// ---------------------------------------------------- top de départ (séance) --
//
// LE DÉCOMPTE D'UNE SÉANCE PARTAGÉE S'ENTEND AUTANT QU'IL SE VOIT — et ce n'est
// pas de la décoration : quand le lecteur ne se pilote pas, ce son EST la
// synchronisation. On regarde son propre lecteur, pas notre décompte ; il faut
// donc pouvoir appuyer sur lecture les yeux ailleurs, à l'oreille.
//
// Trois secondes de bips secs, puis un accord qui s'ouvre : la différence de
// timbre entre les deux est ce qui fait partir tout le monde sur la même image.

// Le tic : une note courte et sèche, montante d'un demi-ton à chaque seconde
// (3 → 2 → 1). Cette montée dit « ça approche » sans qu'on ait à lire le chiffre.
export function playCueTick(remaining = 3) {
  if (isSfxMuted()) return;
  try {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.005;
    const step = Math.max(0, 3 - remaining); // 3→0, 2→1, 1→2
    const freq = 660 * 2 ** (step / 12);
    note(ac, { freq, start: t, dur: 0.07, gain: 0.075, type: "square" });
    note(ac, { freq: freq / 2, start: t, dur: 0.09, gain: 0.045, type: "triangle" });
  } catch {
    /* le son est un bonus : jamais bloquant */
  }
}

// Le départ : trois notes qui s'ouvrent d'un coup (quinte + octave), plus
// franches et plus longues que les tics. C'est le « clap » de la séance.
export function playCueGo() {
  if (isSfxMuted()) return;
  try {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.005;
    note(ac, { freq: 523.25, start: t, dur: 0.3, gain: 0.11 });
    note(ac, { freq: 783.99, start: t + 0.02, dur: 0.34, gain: 0.1 });
    note(ac, { freq: 1046.5, start: t + 0.05, dur: 0.42, gain: 0.09, type: "sine" });
  } catch {
    /* idem */
  }
}

// ------------------------------------------------------ Mot du jour (chauffe) --
//
// LE SON EST L'INDICATEUR LE PLUS RAPIDE : on tape un mot, on lit le degré, mais
// l'oreille sait AVANT l'œil si on a progressé. La hauteur de la note monte donc
// avec la température — deux essais d'affilée et on entend qu'on brûle.
//
// Une octave et demie de plage : ~260 Hz quand c'est glacial, ~1050 Hz quand on
// y est presque. La quinte d'accompagnement n'apparaît que dans le haut du
// registre, pour que « chaud » sonne plus riche et pas seulement plus aigu.
export function playHeatTick(temp = 0) {
  if (isSfxMuted()) return;
  try {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.005;
    const p = Math.min(Math.max(Number(temp) || 0, 0), 100) / 100;
    const freq = 260 * 2 ** (p * 2); // 260 Hz → 1040 Hz
    note(ac, { freq, start: t, dur: 0.075, gain: 0.07, type: "square" });
    note(ac, { freq: freq / 2, start: t, dur: 0.1, gain: 0.035, type: "triangle" });
    // Au-delà de « tiède », une quinte juste vient épaissir le tic.
    if (p >= 0.5) {
      note(ac, { freq: freq * 1.5, start: t + 0.01, dur: 0.09, gain: 0.03 * p, type: "sine" });
    }
  } catch {
    /* le son est un bonus : jamais bloquant */
  }
}

// Mot inconnu du dictionnaire : un « toc » mat et grave, sans hauteur
// identifiable. Il ne doit surtout pas ressembler à un tic de chauffe — ce
// n'est pas un essai raté, c'est un essai qui n'a pas eu lieu.
export function playRejectSound() {
  if (isSfxMuted()) return;
  try {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.005;
    note(ac, { freq: 150, start: t, dur: 0.09, gain: 0.07, type: "square" });
    note(ac, { freq: 96, start: t + 0.015, dur: 0.11, gain: 0.05, type: "triangle" });
  } catch {
    /* idem */
  }
}

// Récompense récupérée : petit arpège ascendant façon pièce ramassée, avec une
// quinte finale tenue pour la sensation de « ça y est, c'est à moi ».
export function playRewardSound() {
  if (isSfxMuted()) return;
  try {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.01;
    // Mi5 → Sol#5 → Si5 → Mi6 (accord majeur qui monte)
    note(ac, { freq: 659.25, start: t, dur: 0.13 });
    note(ac, { freq: 830.61, start: t + 0.07, dur: 0.13 });
    note(ac, { freq: 987.77, start: t + 0.14, dur: 0.16 });
    note(ac, { freq: 1318.51, start: t + 0.22, dur: 0.42, gain: 0.13 });
    // Pointe de brillance très discrète, une octave au-dessus.
    note(ac, { freq: 2637.02, start: t + 0.22, dur: 0.3, gain: 0.035, type: "sine" });
  } catch {
    /* le son est un bonus : jamais bloquant */
  }
}
