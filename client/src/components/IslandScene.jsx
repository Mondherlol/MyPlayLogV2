import { Suspense, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html, Float, Environment, useGLTF } from "@react-three/drei";
import CharacterModel, { seedConfig } from "./CharacterModel";

// ============================================================
//  Playtopia — scène 3D low-poly (React Three Fiber)
//  Île VOLANTE arrondie et ensoleillée. Chaque abonnement = une
//  maisonnette + un petit bonhomme mignon + une pancarte (avatar +
//  pseudo). Aucune interaction (juste regarder / tourner autour).
// ============================================================

// ------------------------------------------------------------------
//  SKYBOX — pour mettre TON propre ciel. Dépose le fichier dans
//  client/public/ puis renseigne UN des deux réglages ci-dessous.
//
//  A) Image panoramique équirectangulaire (.hdr/.exr/.jpg/.png) :
//       const SKYBOX = "/sky.hdr";
//     (sert aussi de lumière d'ambiance)
//
//  B) Modèle 3D de skybox (.glb/.gltf), ex. téléchargé sur Sketchfab —
//     c'est une sphère avec le ciel dessus. Prends le format GLB :
//       const SKYBOX_MODEL = "/anime-sky.glb";
//
//  Laisse les deux à "" pour garder le ciel bleu uni par défaut.
// ------------------------------------------------------------------
const SKYBOX = "";
const SKYBOX_MODEL = "/anime-sky-hd.glb";

// Modèles d'arbres (GLB déposés dans client/public/). Mis à l'échelle et
// orientés automatiquement. On alterne les deux essences autour de l'île.
const TREES = [
  { url: "/coconut_tree.glb", height: 3.6 },
  { url: "/stylized_pine_tree_tree.glb", height: 3.0 },
];

const ROOFS = [
  "#e8705f", "#6db4e8", "#7bc47f", "#f2b70b",
  "#b98ce0", "#f28fb0", "#f0a35e", "#5fd0c0",
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Répartition « tournesol » (phyllotaxie) dans un disque de rayon R : points
// régulièrement espacés → pas de chevauchement quel que soit le nombre.
function sunflower(n, R) {
  if (n <= 0) return [];
  if (n === 1) return [{ x: 0, z: 0 }];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n) * R;
    const t = i * golden;
    pts.push({ x: r * Math.cos(t), z: r * Math.sin(t) });
  }
  return pts;
}

// --- Maisonnette : murs (boîte) + toit pyramidal coloré + porte + fenêtre ---
function House({ color }) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.55, 0]}>
        <boxGeometry args={[1.3, 1.1, 1.3]} />
        <meshStandardMaterial color="#fbf1dd" />
      </mesh>
      <mesh castShadow position={[0, 1.5, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[1.18, 0.9, 4]} />
        <meshStandardMaterial color={color} flatShading />
      </mesh>
      <mesh castShadow position={[0.4, 1.55, -0.1]}>
        <boxGeometry args={[0.16, 0.4, 0.16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.36, 0.66]}>
        <boxGeometry args={[0.34, 0.62, 0.06]} />
        <meshStandardMaterial color="#9c6b3f" />
      </mesh>
      <mesh position={[0.42, 0.72, 0.66]}>
        <boxGeometry args={[0.28, 0.28, 0.05]} />
        <meshStandardMaterial color="#bfe6f5" emissive="#8fd0ea" emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}

// --- Buisson low-poly (petite touffe) ---
function Bush({ position, scale = 1 }) {
  return (
    <mesh castShadow position={position} scale={scale}>
      <icosahedronGeometry args={[0.4, 0]} />
      <meshStandardMaterial color="#5aa845" flatShading />
    </mesh>
  );
}

// --- Arbre chargé depuis un modèle GLB : normalisé (hauteur cible, base au
//     sol) et orienté droit quelle que soit l'échelle d'origine. ---
function ModelTree({ url, targetH, position, rotationY = 0, scale = 1 }) {
  const { scene } = useGLTF(url);
  const obj = useMemo(() => {
    const s = scene.clone(true);
    const box = new THREE.Box3().setFromObject(s);
    const size = box.getSize(new THREE.Vector3());
    const k = targetH / (size.y || 1);
    s.scale.setScalar(k);
    const box2 = new THREE.Box3().setFromObject(s);
    s.position.y = -box2.min.y; // pose la base à y=0
    s.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return s;
  }, [scene, targetH]);
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <primitive object={obj} />
    </group>
  );
}

