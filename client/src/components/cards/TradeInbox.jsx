import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeftRight, Check, X, Loader2, Pencil, ChevronRight } from "lucide-react";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useBackClose } from "../../hooks/useBackClose";
import { timeAgo } from "../../lib/lists";
import { apiFetch } from "../../lib/api";
import { cardCover } from "../../lib/cards";
import { useToast } from "../../context/ToastContext";
import TcgCard from "./TcgCard";
import TradeScene from "./TradeScene";
import TradeComposer from "./TradeComposer";
import CardInspector from "./CardInspector";

// ======================================================================
//  Les échanges en cours : un bouton dans l'en-tête, un panneau à part
// ======================================================================
// Rien quand il n'y a rien. Sinon, une pastille compacte à côté du porte-
// monnaie (les têtes des amis, et le nombre de propositions reçues en rose) :
// la page ne s'allonge plus d'une rangée par échange. Elle ouvre un PANNEAU —
// à droite sur ordinateur, une feuille qui monte du bas sur téléphone — avec
// deux onglets, Reçus et Envoyés.
//
// Chaque échange y est lu de MON point de vue : ce que je donne, ce que je
// reçois. Chaque carte s'ouvre en grand d'un clic. « Contre-proposer » /
// « Modifier » rouvre l'échange dans le compositeur. Accepter joue l'échange
// en scène ; un échange accepté pendant mon absence (je l'avais proposé) se
// rejoue à mon retour, une fois.

// Les cartes d'un côté de l'échange, en éventail serré.
function Fan({ cards, onOpen }) {
  const n = cards.length;
  return (
    <span className={`tx-fan n${n}`}>
      {cards.map((c, i) => (
        <button
          key={c.id}
          className="tx-mini clickable"
          title={c.name}
          style={{ "--i": i - (n - 1) / 2 }}
          onClick={() => onOpen(c)}
        >
          <TcgCard card={c} lite tilt={false} />
        </button>
      ))}
    </span>
  );
}

