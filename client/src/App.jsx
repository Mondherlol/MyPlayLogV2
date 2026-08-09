import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Welcome from "./pages/Welcome";
import BlindTest from "./pages/BlindTest";
import PixelRush from "./pages/PixelRush";
import GeoGamer from "./pages/GeoGamer";
import GeoVersus from "./pages/GeoVersus";
import BlindTestVersus from "./pages/BlindTestVersus";
import PixelVersus from "./pages/PixelVersus";
import Quizz from "./pages/Quizz";
import QuizzVersus from "./pages/QuizzVersus";
import MotDuJour from "./pages/MotDuJour";
import Arcade from "./pages/Arcade";
import Playtopia from "./pages/Playtopia";
import Explorer from "./pages/Explorer";
import Releases from "./pages/Releases";
import GamePage from "./pages/GamePage";
import ClipPage from "./pages/ClipPage";
import CompanyPage from "./pages/CompanyPage";
import PlatformPage from "./pages/PlatformPage";
import Profile from "./pages/Profile";
import Lists from "./pages/Lists";
import Collection from "./pages/Collection";
import CollectionDetail from "./pages/CollectionDetail";
import WatchParty from "./pages/WatchParty";
import Messages from "./pages/Messages";
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

// Section soumise à un drapeau réglé dans le panneau d'admin. Éteinte, elle
// n'existe pas : l'URL ramène à l'accueil plutôt que d'afficher une page vide
// ou un message d'erreur. L'admin, lui, passe toujours — c'est lui qui prépare
// la section pendant qu'elle est cachée (même règle que lib/features.js côté
// serveur, qui refuse les requêtes de son côté).
function FeatureRoute({ name, element }) {
  const { hasFeature, loading } = useAuth();
  if (loading) return <div className="center-screen">Chargement…</div>;
  return hasFeature(name) ? element : <Navigate to="/app" replace />;
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
        <Route path="/arcade" element={<Arcade />} />
        <Route path="/blindtest" element={<BlindTest />} />
        {/* Salon de versus musical : adresse des liens d'invitation. */}
        <Route path="/blindtest/versus/:code" element={<BlindTestVersus />} />
        <Route path="/pixel" element={<PixelRush />} />
        {/* Salon de versus visuel : adresse des liens d'invitation. */}
        <Route path="/pixel/versus/:code" element={<PixelVersus />} />
        <Route path="/geo" element={<GeoGamer />} />
        {/* Le salon de versus : c'est aussi l'adresse des liens d'invitation
            et des cartes envoyées en message privé. */}
        <Route path="/geo/versus/:code" element={<GeoVersus />} />
        <Route path="/quiz" element={<Quizz />} />
        {/* Le plateau à plusieurs : adresse des liens d'invitation et des
            cartes envoyées en message privé. */}
        <Route path="/quiz/versus/:code" element={<QuizzVersus />} />
        <Route path="/mot" element={<MotDuJour />} />
        <Route path="/playtopia" element={<Playtopia />} />
        <Route path="/explore" element={<Explorer />} />
        <Route path="/releases" element={<Releases />} />
        <Route path="/company/:name" element={<CompanyPage />} />
        <Route path="/platform/:id" element={<PlatformPage />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/lists" element={<Lists />} />
        <Route path="/lists/:id" element={<ListDetail />} />
        {/* Le rayon vidéo s'allume depuis le panneau d'admin. Éteint, l'URL
            ramène à l'accueil pour tout le monde sauf l'admin — qui prépare la
            page pendant qu'elle est cachée. Le serveur refuse de son côté :
            masquer une route n'a jamais protégé une API. */}
        <Route path="/collection" element={<FeatureRoute name="collection" element={<Collection />} />} />
        {/* L'étagère de quelqu'un d'autre. Déclarée AVANT « /collection/:slug »,
            sinon « u » passerait pour le slug d'un boîtier. */}
        <Route
          path="/collection/u/:username"
          element={<FeatureRoute name="collection" element={<Collection />} />}
        />
        <Route
          path="/collection/:slug"
          element={<FeatureRoute name="collection" element={<CollectionDetail />} />}
        />
        {/* Une salle de projection à plusieurs. Même drapeau que le rayon : c'est
            une façon de le regarder. Le lien porte le code de la salle — qui l'a
            peut entrer, comme une invitation Discord. */}
        <Route
          path="/watchparty/:code"
          element={<FeatureRoute name="collection" element={<WatchParty />} />}
        />
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
