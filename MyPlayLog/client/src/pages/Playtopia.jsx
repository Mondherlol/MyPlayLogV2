import { Suspense, lazy, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Palmtree, Loader2, UserPlus } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { loadChar, saveChar } from "../lib/playtopiaChar";

// La scène 3D et la modale de perso (three.js + R3F) sont lourdes : on les
// charge à la demande pour ne pas alourdir le bundle principal de l'app.
const IslandScene = lazy(() => import("../components/IslandScene"));
const CharacterCustomizer = lazy(() => import("../components/CharacterCustomizer"));

// ============================================================
//  Playtopia — l'île 3D cosy de tes abonnements (plein écran)
//  Phase 1 : on regarde. Les abonnements sont des habitants sur une
//  petite île flottante (maison + bonhomme + pancarte). Zéro interaction.
// ============================================================

function StageOverlay({ children, className = "" }) {
  return <div className={`pt-state ${className}`}>{children}</div>;
}

export default function Playtopia() {
  const { user, token } = useAuth();
  const myId = user?.id || user?._id;

  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [habitants, setHabitants] = useState([]);

  // Personnage du joueur (apparence). Sauvegardé en local pour l'instant.
  const [charConfig, setCharConfig] = useState(() => loadChar(myId));
  const [charOpen, setCharOpen] = useState(false);

  useEffect(() => {
    setCharConfig(loadChar(myId));
  }, [myId]);

  useEffect(() => {
    if (!myId) return;
    let alive = true;
    setStatus("loading");
    apiFetch(`/users/${myId}/following`, { token })
      .then((d) => {
        if (!alive) return;
        setHabitants((d.users || []).filter((u) => !u.isMe));
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [myId, token]);

  const count = habitants.length;

  function saveCharacter(cfg) {
    setCharConfig(cfg);
    saveChar(myId, cfg);
    setCharOpen(false);
  }

  return (
    <div className="pt-page">
      <div className="pt-stage">
        {/* Titre "Playtopia" flottant, sans cadre, dans l'île elle-même */}
        <div className="pt-title" aria-label="Playtopia">
          <span className="pt-title-icon">
            <Palmtree size={26} strokeWidth={2.5} />
          </span>
          <span className="pt-title-text">
            <span className="pt-title-main">Playtopia</span>
            <span className="pt-title-sub">
              {status === "ready"
                ? count > 0
                  ? `${count} habitant${count > 1 ? "s" : ""}`
                  : "ton île t'attend"
                : "ton île cosy"}
            </span>
          </span>
        </div>

        {status === "loading" && (
          <StageOverlay>
            <Loader2 size={30} className="pt-spin" />
            <p>On réveille les habitants…</p>
          </StageOverlay>
        )}

        {status === "error" && (
          <StageOverlay>
            <p>L'île n'a pas voulu se charger.</p>
          </StageOverlay>
        )}

        {status === "ready" && (
          <Suspense
            fallback={
              <StageOverlay>
                <Loader2 size={30} className="pt-spin" />
                <p>On construit l'île…</p>
              </StageOverlay>
            }
          >
            <IslandScene habitants={habitants} />
          </Suspense>
        )}

        {status === "ready" && count === 0 && (
          <StageOverlay className="pt-empty">
            <h2 className="pt-empty-title">Pas encore de voisins</h2>
            <p className="pt-empty-sub">
              Abonne-toi à des joueurs : ils viendront s'installer sur ton île.
            </p>
            <Link to="/explore" className="pt-btn clickable">
              <UserPlus size={16} strokeWidth={2.6} />
              Trouver des joueurs
            </Link>
          </StageOverlay>
        )}

        {/* Bouton perso en bas à droite */}
        <button
          className="pt-charbtn clickable"
          onClick={() => setCharOpen(true)}
          title="Personnaliser mon personnage"
        >
          <span className="pt-charbtn-face" style={{ "--body": charConfig.color }}>
            <i className="pt-charbtn-eye left" />
            <i className="pt-charbtn-eye right" />
          </span>
          <span className="pt-charbtn-name">{user?.username || "Moi"}</span>
        </button>
      </div>

      {charOpen && (
        <Suspense fallback={null}>
          <CharacterCustomizer
            initial={charConfig}
            username={user?.username || "Moi"}
            onSave={saveCharacter}
            onClose={() => setCharOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
