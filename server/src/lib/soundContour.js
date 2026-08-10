import { execFile } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

// ======================================================================
//  Contour d'un son — et comparaison de deux imitations
// ======================================================================
// Le cœur du Perroquet. Tout le jeu tient à une question : « à quel point ce
// que cette personne vient de crier ressemble-t-il au cri de Yoshi ? »
//
// ------------------------------------------------- CE QUI NE MARCHE PAS
// La réponse naïve — comparer les deux fichiers audio — donne un jeu qui a
// l'air de fonctionner et qui distribue les points au hasard. Un cri de Yoshi
// est un échantillon synthétisé ; une imitation sort d'un larynx humain via un
// micro de téléphone. Le TIMBRE des deux n'a rigoureusement rien en commun :
// une comparaison de spectres (MFCC, corrélation croisée) sort des scores tous
// écrasés vers zéro, et le classement final n'est plus que du bruit. C'est le
// piège principal de ce jeu, et il est silencieux.
//
// ------------------------------------------------------ CE QUI MARCHE
// On JETTE le timbre et on garde la FORME. Quand une oreille humaine dit « ah
// ouais, il l'a bien eu », elle ne compare pas des harmoniques : elle compare
//
//   1. la courbe de hauteur — ça monte, ça descend, ça fait deux bosses ?
//   2. l'enveloppe de volume — attaque sèche ou progressive, une syllabe ou
//      trois ?
//   3. la durée.
//
// Ces trois-là survivent au changement de timbre, et ce sont exactement les
// trois qu'on sait imiter avec sa voix. D'où ce fichier.
//
// ------------------------------------------------ pourquoi côté SERVEUR
// Tout ceci pourrait se calculer dans le navigateur (la Web Audio API sait
// tout faire) et n'enverrait qu'une centaine de nombres au lieu d'un fichier.
// On ne le fait pas : un score calculé par le client est un score que le client
// peut écrire lui-même. Et comme on veut de toute façon REJOUER les tentatives
// de tout le monde à la fin de la manche (c'est là qu'est le plaisir du mode à
// plusieurs, pas dans le score), le fichier doit monter au serveur. Autant
// mesurer là où c'est incontestable.

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";

// 16 kHz mono : au-dessus de 8 kHz il n'y a rien qui nous intéresse (on cherche
// une fondamentale entre 70 et 1400 Hz), et ça divise le décodage par trois.
const RATE = 16000;

// Fenêtre d'analyse et pas d'avance. 40 ms tient deux périodes complètes même
// pour une voix grave à 70 Hz — en dessous, l'autocorrélation n'a pas de quoi
// travailler et se met à octavier.
const WIN = Math.round(0.04 * RATE); // 640 échantillons
const HOP = Math.round(0.01 * RATE); // 160 échantillons → une mesure / 10 ms

// Bornes de recherche de la fondamentale. Large exprès : on couvre la basse
// masculine (~70 Hz) jusqu'aux couinements de Kirby, aux cris de Pokémon et aux
// jingles de pièce, qui montent volontiers vers 1300 Hz.
//
// LE PLAFOND N'EST PAS DÉCORATIF. À 1000 Hz, un son plus aigu que la borne ne
// pouvait pas être détecté du tout : l'autocorrélation se rabattait sur des
// sous-harmoniques, en sautant d'une octave à l'autre au fil des trames. Le
// contour obtenu n'était pas « imprécis », il était FAUX — une pièce qui monte
// ressortait comme une chute de sept demi-tons, avec une amplitude de trois
// octaves. Et rien ne le signalait : le taux de voisement restait à 100 %.
const F0_MIN = 70;
const F0_MAX = 1400;
const LAG_MIN = Math.floor(RATE / F0_MAX);
const LAG_MAX = Math.floor(RATE / F0_MIN);

// Seuil de « voisement » : en deçà de cette clarté d'autocorrélation, la trame
// n'a pas de hauteur franche (souffle, consonne, silence) et sa hauteur est
// déclarée inconnue plutôt que devinée.
const CLARITY_MIN = 0.3;

