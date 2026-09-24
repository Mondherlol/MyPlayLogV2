// Fabrique les icônes du compagnon (assets/glyphs/*.svg) depuis Lucide — les
// mêmes que l'app. Blanches sur transparent : le compagnon les recolore à
// l'affichage (doré, gris, blanc). Rendu en PNG ensuite par make-glyphs.ps1.
import fs from "node:fs";
import path from "node:path";

const LUCIDE = process.argv[2]; // …/lucide-react-native/dist/esm/icons
const OUT = process.argv[3];
const NAMES = [
  "trophy", "gamepad-2", "refresh-cw", "external-link", "check", "clock",
  "chevron-left", "chevron-right", "folder", "folder-plus", "inbox",
  "link-2-off", "monitor", "bell", "power", "x", "zap", "sparkles",
];
fs.mkdirSync(OUT, { recursive: true });
for (const name of NAMES) {
  const src = fs.readFileSync(path.join(LUCIDE, `${name}.mjs`), "utf8");
  const m = src.match(/createLucideIcon\("[^"]+",\s*(\[[\s\S]*\])\s*\);/);
  if (!m) throw new Error("icône introuvable : " + name);
  const nodes = Function(`return ${m[1]}`)();
  const body = nodes
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== "key")
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `<${tag} ${a}/>`;
    })
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" ` +
    `stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  fs.writeFileSync(path.join(OUT, `${name}.svg`), svg);
}
console.log(`${NAMES.length} icônes écrites dans ${OUT}`);
