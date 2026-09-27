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

  // Un roster (héros, combattants, champions) : ses portraits n'ont ni le
  // format ni le cadrage d'une jaquette — un visage carré chez Smash, une
  // illustration en pied chez LoL. En éventail de jaquettes, ils donnaient des
  // cartes bancales ; ils ont leur propre carte (cf. RosterIdea).
  if (idea.itemKind === "character") return <RosterIdea idea={idea} onOpen={open} />;

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

// « Tier list des héros Overwatch » → « Héros Overwatch ».
const rosterName = (label) => {
  const t = String(label || "").replace(/^tier list (des |de la |du )?/i, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * La carte d'un roster à classer : même cadre pointillé que les sagas, mais
 * une rangée de portraits RONDS, cadrés sur le visage, qui se lit d'un coup
 * d'œil comme « des personnages » — et le nom du jeu en entier, sur deux
 * lignes s'il le faut, au lieu d'un titre tronqué.
 */
function RosterIdea({ idea, onOpen }) {
  const faces = idea.games.filter((g) => g.cover).slice(0, 5);
  return (
    <button type="button" className="ti ti-roster clickable" onClick={onOpen}>
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

      <span className="tir-body">
        <span className="tir-faces" aria-hidden="true">
          {faces.map((g, i) => (
            <span key={g.refId} className="tir-face" style={{ "--i": i, "--mid": Math.abs(i - 2) }}>
              <img src={g.cover} alt="" loading="lazy" draggable="false" />
            </span>
          ))}
          <span className="tir-plus">
            <Plus size={20} strokeWidth={3} />
          </span>
        </span>
        <span className="tir-title">{rosterName(idea.label || idea.title)}</span>
        <span className="ti-sub">
          {idea.count} {idea.unit || "personnages"} à classer
        </span>
      </span>
    </button>
  );
}
