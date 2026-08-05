// ============================================================
//  Playtopia — modèle 3D de personnage paramétrable (mignon & sobre)
//  Réutilisé pour les habitants de l'île ET l'aperçu de la modale de
//  customisation. Rien que des primitives (zéro asset) → léger.
// ============================================================

// Palettes / options exposées (utilisées par la modale de customisation).
export const BODY_COLORS = [
  "#f2a65a", "#ef6f6c", "#f28fb0", "#b98ce0",
  "#6db4e8", "#5fd0c0", "#7bc47f", "#f2b70b",
  "#e9e2d4", "#8a8f99",
];
export const HATS = ["none", "beanie", "cap", "crown", "flower", "headphones"];
export const EYES = ["dots", "happy", "sleepy", "star"];

export const HAT_LABELS = {
  none: "Aucun",
  beanie: "Bonnet",
  cap: "Casquette",
  crown: "Couronne",
  flower: "Fleur",
  headphones: "Casque",
};
export const EYE_LABELS = {
  dots: "Points",
  happy: "Joyeux",
  sleepy: "Endormi",
  star: "Étoiles",
};

export const DEFAULT_CHAR = { color: BODY_COLORS[0], hat: "none", eyes: "dots" };

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Config déterministe pour un habitant (à partir de son id) : chaque abonnement
// a une apparence stable et variée.
export function seedConfig(id) {
  const h = hashStr(id);
  return {
    color: BODY_COLORS[h % BODY_COLORS.length],
    hat: HATS[(h >> 3) % HATS.length],
    eyes: EYES[(h >> 6) % EYES.length],
  };
}

const DARK = "#2b2019";

function Eye({ x, type }) {
  const p = [x, 0.86, 0.3];
  if (type === "sleepy")
    return (
      <mesh position={p}>
        <boxGeometry args={[0.11, 0.022, 0.02]} />
        <meshStandardMaterial color={DARK} />
      </mesh>
    );
  if (type === "happy")
    return (
      <mesh position={p}>
        <torusGeometry args={[0.055, 0.017, 8, 16, Math.PI]} />
        <meshStandardMaterial color={DARK} />
      </mesh>
    );
  if (type === "star")
    return (
      <mesh position={p}>
        <sphereGeometry args={[0.06, 10, 10]} />
        <meshStandardMaterial color="#ffd23f" emissive="#ffb300" emissiveIntensity={0.55} />
      </mesh>
    );
  // dots
  return (
    <mesh position={p}>
      <sphereGeometry args={[0.055, 14, 14]} />
      <meshStandardMaterial color={DARK} />
    </mesh>
  );
}

function Hat({ type }) {
  if (type === "beanie")
    return (
      <group position={[0, 0.9, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.36, 22, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#ef6f6c" />
        </mesh>
        <mesh position={[0, 0.02, 0]}>
          <torusGeometry args={[0.35, 0.05, 10, 26]} />
          <meshStandardMaterial color="#fff7f0" />
        </mesh>
        <mesh castShadow position={[0, 0.4, 0]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshStandardMaterial color="#fff7f0" />
        </mesh>
      </group>
    );
  if (type === "cap")
    return (
      <group position={[0, 0.92, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.35, 22, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#4a9de0" />
        </mesh>
        <mesh castShadow position={[0, -0.01, 0.32]} rotation={[-0.15, 0, 0]}>
          <cylinderGeometry args={[0.26, 0.26, 0.04, 20, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color="#3d8ccb" />
        </mesh>
        <mesh position={[0, 0.28, 0]}>
          <sphereGeometry args={[0.05, 10, 10]} />
          <meshStandardMaterial color="#3d8ccb" />
        </mesh>
      </group>
    );
  if (type === "crown")
    return (
      <group position={[0, 1.16, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.3, 0.32, 0.16, 16, 1, true]} />
          <meshStandardMaterial color="#f2b70b" metalness={0.4} roughness={0.4} side={2} />
        </mesh>
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <mesh key={i} castShadow position={[Math.cos(a) * 0.3, 0.14, Math.sin(a) * 0.3]}>
              <coneGeometry args={[0.05, 0.14, 8]} />
              <meshStandardMaterial color="#ffcf3a" metalness={0.4} roughness={0.4} />
            </mesh>
          );
        })}
      </group>
    );
  if (type === "flower")
    return (
      <group position={[0.24, 1.02, 0.16]}>
        <mesh>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshStandardMaterial color="#ffd23f" />
        </mesh>
        {Array.from({ length: 5 }).map((_, i) => {
          const a = (i / 5) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08]}>
              <sphereGeometry args={[0.055, 12, 12]} />
              <meshStandardMaterial color="#f28fb0" />
            </mesh>
          );
        })}
      </group>
    );
  if (type === "headphones")
    return (
      <group position={[0, 0.82, 0]}>
        <mesh castShadow position={[0, 0.02, 0]}>
          <torusGeometry args={[0.4, 0.045, 10, 20, Math.PI]} />
          <meshStandardMaterial color="#333842" />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} castShadow position={[s * 0.38, 0.02, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.11, 0.11, 0.08, 16]} />
            <meshStandardMaterial color="#464c57" />
          </mesh>
        ))}
      </group>
    );
  return null;
}

export default function CharacterModel({ color = "#f2a65a", hat = "none", eyes = "dots" }) {
  return (
    <group>
      {/* Corps */}
      <mesh castShadow position={[0, 0.34, 0]}>
        <capsuleGeometry args={[0.28, 0.14, 6, 18]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Mains */}
      {[-1, 1].map((s) => (
        <mesh key={s} castShadow position={[s * 0.31, 0.36, 0.04]}>
          <sphereGeometry args={[0.09, 12, 12]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
      {/* Tête */}
      <mesh castShadow position={[0, 0.8, 0]}>
        <sphereGeometry args={[0.34, 30, 30]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Yeux */}
      <Eye x={-0.12} type={eyes} />
      <Eye x={0.12} type={eyes} />
      {/* Joues */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.23, 0.74, 0.22]}>
          <sphereGeometry args={[0.05, 10, 10]} />
          <meshStandardMaterial color="#ff9db0" transparent opacity={0.6} />
        </mesh>
      ))}
      {/* Pieds */}
      {[-1, 1].map((s) => (
        <mesh key={s} castShadow position={[s * 0.14, 0.07, 0.05]}>
          <sphereGeometry args={[0.11, 12, 12]} />
          <meshStandardMaterial color="#5c4433" />
        </mesh>
      ))}
      <Hat type={hat} />
    </group>
  );
}
