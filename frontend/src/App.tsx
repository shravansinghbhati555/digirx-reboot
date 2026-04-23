import { useMemo, useState } from 'react';
import { loadContext } from './app/context';
import { MobileShell, type TabKey } from './ui/MobileShell';
import { HomeScreen } from './ui/screens/HomeScreen';
import { MeScreen } from './ui/screens/MeScreen';
import { PatientsScreen } from './ui/screens/PatientsScreen';
import { AppointmentsScreen } from './ui/screens/AppointmentsScreen';
import { BillingScreen } from './ui/screens/BillingScreen';
import { ReportsScreen } from './ui/screens/ReportsScreen';

export function App() {
  const initial = useMemo(() => loadContext(), []);
  const [ctx, setCtx] = useState(initial);
  const [tab, setTab] = useState<TabKey>('home');

  return (
    <MobileShell active={tab} onChange={setTab}>
      {tab === 'home' ? <HomeScreen ctx={ctx} onChange={setCtx} /> : null}
      {tab === 'me' ? <MeScreen ctx={ctx} /> : null}

      {tab === 'patients' ? <PatientsScreen ctx={ctx} /> : null}
      {tab === 'appointments' ? <AppointmentsScreen ctx={ctx} /> : null}
      {tab === 'billing' ? <BillingScreen ctx={ctx} /> : null}
      {tab === 'reports' ? <ReportsScreen ctx={ctx} /> : null}
    </MobileShell>
  );
}

