import { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

const AuthContext = createContext();

// Le token peut vivre dans localStorage (se souvenir de moi) ou sessionStorage.
function readStoredToken() {
  return (
    localStorage.getItem("mpl_token") ||
    sessionStorage.getItem("mpl_token") ||
    null
  );
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(readStoredToken);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!token);

  // Au chargement, si on a un token, on récupère l'utilisateur.
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch("/auth/me", { token })
      .then((data) => setUser(data.user))
      .catch(() => logout())
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persistToken(newToken, remember) {
    setToken(newToken);
    if (remember) {
      localStorage.setItem("mpl_token", newToken);
      sessionStorage.removeItem("mpl_token");
    } else {
      sessionStorage.setItem("mpl_token", newToken);
      localStorage.removeItem("mpl_token");
    }
  }

  async function login(identifier, password, remember) {
    const data = await apiFetch("/auth/login", {
      method: "POST",
      body: { identifier, password, remember },
    });
    persistToken(data.token, remember);
    setUser(data.user);
    return data.user;
  }

  async function register(email, username, password) {
    const data = await apiFetch("/auth/register", {
      method: "POST",
      body: { email, username, password },
    });
    persistToken(data.token, true);
    setUser(data.user);
    return data.user;
  }

  // Réinitialisation via lien email : le backend renvoie un token → on connecte.
  async function resetPassword(resetToken, password) {
    const data = await apiFetch("/auth/reset-password", {
      method: "POST",
      body: { token: resetToken, password },
    });
    persistToken(data.token, false);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    setToken(null);
    setUser(null);
    localStorage.removeItem("mpl_token");
    sessionStorage.removeItem("mpl_token");
  }

  // Met à jour l'utilisateur courant (après édition de profil).
  function updateUser(patch) {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        resetPassword,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
