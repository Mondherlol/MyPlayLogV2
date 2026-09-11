import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Heart,
  Loader2,
  Pencil,
  PartyPopper,
  Trash2,
} from "lucide-react";
import BingoComposer from "../components/bingo/BingoComposer";
import BingoGrid from "../components/bingo/BingoGrid";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import {
  bingoPhase,
  checkedCount,
  completedLines,
  filledCount,
  isFullHouse,
} from "../lib/bingo";
import { countdown, fullWhen } from "../lib/homeEvents";

// ======================================================================
//  Une grille, en grand
// ======================================================================
// C'est la page qu'on garde ouverte PENDANT l'émission : on coche au fil des
// annonces, les lignes s'allument toutes seules, et le bandeau du haut dit où
// on en est.
//
// ⚠️ COCHER N'EST POSSIBLE QUE SUR SA PROPRE GRILLE, ET QU'UNE FOIS L'ÉMISSION
// COMMENCÉE. Les deux gardes sont côté serveur (cf. routes/bingo.js) ; ici on
// se contente de ne pas proposer un geste qui sera refusé.

export default function BingoPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [grid, setGrid] = useState(null);
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`/bingo/${id}`, { token })
      .then((d) => {
        if (!alive) return;
        setGrid(d.grid);
        setEvent(d.event);
      })
      .catch(() => alive && setGrid(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, token]);

  /**
   * Cocher une case.
   *
   * ⚠️ ON PEINT AVANT DE DEMANDER, et on envoie L'ÉTAT VOULU, pas « inverse ».
   * Le geste est fait dans l'excitation d'une annonce, souvent deux fois de
   * suite : un serveur qui inverse laisserait la case dans l'état contraire de
   * ce qu'on voit.
   */
  const check = useCallback(
    async (index) => {
      if (!grid) return;
      const cell = grid.cells[index];
      if (!cell) return;
      const want = !cell.checked;
      const before = grid.cells;
      setGrid((g) => ({
        ...g,
        cells: g.cells.map((c, i) => (i === index ? { ...c, checked: want } : c)),
      }));
      try {
        await apiFetch(`/bingo/${grid.id}/check`, {
          method: "POST",
          token,
          body: { index, checked: want },
        });
      } catch {
        setGrid((g) => ({ ...g, cells: before }));
      }
    },
    [grid, token]
  );

  const like = useCallback(async () => {
    if (!grid) return;
    const liked = !grid.liked;
    setGrid((g) => ({
      ...g,
      liked,
      likeCount: Math.max(0, (g.likeCount || 0) + (liked ? 1 : -1)),
    }));
    try {
      const d = await apiFetch(`/bingo/${grid.id}/like`, { method: "POST", token });
      setGrid((g) => ({ ...g, liked: d.liked ?? liked, likeCount: d.likeCount ?? g.likeCount }));
    } catch {
      setGrid((g) => ({
        ...g,
        liked: !liked,
        likeCount: Math.max(0, (g.likeCount || 0) + (liked ? -1 : 1)),
      }));
    }
  }, [grid, token]);

  const togglePublish = useCallback(async () => {
    if (!grid) return;
    const want = !grid.published;
    setGrid((g) => ({ ...g, published: want }));
    try {
      await apiFetch(`/bingo/${grid.id}/publish`, {
        method: "POST",
        token,
        body: { published: want },
      });
    } catch {
      setGrid((g) => ({ ...g, published: !want }));
    }
  }, [grid, token]);

  const remove = useCallback(async () => {
    if (!grid || !window.confirm("Supprimer ta grille ? C'est définitif.")) return;
    try {
      await apiFetch(`/bingo/${grid.id}`, { method: "DELETE", token });
      navigate(event ? `/event/${event.id}` : "/app");
    } catch {
      /* on laisse la page telle quelle : rien n'a été perdu */
    }
  }, [grid, token, navigate, event]);

  if (loading) {
    return (
      <div className="mh-loading">
        <Loader2 size={26} className="spin" />
      </div>
    );
  }

  if (!grid) {
    return (
      <div className="ep-missing">
        <p>Cette grille n'est pas accessible.</p>
        <Link to="/app" className="mh-pill ghost clickable">
          Retour à l'accueil
        </Link>
      </div>
    );
  }

  const phase = bingoPhase(event || {});
  const canCheck = grid.mine && phase.canCheck;
  const lines = completedLines(grid.cells, grid.size).length;
  const full = isFullHouse(grid.cells);
  const when = event ? countdown(event) : null;

  return (
    <div className="bgp">
      <Link to={event ? `/event/${event.id}` : "/app"} className="ep-back clickable">
        <ArrowLeft size={15} /> {event ? event.name : "Accueil"}
      </Link>

      <header className="bgp-head">
        <div className="bgp-who">
          <Link to={`/u/${grid.author?.username}`} className="bgp-av clickable">
            {grid.author?.avatar ? (
              <img src={grid.author.avatar} alt="" />
            ) : (
              (grid.author?.username || "?").charAt(0).toUpperCase()
            )}
          </Link>
          <div>
            <span className="mh-kicker">
              {grid.mine ? "Ma grille" : `La grille de ${grid.author?.username}`}
            </span>
            <h1>{grid.title || (event ? event.name : "Bingo")}</h1>
            {!!event && <p className="bgp-when">{fullWhen(event.startsAt, event.precision)}</p>}
          </div>
        </div>

        <div className="bgp-acts">
          {!grid.mine && (
            <button
              className={`mh-pill ghost clickable ${grid.liked ? "on" : ""}`}
              onClick={like}
              aria-pressed={grid.liked}
            >
              <Heart size={15} fill={grid.liked ? "currentColor" : "none"} />
              {grid.likeCount || 0}
            </button>
          )}

          {grid.mine && phase.canCompose && (
            <button className="mh-pill ghost clickable" onClick={() => setEditing(true)}>
              <Pencil size={14} /> Modifier
            </button>
          )}

          {grid.mine && (
            <button className="mh-pill ghost clickable" onClick={togglePublish}>
              {grid.published ? <Eye size={15} /> : <EyeOff size={15} />}
              {grid.published ? "Visible" : "Brouillon"}
            </button>
          )}

          {grid.mine && (
            <button className="mh-pill ghost clickable danger" onClick={remove} title="Supprimer">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </header>

      {/* L'état du jeu, en une ligne. Avant l'émission il rappelle la règle ;
          pendant, il compte les lignes ; à la première, il félicite. */}
      <div className={`bgp-state ${full ? "full" : lines ? "win" : ""}`}>
        {full ? (
          <>
            <PartyPopper size={16} /> Carton plein !
          </>
        ) : lines > 0 ? (
          <>
            <PartyPopper size={16} /> BINGO — {lines} ligne{lines > 1 ? "s" : ""} complète
            {lines > 1 ? "s" : ""}
          </>
        ) : phase.canCheck ? (
          <>
            {checkedCount(grid.cells)} / {filledCount(grid.cells)} cochées
          </>
        ) : (
          <>
            {filledCount(grid.cells)} / {grid.size * grid.size} cases remplies · les cases se
            cochent {when?.big ? `dans ${when.big.replace("J-", "")} ` : ""}au début de l'émission
          </>
        )}
      </div>

      <BingoGrid
        cells={grid.cells}
        size={grid.size}
        mode={canCheck ? "check" : "view"}
        onCell={canCheck ? check : undefined}
        className="bgp-grid"
      />

      {canCheck && <p className="bgp-hint">Clique une case pour la cocher.</p>}

      {editing && event && (
        <BingoComposer
          eventId={event.id}
          eventName={event.name}
          token={token}
          initial={grid}
          onClose={() => setEditing(false)}
          onSaved={(g) => setGrid((prev) => ({ ...prev, ...g }))}
        />
      )}
    </div>
  );
}
