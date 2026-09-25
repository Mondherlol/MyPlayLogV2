import { useEffect, useState } from "react";

import {
  NINE_CUSTOM,
  NINE_FONTS_URL,
  NINE_THEMES,
  nineEnding,
  nineKeyLayout,
  nineSegments,
  nineTheme,
} from "../lib/nines";

// ======================================================================
//  « Ces 9 jeux qui m'ont fait PLEURER » — la phrase d'un thème, composée
// ======================================================================
// La même typographie partout : sur la carte d'un thème (petite), en tête de
// la page d'une liste des 9 (grande). « Ces 9 jeux… » dans la police du site,
// le 9 en or, puis le mot qui compte juste dessous, dans la police du thème,
// dans sa couleur, à peine penché, surligné au marqueur.
//
// ⚠️ LE MOT-CLÉ COLLE À LA PHRASE. Il est calé sur la même marge gauche, sans
// espace au-dessus, et ne dépasse jamais deux fois et demie le corps du texte :
// posé à part, trop gros, il avait l'air d'une autre carte.

/**
 * Les polices des thèmes, ajoutées une seule fois au document. On attend
 * qu'elles soient là pour mesurer les mots-clés : mesuré dans la police de
 * repli, « pleurer » en Caveat serait taillé pour une autre largeur.
 */
export function useNineFonts() {
  const [ready, setReady] = useState(() => !!document.getElementById("nine-fonts")?.dataset.ready);
  useEffect(() => {
    if (ready) return undefined;
    let alive = true;
    const families = [...new Set([...NINE_THEMES, nineTheme(NINE_CUSTOM)].map((t) => t.font))];
    const loadAll = () =>
      Promise.all(
        families.map((f) =>
          document.fonts.load(`${f.includes("Playfair") ? "italic " : ""}700 40px ${f}`).catch(() => {})
        )
      ).then(() => {
        const link = document.getElementById("nine-fonts");
        if (link) link.dataset.ready = "1";
        if (alive) setReady(true);
      });

    let link = document.getElementById("nine-fonts");
    if (!link) {
      link = document.createElement("link");
      link.id = "nine-fonts";
      link.rel = "stylesheet";
      link.href = NINE_FONTS_URL;
      link.addEventListener("load", loadAll);
      link.addEventListener("error", () => alive && setReady(true));
      document.head.appendChild(link);
    } else {
      loadAll();
    }
    return () => {
      alive = false;
    };
  }, [ready]);
  return ready;
}

/**
 * La phrase d'un thème.
 *
 *   themeKey  la clé du thème (ou "custom") ;
 *   title     le titre de la liste — seulement pour un thème inventé, dont la
 *             fin de phrase devient le mot-clé ;
 *   inner     la largeur disponible, en pixels ;
 *   scale     l'échelle du texte (1 sur une carte) ;
 *   prompt    la carte « Invente ton propre thème » : pas de « Ces 9 » ;
 *   big       le 9 en autocollant géant qui flotte (page d'une liste des 9).
 */
export default function NinePhrase({ themeKey, title, inner, scale = 1, ready, prompt = false, big = false }) {
  const meta = nineTheme(themeKey);
  const custom = themeKey === NINE_CUSTOM;

  let segments;
  if (prompt) segments = nineSegments(meta.card);
  else if (custom) {
    const ending = nineEnding(title);
    segments = [{ text: "jeux", hi: false }, ...(ending ? [{ text: ending, hi: true }] : [])];
  } else segments = nineSegments(meta.card);

  // Le premier morceau de texte ouvre la phrase après « Ces 9 » ; si la phrase
  // commence par le mot-clé, « Ces 9 » a sa propre ligne.
  const leadFirst = !prompt && segments[0] && !segments[0].hi;
  const base = 19 * scale;

  return (
    <span className={`nine-phrase ${big ? "is-big" : ""}`} style={{ "--nc": meta.color, fontSize: base }}>
      {!prompt && !leadFirst && (
        <span className="nine-phrase-lead">
          Ces <b className="nine-phrase-9">9</b>
        </span>
      )}
      {segments.map((seg, i) => {
        if (!seg.hi) {
          return (
            <span key={i} className="nine-phrase-lead">
              {i === 0 && leadFirst && (
                <>
                  Ces <b className="nine-phrase-9">9</b>{" "}
                </>
              )}
              {seg.text}
            </span>
          );
        }
        // Un mot d'une ligne peut monter à deux fois et demie le corps du
        // texte ; sur deux lignes, moins — sinon il pousse le pied de carte.
        const oneLine = nineKeyLayout(meta, seg.text, inner, Math.min(meta.size * scale, base * 2.6));
        const { size, lines } =
          oneLine.lines.length > 1
            ? nineKeyLayout(meta, seg.text, inner, Math.min(meta.size * scale, base * (big ? 2.2 : 1.8)))
            : oneLine;
        return (
          <span
            key={i}
            className="nine-phrase-key"
            style={{
              fontFamily: meta.font,
              fontStyle: meta.italic ? "italic" : "normal",
              fontSize: size,
              textTransform: meta.upper ? "uppercase" : "none",
              textDecoration: meta.strike ? "line-through" : "none",
              visibility: ready ? "visible" : "hidden",
              "--rot": `${meta.rotate * 0.55}deg`,
            }}
          >
            {lines.map((l, j) => (
              <span key={j}>{l}</span>
            ))}
          </span>
        );
      })}
    </span>
  );
}
