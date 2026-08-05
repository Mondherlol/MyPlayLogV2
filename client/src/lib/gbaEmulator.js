// ======================================================================
//  La console, côté machinerie
// ======================================================================
// Faire tourner une Game Boy Advance dans un navigateur, ce n'est pas notre
// métier : c'est celui d'EmulatorJS, qui empaquette les cœurs d'émulation (mGBA,
// VBA) compilés en WebAssembly. Ce fichier ne fait que deux choses — LUI DONNER
// UN ENDROIT OÙ VIVRE, et savoir lui parler.
//
// D'OÙ L'IFRAME, et c'est le premier vrai choix.
//
// EmulatorJS s'installe sur la page : des variables globales, un contexte audio,
// une boucle d'animation, plusieurs dizaines de mégaoctets de mémoire
// WebAssembly. Une application d'une seule page ouvre et referme sa console dix
// fois de suite — et « refermer » doit vouloir dire refermer : plus de son, plus
// de boucle, plus rien. Il n'y a pas de façon fiable de démonter tout ça depuis
// l'extérieur ; il y en a une, imparable, de jeter un document entier.
//
// L'iframe est écrite en `srcdoc`, donc de NOTRE origine : on garde l'accès à
// l'émulateur (`frame.contentWindow.EJS_emulator`) pour le piloter depuis la
// coque, ce qu'un `blob:` — origine opaque — nous aurait interdit.
//
// ------------------------------------------------------------------------
//  CE QUI CHANGE PAR RAPPORT AU RAYON DS, ET C'EST BEAUCOUP
// ------------------------------------------------------------------------
// L'iframe de la DS était INVISIBLE. Il fallait lire son canvas à chaque image,
// en découper les deux moitiés et les recopier dans les deux trous du gabarit —
// parce que le cœur rendait les deux écrans collés l'un à l'autre et qu'aucune
// mise à l'échelle ne peut faire tenir une image continue dans deux trous
// espacés. Une recopie par image, plus le `preserveDrawingBuffer` qu'elle
// imposait, plus un détecteur de « recopie qui ne ramène que du noir » pour le
// jour où ça casserait.
//
// LA GBA N'A QU'UN ÉCRAN, en 3/2 exactement comme la fenêtre découpée dans la
// coque. On montre donc L'IFRAME ELLE-MÊME, à sa place, et tout ce mécanisme
// disparaît : pas de recopie, pas de boucle d'animation à nous, pas de panne
// muette possible. C'est la vraie raison pour laquelle ce rayon est fluide là où
// l'autre ramait.
//
// Il reste UNE lecture du canvas, mais une fois de temps en temps et pour autre
// chose : la vignette d'une sauvegarde (voir `shot` dans le document ci-dessous).
// C'est elle, et elle seule, qui justifie encore `preserveDrawingBuffer`.

