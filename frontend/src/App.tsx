import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './app/AppContext';
import { canAccessScreen, isScreenAllowedForRoles } from './app/permissions';
import { ToastProvider } from './ui/shared/primitives';
import { AppShell } from './ui/AppShell';
import { LoginScreen } from './ui/screens/LoginScreen';
import { DashboardScreen } from './ui/screens/DashboardScreen';
import { PatientsScreen } from './ui/screens/PatientsScreen';
import { AppointmentsScreen } from './ui/screens/AppointmentsScreen';
import { EncounterScreen } from './ui/screens/EncounterScreen';
import { BillingScreen } from './ui/screens/BillingScreen';
import { DocumentsScreen } from './ui/screens/DocumentsScreen';
import { ReportsScreen } from './ui/screens/ReportsScreen';
import { NotificationsScreen } from './ui/screens/NotificationsScreen';
import { InventoryScreen } from './ui/screens/InventoryScreen';
import { PharmacyScreen } from './ui/screens/PharmacyScreen';
import { SettingsScreen, AvailabilityScreen } from './ui/screens/SettingsScreen';
import { ProfileScreen } from './ui/screens/ProfileScreen';
import { RolesScreen } from './ui/screens/RolesScreen';
import { UsersScreen } from './ui/screens/UsersScreen';
import { SharePrescriptionScreen } from './ui/screens/SharePrescriptionScreen';
import { PlatformScreen } from './ui/screens/PlatformScreen';
import { LeadsScreen } from './ui/screens/LeadsScreen';

/**
 * Permission-gated route wrapper. Renders nothing when the user lacks the
 * required permission for `screenKey`; AppShell's redirect-on-blocked
 * effect will bounce them somewhere they can see.
 */
function Guarded({
  screenKey,
  children,
}: {
  screenKey: Parameters<typeof canAccessScreen>[1];
  children: React.ReactNode;
}) {
  const { permissions, roleNames } = useApp();
  const allowed =
    canAccessScreen(permissions, screenKey) &&
    isScreenAllowedForRoles(roleNames, screenKey);
  return allowed ? <>{children}</> : null;
}

/**
 * The clinic approval queue is DigiRx-staff only. It hangs off the
 * `isPlatformAdmin` flag from /me, not off clinic permissions, so the normal
 * `Guarded` wrapper cannot express it.
 */
function PlatformGuarded({ children }: { children: React.ReactNode }) {
  const { isPlatformAdmin, loadingMe } = useApp();
  // Wait for /me before deciding: bouncing during the first paint would
  // kick a platform admin off their own screen on a hard refresh.
  if (loadingMe) return null;
  return isPlatformAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

function AuthedShell() {
  const { loggedIn } = useApp();
  if (!loggedIn) return <Navigate to="/login" replace />;

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Guarded screenKey="dashboard"><DashboardScreen /></Guarded>} />
        <Route path="/patients/*" element={<Guarded screenKey="patients"><PatientsScreen /></Guarded>} />
        <Route path="/appointments/*" element={<Guarded screenKey="appointments"><AppointmentsScreen /></Guarded>} />
        <Route path="/encounters/*" element={<Guarded screenKey="encounters"><EncounterScreen /></Guarded>} />
        <Route path="/billing/*" element={<Guarded screenKey="billing"><BillingScreen /></Guarded>} />
        <Route path="/documents/*" element={<Guarded screenKey="documents"><DocumentsScreen /></Guarded>} />
        <Route path="/reports/*" element={<Guarded screenKey="reports"><ReportsScreen /></Guarded>} />
        <Route path="/notifications/*" element={<Guarded screenKey="notifications"><NotificationsScreen /></Guarded>} />
        <Route path="/inventory/*" element={<Guarded screenKey="inventory"><InventoryScreen /></Guarded>} />
        <Route path="/pharmacy/*" element={<Guarded screenKey="pharmacy"><PharmacyScreen /></Guarded>} />
        <Route path="/users/*" element={<Guarded screenKey="users"><UsersScreen /></Guarded>} />
        <Route path="/roles/*" element={<Guarded screenKey="roles"><RolesScreen /></Guarded>} />
        <Route path="/settings/*" element={<Guarded screenKey="settings"><SettingsScreen /></Guarded>} />
        <Route path="/availability/*" element={<Guarded screenKey="availability"><AvailabilityScreen /></Guarded>} />
        <Route path="/profile/*" element={<Guarded screenKey="profile"><ProfileScreen /></Guarded>} />
        <Route path="/platform/*" element={<PlatformGuarded><PlatformScreen /></PlatformGuarded>} />
        <Route path="/leads/*" element={<PlatformGuarded><LeadsScreen /></PlatformGuarded>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

function LoginGate() {
  const { loggedIn } = useApp();
  if (loggedIn) return <Navigate to="/" replace />;
  return <LoginScreen />;
}

export function App() {
  // Simple public routing for sharing
  const path = window.location.pathname;
  if (path.startsWith('/share/')) {
    const parts = path.split('/').filter(Boolean);
    const token = parts[parts.length - 1];
    return (
      <BrowserRouter>
        <AppProvider>
          <SharePrescriptionScreen token={token} />
        </AppProvider>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <AppProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginGate />} />
            <Route path="/*" element={<AuthedShell />} />
          </Routes>
        </ToastProvider>
      </AppProvider>
    </BrowserRouter>
  );
}
