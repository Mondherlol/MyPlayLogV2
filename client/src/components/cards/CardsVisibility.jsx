import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { apiFetch } from "../../lib/api";

// ======================================================================
//  L'interrupteur de la section Cartes (admin seulement)
// ======================================================================
// Éteinte, personne ne voit l'onglet ni la page, et l'API refuse — sauf
// l'admin, qui la prépare. Même règle et même dessin que l'interrupteur de la
// Collection (components/AdminCollection.jsx, lib/features.js côté serveur).
export default function CardsVisibility() {
  const { user, token, features, updateFeatures } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user?.isAdmin) return null;
  const on = !!features.cards;

  async function toggle() {
    setBusy(true);
    try {
      const d = await apiFetch("/settings/features/cards", {
        method: "PATCH",
        token,
        body: { enabled: !on },
      });
      // La barre latérale suit tout de suite, sans rechargement.
      updateFeatures(d.features);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`adm-coll-visib ${on ? "on" : ""}`}>
      <span className="adm-coll-visib-icon">{on ? <Eye size={17} /> : <EyeOff size={17} />}</span>
      <div className="adm-coll-visib-text">
        <strong>{on ? "Cartes ouvertes à tous" : "Cartes masquées"}</strong>
        <span>{on ? "L'onglet apparaît pour tout le monde." : "Toi seul vois l'onglet."}</span>
      </div>
      <button
        className={`admin-switch clickable ${on ? "on" : ""}`}
        onClick={toggle}
        disabled={busy}
        role="switch"
        aria-checked={on}
        aria-label="Ouvrir les cartes à tous"
      >
        <span className="admin-switch-knob">{busy && <Loader2 size={11} className="spin" />}</span>
      </button>
    </div>
  );
}
