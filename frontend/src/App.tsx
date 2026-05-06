import { AppProvider, useApp } from './app/AppContext';
import { canAccessScreen } from './app/permissions';
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
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { RolesScreen } from './ui/screens/RolesScreen';
import { UsersScreen } from './ui/screens/UsersScreen';
import { SharePrescriptionScreen } from './ui/screens/SharePrescriptionScreen';

function Router() {
  const { loggedIn, screen, permissions } = useApp();

  if (!loggedIn) return <LoginScreen />;

  // If the current screen is gated by a permission the user lacks, render
  // nothing while AppShell's effect bounces us to an allowed screen.
  const allowed = canAccessScreen(permissions, screen);

  return (
    <AppShell>
      {allowed && screen === 'dashboard' && <DashboardScreen />}
      {allowed && screen === 'patients' && <PatientsScreen />}
      {allowed && screen === 'appointments' && <AppointmentsScreen />}
      {allowed && screen === 'encounters' && <EncounterScreen />}
      {allowed && screen === 'billing' && <BillingScreen />}
      {allowed && screen === 'documents' && <DocumentsScreen />}
      {allowed && screen === 'reports' && <ReportsScreen />}
      {allowed && screen === 'notifications' && <NotificationsScreen />}
      {allowed && screen === 'settings' && <SettingsScreen />}
      {allowed && screen === 'roles' && <RolesScreen />}
      {allowed && screen === 'users' && <UsersScreen />}
    </AppShell>
  );
}

export function App() {
  // Simple public routing for sharing
  const path = window.location.pathname;
  if (path.startsWith('/share/')) {
    const token = path.split('/')[2];
    return (
      <AppProvider>
        <SharePrescriptionScreen token={token} />
      </AppProvider>
    );
  }

  return (
    <AppProvider>
      <ToastProvider>
        <Router />
      </ToastProvider>
    </AppProvider>
  );
}
