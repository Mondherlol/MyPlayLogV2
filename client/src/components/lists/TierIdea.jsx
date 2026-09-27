import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { DEFAULT_TIERS, openListDraft } from "../../lib/lists";

// ======================================================================
//  Une tier list à faire : « Tier list des jeux Pokémon »,
//  « Tier list des héros Overwatch »
// ======================================================================
// Ça ne doit PAS ressembler à une liste qui existe : contour pointillé doré,
// un grand « + » au centre, et derrière, très pâles, des paliers vides et
// trois jaquettes de la saga.
//
// ⚠️ UN CLIC NE CRÉE RIEN. Il ouvre un BROUILLON (cf. lib/lists,
// `openListDraft`) avec les jeux de la saga dans le vivier — les siens
// d'abord, puis le reste (cf. GET /lists/suggest/tiers). La tier list n'est
// enregistrée, et n'apparaît sur le profil, qu'au premier jeu rangé dans un
// palier : cliquer pour voir ne laisse plus de liste vide derrière soi.
export default function TierIdea({ idea, token, title, sub }) {
  const navigate = useNavigate();

  function open() {
    if (!token) return navigate("/login");
    openListDraft(navigate, {
      type: "tier",
      itemKind: idea.itemKind || "game",
      title: idea.title,
      items: idea.games.map((g) =>
        g.kind === "character"
          ? {
              kind: "character",
              refId: String(g.refId),
              gameId: g.gameId || null,
              gameName: g.gameName || "",
              name: g.name,
              image: g.cover,
            }
          : {
              kind: "game",
              refId: String(g.gameId),
              gameId: g.gameId,
              name: g.name,
              image: g.cover,
            }
      ),
    });
  }

  // Trois jaquettes en éventail, estompées derrière le « + » : on devine de
  // quoi on parle sans que ça ressemble à une liste déjà faite.
  const fan = idea.games.filter((g) => g.cover).slice(0, 3);

  return (
    <button type="button" className="ti clickable" onClick={open}>
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
            <img
              key={g.refId || g.gameId}
              src={g.cover}
              alt=""
              loading="lazy"
              draggable="false"
              style={{ "--i": i }}
            />
          ))}
        </span>
      )}

      <span className="ti-center">
        <span className="ti-plus">
          <Plus size={28} strokeWidth={2.8} />
        </span>
        <span className="ti-title">{title || idea.label || `Tier list ${idea.saga}`}</span>
        <span className="ti-sub">{sub || `${idea.count} ${idea.unit || "jeux"} à classer`}</span>
      </span>
    </button>
  );
}
