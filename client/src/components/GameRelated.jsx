import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Orbit,
  Puzzle,
  Hammer,
  Sparkles,
  PackagePlus,
  MonitorSmartphone,
  Package,
  Layers,
  CornerLeftUp,
  Star,
  ImageOff,
  MapPin,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { makeCache } from "../lib/cache";
import ScrollRow from "./ScrollRow";

// Contenus liés : statiques côté IGDB → cache mémoire + localStorage 24h.
const relCache = makeCache("mpl_related_", 24 * 60 * 60 * 1000);

// Libellé + icône de chaque groupe renvoyé par /games/:id/related.
const GROUP_META = {
  parent: { label: "Jeu d'origine", Icon: CornerLeftUp },
  dlc: { label: "DLC & Extensions", Icon: Puzzle },
  remakes: { label: "Remakes", Icon: Hammer },
  remasters: { label: "Remasters", Icon: Sparkles },
  expanded: { label: "Versions enrichies", Icon: PackagePlus },
  ports: { label: "Portages", Icon: MonitorSmartphone },
  bundles: { label: "Bundles & Packs", Icon: Package },
  editions: { label: "Éditions", Icon: Layers },
};

// Onglet « Univers » de la page jeu : tout ce qui gravite autour du jeu
// (DLC, remakes, remasters, éditions, portages…) + la saga complète en
// chronologie, avec le jeu consulté épinglé « Vous êtes ici ».
export default function GameRelated({ gameId, token, game }) {
  const navigate = useNavigate();
  const cached = relCache.get(String(gameId));
  const [loading, setLoading] = useState(!cached);
  const [data, setData] = useState(cached?.data || null);

  useEffect(() => {
    const c = relCache.get(String(gameId));
    if (c?.fresh) {
      setData(c.data);
      setLoading(false);
      return;
    }
    let alive = true;
    if (c) setData(c.data); // périmé : on garde l'affichage pendant la revalidation
    else setLoading(true);
    apiFetch(`/games/${gameId}/related`, { token })
      .then((d) => {
        if (!alive) return;
        setData(d);
        relCache.set(String(gameId), d);
      })
      .catch(() => alive && !c && setData({ groups: [], series: [] }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [gameId, token]);

  if (loading) {
    return (
      <div className="gpr" aria-busy="true">
        {Array.from({ length: 2 }).map((_, s) => (
          <section className="gp-block" key={s}>
            <span className="gp-skel gp-skel-bar" style={{ width: 160 }} />
            <div className="gpr-skel-row">
              {Array.from({ length: 5 }).map((_, i) => (
                <span className="gp-skel gpr-skel-cover" key={i} />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  const groups = data?.groups || [];
  const series = data?.series || [];
  const totalDirect = groups.reduce((n, g) => n + g.items.length, 0);

  if (!totalDirect && !series.length) {
    return (
      <div className="gp-troph-empty">
        <Orbit size={28} />
        <p className="font-fun">
          Aucun contenu lié trouvé pour ce jeu — ni DLC, ni remake, ni saga.
          Un vrai loup solitaire.
        </p>
      </div>
    );
  }

  // Saga en chronologie inversée (du plus récent au plus ancien) : les autres
  // jeux + celui-ci, épinglé. Sans date connue (TBA) → tout en haut.
  const timeline = series.length
    ? [
        ...series,
        {
          id: Number(gameId),
          name: game.name,
          cover: game.cover,
          releaseDate: game.releaseDate,
          year: game.year,
          typeLabel: null,
          current: true,
        },
      ].sort((a, b) => (b.releaseDate || 9e12) - (a.releaseDate || 9e12))
    : [];

  return (
    <div className="gpr">
      <div className="gpr-head">
        <span className="gpr-count">
          <Orbit size={15} />
          {totalDirect + series.length} contenu{totalDirect + series.length > 1 ? "s" : ""} lié
          {totalDirect + series.length > 1 ? "s" : ""}
        </span>
        {data.franchise && <span className="gpr-franchise-chip">{data.franchise}</span>}
      </div>

      {groups.map((grp) => {
        const meta = GROUP_META[grp.id] || { label: grp.id, Icon: Layers };
        return (
          <section className="gp-block" key={grp.id}>
            <h2 className="gp-h2 gpr-h2">
              <meta.Icon size={17} />
              {meta.label}
              <span className="gpr-h2-count">{grp.items.length}</span>
            </h2>
            <ScrollRow className="gpr-row">
              {grp.items.map((it) => (
                <RelCard key={it.id} item={it} onOpen={() => navigate(`/game/${it.id}`)} />
              ))}
            </ScrollRow>
          </section>
        );
      })}

      {timeline.length > 1 && (
        <section className="gp-block">
          <h2 className="gp-h2 gpr-h2">
            <Orbit size={17} />
            {data.franchise ? `La saga ${data.franchise}` : "Dans la même série"}
            <span className="gpr-h2-count">{timeline.length}</span>
          </h2>
          <div className="gpr-timeline">
            {timeline.map((it) => (
              <div className={`gpr-tl-item ${it.current ? "is-current" : ""}`} key={it.id}>
                <div className="gpr-tl-rail">
                  <span className="gpr-tl-dot" />
                </div>
                <span className="gpr-tl-year">{it.year ?? "TBA"}</span>
                <button
                  className="gpr-tl-card clickable"
                  onClick={() => !it.current && navigate(`/game/${it.id}`)}
                  disabled={it.current}
                >
                  <div className="gpr-tl-cover">
                    {it.cover ? (
                      <img src={it.cover} alt="" loading="lazy" draggable="false" />
                    ) : (
                      <ImageOff size={16} />
                    )}
                  </div>
                  <div className="gpr-tl-txt">
                    <span className="gpr-tl-name">{it.name}</span>
                    {it.typeLabel && <span className="gpr-badge">{it.typeLabel}</span>}
                  </div>
                  {it.current && (
                    <span className="gpr-here">
                      <MapPin size={12} /> Vous êtes ici
                    </span>
                  )}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// Card jaquette d'un contenu lié : année, note et badge de type au survol.
function RelCard({ item, onOpen }) {
  return (
    <button className="gpr-card clickable" onClick={onOpen} title={item.name}>
      <div className="gpr-cover">
        {item.cover ? (
          <img src={item.cover} alt={item.name} loading="lazy" draggable="false" />
        ) : (
          <div className="gpr-cover-empty">
            <ImageOff size={22} />
          </div>
        )}
        {item.year && <span className="gpr-year">{item.year}</span>}
        {item.rating != null && (
          <span className="gpr-rating">
            <Star size={11} fill="currentColor" strokeWidth={0} />
            {item.rating}
          </span>
        )}
        {item.typeLabel && <span className="gpr-badge on-cover">{item.typeLabel}</span>}
      </div>
      <span className="gpr-name">{item.name}</span>
    </button>
  );
}