// Où sont les cœurs. Par défaut le CDN du projet ; pour les héberger soi-même,
// copier le dossier `data` d'EmulatorJS dans `public/` et poser
// VITE_EJS_DATA=/emulatorjs/data/ — c'est le seul réglage à connaître, et il
// évite de dépendre d'un tiers pour lancer un jeu.
export const EJS_DATA = String(
  import.meta.env.VITE_EJS_DATA || "https://cdn.emulatorjs.org/stable/data/"
).replace(/\/*$/, "/");

// DEUX MOTEURS, ET IL FAUT LES DEUX. mGBA est le plus juste et suffisamment
// rapide partout — c'est lui qui rend cette console tenable, là où la DS
// demandait une machine. VBA démarre en revanche des ROMs que mGBA refuse
// (homebrews, traductions de fans mal reconstruites) : un émulateur sans
// solution de repli, c'est une console qui tombe en panne sans explication.
//
// Les noms sont ceux du catalogue d'EmulatorJS : ce sont des identifiants de
// cœur, pas des étiquettes.
export const CORES = [
  {
    value: "mgba",
    label: "mGBA",
    hint: "Le plus fidèle, et rapide partout. À garder.",
  },
  {
    value: "vba_next",
    label: "VBA",
    hint: "À essayer si un jeu refuse de démarrer.",
  },
];

export const CORE_KEY = "mpl_gba_core";

export function savedCore() {
  try {
    const v = localStorage.getItem(CORE_KEY);
    return CORES.some((c) => c.value === v) ? v : CORES[0].value;
  } catch {
    return CORES[0].value;
  }
}

export const coreOf = (value) =>
  CORES.find((c) => c.value === value) || CORES[0];

// L'identifiant sous lequel EmulatorJS range ses propres fichiers dans le
// navigateur. Il lui faut un NOMBRE, et surtout un nombre STABLE : s'il change,
// le joueur retrouve une cartouche vierge. On le dérive donc du slug, qui ne
// bouge pas.
//
// Ce n'est PLUS ce qui porte la partie du joueur — elle vit sur le serveur (voir
// lib/gbaSaves.js) — mais la pile de la cartouche continue d'y être écrite par le
// jeu lui-même, et autant qu'elle retombe au bon endroit d'une séance à l'autre.
export function gameIdOf(slug) {
  let h = 0;
  for (let i = 0; i < String(slug).length; i++) {
    h = (h * 31 + String(slug).charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

// ======================================================================
//  Le clavier de l'émulateur, qu'on fait taire
// ======================================================================
// EmulatorJS traduit LUI AUSSI le clavier en boutons de manette, dans son
// document. Or l'iframe est visible et cliquable (il lui faut le premier clic
// pour débloquer son contexte audio) : dès qu'elle a le focus, une seule touche
// déclencherait DEUX boutons — le nôtre et le sien, qu'on n'a pas choisi.
//
// On efface donc ses touches, et ELLES SEULES : `value` est le code clavier,
// `value2` le bouton de manette physique. Le second est laissé intact, sinon on
// priverait le joueur de sa manette pour un problème qui n'en vient pas.
export function muteKeys(win) {
  try {
    const controls = win?.EJS_emulator?.controls;
    if (!controls) return false;
    for (const player of Object.keys(controls)) {
      const set = controls[player];
      for (const button of Object.keys(set || {})) {
        if (set[button]) set[button].value = undefined;
      }
    }
    return true;
  } catch {
    return false;
  }
}

// Une valeur JavaScript, écrite dans un document HTML sans pouvoir en sortir.
// `JSON.stringify` produit déjà un littéral valide ; ce qu'il ne fait pas,
// c'est protéger du PARSEUR HTML — un titre contenant « </script> » refermerait
// la balise et le reste du document partirait en texte.
const js = (v) => JSON.stringify(v ?? null).replace(/</g, "\\u003c");

// Le document de la console. Tout y est absolu (l'URL de la ROM comme celle du
// chargeur) : un `srcdoc` résout ses liens relatifs contre la page qui
// l'héberge, ce qui serait une source d'erreurs invisibles.
//
// ------------------------------------------------------------------------
//  LE DIALOGUE AVEC LA PAGE
// ------------------------------------------------------------------------
// Tout passe par `postMessage`, dans les deux sens, et c'est volontaire : la
// coque pourrait appeler `EJS_emulator` directement (même origine), mais la
// SAUVEGARDE demande de l'asynchrone et une capture d'écran — mieux vaut un
// protocole explicite que dix accès croisés à un objet qui disparaît entre deux
// changements de moteur.
//
//   iframe → page   ready | start | nodata | state | loaded
//   page   → iframe save | load
//
// La sauvegarde est le morceau intéressant : l'état de la machine (`getState`)
// ET une vignette de l'écran, prises au même instant. Sans la vignette, le
// tiroir de sauvegardes serait une liste d'horaires ; avec, on reconnaît sa
// partie d'un coup d'œil.
export function consoleDoc({ rom, core, name, slug, tint }) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  #game { width: 100%; height: 100%; }
  /* La barre d'EmulatorJS est cachée par défaut : c'est la coque qui commande.
     Elle reste à un bouton de distance — filtres, tricheurs, réglages du cœur
     vivent dedans, et rien ne justifierait de les réécrire. */
  body.bare .ejs_menu_bar { display: none !important; }
  /* SA MANETTE TACTILE, ELLE, NE REVIENT JAMAIS. Elle n'apparaît que sur écran
     tactile — donc exactement là où notre coque dessinée EST la manette — et
     viendrait se poser par-dessus l'écran du jeu. Deux manettes superposées,
     dont une qu'on n'a pas choisie. */
  .ejs_virtualGamepad_parent { display: none !important; }
</style>
</head>
<body class="bare">
<div id="game"></div>
<script>
  // LE CANVAS DOIT POUVOIR ÊTRE RELU, et ça se décide ici.
  //
  // Un contexte WebGL vide son tampon dès qu'il est composé : \`drawImage\` n'en
  // ramènerait qu'un rectangle noir. \`preserveDrawingBuffer\` est le seul réglage
  // qui le garde lisible, et il ne se pose qu'à la CRÉATION du contexte — d'où ce
  // détournement, avant qu'EmulatorJS ne fabrique le sien.
  //
  // Ça ne sert QU'AUX VIGNETTES DE SAUVEGARDE (voir \`shot\` plus bas) : l'écran,
  // lui, est l'iframe elle-même et n'a rien à recopier. Le coût est dérisoire à
  // cette taille (240 × 160).
  (function () {
    var get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
        attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
      }
      return get.call(this, type, attrs);
    };
  })();

  var tell = function (what, detail, transfer) {
    try { parent.postMessage(Object.assign({ mplGba: what }, detail || {}), "*", transfer || []); } catch (e) {}
  };

  window.EJS_player = "#game";
  window.EJS_core = ${js(core)};
  window.EJS_gameUrl = ${js(rom)};
  window.EJS_pathtodata = ${js(EJS_DATA)};
  window.EJS_gameName = ${js(name)};
  window.EJS_gameID = ${gameIdOf(slug)};
  window.EJS_color = ${js(tint || "#f2b70b")};
  window.EJS_backgroundColor = "#000000";
  window.EJS_startOnLoaded = true;
  // Pas de EJS_language : EmulatorJS ne publie pas de traduction française, et
  // en réclamer une ne ferait qu'un 404 par démarrage. Ses menus restent donc
  // en anglais — raison de plus pour que la coque, elle, dise tout ce qu'il faut
  // en français.
  window.EJS_ready = function () { tell("ready"); };
  window.EJS_onGameStart = function () { tell("start"); };

  var emu = function () { return window.EJS_emulator || null; };

  // La vignette : l'écran du jeu, à sa taille native, en JPEG.
  //
  // ON PASSE PAR UN CANVAS 2D plutôt que d'appeler \`toDataURL\` sur celui du
  // cœur. Deux raisons : sa taille varie selon le cœur (certains montent en
  // résolution interne), et un PNG de 240 × 160 pèse trois fois un JPEG pour un
  // écran de jeu — or cette image part sur le réseau à chaque sauvegarde
  // automatique.
  function shot() {
    try {
      var src = emu() && emu().canvas;
      if (!src || !src.width || !src.height) return null;
      var cv = document.createElement("canvas");
      cv.width = 240;
      cv.height = 160;
      cv.getContext("2d").drawImage(src, 0, 0, src.width, src.height, 0, 0, 240, 160);
      return cv.toDataURL("image/jpeg", 0.72);
    } catch (e) {
      return null;
    }
  }

  window.addEventListener("message", function (e) {
    if (e.source !== parent) return;
    var what = e.data && e.data.mplGba;

    // --- SAUVEGARDER ---
    // \`getState\` rend tantôt un tableau d'octets, tantôt une promesse selon la
    // version : \`Promise.resolve\` couvre les deux sans avoir à deviner laquelle
    // est installée sur le CDN ce mois-ci.
    if (what === "save") {
      var id = e.data.id;
      var picture = shot(); // AVANT l'état : \`getState\` peut recomposer l'image
      try {
        Promise.resolve(emu().gameManager.getState()).then(function (state) {
          var buf = state && state.buffer ? state.buffer : state;
          if (!buf || !buf.byteLength) return tell("state", { id: id, error: "vide" });
          // Le tampon part EN TRANSFERT, pas en copie : quelques centaines de
          // kilo-octets recopiés à chaque sauvegarde automatique, c'est une
          // saccade toutes les deux minutes.
          return tell("state", { id: id, buf: buf, shot: picture }, [buf]);
        }, function (err) {
          tell("state", { id: id, error: String(err && err.message || err) });
        });
      } catch (err) {
        tell("state", { id: id, error: String(err && err.message || err) });
      }
      return;
    }

    // --- CHARGER ---
    // On répond TOUJOURS, succès comme échec : sans réponse, la coque ne peut
    // rien dire au joueur, et une sauvegarde qui ne s'est pas chargée en
    // silence est exactement le genre de panne qui fait perdre une partie.
    if (what === "load") {
      try {
        emu().gameManager.loadState(new Uint8Array(e.data.buf));
        tell("loaded", { id: e.data.id, ok: true });
      } catch (err) {
        tell("loaded", { id: e.data.id, ok: false, error: String(err && err.message || err) });
      }
      return;
    }
  });

  // Le chargeur est ajouté à la main plutôt qu'en balise : c'est le seul moyen
  // de savoir qu'il n'est PAS arrivé (CDN injoignable, hors ligne, bloqueur) —
  // sans quoi la console resterait noire sans jamais rien dire.
  var s = document.createElement("script");
  s.src = ${js(EJS_DATA)} + "loader.js";
  s.onerror = function () { tell("nodata"); };
  document.body.appendChild(s);
</script>
</body>
</html>`;
}
