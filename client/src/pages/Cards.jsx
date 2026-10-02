import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Anvil, Coins, Swords } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { EDITIONS, cardCover } from "../lib/cards";
import { useToast } from "../context/ToastContext";
import PackOpening from "../components/cards/PackOpening";
import BulkOpening from "../components/cards/BulkOpening";
import CardCollection from "../components/cards/CardCollection";
import FriendsBinders from "../components/cards/FriendsBinders";
import PackShop from "../components/cards/PackShop";
import TradeInbox from "../components/cards/TradeInbox";
import Workshop from "../components/cards/Workshop";

// ======================================================================
//  Cartes — les boosters à ouvrir et le classeur
// ======================================================================
// Une seule page : en haut les sachets (on clique, ça s'ouvre), puis les
// chiffres du set, les classeurs des amis et le mien. Aucun paragraphe : les
// icônes et les cartes parlent.

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

// Dernière réponse connue, par compte : retour sur la page sans attente.
const memo = new Map();

export default function Cards() {
  const { token, user, updateUser } = useAuth();
  const meId = user?.id || null;
  const [data, setData] = useState(() => (meId && memo.get(meId)) || null);
  const [err, setErr] = useState("");
  const [opening, setOpening] = useState(null); // { edition, origin, count, run }
  const [focusRecent, setFocusRecent] = useState(0);
  // Un échange conclu : on recharge le classeur (les cartes reçues arrivent).
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const commit = useCallback(
    (next) =>
      setData((prev) => {
        const v = typeof next === "function" ? next(prev) : next;
        if (v && meId) memo.set(meId, v);
        return v;
      }),
    [meId]
  );

  useEffect(() => {
    if (!token || !meId) return;
    let alive = true;
    apiFetch("/cards", { token })
      .then((d) => {
        if (!alive) return;
        setErr("");
        commit(d);
        // Les pastilles NEW s'affichent pour cette visite, puis s'éteignent.
        if (d.cards.some((c) => c.fresh))
          apiFetch("/cards/seen", { method: "POST", token }).catch(() => {});
      })
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [token, meId, commit, reload]);

  const toast = useToast();

  // Le cœur : posé tout de suite, rendu si le serveur refuse, « Annuler » dans
  // le toast.
  const setFavLocal = useCallback(
    (id, on) => commit((d) => (d ? { ...d, cards: d.cards.map((c) => (c.id === id ? { ...c, fav: on } : c)) } : d)),
    [commit]
  );
  const onFav = useCallback(
    async (card) => {
      const on = !card.fav;
      setFavLocal(card.id, on);
      try {
        await apiFetch("/cards/fav", { method: "POST", token, body: { card: card.id, on } });
        toast.show({
          title: card.name,
          cover: cardCover(card.cover, "t_cover_small"),
          text: on ? "Ajoutée aux favoris" : "Retirée des favoris",
          undo: async () => {
            await apiFetch("/cards/fav", { method: "POST", token, body: { card: card.id, on: !on } });
            setFavLocal(card.id, !on);
          },
        });
      } catch (e) {
        setFavLocal(card.id, !on);
        toast.show({ title: card.name, text: e.message, error: true });
      }
    },
    [token, toast, setFavLocal]
  );
  // Les classeurs perso vivent dans la même réponse que les cartes.
  const onBinders = useCallback(
    (fn) => commit((d) => (d ? { ...d, binders: typeof fn === "function" ? fn(d.binders || []) : fn } : d)),
    [commit]
  );

  // --- l'atelier : recycler, forger (toujours avec « Annuler ») -------------------
  const [workshop, setWorkshop] = useState(null); // { forgeCard }
  // Le solde bouge (recyclage, forge, annulation) : la page ET le compte.
  const withPoints = useCallback(
    (points) => {
      if (points == null) return;
      commit((d) => (d ? { ...d, points } : d));
      updateUser({ points });
    },
    [commit, updateUser]
  );
  // Des cartes partent (recyclées) : les compteurs baissent, une carte à zéro
  // quitte le classeur.
  const dropCards = useCallback(
    (left) =>
      commit((d) => {
        if (!d) return d;
        const m = new Map(left.map((x) => [x.id, x.left]));
        const cards = d.cards
          .map((c) => (m.has(c.id) ? { ...c, count: m.get(c.id) } : c))
          .filter((c) => c.count > 0);
        return { ...d, cards };
      }),
    [commit]
  );
  // L'annulation : les cartes reviennent (celles sorties du classeur aussi).
  const restoreCards = useCallback(
    (counts, originals) =>
      commit((d) => {
        if (!d) return d;
        const byId = new Map(d.cards.map((c) => [c.id, c]));
        for (const { id, count } of counts) {
          const had = byId.get(id) || originals.get(id);
          if (had) byId.set(id, { ...had, count });
        }
        return { ...d, cards: [...byId.values()] };
      }),
    [commit]
  );
  const recycled = useCallback(
    (res, picked) => {
      dropCards(res.cards);
      withPoints(res.points);
      const n = picked.reduce((a, x) => a + x.n, 0);
      const originals = new Map(picked.map((x) => [x.card.id, x.card]));
      toast.show({
        title: n > 1 ? `${n} cartes recyclées` : `${picked[0]?.card.name} recyclée`,
        cover: picked[0] ? cardCover(picked[0].card.cover, "t_cover_small") : undefined,
        text: `+${fmt(res.gained)} points`,
        undo: async () => {
          const back = await apiFetch(`/cards/recycle/${res.id}/undo`, { method: "POST", token });
          restoreCards(back.cards, originals);
          withPoints(back.points);
        },
      });
    },
    [dropCards, withPoints, restoreCards, toast, token]
  );
  const forged = useCallback(
    (res) => {
      setWorkshop(null);
      withPoints(res.points);
      commit((d) => (d ? { ...d, cards: [...d.cards.filter((c) => c.id !== res.card.id), res.card] } : d));
      toast.show({
        title: res.card.name,
        cover: cardCover(res.card.cover, "t_cover_small"),
        text: `Forgée · −${fmt(res.cost)} points`,
        undo: async () => {
          const back = await apiFetch(`/cards/forge/${res.id}/undo`, { method: "POST", token });
          dropCards([{ id: back.card, left: back.left }]);
          withPoints(back.points);
        },
      });
    },
    [commit, withPoints, dropCards, toast, token]
  );
  // Depuis la carte en grand : un exemplaire, sans scène (le toast suffit).
  const recycleOneRef = useRef(null);
  const recycleOne = useCallback(
    async (card) => {
      if (recycleOneRef.current) return;
      recycleOneRef.current = apiFetch("/cards/recycle", { method: "POST", token, body: { items: [{ card: card.id, n: 1 }] } });
      try {
        const res = await recycleOneRef.current;
        recycled(res, [{ card, n: 1 }]);
      } catch (e) {
        toast.show({ title: card.name, text: e.message, error: true });
      } finally {
        recycleOneRef.current = null;
      }
    },
    [token, recycled, toast]
  );

  const points = data?.points ?? user?.points ?? 0;
  const price = data?.price ?? 500;
  const canBuy = points >= price;

  // Les cartes tirées rejoignent le classeur dès que le serveur répond.
  const onOpened = useCallback(
    (res) => {
      updateUser({ points: res.points });
      commit((d) => {
        if (!d) return d;
        const byId = new Map(d.cards.map((c) => [c.id, c]));
        const now = new Date().toISOString();
        // Plusieurs boosters : leurs cartes dans l'ordre, la dernière
        // occurrence portant le bon compte.
        for (const c of (res.packs || [res]).flatMap((p) => p.cards)) {
          const had = byId.get(c.id);
          byId.set(c.id, had ? { ...had, count: c.count } : { ...c, firstAt: now, fresh: true });
        }
        return { ...d, points: res.points, cards: [...byId.values()] };
      });
    },
    [commit, updateUser]
  );

  // `count` > 1 : plusieurs boosters d'un coup ; `edition` nulle = au hasard.
  function openPack(edition, el, count = 1) {
    if (points < price * count || opening) return;
    const origin = el?.getBoundingClientRect?.() || null;
    setOpening({ edition, origin, count, run: Date.now() });
  }
  // « Encore » : le même lot, de la même édition.
  function again() {
    setOpening((o) =>
      o?.count > 1
        ? { ...o, run: Date.now() }
        : { edition: o?.edition || EDITIONS[0].key, origin: null, count: 1, run: Date.now() }
    );
  }
  function closeOpening() {
    setOpening(null);
    apiFetch("/cards/seen", { method: "POST", token }).catch(() => {});
  }
  // « Classeur » : on y descend, les dernières cartes en tête.
  function toBinder() {
    closeOpening();
    setFocusRecent((n) => n + 1);
  }

  const covers = data?.packCovers || [];

  return (
    <div className="cd-page">
      <header className="cd-head">
        <h1 className="cd-title">Cartes</h1>
        <div className="cd-head-right">
          {/* Les échanges en attente : une pastille, le détail dans un panneau. */}
          <TradeInbox token={token} me={user} onChanged={refresh} onBinder={() => setFocusRecent((n) => n + 1)} />
          <Link to="/cartes/combat" className="cd-wallet cd-battle-btn clickable" title="Combat de cartes">
            <Swords size={18} />
            <b>Combat</b>
          </Link>
          <button
            className="cd-wallet ws-wallet clickable"
            onClick={() => setWorkshop({ forgeCard: null })}
            title="Atelier : recycler des cartes contre des points, en forger une"
          >
            <Anvil size={18} />
            <b>Atelier</b>
          </button>
          <Link to="/arcade" className="cd-wallet clickable" title="Points d'arcade">
            <Coins size={18} />
            <b>{fmt(points)}</b>
          </Link>
        </div>
      </header>


      {err && <p className="cd-err">{err}</p>}

      {/* ---------- Les boosters ---------- */}
      <PackShop
        data={data}
        covers={covers}
        canBuy={canBuy}
        points={points}
        price={price}
        onOpen={openPack}
      />

      <CardCollection
        editable
        token={token}
        binders={data?.binders || []}
        onBinders={onBinders}
        onFav={onFav}
        cards={data?.cards || []}
        rarities={data?.rarities || []}
        setSize={data?.setSize || 0}
        loading={!data && !err}
        drops
        goldenChance={data?.goldenChance}
        focusRecent={focusRecent}
        between={<FriendsBinders token={token} />}
        onForge={(card) => setWorkshop({ forgeCard: card })}
        onRecycle={recycleOne}
        rates={data?.workshop?.recycle || null}
      />

      {workshop && (
        <Workshop
          token={token}
          cards={data?.cards || []}
          points={points}
          forgeCard={workshop.forgeCard}
          onClose={() => setWorkshop(null)}
          onRecycled={(res, picked) => {
            setWorkshop(null);
            recycled(res, picked);
          }}
          onForged={forged}
        />
      )}

      {opening?.count > 1 && (
        <BulkOpening
          key={opening.run}
          token={token}
          edition={opening.edition}
          count={opening.count}
          price={price}
          onOpened={onOpened}
          onAgain={again}
          onBinder={toBinder}
          onClose={closeOpening}
        />
      )}
      {opening && !(opening.count > 1) && (
        <PackOpening
          key={opening.run}
          token={token}
          edition={opening.edition}
          covers={covers}
          origin={opening.origin}
          price={price}
          onOpened={onOpened}
          onAgain={again}
          onBinder={toBinder}
          onClose={closeOpening}
        />
      )}
    </div>
  );
}
