import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import { Check, X, Palette, Glasses, Crown } from "lucide-react";
import CharacterModel, {
  BODY_COLORS,
  HATS,
  EYES,
  HAT_LABELS,
  EYE_LABELS,
} from "./CharacterModel";

// ============================================================
//  Modale de customisation du personnage — style jeu vidéo :
//  aperçu 3D en direct + onglets d'options. Sobre et lisible.
// ============================================================

const CATEGORIES = [
  { key: "color", label: "Couleur", Icon: Palette },
  { key: "hat", label: "Chapeau", Icon: Crown },
  { key: "eyes", label: "Yeux", Icon: Glasses },
];

function Preview({ config }) {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{ position: [0, 0.85, 2.6], fov: 42 }}
      gl={{ alpha: true }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.75} />
      <directionalLight position={[2.5, 4, 3]} intensity={1.15} castShadow shadow-mapSize={[512, 512]} />
      <group position={[0, -0.55, 0]}>
        <CharacterModel {...config} />
        <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={3} blur={2.4} far={2} />
      </group>
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        autoRotate
        autoRotateSpeed={1.6}
        minPolarAngle={0.9}
        maxPolarAngle={1.7}
        target={[0, 0.45, 0]}
      />
    </Canvas>
  );
}

export default function CharacterCustomizer({ initial, username, onSave, onClose }) {
  const [draft, setDraft] = useState(initial);
  const [cat, setCat] = useState("color");

  // Échap pour fermer.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="pt-modal-backdrop" onClick={onClose}>
      <div className="pt-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="pt-modal-head">
          <h2 className="pt-modal-title">Mon personnage</h2>
          <button className="pt-modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </header>

        <div className="pt-cc-body">
          {/* Aperçu 3D */}
          <div className="pt-cc-preview">
            <Preview config={draft} />
            <span className="pt-cc-name">{username}</span>
          </div>

          {/* Panneau d'options */}
          <div className="pt-cc-panel">
            <div className="pt-cc-tabs" role="tablist">
              {CATEGORIES.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={cat === key}
                  className={`pt-cc-tab clickable ${cat === key ? "on" : ""}`}
                  onClick={() => setCat(key)}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <div className="pt-cc-options">
              {cat === "color" &&
                BODY_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`pt-cc-swatch clickable ${draft.color === c ? "on" : ""}`}
                    style={{ "--sw": c }}
                    onClick={() => set({ color: c })}
                    aria-label={c}
                  >
                    {draft.color === c && <Check size={16} strokeWidth={3} />}
                  </button>
                ))}

              {cat === "hat" &&
                HATS.map((h) => (
                  <button
                    key={h}
                    className={`pt-cc-opt clickable ${draft.hat === h ? "on" : ""}`}
                    onClick={() => set({ hat: h })}
                  >
                    {HAT_LABELS[h]}
                  </button>
                ))}

              {cat === "eyes" &&
                EYES.map((e) => (
                  <button
                    key={e}
                    className={`pt-cc-opt clickable ${draft.eyes === e ? "on" : ""}`}
                    onClick={() => set({ eyes: e })}
                  >
                    {EYE_LABELS[e]}
                  </button>
                ))}
            </div>
          </div>
        </div>

        <footer className="pt-modal-foot">
          <button className="pt-ghost-btn clickable" onClick={onClose}>
            Annuler
          </button>
          <button className="pt-save-btn clickable" onClick={() => onSave(draft)}>
            <Check size={17} strokeWidth={2.6} />
            Enregistrer
          </button>
        </footer>
      </div>
    </div>
  );
}
