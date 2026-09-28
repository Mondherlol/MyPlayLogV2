import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeftRight, Check, X, Loader2, Pencil } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { cardCover } from "../../lib/cards";
import { useToast } from "../../context/ToastContext";
import TcgCard from "./TcgCard";
import TradeScene from "./TradeScene";
import TradeComposer from "./TradeComposer";
import CardInspector from "./CardInspector";

// ======================================================================
//  Les échanges en cours, en haut de la page Cartes
// ======================================================================
// Rien quand il n'y a rien. Sinon, une rangée par échange, toujours lue de
// MON point de vue : à gauche ce que je donne, à droite ce que je reçois.
// Chaque carte s'ouvre en grand d'un clic. « Modifier » rouvre l'échange
// dans le compositeur : sur une proposition reçue, c'est une
// contre-proposition ; sur la mienne, une retouche.
// Accepter joue l'échange en scène ; un échange accepté pendant mon absence
// (je l'avais proposé) se rejoue à mon retour, une fois.

function Mini({ cards, onOpen }) {
  return (
    <span className="tx-cards">
      {cards.map((c) => (
        <button key={c.id} className="tx-mini clickable" title={c.name} onClick={() => onOpen(c)}>
          <TcgCard card={c} lite tilt={false} />
        </button>
      ))}
    </span>
  );
}

