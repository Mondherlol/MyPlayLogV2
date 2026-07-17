import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Coins,
  Loader2,
  Sparkles,
  Package,
  PackageOpen,
  Music2,
  Check,
  History,
  Lock,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useCosmetics } from "../context/CosmeticsContext";
import { apiFetch } from "../lib/api";
import {
  RARITIES,
  REWARD_TYPES,
  rarityColor,
  rarityLabel,
  rarityRank,
} from "../lib/rarity";
import RewardArt from "../components/RewardArt";
import CaseOpeningModal from "../components/CaseOpeningModal";

// ======================================================================
//  Arcade — le magasin : les points gagnés en jouant s'échangent en caisses.
// ======================================================================

const SOURCE_LABEL = {
  blindtest: "Blind test",
  case: "Caisse ouverte",
  duplicate: "Doublon reconverti",
  admin: "Ajustement",
  backfill: "Tes parties d'avant l'arcade",
};

export default function Arcade() {
  const { token, updateUser } = useAuth();
  const { setCosmetic } = useCosmetics();

  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [openingBox, setOpeningBox] = useState(null);
  const [tab, setTab] = useState("cursor"); // famille affichée dans l'inventaire
  const [equipping, setEquipping] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch("/arcade", { token })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message || "Impossible de charger l'arcade."));
    return () => {
      alive = false;
    };
  }, [token]);

  // Inventaire rangé : les plus rares d'abord, puis les plus récents.
  const inventory = useMemo(() => {
    if (!data) return [];
    return [...data.inventory].sort(
      (a, b) =>
        rarityRank(b.rarity) - rarityRank(a.rarity) ||
        new Date(b.obtainedAt || 0) - new Date(a.obtainedAt || 0)
    );
  }, [data]);

  // Onglets d'inventaire : seulement les familles où le joueur a quelque chose,
  // + celle en cours (pour ne pas voir l'onglet disparaître sous ses pieds).
  const tabs = useMemo(() => {
    const present = new Set(inventory.map((r) => r.type));
    return Object.keys(REWARD_TYPES).filter((t) => present.has(t) || t === tab);
  }, [inventory, tab]);

  const shown = inventory.filter((r) => r.type === tab);

  // Le résultat d'une ouverture : on recale solde + inventaire sans refetch.
  function applyResult(res) {
    setData((d) => {
      if (!d) return d;
      const has = d.inventory.some((r) => r.key === res.reward.key);
      return {
        ...d,
        points: res.points,
        inventory: has
          ? d.inventory.map((r) =>
              r.key === res.reward.key ? { ...r, count: (r.count || 1) + 1 } : r
            )
          : [...d.inventory, { ...res.reward, obtainedAt: new Date().toISOString(), count: 1 }],
      };
    });
    updateUser({ points: res.points });
    setTab(res.reward.type); // l'inventaire s'ouvre sur ce qu'on vient de gagner
  }

  async function toggleEquip(reward) {
    const isOn = data.equipped[reward.type] === reward.key;
    setEquipping(reward.key);
    try {
      const d = await apiFetch("/arcade/equip", {
        method: "POST",
        token,
        body: isOn
          ? { rewardKey: null, type: reward.type }
          : { rewardKey: reward.key },
      });
      setData((prev) => ({ ...prev, equipped: d.equipped }));
      updateUser({ equipped: d.equipped });
      // Effet immédiat : le curseur change sous la souris, sans recharger.
      setCosmetic(reward.type, isOn ? null : reward);
    } catch (e) {
      setError(e.message);
    } finally {
      setEquipping(null);
    }
  }

  if (error && !data) {
    return (
      <div className="arc-wrap">
        <div className="arc-state">
          <p>{error}</p>
          <Link to="/app" className="btn btn-primary">
            Retour à l'accueil
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="arc-wrap">
        <div className="arc-state">
          <Loader2 size={22} className="spin" /> Chargement de l'arcade…
        </div>
      </div>
    );
  }

  return (
    <div className="arc-wrap">
      {/* ---------- En-tête : le solde ---------- */}
      <header className="arc-hero">
        <div className="arc-hero-main">
          <span className="arc-kicker">
            <Sparkles size={13} /> Arcade
          </span>
          <h1 className="arc-title">Tes points, tes lots</h1>
          <p className="arc-sub">
            Chaque partie de blind test te rapporte des points. Dépense-les en caisses
            pour débloquer des curseurs et t'en équiper.
          </p>
        </div>
        <div className="arc-wallet">
          <span className="arc-wallet-coin">
            <Coins size={22} />
          </span>
          <span className="arc-wallet-num">{data.points.toLocaleString("fr-FR")}</span>
          <span className="arc-wallet-label">points</span>
          <button
            className="arc-wallet-hist clickable"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <History size={13} /> Historique
          </button>
        </div>
      </header>

      {historyOpen && <PointHistory token={token} />}

      {error && <p className="arc-err">{error}</p>}

      {/* ---------- Les caisses ---------- */}
      <section className="arc-section">
        <h2 className="arc-h2">
          <Package size={17} /> Caisses
        </h2>
        {data.cases.length === 0 ? (
          <p className="arc-empty">
            Aucune caisse disponible pour l'instant — reviens plus tard.
          </p>
        ) : (
          <div className="arc-cases">
            {data.cases.map((c) => {
              const afford = data.points >= c.price;
              // Les 3 meilleurs lots de la caisse, pour donner envie sans
              // ouvrir : ils sont déjà triés « plus rare d'abord » par l'API.
              const teaser = c.rewards.slice(0, 3);
              return (
                <article className={`arc-case ${afford ? "" : "poor"}`} key={c.id}>
                  <div className="arc-case-art">
                    {c.image ? (
                      <img src={c.image} alt="" draggable="false" />
                    ) : (
                      <PackageOpen size={44} className="arc-case-ph" />
                    )}
                    <span className="arc-case-glow" aria-hidden="true" />
                  </div>
                  <h3 className="arc-case-name">{c.name}</h3>
                  {c.description && <p className="arc-case-desc">{c.description}</p>}
                  <div className="arc-case-teaser" aria-hidden="true">
                    {teaser.map((r) => (
                      <span
                        className="arc-case-pip"
                        key={r.id}
                        style={{ "--arc-rarity": rarityColor(r.rarity) }}
                        title={`${r.name} · ${rarityLabel(r.rarity)}`}
                      />
                    ))}
                    <span className="arc-case-count">
                      {c.rewards.length} lot{c.rewards.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  <button
                    className="arc-case-btn clickable"
                    onClick={() => setOpeningBox(c)}
                    disabled={!c.openable}
                  >
                    {!c.openable ? (
                      <>
                        <Lock size={15} /> Bientôt
                      </>
                    ) : afford ? (
                      <>
                        <Sparkles size={15} /> Ouvrir
                      </>
                    ) : (
                      "Voir le contenu"
                    )}
                    <span className="arc-case-price">
                      <Coins size={13} /> {c.price}
                    </span>
                  </button>
                  {!afford && c.openable && (
                    <span className="arc-case-need">
                      Il te manque {(c.price - data.points).toLocaleString("fr-FR")} points
                    </span>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- L'inventaire ---------- */}
      <section className="arc-section">
        <div className="arc-inv-head">
          <h2 className="arc-h2">
            <Sparkles size={17} /> Mon inventaire
          </h2>
          {tabs.length > 1 && (
            <div className="arc-inv-tabs">
              {tabs.map((t) => (
                <button
                  key={t}
                  className={`arc-inv-tab clickable ${tab === t ? "on" : ""}`}
                  onClick={() => setTab(t)}
                >
                  {REWARD_TYPES[t].plural}
                </button>
              ))}
            </div>
          )}
        </div>

        {shown.length === 0 ? (
          <div className="arc-empty-inv">
            <PackageOpen size={30} />
            <p>Rien ici pour l'instant. Ouvre une caisse pour commencer ta collection.</p>
            <Link to="/blindtest" className="btn btn-primary sm">
              <Music2 size={15} /> Gagner des points au blind test
            </Link>
          </div>
        ) : (
          <div className="arc-inv-grid">
            {shown.map((r) => {
              const on = data.equipped[r.type] === r.key;
              return (
                <article
                  className={`arc-inv-card ${on ? "equipped" : ""}`}
                  key={r.key}
                  style={{ "--arc-rarity": rarityColor(r.rarity) }}
                >
                  <span className="arc-inv-aura" aria-hidden="true" />
                  {r.count > 1 && <span className="arc-inv-count">×{r.count}</span>}
                  <div className="arc-inv-art">
                    <RewardArt reward={r} size={54} />
                  </div>
                  <span className="arc-inv-rarity">{rarityLabel(r.rarity)}</span>
                  <h3 className="arc-inv-name">{r.name}</h3>
                  <button
                    className={`arc-equip clickable ${on ? "on" : ""}`}
                    onClick={() => toggleEquip(r)}
                    disabled={equipping === r.key}
                  >
                    {equipping === r.key ? (
                      <Loader2 size={13} className="spin" />
                    ) : on ? (
                      <>
                        <Check size={13} /> Équipé
                      </>
                    ) : (
                      "Équiper"
                    )}
                  </button>
                </article>
              );
            })}
          </div>
        )}

        {tab === "cursor" && shown.length > 0 && (
          <p className="arc-inv-note">
            Le curseur équipé s'applique partout dans l'app, sur ordinateur uniquement.
          </p>
        )}
      </section>

      {/* ---------- Barème des raretés ---------- */}
      <section className="arc-section">
        <h2 className="arc-h2">Raretés</h2>
        <div className="arc-legend">
          {Object.entries(RARITIES).map(([key, r]) => (
            <span className="arc-legend-item" key={key} style={{ "--arc-rarity": r.color }}>
              <i />
              {r.label}
            </span>
          ))}
        </div>
      </section>

      {openingBox && (
        <CaseOpeningModal
          box={openingBox}
          token={token}
          onClose={() => setOpeningBox(null)}
          onResult={applyResult}
        />
      )}
    </div>
  );
}

// --- D'où viennent mes points (dépliable sous le solde) ---
function PointHistory({ token }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    apiFetch("/arcade/history", { token })
      .then((d) => alive && setRows(d.entries || []))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [token]);

  if (rows === null)
    return (
      <div className="arc-hist">
        <Loader2 size={16} className="spin" />
      </div>
    );
  if (!rows.length)
    return (
      <div className="arc-hist">
        <p className="arc-empty">Aucun mouvement pour l'instant.</p>
      </div>
    );

  return (
    <div className="arc-hist">
      <ul className="arc-hist-list">
        {rows.map((e) => (
          <li className="arc-hist-row" key={e.id}>
            <span className="arc-hist-src">
              {SOURCE_LABEL[e.source] || e.source}
              {e.meta?.caseName ? ` · ${e.meta.caseName}` : ""}
              {e.meta?.rewardName ? ` · ${e.meta.rewardName}` : ""}
            </span>
            <span className="arc-hist-date">
              {new Date(e.date).toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className={`arc-hist-amt ${e.amount >= 0 ? "up" : "down"}`}>
              {e.amount >= 0 ? `+${e.amount}` : e.amount}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
