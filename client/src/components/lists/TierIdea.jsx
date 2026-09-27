import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { DEFAULT_TIERS } from "../../lib/lists";

// ======================================================================
//  Une tier list à faire : « Tier list des jeux Pokémon »
// ======================================================================
// Ça ne doit PAS ressembler à une liste qui existe : contour pointillé doré,
// un grand « + » au centre, et derrière, très pâles, des paliers vides et
// trois jaquettes de la saga. Un clic crée la tier list avec les jeux de la
// saga (les siens d'abord, puis le reste — cf. GET /lists/suggest/tiers) et
// l'ouvre en édition : il ne reste qu'à ranger.
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

  // Trois jaquettes de la saga en éventail, estompées derrière le « + » : on
  // devine de quoi on parle sans que ça ressemble à une liste déjà faite.
  const fan = idea.games.filter((g) => g.cover).slice(0, 3);

  return (
    <button type="button" className="ti clickable" onClick={create} disabled={busy}>
      {/* Le fond : des paliers vides (S, A, B…) et l'éventail, très pâles. */}
      <span className="ti-ghost" aria-hidden="true">
        {DEFAULT_TIERS.slice(0, 4).map((t) => (
          <span className="ti-row" key={t.id}>
            <span className="ti-label" style={{ "--tier": t.color }}>
              {t.label}
            </span>
            <span className="ti-slot" />
          </span>
        ))}
      </span>
      {fan.length > 0 && (
        <span className="ti-fan" aria-hidden="true">
          {fan.map((g, i) => (
            <img key={g.gameId} src={g.cover} alt="" loading="lazy" draggable="false" style={{ "--i": i }} />
          ))}
        </span>
      )}

      <span className="ti-center">
        <span className="ti-plus">
          {busy ? <Loader2 size={24} className="spin" /> : <Plus size={28} strokeWidth={2.8} />}
        </span>
        <span className="ti-title">Tier list {idea.saga}</span>
        <span className="ti-sub">{idea.count} jeux à classer</span>
      </span>
    </button>
  );
}