export default function TradeInbox({ token, me, onChanged, onBinder }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [scene, setScene] = useState(null);
  const toast = useToast();
  const ref = useRef(null);
  const location = useLocation();
  const played = useRef(new Set());
  const [inspect, setInspect] = useState(null); // { list, index }
  const [edit, setEdit] = useState(null); // { t, other, theirCards, wants }

  const load = useCallback(() => {
    if (!token) return;
    apiFetch("/cards/trades", { token })
      .then(setData)
      .catch(() => {});
  }, [token]);
  useEffect(() => load(), [load]);

  // Un échange conclu en mon absence : l'animation, une fois.
  useEffect(() => {
    const t = data?.unseen?.find((x) => !played.current.has(x.id));
    if (!t || scene) return;
    played.current.add(t.id);
    setScene({ other: t.to, gave: t.give, got: t.want });
    apiFetch(`/cards/trades/${t.id}/seen`, { method: "POST", token }).catch(() => {});
    onChanged?.();
  }, [data, scene, token, onChanged]);

  // Arrivé depuis une notification : on descend jusqu'aux échanges.
  useEffect(() => {
    if (!location.search.includes("echanges") || !data) return;
    requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [location.search, data]);

  async function accept(t) {
    setBusy(t.id);
    try {
      await apiFetch(`/cards/trades/${t.id}/accept`, { method: "POST", token });
      setScene({ other: t.from, gave: t.want, got: t.give });
      onChanged?.();
    } catch (e) {
      toast.show({ title: "Échange", text: e.message, error: true });
    } finally {
      setBusy(null);
      load();
    }
  }
  async function decline(t) {
    setBusy(t.id);
    try {
      await apiFetch(`/cards/trades/${t.id}/decline`, { method: "POST", token });
      toast.show({ title: t.from.username, cover: cardCover(t.give[0]?.cover, "t_cover_small"), text: "Échange refusé" });
    } catch (e) {
      toast.show({ title: "Échange", text: e.message, error: true });
    } finally {
      setBusy(null);
      load();
    }
  }
  // Retoucher un échange : il faut ses cartes à lui (pour choisir ce que je
  // demande) — chargées à l'ouverture.
  async function modify(t) {
    const inc = !t.mine;
    const other = inc ? t.from : t.to;
    const base = {
      t,
      other,
      reply: inc,
      give: inc ? t.want : t.give,
      want: inc ? t.give : t.want,
      theirCards: null,
      wants: null,
    };
    setEdit(base);
    try {
      const [u, lite] = await Promise.all([
        apiFetch(`/cards/u/${other.username}`, { token }),
        apiFetch("/cards/lite", { token }).catch(() => null),
      ]);
      setEdit((e) => e && e.t.id === t.id && { ...e, theirCards: u.cards || [], wants: lite ? new Set(lite.wants) : null });
    } catch (e) {
      setEdit(null);
      toast.show({ title: "Échange", text: e.message, error: true });
    }
  }
  function onEdited(nt) {
    const e = edit;
    setEdit(null);
    load();
    toast.show({
      title: e.other.username,
      cover: cardCover(nt.want?.[0]?.cover, "t_cover_small"),
      text: e.reply ? "Contre-proposition envoyée" : "Échange modifié",
      undo: async () => {
        await apiFetch(`/cards/trades/${nt.id}/cancel`, { method: "POST", token, body: { restore: true } });
        load();
      },
    });
  }

  async function cancel(t) {
    setBusy(t.id);
    try {
      await apiFetch(`/cards/trades/${t.id}/cancel`, { method: "POST", token });
      toast.show({
        title: t.to.username,
        cover: cardCover(t.want[0]?.cover, "t_cover_small"),
        text: "Proposition annulée",
        undo: async () => {
          await apiFetch("/cards/trades", {
            method: "POST",
            token,
            body: { to: t.to.username, give: t.give.map((c) => c.id), want: t.want.map((c) => c.id) },
          });
          load();
        },
      });
    } catch (e) {
      toast.show({ title: "Échange", text: e.message, error: true });
    } finally {
      setBusy(null);
      load();
    }
  }

  // Une carte en grand : on feuillette tout l'échange (ce que je donne, puis
  // ce que je reçois).
  function open(t, c) {
    const inc = !t.mine;
    const list = [...(inc ? t.want : t.give), ...(inc ? t.give : t.want)];
    setInspect({ list, index: Math.max(0, list.findIndex((x) => x.id === c.id)) });
  }

  const incoming = data?.incoming || [];
  const outgoing = data?.outgoing || [];

  return (
    <>
      {(incoming.length > 0 || outgoing.length > 0) && (
        <section className="tx" ref={ref}>
          <h2 className="tx-h">
            <ArrowLeftRight />
            Échanges
            {incoming.length > 0 && <b>{incoming.length}</b>}
          </h2>
          <div className="tx-list">
            {[...incoming, ...outgoing].map((t) => {
              const inc = !t.mine;
              const other = inc ? t.from : t.to;
              return (
                <div key={t.id} className={`tx-row ${inc ? "in" : "out"}`}>
                  <Link to={`/cartes/u/${other.username}`} className="tx-who clickable">
                    <span className="tx-ava">
                      {other.avatar ? <img src={other.avatar} alt="" draggable="false" /> : <b>{other.username[0]}</b>}
                    </span>
                    <span className="tx-who-txt">
                      <b>{other.username}</b>
                      <small>{inc ? (t.reply ? "contre-propose" : "te propose") : "en attente"}</small>
                    </span>
                  </Link>
                  <span className="tx-deal">
                    <span className="tx-side">
                      <small>Tu donnes</small>
                      <Mini cards={inc ? t.want : t.give} onOpen={(c) => open(t, c)} />
                    </span>
                    <ArrowLeftRight className="tx-arrow" />
                    <span className="tx-side">
                      <small>Tu reçois</small>
                      <Mini cards={inc ? t.give : t.want} onOpen={(c) => open(t, c)} />
                    </span>
                  </span>
                  <span className="tx-actions">
                    {busy === t.id ? (
                      <Loader2 className="spin" />
                    ) : inc ? (
                      <>
                        <button className="tx-btn ghost clickable" onClick={() => decline(t)} title="Refuser">
                          <X />
                          <span>Refuser</span>
                        </button>
                        <button className="tx-btn ghost clickable" onClick={() => modify(t)} title="Proposer autre chose">
                          <Pencil />
                          <span>Modifier</span>
                        </button>
                        <button className="tx-btn gold clickable" onClick={() => accept(t)} title="Accepter">
                          <Check />
                          <span>Accepter</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="tx-btn ghost clickable" onClick={() => modify(t)} title="Modifier">
                          <Pencil />
                          <span>Modifier</span>
                        </button>
                        <button className="tx-btn ghost clickable" onClick={() => cancel(t)} title="Annuler">
                          <X />
                          <span>Annuler</span>
                        </button>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {inspect && (
        <CardInspector
          list={inspect.list}
          index={inspect.index}
          onIndex={(i) => setInspect((x) => x && { ...x, index: i })}
          onClose={() => setInspect(null)}
        />
      )}
      {edit && (
        <TradeComposer
          token={token}
          friend={edit.other}
          theirCards={edit.theirCards}
          wants={edit.wants}
          startGive={edit.give}
          startWant={edit.want}
          replaces={edit.t.id}
          reply={edit.reply}
          onClose={() => setEdit(null)}
          onSent={onEdited}
        />
      )}
      {scene && (
        <TradeScene
          me={me}
          other={scene.other}
          gave={scene.gave}
          got={scene.got}
          onClose={() => setScene(null)}
          onBinder={() => {
            setScene(null);
            onBinder?.();
          }}
        />
      )}
    </>
  );
}
