import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";

import Section from "./Rail";
import NineModal from "../NineModal";
import { apiCached } from "../../lib/query";
import {
  NINE_CUSTOM,
  NINE_FONTS_URL,
  NINE_THEMES,
  nineKeyLayout,
  nineSegments,
  nineTheme,
} from "../../lib/nines";

// ======================================================================
//  Le principe des 9, sur l'accueil
// ======================================================================
// Le rail des thèmes, repris de l'app (myplaylog-mobile/src/components/nine/
// NineCards.jsx). Une carte donne l'idée ; un clic ouvre directement la
// sélection, et neuf jeux plus tard la liste est publiée. Un thème déjà fait
// mène à SA liste, et passe en fin de rail : on vient chercher une idée, pas
// revoir ce qu'on a déjà publié.

// La largeur utile d'une carte (cf. .nine-card dans app-55-nine.css) : c'est
// sur elle que se calcule la taille du mot-clé.
const CARD_INNER = 196 - 2 * 16;

// Les polices des cartes, ajoutées une seule fois au document, au premier rail.
// ⚠️ ON ATTEND QU'ELLES SOIENT LÀ pour mesurer les mots-clés : mesuré dans la
// police de repli, « pleurer » en Caveat serait taillé pour une autre largeur.
function useNineFonts() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const families = [...new Set([...NINE_THEMES, nineTheme(NINE_CUSTOM)].map((t) => t.font))];
    const loadAll = () =>
      Promise.all(
        families.map((f) =>
          document.fonts.load(`${f.includes("Playfair") ? "italic " : ""}700 40px ${f}`).catch(() => {})
        )
      ).then(() => alive && setReady(true));

    let link = document.getElementById("nine-fonts");
    if (!link) {
      link = document.createElement("link");
      link.id = "nine-fonts";
      link.rel = "stylesheet";
      link.href = NINE_FONTS_URL;
      link.onload = loadAll;
      link.onerror = () => alive && setReady(true);
      document.head.appendChild(link);
    } else {
      loadAll();
    }
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

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
 * Un thème, en carte — et la carte n'est QUE du texte, agencé comme une
 * affiche qui en occupe toute la surface : « 9 jeux qui m'ont fait » en gras,
 * le 9 en or dans la phrase, puis le mot qui compte en énorme, dans une police
 * qui lui ressemble, la couleur du thème, un peu de travers, surligné au
 * marqueur. Même carte que sur le téléphone.
 */
// Le mot qui compte, taillé pour remplir la largeur de la carte (cf.
// nineKeyLayout). Tant que les polices ne sont pas là, il reste invisible —
// mieux qu'un mot qui change de taille sous les yeux.
function KeyWord({ meta, text, ready }) {
  const { size, lines } = nineKeyLayout(meta, text, CARD_INNER);
  return (
    <span
      className="nine-card-key"
      style={{
        fontFamily: meta.font,
        fontStyle: meta.italic ? "italic" : "normal",
        fontSize: size,
        textTransform: meta.upper ? "uppercase" : "none",
        textDecoration: meta.strike ? "line-through" : "none",
        visibility: ready ? "visible" : "hidden",
        "--rot": `${meta.rotate}deg`,
      }}
    >
      {lines.map((l, i) => (
        <span key={i}>{l}</span>
      ))}
    </span>
  );
}

function NineCard({ themeKey, stats, onOpen, fontsReady }) {
  const custom = themeKey === NINE_CUSTOM;
  const meta = nineTheme(themeKey);
  const { Icon, color, short } = meta;
  const mine = !custom && stats?.mine;
  const count = stats?.count || 0;
  const faces = stats?.faces || [];
  const segments = nineSegments(meta.card);
  // Le 9 se glisse en tête de la première ligne ; si la phrase commence par
  // le mot-clé, il prend sa propre ligne.
  const nineInline = !custom && segments[0] && !segments[0].hi;

  return (
    <button
      type="button"
      className={`nine-card clickable ${custom ? "is-custom" : ""} ${mine ? "is-mine" : ""}`}
      style={{ "--nc": color }}
      onClick={onOpen}
      title={custom ? "Invente ton propre thème" : `Ces 9 jeux ${short}`}
    >
      <span className="nine-card-phrase">
        {!custom && !nineInline && <span className="nine-card-nine">9</span>}
        {segments.map((seg, i) =>
          seg.hi ? (
            <KeyWord key={i} meta={meta} text={seg.text} ready={fontsReady} />
          ) : (
            <span key={i} className="nine-card-small">
              {i === 0 && nineInline && <span className="nine-card-nine">9</span>} {seg.text}
            </span>
          )
        )}
      </span>

      <span className="nine-card-foot">
        {mine ? (
          <>
            <span className="nine-card-mini" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) =>
                mine.preview?.[i] ? (
                  <img key={i} src={mine.preview[i]} alt="" loading="lazy" />
                ) : (
                  <span key={i} />
                )
              )}
            </span>
            <span className="nine-card-done">
              <Check size={13} strokeWidth={3} /> Ta liste est faite
            </span>
          </>
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
        <span className="nine-card-ic" aria-hidden="true">
          <Icon size={16} strokeWidth={2.4} />
        </span>
        <span className="nine-card-go" aria-hidden="true">
          <ArrowRight size={15} strokeWidth={2.4} />
        </span>
      </span>
    </button>
  );
}

export default function NineRail({ token, library }) {
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
