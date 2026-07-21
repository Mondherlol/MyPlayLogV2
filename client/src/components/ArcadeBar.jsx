import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Coins,
  Loader2,
  Sparkles,
  PackageOpen,
  MousePointer2,
  Check,
  X,
  Lock,
  Music2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useCosmetics } from "../context/CosmeticsContext";
import { apiFetch } from "../lib/api";
import { rarityColor, rarityLabel, rarityRank } from "../lib/rarity";
import RewardArt from "./RewardArt";
import CaseOpeningModal from "./CaseOpeningModal";

// ======================================================================
//  L'arcade, réduite à une barre : le solde et une porte d'entrée.
// ======================================================================
// Remplace l'ancienne page /arcade. Une seule modale « Ma collection » : les
// caisses y sont l'appel à l'action en tête, la collection s'étale dessous.
// Le tirage et l'équipement restent les mêmes appels serveur qu'avant.

export default function ArcadeBar() {
  const { token, updateUser } = useAuth();
  const { setCosmetic } = useCosmetics();

  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [openingBox, setOpeningBox] = useState(null);
  const [equipping, setEquipping] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch("/arcade", { token })
      .then((d) => alive && setData(d))
      .catch(() => {
        /* l'arcade est un bonus : son absence ne casse pas l'accueil */
      });
    return () => {
      alive = false;
    };
  }, [token]);

  // Résultat d'une ouverture : on recale solde + inventaire sans refetch.
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
          : [
              ...d.inventory,
              { ...res.reward, obtainedAt: new Date().toISOString(), count: 1 },
            ],
      };
    });
    updateUser({ points: res.points });
  }

  async function toggleEquip(reward) {
    if (equipping) return; // une bascule à la fois
    const isOn = data.equipped[reward.type] === reward.key;
    setEquipping(reward.key);
    try {
      const d = await apiFetch("/arcade/equip", {
        method: "POST",
        token,
        body: isOn ? { rewardKey: null, type: reward.type } : { rewardKey: reward.key },
      });
      setData((prev) => ({ ...prev, equipped: d.equipped }));
      updateUser({ equipped: d.equipped });
      // Effet immédiat : le curseur change sous la souris, sans recharger.
      setCosmetic(reward.type, isOn ? null : reward);
    } catch (e) {
      setErr(e.message);
    } finally {
      setEquipping(null);
    }
  }

  const cursors = (data?.inventory || [])
    .filter((r) => r.type === "cursor")
    .sort(
      (a, b) =>
        rarityRank(b.rarity) - rarityRank(a.rarity) ||
        new Date(b.obtainedAt || 0) - new Date(a.obtainedAt || 0)
    );

  // Progression : combien de curseurs tirables existent, combien sont à moi.
  const catalog = new Set();
  for (const c of data?.cases || [])
    for (const r of c.rewards || []) if (r.type === "cursor") catalog.add(r.key);
  const total = catalog.size;

  return (
    <>
      <div className="abar">
        <span className="abar-points" title="Points gagnés au blind test">
          <Coins size={16} />
          {data ? data.points.toLocaleString("fr-FR") : "—"}
        </span>
        <button
          className="abar-btn clickable"
          onClick={() => setOpen(true)}
          disabled={!data}
        >
          <MousePointer2 size={16} /> Ma collection
          {total > 0 && (
            <span className="abar-btn-count">
              {cursors.length}/{total}
            </span>
          )}
        </button>
      </div>

      {open && data && (
        <CollectionModal
          data={data}
          points={data.points}
          onClose={() => setOpen(false)}
        >
          {err && <p className="arc-err">{err}</p>}

          {/* --- Les caisses, en tête : c'est l'action qui fait grandir la collection --- */}
          {data.cases.length > 0 && (
            <div className="abar-rail">
              {data.cases.map((c) => {
                const afford = data.points >= c.price;
                const missing = c.price - data.points;
                return (
                  <button
                    key={c.id}
                    className={`abar-crate clickable ${afford ? "" : "poor"}`}
                    onClick={() => setOpeningBox(c)}
                    disabled={!c.openable}
                  >
                    <span className="abar-crate-glow" aria-hidden="true" />
                    <span className="abar-crate-art">
                      {c.image ? (
                        <img src={c.image} alt="" draggable="false" />
                      ) : (
                        <PackageOpen size={38} />
                      )}
                    </span>
                    <span className="abar-crate-body">
                      <strong>{c.name}</strong>
                      <span className="abar-crate-meta">
                        {c.rewards.length} lot{c.rewards.length > 1 ? "s" : ""}
                        {!c.openable
                          ? " · bientôt"
                          : afford
                            ? ""
                            : ` · il te manque ${missing.toLocaleString("fr-FR")}`}
                      </span>
                    </span>
                    <span className="abar-crate-cta">
                      {!c.openable ? (
                        <Lock size={14} />
                      ) : (
                        <>
                          <Sparkles size={14} /> Ouvrir
                        </>
                      )}
                      <b>
                        <Coins size={12} /> {c.price}
                      </b>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* --- La collection --- */}
          <div className="abar-collec-head">
            <h3>
              <MousePointer2 size={15} /> Mes curseurs
            </h3>
            {total > 0 && (
              <span className="abar-progress">
                <i style={{ width: `${Math.round((cursors.length / total) * 100)}%` }} />
                <em>
                  {cursors.length} / {total}
                </em>
              </span>
            )}
          </div>

          {cursors.length === 0 ? (
            <div className="arc-empty-inv">
              <PackageOpen size={30} />
              <p>
                Aucun curseur pour l'instant. Ouvre une caisse pour commencer ta
                collection.
              </p>
              <Link to="/blindtest" className="btn btn-primary sm">
                <Music2 size={15} /> Gagner des points au blind test
              </Link>
            </div>
          ) : (
            <>
              <div className="arc-inv-grid">
                {cursors.map((r) => {
                  const on = data.equipped[r.type] === r.key;
                  return (
                    // La carte entière bascule l'équipement.
                    <article
                      className={`arc-inv-card ${on ? "equipped" : ""}`}
                      key={r.key}
                      style={{ "--arc-rarity": rarityColor(r.rarity) }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={on}
                      title={on ? "Cliquer pour retirer" : "Cliquer pour équiper"}
                      onClick={() => toggleEquip(r)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleEquip(r);
                        }
                      }}
                    >
                      <span className="arc-inv-aura" aria-hidden="true" />
                      {r.count > 1 && <span className="arc-inv-count">×{r.count}</span>}
                      <div className="arc-inv-art">
                        <RewardArt reward={r} size={54} />
                      </div>
                      <span className="arc-inv-rarity">{rarityLabel(r.rarity)}</span>
                      <h3 className="arc-inv-name">{r.name}</h3>
                      <span className={`arc-equip ${on ? "on" : ""}`}>
                        {equipping === r.key ? (
                          <Loader2 size={13} className="spin" />
                        ) : on ? (
                          <>
                            <Check size={13} /> Équipé
                          </>
                        ) : (
                          "Équiper"
                        )}
                      </span>
                    </article>
                  );
                })}
              </div>
              <p className="arc-inv-note">
                Le curseur équipé s'applique partout dans l'app, sur ordinateur
                uniquement.
              </p>
            </>
          )}
        </CollectionModal>
      )}

      {openingBox && (
        <CaseOpeningModal
          box={openingBox}
          token={token}
          onClose={() => setOpeningBox(null)}
          onResult={applyResult}
        />
      )}
    </>
  );
}

// Coquille de la modale : titre, solde, fermeture.
function CollectionModal({ points, onClose, children }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="abar-modal">
        <div className="abar-modal-head">
          <h2>Ma collection</h2>
          <span className="abar-points">
            <Coins size={15} />
            {points.toLocaleString("fr-FR")}
          </span>
          <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <div className="abar-modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
