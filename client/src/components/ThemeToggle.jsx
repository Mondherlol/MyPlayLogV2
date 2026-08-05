import { Moon, Sun } from "lucide-react";
import { useTheme } from "../context/ThemeContext";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="theme-toggle clickable"
      onClick={toggle}
      title={theme === "light" ? "Passer en sombre" : "Passer en clair"}
      aria-label="Changer de thème"
    >
      {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}
