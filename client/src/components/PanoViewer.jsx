import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Loader2 } from "lucide-react";

// ======================================================================
//  PanoViewer — un panorama équirectangulaire qu'on regarde de l'intérieur
// ======================================================================
// Le décor de GeoGamer. On est au centre d'une sphère dont la face INTÉRIEURE
// porte l'image : on tourne la tête, on ne se déplace jamais.
//
// Pourquoi des contrôles maison plutôt qu'OrbitControls : ici la caméra ne
// tourne pas AUTOUR d'une cible, elle pivote SUR PLACE. OrbitControls sait le
// simuler (cible à 1 cm du nez) mais on hérite de ses réglages inversés, de son
// zoom qui traverse la sphère, et on perd le contrôle du tangage. Deux angles
// (lon/lat) et un lookAt font le travail, avec l'inertie qu'on veut.

// Résolution maximale ENVOYÉE AU GPU. Les panoramas sont archivés en 8192×4096,
// mais une telle texture coûte ~134 Mo de VRAM (et le double avec ses mipmaps),
// dépasse la limite matérielle de beaucoup de mobiles (souvent 4096), et
// n'apporte rien de visible dans un champ de vision de 70°. On redescend donc
// systématiquement à 4096 de large : ~33 Mo, net partout, et ça passe sur
// téléphone. Le fichier d'origine reste intact sur le disque.
const RENDER_MAX = 4096;

// Champ de vision : petit = zoomé (on scrute un panneau au loin), grand = large
// (on embrasse la scène). Au-delà de ~95° la déformation devient pénible.
const FOV_MIN = 40;
const FOV_MAX = 95;
const FOV_DEFAULT = 72;

// Tangage borné : au-delà on regarde ses pieds / le zénith et la navigation
// part en vrille (le pôle d'une équirectangulaire est de toute façon étiré).
const LAT_LIMIT = 85;

// La limite de texture du GPU ne change pas d'une image à l'autre : on
// l'interroge une fois via un contexte jetable, pour pouvoir décider du
// redimensionnement AVANT et INDÉPENDAMMENT du montage du <Canvas>.
let gpuMax = 0;
function maxTextureSize() {
  if (gpuMax) return gpuMax;
  try {
    const cv = document.createElement("canvas");
    const gl = cv.getContext("webgl2") || cv.getContext("webgl");
    const v = gl?.getParameter(gl.MAX_TEXTURE_SIZE);
    gpuMax = typeof v === "number" && v > 0 ? v : 4096;
    // On rend la main tout de suite : un navigateur ne tolère qu'une poignée
    // de contextes WebGL vivants et tue le PLUS ANCIEN quand le compte est
    // dépassé — ce serait précisément celui de la scène qu'on s'apprête à
    // monter. Le contexte de sonde ne doit pas survivre à sa mesure.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    gpuMax = 4096; // plancher prudent : aucune carte ne descend en dessous
  }
  return gpuMax;
}

// Réduit l'image à ce que la carte accepte (et à ce qu'on juge utile).
// Accepte indifféremment un <img> ou un ImageBitmap : les deux se dessinent
// dans un canvas 2D de la même façon.
function fitForGpu(source, limit) {
  // Garde-fou : une image dont le décodage a échoué garde des dimensions
  // nulles. Sans ce test elle passe tout droit jusqu'au GPU, qui téléverse une
  // texture vide — et une texture vide s'échantillonne en NOIR, sans erreur ni
  // avertissement. C'est exactement ce mode d'échec muet qui a rendu ce bug si
  // pénible à cerner : mieux vaut un message qu'un cadre noir.
  if (!source.width || !source.height) {
    throw new Error("Panorama vide (décodage impossible).");
  }
  if (source.width <= limit) return source;
  const w = limit;
  const h = Math.round((source.height * limit) / source.width);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  cv.getContext("2d").drawImage(source, 0, 0, w, h);
  source.close?.(); // un ImageBitmap 8K n'a plus lieu d'occuper la mémoire
  return cv;
}

