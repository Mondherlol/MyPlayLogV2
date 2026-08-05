import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import "./App.css";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { installGlobalErrorReporting, reportEnvPing } from "./lib/reportError.js";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { LibraryProvider } from "./context/LibraryContext.jsx";
import { PlayerProvider } from "./context/PlayerContext.jsx";
import { CosmeticsProvider } from "./context/CosmeticsContext.jsx";
import { ChatProvider } from "./context/ChatContext.jsx";

// Capture les erreurs non-rattrapées (hors rendu React) et les remonte au
// backend, pour diagnostiquer les crashs qui n'arrivent que sur certains
// appareils. À installer avant le premier rendu.
installGlobalErrorReporting();
// Diagnostic ponctuel : identifie si l'app installée (APK) tourne en TWA (Chrome)
// ou en WebView. Ne fait rien dans un onglet de navigateur classique.
reportEnvPing();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            {/* Messagerie : le flux temps réel (SSE) vit au-dessus des routes
                pour que le son et les pop-up de message marchent partout dans
                l'app, pas seulement sur /messages. */}
            <ChatProvider>
              {/* Curseur & cosmétiques gagnés à l'arcade : au-dessus des routes,
                  l'apparence équipée vaut pour toute l'app. */}
              <CosmeticsProvider>
                <LibraryProvider>
                  {/* Lecteur audio global : monté une seule fois au-dessus des
                      routes pour survivre à TOUTE navigation (y compris /game/:id
                      et /u/:username, servis hors du layout connecté). */}
                  <PlayerProvider>
                    <App />
                  </PlayerProvider>
                </LibraryProvider>
              </CosmeticsProvider>
            </ChatProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);

// PWA : enregistre le service worker (installation + repli hors-ligne).
// Uniquement en prod : en dev, un SW en cache masquerait les mises à jour de Vite.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
