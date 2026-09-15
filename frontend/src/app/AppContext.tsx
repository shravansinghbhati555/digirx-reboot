import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiGet, apiPost, AUTH_EXPIRED_EVENT } from './api';
import { clearContext, isLoggedIn, loadContext, saveContext, type DevContext } from './context';
import { SCREEN_PATHS, pathToScreen } from './screen-paths';

// Top-level screens. `branches` and `audit` were here previously but they
// live as tabs inside SettingsScreen, never as standalone shells —
// navigating to them produced an empty AppShell. Removed.
export type ScreenKey =
  | 'dashboard'
  | 'patients'
  | 'appointments'
  | 'encounters'
  | 'billing'
  | 'documents'
  | 'reports'
  | 'notifications'
  | 'inventory'
  | 'pharmacy'
  | 'users'
  | 'roles'
  | 'settings'
  // Standalone Availability screen — used by doctors, who get it in the
  // sidebar instead of as a Settings tab. Other roles still edit
  // availability inside Settings.
  | 'availability'
  // DigiRx staff only: the cross-clinic approval queue. Gated by the
  // `isPlatformAdmin` flag from /me, never by a clinic permission.
  | 'platform'
  // Per-user profile: photo, role, clinic, and the user's personal
  // display-timezone preference + their appointments.
  | 'profile';

// Per-clinic feature toggles returned alongside /me. Mirrors a slice of
// the BE's `modules` settings shape — only the flags the FE actually
// reads at render time to hide/show optional UI surfaces.
export type Features = {
  faceRecognition: boolean;
  inventory: boolean;
  // Drives the BookSheet kind selector. 'BOTH' keeps the existing
  // TIME/QUEUE toggle; the others lock the wizard to that one mode.
  appointmentMode: 'TIME' | 'QUEUE' | 'BOTH';
};

type AppState = {
  ctx: DevContext;
  setCtx: (next: DevContext) => void;
  loggedIn: boolean;
  permissions: Set<string>;
  // Lowercased role names assigned to the current user. Used by the
  // shell to gate admin UI by role (not just by permission) — e.g.
  // doctors never see the Users/Roles tabs even if an admin grants
  // them the underlying `user:read` permission.
  roleNames: Set<string>;
  features: Features;
  // True when the signed-in user is a DigiRx platform operator, which
  // unlocks the clinic approval queue. Not a clinic role.
  isPlatformAdmin: boolean;
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
  selectedBillId?: string;
  setSelectedBillId: (id: string | undefined) => void;
  selectedEncounterId?: string;
  setSelectedEncounterId: (id: string | undefined) => void;
  selectedDate: string; // YYYY-MM-DD
  setSelectedDate: (d: string) => void;
  // One-shot signal: the header "+ New" button sets this true and
  // navigates to the Patients tab; PatientsScreen opens the registration
  // modal in response and clears the flag.
  newPatientRequested: boolean;
  setNewPatientRequested: (v: boolean) => void;
};

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