// Décode un blob en texture par le chemin CANONIQUE de three.js : un
// HTMLImageElement.
//
// La version précédente passait par createImageBitmap() + `new THREE.Texture`
// monté à la main. C'est séduisant (décodage hors du fil principal) mais c'est
// le seul endroit du pipeline qui sorte des sentiers battus de three, et un
// ImageBitmap y a des règles à part — notamment sur `flipY`, que three ne peut
// pas appliquer de la même manière. Une texture qui s'échantillonne en noir ne
// lève aucune erreur : le matériau multiplie simplement sa couleur par du noir,
// et on obtient un cadre noir SANS le moindre message. Un <img> ne pose aucune
// de ces questions.
async function decodeToTexture(blob, limit) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Panorama illisible."));
      el.src = url;
    });
    // decode() garantit que les pixels sont prêts : sans lui, three peut
    // téléverser une image encore incomplète, et le premier rendu est vide.
    // L'échec n'est PAS avalé : une image non décodée qui poursuit son chemin
    // donne un panorama noir et silencieux, le pire des deux mondes.
    if (img.decode) await img.decode();
    return makeTexture(fitForGpu(img, limit));
  } finally {
    // Sûr ici : le <img> a fini de charger, il détient ses pixels
    // indépendamment de l'URL qui les a apportés.
    URL.revokeObjectURL(url);
  }
}

function makeTexture(source) {
  const tex = new THREE.Texture(source);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.UVMapping;
  // Mipmaps ACTIVÉES : à 4096 elles ne coûtent que ~11 Mo de plus et évitent
  // le crénelage quand on dézoome (fov large = forte minification).
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Téléchargement avec progression. Un panorama pèse 1 à 3 Mo : sans barre, le
// joueur croit que le jeu est planté. On lit le flux pour connaître l'avancée,
// et on retombe sur un <img> classique si le flux n'est pas exploitable
// (réponse sans content-length, ou image servie par un domaine tiers sans CORS).
async function loadPanorama(url, signal, onProgress) {
  const limit = Math.min(RENDER_MAX, maxTextureSize());
  try {
    const res = await fetch(url, { signal, mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length")) || 0;
    // Le type MIME doit suivre les octets. Un Blob construit sans `type` vaut
    // « text/plain » : l'URL d'objet annonce alors du texte au navigateur, qui
    // refuse d'y voir une image. C'est invisible dans le code et parfaitement
    // lisible dans l'onglet Réseau, où le blob s'affiche en text/plain.
    const mime = res.headers.get("content-type") || "image/webp";
    const reader = res.body?.getReader?.();
    let blob;
    if (reader && total > 0) {
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onProgress(Math.min(0.98, got / total));
      }
      blob = new Blob(chunks, { type: mime });
    } else {
      blob = await res.blob();
    }
    onProgress(0.99); // le décodage d'une 8K n'est pas instantané non plus
    return await decodeToTexture(blob, limit);
  } catch (err) {
    if (signal?.aborted) throw err;
    // Repli sans progression : le navigateur gère le téléchargement.
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = async () => {
        onProgress(1);
        await img.decode?.().catch(() => {});
        resolve(makeTexture(fitForGpu(img, limit)));
      };
      img.onerror = () => reject(new Error("Panorama illisible."));
      img.src = url;
    });
  }
}