// Une trame compte comme du SON si son volume dépasse ce ratio du pic. Sert à
// rogner le silence aux deux bouts : sans ça, une personne qui laisse tourner
// le micro deux secondes avant de crier voit son contour décalé, et perd des
// points pour une raison qui n'a rien à voir avec son imitation.
const GATE = 0.12;

// Longueur du contour normalisé. 64 points suffisent à décrire la mélodie d'un
// cri d'une seconde et demie, et rendent la comparaison instantanée.
export const POINTS = 64;

// Au-delà, ffmpeg est parti en vrille (fichier corrompu, flux interminable).
const DECODE_TIMEOUT_MS = 20000;

// ============================================================
//  1. Décodage
// ============================================================
// ffmpeg rend du PCM flottant brut sur sa sortie standard. On ne passe PAS par
// un fichier intermédiaire : les clips font une poignée de secondes, tout tient
// en mémoire, et ça évite d'avoir à nettoyer derrière soi.
function decodePcm(file) {
  return new Promise((resolve, reject) => {
    execFile(
      FFMPEG,
      [
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "error",
        "-i",
        file,
        "-ac",
        "1",
        "-ar",
        String(RATE),
        // Bornage dur : un fichier de 30 s ne devrait pas arriver ici, et s'il
        // arrive, il ne doit pas faire exploser le tampon.
        "-t",
        "15",
        "-f",
        "f32le",
        "-",
      ],
      { timeout: DECODE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" },
      (err, stdout) => {
        if (err && !stdout?.length)
          return reject(new Error(String(err.message).slice(0, 200)));
        if (!stdout?.length) return reject(new Error("flux audio vide"));
        // Le Buffer de Node n'est pas forcément aligné sur 4 octets : on ne peut
        // pas construire un Float32Array par-dessus sans risquer un throw. La
        // copie coûte quelques centaines de Ko, elle est sans histoire.
        const n = Math.floor(stdout.length / 4);
        const out = new Float32Array(n);
        for (let i = 0; i < n; i += 1) out[i] = stdout.readFloatLE(i * 4);
        resolve(out);
      }
    );
  });
}

// ============================================================
//  2. Hauteur, trame par trame
// ============================================================
// Autocorrélation normalisée. On cherche le décalage qui fait le mieux
// ressembler le signal à lui-même : c'est la période, donc la hauteur.
//
// La normalisation par l'énergie des deux fenêtres (et non par la seule
// première) est ce qui rend `clarity` comparable d'une trame à l'autre — sans
// elle, un son qui décroît donne une clarté qui décroît avec lui, et la moitié
// de la fin d'un cri passerait pour non voisée.
function frameF0(buf, start) {
  let best = 0;
  let bestLag = 0;
  let e0 = 0;
  for (let i = 0; i < WIN; i += 1) e0 += buf[start + i] * buf[start + i];
  if (e0 <= 1e-9) return { f0: 0, clarity: 0 };

  // On relève TOUTE la courbe d'autocorrélation avant de choisir : le maximum
  // absolu ne suffit pas (voir plus bas).
  const norms = new Float64Array(LAG_MAX + 1);
  for (let lag = LAG_MIN; lag <= LAG_MAX; lag += 1) {
    let corr = 0;
    let e1 = 0;
    for (let i = 0; i < WIN; i += 1) {
      const b = buf[start + i + lag];
      corr += buf[start + i] * b;
      e1 += b * b;
    }
    if (e1 <= 1e-9) continue;
    const norm = corr / Math.sqrt(e0 * e1);
    norms[lag] = norm;
    if (norm > best) {
      best = norm;
      bestLag = lag;
    }
  }
  if (!bestLag || best < CLARITY_MIN) return { f0: 0, clarity: best };

  // ---------------------------------------------- l'erreur d'octave
  // Un signal périodique se ressemble à lui-même à SA période, mais aussi à
  // deux fois, trois fois sa période. Prendre le maximum absolu revient donc à
  // tirer au sort entre la fondamentale et ses sous-harmoniques : d'une trame à
  // l'autre le gagnant change, et la mélodie relevée saute d'une octave sans
  // que le son ait bougé.
  //
  // La parade classique (YIN, RAPT) : parcourir les décalages du plus court au
  // plus long et retenir LE PREMIER SOMMET assez proche du maximum. La vraie
  // période étant toujours le plus court des décalages qui marchent, on la
  // trouve avant ses multiples.
  const floorNorm = best * 0.88;
  for (let lag = LAG_MIN + 1; lag < bestLag; lag += 1) {
    if (
      norms[lag] >= floorNorm &&
      norms[lag] >= norms[lag - 1] &&
      norms[lag] >= norms[lag + 1]
    ) {
      return { f0: RATE / lag, clarity: norms[lag] };
    }
  }
  return { f0: RATE / bestLag, clarity: best };
}

// ============================================================
//  3. Le contour
// ============================================================
// Ce qu'on garde d'un son. Volontairement minuscule : deux tableaux de 64
// nombres et trois scalaires, soit ~1 Ko en base. C'est ce qui permet de
// stocker le contour cible À CÔTÉ de chaque clip et de ne jamais redécoder les
// sons de référence en cours de partie.
//
//   pitch  : hauteur en DEMI-TONS RELATIFS à la médiane du son lui-même.
//            C'est la ligne la plus importante du fichier : en retirant la
//            médiane, une basse et une soprano qui font le même mouvement
//            mélodique obtiennent le même contour. On note l'imitation, pas la
//            tessiture — sinon le jeu récompenserait d'avoir la bonne voix
//            plutôt que d'avoir bien imité.
//   energy : enveloppe de volume ramenée à 0..1 par son propre pic. Même
//            raison : on ne note pas qui crie le plus fort.
//   voiced : 0..1 par point — « y avait-il vraiment une hauteur à cet
//            instant ? ». C'EST LA PIÈCE QUI MANQUAIT, et son absence se voyait
//            à l'écran : les trames muettes sont interpolées depuis leurs
//            voisines (cf. fillGaps), donc la courbe continuait de monter et de
//            descendre AU MILIEU DES SILENCES. Le tracé avait l'air inventé
//            parce qu'il l'était : on dessinait de l'interpolation comme si
//            c'était de la mesure. Le masque permet au graphique de rompre le
//            trait là où il n'y a rien, et au barème de ne noter que les
//            instants où il y avait quelque chose à imiter.
export async function contourOf(file) {
  const pcm = await decodePcm(file);
  if (pcm.length < WIN * 2) throw new Error("son trop court");

  // --- Mesures brutes, une par pas de 10 ms ---
  const rms = [];
  const f0 = [];
  for (let s = 0; s + WIN + LAG_MAX < pcm.length; s += HOP) {
    let e = 0;
    for (let i = 0; i < WIN; i += 1) e += pcm[s + i] * pcm[s + i];
    rms.push(Math.sqrt(e / WIN));
    f0.push(frameF0(pcm, s));
  }
  if (rms.length < 4) throw new Error("son trop court");

  // --- Rognage du silence aux deux bouts ---
  const peak = Math.max(...rms);
  if (peak < 1e-4) throw new Error("silence");
  let from = 0;
  let to = rms.length - 1;
  while (from < to && rms[from] < peak * GATE) from += 1;
  while (to > from && rms[to] < peak * GATE) to -= 1;
  const len = to - from + 1;
  if (len < 4) throw new Error("son trop court");

  // --- Hauteur : combler les trous, puis centrer sur la médiane ---
  // Les trames non voisées (consonnes, souffle) n'ont pas de hauteur. On les
  // interpole depuis leurs voisines au lieu de les mettre à zéro : un zéro
  // creuserait un canyon dans la mélodie et pèserait bien plus lourd dans la
  // comparaison que l'absence d'information qu'il représente.
  //
  // Le GATE s'applique ici AUSSI, pas seulement aux deux bouts : un blanc au
  // milieu d'un « wa… hoo » n'a pas plus de hauteur qu'un blanc au début. Sans
  // cette condition, l'autocorrélation d'un fond de souffle passait le seuil de
  // clarté et plantait une note au milieu du silence.
  const gateLevel = peak * GATE;
  const raw = new Array(len);
  for (let i = 0; i < len; i += 1) {
    const { f0: hz, clarity } = f0[from + i];
    const audible = rms[from + i] >= gateLevel;
    raw[i] =
      audible && hz > 0 && clarity >= CLARITY_MIN ? 12 * Math.log2(hz / 55) : null;
  }
  // Le masque est relevé AVANT de combler les trous : après, l'information est
  // perdue — c'est justement tout ce qui reste pour distinguer une hauteur
  // mesurée d'une hauteur devinée.
  const mask = raw.map((v) => (v === null ? 0 : 1));
  const voiced = raw.filter((v) => v !== null);
  const voicedRatio = voiced.length / len;
  fillGaps(raw);

  let pitch;
  if (voiced.length >= 3) {
    const sorted = [...voiced].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    pitch = resample(raw.map((v) => (v === null ? 0 : v - median)), POINTS);
  } else {
    // Rien de voisé (un claquement, un souffle, du bruit) : pas de mélodie à
    // comparer. On le dit franchement plutôt que de renvoyer une ligne plate
    // qui ressemblerait à « une note tenue » et marquerait des points.
    pitch = new Array(POINTS).fill(0);
  }

  const energy = resample(
    rms.slice(from, to + 1).map((v) => v / peak),
    POINTS
  );

  return {
    pitch: pitch.map(r3),
    energy: energy.map(r3),
    // Ré-échantillonné comme les autres : les valeurs intermédiaires (0,4 à la
    // frontière d'un silence) sont un aveu d'incertitude utile, on ne les
    // arrondit pas à 0/1.
    voiced: resample(mask, POINTS).map(r3),
    durationMs: Math.round(len * (HOP / RATE) * 1000),
    voicedRatio: r3(voicedRatio),
  };
}

const r3 = (n) => Math.round(n * 1000) / 1000;

// Interpolation linéaire des `null` internes ; les bords recopient le premier
// (resp. dernier) point connu.
function fillGaps(arr) {
  let last = null;
  for (let i = 0; i < arr.length; i += 1) {
    if (arr[i] !== null) {
      if (last === null) for (let k = 0; k < i; k += 1) arr[k] = arr[i];
      else if (i - last > 1) {
        const step = (arr[i] - arr[last]) / (i - last);
        for (let k = last + 1; k < i; k += 1) arr[k] = arr[last] + step * (k - last);
      }
      last = i;
    }
  }
  if (last === null) return;
  for (let k = last + 1; k < arr.length; k += 1) arr[k] = arr[last];
}

// Ramène une série de longueur quelconque à `n` points, par interpolation
// linéaire. C'est CE ré-échantillonnage qui rend les durées comparables : une
// imitation deux fois plus lente garde la même forme, et c'est la mesure de
// durée séparée qui la pénalise — pas la mélodie.
function resample(src, n) {
  if (!src.length) return new Array(n).fill(0);
  if (src.length === 1) return new Array(n).fill(src[0]);
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i * (src.length - 1)) / (n - 1);
    const lo = Math.floor(x);
    const hi = Math.min(src.length - 1, lo + 1);
    out[i] = src[lo] + (src[hi] - src[lo]) * (x - lo);
  }
  return out;
}