// Today's date (YYYY-MM-DD) in a given IANA timezone. Falls back to the
// browser's local date when no/invalid timezone is given. `en-CA` formats
// as YYYY-MM-DD.
function todayInTimezone(tz?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', tz ? { timeZone: tz } : undefined).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(new Date());
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtxState] = useState<DevContext>(() => loadContext());

  // Screen state is derived from the URL — gives us deep-linking and the
  // browser back button for free. `setScreen` is preserved as a thin
  // wrapper around `navigate` so existing call sites keep working without
  // an audit of every component.
  const location = useLocation();
  const navigate = useNavigate();
  const screen = useMemo(() => pathToScreen(location.pathname), [location.pathname]);
  const setScreen = useCallback(
    (s: ScreenKey) => {
      navigate(SCREEN_PATHS[s]);
    },
    [navigate],
  );

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('digirx.theme');
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [meData, setMeData] = useState<{
    permissions: string[];
    features?: Partial<Features>;
    user?: { name?: string; fullName?: string; email?: string };
    roles?: Array<{ name?: string }>;
    branch?: { _id?: string; name?: string } | null;
    // DigiRx staff flag, used to surface the clinic approval queue.
    isPlatformAdmin?: boolean;
  } | null>(null);
  const [loadingMe, setLoadingMe] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | undefined>();
  const [selectedPatientId, setSelectedPatientId] = useState<string | undefined>();
  const [selectedBillId, setSelectedBillId] = useState<string | undefined>();
  const [selectedEncounterId, setSelectedEncounterId] = useState<string | undefined>();
  // The header date that drives all date-scoped data filtering. Defaults
  // to "today" — but in the CLINIC's timezone, not UTC/browser-local — so
  // when the clinic is in a different timezone the calendar (and the data
  // it filters) follows the clinic's current day, matching the header
  // clock. Until the user manually picks a date, it stays synced to the
  // clinic-local today as the timezone loads from /me.
  const [selectedDate, setSelectedDateState] = useState<string>(() => todayInTimezone());
  const dateManuallySet = useRef(false);
  const prevTz = useRef<string | undefined>(ctx.timezone);
  const setSelectedDate = useCallback((d: string) => {
    dateManuallySet.current = true;
    setSelectedDateState(d);
  }, []);
  // Keep the header date aligned with the clinic timezone:
  //  - On first load (timezone resolving from /me), pin to clinic-local
  //    today until the user navigates to a specific date.
  //  - When the clinic timezone actually CHANGES (the operator switched
  //    the clinic's location in Settings), snap to the new clinic-local
  //    today and forget any prior manual date — so the day view fetches
  //    and shows that timezone's current-day appointments.
  useEffect(() => {
    const tz = ctx.timezone;
    const today = todayInTimezone(tz);
    if (prevTz.current !== undefined && prevTz.current !== tz) {
      prevTz.current = tz;
      dateManuallySet.current = false;
      setSelectedDateState(today);
      return;
    }
    prevTz.current = tz;
    if (!dateManuallySet.current) {
      setSelectedDateState((prev) => (prev === today ? prev : today));
    }
  }, [ctx.timezone]);
  const [newPatientRequested, setNewPatientRequested] = useState(false);

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

  useEffect(() => {
    function onAuthExpired() {
      setCtxState(loadContext());
      setMeData(null);
      setMeError(null);
      // Go straight to /login so there's no visible bounce through the
      // dashboard. `state.reason` lets the login screen surface a
      // "Session expired" banner so users understand why they were
      // booted instead of seeing a generic auth error.
      navigate('/login', { replace: true, state: { reason: 'session-expired' } });
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
  }, [navigate]);

  const loggedIn = isLoggedIn(ctx);

  async function refreshMe() {
    if (!loggedIn) {
      setMeData(null);
      return;
    }
    setLoadingMe(true);
    setMeError(null);
    try {
      const data = await apiGet<{
        permissions: string[];
        features?: Partial<Features>;
        isPlatformAdmin?: boolean;
        user?: { name?: string; fullName?: string; email?: string };
        roles?: Array<{ name?: string }>;
        branch?: { _id?: string; name?: string; upiId?: string | null; upiQrUrl?: string | null } | null;
        clinic?: {
          name?: string;
          currency?: string;
          timezone?: string;
          countryCode?: string;
          branding?: {
            displayName?: string | null;
            logoUrl?: string | null;
            primaryColor?: string | null;
            upiId?: string | null;
            upiQrUrl?: string | null;
          } | null;
        };
        displayTimezone?: string | null;
        profileImageUrl?: string | null;
      }>(ctx, '/me');
      setMeData(data);
      // Persist email/fullName/permissions for header display.
      // The User schema uses `name`; keep `fullName` as a fallback for older clients.
      const next: DevContext = {
        ...ctx,
        email: data.user?.email,
        fullName: data.user?.fullName ?? data.user?.name,
        permissions: data.permissions,
        clinicName: data.clinic?.name ?? ctx.clinicName,
        // The single-step login only ships branchId — branchName falls
        // out of /me so the sidebar / header chip shows the readable
        // name instead of an id-tail fallback.
        branchName: data.branch?.name ?? ctx.branchName,
        branchUpiId: data.branch?.upiId ?? null,
        branchUpiQrUrl: data.branch?.upiQrUrl ?? null,
        countryCode: data.clinic?.countryCode ?? null,
        currency: data.clinic?.currency ?? ctx.currency,
        // The clinic's authoritative timezone.
        clinicTimezone: data.clinic?.timezone ?? ctx.clinicTimezone,
        // This user's personal display-timezone preference (may be empty).
        displayTimezone: data.displayTimezone ?? undefined,
        // Effective timezone used for ALL display + date filtering for this
        // user: their own choice, falling back to the clinic timezone.
        timezone: (data.displayTimezone || data.clinic?.timezone) ?? ctx.timezone,
        profileImageUrl: data.profileImageUrl ?? undefined,
        branding: data.clinic?.branding
          ? {
              displayName: data.clinic.branding.displayName ?? null,
              logoUrl: data.clinic.branding.logoUrl ?? null,
              primaryColor: data.clinic.branding.primaryColor ?? null,
              upiId: data.clinic.branding.upiId ?? null,
              upiQrUrl: data.clinic.branding.upiQrUrl ?? null,
            }
          : ctx.branding,
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
  const roleNames = useMemo(
    () =>
      new Set(
        (meData?.roles ?? [])
          .map((r) => (r?.name ?? '').toLowerCase())
          .filter(Boolean),
      ),
    [meData],
  );
  // Feature flags default to off when /me hasn't loaded yet so optional
  // UI surfaces stay hidden during the brief first-paint window — better
  // than flashing them then yanking them away on resolve. appointmentMode
  // defaults to 'BOTH' so the BookSheet stays maximally useful before the
  // real value lands.
  const features = useMemo<Features>(
    () => ({
      faceRecognition: meData?.features?.faceRecognition ?? false,
      inventory: meData?.features?.inventory ?? false,
      appointmentMode: meData?.features?.appointmentMode ?? 'BOTH',
    }),
    [meData],
  );

  // Defaults to false until /me resolves, so the queue never flashes for
  // an ordinary clinic user on first paint.
  const isPlatformAdmin = meData?.isPlatformAdmin === true;

  const value: AppState = {
    ctx,
    setCtx,
    loggedIn,
    permissions,
    roleNames,
    features,
    isPlatformAdmin,
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
    selectedBillId,
    setSelectedBillId,
    selectedEncounterId,
    setSelectedEncounterId,
    selectedDate,
    setSelectedDate,
    newPatientRequested,
    setNewPatientRequested,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
