import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Globe, Heart, Loader2, Lock, Sparkles, Trash2 } from "lucide-react";

import PlayerCard from "../components/board/PlayerCard";
import BoardPicker from "../components/board/BoardPicker";
import ListComments from "../components/ListComments";
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

export default function BoardDetail({ list, items: initialItems, token, onLike, onDelete, onChanged }) {
  const navigate = useNavigate();
  const board = boardOf(list.board);
  const [items, setItems] = useState(initialItems);
  const [picking, setPicking] = useState(null); // clé de la case en cours de choix
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

  const toggleVisibility = () =>
    persist(items, { visibility: list.visibility === "private" ? "public" : "private" });

  // Le petit « Enregistré » s'efface tout seul.
  useEffect(() => {
    if (!saved) return undefined;
    const t = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(t);
  }, [saved]);

  const by = itemsBySlot(items);

  return (
    <div className="bd-page">
      <div className="nd-top">
        <button className="nd-back clickable" onClick={() => navigate(-1)}>
          <ArrowLeft size={17} /> Retour
        </button>
        <div className="nd-tools">
          {list.mine && (
            <span className={`bd-save ${saving || saved ? "on" : ""}`}>
              {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              {saving ? "Enregistrement…" : "Enregistré"}
            </span>
          )}
          {list.mine ? (
            <>
              <button
                className="nd-tool clickable"
                onClick={toggleVisibility}
                title={list.visibility === "private" ? "Privée — la rendre publique" : "Publique — la rendre privée"}
              >
                {list.visibility === "private" ? <Lock size={15} /> : <Globe size={15} />}
              </button>
              <button className="nd-tool danger clickable" onClick={onDelete} title="Supprimer">
                <Trash2 size={16} />
              </button>
            </>
          ) : (
            <>
              {token && (
                <button
                  className={`nd-like clickable ${list.liked ? "on" : ""}`}
                  onClick={onLike}
                  aria-pressed={!!list.liked}
                  title={list.liked ? "Je n'aime plus" : "J'aime"}
                >
                  <Heart size={16} fill={list.liked ? "currentColor" : "none"} />
                  {list.likeCount > 0 && <span>{list.likeCount}</span>}
                </button>
              )}
              {mine ? (
                <Link to={`/lists/${mine.id}`} className="btn btn-primary bd-cta clickable">
                  Ma carte <ArrowRight size={16} />
                </Link>
              ) : (
                token && (
                  <button
                    className="btn btn-primary bd-cta clickable"
                    onClick={() => openMyBoard({ token, navigate, apiFetch, boardKey: board.key })}
                  >
                    <Sparkles size={16} /> Fais la tienne
                  </button>
                )
              )}
            </>
          )}
        </div>
      </div>

      <PlayerCard
        list={list}
        items={items}
        author={list.author}
        onCell={list.mine ? (slot) => setPicking(slot) : undefined}
      />

      <div className="bd-comments">
        <ListComments listId={list.id} list={list} token={token} />
      </div>

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
