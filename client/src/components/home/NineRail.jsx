import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";

import Section from "./Rail";
import NineModal from "../NineModal";
import NinePhrase, { useNineFonts } from "../NinePhrase";
import { apiCached } from "../../lib/query";
import { NINE_CUSTOM, NINE_THEMES, nineTheme } from "../../lib/nines";

// ======================================================================
//  Le principe des 9 — le rail des thèmes
// ======================================================================
// Repris de l'app (myplaylog-mobile/src/components/nine/NineCards.jsx). Une
// carte donne l'idée ; un clic ouvre directement la sélection, et neuf jeux
// plus tard la liste est publiée. Un thème déjà fait mène à SA liste, et passe
// en fin de rail : on vient chercher une idée, pas revoir ce qu'on a publié.
//
// Sert sur l'accueil et en pied de la page d'une liste des 9 (« d'autres
// thèmes »), où `exclude` retire le thème qu'on est en train de lire.

// La largeur utile d'une carte (cf. .nine-card dans app-55-nine.css).
const CARD_INNER = 200 - 2 * 18;

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

/**
 * Un thème, en carte. En haut, les neuf cases à remplir — la forme même du
 * principe, qui se remplit de la couleur du thème au survol, case après case
 * (ou tes neuf jaquettes si la liste est faite) ; en bas, la phrase.
 */
function NineCard({ themeKey, stats, onOpen, fontsReady }) {
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
      <span className="nine-card-top">
        <span className={`nine-card-slots ${mine ? "filled" : ""}`} aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) =>
            mine?.preview?.[i] ? (
              <img key={i} src={mine.preview[i]} alt="" loading="lazy" />
            ) : (
              <span key={i} style={{ transitionDelay: `${i * 35}ms` }} />
            )
          )}
        </span>
        <span className="nine-card-ic" aria-hidden="true">
          <Icon size={17} strokeWidth={2.3} />
        </span>
      </span>

      <NinePhrase themeKey={themeKey} inner={CARD_INNER} ready={fontsReady} prompt={custom} />

      <span className="nine-card-foot">
        {mine ? (
          <span className="nine-card-done">
            <Check size={13} strokeWidth={3} /> Ta liste est faite
          </span>
        ) : custom ? (
          <span className="nine-card-count">Ces 9 jeux qui…</span>
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
          <ArrowRight size={14} strokeWidth={2.6} />
        </span>
      </span>
    </button>
  );
}

export default function NineRail({
  token,
  library,
  kicker = "Le principe des 9",
  title = "Et toi, ce serait lesquels ?",
  exclude = null,
}) {
  const navigate = useNavigate();
  const fontsReady = useNineFonts();
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

  const keys = NINE_THEMES.map((t) => t.key).filter((k) => k !== exclude);
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
      <Section kicker={kicker} title={title} className="s-nine">
        {order.map((key) => (
          <NineCard
            key={key}
            themeKey={key}
            stats={themes[key]}
            fontsReady={fontsReady}
            onOpen={() => openTheme(key)}
          />
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
