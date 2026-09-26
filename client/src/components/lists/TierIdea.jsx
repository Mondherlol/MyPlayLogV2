import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { DEFAULT_TIERS } from "../../lib/lists";

// ======================================================================
//  Une tier list à faire : « Tier list des jeux Pokémon »
// ======================================================================
// Ça ne doit PAS ressembler à une liste qui existe : contour pointillé, pas
// de fond d'image, des paliers vides et, en dessous, les jaquettes du joueur
// « à ranger ». Un bouton « Créer » dit que c'est à faire. Un clic crée la
// tier list avec les jeux de la saga que le joueur a joués, et l'ouvre en
// édition — il ne reste qu'à ranger (cf. GET /lists/suggest/tiers).
export default function TierIdea({ idea, token }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const { list } = await apiFetch("/lists", {
        method: "POST",
        token,
        body: {
          type: "tier",
          itemKind: "game",
          title: idea.title,
          visibility: "public",
          items: idea.games.map((g) => ({
            kind: "game",
            refId: String(g.gameId),
            gameId: g.gameId,
            name: g.name,
            image: g.cover,
          })),
        },
      });
      navigate(`/lists/${list.id}`, { state: { edit: true } });
    } catch (e) {
      alert(e.message);
      setBusy(false);
    }
  }

  const pool = idea.games.filter((g) => g.cover).slice(0, 5);

  return (
    <button type="button" className="ti clickable" onClick={create} disabled={busy}>
      <span className="ti-tiers" aria-hidden="true">
        {DEFAULT_TIERS.slice(0, 3).map((t) => (
          <span className="ti-row" key={t.id}>
            <span className="ti-label" style={{ "--tier": t.color }}>
              {t.label}
            </span>
            <span className="ti-slot" />
          </span>
        ))}
      </span>
      <span className="ti-pool" aria-hidden="true">
        {pool.map((g) => (
          <img key={g.gameId} src={g.cover} alt="" loading="lazy" draggable="false" />
        ))}
        {idea.count > pool.length && <span className="ti-more">+{idea.count - pool.length}</span>}
      </span>
      <span className="ti-foot">
        <span className="ti-text">
          <span className="ti-title">{idea.saga}</span>
          <span className="ti-sub">{idea.count} jeux à classer</span>
        </span>
        <span className="ti-cta">
          {busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} strokeWidth={3} />}
          Créer
        </span>
      </span>
    </button>
  );
}