// --- Un habitant complet, posé sur la surface bombée de l'île ---
function Habitant({ u, pos, y, tagOpacity }) {
  const roof = ROOFS[hashStr(u.id) % ROOFS.length];
  const character = useMemo(() => seedConfig(u.id), [u.id]);
  const rot = Math.atan2(pos.x, pos.z); // porte visible depuis l'extérieur
  return (
    <group position={[pos.x, y, pos.z]}>
      <group rotation={[0, rot, 0]}>
        <House color={roof} />
      </group>
      <group position={[0.85, 0, 0.85]}>
        <Float speed={2} rotationIntensity={0.15} floatIntensity={0.5} floatingRange={[0, 0.18]}>
          <CharacterModel {...character} />
        </Float>
        <Html position={[0, 1.55, 0]} center distanceFactor={9} zIndexRange={[20, 0]}>
          <div className="pt3d-tag" style={{ opacity: tagOpacity }}>
            {u.avatar ? (
              <img className="pt3d-tag-av" src={u.avatar} alt="" draggable="false" />
            ) : (
              <span className="pt3d-tag-av pt3d-tag-fb">
                {(u.username?.[0] || "?").toUpperCase()}
              </span>
            )}
            <span className="pt3d-tag-name">{u.username}</span>
          </div>
        </Html>
      </group>
    </group>
  );
}

// Strates de la falaise sous l'herbe (fractions du rayon). Empilées vers le
// bas, elles s'affinent en pointe → look d'île flottante stylisée (trapue).
const ROCK_LAYERS = [
  { rT: 0.92, rB: 0.78, h: 0.28, color: "#b58455" },
  { rT: 0.78, rB: 0.58, h: 0.3, color: "#a1703f" },
  { rT: 0.58, rB: 0.32, h: 0.26, color: "#8c5d33" },
  { rT: 0.32, rB: 0.08, h: 0.18, color: "#7a4f2b" },
];