// ---------- La sphère + la caméra ----------
// `ctl` est une ref partagée avec le parent : les gestes de la souris y
// écrivent des angles, la boucle de rendu les lit. Passer par un état React
// ferait re-rendre le composant 60 fois par seconde pour rien.
function PanoSphere({ texture, ctl }) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3());

  // La sphère est retournée en CUISANT le miroir dans la géométrie, surtout
  // pas via un `scale={[-1,1,1]}` sur le maillage. La nuance est décisive et
  // parfaitement contre-intuitive :
  //
  // quand la matrice monde d'un objet a un déterminant négatif, three inverse
  // la convention de winding pour COMPENSER le miroir (three.module.js,
  // setMaterial → frontFaceCW). Le but de cette compensation est que mettre un
  // objet en miroir ne change PAS quelles faces sont visibles. Conséquence : un
  // scale négatif sur l'objet laisse visibles les mêmes faces qu'un objet
  // normal — les faces EXTÉRIEURES. Caméra au centre, tout est culled, écran
  // noir sans le moindre message.
  //
  // Avec geometry.scale(), le miroir est cuit dans les sommets : le déterminant
  // de l'objet reste positif, aucune compensation n'a lieu, et ce sont bien les
  // faces intérieures qu'on voit — sans que l'image soit inversée, contrairement
  // à ce que donnerait THREE.BackSide seul.
  const geometry = useMemo(() => {
    const g = new THREE.SphereGeometry(500, 64, 40);
    g.scale(-1, 1, 1);
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    const c = ctl.current;
    if (!c.dragging) {
      // Dérive lente tant que le joueur n'a rien touché : c'est le seul indice
      // qui dit « cette image se manipule » sans afficher un mode d'emploi.
      if (!c.touched) c.lon += 3 * delta;
      // Inertie : le décor continue sur sa lancée après un lâcher de souris.
      c.velLon *= 0.9;
      c.velLat *= 0.9;
      c.lon += c.velLon;
      c.lat += c.velLat;
    }
    c.lat = Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, c.lat));

    const phi = THREE.MathUtils.degToRad(90 - c.lat);
    const theta = THREE.MathUtils.degToRad(c.lon);
    look.current.setFromSphericalCoords(1, phi, theta);
    camera.lookAt(look.current);

    if (Math.abs(camera.fov - c.fov) > 0.01) {
      camera.fov = c.fov;
      camera.updateProjectionMatrix();
    }
  });

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

