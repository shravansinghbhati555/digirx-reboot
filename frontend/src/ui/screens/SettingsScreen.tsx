import { useEffect, useMemo, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, apiPostMultipart, apiPut } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { emitAvailabilityChanged } from '../../app/events';
import { Perm, type PermName } from '../../app/permissions';
import { isValidIndianMobile, normalizeIndianMobile } from '../../app/validators';
import { Checkbox, Dropdown, EmptyState, Field, Spinner, labelStyle, useToast, setDetectedCurrency } from '../shared/primitives';
import { Icon, type IconName } from '../shared/Icon';
// InventoryScreen used to be embedded under a Settings → Inventory tab,
// but inventory now has its own top-level sidebar entry. The tab was
// removed at the user's request to avoid two navigation paths to the
// same screen.

type ClinicBranding = {
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
};

type QuietHoursSettings = {
  start: string | null;
  end: string | null;
};

type ClinicSettings = {
  appointments: { mode: 'TIME' | 'QUEUE' | 'BOTH'; slotMinutesDefault: number };
  modules: {
    inventory: { enabled: boolean };
    notifications?: {
      sms?: { enabled: boolean };
      whatsapp?: { enabled: boolean };
      quietHours?: QuietHoursSettings;
    };
    faceRecognition?: { enabled: boolean };
  };
  branding: ClinicBranding;
};

type ClinicSettingsResp = {
  clinic: { _id: string; name: string; timezone?: string; currency?: string };
  settings: ClinicSettings;
};

// Best-effort timezone → ISO 4217 currency lookup. Exact-zone entries
// win first; if none match, we fall back to the region prefix
// ('Asia/Foo' → INR is wrong, so this only kicks in for unambiguous
// regions). The operator can always override the auto-filled value
// manually after — we never lock the currency field.
const TIMEZONE_TO_CURRENCY: Record<string, string> = {
  'Asia/Kolkata': 'INR',
  'Asia/Colombo': 'LKR',
  'Asia/Karachi': 'PKR',
  'Asia/Dhaka': 'BDT',
  'Asia/Kathmandu': 'NPR',
  'Asia/Dubai': 'AED',
  'Asia/Riyadh': 'SAR',
  'Asia/Qatar': 'QAR',
  'Asia/Singapore': 'SGD',
  'Asia/Tokyo': 'JPY',
  'Asia/Seoul': 'KRW',
  'Asia/Shanghai': 'CNY',
  'Asia/Hong_Kong': 'HKD',
  'Asia/Bangkok': 'THB',
  'Asia/Jakarta': 'IDR',
  'Asia/Manila': 'PHP',
  'Asia/Kuala_Lumpur': 'MYR',
  'Europe/London': 'GBP',
  'Europe/Berlin': 'EUR',
  'Europe/Paris': 'EUR',
  'Europe/Madrid': 'EUR',
  'Europe/Rome': 'EUR',
  'Europe/Amsterdam': 'EUR',
  'Europe/Dublin': 'EUR',
  'Europe/Zurich': 'CHF',
  'Europe/Stockholm': 'SEK',
  'Europe/Oslo': 'NOK',
  'Europe/Moscow': 'RUB',
  'Europe/Istanbul': 'TRY',
  'America/New_York': 'USD',
  'America/Chicago': 'USD',
  'America/Los_Angeles': 'USD',
  'America/Toronto': 'CAD',
  'America/Vancouver': 'CAD',
  'America/Mexico_City': 'MXN',
  'America/Sao_Paulo': 'BRL',
  'America/Buenos_Aires': 'ARS',
  'Africa/Cairo': 'EGP',
  'Africa/Johannesburg': 'ZAR',
  'Africa/Nairobi': 'KES',
  'Africa/Lagos': 'NGN',
  'Australia/Sydney': 'AUD',
  'Australia/Melbourne': 'AUD',
  'Pacific/Auckland': 'NZD',
  UTC: 'USD',
};

function currencyForTimezone(tz: string): string | null {
  if (TIMEZONE_TO_CURRENCY[tz]) {
    return TIMEZONE_TO_CURRENCY[tz];
  }

  // Region-based fallbacks for any user-selected timezones
  if (tz.startsWith('Europe/')) {
    if (tz.includes('London')) return 'GBP';
    if (tz.includes('Zurich') || tz.includes('Vaduz')) return 'CHF';
    if (tz.includes('Stockholm')) return 'SEK';
    if (tz.includes('Oslo')) return 'NOK';
    if (tz.includes('Copenhagen')) return 'DKK';
    if (tz.includes('Moscow') || tz.includes('Volgograd') || tz.includes('Kirov')) return 'RUB';
    if (tz.includes('Istanbul')) return 'TRY';
    if (tz.includes('Kiev') || tz.includes('Kyiv') || tz.includes('Uzhgorod') || tz.includes('Zaporozhye')) return 'UAH';
    if (tz.includes('Warsaw')) return 'PLN';
    if (tz.includes('Prague')) return 'CZK';
    if (tz.includes('Budapest')) return 'HUF';
    if (tz.includes('Bucharest')) return 'RON';
    if (tz.includes('Sofia')) return 'BGN';
    if (tz.includes('Reykjavik')) return 'ISK';
    return 'EUR'; // Default fallback for Eurozone countries
  }

  if (tz.startsWith('America/')) {
    if (tz.startsWith('America/Canada/') || tz.includes('Toronto') || tz.includes('Vancouver') || tz.includes('Halifax') || tz.includes('Winnipeg') || tz.includes('Edmonton') || tz.includes('St_Johns')) return 'CAD';
    if (tz.includes('Mexico_City') || tz.includes('Monterrey') || tz.includes('Tijuana') || tz.includes('Cancun')) return 'MXN';
    if (tz.includes('Sao_Paulo') || tz.includes('Rio_Branco') || tz.includes('Porto_Velho') || tz.includes('Boa_Vista') || tz.includes('Manaus') || tz.includes('Belem') || tz.includes('Araguaina') || tz.includes('Recife') || tz.includes('Bahia') || tz.includes('Fortaleza') || tz.includes('Maceio')) return 'BRL';
    if (tz.includes('Buenos_Aires') || tz.includes('Cordoba') || tz.includes('Jujuy') || tz.includes('Mendoza') || tz.includes('Catamarca') || tz.includes('La_Rioja') || tz.includes('San_Juan') || tz.includes('San_Luis') || tz.includes('Tucuman') || tz.includes('Salta')) return 'ARS';
    if (tz.includes('Santiago') || tz.includes('Easter')) return 'CLP';
    if (tz.includes('Bogota')) return 'COP';
    if (tz.includes('Lima')) return 'PEN';
    if (tz.includes('Caracas')) return 'VES';
    if (tz.includes('Montevideo')) return 'UYU';
    if (tz.includes('Asuncion')) return 'PYG';
    if (tz.includes('La_Paz')) return 'BOB';
    if (tz.includes('Quito') || tz.includes('Panama') || tz.includes('San_Salvador')) return 'USD';
    return 'USD'; // Default fallback for US/Americas
  }

  if (tz.startsWith('Australia/')) {
    return 'AUD';
  }

  if (tz.startsWith('Pacific/')) {
    if (tz.includes('Auckland') || tz.includes('Chatham')) return 'NZD';
    if (tz.includes('Honolulu')) return 'USD';
    return 'USD';
  }

  if (tz.startsWith('Asia/')) {
    if (tz.includes('Kolkata') || tz.includes('Calcutta')) return 'INR';
    if (tz.includes('Colombo')) return 'LKR';
    if (tz.includes('Karachi')) return 'PKR';
    if (tz.includes('Dhaka')) return 'BDT';
    if (tz.includes('Kathmandu') || tz.includes('Katmandu')) return 'NPR';
    if (tz.includes('Dubai') || tz.includes('Abu_Dhabi')) return 'AED';
    if (tz.includes('Riyadh')) return 'SAR';
    if (tz.includes('Qatar') || tz.includes('Doha')) return 'QAR';
    if (tz.includes('Singapore')) return 'SGD';
    if (tz.includes('Tokyo')) return 'JPY';
    if (tz.includes('Seoul')) return 'KRW';
    if (tz.includes('Shanghai') || tz.includes('Urumqi')) return 'CNY';
    if (tz.includes('Hong_Kong')) return 'HKD';
    if (tz.includes('Bangkok')) return 'THB';
    if (tz.includes('Jakarta') || tz.includes('Pontianak') || tz.includes('Makassar') || tz.includes('Jayapura')) return 'IDR';
    if (tz.includes('Manila')) return 'PHP';
    if (tz.includes('Kuala_Lumpur') || tz.includes('Kuching')) return 'MYR';
    if (tz.includes('Taipei')) return 'TWD';
    if (tz.includes('Jerusalem') || tz.includes('Tel_Aviv')) return 'ILS';
  }

  return null;
}

type SettingsTab = 'clinic' | 'branches' | 'availability' | 'notif_cfg' | 'audit' | 'about';

// `perm` of `null` = visible to any signed-in user.
type NavItem = { id: SettingsTab; label: string; icon: IconName; perm: PermName | null };

// Each tab is gated by its own dedicated `settings:*:read` permission
// so the Super Admin can toggle tab visibility per role from the
// Roles & Permissions screen without touching the underlying data
// permissions that gate the tab's body content. The body itself still
// reads ClinicWrite / BranchWrite / NotificationWrite / AuditRead the
// way it always did — so e.g. granting SettingsClinicRead opens the
// tab but the form stays read-only until ClinicWrite is also granted.
const NAV: NavItem[] = [
  { id: 'clinic', label: 'Clinic', icon: 'cross', perm: Perm.SettingsClinicRead },
  { id: 'branches', label: 'Branches', icon: 'mapPin', perm: Perm.SettingsBranchesRead },
  { id: 'availability', label: 'Availability', icon: 'clock', perm: Perm.SettingsAvailabilityRead },
  { id: 'notif_cfg', label: 'Quiet hours', icon: 'bell', perm: Perm.SettingsNotificationsRead },
  { id: 'audit', label: 'Audit log', icon: 'scroll', perm: Perm.SettingsAuditRead },
  { id: 'about', label: 'About', icon: 'info', perm: null },
];

