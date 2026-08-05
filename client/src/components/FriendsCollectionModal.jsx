import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Check,
  Loader2,
  Lock,
  MousePointer2,
  Palette,
  Users,
  X,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { rarityColor, rarityLabel, rarityRank } from "../lib/rarity";
import RewardArt from "./RewardArt";

// ======================================================================
//  « Les collections » — la vitrine des joueurs qu'on suit
// ======================================================================
// Une collection ne vaut que comparée. On liste donc les abonnements (et
// soi-même en tête) avec leur avancement, et on ouvre la vitrine complète de
// celui qu'on choisit : les lots possédés en couleur, les manquants en creux.
// Voir les trous est le vrai sujet — « 3 / 8 » ne raconte rien tout seul.

const FAMILIES = [
  { key: "cursor", label: "Curseurs", Icon: MousePointer2 },
  { key: "theme", label: "Thèmes", Icon: Palette },
];

export default function FriendsCollectionModal({ token, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [who, setWho] = useState(null); // id du joueur affiché
  const [family, setFamily] = useState("cursor");

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    apiFetch("/arcade/friends", { token })
      .then((d) => {
        if (!alive) return;
        setData(d);
        // Par défaut, le premier abonnement — c'est LUI qu'on vient voir. À
        // défaut (personne de suivi), soi-même.
        setWho(d.users?.find((u) => !u.isMe)?.id || d.users?.[0]?.id || null);
      })
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [token]);

  // Catalogue de la famille affichée, les plus rares en tête : la vitrine
  // s'ouvre sur les belles pièces, pas sur les communes.
  const shelf = useMemo(() => {
    if (!data) return [];
    return (data.catalog || [])
      .filter((r) => r.type === family)
      .sort(
        (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name)
      );
  }, [data, family]);

  const users = data?.users || [];
  const current = users.find((u) => u.id === who) || null;
  // Le dénominateur est le nombre de cases RÉELLEMENT posées sur l'étagère :
  // « 3 / 8 » et huit vignettes, sans arithmétique surprise si un lot a été
  // retiré des caisses après avoir été gagné.
  const total = shelf.length;

  // Combien de lots de la famille affichée ce joueur possède (les doublons ne
  // comptent qu'une fois : c'est une collection, pas un stock).
  const countOf = (u) => shelf.reduce((n, r) => n + (u.owned[r.key] ? 1 : 0), 0);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="abar-modal afc-modal">
        <div className="abar-modal-head">
          <div className="abar-modal-title">
            <h2>Les collections</h2>
            {total > 0 && current && (
              <span className="abar-count">
                {countOf(current)} / {total}
              </span>
            )}
          </div>

          {/* Curseurs / Thèmes : on compare une famille à la fois. */}
          <div className="afc-fams" role="group" aria-label="Famille de lots">
            {FAMILIES.map((f) => (
              <button
                key={f.key}
                className={`afc-fam clickable ${family === f.key ? "on" : ""}`}
                onClick={() => setFamily(f.key)}
                aria-pressed={family === f.key}
              >
                <f.Icon size={14} /> {f.label}
              </button>
            ))}
          </div>

          <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        {err && <p className="arc-err afc-err">{err}</p>}

        {!data ? (
          <div className="arc-state" style={{ minHeight: 220 }}>
            <Loader2 size={22} className="spin" />
          </div>
        ) : users.length <= 1 ? (
          <div className="afc-empty">
            <Users size={26} />
            <p>
              Tu ne suis encore personne — abonne-toi à d'autres joueurs pour
              comparer vos collections.
            </p>
          </div>
        ) : (
          <div className="afc-body">
            {/* --- Qui : la liste des joueurs, avec leur avancement --- */}
            <div className="afc-people">
              {users.map((u) => {
                const have = countOf(u);
                const pct = total ? Math.round((have / total) * 100) : 0;
                return (
                  <button
                    key={u.id}
                    className={`afc-person clickable ${u.id === who ? "on" : ""}`}
                    onClick={() => setWho(u.id)}
                    aria-pressed={u.id === who}
                  >
                    <span className="afc-person-av">
                      {u.avatar ? (
                        <img src={u.avatar} alt="" loading="lazy" draggable="false" />
                      ) : (
                        u.username[0].toUpperCase()
                      )}
                    </span>
                    <span className="afc-person-txt">
                      <span className="afc-person-name">
                        {u.isMe ? "Toi" : u.username}
                      </span>
                      <span className="afc-person-bar" aria-hidden="true">
                        <i style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                    <span className="afc-person-num">
                      {have}
                      <em>/{total}</em>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* --- Quoi : la vitrine du joueur choisi --- */}
            <div className="afc-shelf">
              {current && (
                <div className="afc-shelf-head">
                  <h3 className="afc-shelf-title">
                    {current.isMe ? "Ta collection" : `La collection de ${current.username}`}
                  </h3>
                  {!current.isMe && (
                    <Link
                      to={`/u/${current.username}`}
                      className="afc-shelf-link clickable"
                      onClick={onClose}
                    >
                      Voir le profil
                    </Link>
                  )}
                </div>
              )}

              {shelf.length === 0 ? (
                <p className="arc-inv-empty">Aucun lot dans cette famille.</p>
              ) : (
                <div className="arc-inv-grid afc-grid">
                  {shelf.map((r) => {
                    const count = current?.owned[r.key] || 0;
                    const equipped = current?.equipped?.[r.type] === r.key;
                    return (
                      <article
                        key={r.key}
                        className={`arc-inv-card afc-card ${count ? "" : "missing"} ${
                          equipped ? "equipped" : ""
                        }`}
                        style={{ "--arc-rarity": rarityColor(r.rarity) }}
                        title={
                          count
                            ? `${r.name} — ${rarityLabel(r.rarity)}`
                            : r.obtainable
                              ? `${r.name} — pas encore obtenu`
                              : `${r.name} — plus tirable en caisse`
                        }
                      >
                        <span className="arc-inv-aura" aria-hidden="true" />
                        {count > 1 && <span className="arc-inv-count">×{count}</span>}
                        {!count && (
                          <span className="afc-lock" aria-hidden="true">
                            <Lock size={12} />
                          </span>
                        )}
                        <div className="arc-inv-art">
                          <RewardArt reward={r} size={54} />
                        </div>
                        <span className="arc-inv-rarity">{rarityLabel(r.rarity)}</span>
                        <h4 className="arc-inv-name">{r.name}</h4>
                        {equipped && (
                          <span className="afc-equipped">
                            <Check size={12} /> Équipé
                          </span>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}

              <p className="arc-inv-note">
                Les lots en creux sont ceux qui manquent encore à cette
                collection. Les doublons ne comptent qu'une fois.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
