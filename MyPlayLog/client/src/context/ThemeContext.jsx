import { createContext, useContext, useEffect, useState } from "react";
import { reportMissionFlag } from "../lib/missionFlags";

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("mpl_theme") || "light"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("mpl_theme", theme);
    // Mission « Côté obscur » : le passage au sombre ne laisse aucune trace
    // en base, on le signale donc explicitement (une seule fois).
    if (theme === "dark") reportMissionFlag("dark-mode");
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