// --- Mer de nuages sous l'île : cache le fond du ciel (souvent laid) et donne
//     l'impression que l'île flotte au-dessus des nuages. ---
function CloudSea({ radius, y }) {
  const puffs = useMemo(() => {
    const arr = [];
    const N = 34;
    for (let i = 0; i < N; i++) {
      const r = Math.sqrt((i + 0.5) / N) * radius;
      const a = i * 2.399963; // angle d'or
      arr.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        dy: (((i * 13) % 5) - 2) * 0.5,
        s: 1 + ((i * 7) % 6) * 0.28,
      });
    }
    return arr;
  }, [radius]);
  return (
    <group position={[0, y, 0]}>
      {puffs.map((p, i) => (
        <group key={i} position={[p.x, p.dy, p.z]} scale={[p.s, p.s * 0.5, p.s]}>
          <mesh>
            <sphereGeometry args={[1.5, 14, 12]} />
            <meshStandardMaterial color="#ffffff" emissive="#eaf4ff" emissiveIntensity={0.35} />
          </mesh>
          <mesh position={[1.2, -0.1, 0.3]}>
            <sphereGeometry args={[1.1, 14, 12]} />
            <meshStandardMaterial color="#ffffff" emissive="#eaf4ff" emissiveIntensity={0.35} />
          </mesh>
          <mesh position={[-1.1, 0.05, -0.2]}>
            <sphereGeometry args={[1.0, 14, 12]} />
            <meshStandardMaterial color="#f4f9ff" emissive="#eaf4ff" emissiveIntensity={0.35} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// --- L'île VOLANTE : dôme d'herbe + débord + falaise à strates + pointe ---
function Island({ radius, cap }) {
  const rock = useMemo(() => {
    const out = [];
    let cur = -0.5; // départ juste sous le débord d'herbe
    for (const L of ROCK_LAYERS) {
      const h = L.h * radius;
      out.push({
        y: cur - h / 2,
        rT: L.rT * radius,
        rB: L.rB * radius,
        h,
        color: L.color,
      });
      cur -= h;
    }
    return { layers: out, tipY: cur };
  }, [radius]);

  return (
    <group>
      {/* Herbe : calotte sphérique bombée (double face pour être visible de
          dessous quand on plonge vers le ciel) */}
      <mesh receiveShadow position={[0, cap.c, 0]}>
        <sphereGeometry args={[cap.rho, 120, 64, 0, Math.PI * 2, 0, cap.alpha]} />
        <meshStandardMaterial color="#83cf63" side={THREE.DoubleSide} />
      </mesh>
      {/* Débord d'herbe (épaisseur du gazon, dépasse la falaise) */}
      <mesh receiveShadow position={[0, -0.32, 0]}>
        <cylinderGeometry args={[radius, radius * 0.98, 0.5, 96]} />
        <meshStandardMaterial color="#74c257" flatShading />
      </mesh>
      {/* Falaise à strates */}
      {rock.layers.map((l, i) => (
        <mesh key={i} position={[0, l.y, 0]}>
          <cylinderGeometry args={[l.rT, l.rB, l.h, 13]} />
          <meshStandardMaterial color={l.color} flatShading />
        </mesh>
      ))}
      {/* Pointe arrondie tout en bas */}
      <mesh position={[0, rock.tipY, 0]}>
        <sphereGeometry args={[radius * 0.08, 16, 12]} />
        <meshStandardMaterial color="#7a4f2b" flatShading />
      </mesh>
    </group>
  );
}

// --- Skybox chargée depuis un modèle 3D (.glb/.gltf, ex. Sketchfab) ---
function SkyDome({ url, targetRadius }) {
  const { scene } = useGLTF(url);
  const obj = useMemo(() => {
    const s = scene.clone(true);
    const box = new THREE.Box3().setFromObject(s);
    const sph = box.getBoundingSphere(new THREE.Sphere());
    const scale = sph.radius > 0 ? targetRadius / sph.radius : 1;
    s.scale.setScalar(scale);
    s.position.set(0, 0, 0);
    s.traverse((o) => {
      if (o.isMesh && o.material) {
        const src = Array.isArray(o.material) ? o.material[0] : o.material;
        const tex = src.map || src.emissiveMap || null;
        if (tex) tex.colorSpace = THREE.SRGBColorSpace;
        o.material = new THREE.MeshBasicMaterial({
          map: tex,
          color: tex ? 0xffffff : src.color || 0xffffff,
          side: THREE.DoubleSide,
          fog: false,
          depthWrite: false,
          toneMapped: false,
        });
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = false;
        o.renderOrder = -1;
      }
    });
    return s;
  }, [scene, targetRadius]);
  return <primitive object={obj} />;
}

// Rotation d'ensemble très lente pour donner vie à la scène.
function SlowSpin({ inner }) {
  const ref = useRef();
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.05;
  });
  return <group ref={ref}>{inner(ref)}</group>;
}

// Quand on incline la caméra vers le ciel, l'île (et ses habitants) deviennent
// translucides pour laisser admirer la skybox. On lit la direction de la caméra
// à chaque frame et on interpole l'opacité des matériaux de l'île.
function SkyFade({ groupRef, onStep }) {
  const { camera } = useThree();
  const dir = useRef(new THREE.Vector3());
  const cur = useRef(1);
  const lastStep = useRef(1);
  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    camera.getWorldDirection(dir.current);
    const up = dir.current.y; // > 0 = on regarde vers le haut
    let target = 1;
    if (up > 0.06) target = THREE.MathUtils.clamp(1 - ((up - 0.06) / 0.4) * 0.94, 0.06, 1);
    cur.current = THREE.MathUtils.lerp(cur.current, target, 0.12);
    const o = cur.current;
    const solid = o > 0.985;
    g.traverse((n) => {
      if (!n.isMesh || !n.material) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      mats.forEach((m) => {
        if (m.userData._o === undefined) m.userData._o = m.opacity ?? 1;
        m.transparent = !solid || m.userData._o < 1;
        m.opacity = m.userData._o * o;
        m.depthWrite = solid;
      });
    });
    const step = Math.round(o * 20) / 20;
    if (step !== lastStep.current) {
      lastStep.current = step;
      onStep(step);
    }
  });
  return null;
}