// ============================================================
//  4. Comparaison
// ============================================================
// Distance élastique (DTW) entre deux courbes de hauteur, avec une bande de
// Sakoe-Chiba. L'élasticité est indispensable : personne ne place ses syllabes
// exactement au même instant que l'original, et une comparaison point à point
// punirait un décalage de 80 ms aussi durement qu'une mélodie fausse.
//
// La bande limite ce glissement à ±12 points (≈ 20 % du son). Sans elle, DTW
// finit par apparier n'importe quoi avec n'importe quoi : une ligne plate
// obtiendrait une excellente note contre une mélodie mouvementée, parce qu'elle
// aurait le droit d'étirer un seul point sur toute la longueur.
const BAND = 12;

function dtw(a, b) {
  const n = a.length;
  const INF = Infinity;
  let prev = new Float64Array(n + 1).fill(INF);
  let cur = new Float64Array(n + 1).fill(INF);
  prev[0] = 0;
  for (let i = 1; i <= n; i += 1) {
    cur.fill(INF);
    const lo = Math.max(1, i - BAND);
    const hi = Math.min(n, i + BAND);
    for (let j = lo; j <= hi; j += 1) {
      const cost = Math.abs(a[i - 1] - b[j - 1]);
      cur[j] = cost + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  // Moyenne par point : indépendante de POINTS, donc le barème ne bouge pas si
  // on change la résolution un jour.
  return prev[n] / n;
}

// ---------------------------------------------------------- DTW PONDÉRÉ
// Le même alignement, mais chaque appariement pèse ce que valait l'instant de
// la CIBLE : fort et voisé = plein poids, muet = poids nul.
//
// C'EST LE CORRECTIF DE FOND DU BARÈME. Le DTW nu comparait les 64 points à
// égalité, or après fillGaps la moitié d'entre eux peut être de
// l'interpolation dans du silence. Deux essais qui s'entendent pareil
// obtenaient des notes éloignées parce que le hasard de ce remplissage pesait
// autant que la mélodie — d'où des scores qui avaient l'air tirés au sort. On
// ne note désormais que les instants où il y avait une hauteur à imiter.
//
// Le poids est celui de la cible SEULE, jamais de la tentative : sinon se
// taire pendant le cri (poids nul des deux côtés) sortirait gratuit.
function dtwWeighted(a, b, w) {
  const n = a.length;
  const INF = Infinity;
  let prevC = new Float64Array(n + 1).fill(INF);
  let curC = new Float64Array(n + 1).fill(INF);
  let prevW = new Float64Array(n + 1);
  let curW = new Float64Array(n + 1);
  prevC[0] = 0;
  for (let i = 1; i <= n; i += 1) {
    curC.fill(INF);
    curW.fill(0);
    const lo = Math.max(1, i - BAND);
    const hi = Math.min(n, i + BAND);
    for (let j = lo; j <= hi; j += 1) {
      const wj = w[j - 1];
      const cost = Math.abs(a[i - 1] - b[j - 1]) * wj;
      // Le poids accumulé doit suivre LE MÊME chemin que le coût : diviser à la
      // fin par la somme de tous les poids donnerait un résultat qui dépend du
      // chemin qu'on n'a pas pris.
      let bestC = prevC[j];
      let bestW = prevW[j];
      if (curC[j - 1] < bestC) {
        bestC = curC[j - 1];
        bestW = curW[j - 1];
      }
      if (prevC[j - 1] < bestC) {
        bestC = prevC[j - 1];
        bestW = prevW[j - 1];
      }
      if (bestC === INF) continue;
      curC[j] = cost + bestC;
      curW[j] = wj + bestW;
    }
    [prevC, curC] = [curC, prevC];
    [prevW, curW] = [curW, prevW];
  }
  // Cible entièrement muette (ça ne devrait pas arriver : l'admin refuse les
  // sons non mélodiques) : on retombe sur la comparaison à égalité plutôt que
  // de diviser par zéro et de distribuer des « Parfait ».
  if (!(prevW[n] > 1e-6)) return dtw(a, b);
  return prevC[n] / prevW[n];
}

// Une distance (en demi-tons, ou en unités d'enveloppe) devient une note 0..1.
// Courbe douce plutôt que seuil : `tol` est l'écart qui vaut encore 0,5.
const soften = (dist, tol) => 1 / (1 + (dist / tol) ** 2);

// Poids des trois critères. La hauteur domine parce que c'est ce que l'oreille
// juge en premier — mais l'enveloppe compte assez pour qu'une note tenue au bon
// endroit ne batte pas une imitation qui a le bon rythme.
// La durée pèse plus qu'il n'y paraît : une fois la détection de hauteur
// fiabilisée, elle est devenue le SEUL critère capable de sanctionner une
// imitation deux fois trop lente. Mélodie juste et enveloppe de même forme, ce
// qui est correct — mais à 0,15 de poids, un tel essai décrochait « Parfait ».
const W_PITCH = 0.5;
const W_ENERGY = 0.28;
const W_DUR = 0.22;

// Le poids d'un instant de la cible : voisé ET audible. Le plancher à 0,2 sur
// l'énergie évite qu'une fin de cri qui s'éteint ne compte pour rien — elle est
// faible, pas absente.
function weightsOf(target) {
  const n = target.pitch.length;
  const energy = target.energy || [];
  const voiced = target.voiced || null;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const e = 0.2 + 0.8 * Math.min(1, Math.max(0, energy[i] ?? 1));
    w[i] = voiced ? e * Math.min(1, Math.max(0, voiced[i])) : e;
  }
  return w;
}

/**
 * Note une imitation contre un son de référence.
 * Rend { score (0..100), pitch, energy, duration (0..100 chacun), band }.
 */
export function compare(target, attempt) {
  if (!target || !attempt) return null;

  // Deux demi-tons d'écart moyen = 0,5. C'est calibré à l'oreille : à un
  // demi-ton près on entend « c'est ça », à quatre on entend une autre mélodie.
  //
  // Le poids par instant : ce que la cible avait à faire entendre. Les contours
  // enregistrés avant l'ajout de `voiced` (banque existante) n'en ont pas — on
  // se rabat alors sur la seule enveloppe, ce qui reste meilleur que l'égalité
  // parfaite d'avant. `npm run` du recalcul de l'admin les remet à niveau.
  const w = weightsOf(target);
  const pitchDist = dtwWeighted(attempt.pitch, target.pitch, w);
  let pitch = soften(pitchDist, 2.0);

  // Une tentative sans aucune hauteur franche (on a soufflé dans le micro) ne
  // peut pas marquer sur la mélodie : son contour est une ligne plate, qui
  // obtiendrait un excellent score contre un son lui-même peu voisé. On plafonne
  // donc par la proportion de trames voisées des DEUX côtés.
  const voiceFloor = Math.min(1, attempt.voicedRatio / Math.max(0.15, target.voicedRatio));
  pitch *= Math.min(1, voiceFloor);

  const energy = soften(dtw(attempt.energy, target.energy), 0.22);

  // Durée : c'est le RATIO qui compte, pas l'écart absolu. Rater de 200 ms sur
  // un « wahoo » de 400 ms est une faute grossière ; sur un cri de deux
  // secondes, c'est du bruit de mesure.
  const ratio =
    Math.max(attempt.durationMs, 1) / Math.max(target.durationMs, 1);
  // Tolérance resserrée : un facteur 2 sur la durée s'entend immédiatement,
  // il ne doit pas coûter que quelques points.
  const duration = soften(Math.abs(Math.log2(ratio)), 0.35);

  // La somme pondérée seule ne suffit PAS, et c'est contre-intuitif : avec une
  // hauteur à zéro, l'enveloppe et la durée garantissent encore 45 points. Une
  // mélodie complètement fausse décrochait donc « On y était », ce qui vide le
  // jeu de son sens — on peut gagner sans avoir imité quoi que ce soit, juste
  // en criant la bonne durée.
  //
  // D'où ce facteur : la hauteur ne se contente pas de peser, elle PLAFONNE le
  // reste. Bien imité, il vaut 1 et ne change rien ; à côté de la plaque, il
  // divise le total par deux. Le plancher à 0,45 évite l'effet falaise — rater
  // la mélodie coûte cher, mais ne réduit pas à néant le mérite d'avoir eu le
  // bon rythme.
  const total =
    (W_PITCH * pitch + W_ENERGY * energy + W_DUR * duration) * (0.45 + 0.55 * pitch);
  const score = Math.round(total * 100);
  return {
    score,
    pitch: Math.round(pitch * 100),
    energy: Math.round(energy * 100),
    duration: Math.round(duration * 100),
    band: bandOf(score),
  };
}

// Des PALIERS, et pas un score au dixième près.
//
// Le barème ci-dessus est bon mais il n'est pas exact, et afficher « 73,4 % »
// promettrait une précision qu'on n'a pas — chaque score serait contesté. Un
// palier assume l'approximation, et c'est la superposition des deux courbes à
// l'écran qui porte la justification : on voit POURQUOI on a perdu.
export function bandOf(score) {
  if (score >= 82) return "perfect";
  if (score >= 66) return "great";
  if (score >= 48) return "close";
  if (score >= 30) return "meh";
  return "miss";
}

export const BAND_LABELS = {
  perfect: "Parfait",
  great: "Très proche",
  close: "On y était",
  meh: "Pas tout à fait",
  miss: "Rien à voir",
};
