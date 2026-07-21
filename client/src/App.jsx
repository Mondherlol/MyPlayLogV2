import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Welcome from "./pages/Welcome";
import BlindTest from "./pages/BlindTest";
import Playtopia from "./pages/Playtopia";
import Explorer from "./pages/Explorer";
import Releases from "./pages/Releases";
import GamePage from "./pages/GamePage";
import ClipPage from "./pages/ClipPage";
import CompanyPage from "./pages/CompanyPage";
import PlatformPage from "./pages/PlatformPage";
import Profile from "./pages/Profile";
import Lists from "./pages/Lists";
import ListDetail from "./pages/ListDetail";
import Admin from "./pages/Admin";
import Settings from "./pages/Settings";
import Placeholder from "./pages/Placeholder";
import AppLayout from "./components/AppLayout";
import PublicShell from "./components/PublicShell";
import InstallPrompt from "./components/InstallPrompt";
import ScrollManager from "./components/ScrollManager";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Chargement…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Page partageable (profil, fiche de jeu) : consultable connecté (dans l'app,
// avec sidebar) OU en invité (coquille publique + appel à l'inscription). On
// choisit la coquille selon l'auth, sans jamais rediriger vers /login.
function PublicOrApp({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Chargement…</div>;
  return user ? (
    <AppLayout>{children}</AppLayout>
  ) : (
    <PublicShell>{children}</PublicShell>
  );
}

function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Chargement…</div>;
  if (user) return <Navigate to="/app" replace />;
  return children;
}

export default function App() {
  return (
    <>
      <ScrollManager />
      <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/login"
        element={
          <GuestOnly>
            <Login />
          </GuestOnly>
        }
      />
      <Route
        path="/register"
        element={
          <GuestOnly>
            <Register />
          </GuestOnly>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <GuestOnly>
            <ForgotPassword />
          </GuestOnly>
        }
      />
      <Route
        path="/reset-password"
        element={
          <GuestOnly>
            <ResetPassword />
          </GuestOnly>
        }
      />

      {/* Pages publiques partageables : accessibles connecté OU en invité. */}
      <Route
        path="/u/:username"
        element={
          <PublicOrApp>
            <Profile />
          </PublicOrApp>
        }
      />
      <Route
        path="/game/:id"
        element={
          <PublicOrApp>
            <GamePage />
          </PublicOrApp>
        }
      />
      <Route
        path="/clip/:id"
        element={
          <PublicOrApp>
            <ClipPage />
          </PublicOrApp>
        }
      />

      {/* Espace connecté : sidebar + topbar */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/app" element={<Welcome />} />
        <Route path="/blindtest" element={<BlindTest />} />
        <Route path="/playtopia" element={<Playtopia />} />
        <Route path="/explore" element={<Explorer />} />
        <Route path="/releases" element={<Releases />} />
        <Route path="/company/:name" element={<CompanyPage />} />
        <Route path="/platform/:id" element={<PlatformPage />} />
        <Route path="/lists" element={<Lists />} />
        <Route path="/lists/:id" element={<ListDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Pop-up d'installation PWA (Android/iOS), globale à toute l'app. */}
      <InstallPrompt />
    </>
  );
}
