import { AuthProvider, useAuth } from "./AuthContext";
import PlagiarismChecker from "./AppX";
import Login from "./Login";

function AppContent() {
  const { user, logout } = useAuth();

  if (!user) return <Login />;

  return (
    <div>
      <PlagiarismChecker user={user} onLogout={logout} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}