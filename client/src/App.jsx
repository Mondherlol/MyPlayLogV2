import { Routes, Route, Navigate } from "react-router-dom";
import { Settings } from "lucide-react";
import { useAuth } from "./context/AuthContext";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Welcome from "./pages/Welcome";
import Explorer from "./pages/Explorer";
import Releases from "./pages/Releases";
import GamePage from "./pages/GamePage";
import CompanyPage from "./pages/CompanyPage";
import Profile from "./pages/Profile";
import Lists from "./pages/Lists";
import ListDetail from "./pages/ListDetail";
import Admin from "./pages/Admin";
import Placeholder from "./pages/Placeholder";
import AppLayout from "./components/AppLayout";
import InstallPrompt from "./components/InstallPrompt";
import ScrollManager from "./components/ScrollManager";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Chargement…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
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

      {/* Espace connecté : sidebar + topbar */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/app" element={<Welcome />} />
        <Route path="/explore" element={<Explorer />} />
        <Route path="/releases" element={<Releases />} />
        <Route path="/game/:id" element={<GamePage />} />
        <Route path="/company/:name" element={<CompanyPage />} />
        <Route path="/lists" element={<Lists />} />
        <Route path="/lists/:id" element={<ListDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/u/:username" element={<Profile />} />
        <Route path="/admin" element={<Admin />} />
        <Route
          path="/settings"
          element={<Placeholder title="Paramètres" Icon={Settings} />}
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Pop-up d'installation PWA (Android/iOS), globale à toute l'app. */}
      <InstallPrompt />
    </>
  );
}
