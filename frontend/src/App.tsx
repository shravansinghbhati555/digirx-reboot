import { AppProvider, useApp } from './app/AppContext';
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

function Router() {
  const { loggedIn, screen } = useApp();

  if (!loggedIn) return <LoginScreen />;

  return (
    <AppShell>
      {screen === 'dashboard' && <DashboardScreen />}
      {screen === 'patients' && <PatientsScreen />}
      {screen === 'appointments' && <AppointmentsScreen />}
      {screen === 'encounters' && <EncounterScreen />}
      {screen === 'billing' && <BillingScreen />}
      {screen === 'documents' && <DocumentsScreen />}
      {screen === 'reports' && <ReportsScreen />}
      {screen === 'notifications' && <NotificationsScreen />}
      {screen === 'settings' && <SettingsScreen />}
    </AppShell>
  );
}

export function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <Router />
      </ToastProvider>
    </AppProvider>
  );
}