export function SettingsScreen() {
  const { permissions, roleNames } = useApp();
  // Doctors manage availability from a dedicated sidebar screen, so the
  // Availability tab is removed from their Settings.
  const isDoctor = roleNames.has('doctor');
  const visibleNav = useMemo(
    () => NAV.filter((n) =>
      (n.perm === null || permissions.has(n.perm)) &&
      !(isDoctor && n.id === 'availability'),
    ),
    [permissions, isDoctor],
  );

  const [tab, setTab] = useState<SettingsTab>(visibleNav[0]?.id ?? 'about');

  // If permissions change so the active tab is no longer visible, pick the
  // first visible one. Prevents a doctor from staring at an empty page if an
  // admin revokes a role mid-session.
  useEffect(() => {
    if (!visibleNav.find((n) => n.id === tab)) {
      const next = visibleNav[0]?.id;
      if (next) setTab(next);
    }
  }, [visibleNav, tab]);

  const activeAllowed = visibleNav.some((n) => n.id === tab);

  return (
    <div style={{ display: 'flex', height: '100%', alignItems: 'flex-start' }}>
      <div style={{
        position: 'sticky', top: 0, alignSelf: 'flex-start',
        width: 220, flexShrink: 0,
        height: '100%', overflowY: 'auto',
        borderRight: '1px solid var(--border)', padding: '16px 8px',
        display: 'flex', flexDirection: 'column', gap: 2,
        background: 'var(--surface)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 10px 8px' }}>Settings</div>
        {visibleNav.map((item) => (
          <button key={item.id} onClick={() => setTab(item.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: 'none', background: tab === item.id ? 'var(--brand-50)' : 'transparent', borderRadius: 9, cursor: 'pointer', color: tab === item.id ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 13, fontWeight: tab === item.id ? 600 : 400, textAlign: 'left', borderLeft: tab === item.id ? '3px solid var(--brand-500)' : '3px solid transparent' }}>
            <Icon name={item.icon} size={15} style={{ color: tab === item.id ? 'var(--brand-500)' : 'inherit', flexShrink: 0 }} />
            {item.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minWidth: 0, padding: tab === 'audit' ? '0' : '24px 32px', height: '100%', overflow: tab === 'audit' ? 'hidden' : 'auto' }}>
        <div key={tab} style={{ animation: 'slideUp 160ms ease-out', maxWidth: tab === 'audit' ? 'none' : 800, margin: tab === 'audit' ? '0' : undefined, height: tab === 'audit' ? '100%' : 'auto', display: tab === 'audit' ? 'flex' : 'block', flexDirection: 'column' }}>
          {tab !== 'audit' && (
            <h2 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 20 }}>
              {visibleNav.find((n) => n.id === tab)?.label}
            </h2>
          )}
          {activeAllowed && tab === 'clinic' && <ClinicTab />}
          {activeAllowed && tab === 'branches' && <BranchesTab />}
          {activeAllowed && tab === 'availability' && <AvailabilityTab />}
          {activeAllowed && tab === 'notif_cfg' && <NotifConfigTab />}
          {activeAllowed && tab === 'audit' && <AuditTab />}
          {activeAllowed && tab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  );
}

// Standalone Availability screen — same editor as the Settings tab, but
// rendered as its own top-level page (used by doctors via the sidebar).
export function AvailabilityScreen() {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: '24px 32px', height: '100%', overflow: 'auto' }}>
      <div style={{ maxWidth: 800 }}>
        <h2 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 20 }}>Availability</h2>
        <AvailabilityTab />
      </div>
    </div>
  );
}

