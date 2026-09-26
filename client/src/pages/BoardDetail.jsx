import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Eraser, Globe, Heart, ImageDown, Loader2, Lock, Sparkles } from "lucide-react";

import PlayerCard from "../components/board/PlayerCard";
import BoardPicker from "../components/board/BoardPicker";
import ListComments from "../components/ListComments";
import ListExportModal from "../components/ListExportModal";
import { apiFetch } from "../lib/api";
import { boardOf, itemsBySlot, openMyBoard } from "../lib/boards";

// ======================================================================
//  La page d'une carte de joueur — et son éditeur
// ======================================================================
// La carte se remplit ICI, directement : un clic sur une case ouvre le choix
// de son jeu (components/board/BoardPicker), et le choix est enregistré dans
// la foulée. Rien n'attend un bouton « Publier » : fermer une fenêtre par
// mégarde ne fait rien perdre.
//
// ⚠️ LES ENREGISTREMENTS PARTENT À LA FILE. Deux cases remplies coup sur coup
// envoient deux PUT de la liste entière ; s'ils se croisaient, le second
// arrivé écraserait le premier avec un état qui ne le contient pas. On
// enchaîne donc chaque envoi sur le précédent, et c'est toujours l'état le
// plus récent qui part.

export default function BoardDetail({ list, items: initialItems, token, onLike, onChanged }) {
  const navigate = useNavigate();
  const board = boardOf(list.board);
  const [items, setItems] = useState(initialItems);
  const [picking, setPicking] = useState(null); // clé de la case en cours de choix
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mine, setMine] = useState(null); // ma propre carte, sur celle d'un autre
  const queue = useRef(Promise.resolve());
  const latest = useRef(initialItems);

  useEffect(() => {
    if (!token || list.mine) return undefined;
    let alive = true;
    apiFetch(`/lists?scope=mine&board=${board.key}&limit=1`, { token })
      .then((d) => alive && setMine(d.lists?.[0] || null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token, list.mine, board.key]);

  const persist = (next, extra = {}) => {
    latest.current = next;
    setItems(next);
    setSaving(true);
    setSaved(false);
    queue.current = queue.current
      .catch(() => {})
      .then(() =>
        apiFetch(`/lists/${list.id}`, {
          method: "PUT",
          token,
          body: { items: latest.current, ...extra },
        })
      )
      .then((res) => {
        if (res?.list) onChanged?.(res.list);
        setSaved(true);
      })
      .catch((e) => alert(e.message || "Impossible d'enregistrer la case."))
      .finally(() => setSaving(false));
  };

  const setCell = (slot, game, char) => {
    const rest = items.filter((i) => i.slot !== slot);
    const next = game
      ? [
          ...rest,
          {
            kind: "game",
            refId: String(game.id),
            gameId: game.id,
            name: game.name,
            image: game.cover || null,
            slot,
            charName: char?.name || null,
            charImage: char?.image || null,
          },
        ]
      : rest;
    persist(next);
    setPicking(null);
  };

  // Vider la carte : on garde la carte (son lien, ses « j'aime », ses
  // commentaires), on retire seulement ses jeux.
  const clearAll = () => {
    if (!confirm("Vider ta carte ? Tous les jeux choisis seront retirés.")) return;
    persist([]);
  };

  const toggleVisibility = () =>
    persist(items, { visibility: list.visibility === "private" ? "public" : "private" });

  // Le petit « Enregistré » s'efface tout seul.
  useEffect(() => {
    if (!saved) return undefined;
    const t = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(t);
  }, [saved]);

  const by = itemsBySlot(items);

  const filled = board.slots.filter((sl) => by[sl.key]).length;
  const author = list.author || {};

  return (
    <div className="bd-page">
      <div className="bd-stage">
        <PlayerCard
          list={list}
          items={items}
          onCell={list.mine ? (slot) => setPicking(slot) : undefined}
          onRemove={list.mine ? (slot) => setCell(slot, null) : undefined}
        />

        {/* Les outils, en colonne à côté de la grille : rien au-dessus d'elle,
            rien par-dessus une case. */}
        <aside className="bd-rail">
          <button className="bd-rail-btn clickable" onClick={() => navigate(-1)} title="Retour">
            <ArrowLeft size={18} />
          </button>
          <Link to={`/u/${author.username}`} className="bd-rail-me clickable" title={author.username}>
            {author.avatar ? <img src={author.avatar} alt="" /> : <b>{(author.username || "?")[0].toUpperCase()}</b>}
          </Link>
          <span className="bd-rail-count" title={`${filled} cases remplies sur ${board.slots.length}`}>
            {filled}
            <small>/{board.slots.length}</small>
          </span>

          <button className="bd-rail-btn clickable" onClick={() => setExporting(true)} title="Exporter en image">
            <ImageDown size={17} />
          </button>

          {list.mine ? (
            <>
              <span
                className={`bd-rail-save ${saving || saved ? "on" : ""}`}
                title={saving ? "Enregistrement…" : "Enregistré"}
              >
                {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              </span>
              <button
                className="bd-rail-btn clickable"
                onClick={toggleVisibility}
                title={list.visibility === "private" ? "Privée — la rendre publique" : "Publique — la rendre privée"}
              >
                {list.visibility === "private" ? <Lock size={17} /> : <Globe size={17} />}
              </button>
              <button
                className="bd-rail-btn danger clickable"
                onClick={clearAll}
                disabled={!filled}
                title="Vider ma carte"
              >
                <Eraser size={17} />
              </button>
            </>
          ) : (
            <>
              {token && (
                <button
                  className={`bd-rail-btn clickable ${list.liked ? "liked" : ""}`}
                  onClick={onLike}
                  aria-pressed={!!list.liked}
                  title={list.liked ? "Je n'aime plus" : "J'aime"}
                >
                  <Heart size={17} fill={list.liked ? "currentColor" : "none"} />
                </button>
              )}
              {mine ? (
                <Link to={`/lists/${mine.id}`} className="bd-rail-btn gold clickable" title="Ma carte">
                  <ArrowRight size={17} />
                </Link>
              ) : (
                token && (
                  <button
                    className="bd-rail-btn gold clickable"
                    onClick={() => openMyBoard({ token, navigate, apiFetch, boardKey: board.key })}
                    title="Fais la tienne"
                  >
                    <Sparkles size={17} />
                  </button>
                )
              )}
            </>
          )}
        </aside>
      </div>

      <div className="bd-comments">
        <ListComments listId={list.id} list={list} token={token} />
      </div>

      {exporting && (
        <ListExportModal list={list} items={items} tiers={[]} token={token} onClose={() => setExporting(false)} />
      )}

      {picking && (
        <BoardPicker
          boardKey={board.key}
          slotKey={picking}
          current={by[picking] || null}
          token={token}
          onPick={(g, c) => setCell(picking, g, c)}
          onClear={() => setCell(picking, null)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
