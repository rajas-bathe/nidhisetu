import { type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { AppLayout } from "./components/layout/AppLayout";
import { LandingPage } from "./pages/public/Landing";
import { LoginPage } from "./pages/public/LoginPage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { FdrRegisterPage } from "./pages/fdrs/FdrRegisterPage";
import { SubmitWizardPage } from "./pages/fdrs/SubmitWizardPage";
import { CaseDetailPage } from "./pages/cases/CaseDetailPage";
import { CorrectionsPage } from "./pages/corrections/CorrectionsPage";
import { ReplacementsPage } from "./pages/replacements/ReplacementsPage";
import { ReleasesPage } from "./pages/releases/ReleasesPage";
import { ApprovalsPage } from "./pages/approvals/ApprovalsPage";
import { TasksPage } from "./pages/tasks/TasksPage";
import { NotificationsPage } from "./pages/notifications/NotificationsPage";
import { ReportsPage } from "./pages/reports/ReportsPage";
import { AuditPage } from "./pages/audit/AuditPage";
import { CollegesPage } from "./pages/admin/CollegesPage";
import { CollegeDetailPage } from "./pages/admin/CollegeDetailPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { ChangePasswordPage } from "./pages/account/ChangePasswordPage";
import { NotFoundPage, ForbiddenPage } from "./pages/shared/NotFound";
import { Spinner } from "./components/ui/States";

/** Gate for authenticated screens; waits for the backend session lookup. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking your session..." />
      </div>
    );
  }
  if (user == null) {
    return <Navigate to="/" replace />;
  }
  // Accounts holding a temporary password (admin provisioning, password
  // reset) must replace it before any other screen renders. The backend
  // rejects every other call in this state as well.
  if (user.mustChangePassword) {
    return <ChangePasswordPage forced />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login/college" element={<LoginPage portal="college" />} />
      <Route path="/login/officer" element={<LoginPage portal="officer" />} />
      <Route path="/login/admin" element={<LoginPage portal="admin" />} />
      <Route path="/forbidden" element={<ForbiddenPage />} />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/fdrs" element={<FdrRegisterPage />} />
        <Route path="/fdrs/new" element={<SubmitWizardPage />} />
        <Route path="/fdrs/:fdrId" element={<CaseDetailPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/corrections" element={<CorrectionsPage />} />
        <Route path="/replacements" element={<ReplacementsPage />} />
        <Route path="/releases" element={<ReleasesPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/admin/colleges" element={<CollegesPage />} />
        <Route path="/admin/colleges/:institutionId" element={<CollegeDetailPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/account/password" element={<ChangePasswordPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
