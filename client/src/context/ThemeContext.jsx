import { createContext, useContext, useEffect, useState } from "react";
import { reportMissionFlag } from "../lib/missionFlags";

const ThemeContext = createContext();

// ======================================================================
//  Le thème : sombre par défaut, et le choix de l'utilisateur au-dessus
// ======================================================================
// ⚠️ DEUX CLÉS, ET LA SECONDE EST TOUT L'INTÉRÊT. `mpl_theme` porte le thème
// affiché — mais il est réécrit à CHAQUE chargement par l'effet plus bas, donc
// sa seule présence ne prouve rien : tous ceux qui ont ouvert le site une fois
// ont un « light » enregistré, y compris ceux qui n'ont jamais touché au
// bouton. Changer la valeur par défaut n'aurait donc rien changé pour eux.
//
// `mpl_theme_choice` ne s'écrit QUE quand quelqu'un bascule lui-même. Tant
// qu'il n'existe pas, on sert le sombre ; dès qu'il existe, c'est le choix de
// la personne qui gagne, pour toujours.
const THEME_KEY = "mpl_theme";
const CHOICE_KEY = "mpl_theme_choice";

/** Ce qu'on affiche au premier rendu. */
function initialTheme() {
  try {
    if (localStorage.getItem(CHOICE_KEY) === "1") {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    }
  } catch {
    /* navigation privée, stockage bloqué : le sombre fera l'affaire */
  }
  return "dark";
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
    // Mission « Côté obscur » : le passage au sombre ne laisse aucune trace en
    // base, on le signale donc explicitement (une seule fois).
    if (theme === "dark") reportMissionFlag("dark-mode");
  }, [theme]);

  const toggle = () =>
    setTheme((t) => {
      // ⚠️ C'EST ICI, ET SEULEMENT ICI, QUE LE CHOIX SE GRAVE. Un geste
      // délibéré sur le bouton : à partir de maintenant, cette personne a son
      // thème, et une future valeur par défaut ne le lui reprendra pas.
      try {
        localStorage.setItem(CHOICE_KEY, "1");
      } catch {
        /* ignore */
      }
      return t === "light" ? "dark" : "light";
    });

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