export default function PanoViewer({ src, interactive = true, onReady, className = "" }) {
  const [texture, setTexture] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const ctl = useRef({
    lon: 0,
    lat: 0,
    fov: FOV_DEFAULT,
    velLon: 0,
    velLat: 0,
    dragging: false,
    touched: false,
  });
  const dragRef = useRef(null);
  const pinchRef = useRef(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  // --- Chargement de l'image ---
  useEffect(() => {
    if (!src) return;
    const ac = new AbortController();
    let tex = null;
    setTexture(null);
    setProgress(0);
    setError("");
    // Chaque manche repart face au même azimut : sans ça, le joueur hérite de
    // l'orientation où il a laissé la précédente, ce qui n'a aucun sens.
    ctl.current.lon = 0;
    ctl.current.lat = 0;
    ctl.current.fov = FOV_DEFAULT;
    ctl.current.velLon = 0;
    ctl.current.velLat = 0;
    ctl.current.touched = false;

    loadPanorama(src, ac.signal, setProgress)
      .then((t) => {
        if (ac.signal.aborted) {
          t.dispose();
          return;
        }
        tex = t;
        setTexture(t);
        setProgress(1);
        readyRef.current?.();
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(e.message || "Panorama indisponible.");
      });

    return () => {
      ac.abort();
      // Une texture 4K non libérée, c'est 33 Mo de VRAM qui restent pris à
      // chaque manche : au bout de dix, l'onglet tombe.
      if (tex) {
        tex.image?.close?.();
        tex.dispose();
      }
    };
  }, [src]);

  // --- Gestes ---
  // Première interaction : elle coupe la dérive automatique du décor.
  const markTouched = useCallback(() => {
    ctl.current.touched = true;
  }, []);

  const onPointerDown = useCallback(
    (e) => {
      if (!interactive || !texture) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      ctl.current.dragging = true;
      ctl.current.velLon = 0;
      ctl.current.velLat = 0;
      dragRef.current = { x: e.clientX, y: e.clientY, lon: ctl.current.lon, lat: ctl.current.lat };
      markTouched();
    },
    [interactive, texture, markTouched]
  );

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d || !ctl.current.dragging) return;
    // La sensibilité suit le fov : zoomé, un même geste doit balayer moins
    // d'angle, sinon la visée devient impossible.
    const k = ctl.current.fov / 500;
    // Horizontale « à la poignée » : on attrape le décor et on l'emmène, donc
    // tirer vers la droite fait venir ce qui était à gauche. L'axe vertical
    // garde la convention inverse, qui est celle du regard.
    const nextLon = d.lon + (e.clientX - d.x) * k;
    const nextLat = d.lat + (e.clientY - d.y) * k;
    ctl.current.velLon = nextLon - ctl.current.lon;
    ctl.current.velLat = nextLat - ctl.current.lat;
    ctl.current.lon = nextLon;
    ctl.current.lat = nextLat;
  }, []);

  const onPointerUp = useCallback((e) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    ctl.current.dragging = false;
    dragRef.current = null;
  }, []);

  const onWheel = useCallback(
    (e) => {
      if (!interactive || !texture) return;
      ctl.current.fov = Math.max(
        FOV_MIN,
        Math.min(FOV_MAX, ctl.current.fov + Math.sign(e.deltaY) * 4)
      );
      markTouched();
    },
    [interactive, texture, markTouched]
  );

  // Pincement à deux doigts = zoom. Les pointer events ne fournissent pas le
  // geste tout fait, on suit donc les deux touches nous-mêmes.
  const onTouchMove = useCallback(
    (e) => {
      if (!interactive || e.touches.length !== 2) return;
      const [a, b] = e.touches;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchRef.current) {
        const ratio = pinchRef.current / dist;
        ctl.current.fov = Math.max(
          FOV_MIN,
          Math.min(FOV_MAX, ctl.current.fov * (1 + (ratio - 1) * 0.6))
        );
      }
      pinchRef.current = dist;
      markTouched();
    },
    [interactive, markTouched]
  );
  const endPinch = useCallback(() => {
    pinchRef.current = null;
  }, []);

  return (
    <div className={`pano ${className} ${interactive ? "" : "locked"}`}>
      {texture && (
        // Pas de `className` ici, volontairement : R3F pose lui-même sur son
        // conteneur un `position:relative; width:100%; height:100%`, et il ne
        // crée son canvas QUE si ce conteneur mesure plus de 0. Lui imposer
        // notre propre positionnement revient à se battre contre sa mise en
        // page — c'est ce qui donnait un cadre noir. On stylise le vrai
        // <canvas> par un sélecteur descendant (.pano canvas), comme le fait
        // déjà IslandScene / .pt-stage pour Playtopia.
        <Canvas
          camera={{ fov: FOV_DEFAULT, near: 0.1, far: 1100, position: [0, 0, 0] }}
          // Une sphère texturée n'a besoin d'aucune passe supplémentaire :
          // pas d'antialias (l'image porte déjà le détail), pas de DPR au-delà
          // de 2 — sur un écran de téléphone à DPR 3, c'est 2,25× de pixels
          // pour rien.
          gl={{ antialias: false, powerPreference: "high-performance" }}
          dpr={[1, 2]}
          frameloop="always"
        >
          <PanoSphere texture={texture} ctl={ctl} />
        </Canvas>
      )}

      {/* Couche de saisie : au-dessus du canvas, elle capte tous les gestes.
          `touch-action: none` (CSS) empêche le navigateur de scroller la page
          pendant qu'on fait tourner le décor. */}
      <div
        className="pano-input"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onTouchMove={onTouchMove}
        onTouchEnd={endPinch}
        onTouchCancel={endPinch}
      />

      {!texture && !error && (
        <div className="pano-load">
          <Loader2 size={30} className="spin" />
          <span className="pano-load-txt">Atterrissage…</span>
          <span className="pano-load-bar">
            <i style={{ transform: `scaleX(${progress})` }} />
          </span>
          <span className="pano-load-pct">{Math.round(progress * 100)}%</span>
        </div>
      )}

      {error && (
        <div className="pano-load pano-err">
          <span>{error}</span>
        </div>
      )}

    </div>
  );
}
