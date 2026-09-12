// ======================================================================
//  Choisir la police du site — en la voyant, partout, tout de suite
// ======================================================================
// Une police ne se choisit pas sur son nom, ni même sur une ligne d'exemple :
// elle se choisit sur l'écran entier. Chaque tuile est donc écrite dans SA
// police, et un clic l'applique aussitôt à tout le site — la page de réglages
// elle-même change sous les yeux, et c'est le vrai aperçu.
//
// « Précédente / Suivante » (et les flèches du clavier) servent à ce qu'on
// vient faire ici : essayer vite, l'une après l'autre, jusqu'à la bonne.

import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Heading, RotateCcw, Type } from "lucide-react";
import {
  DEFAULT_FONTS,
  FONT_GROUPS,
  applyFonts,
  fontById,
  fontLabel,
  fontStack,
  fontsFor,
  getFontPrefs,
  loadFontPreviews,
  saveFontPrefs,
} from "../lib/fonts";

const ROLES = [
  { key: "body", label: "Texte", Icon: Type },
  { key: "display", label: "Titres", Icon: Heading },
];

export default function FontPicker() {
  const [prefs, setPrefs] = useState(getFontPrefs);
  const [role, setRole] = useState("body");

  // Les aperçus ne se chargent qu'ici : soixante familles, c'est le prix d'un
  // sélecteur lisible, pas celui de chaque page du site.
  useEffect(() => {
    loadFontPreviews();
  }, []);

  const list = fontsFor(role);
  const current = prefs[role];
  const index = Math.max(
    list.findIndex((f) => f.id === current),
    0
  );

  function commit(next) {
    setPrefs(next);
    applyFonts(next);
    saveFontPrefs(next);
  }

  const pick = (id) => commit({ ...prefs, [role]: id });
  const step = (delta) => pick(list[(index + delta + list.length) % list.length].id);
  const isDefault = prefs.body === DEFAULT_FONTS.body && prefs.display === DEFAULT_FONTS.display;

  function onKeyDown(e) {
    // Les flèches ne volent pas la navigation d'un champ de saisie.
    if (e.target.closest("input, textarea")) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    }
  }

  return (
    <div className="font-picker" onKeyDown={onKeyDown}>
      <div className="font-role" role="tablist" aria-label="Police à modifier">
        {ROLES.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={role === key}
            className={`font-role-opt clickable ${role === key ? "active" : ""}`}
            onClick={() => setRole(key)}
          >
            <Icon size={15} />
            <span>{label}</span>
            <em>{fontLabel(fontById(prefs[key]))}</em>
          </button>
        ))}
      </div>

      {/* L'aperçu lit les MÊMES variables que le reste du site : ce qu'on voit
          ici est exactement ce que deviendront les pages. */}
      <div className="font-preview">
        <span className="font-preview-kicker">Aperçu</span>
        <h4 className="font-preview-title">Elden Ring — Shadow of the Erdtree</h4>
        <p className="font-preview-body">
          Terminé en 87 h sur PS5, platine en poche. Le meilleur DLC de la décennie :
          une carte immense, des boss mémorables et une direction artistique folle.
        </p>
        <span className="font-preview-meta">★ 94 · Action-RPG · FromSoftware · 2024</span>
      </div>

      <div className="font-bar">
        <button type="button" className="font-bar-btn clickable" onClick={() => step(-1)}>
          <ChevronLeft size={16} /> Précédente
        </button>
        <span className="font-bar-count">
          {index + 1} / {list.length}
        </span>
        <button type="button" className="font-bar-btn clickable" onClick={() => step(1)}>
          Suivante <ChevronRight size={16} />
        </button>
        <button
          type="button"
          className="font-bar-reset clickable"
          onClick={() => commit({ ...DEFAULT_FONTS })}
          disabled={isDefault}
          title="Inter pour le texte, Space Grotesk pour les titres"
        >
          <RotateCcw size={14} /> Polices d'origine
        </button>
      </div>

      {FONT_GROUPS.map((group) => {
        const fonts = list.filter((f) => f.group === group.key);
        if (!fonts.length) return null;
        return (
          <div key={group.key} className="font-group">
            <h4 className="font-group-title">{group.label}</h4>
            <div className="font-grid">
              {fonts.map((f) => {
                const on = f.id === current;
                return (
                  <button
                    key={f.id}
                    type="button"
                    className={`font-tile clickable ${on ? "active" : ""}`}
                    onClick={() => pick(f.id)}
                    aria-pressed={on}
                    style={{ fontFamily: fontStack(f) }}
                  >
                    <span className="font-tile-head">
                      <span className="font-tile-aa">Aa</span>
                      {on && (
                        <span className="scale-opt-check">
                          <Check size={14} strokeWidth={3} />
                        </span>
                      )}
                    </span>
                    <span className="font-tile-name">{fontLabel(f)}</span>
                    <span className="font-tile-sample">
                      {role === "body" ? "J'ai fini Hollow Knight en 42 h." : "Game of the Year"}
                    </span>
                    {f.note && <span className="font-tile-note">{f.note}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
