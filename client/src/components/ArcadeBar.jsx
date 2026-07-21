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
//  L'arcade, réduite à une barre : solde + deux portes d'entrée.
// ======================================================================
// Remplace l'ancienne page /arcade : on n'envoie plus le joueur ailleurs pour
// dépenser ses points, tout se joue en modale depuis l'accueil. Le tirage et
// l'équipement restent EXACTEMENT les mêmes appels serveur qu'avant.

export default function ArcadeBar() {
  const { token, updateUser } = useAuth();
  const { setCosmetic } = useCosmetics();

  const [data, setData] = useState(null);
  const [view, setView] = useState(null); // "cases" | "cursors" | null
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

  return (
    <>
      <div className="abar">
        <span className="abar-points" title="Points gagnés au blind test">
          <Coins size={16} />
          {data ? data.points.toLocaleString("fr-FR") : "—"}
        </span>
        <button
          className="abar-btn clickable"
          onClick={() => setView("cases")}
          disabled={!data}
        >
          <PackageOpen size={16} /> Ouvrir une caisse
        </button>
        <button
          className="abar-btn clickable"
          onClick={() => setView("cursors")}
          disabled={!data}
        >
          <MousePointer2 size={16} /> Curseurs
        </button>
      </div>

      {view && data && (
        <ArcadeModal
          title={view === "cases" ? "Caisses" : "Mes curseurs"}
          points={data.points}
          onClose={() => setView(null)}
        >
          {err && <p className="arc-err">{err}</p>}

          {view === "cases" &&
            (data.cases.length === 0 ? (
              <p className="arc-empty">
                Aucune caisse disponible pour l'instant — reviens plus tard.
              </p>
            ) : (
              <div className="arc-cases">
                {data.cases.map((c) => {
                  const afford = data.points >= c.price;
                  // Les 3 meilleurs lots, déjà triés « plus rare d'abord » par l'API.
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
                          Il te manque{" "}
                          {(c.price - data.points).toLocaleString("fr-FR")} points
                        </span>
                      )}
                    </article>
                  );
                })}
              </div>
            ))}

          {view === "cursors" &&
            (cursors.length === 0 ? (
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
                      // La carte ENTIÈRE bascule l'équipement : viser le petit
                      // bouton n'apportait rien. L'état reste affiché en bas,
                      // mais en simple étiquette (plus de bouton imbriqué).
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
            ))}
        </ArcadeModal>
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

// Coquille de modale commune aux deux vues : titre, solde, fermeture.
function ArcadeModal({ title, points, onClose, children }) {
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
          <h2>{title}</h2>
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
