import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";

import Section from "./Rail";
import NineModal from "../NineModal";
import { apiCached } from "../../lib/query";
import { NINE_CUSTOM, NINE_THEMES, nineTheme } from "../../lib/nines";

// ======================================================================
//  Le principe des 9, sur l'accueil
// ======================================================================
// Le rail des thèmes, repris de l'app (myplaylog-mobile/src/components/nine/
// NineCards.jsx). Une carte donne l'idée ; un clic ouvre directement la
// sélection, et neuf jeux plus tard la liste est publiée. Un thème déjà fait
// mène à SA liste, et passe en fin de rail : on vient chercher une idée, pas
// revoir ce qu'on a déjà publié.

function Faces({ faces }) {
  return (
    <span className="nine-faces">
      {faces.map((f) =>
        f.avatar ? (
          <img key={f.username} src={f.avatar} alt="" title={f.username} />
        ) : (
          <span key={f.username} className="nine-face-letter" title={f.username}>
            {f.username[0]?.toUpperCase()}
          </span>
        )
      )}
    </span>
  );
}

function NineCard({ themeKey, stats, onOpen }) {
  const custom = themeKey === NINE_CUSTOM;
  const { Icon, color, short } = nineTheme(themeKey);
  const mine = !custom && stats?.mine;
  const count = stats?.count || 0;
  const faces = stats?.faces || [];

  return (
    <button
      type="button"
      className={`nine-card clickable ${custom ? "is-custom" : ""} ${mine ? "is-mine" : ""}`}
      style={{ "--nc": color }}
      onClick={onOpen}
      title={custom ? "Invente ton propre thème" : `Ces 9 jeux ${short}`}
    >
      <span className="nine-card-wm" aria-hidden="true">
        <Icon size={150} strokeWidth={1.3} />
      </span>

      <span className="nine-card-top">
        <span className="nine-card-badge">
          <Icon size={21} strokeWidth={2.2} />
        </span>
        {mine ? (
          <span className="nine-card-mini" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) =>
              mine.preview?.[i] ? (
                <img key={i} src={mine.preview[i]} alt="" loading="lazy" />
              ) : (
                <span key={i} />
              )
            )}
          </span>
        ) : (
          <span className="nine-card-nine" aria-hidden="true">
            9
          </span>
        )}
      </span>

      <span className="nine-card-text">
        {custom ? (
          "Invente ton propre thème"
        ) : (
          <>
            <b>9</b> jeux {short}
          </>
        )}
      </span>

      <span className="nine-card-foot">
        {mine ? (
          <span className="nine-card-done">
            <Check size={13} strokeWidth={3} /> Ta liste est faite
          </span>
        ) : custom ? (
          <span>Ces 9 jeux qui…</span>
        ) : (
          <>
            {faces.length > 0 && <Faces faces={faces} />}
            <span className="nine-card-count">
              {count
                ? `${count.toLocaleString("fr-FR")} ${count > 1 ? "l'ont faite" : "l'a faite"}`
                : "Sois le premier"}
            </span>
          </>
        )}
        <span className="nine-card-go" aria-hidden="true">
          <ArrowRight size={15} strokeWidth={2.4} />
        </span>
      </span>
    </button>
  );
}

export default function NineRail({ token, library }) {
  const navigate = useNavigate();
  const [themes, setThemes] = useState({});
  const [open, setOpen] = useState(null); // clé du thème en cours de sélection

  useEffect(() => {
    let alive = true;
    apiCached("/lists/nines", { token, maxAge: 5 * 60000 })
      .then((d) => alive && setThemes(d?.themes || {}))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);

  const keys = NINE_THEMES.map((t) => t.key);
  const order = [
    ...keys.filter((k) => !themes[k]?.mine),
    NINE_CUSTOM,
    ...keys.filter((k) => themes[k]?.mine),
  ];

  const openTheme = (key) => {
    const mine = key !== NINE_CUSTOM && themes[key]?.mine;
    if (mine) navigate(`/lists/${mine.id}`);
    else setOpen(key);
  };

  return (
    <>
      <Section kicker="Le principe des 9" title="Et toi, ce serait lesquels ?" className="s-nine">
        {order.map((key) => (
          <NineCard key={key} themeKey={key} stats={themes[key]} onOpen={() => openTheme(key)} />
        ))}
      </Section>

      {open && (
        <NineModal
          themeKey={open}
          library={library}
          onClose={() => setOpen(null)}
          onPublished={(list) => {
            setOpen(null);
            navigate(`/lists/${list.id}`);
          }}
        />
      )}
    </>
  );
}