function TimezoneDropdown({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (tz: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const allTimezones = useMemo(() => {
    let zones: string[] = [];
    try {
      zones = Intl.supportedValuesOf('timeZone');
    } catch {
      zones = [
        'Asia/Kolkata',
        'Asia/Colombo',
        'Asia/Karachi',
        'Asia/Dhaka',
        'Asia/Kathmandu',
        'Asia/Dubai',
        'Asia/Riyadh',
        'Asia/Qatar',
        'Asia/Singapore',
        'Asia/Tokyo',
        'Asia/Seoul',
        'Asia/Shanghai',
        'Asia/Hong_Kong',
        'Asia/Bangkok',
        'Asia/Jakarta',
        'Asia/Manila',
        'Asia/Kuala_Lumpur',
        'Europe/London',
        'Europe/Berlin',
        'Europe/Paris',
        'Europe/Madrid',
        'Europe/Rome',
        'Europe/Amsterdam',
        'Europe/Dublin',
        'Europe/Zurich',
        'Europe/Stockholm',
        'Europe/Oslo',
        'Europe/Moscow',
        'Europe/Istanbul',
        'America/New_York',
        'America/Chicago',
        'America/Los_Angeles',
        'America/Toronto',
        'America/Vancouver',
        'America/Mexico_City',
        'America/Sao_Paulo',
        'America/Buenos_Aires',
        'Africa/Cairo',
        'Africa/Johannesburg',
        'Africa/Nairobi',
        'Africa/Lagos',
        'Australia/Sydney',
        'Australia/Melbourne',
        'Pacific/Auckland',
        'UTC',
      ];
    }
    const mapped = zones.map((tz) => {
      if (tz === 'Asia/Calcutta') return 'Asia/Kolkata';
      if (tz === 'Asia/Katmandu') return 'Asia/Kathmandu';
      return tz;
    });
    const unique = Array.from(new Set(mapped));
    return unique.filter((tz) => currencyForTimezone(tz) !== null);
  }, []);

  const filtered = useMemo(() => {
    const queryNormalized = search.toLowerCase().trim();
    if (!queryNormalized) return allTimezones;

    // Split search query into tokens/words
    const tokens = queryNormalized.split(/\s+/).filter(Boolean);

    return allTimezones.filter((tz) => {
      // Normalize timezone: replace slashes (/), underscores (_), and dashes (-) with spaces
      let tzNormalized = tz.toLowerCase().replace(/[\/_]/g, ' ');
      // Alias handling for standard IANA zones:
      if (tzNormalized.includes('calcutta')) tzNormalized += ' kolkata';
      if (tzNormalized.includes('katmandu')) tzNormalized += ' kathmandu';
      if (tzNormalized.includes('saigon')) tzNormalized += ' ho chi minh';
      
      // Every search token must be found in the normalized timezone name
      return tokens.every((token) => tzNormalized.includes(token));
    });
  }, [search, allTimezones]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen(!open);
          setSearch('');
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          height: 40,
          padding: '0 12px',
          background: 'var(--surface-muted)',
          border: '1.5px solid var(--border)',
          borderRadius: 10,
          fontSize: 13,
          color: value ? 'var(--text)' : 'var(--text-subtle)',
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          outline: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{value || 'Select timezone…'}</span>
          {value && currencyForTimezone(value) && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--brand-600)', background: 'var(--brand-50)', padding: '1px 5px', borderRadius: 4, border: '1px solid var(--brand-100)', fontVariantNumeric: 'tabular-nums' }}>
              {currencyForTimezone(value)}
            </span>
          )}
        </div>
        <Icon
          name="chevronDown"
          size={14}
          style={{
            color: 'var(--text-subtle)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
          }}
        />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 100,
            marginTop: 6,
            background: 'var(--surface)',
            border: '1.5px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: 8,
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <Icon name="search" size={12} style={{ color: 'var(--text-subtle)', marginLeft: 4 }} />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search timezones..."
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: 12,
                color: 'var(--text)',
                padding: '4px 0',
              }}
            />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', padding: 4 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center' }}>
                No timezones found
              </div>
            ) : (
              filtered.map((tz) => (
                <button
                  key={tz}
                  type="button"
                  onClick={() => {
                    onChange(tz);
                    setOpen(false);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '8px 12px',
                    border: 'none',
                    borderRadius: 6,
                    background: value === tz ? 'var(--brand-50)' : 'transparent',
                    color: value === tz ? 'var(--brand-600)' : 'var(--text)',
                    fontSize: 12.5,
                    fontWeight: value === tz ? 600 : 400,
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (value !== tz) {
                      e.currentTarget.style.background = 'var(--surface-muted)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (value !== tz) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <span>{tz}</span>
                    {currencyForTimezone(tz) && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: value === tz ? 'var(--brand-600)' : 'var(--text-subtle)', background: value === tz ? 'var(--brand-100)' : 'var(--surface-muted)', padding: '1px 5px', borderRadius: 4 }}>
                        {currencyForTimezone(tz)}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ClinicTab() {
  const { ctx, permissions, roleNames, refreshMe } = useApp();
  const toast = useToast();
  const canRead = permissions.has('clinic:read');
  const canWrite = permissions.has('clinic:write');
  // The clinic NAME is editable only by Manager / Super Admin (enforced
  // on the backend too). Other clinic settings still need clinic:write.
  const canEditName = roleNames.has('manager') || roleNames.has('super admin');
  const [data, setData] = useState<ClinicSettingsResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Profile fields
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [currency, setCurrency] = useState('');

  // Appointments
  const [apptMode, setApptMode] = useState<'TIME' | 'QUEUE' | 'BOTH'>('BOTH');
  const [slotMinutes, setSlotMinutes] = useState('15');

  // Branding
  const [displayName, setDisplayName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');

  // Modules
  const [faceRecognitionEnabled, setFaceRecognitionEnabled] = useState(false);

  // Logo upload state. `logoTick` is bumped after each upload/remove so
  // the <img> preview's `?v=` query forces the browser to refetch
  // rather than serving a stale cached copy of the previous logo.
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoTick, setLogoTick] = useState(0);

  const [saving, setSaving] = useState(false);

  function settingsPath() {
    return `/clinics/${encodeURIComponent(ctx.clinicId)}/settings`;
  }

  function hydrate(res: ClinicSettingsResp) {
    setData(res);
    setName(res.clinic.name ?? '');
    setTimezone(res.clinic.timezone ?? '');
    setCurrency(res.clinic.currency ?? '');
    setApptMode(res.settings.appointments?.mode ?? 'BOTH');
    setSlotMinutes(String(res.settings.appointments?.slotMinutesDefault ?? 15));
    setDisplayName(res.settings.branding?.displayName ?? '');
    setLogoUrl(res.settings.branding?.logoUrl ?? '');
    setPrimaryColor(res.settings.branding?.primaryColor ?? '');
    setFaceRecognitionEnabled(res.settings.modules?.faceRecognition?.enabled ?? false);
  }

  async function load() {
    if (!ctx.clinicId) { setError('No clinic in context.'); return; }
    setLoading(true); setError(null);
    try {
      const res = await apiGet<ClinicSettingsResp>(ctx, settingsPath());
      hydrate(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (canRead) void load(); }, [canRead, ctx.clinicId]);

  const isDirty = useMemo(() => {
    if (!data) return false;
    return (
      name.trim() !== (data.clinic.name ?? '') ||
      timezone !== (data.clinic.timezone ?? '') ||
      currency.toUpperCase() !== (data.clinic.currency ?? '') ||
      apptMode !== (data.settings.appointments?.mode ?? 'BOTH') ||
      slotMinutes !== String(data.settings.appointments?.slotMinutesDefault ?? 15) ||
      displayName.trim() !== (data.settings.branding?.displayName ?? '') ||
      logoUrl.trim() !== (data.settings.branding?.logoUrl ?? '') ||
      primaryColor.trim() !== (data.settings.branding?.primaryColor ?? '') ||
      faceRecognitionEnabled !== (data.settings.modules?.faceRecognition?.enabled ?? false)
    );
  }, [data, name, timezone, currency, apptMode, slotMinutes, displayName, logoUrl, primaryColor, faceRecognitionEnabled]);

  // Logo upload is the only field that commits immediately (multipart
  // uploads don't queue cleanly), but we DELIBERATELY do not call full
  // hydrate() here — that would clobber the user's pending edits to
  // every other field, which feels like "everything got auto-saved"
  // even when the user hasn't clicked Save. We only update the
  // logo-related state and patch the saved-snapshot so isDirty stays
  // correct.
  function applyLogoResponse(next: ClinicSettingsResp) {
    const nextLogo = next.settings.branding?.logoUrl ?? '';
    setLogoUrl(nextLogo);
    setData((prev) =>
      prev
        ? {
            ...prev,
            settings: {
              ...prev.settings,
              branding: {
                displayName: prev.settings.branding?.displayName ?? null,
                logoUrl: nextLogo || null,
                primaryColor: prev.settings.branding?.primaryColor ?? null,
              },
            },
          }
        : prev,
    );
    setLogoTick((t) => t + 1);
  }

  async function handleLogoFile(file: File | null) {
    if (!file || !data) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setLogoError('Use a PNG, JPG, or WebP image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError('Logo must be 2 MB or smaller.');
      return;
    }
    setLogoError(null);
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const next = await apiPostMultipart<ClinicSettingsResp>(
        ctx,
        `/clinics/${encodeURIComponent(data.clinic._id)}/logo`,
        fd,
      );
      applyLogoResponse(next);
      toast('Logo uploaded', 'success');
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : String(e));
    } finally {
      setLogoUploading(false);
    }
  }

  async function removeLogo() {
    if (!data) return;
    setLogoUploading(true);
    setLogoError(null);
    try {
      const next = await apiDelete<ClinicSettingsResp>(
        ctx,
        `/clinics/${encodeURIComponent(data.clinic._id)}/logo`,
      );
      applyLogoResponse(next);
      toast('Logo removed', 'success');
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : String(e));
    } finally {
      setLogoUploading(false);
    }
  }

  async function save() {
    if (!isDirty) return;
    setSaving(true); setError(null);
    try {
      // logoUrl is intentionally omitted here — it's managed by the
      // dedicated POST/DELETE /clinics/:id/logo endpoints which write
      // the S3 key straight to the clinic doc. Including it in this
      // PATCH would hit the URL-validator and reject any uploaded-logo
      // value ("branding.logoUrl must be a URL address").
      // Clinic NAME + branding DISPLAY NAME are the clinic's identity and
      // are edited via a dedicated, role-gated endpoint (Manager / Super
      // Admin only). They are NOT sent in the general settings PATCH —
      // the backend ignores them there.
      const nameChanged = name.trim() && name.trim() !== data?.clinic.name;
      const displayNameChanged = displayName.trim() !== (data?.settings.branding?.displayName ?? '');
      if ((nameChanged || displayNameChanged) && canEditName) {
        const identity: Record<string, unknown> = {};
        if (nameChanged) identity.name = name.trim();
        if (displayNameChanged) identity.displayName = displayName.trim() || null;
        await apiPatch(ctx, `/clinics/${encodeURIComponent(ctx.clinicId)}/identity`, identity);
      }

      const newCurrency = currency.trim().toUpperCase();
      const isCurrencyChanged = newCurrency && newCurrency !== data?.clinic.currency;

      // The rest of the clinic settings require clinic:write. A Manager
      // (no clinic:write) can still rename above; we just skip this PATCH
      // for them and re-fetch to refresh the view.
      let updated: ClinicSettingsResp;
      if (canWrite) {
        const body: Record<string, unknown> = {
          appointments: { mode: apptMode, slotMinutesDefault: Number(slotMinutes) || 15 },
          // displayName is handled by the role-gated identity endpoint above.
          branding: {
            primaryColor: primaryColor.trim() || null,
          },
          modules: {
            faceRecognition: { enabled: faceRecognitionEnabled },
          },
        };
        if (timezone.trim() && timezone.trim() !== data?.clinic.timezone) body.timezone = timezone.trim();
        if (isCurrencyChanged) body.currency = newCurrency;
        updated = await apiPatch<ClinicSettingsResp>(ctx, settingsPath(), body);
      } else {
        updated = await apiGet<ClinicSettingsResp>(ctx, settingsPath());
      }
      hydrate(updated);

      if (isCurrencyChanged && ctx.userId) {
        setDetectedCurrency(ctx.userId, newCurrency);
      }

      void refreshMe();
      if (ctx.clinicId) {
        localStorage.setItem('digirx.settings_manually_set_' + ctx.clinicId, 'true');
      }
      toast('Clinic settings saved', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!canRead) return <PermissionGate perm="clinic:read" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {loading && <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading…</div>}
      {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}

      {data && (
        <>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Clinic profile</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Name" value={name} onChange={setName} placeholder="Demo Clinic" disabled={!canEditName} />
              <div>
                <label style={labelStyle}>Timezone (IANA)</label>
                <TimezoneDropdown
                  value={timezone}
                  disabled={!canWrite}
                  onChange={(next) => {
                    setTimezone(next);
                    const mapped = currencyForTimezone(next);
                    if (mapped) setCurrency(mapped);
                  }}
                />
              </div>
              <div>
                <Field label="Currency (ISO 4217)" value={currency} onChange={(v) => setCurrency(v.toUpperCase())} placeholder="INR" />
                {currencyForTimezone(timezone) && currency !== currencyForTimezone(timezone) && (
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-subtle)' }}>
                    Auto-suggested <code style={{ fontFamily: 'monospace' }}>{currencyForTimezone(timezone)}</code> for {timezone} —
                    {' '}
                    <button type="button" onClick={() => setCurrency(currencyForTimezone(timezone)!)}
                      style={{ background: 'none', border: 'none', color: 'var(--brand-500)', fontWeight: 600, fontSize: 11, cursor: 'pointer', padding: 0 }}>
                      use it
                    </button>
                  </div>
                )}
              </div>
              {/* <Row label="Clinic ID">
                <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{data.clinic._id}</code>
              </Row> */}
            </div>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Branding</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Display name" value={displayName} onChange={setDisplayName} placeholder="Shown on prescriptions & receipts" disabled={!canEditName} />
              <div>
                <label style={labelStyle}>Logo</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10 }}>
                  {/* Preview. When `logoUrl` is a legacy http(s) URL we
                      use it directly; otherwise it's an S3 key and we
                      read through the BE's /clinics/:id/logo endpoint
                      (which is public so the <img> works without auth
                      header juggling). */}
                  <div style={{ width: 72, height: 72, borderRadius: 10, background: 'var(--surface)', border: '1.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
                    {logoUrl && data?.clinic._id ? (
                      <img
                        // `logoTick` is part of the key so React tears
                        // the <img> down + remounts on every upload,
                        // which forces a fresh fetch even when the
                        // URL (sans query) didn't change.
                        key={`logo-${logoTick}`}
                        src={
                          /^https?:\/\//i.test(logoUrl)
                            ? logoUrl
                            : `${ctx.apiBaseUrl}/clinics/${data.clinic._id}/logo?v=${logoTick}`
                        }
                        alt="Clinic logo"
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                      />
                    ) : (
                      <Icon name="folder" size={22} style={{ color: 'var(--text-subtle)', opacity: 0.5 }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                      PNG, JPG, or WebP — up to 2 MB. Shown on prescriptions and receipts.
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <label style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        height: 32, padding: '0 12px', borderRadius: 8,
                        background: 'var(--brand-500)', color: 'var(--brand-text)',
                        fontSize: 12, fontWeight: 600,
                        cursor: canWrite && !logoUploading ? 'pointer' : 'not-allowed',
                        opacity: canWrite && !logoUploading ? 1 : 0.6,
                      }}>
                        {logoUploading ? <Spinner /> : <Icon name="upload" size={12} strokeWidth={2.5} />}
                        {logoUrl ? 'Replace' : 'Upload'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          disabled={!canWrite || logoUploading}
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            // Reset value so picking the same file
                            // twice in a row still fires onChange.
                            e.currentTarget.value = '';
                            void handleLogoFile(f);
                          }}
                          style={{ display: 'none' }}
                        />
                      </label>
                      {logoUrl && (
                        <button type="button" onClick={() => void removeLogo()}
                          disabled={!canWrite || logoUploading}
                          style={{
                            height: 32, padding: '0 12px', borderRadius: 8,
                            background: 'none', border: '1.5px solid var(--border)',
                            color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
                            cursor: canWrite && !logoUploading ? 'pointer' : 'not-allowed',
                          }}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {logoError && (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--danger-500)' }}>{logoError}</div>
                )}
              </div>
              <div>
                <label style={labelStyle}>Primary color</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="color" value={primaryColor || '#3b82f6'} onChange={(e) => setPrimaryColor(e.target.value)}
                    disabled={!canWrite}
                    style={{ width: 44, height: 40, border: '1.5px solid var(--border)', borderRadius: 10, background: 'var(--surface-muted)', cursor: canWrite ? 'pointer' : 'not-allowed', padding: 2 }} />
                  <input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} disabled={!canWrite} placeholder="#3B82F6"
                    style={{ flex: 1, height: 40, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'monospace', opacity: canWrite ? 1 : 0.6 }} />
                  {primaryColor && (
                    <button onClick={() => setPrimaryColor('')} disabled={!canWrite}
                      style={{ height: 40, padding: '0 12px', background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, color: 'var(--text-subtle)', fontSize: 12, cursor: canWrite ? 'pointer' : 'not-allowed' }}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Appointments</div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 12 }}>
              <strong>Time</strong> = scheduled time slots only.
              <strong> Queue</strong> = walk-in tokens only.
              <strong> Both</strong> = front desk picks per booking.
            </div>
            <div>
              <label style={labelStyle}>Mode</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['TIME', 'QUEUE', 'BOTH'] as const).map((m) => (
                  <button key={m} onClick={() => setApptMode(m)} disabled={!canWrite}
                    style={{ flex: 1, padding: '8px 0', border: `1.5px solid ${apptMode === m ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 10, background: apptMode === m ? 'var(--brand-50)' : 'var(--surface-muted)', color: apptMode === m ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: canWrite ? 'pointer' : 'not-allowed', opacity: canWrite ? 1 : 0.6 }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Modules</div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, cursor: canWrite ? 'pointer' : 'not-allowed', opacity: canWrite ? 1 : 0.7 }}>
              <input type="checkbox" checked={faceRecognitionEnabled}
                onChange={(e) => setFaceRecognitionEnabled(e.target.checked)}
                disabled={!canWrite}
                style={{ marginTop: 2, accentColor: 'var(--brand-500)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Face recognition</div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2, lineHeight: 1.45 }}>
                  Allows the front desk to enroll a patient's face at registration and identify returning patients during booking. Requires the <code style={{ fontFamily: 'monospace' }}>face-svc</code> sidecar to be running and roles to have the <code style={{ fontFamily: 'monospace' }}>face:enroll</code> / <code style={{ fontFamily: 'monospace' }}>face:recognize</code> permissions.
                </div>
              </div>
            </label>
          </div>

          {canWrite ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={save} disabled={saving || !isDirty}
                style={{
                  height: 40, padding: '0 28px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  cursor: (saving || !isDirty) ? (saving ? 'wait' : 'not-allowed') : 'pointer',
                  opacity: (saving || !isDirty) ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s'
                }}>
                {saving ? <Spinner /> : 'Save all changes'}
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
              You don't have <code>clinic:write</code> to modify settings.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Availability tab ----------

type AvailabilityWindow = { startMinutes: number; endMinutes: number };
type WeeklyRule = {
  weekday: number;
  windows: AvailabilityWindow[];
  slotMinutes?: number;
  active: boolean;
};
type OverrideType = 'CLOSED' | 'CUSTOM_WINDOWS' | 'BLOCKED_WINDOWS';
type DoctorOverride = {
  _id?: string;
  date: string;
  type: OverrideType;
  windows?: AvailabilityWindow[];
  note?: string;
  // Populated by the BE on the response to PUT/PATCH whenever the
  // override save triggered an auto-reschedule cascade. Lets the FE
  // surface a "N appointment(s) moved" toast without an extra fetch.
  _rescheduled?: {
    rescheduled: Array<{ appointmentId: string; patientName: string; newStartAt: string }>;
    failed: Array<{ appointmentId: string; reason: string }>;
  };
};
type DaySlots = {
  timezone: string;
  date: string;
  slotMinutes: number;
  slots: { startAt: string; endAt: string }[];
};
type VisitTypeRow = {
  _id: string;
  clinicId: string;
  doctorUserId: string;
  name: string;
  price: number;
  currency: string;
  active: boolean;
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function fromHHMM(s: string): number {
  const [h, m] = s.split(':').map((x) => Number(x) || 0);
  return Math.max(0, Math.min(24 * 60, h * 60 + m));
}
function emptyRule(weekday: number): WeeklyRule {
  return { weekday, windows: [], slotMinutes: 15, active: false };
}

function AvailabilityTab() {
  const { ctx, permissions, roleNames } = useApp();
  const toast = useToast();
  const canRead = permissions.has('clinic:read');
  const canWrite = permissions.has('clinic:write');
  // Doctors are locked to their own availability — they can't open
  // the doctor dropdown or load anyone else's schedule, even if some
  // other permission would otherwise allow it. This is a role gate
  // on top of the permission gate.
  const isDoctor = roleNames.has('doctor');
  const canEditOthers = canWrite && !isDoctor;

  const [doctorId, setDoctorId] = useState(ctx.userId);
  // Admin can save anyone's; non-admin can save only when editing themselves.
  // The backend enforces the same rule, this just keeps the UI honest.
  const canWriteThis = canWrite || doctorId === ctx.userId;

  // If perms change to non-admin mid-session, snap selection back to self.
  useEffect(() => {
    if (!canEditOthers && doctorId !== ctx.userId) {
      setDoctorId(ctx.userId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEditOthers, ctx.userId]);
  const [doctors, setDoctors] = useState<Array<{ _id: string; name: string; email?: string }>>([]);
  const [rules, setRules] = useState<WeeklyRule[]>(() => Array.from({ length: 7 }, (_, i) => emptyRule(i)));
  const [originalRules, setOriginalRules] = useState<WeeklyRule[] | null>(null);
  const [overrides, setOverrides] = useState<DoctorOverride[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [overrideDate, setOverrideDate] = useState('');
  const [overrideType, setOverrideType] = useState<OverrideType>('CLOSED');
  const [overrideWindows, setOverrideWindows] = useState<AvailabilityWindow[]>([]);
  const [overrideNote, setOverrideNote] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  const [previewDate, setPreviewDate] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<DaySlots | null>(null);

  // Per-doctor visit-type (consultation pricing) catalog. Each row drives
  // the BookSheet picker and, when chosen at booking time, the BE auto-
  // issues a SERVICE bill of `price` linked to the appointment.
  const [visitTypes, setVisitTypes] = useState<VisitTypeRow[]>([]);
  const [vtName, setVtName] = useState('');
  const [vtPrice, setVtPrice] = useState('');
  const [vtSaving, setVtSaving] = useState(false);
  const [vtError, setVtError] = useState<string | null>(null);

  function branchQs() {
    return ctx.branchId ? `?branchId=${encodeURIComponent(ctx.branchId)}` : '';
  }

  async function load() {
    if (!ctx.branchId) { setError('Set a branch (sign in to a branch) to manage availability.'); return; }
    if (!doctorId.trim()) { setError('Enter a doctor user ID.'); return; }
    setLoading(true); setError(null);
    try {
      const [rulesResp, overridesResp] = await Promise.all([
        apiGet<WeeklyRule[]>(ctx, `/availability/doctors/${doctorId.trim()}/rules${branchQs()}`),
        apiGet<DoctorOverride[]>(ctx, `/availability/doctors/${doctorId.trim()}/overrides${branchQs()}`),
      ]);
      // Merge into a 7-day editable grid
      const next: WeeklyRule[] = Array.from({ length: 7 }, (_, i) => emptyRule(i));
      for (const r of rulesResp) {
        if (r.weekday >= 0 && r.weekday <= 6) {
          next[r.weekday] = {
            weekday: r.weekday,
            windows: (r.windows ?? []).map((w) => ({ startMinutes: w.startMinutes, endMinutes: w.endMinutes })),
            slotMinutes: r.slotMinutes ?? 15,
            active: r.active ?? true,
          };
        }
      }
      setRules(next);
      setOriginalRules(JSON.parse(JSON.stringify(next))); // Deep copy for dirty check
      setOverrides(overridesResp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Auto-load whenever the selected doctor (or branch) changes — no manual
  // "Load" click needed. `doctorId` in the deps is what makes picking a
  // user from the dropdown immediately pull their schedule.
  useEffect(() => {
    if (canRead && doctorId.trim() && ctx.branchId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, ctx.branchId, doctorId]);

  // Pull the user list so we can show doctor names instead of raw ObjectIds.
  // Falls back gracefully if the caller lacks user:read.
  useEffect(() => {
    if (!canRead) return;
    apiGet<Array<{ _id: string; name: string; email?: string }>>(ctx, '/users')
      .then((list) => setDoctors(list))
      .catch(() => setDoctors([]));
  }, [ctx.clinicId, ctx.accessToken, canRead]);

  function updateRule(weekday: number, patch: Partial<WeeklyRule>) {
    setRules((rs) => rs.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)));
  }

  /**
   * Broadcasts a single weekday's hours to every weekday in `targets`.
   * Wires the bulk-apply buttons in each row — the most common case is
   * "set Monday's 09:00–18:00 then click 'Apply to all 7'." Without this
   * the operator has to fill seven rows manually and forgetting one
   * leaves a hidden "this weekday isn't covered" landmine.
   */
  function copyRuleTo(sourceWeekday: number, targets: number[]) {
    const source = rules.find((r) => r.weekday === sourceWeekday);
    if (!source) return;
    const targetSet = new Set(targets.filter((t) => t !== sourceWeekday));
    setRules((rs) =>
      rs.map((r) =>
        targetSet.has(r.weekday)
          ? {
            weekday: r.weekday,
            // Deep-clone the windows so editing a target row later
            // doesn't mutate the source's array too.
            windows: source.windows.map((w) => ({ ...w })),
            slotMinutes: source.slotMinutes,
            active: source.active,
          }
          : r,
      ),
    );
  }

  const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
  const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];
  const WEEKEND = [0, 6];

  const rulesDirty = useMemo(() => {
    if (!originalRules) return false;
    return JSON.stringify(rules) !== JSON.stringify(originalRules);
  }, [rules, originalRules]);

  async function saveRules() {
    setSaving(true); setError(null);
    try {
      // Send only active rules with at least one window — others are no-ops on the BE,
      // but we explicitly include all 7 weekdays to avoid stale rules sticking around.
      const body = {
        rules: rules.map((r) => ({
          weekday: r.weekday,
          windows: r.active ? r.windows : [],
          slotMinutes: r.slotMinutes ?? 15,
          active: r.active,
        })),
      };
      await apiPut<WeeklyRule[]>(ctx, `/availability/doctors/${doctorId.trim()}/rules${branchQs()}`, body);
      // Rule changes can invalidate open slot pickers / day views.
      emitAvailabilityChanged();
      toast('Weekly rules saved', 'success');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveOverride() {
    if (!overrideDate) { setError('Pick an override date.'); return; }
    setSavingOverride(true); setError(null);
    try {
      const body: Record<string, unknown> = { type: overrideType, note: overrideNote || undefined };
      // Both window-bearing types ship the windows; CLOSED carries nothing.
      if (overrideType === 'CUSTOM_WINDOWS' || overrideType === 'BLOCKED_WINDOWS') {
        body.windows = overrideWindows;
      }
      const saved = await apiPut<DoctorOverride>(ctx, `/availability/doctors/${doctorId.trim()}/overrides/${overrideDate}${branchQs()}`, body);
      // Tell open screens (Appointments day view, booking slot picker)
      // to refetch — the override likely invalidates the slots they
      // were last showing.
      emitAvailabilityChanged();
      const movedCount = saved._rescheduled?.rescheduled.length ?? 0;
      const failedCount = saved._rescheduled?.failed.length ?? 0;
      if (movedCount > 0) {
        toast(
          `Override saved · ${movedCount} appointment(s) rescheduled${failedCount > 0 ? ` (${failedCount} could not be moved)` : ''}`,
          'success',
        );
      } else if (failedCount > 0) {
        toast(
          `Override saved · ${failedCount} appointment(s) need manual reschedule (no free slot found)`,
          'info',
        );
      } else {
        toast(`Override saved for ${overrideDate}`, 'success');
      }
      setOverrideDate(''); setOverrideType('CLOSED'); setOverrideWindows([]); setOverrideNote('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingOverride(false);
    }
  }

  // Load an existing override into the editor above so the operator can
  // tweak its date / type / windows / note and re-save. The PUT endpoint
  // is upsert-by-date, so saving with the same date overwrites the row.
  function editOverride(o: DoctorOverride) {
    setOverrideDate(o.date);
    setOverrideType(
      o.type === 'CUSTOM_WINDOWS' || o.type === 'BLOCKED_WINDOWS' ? o.type : 'CLOSED',
    );
    setOverrideWindows(
      o.type === 'CUSTOM_WINDOWS' || o.type === 'BLOCKED_WINDOWS'
        ? (o.windows ?? [])
        : [],
    );
    setOverrideNote(o.note ?? '');
    setError(null);
  }

  async function removeOverride(o: DoctorOverride) {
    if (!canWriteThis) return;
    // Plain confirm() is consistent with other destructive actions in
    // the codebase; a styled confirm modal would be a larger refactor.
    if (!window.confirm(`Remove override for ${o.date}? The day will revert to the weekly schedule.`)) {
      return;
    }
    setError(null);
    try {
      await apiDelete(ctx, `/availability/doctors/${doctorId.trim()}/overrides/${o.date}${branchQs()}`);
      // Same signal as save — the day reverts to weekly rules and any
      // open slot picker should refetch.
      emitAvailabilityChanged();
      toast(`Override removed for ${o.date}`, 'success');
      // If the editor was showing this same date, clear it so the user
      // doesn't accidentally re-save the row they just deleted.
      if (overrideDate === o.date) {
        setOverrideDate(''); setOverrideType('CLOSED'); setOverrideWindows([]); setOverrideNote('');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runPreview() {
    if (!previewDate) { setError('Pick a date to preview.'); return; }
    setPreviewing(true); setError(null);
    try {
      const data = await apiGet<DaySlots>(ctx, `/availability/doctors/${doctorId.trim()}/day${branchQs()}&date=${previewDate}`);
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  // --- Visit-types (per-doctor consultation pricing) ---
  // Refetch whenever the active doctor changes. BE owns the
  // "admin OR self" ownership rule for mutations.
  useEffect(() => {
    if (!doctorId.trim()) { setVisitTypes([]); return; }
    let cancelled = false;
    apiGet<VisitTypeRow[]>(ctx, `/visit-types?doctorId=${encodeURIComponent(doctorId.trim())}&includeInactive=true`)
      .then((r) => { if (!cancelled) setVisitTypes(r); })
      .catch(() => { if (!cancelled) setVisitTypes([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId, ctx.clinicId, ctx.accessToken]);

  async function addVisitType() {
    setVtError(null);
    const name = vtName.trim();
    const priceNum = Number(vtPrice);
    if (!name) { setVtError('Name is required.'); return; }
    if (!Number.isFinite(priceNum) || priceNum < 0) { setVtError('Price must be a non-negative number.'); return; }
    setVtSaving(true);
    try {
      const created = await apiPost<VisitTypeRow>(ctx, '/visit-types', {
        doctorUserId: doctorId.trim(),
        name,
        price: priceNum,
      });
      setVisitTypes((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setVtName(''); setVtPrice('');
    } catch (e) {
      setVtError(e instanceof Error ? e.message : String(e));
    } finally {
      setVtSaving(false);
    }
  }

  async function setVisitTypeActive(row: VisitTypeRow, active: boolean) {
    try {
      const updated = await apiPatch<VisitTypeRow>(ctx, `/visit-types/${row._id}`, { active });
      setVisitTypes((prev) => prev.map((v) => (v._id === row._id ? updated : v)));
    } catch (e) {
      setVtError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteVisitType(row: VisitTypeRow) {
    if (!window.confirm(`Remove visit type "${row.name}"? Existing bookings referencing it are not affected.`)) return;
    try {
      await apiDelete(ctx, `/visit-types/${row._id}`);
      // BE soft-deletes (sets active=false); reflect that locally so the
      // operator can still see the row but it's clearly inactive.
      setVisitTypes((prev) => prev.map((v) => (v._id === row._id ? { ...v, active: false } : v)));
    } catch (e) {
      setVtError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!canRead) return <PermissionGate perm="clinic:read" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Doctor + branch picker */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Doctor & branch</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Doctor</label>
            {canEditOthers ? (
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}
                style={{ width: '100%', height: 40, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }}>
                {doctors.length === 0 && (
                  <option value={doctorId}>{doctorId ? doctorId : '— no users —'}</option>
                )}
                {doctors.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.name}{d.email ? ` (${d.email})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ height: 40, padding: '0 12px', background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text)', boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
                {ctx.fullName ? `Dr. ${ctx.fullName}` : 'You'}
              </div>
            )}
            {/* Selecting a doctor auto-loads their schedule (see effect
                above) — no manual Load button. This is just the cue. */}
            {loading && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-subtle)' }}>Loading availability…</div>
            )}
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-subtle)' }}>
          Branch: {ctx.branchName ?? (ctx.branchId ? <code style={{ fontFamily: 'monospace' }}>{ctx.branchId}</code> : '— none in context —')}
        </div>
        {error && <div style={{ marginTop: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
      </div>

      {/* Weekly rules */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Weekly schedule</div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>Slots are generated in clinic timezone using <code>slotMinutes</code>.</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map((r) => (
            <RuleRow
              key={r.weekday}
              rule={r}
              disabled={!canWriteThis}
              onChange={(patch) => updateRule(r.weekday, patch)}
              onCopyTo={(targets) => copyRuleTo(r.weekday, targets)}
              copyTargets={{ all: ALL_WEEKDAYS, weekdays: WEEKDAYS_MON_FRI, weekend: WEEKEND }}
            />
          ))}
        </div>
        {canWriteThis && (
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={saveRules} disabled={saving || !rulesDirty || !doctorId.trim() || !ctx.branchId}
              style={{
                height: 38, padding: '0 22px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600,
                cursor: (saving || !rulesDirty) ? (saving ? 'wait' : 'not-allowed') : 'pointer',
                opacity: (saving || !rulesDirty) ? 0.6 : 1,
                display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s'
              }}>
              {saving ? <Spinner /> : 'Save weekly rules'}
            </button>
          </div>
        )}
      </div>

      {/* Override editor */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Date override</div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 12 }}>
          A day's override <strong>replaces</strong> that day's weekly windows. To add an extra evening slot, include the morning windows too.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Date" value={overrideDate} onChange={setOverrideDate} placeholder="YYYY-MM-DD" type="date" />
          <div>
            <label style={labelStyle}>Type</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {([
                { v: 'CLOSED' as const, label: 'Closed all day' },
                { v: 'BLOCKED_WINDOWS' as const, label: 'Block specific hours' },
                { v: 'CUSTOM_WINDOWS' as const, label: 'Replace day windows' },
              ]).map(({ v, label }) => (
                <button key={v} onClick={() => setOverrideType(v)} disabled={!canWriteThis}
                  style={{ flex: '1 1 0', minWidth: 100, height: 40, border: `1.5px solid ${overrideType === v ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 10, background: overrideType === v ? 'var(--brand-50)' : 'var(--surface-muted)', color: overrideType === v ? 'var(--brand-600)' : 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: canWriteThis ? 'pointer' : 'not-allowed' }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
              {overrideType === 'CLOSED' && 'No appointments allowed all day. Existing bookings get rescheduled to the next free slot.'}
              {overrideType === 'BLOCKED_WINDOWS' && 'Mark specific hours unavailable; the rest of the doctor’s normal day stays open. Use this for emergencies.'}
              {overrideType === 'CUSTOM_WINDOWS' && 'Replace the doctor’s entire day with the windows below. Anything outside the windows is unavailable.'}
            </div>
          </div>
        </div>
        {(overrideType === 'CUSTOM_WINDOWS' || overrideType === 'BLOCKED_WINDOWS') && (
          <div style={{ marginTop: 12 }}>
            <WindowsEditor value={overrideWindows} onChange={setOverrideWindows} disabled={!canWriteThis} />
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Field label="Note (optional)" value={overrideNote} onChange={setOverrideNote} placeholder="e.g. holiday, conference" />
        </div>
        {canWriteThis && (
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={saveOverride} disabled={savingOverride || !overrideDate}
              style={{
                height: 38, padding: '0 22px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600,
                cursor: (savingOverride || !overrideDate) ? (savingOverride ? 'wait' : 'not-allowed') : 'pointer',
                opacity: (savingOverride || !overrideDate) ? 0.6 : 1,
                display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s'
              }}>
              {savingOverride ? <Spinner /> : 'Save override'}
            </button>
          </div>
        )}

        {overrides.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Existing overrides</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {overrides.map((o) => {
                const isEditing = overrideDate === o.date;
                return (
                  <div key={(o._id ?? '') + o.date}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px',
                      background: isEditing ? 'var(--brand-bg-soft)' : 'var(--surface-muted)',
                      borderRadius: 9,
                      border: `1px solid ${isEditing ? 'var(--brand-500)' : 'var(--border)'}`,
                    }}>
                    <code style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', minWidth: 96 }}>{o.date}</code>
                    {(() => {
                      const badge =
                        o.type === 'CLOSED'
                          ? { label: 'Closed', bg: 'var(--danger-bg)', fg: 'var(--danger-text)' }
                          : o.type === 'BLOCKED_WINDOWS'
                            ? { label: `${(o.windows ?? []).length} blocked`, bg: 'var(--warning-bg)', fg: 'var(--warning-text)' }
                            : { label: `${(o.windows ?? []).length} custom`, bg: 'var(--info-bg)', fg: 'var(--info-text)' };
                      return (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: badge.bg, color: badge.fg }}>
                          {badge.label}
                        </span>
                      );
                    })()}
                    {o.note && <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.note}</span>}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button type="button" onClick={() => editOverride(o)}
                        disabled={!canWriteThis}
                        title={canWriteThis ? 'Edit override' : 'You do not have permission to edit'}
                        aria-label={`Edit override for ${o.date}`}
                        style={{
                          width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7,
                          cursor: canWriteThis ? 'pointer' : 'not-allowed',
                          opacity: canWriteThis ? 1 : 0.5,
                          color: 'var(--text-muted)',
                        }}>
                        <Icon name="edit" size={13} />
                      </button>
                      <button type="button" onClick={() => { void removeOverride(o); }}
                        disabled={!canWriteThis}
                        title={canWriteThis ? 'Delete override' : 'You do not have permission to delete'}
                        aria-label={`Delete override for ${o.date}`}
                        style={{
                          width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7,
                          cursor: canWriteThis ? 'pointer' : 'not-allowed',
                          opacity: canWriteThis ? 1 : 0.5,
                          color: 'var(--danger-500)',
                        }}>
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Visit types & pricing — per-doctor consultation catalog. Drives
          the BookSheet picker; each row is the price the front desk will
          collect for that visit. */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Visit types & pricing</div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 12 }}>
          Each visit type sets a price the front desk collects at booking time before check-in.
        </div>

        {canWriteThis && (
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
            <Field label="Name" value={vtName} onChange={setVtName} placeholder="e.g. Consultation" />
            <Field label="Price" value={vtPrice} onChange={setVtPrice} placeholder="e.g. 500" />
            <button onClick={() => void addVisitType()} disabled={vtSaving || !vtName.trim() || !vtPrice.trim()}
              style={{
                height: 40, padding: '0 18px', background: 'var(--brand-500)', color: 'var(--brand-text)',
                border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
                cursor: vtSaving ? 'wait' : (!vtName.trim() || !vtPrice.trim() ? 'not-allowed' : 'pointer'),
                opacity: vtSaving || !vtName.trim() || !vtPrice.trim() ? 0.6 : 1,
              }}>
              {vtSaving ? <Spinner /> : 'Add'}
            </button>
          </div>
        )}
        {vtError && (
          <div style={{ marginBottom: 10, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, fontSize: 12, color: 'var(--danger-500)' }}>
            {vtError}
          </div>
        )}

        {visitTypes.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-subtle)', background: 'var(--surface-muted)', border: '1px dashed var(--border)', borderRadius: 10 }}>
            No visit types yet. Add one above so the front desk can pick it during booking.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {visitTypes.map((vt) => (
              <div key={vt._id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px',
                  background: vt.active ? 'var(--surface-muted)' : 'var(--surface)',
                  borderRadius: 9, border: '1px solid var(--border)',
                  opacity: vt.active ? 1 : 0.55,
                }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{vt.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>
                    {vt.currency} {vt.price.toLocaleString('en-IN')}
                    {!vt.active && <span style={{ marginLeft: 8, fontWeight: 600 }}>· Inactive</span>}
                  </div>
                </div>
                {canWriteThis && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => void setVisitTypeActive(vt, !vt.active)}
                      title={vt.active ? 'Deactivate (hide from booking)' : 'Reactivate'}
                      style={{
                        width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7,
                        cursor: 'pointer', color: 'var(--text-muted)',
                      }}>
                      <Icon name={vt.active ? 'eyeOff' : 'eye'} size={13} />
                    </button>
                    <button type="button" onClick={() => void deleteVisitType(vt)}
                      title="Remove (soft delete)"
                      style={{
                        width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7,
                        cursor: 'pointer', color: 'var(--danger-500)',
                      }}>
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Preview a day</div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 12 }}>
          Generates the slots for any date using the saved rules + overrides. Times shown are in the clinic timezone.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'flex-end' }}>
          <Field label="Date" value={previewDate} onChange={setPreviewDate} placeholder="YYYY-MM-DD" type="date" />
          <button onClick={() => void runPreview()} disabled={previewing || !previewDate || !doctorId.trim() || !ctx.branchId}
            style={{
              height: 40, padding: '0 22px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
              cursor: (previewing || !previewDate || !doctorId.trim() || !ctx.branchId) ? (previewing ? 'wait' : 'not-allowed') : 'pointer',
              opacity: (previewing || !previewDate || !doctorId.trim() || !ctx.branchId) ? 0.6 : 1,
              transition: 'all 0.2s'
            }}>
            {previewing ? 'Loading…' : 'Show slots'}
          </button>
        </div>
        {preview && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--surface-muted)', borderRadius: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 8 }}>
              {preview.date} — {preview.slots.length} slot(s) × {preview.slotMinutes} min ({preview.timezone})
            </div>
            {preview.slots.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-subtle)', fontStyle: 'italic' }}>No slots — closed or no rules.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {preview.slots.map((s) => (
                  <span key={s.startAt} style={{ fontSize: 11, fontFamily: 'monospace', padding: '4px 9px', borderRadius: 100, background: 'var(--brand-50)', border: '1px solid var(--brand-100)', color: 'var(--brand-700)' }}>
                    {formatLocalHHMM(s.startAt, preview.timezone)} → {formatLocalHHMM(s.endAt, preview.timezone)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatLocalHHMM(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  } catch {
    return iso.slice(11, 16);
  }
}

function RuleRow({
  rule,
  disabled,
  onChange,
  onCopyTo,
  copyTargets,
}: {
  rule: WeeklyRule;
  disabled: boolean;
  onChange: (p: Partial<WeeklyRule>) => void;
  onCopyTo?: (targets: number[]) => void;
  copyTargets?: { all: number[]; weekdays: number[]; weekend: number[] };
}) {
  // Copy is only meaningful for ACTIVE rows with windows — copying an
  // empty/off row is a footgun (silently turns every other day off).
  const canCopy =
    !disabled &&
    rule.active &&
    rule.windows.length > 0 &&
    !!onCopyTo &&
    !!copyTargets;

  // Local text state for the slot-minutes input so the operator can type
  // freely (clear it, type "120", etc.). The old code clamped on every
  // keystroke, which made it impossible to edit — typing "3" jumped to 5,
  // clearing snapped back to 15. We clamp + commit to the rule only on blur.
  const [slotText, setSlotText] = useState(String(rule.slotMinutes ?? 15));
  useEffect(() => {
    setSlotText(String(rule.slotMinutes ?? 15));
  }, [rule.slotMinutes]);
  const commitSlot = () => {
    const n = Math.max(5, Math.min(180, Number(slotText) || 15));
    setSlotText(String(n));
    if (n !== (rule.slotMinutes ?? 15)) onChange({ slotMinutes: n });
  };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', background: rule.active ? 'var(--surface-muted)' : 'transparent', border: '1px solid var(--border)', borderRadius: 10 }}>
      <button onClick={() => onChange({ active: !rule.active })} disabled={disabled}
        style={{ width: 56, padding: '6px 0', borderRadius: 8, border: `1.5px solid ${rule.active ? 'var(--brand-500)' : 'var(--border)'}`, background: rule.active ? 'var(--brand-500)' : 'var(--surface)', color: rule.active ? 'var(--brand-text)' : 'var(--text-subtle)', fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
        {WEEKDAY_LABELS[rule.weekday]}
      </button>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <WindowsEditor value={rule.windows} onChange={(ws) => onChange({ windows: ws })} disabled={disabled || !rule.active} compact />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Slot minutes</span>
            <input type="number" min={5} max={180} value={slotText}
              onChange={(e) => setSlotText(e.target.value)}
              onBlur={commitSlot}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              disabled={disabled || !rule.active}
              style={{ width: 64, height: 28, padding: '0 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, color: 'var(--text)', outline: 'none' }} />
          </div>

          {canCopy && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-subtle)' }}>
              <span>Copy to</span>
              <CopyButton
                label="All days"
                onClick={() => onCopyTo!(copyTargets!.all)}
                title={`Apply ${WEEKDAY_LABELS[rule.weekday]}'s hours to all 7 weekdays`}
              />
              <CopyButton
                label="Mon–Fri"
                onClick={() => onCopyTo!(copyTargets!.weekdays)}
                title={`Apply ${WEEKDAY_LABELS[rule.weekday]}'s hours to Monday–Friday`}
              />
              <CopyButton
                label="Sat + Sun"
                onClick={() => onCopyTo!(copyTargets!.weekend)}
                title={`Apply ${WEEKDAY_LABELS[rule.weekday]}'s hours to the weekend`}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyButton({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        height: 24,
        padding: '0 8px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--text-muted)',
        cursor: 'pointer',
      }}>
      {label}
    </button>
  );
}

function WindowsEditor({ value, onChange, disabled, compact }: { value: AvailabilityWindow[]; onChange: (v: AvailabilityWindow[]) => void; disabled?: boolean; compact?: boolean }) {
  function update(idx: number, patch: Partial<AvailabilityWindow>) {
    onChange(value.map((w, i) => (i === idx ? { ...w, ...patch } : w)));
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...value, { startMinutes: 9 * 60, endMinutes: 17 * 60 }]);
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {value.length === 0 && (
        <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontStyle: 'italic' }}>{disabled ? '— off —' : 'No windows'}</span>
      )}
      {value.map((w, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: compact ? '3px 6px' : '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <Icon name="clock" size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input type="time" value={toHHMM(w.startMinutes)} disabled={disabled}
            onChange={(e) => update(i, { startMinutes: fromHHMM(e.target.value) })}
            style={{ height: compact ? 24 : 30, padding: '0 4px', border: 'none', background: 'transparent', fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'monospace' }} />
          <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}>→</span>
          <input type="time" value={toHHMM(w.endMinutes)} disabled={disabled}
            onChange={(e) => update(i, { endMinutes: fromHHMM(e.target.value) })}
            style={{ height: compact ? 24 : 30, padding: '0 4px', border: 'none', background: 'transparent', fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'monospace' }} />
          {!disabled && (
            <button onClick={() => remove(i)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 2, marginLeft: 2 }}>
              <Icon name="x" size={11} strokeWidth={2.5} />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <button onClick={add}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: compact ? '3px 8px' : '6px 12px', background: 'none', border: '1.5px dashed var(--border)', borderRadius: 8, color: 'var(--text-subtle)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
          <Icon name="plus" size={11} strokeWidth={2.5} /> Add window
        </button>
      )}
    </div>
  );
}


function AboutTab() {
  const features: { icon: IconName; title: string; body: string }[] = [
    {
      icon: 'calendar',
      title: 'Appointments & queue',
      body: 'Book time-slot or walk-in appointments with conflict prevention, doctor availability rules, and per-branch queue tokens.',
    },
    {
      icon: 'stethoscope',
      title: 'Consultations & prescriptions',
      body: "Capture vitals, diagnoses, and prescriptions in a single signed clinical record — shareable with patients via secure links.",
    },
    {
      icon: 'creditCard',
      title: 'Billing',
      body: 'Draft, issue, and collect payments on bills with idempotent payment capture and per-branch invoice numbering.',
    },
    {
      icon: 'users',
      title: 'Multi-clinic, multi-branch',
      body: 'Run several clinics or branches under a single tenant with strict isolation, role-based permissions, and a full audit trail.',
    },
    {
      icon: 'bell',
      title: 'Reminders & notifications',
      body: 'Automated SMS/WhatsApp reminders for upcoming appointments, configurable per template and per channel.',
    },
    {
      icon: 'folder',
      title: 'Documents',
      body: 'Attach lab reports, X-rays, or prescriptions to patients and share them with patients through expiring, view-limited links.',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--brand-500)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="cross" size={20} style={{ color: 'var(--brand-text)' }} strokeWidth={2.5} />
          </div>
          <div>
            <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 22, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.4px' }}>
              Digi<span style={{ color: 'var(--brand-500)' }}>Rx</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>Clinic management, end to end</div>
          </div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
          DigiRx is a clinic management platform that runs the day-to-day of a
          modern outpatient practice — from a patient's first booking through
          their visit, prescription, and bill. It is built for solo doctors,
          multi-doctor clinics, and multi-branch chains, with the safeguards
          and audit trails expected of clinical software.
        </p>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>What DigiRx covers</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {features.map((f) => (
            <div key={f.title} style={{ display: 'flex', gap: 10, padding: '12px 14px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--brand-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name={f.icon} size={14} style={{ color: 'var(--brand-500)' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{f.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>{f.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, fontSize: 12, color: 'var(--text-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span>© {new Date().getFullYear()} DigiRx. All rights reserved.</span>
        <span>Need help? Reach support at <a href="mailto:support@digirx.local" style={{ color: 'var(--brand-500)', textDecoration: 'none' }}>support@digirx.local</a></span>
      </div>
    </div>
  );
}


// ---------- Branches ----------

type BranchAdmin = {
  _id: string;
  name: string;
  addressLine?: string;
  phone?: string;
  open?: string;
  close?: string;
  slotsPerDay?: number;
  active: boolean;
  doctorCount: number;
};

function BranchesTab() {
  const { ctx, permissions } = useApp();
  const toast = useToast();
  const canRead = permissions.has('clinic:read');
  const canWrite = permissions.has('clinic:write');
  const [branches, setBranches] = useState<BranchAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<BranchAdmin | null>(null);

  function listPath() {
    return `/clinics/${encodeURIComponent(ctx.clinicId)}/branches`;
  }

  async function load() {
    if (!ctx.clinicId) { setError('No clinic in context.'); return; }
    setLoading(true); setError(null);
    try {
      const data = await apiGet<BranchAdmin[]>(ctx, listPath());
      setBranches(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (canRead) void load(); }, [canRead, ctx.clinicId]);

  async function toggleActive(b: BranchAdmin) {
    try {
      const updated = await apiPatch<BranchAdmin>(ctx, `${listPath()}/${b._id}`, { active: !b.active });
      setBranches((bs) => bs.map((x) => (x._id === b._id ? updated : x)));
      toast(updated.active ? 'Branch activated' : 'Branch deactivated', updated.active ? 'success' : 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed', 'error');
    }
  }

  if (!canRead) return <PermissionGate perm="clinic:read" />;

  const activeCount = branches.filter((b) => b.active).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
            {loading ? 'Loading…' : `${branches.length} branch${branches.length === 1 ? '' : 'es'} · ${activeCount} active`}
          </div>
        </div>
        {canWrite && (
          <button onClick={() => setShowAdd(true)} className="press-scale"
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 16px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <Icon name="plus" size={14} strokeWidth={2.5} /> Add branch
          </button>
        )}
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}

      {!loading && branches.length === 0 && (
        <div style={{ background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 14, padding: 32, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
          No branches yet. {canWrite ? 'Click "Add branch" to create your first one.' : ''}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {branches.map((b) => (
          <BranchCard key={b._id} branch={b}
            canWrite={canWrite}
            onEdit={() => setEditing(b)}
            onToggle={() => toggleActive(b)} />
        ))}
      </div>

      {showAdd && (
        <BranchSheet mode="create"
          onClose={() => setShowAdd(false)}
          onSaved={(b) => { setBranches((bs) => [...bs, b].sort((a, c) => a.name.localeCompare(c.name))); setShowAdd(false); toast('Branch created', 'success'); }}
        />
      )}
      {editing && (
        <BranchSheet mode="edit" initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(b) => { setBranches((bs) => bs.map((x) => (x._id === b._id ? b : x))); setEditing(null); toast('Branch updated', 'success'); }}
        />
      )}
    </div>
  );
}

function BranchCard({ branch, canWrite, onEdit, onToggle }: { branch: BranchAdmin; canWrite: boolean; onEdit: () => void; onToggle: () => void }) {
  const hours = (branch.open && branch.close) ? `${branch.open} – ${branch.close}` : '—';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 }}>
      <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--brand-50)', border: '1px solid var(--brand-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name="mapPin" size={20} style={{ color: 'var(--brand-500)' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{branch.name}</span>
          <span style={{
            padding: '1px 8px', borderRadius: 100, fontSize: 10, fontWeight: 600,
            background: branch.active ? 'var(--success-bg)' : 'var(--neutral-bg)',
            color: branch.active ? 'var(--success-text)' : 'var(--neutral-text)'
          }}>
            {branch.active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{branch.addressLine ?? '—'}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: 'var(--text-subtle)' }}>
          {branch.phone && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="phone" size={12} /> {branch.phone}
            </span>
          )}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="clock" size={12} /> {hours}
          </span>
          {branch.slotsPerDay !== undefined && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="calendar" size={12} /> {branch.slotsPerDay} slots/day
            </span>
          )}
        </div>
      </div>
      {canWrite && (
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={onToggle}
            style={{
              height: 34, padding: '0 14px', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'none',
              border: `1.5px solid ${branch.active ? 'var(--danger-500)' : 'var(--success-500)'}`,
              color: branch.active ? 'var(--danger-500)' : 'var(--success-500)',
            }}>
            {branch.active ? 'Deactivate' : 'Activate'}
          </button>
          <button onClick={onEdit}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 34, padding: '0 14px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <Icon name="edit" size={12} /> Edit
          </button>
        </div>
      )}
    </div>
  );
}

function BranchSheet({ mode, initial, onClose, onSaved }: {
  mode: 'create' | 'edit';
  initial?: BranchAdmin;
  onClose: () => void;
  onSaved: (b: BranchAdmin) => void;
}) {
  const { ctx } = useApp();
  const [name, setName] = useState(initial?.name ?? '');
  const [addressLine, setAddressLine] = useState(initial?.addressLine ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [open, setOpen] = useState(initial?.open ?? '09:00');
  const [close, setClose] = useState(initial?.close ?? '18:00');
  const [slotsPerDay, setSlotsPerDay] = useState(String(initial?.slotsPerDay ?? 20));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    if (mode === 'create') return true; // Always allow save for new ones
    return (
      name.trim() !== (initial?.name ?? '') ||
      addressLine.trim() !== (initial?.addressLine ?? '') ||
      phone.trim() !== (initial?.phone ?? '') ||
      open !== (initial?.open ?? '09:00') ||
      close !== (initial?.close ?? '18:00') ||
      Number(slotsPerDay) !== (initial?.slotsPerDay ?? 20)
    );
  }, [mode, initial, name, addressLine, phone, open, close, slotsPerDay]);

  async function submit() {
    if (!name.trim()) { setError('Branch name is required.'); return; }
    let phoneNormalized: string | undefined;
    if (phone.trim()) {
      if (!isValidIndianMobile(phone)) {
        setError('Enter a valid 10-digit Indian mobile number.');
        return;
      }
      phoneNormalized = normalizeIndianMobile(phone) ?? undefined;
    }
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        addressLine: addressLine.trim() || undefined,
        // Persist the canonical 10-digit form so two branches typing
        // "9876543210" and "+91 9876543210" land on the same value.
        phone: phoneNormalized,
        open: open || undefined,
        close: close || undefined,
        slotsPerDay: slotsPerDay.trim() ? Math.max(0, Number(slotsPerDay) || 0) : undefined,
      };
      const path = `/clinics/${encodeURIComponent(ctx.clinicId)}/branches`;
      const saved = mode === 'create'
        ? await apiPost<BranchAdmin>(ctx, path, body)
        : await apiPatch<BranchAdmin>(ctx, `${path}/${initial!._id}`, body);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 460, background: 'var(--surface)', borderRadius: 18, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', display: 'flex', flexDirection: 'column', maxHeight: '90vh', animation: 'slideUp 200ms ease-out' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            {mode === 'create' ? 'Add branch' : 'Edit branch'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          <Field label="Branch name" value={name} onChange={setName} placeholder="e.g. Juhu" />
          <Field label="Full address" value={addressLine} onChange={setAddressLine} placeholder="Street, area, city — pincode" />
          <Field label="Phone number" value={phone} onChange={setPhone} placeholder="+91 22 XXXX XXXX" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Opens at</label>
              <input type="time" value={open} onChange={(e) => setOpen(e.target.value)}
                style={timeInputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Closes at</label>
              <input type="time" value={close} onChange={(e) => setClose(e.target.value)}
                style={timeInputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Slots / day</label>
              <input type="number" min={0} max={1000} value={slotsPerDay}
                onChange={(e) => setSlotsPerDay(e.target.value)}
                style={timeInputStyle} />
            </div>
          </div>
          {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>}
        </div>
        <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <button onClick={onClose}
            style={{ flex: 1, height: 42, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving || !isDirty}
            style={{
              flex: 2, height: 42, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
              cursor: (saving || !isDirty) ? (saving ? 'wait' : 'not-allowed') : 'pointer',
              opacity: (saving || !isDirty) ? 0.6 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.2s'
            }}>
            {saving ? <Spinner /> : (mode === 'create' ? 'Add branch' : 'Save changes')}
          </button>
        </div>
      </div>
    </div>
  );
}

const timeInputStyle: React.CSSProperties = {
  width: '100%', height: 40, padding: '0 12px',
  background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 10,
  fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
};

function TimePickerInput({
  label,
  value,
  onChange,
  disabled,
  refObj,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  refObj: React.RefObject<HTMLInputElement | null>;
}) {
  const [show, setShow] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!show) return;
    const click = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setShow(false);
    };
    window.addEventListener('mousedown', click);
    return () => window.removeEventListener('mousedown', click);
  }, [show]);

  return (
    <div style={{ flex: 1 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{label}</label>
      <div
        ref={containerRef}
        style={{ position: 'relative' }}
      >
        <div
          onClick={() => !disabled && setShow(!show)}
          style={{ position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer' }}
        >
          <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: !disabled ? 'var(--brand-500)' : 'var(--text-subtle)', transition: 'color 0.2s', zIndex: 5 }}>
            <Icon name="clock" size={14} />
          </div>
          <input
            ref={refObj}
            type="time"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="time-picker-custom"
            style={{
              width: '100%', height: 40, padding: '0 12px 0 34px',
              background: 'var(--surface-muted)', border: `1.5px solid ${show ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 10,
              fontSize: 13, fontWeight: 600, color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
              fontFamily: 'inherit',
              opacity: disabled ? 0.6 : 1,
              transition: 'all 0.2s ease-out',
              cursor: 'inherit'
            }}
          />
        </div>

        {show && !disabled && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 100,
            width: 240, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            padding: 12, display: 'flex', flexDirection: 'column', gap: 12,
            animation: 'pickerIn 180ms var(--ease-out)'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              {/* Hours */}
              <div style={pickerColStyle}>
                {Array.from({ length: 12 }).map((_, i) => {
                  const h = i === 0 ? 12 : i;
                  const hStr = h.toString().padStart(2, '0');
                  const currentH = parseInt(value.split(':')[0]);
                  const isPM = currentH >= 12;
                  const displayH = isPM ? (currentH === 12 ? 12 : currentH - 12) : (currentH === 0 ? 12 : currentH);
                  const active = displayH === h;
                  return (
                    <div
                      key={h}
                      onClick={() => {
                        const [_, m] = value.split(':');
                        const newH = isPM ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
                        onChange(`${newH.toString().padStart(2, '0')}:${m}`);
                      }}
                      style={{ ...pickerItemStyle, background: active ? 'var(--brand-500)' : 'transparent', color: active ? 'var(--brand-text)' : 'var(--text)' }}
                    >
                      {hStr}
                    </div>
                  );
                })}
              </div>
              {/* Minutes */}
              <div style={pickerColStyle}>
                {['00', '15', '30', '45'].map((m) => {
                  const active = value.split(':')[1] === m;
                  return (
                    <div
                      key={m}
                      onClick={() => onChange(`${value.split(':')[0]}:${m}`)}
                      style={{ ...pickerItemStyle, background: active ? 'var(--brand-500)' : 'transparent', color: active ? 'var(--brand-text)' : 'var(--text)' }}
                    >
                      {m}
                    </div>
                  );
                })}
              </div>
              {/* AM/PM */}
              <div style={pickerColStyle}>
                {['AM', 'PM'].map((p) => {
                  const currentH = parseInt(value.split(':')[0]);
                  const isPM = currentH >= 12;
                  const active = p === (isPM ? 'PM' : 'AM');
                  return (
                    <div
                      key={p}
                      onClick={() => {
                        const [h, m] = value.split(':').map(Number);
                        let newH = h;
                        if (p === 'AM' && isPM) newH = h === 12 ? 0 : h - 12;
                        if (p === 'PM' && !isPM) newH = h === 0 ? 12 : h + 12;
                        onChange(`${newH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
                      }}
                      style={{ ...pickerItemStyle, background: active ? 'var(--brand-500)' : 'transparent', color: active ? 'var(--brand-text)' : 'var(--text)' }}
                    >
                      {p}
                    </div>
                  );
                })}
              </div>
            </div>
            <button
              onClick={() => setShow(false)}
              style={{ width: '100%', height: 32, background: 'var(--brand-50)', color: 'var(--brand-500)', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const pickerColStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 180, overflowY: 'auto',
  scrollbarWidth: 'none',
};

const pickerItemStyle: React.CSSProperties = {
  padding: '6px 0', textAlign: 'center', fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: 'pointer', transition: 'all 0.1s'
};

function NotifConfigTab() {
  const { ctx, permissions } = useApp();
  const toast = useToast();
  const canWrite = permissions.has('clinic:write');

  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<ClinicSettingsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Editor state
  const [enabled, setEnabled] = useState(false);
  const [start, setStart] = useState('21:00');
  const [end, setEnd] = useState('08:00');

  const path = `/clinics/${encodeURIComponent(ctx.clinicId)}/settings`;

  function hydrate(res: ClinicSettingsResp) {
    setData(res);
    const qh = res.settings.modules?.notifications?.quietHours;
    const hasWindow = !!(qh && qh.start && qh.end);
    setEnabled(hasWindow);
    if (qh?.start) setStart(qh.start);
    if (qh?.end) setEnd(qh.end);
  }

  useEffect(() => {
    if (!ctx.clinicId) { setError('No clinic in context.'); return; }
    setLoading(true);
    apiGet<ClinicSettingsResp>(ctx, path)
      .then(hydrate)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.clinicId]);

  // The visible state is "what we'd save right now"; comparing against the
  // hydrated server state tells us when the Save button should light up.
  const dirty = useMemo(() => {
    if (!data) return false;
    const qh = data.settings.modules?.notifications?.quietHours;
    const wasEnabled = !!(qh && qh.start && qh.end);
    if (enabled !== wasEnabled) return true;
    if (!enabled) return false;
    return start !== (qh?.start ?? '') || end !== (qh?.end ?? '');
  }, [data, enabled, start, end]);

  async function save() {
    if (!dirty || !canWrite) return;
    setSaving(true); setError(null);
    try {
      // Disabled → clear both sides; enabled → send both. The BE merges
      // independently so this never accidentally drops the other field.
      const body = {
        modules: {
          notifications: {
            quietHours: enabled
              ? { start, end }
              : { start: null, end: null },
          },
        },
      };
      const updated = await apiPatch<ClinicSettingsResp>(ctx, path, body);
      hydrate(updated);
      toast('Quiet hours saved', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  // Crosses midnight when start > end (e.g. 21:00 → 08:00). Surface this so
  // the admin understands the window will span two calendar days.
  const crossesMidnight = enabled && !!start && !!end && start > end;

  if (loading && !data) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 32, textAlign: 'center' }}>
        <Spinner />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--brand-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="bell" size={16} style={{ color: 'var(--brand-500)' }} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Quiet hours</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
              Stops automated SMS / WhatsApp messages from going out during the window you set.
              Times are in your clinic's timezone.
            </div>
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 12, cursor: canWrite ? 'pointer' : 'not-allowed', marginBottom: 20 }}>
          <Checkbox
            checked={enabled}
            disabled={!canWrite}
            onChange={(v) => setEnabled(v)}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Enable quiet hours</div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
              When off, the scheduler can send messages at any hour.
            </div>
          </div>
        </label>

        <div style={{ display: 'flex', gap: 16 }}>
          <TimePickerInput
            label="From"
            value={start}
            disabled={!enabled || !canWrite}
            onChange={setStart}
            refObj={startRef}
          />
          <TimePickerInput
            label="To"
            value={end}
            disabled={!enabled || !canWrite}
            onChange={setEnd}
            refObj={endRef}
          />
        </div>

        {crossesMidnight && (
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--info-bg, rgba(59,130,246,0.08))', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 10, fontSize: 12, color: 'var(--info-text, var(--text-muted))', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="info" size={14} />
            This window crosses midnight — messages will be held from {start} until {end} the next day.
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, fontSize: 12, color: 'var(--danger-500)' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            onClick={save}
            disabled={!dirty || !canWrite || saving}
            style={{
              height: 38, padding: '0 18px',
              background: dirty && canWrite ? 'var(--brand-500)' : 'rgba(99,102,241,0.4)',
              color: 'var(--brand-text)', border: 'none', borderRadius: 10,
              fontSize: 13, fontWeight: 600,
              cursor: !dirty || !canWrite || saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
            {saving ? <Spinner /> : <><Icon name="check" size={14} strokeWidth={2.5} /> Save quiet hours</>}
          </button>
        </div>

        {!canWrite && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-subtle)', textAlign: 'right' }}>
            You don't have <code>clinic:write</code> to change this.
          </div>
        )}
      </div>
    </div>
  );
}


function PermissionGate({ perm }: { perm: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
      <Icon name="lock" size={28} style={{ color: 'var(--text-subtle)', margin: '0 auto 12px' }} />
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Permission required</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>You need <code style={{ fontFamily: 'monospace' }}>{perm}</code> to view this page.</div>
    </div>
  );
}

// ---------- Audit log tab ----------

type AuditRow = {
  _id: string;
  clinicId: string;
  branchId?: string;
  actorUserId?: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  entityType: string;
  entityId: string;
  targetLabel?: string;
  meta?: { method?: string; path?: string };
  createdAt: string;
};

const ACTION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  CREATE: { bg: 'rgba(16,185,129,0.10)', text: '#15803d', border: 'rgba(16,185,129,0.25)' },
  UPDATE: { bg: 'rgba(59,130,246,0.10)', text: '#1d4ed8', border: 'rgba(59,130,246,0.25)' },
  DELETE: { bg: 'rgba(239,68,68,0.10)', text: '#b91c1c', border: 'rgba(239,68,68,0.25)' },
};

function entityLabel(entityType: string): string {
  // "/patients" → "Patient", "/patients/:id" → "Patient", etc.
  const m = /\/([a-z-]+)/i.exec(entityType);
  if (!m) return entityType;
  const word = m[1].replace(/s$/, '');
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// Map of `METHOD route-pattern` → human verb for the audit log Detail cell.
// `entityType` from the backend is the matched Express route pattern with
// parameter placeholders (e.g. `/appointments/:id/checkin`). New mutation
// routes should get a row here; otherwise the UI falls back to the raw
// method+path on the line below.
const AUDIT_DETAIL_LABELS: Record<string, string> = {
  // Appointments
  'POST /appointments': 'Booked appointment',
  'PATCH /appointments/:id': 'Updated appointment',
  'POST /appointments/:id/checkin': 'Checked in patient',
  // Encounters
  'POST /encounters': 'Started encounter',
  'PATCH /encounters/:id': 'Updated encounter',
  'POST /encounters/:id/sign': 'Signed encounter',
  // Patients
  'POST /patients': 'Registered patient',
  'PATCH /patients/:id': 'Updated patient',
  'POST /patients/:id/documents': 'Attached document to patient',
  // Billing
  'POST /bills': 'Created bill (draft)',
  'PATCH /bills/:id': 'Updated bill',
  'POST /bills/from-prescription/:id': 'Created bill from prescription',
  'POST /bills/:id/issue': 'Issued bill',
  'POST /bills/:id/payments': 'Recorded payment',
  'POST /catalog/services': 'Added service to catalog',
  // Documents
  'POST /documents/upload-url': 'Initiated document upload',
  'POST /documents/:id/confirm': 'Confirmed document upload',
  'POST /documents/:id/share': 'Shared document',
  'POST /documents/:id/share/revoke': 'Revoked document share',
  // Prescriptions
  'POST /encounters/:id/prescriptions': 'Issued prescription',
  'POST /prescriptions/:id/share': 'Shared prescription',
  'POST /prescriptions/:id/share/revoke': 'Revoked prescription share',
  // Notifications
  'POST /notifications/test': 'Sent test notification',
  'POST /notifications/templates': 'Saved notification template',
  // Tenancy / clinic settings
  'PATCH /clinics/:id/settings': 'Updated clinic settings',
  'POST /clinics/:id/branches': 'Added branch',
  'PATCH /clinics/:id/branches/:branchId': 'Updated branch',
  // Availability
  'PUT /availability/doctors/:doctorUserId/rules': 'Updated doctor availability',
  'PUT /availability/doctors/:doctorUserId/overrides/:date': 'Set availability override',
  'PATCH /availability/doctors/:doctorUserId/overrides/:date/close': 'Closed clinic for date',
  'DELETE /availability/doctors/:doctorUserId/overrides/:date': 'Remove availability override',
  // Auth / roles
  'PATCH /roles/:id': 'Updated role',
  'PATCH /users/:id/roles': 'Updated user roles',
};

function auditDetailLabel(method: string | undefined, entityType: string): string | null {
  if (!method) return null;
  const key = `${method.toUpperCase()} ${entityType.startsWith('/') ? entityType : '/' + entityType}`;
  return AUDIT_DETAIL_LABELS[key] ?? null;
}

function formatAuditTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function AuditTab() {
  const { ctx, permissions } = useApp();
  // Audit log access is governed by audit:read (what the backend
  // /audit-logs endpoint requires) — NOT clinic:write. Gating on
  // clinic:write wrongly blocked Managers, who have audit:read but not
  // clinic:write.
  const canRead = permissions.has('audit:read');
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [users, setUsers] = useState<Map<string, string>>(new Map());
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<'' | 'CREATE' | 'UPDATE' | 'DELETE'>('');
  const [actorFilter, setActorFilter] = useState<string>('');

  async function load(reset: boolean) {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: '50' });
      if (!reset && nextBefore) qs.set('before', nextBefore);
      if (actionFilter) qs.set('action', actionFilter);
      if (actorFilter) qs.set('actorUserId', actorFilter);
      const data = await apiGet<{ rows: AuditRow[]; nextBefore?: string }>(
        ctx,
        `/audit-logs?${qs.toString()}`,
      );
      setRows((prev) => (reset ? data.rows : [...prev, ...data.rows]));
      setNextBefore(data.nextBefore);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Load users once for actor display + filter dropdown
  useEffect(() => {
    if (!canRead) return;
    apiGet<Array<{ _id: string; name: string; email?: string }>>(ctx, '/users')
      .then((list) => {
        const m = new Map<string, string>();
        for (const u of list) m.set(u._id, u.name + (u.email ? ` (${u.email})` : ''));
        setUsers(m);
      })
      .catch(() => undefined);
  }, [ctx.clinicId, ctx.accessToken, canRead]);

  // Reload whenever filters change
  useEffect(() => {
    if (!canRead) return;
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, actorFilter, ctx.clinicId, ctx.accessToken]);

  if (!canRead) return <PermissionGate perm="audit:read" />;

  // Same visual language as BillingScreen: a single rounded card with a
  // pill-chip toolbar on top, a brand-coloured primary action button on
  // the right, and the table flush below. Empty state uses the shared
  // EmptyState component so it stays consistent with other screens.
  const ACTIONS: Array<{ id: '' | 'CREATE' | 'UPDATE' | 'DELETE'; label: string }> = [
    { id: '',       label: 'All' },
    { id: 'CREATE', label: 'Create' },
    { id: 'UPDATE', label: 'Update' },
    { id: 'DELETE', label: 'Delete' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Toolbar matches BillingScreen exactly */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface-muted)', borderRadius: 100, padding: 4, border: '1px solid var(--border)' }}>
            {ACTIONS.map((a) => {
              const active = actionFilter === a.id;
              return (
                <button key={a.id || 'all'} onClick={() => setActionFilter(a.id)}
                  style={{
                    padding: '6px 14px', borderRadius: 100, border: 'none',
                    background: active ? 'var(--brand-100)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-muted)',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    textTransform: 'capitalize', transition: 'all 0.2s',
                  }}>
                  {a.label}
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Dropdown
              value={actorFilter}
              onChange={(v) => setActorFilter(v)}
              placeholder="Search by actor…"
              options={[
                { value: '', label: 'All users', icon: 'users' },
                ...Array.from(users.entries()).map(([id, name]) => ({
                  value: id,
                  label: name.split(' (')[0],
                  hint: name.includes('(') ? name.split(' (')[1].replace(')', '') : undefined,
                  icon: 'user' as IconName,
                }))
              ]}
              width={220}
              size="sm"
            />
          </div>

        <button onClick={() => void load(true)} disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 18px',
            background: 'var(--brand-600)', color: 'var(--brand-text)', border: 'none', borderRadius: 10,
            fontSize: 12, fontWeight: 700, cursor: loading ? 'wait' : 'pointer',
            boxShadow: '0 4px 12px rgba(239,68,68,0.2)', // Matching brand-600 red shadow
          }}>
          <Icon name="refresh" size={14} strokeWidth={3} style={{ animation: loading ? 'spin 800ms linear infinite' : undefined }} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {error && (
          <div style={{ margin: 16, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, fontSize: 13, color: 'var(--danger-500)' }}>
            {error}
          </div>
        )}
        {loading && rows.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>Loading audit log…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            illustration="receipt"
            title="No audit entries"
            hint="Mutations to patients, appointments, bills, and clinic settings will appear here."
          />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface)' }}>
              <tr style={{ background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
                {['Time', 'Action', 'Entity', 'Actor', 'Detail'].map((h) => (
                  <th key={h} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const actor = r.actorUserId ? users.get(r.actorUserId) ?? r.actorUserId.slice(-6) : '—';
                const color = ACTION_COLORS[r.action] ?? ACTION_COLORS.UPDATE;
                return (
                  <tr key={r._id} className="row-hover" style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '14px 20px', verticalAlign: 'top' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{formatAuditTime(r.createdAt)}</span>
                    </td>
                    <td style={{ padding: '14px 20px', verticalAlign: 'top' }}>
                      <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 100, background: color.bg, color: color.text, border: `1px solid ${color.border}`, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>
                        {r.action}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px', verticalAlign: 'top' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{entityLabel(r.entityType)}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-subtle)', fontFamily: 'monospace', marginTop: 2 }}>
                        {r.entityId === 'n/a' ? '—' : r.entityId.slice(-12)}
                      </div>
                    </td>
                    <td style={{ padding: '14px 20px', verticalAlign: 'top', fontSize: 12, color: 'var(--text)' }}>{actor}</td>
                    <td style={{ padding: '14px 20px', verticalAlign: 'top', fontSize: 13, color: 'var(--text)' }}>
                      {auditDetailLabel(r.meta?.method, r.entityType) ?? <span style={{ color: 'var(--text-subtle)' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer: count + load more */}
      {rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-subtle)', padding: '12px 24px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
          <span>{rows.length} row{rows.length === 1 ? '' : 's'} loaded</span>
          {nextBefore && (
            <button onClick={() => void load(false)} disabled={loading}
              style={{ height: 32, padding: '0 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, cursor: loading ? 'wait' : 'pointer' }}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

