import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Coins, Package, Joystick } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { EDITIONS } from "../lib/cards";
import BoosterPack from "../components/cards/BoosterPack";
import PackOpening from "../components/cards/PackOpening";
import CardCollection from "../components/cards/CardCollection";
import FriendsBinders from "../components/cards/FriendsBinders";

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
  const [opening, setOpening] = useState(null); // { edition, origin, run }
  const [focusRecent, setFocusRecent] = useState(0);

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
  }, [token, meId, commit]);

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
        for (const c of res.cards) {
          const had = byId.get(c.id);
          byId.set(c.id, had ? { ...had, count: c.count } : { ...c, firstAt: now, fresh: true });
        }
        return { ...d, points: res.points, cards: [...byId.values()] };
      });
    },
    [commit, updateUser]
  );

  function openPack(edition, el) {
    if (!canBuy || opening) return;
    const origin = el?.getBoundingClientRect?.() || null;
    setOpening({ edition, origin, run: Date.now() });
  }
  // « Encore » : un nouveau sachet de la même édition.
  function again() {
    setOpening((o) => ({ edition: o?.edition || EDITIONS[0].key, origin: null, run: Date.now() }));
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
        <Link to="/arcade" className="cd-wallet clickable" title="Points d'arcade">
          <Coins size={18} />
          <b>{fmt(points)}</b>
        </Link>
      </header>

      {err && <p className="cd-err">{err}</p>}

      {/* ---------- Les boosters ---------- */}
      <section className="cd-shop">
        <div className={`cd-packs ${canBuy ? "" : "poor"}`}>
          {EDITIONS.map((ed, i) => (
            <button
              key={ed.key}
              className={`cd-pack p${i} clickable`}
              onClick={(e) => openPack(ed.key, e.currentTarget.querySelector(".bst"))}
              disabled={!data || !canBuy}
              aria-label={`Ouvrir un booster ${ed.name}`}
            >
              <BoosterPack edition={ed.key} covers={covers} />
            </button>
          ))}
        </div>
        {canBuy ? (
          <button
            className="cd-buy clickable"
            disabled={!data}
            onClick={(e) =>
              openPack(EDITIONS[1].key, e.currentTarget.parentElement.querySelector(".cd-pack.p1 .bst"))
            }
          >
            <Package size={18} /> Ouvrir
            <span className="cd-buy-price">
              <Coins size={15} /> {fmt(price)}
            </span>
          </button>
        ) : (
          <Link to="/arcade" className="cd-buy poor clickable">
            <Joystick size={18} /> Il manque
            <span className="cd-buy-price">
              <Coins size={15} /> {fmt(price - points)}
            </span>
          </Link>
        )}
      </section>

      <CardCollection
        cards={data?.cards || []}
        rarities={data?.rarities || []}
        setSize={data?.setSize || 0}
        loading={!data && !err}
        drops
        goldenChance={data?.goldenChance}
        focusRecent={focusRecent}
        between={<FriendsBinders token={token} />}
      />

      {opening && (
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
