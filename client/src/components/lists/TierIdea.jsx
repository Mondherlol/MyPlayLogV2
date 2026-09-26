import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { apiFetch } from "../../lib/api";

// ======================================================================
//  Une tier list à faire : « Tier list des jeux Pokémon »
// ======================================================================
// Même gabarit que ListTile (l'image, le nom posé dessus), mais c'est une
// proposition : la pastille « + » le dit. Un clic crée la tier list avec les
// jeux de la saga que le joueur a joués, et l'ouvre en édition — il ne reste
// qu'à ranger (cf. GET /lists/suggest/tiers).
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

  return (
    <button type="button" className="lt lt-idea clickable" onClick={create} disabled={busy}>
      <span className="lt-media">
        <span className="lt-mosaic" style={{ "--n": Math.max(1, idea.covers.length) }}>
          {idea.covers.map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" draggable="false" />
          ))}
        </span>
        <span className="lt-type lt-idea-plus">
          {busy ? <Loader2 size={13} className="spin" /> : <Plus size={14} strokeWidth={3} />}
        </span>
        <span className="lt-badges">
          <span className="lt-pill">{idea.count}</span>
        </span>
        <span className="lt-caption">
          <span className="lt-title">{idea.title}</span>
          <span className="lt-meta">Créer la mienne</span>
        </span>
      </span>
    </button>
  );
}
