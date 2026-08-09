import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { contourOf, compare } from "../lib/soundContour.js";

// ======================================================================
//  Banc d'essai du barème du Perroquet — `npm run test:sound`
// ======================================================================
// Le barème de lib/soundContour.js est la seule pièce du jeu qui peut être
// SUBTILEMENT fausse : un mauvais réglage ne plante pas, il distribue juste les
// points au hasard, et on ne s'en aperçoit qu'après avoir joué dix parties en
// trouvant les résultats « bizarres ».
//
// D'où ce banc. Il fabrique des sons dont on connaît d'avance le classement
// attendu et vérifie que le barème le retrouve. À relancer après TOUTE
// modification des poids, des tolérances ou des seuils : c'est ce qui dit si
// on vient d'améliorer le jeu ou de le casser.

const DIR = path.join(os.tmpdir(), "mpl-sound-bench");
fs.mkdirSync(DIR, { recursive: true });
const F = (n) => path.join(DIR, `${n}.wav`);

// Un balayage de fréquence avec une enveloppe de cri (attaque rapide, chute
// douce). Écrit en PCM à la main puis encapsulé par ffmpeg : ça teste le vrai
// chemin de décodage, pas une entrée synthétique privilégiée.
function writeSweep(file, f1, f2, dur = 1, sr = 16000) {
  const n = Math.round(sr * dur);
  const buf = Buffer.alloc(n * 2);
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / n;
    phase += (2 * Math.PI * (f1 * (f2 / f1) ** t)) / sr;
    const env = Math.min(1, i / (sr * 0.05)) * (1 - t * 0.6);
    buf.writeInt16LE(Math.round(Math.sin(phase) * env * 22000), i * 2);
  }
  const raw = `${file}.raw`;
  fs.writeFileSync(raw, buf);
  execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "s16le",
    "-ar", String(sr), "-ac", "1", "-i", raw, file]);
  fs.unlinkSync(raw);
}

function writeNoise(file, dur = 1) {
  execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", `anoisesrc=duration=${dur}:color=white:amplitude=0.5`,
    "-ar", "16000", "-ac", "1", file]);
}

writeSweep(F("target"), 200, 500);        // LA CIBLE : une montée
writeSweep(F("same"), 200, 500);          // copie conforme
// Transposition : MÊME mélodie, voix plus haute. On monte d'une quinte et non
// d'une octave — à l'octave, le balayage finirait à 1000 Hz, pile sur le
// plafond de détection (F0_MAX), et le contour serait tronqué par le haut. Le
// score chuterait alors à cause d'un artefact du banc et non du barème.
writeSweep(F("higher"), 300, 750);
writeSweep(F("halftempo"), 200, 500, 2);  // même mélodie, deux fois plus lente
writeSweep(F("down"), 500, 200);          // mélodie inverse
writeSweep(F("flat"), 300, 302);          // note tenue
writeNoise(F("noise"));                   // on souffle dans le micro

const target = await contourOf(F("target"));
console.log(
  `\nCible : ${target.durationMs} ms, ${Math.round(target.voicedRatio * 100)} % voisé\n`
);

const rows = [];
for (const name of ["same", "higher", "halftempo", "flat", "down", "noise"]) {
  rows.push({ name, ...compare(target, await contourOf(F(name))) });
}

console.log("tentative     score   hauteur  enveloppe   durée   palier");
console.log("-".repeat(62));
for (const r of rows) {
  console.log(
    r.name.padEnd(13),
    String(r.score).padStart(5),
    String(r.pitch).padStart(9),
    String(r.energy).padStart(10),
    String(r.duration).padStart(7),
    "  " + r.band
  );
}

// --- Ce que le barème DOIT garantir ---
// Chaque ligne correspond à une décision de conception de soundContour.js. Si
// l'une lâche, c'est cette décision-là qu'on vient d'annuler.
const by = Object.fromEntries(rows.map((r) => [r.name, r.score]));
const checks = [
  ["une copie conforme frôle le maximum", by.same >= 88],
  ["même mélodie, voix plus haute : presque aussi bien (normalisation par la médiane)",
    by.higher >= 80],
  // Les deux suivantes sont la raison d'être du facteur de plafonnement par la
  // hauteur : sans lui, une mélodie fausse mais de bon rythme décrochait encore
  // « On y était ». Une imitation ratée DOIT se lire comme ratée.
  ["mélodie inverse : sous le seuil « on y était »", by.down < 48],
  ["note tenue : sous le seuil « on y était »", by.flat < 48],
  ["bruit blanc : au plancher (garde-fou du voisement)", by.noise < 30],
  ["deux fois plus lent : pénalisé sans être éliminé",
    by.halftempo < by.same && by.halftempo > by.noise],
];

console.log();
let ok = true;
for (const [label, pass] of checks) {
  console.log(`${pass ? "  ok  " : " ÉCHEC"}  ${label}`);
  if (!pass) ok = false;
}
console.log();
fs.rmSync(DIR, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
