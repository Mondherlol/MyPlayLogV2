import { useRef } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";

import { boardOf, itemsBySlot } from "../../lib/boards";

// ======================================================================
//  La carte de joueur — un passeport, pas un formulaire
// ======================================================================
// Une carte qu'on a envie de montrer : un bandeau d'identité (avatar, pseudo,
// numéro de carte), la grille, et en pied la bande de lecture machine d'un
// passeport, fabriquée avec le pseudo. Un fond guilloché, comme les papiers
// officiels. Au survol, la carte s'incline vers le pointeur et un reflet la
// traverse.
//
// ⚠️ PEU DE TEXTE. Le libellé d'une case est DANS la case, en bas de la
// jaquette ; le nom du jeu n'est écrit nulle part (la jaquette le dit, et le
// survol le rappelle). C'est ce qui lui donne l'air d'une carte plutôt que
// d'un tableau.
//
// `onCell(slot)` : la carte est éditable (chez son propriétaire) — chaque case
// s'ouvre au clic. Sinon les cases remplies mènent à la fiche du jeu.
// `compact` : la version du profil, deux rangées de dix.

// Le numéro de la carte : tiré de l'id de la liste, stable et sans signification.
const cardNumber = (id) => String(parseInt(String(id || "0").slice(-6), 16) % 1000000).padStart(6, "0");

// La bande de lecture machine : « P<MPL<PSEUDO<<<… ». Plus longue qu'un vrai
// passeport (44 caractères) : le surplus est coupé par la carte, et la bande
// court ainsi d'un bord à l'autre quelle que soit la largeur.
function mrz(username, filled, total, year) {
  const name = String(username || "joueur")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[^A-Z0-9]/g, "<");
  const pad = (s) => (s + "<".repeat(80)).slice(0, 80);
  return [pad(`P<MPL<${name}<<CARTE<DE<JOUEUR`), pad(`${String(filled).padStart(2, "0")}<${total}<<${year}<<MYPLAYLOG<CC`)];
}

export default function PlayerCard({ list, items, author, compact = false, onCell, link = null }) {
  const board = boardOf(list?.board);
  const by = itemsBySlot(items);
  const ref = useRef(null);
  const filled = board.slots.filter((s) => by[s.key]).length;
  const year = new Date(list?.createdAt || Date.now()).getFullYear();
  const [l1, l2] = mrz(author?.username, filled, board.slots.length, year);

  // L'inclinaison suit le pointeur, sans re-rendu : des variables CSS.
  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
    el.style.setProperty("--ry", `${(x - 0.5) * (compact ? 3 : 5)}deg`);
    el.style.setProperty("--rx", `${(0.5 - y) * (compact ? 3 : 5)}deg`);
  };
  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  };

  const head = (
    <div className="pc-head">
      <span className="pc-avatar">
        {author?.avatar ? <img src={author.avatar} alt="" /> : <b>{(author?.username || "?")[0].toUpperCase()}</b>}
      </span>
      <span className="pc-id">
        <span className="pc-kicker">Carte de joueur</span>
        <span className="pc-name">{author?.username}</span>
      </span>
      <span className="pc-no">
        <span>N°</span>
        {cardNumber(list?.id)}
      </span>
    </div>
  );

  return (
    <div className={`pc-wrap ${compact ? "is-compact" : ""}`}>
      <article className="pc" ref={ref} onMouseMove={onMove} onMouseLeave={onLeave}>
        {link ? (
          <Link to={link} className="pc-head-link clickable">
            {head}
          </Link>
        ) : (
          head
        )}

        <ol className="pc-grid">
          {board.slots.map((s) => {
            const it = by[s.key];
            const gid = it ? it.gameId ?? it.refId : null;
            const inner = (
              <>
                {it?.image ? (
                  <img className="pc-cover" src={it.image} alt="" loading="lazy" />
                ) : it ? (
                  <span className="pc-noart">{it.name}</span>
                ) : (
                  <span className="pc-empty-ic">{onCell ? <Plus size={compact ? 14 : 20} /> : <s.Icon size={compact ? 13 : 18} />}</span>
                )}
                {it?.charImage && (
                  <span className="pc-medal">
                    <img src={it.charImage} alt="" loading="lazy" />
                  </span>
                )}
                {!compact && (
                  <span className="pc-tag">
                    <s.Icon size={11} strokeWidth={2.6} />
                    {s.label}
                  </span>
                )}
              </>
            );
            const title = it ? `${s.label} — ${it.charName ? `${it.charName}, ` : ""}${it.name}` : s.label;
            const cls = `pc-cell ${it ? "filled" : "empty"}`;
            return (
              <li key={s.key} className="pc-slot">
                {onCell ? (
                  <button type="button" className={`${cls} clickable`} onClick={() => onCell(s.key)} title={title}>
                    {inner}
                  </button>
                ) : it && gid ? (
                  <Link to={`/game/${gid}`} className={`${cls} clickable`} title={title}>
                    {inner}
                  </Link>
                ) : (
                  <span className={cls} title={title}>
                    {inner}
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        {!compact && (
          <div className="pc-mrz" aria-hidden="true">
            <span>{l1}</span>
            <span>{l2}</span>
          </div>
        )}
        <span className="pc-glare" aria-hidden="true" />
      </article>
    </div>
  );
}
