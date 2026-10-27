import { type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { AppLayout } from "./components/layout/AppLayout";
import { LandingPage } from "./pages/public/Landing";
import { LoginPage } from "./pages/public/LoginPage";
import { DashboardPage } from "./pages/college/DashboardPage";
import { MyFdrsPage } from "./pages/college/MyFdrsPage";
import { NotFoundPage, ForbiddenPage } from "./pages/shared/NotFound";
import { Spinner } from "./components/ui/States";

/** Gate for authenticated screens; waits for the backend session lookup. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking your session…" />
      </div>
    );
  }
  if (user == null) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login/college" element={<LoginPage portal="college" />} />
      <Route path="/login/officer" element={<LoginPage portal="officer" />} />
      <Route path="/forbidden" element={<ForbiddenPage />} />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/fdrs" element={<MyFdrsPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
