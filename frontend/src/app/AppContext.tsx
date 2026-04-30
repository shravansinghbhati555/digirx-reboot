import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiGet, apiPost } from './api';
import { clearContext, isLoggedIn, loadContext, saveContext, type DevContext } from './context';

export type ScreenKey =
  | 'dashboard'
  | 'patients'
  | 'appointments'
  | 'encounters'
  | 'billing'
  | 'documents'
  | 'reports'
  | 'notifications'
  | 'branches'
  | 'users'
  | 'roles'
  | 'settings'
  | 'audit';

type AppState = {
  ctx: DevContext;
  setCtx: (next: DevContext) => void;
  loggedIn: boolean;
  permissions: Set<string>;
  loadingMe: boolean;
  meError: string | null;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
  screen: ScreenKey;
  setScreen: (s: ScreenKey) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  selectedAppointmentId?: string;
  setSelectedAppointmentId: (id: string | undefined) => void;
  selectedPatientId?: string;
  setSelectedPatientId: (id: string | undefined) => void;
  selectedDate: string; // YYYY-MM-DD
  setSelectedDate: (d: string) => void;
};

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtxState] = useState<DevContext>(() => loadContext());
  const [screen, setScreen] = useState<ScreenKey>('dashboard');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('digirx.theme');
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [meData, setMeData] = useState<{ permissions: string[]; user?: { fullName?: string; email?: string } } | null>(null);
  const [loadingMe, setLoadingMe] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | undefined>();
  const [selectedPatientId, setSelectedPatientId] = useState<string | undefined>();
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  function setCtx(next: DevContext) {
    setCtxState(next);
    saveContext(next);
  }

  function toggleTheme() {
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light';
      localStorage.setItem('digirx.theme', next);
      return next;
    });
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const loggedIn = isLoggedIn(ctx);

  async function refreshMe() {
    if (!loggedIn) {
      setMeData(null);
      return;
    }
    setLoadingMe(true);
    setMeError(null);
    try {
      const data = await apiGet<{ permissions: string[]; user?: { fullName?: string; email?: string } }>(ctx, '/me');
      setMeData(data);
      // Persist email/fullName/permissions for header display.
      const next: DevContext = {
        ...ctx,
        email: data.user?.email,
        fullName: data.user?.fullName,
        permissions: data.permissions,
      };
      saveContext(next);
      setCtxState(next);
    } catch (e) {
      setMeError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMe(false);
    }
  }

  useEffect(() => {
    void refreshMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.accessToken, ctx.userId, ctx.clinicId]);

  async function logout() {
    try {
      await apiPost(ctx, '/auth/logout', {});
    } catch {
      // ignore
    }
    clearContext();
    const fresh = loadContext();
    setCtxState(fresh);
    setMeData(null);
  }

  const permissions = useMemo(() => new Set(meData?.permissions ?? ctx.permissions ?? []), [meData, ctx.permissions]);

  const value: AppState = {
    ctx,
    setCtx,
    loggedIn,
    permissions,
    loadingMe,
    meError,
    refreshMe,
    logout,
    screen,
    setScreen,
    theme,
    toggleTheme,
    selectedAppointmentId,
    setSelectedAppointmentId,
    selectedPatientId,
    setSelectedPatientId,
    selectedDate,
    setSelectedDate,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