function Face({ user, size = 40 }) {
  return (
    <span className="tx-ava" style={{ width: size, height: size }}>
      {user.avatar ? <img src={user.avatar} alt="" draggable="false" /> : <b>{user.username[0]}</b>}
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
  const [isOpen, setOpen] = useState(false);
  const [tab, setTab] = useState(null); // in | out (null : le plus utile)

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

  // Arrivé depuis une notification : le panneau s'ouvre de lui-même.
  const fromNotif = location.search.includes("echanges");
  useEffect(() => {
    if (fromNotif && (data?.incoming?.length || data?.outgoing?.length)) setOpen(true);
  }, [fromNotif, data]);

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
  function openCard(t, c) {
    const inc = !t.mine;
    const list = [...(inc ? t.want : t.give), ...(inc ? t.give : t.want)];
    setInspect({ list, index: Math.max(0, list.findIndex((x) => x.id === c.id)) });
  }

  const incoming = data?.incoming || [];
  const outgoing = data?.outgoing || [];
  const total = incoming.length + outgoing.length;
  // Plus rien en attente : le panneau se referme tout seul.
  useEffect(() => {
    if (data && !total) setOpen(false);
  }, [data, total]);
  const shownTab = tab === "out" || (!tab && !incoming.length) ? "out" : "in";
  const list = shownTab === "in" ? incoming : outgoing;
  // Les têtes de la pastille : ceux qui attendent ma réponse d'abord.
  const faces = [];
  for (const t of [...incoming, ...outgoing]) {
    const o = t.mine ? t.to : t.from;
    if (!faces.some((f) => f.username === o.username)) faces.push(o);
  }

  return (
    <>
      {total > 0 && (
        <button
          ref={ref}
          className={`tx-pill clickable ${incoming.length ? "has-in" : ""}`}
          onClick={() => setOpen(true)}
          title="Échanges en attente"
        >
          <span className="tx-pill-faces">
            {faces.slice(0, 3).map((u) => (
              <Face key={u.username} user={u} size={26} />
            ))}
          </span>
          <ArrowLeftRight className="tx-pill-ic" />
          <span className="tx-pill-lbl">Échanges</span>
          <b className="tx-pill-n">{incoming.length || outgoing.length}</b>
        </button>
      )}

      {isOpen && total > 0 && (
        <TradePanel onClose={() => setOpen(false)}>
          <header className="tx-panel-head">
            <h3>
              <ArrowLeftRight />
              Échanges
            </h3>
            <button className="tx-x clickable" onClick={() => setOpen(false)} aria-label="Fermer">
              <X />
            </button>
          </header>
          <nav className="tx-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={shownTab === "in"}
              className={`tx-tab clickable ${shownTab === "in" ? "on" : ""}`}
              onClick={() => setTab("in")}
            >
              Reçus {incoming.length > 0 && <b className="hot">{incoming.length}</b>}
            </button>
            <button
              role="tab"
              aria-selected={shownTab === "out"}
              className={`tx-tab clickable ${shownTab === "out" ? "on" : ""}`}
              onClick={() => setTab("out")}
            >
              Envoyés {outgoing.length > 0 && <b>{outgoing.length}</b>}
            </button>
          </nav>

          <div className="tx-scroll">
            {list.length === 0 ? (
              <p className="tx-empty">{shownTab === "in" ? "Aucune proposition reçue." : "Aucune proposition envoyée."}</p>
            ) : (
              list.map((t) => {
                const inc = !t.mine;
                const other = inc ? t.from : t.to;
                return (
                  <article key={t.id} className={`tx-card ${inc ? "in" : "out"}`}>
                    <Link
                      to={`/cartes/u/${other.username}`}
                      className="tx-who clickable"
                      onClick={() => setOpen(false)}
                    >
                      <Face user={other} size={36} />
                      <span className="tx-who-txt">
                        <b>{other.username}</b>
                        <small>
                          {inc ? (t.reply ? "contre-propose" : "te propose") : "attend sa réponse"}
                          {t.createdAt ? ` · ${timeAgo(t.createdAt)}` : ""}
                        </small>
                      </span>
                      <ChevronRight className="tx-who-go" />
                    </Link>

                    <div className="tx-deal">
                      <div className="tx-side give">
                        <small>Tu donnes</small>
                        <Fan cards={inc ? t.want : t.give} onOpen={(c) => openCard(t, c)} />
                      </div>
                      <span className="tx-swap">
                        <ArrowLeftRight />
                      </span>
                      <div className="tx-side get">
                        <small>Tu reçois</small>
                        <Fan cards={inc ? t.give : t.want} onOpen={(c) => openCard(t, c)} />
                      </div>
                    </div>

                    <footer className="tx-actions">
                      {busy === t.id ? (
                        <span className="tx-busy">
                          <Loader2 className="spin" />
                        </span>
                      ) : inc ? (
                        <>
                          <button className="tx-btn icon clickable" onClick={() => decline(t)} title="Refuser" aria-label="Refuser">
                            <X />
                          </button>
                          <button className="tx-btn ghost clickable" onClick={() => modify(t)} title="Proposer autre chose">
                            <Pencil />
                            <span>Contre-proposer</span>
                          </button>
                          <button className="tx-btn gold grow clickable" onClick={() => accept(t)}>
                            <Check />
                            <span>Accepter</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="tx-btn ghost clickable" onClick={() => cancel(t)}>
                            <X />
                            <span>Annuler</span>
                          </button>
                          <button className="tx-btn ghost grow clickable" onClick={() => modify(t)}>
                            <Pencil />
                            <span>Modifier</span>
                          </button>
                        </>
                      )}
                    </footer>
                  </article>
                );
              })
            )}
          </div>
        </TradePanel>
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

// Le panneau : à droite sur ordinateur, une feuille du bas sur téléphone.
// Retour / Échap / clic sur le voile le referment ; la page derrière ne
// défile pas.
function TradePanel({ onClose, children }) {
  useScrollLock(true);
  useBackClose(onClose, "trades");
  useEffect(() => {
    const on = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return createPortal(
    <div className="tx-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="tx-panel" role="dialog" aria-label="Échanges">
        <span className="tx-grip" aria-hidden="true" />
        {children}
      </aside>
    </div>,
    document.body
  );
}