export default function IslandScene({ habitants = [] }) {
  const n = habitants.length;
  const rHab = 4.2 + 0.95 * Math.sqrt(n);
  const islandR = rHab + 3.6;
  const [tagOpacity, setTagOpacity] = useState(1);

  // Profondeur totale de la falaise (pour placer la mer de nuages dessous).
  const rockDepth = 0.5 + ROCK_LAYERS.reduce((a, l) => a + l.h, 0) * islandR;

  const cap = useMemo(() => {
    const H = 1.1;
    const rho = (islandR * islandR + H * H) / (2 * H);
    const c = -0.15 - rho + H;
    const alpha = Math.asin(Math.min(1, islandR / rho));
    return { H, rho, c, alpha };
  }, [islandR]);
  const groundY = (r) => cap.c + Math.sqrt(Math.max(0, cap.rho * cap.rho - r * r));

  const placed = useMemo(() => {
    const pts = sunflower(n, rHab);
    return habitants.map((u, i) => ({ u, pos: pts[i], y: groundY(Math.hypot(pts[i].x, pts[i].z)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habitants, n, rHab, cap]);

  // Arbres GLB répartis sur l'anneau extérieur (marge d'herbe hors maisons).
  const trees = useMemo(() => {
    const count = Math.min(14, 6 + Math.floor(n / 4));
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = i * 2.399963 + 0.6; // angle d'or → réparti
      const r = islandR - 0.9 - (i % 3) * 0.5;
      const t = TREES[i % TREES.length];
      out.push({
        url: t.url,
        targetH: t.height * (0.85 + ((i * 29) % 5) * 0.07),
        position: [Math.cos(a) * r, groundY(r), Math.sin(a) * r],
        rotationY: (i * 1.7) % (Math.PI * 2),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, islandR, cap]);

  // Quelques buissons pour habiller.
  const bushes = useMemo(() => {
    const out = [];
    for (let i = 0; i < 6; i++) {
      const a = i * 1.4 + 2.1;
      const r = rHab + 0.6 + (i % 2) * 0.7;
      out.push({
        position: [Math.cos(a) * r, groundY(r) + 0.15, Math.sin(a) * r],
        scale: 0.7 + ((i * 17) % 4) * 0.12,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rHab, cap]);

  const camPos = [0, islandR * 0.72 + 2, islandR * 1.5];
  const shadowB = islandR + 3;

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: camPos, fov: 42 }}>
      <hemisphereLight args={["#cdeeff", "#6fae4c", 0.85]} />
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[islandR * 0.8, islandR * 1.6, islandR * 0.9]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-shadowB}
        shadow-camera-right={shadowB}
        shadow-camera-top={shadowB}
        shadow-camera-bottom={-shadowB}
        shadow-camera-near={0.5}
        shadow-camera-far={islandR * 5}
      />

      {/* Fond de secours : évite tout "trou" noir là où le ciel ne couvre pas. */}
      <color attach="background" args={["#bfe3f5"]} />

      <Suspense fallback={null}>
        {SKYBOX ? (
          <Environment files={SKYBOX} background />
        ) : SKYBOX_MODEL ? (
          <SkyDome url={SKYBOX_MODEL} targetRadius={islandR * 6} />
        ) : (
          <fog attach="fog" args={["#bfe3f5", islandR * 2.8, islandR * 6.5]} />
        )}

        {/* Mer de nuages sous l'île (fixe, ne tourne pas) */}
        <CloudSea radius={islandR * 3.4} y={-rockDepth - islandR * 0.35} />

        <SlowSpin
          inner={(ref) => (
            <>
              <Island radius={islandR} cap={cap} />
              {bushes.map((b, i) => (
                <Bush key={i} position={b.position} scale={b.scale} />
              ))}
              {trees.map((t, i) => (
                <ModelTree
                  key={i}
                  url={t.url}
                  targetH={t.targetH}
                  position={t.position}
                  rotationY={t.rotationY}
                />
              ))}
              {placed.map(({ u, pos, y }) => (
                <Habitant key={u.id} u={u} pos={pos} y={y} tagOpacity={tagOpacity} />
              ))}
              <SkyFade groupRef={ref} onStep={setTagOpacity} />
            </>
          )}
        />
      </Suspense>

      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={islandR * 0.9}
        maxDistance={islandR * 3}
        minPolarAngle={0.3}
        maxPolarAngle={2.35}
        target={[0, 0.5, 0]}
      />
    </Canvas>
  );
}

useGLTF.preload("/coconut_tree.glb");
useGLTF.preload("/stylized_pine_tree_tree.glb");
if (SKYBOX_MODEL) useGLTF.preload(SKYBOX_MODEL);
