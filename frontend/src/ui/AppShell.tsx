import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp, type ScreenKey } from '../app/AppContext';
import { canAccessScreen, Perm } from '../app/permissions';
import { apiGet, apiPost } from '../app/api';
import { Avatar } from './shared/primitives';
import { Icon, type IconName } from './shared/Icon';
import { DatePickerChip } from './shared/DatePickerChip';

type NavItem = { id: ScreenKey; label: string; icon: IconName };

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'patients', label: 'Patients', icon: 'users' },
  { id: 'appointments', label: 'Appointments', icon: 'calendar' },
  { id: 'encounters', label: 'Encounters', icon: 'clipboard' },
  { id: 'billing', label: 'Billing', icon: 'receipt' },
  { id: 'documents', label: 'Documents', icon: 'folder' },
  { id: 'inventory', label: 'Inventory', icon: 'pill' },
  { id: 'pharmacy', label: 'Pharmacy', icon: 'receipt' },
  { id: 'reports', label: 'Reports', icon: 'barChart' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
];

const ADMIN_ITEMS: NavItem[] = [
  { id: 'users', label: 'Users', icon: 'users' },
  { id: 'roles', label: 'Roles & Permissions', icon: 'shield' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

const ALL_CMD: { label: string; action: ScreenKey; icon: IconName }[] = [
  { label: 'Go to Dashboard', action: 'dashboard', icon: 'dashboard' },
  { label: 'Go to Patients', action: 'patients', icon: 'users' },
  { label: 'Go to Appointments', action: 'appointments', icon: 'calendar' },
  { label: 'Go to Encounters', action: 'encounters', icon: 'clipboard' },
  { label: 'Go to Billing', action: 'billing', icon: 'receipt' },
  { label: 'New patient', action: 'patients', icon: 'plus' },
  { label: 'Book appointment', action: 'appointments', icon: 'plus' },
  { label: 'New bill', action: 'billing', icon: 'plus' },
  { label: 'Go to Documents', action: 'documents', icon: 'folder' },
  { label: 'Go to Inventory', action: 'inventory', icon: 'pill' },
  { label: 'Go to Pharmacy', action: 'pharmacy', icon: 'receipt' },
  { label: 'Go to Reports', action: 'reports', icon: 'barChart' },
  { label: 'Go to Notifications', action: 'notifications', icon: 'bell' },
  { label: 'Go to Settings', action: 'settings', icon: 'settings' },
];

function CommandPalette({ commands, onNavigate, onClose }: { commands: typeof ALL_CMD; onNavigate: (s: ScreenKey) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = commands.filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setHi(0); }, [q]);

  const run = (cmd: typeof ALL_CMD[number]) => { onNavigate(cmd.action); onClose(); };
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Enter' && filtered[hi]) run(filtered[hi]);
    if (e.key === 'Escape') onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 120, background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)', animation: 'fadeIn 150ms ease-out' }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 560, background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', overflow: 'hidden', animation: 'slideUp 150ms ease-out' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="search" size={18} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={handleKey}
            placeholder="Search or jump to…"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 15, color: 'var(--text)' }}
          />
          <kbd style={{ padding: '2px 6px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--text-subtle)' }}>ESC</kbd>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: '6px 0' }}>
          {filtered.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 14 }}>No results</div>}
          {filtered.map((cmd, i) => (
            <div key={cmd.label}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', cursor: 'pointer', background: i === hi ? 'var(--brand-50)' : 'transparent', color: i === hi ? 'var(--brand-600)' : 'var(--text)', transition: 'background 80ms', fontSize: 14 }}
              onMouseEnter={() => setHi(i)}
              onMouseDown={() => run(cmd)}>
              <Icon name={cmd.icon} size={16} style={{ color: i === hi ? 'var(--brand-500)' : 'var(--text-subtle)', flexShrink: 0 }} />
              {cmd.label}
              <div style={{ marginLeft: 'auto' }}>
                <kbd style={{ padding: '2px 6px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 10, color: 'var(--text-subtle)' }}>↵</kbd>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { screen, setScreen, theme, toggleTheme, ctx, setCtx, logout, selectedDate, setSelectedDate, permissions } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const rail = collapsed ? 56 : 208;
  const userName = ctx.fullName ?? 'User';
  const userEmail = ctx.email ?? '';

  // Branch list for the sidebar switcher. Only loaded for users who
  // can read branches (typically clinic admins) — without that perm
  // the GET 403s and we silently keep an empty list so the chip
  // gracefully falls back to a non-interactive display.
  const canSwitchBranch = permissions.has(Perm.BranchRead);
  const [branches, setBranches] = useState<{ _id: string; name: string }[]>([]);
  useEffect(() => {
    if (!canSwitchBranch || !ctx.clinicId) { setBranches([]); return; }
    apiGet<{ _id: string; name: string }[]>(ctx, `/clinics/${ctx.clinicId}/branches`)
      .then(setBranches)
      .catch(() => setBranches([]));
  }, [canSwitchBranch, ctx.clinicId, ctx.accessToken]);

  const visibleNav = useMemo(
    () => NAV_ITEMS.filter((i) => canAccessScreen(permissions, i.id)),
    [permissions],
  );
  const visibleAdmin = useMemo(
    () => ADMIN_ITEMS.filter((i) => canAccessScreen(permissions, i.id)),
    [permissions],
  );
  const visibleCmd = useMemo(
    () => ALL_CMD.filter((c) => canAccessScreen(permissions, c.action)),
    [permissions],
  );
  const canCreatePatient = permissions.has(Perm.PatientWrite);

  // If the current screen is no longer accessible (e.g. permissions changed,
  // or restored from a previous session), bounce to the first allowed screen.
  useEffect(() => {
    if (canAccessScreen(permissions, screen)) return;
    const fallback = [...visibleNav, ...visibleAdmin][0];
    if (fallback) setScreen(fallback.id);
  }, [permissions, screen, visibleNav, visibleAdmin, setScreen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen(true); }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); setHelpOpen(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const NavItemBtn = ({ item }: { item: NavItem }) => {
    const active = screen === item.id;
    return (
      <button onClick={() => setScreen(item.id)} title={collapsed ? item.label : undefined}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: collapsed ? '8px 16px' : '7px 12px',
          border: 'none', background: active ? 'var(--brand-50)' : 'transparent',
          borderRadius: 8, cursor: 'pointer',
          color: active ? 'var(--brand-600)' : 'var(--text-muted)',
          fontSize: 12, fontWeight: active ? 600 : 400, textAlign: 'left',
          transition: 'background 120ms, color 120ms', position: 'relative', overflow: 'hidden',
        }}>
        {active && <span style={{ position: 'absolute', left: 0, top: '20%', height: '60%', width: 3, background: 'var(--brand-500)', borderRadius: '0 3px 3px 0' }} />}
        <Icon name={item.icon} size={16} style={{ flexShrink: 0, color: active ? 'var(--brand-500)' : 'inherit' }} />
        {!collapsed && <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Left rail */}
      <div style={{ width: rail, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', transition: 'width 240ms var(--ease-out)', overflow: 'hidden' }}>
        {/* Logo */}
        <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', padding: collapsed ? 0 : '0 10px 0 14px', gap: 8, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--brand-500)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="cross" size={12} style={{ color: 'var(--brand-text)' }} strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <>
              <span style={{ fontFamily: "'Manrope',sans-serif", fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.4px', flex: 1 }}>
                Digi<span style={{ color: 'var(--brand-500)' }}>Rx</span>
              </span>
              <button onClick={() => setCollapsed(true)} title="Collapse sidebar"
                style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 5, borderRadius: 7, flexShrink: 0 }}>
                <Icon name="chevronLeft" size={14} />
              </button>
            </>
          )}
        </div>

        {/* Clinic chip / branch switcher. For admins (branch:read +
            more than one branch) the chip is an interactive popover
            that flips the active branch — every screen subscribed to
            ctx.branchId refetches when it changes. For everyone else
            it stays a static display showing the user's bound branch.

            Switching is a server round-trip: POST /auth/switch-branch
            re-signs a JWT with the new branchId (the middleware reads
            branchId from JWT claims, not from local state, so updating
            ctx alone wouldn't change what the BE returns). On success
            we save the rotated token + new branch into ctx — every
            useEffect keyed on ctx.branchId then refetches. */}
        {!collapsed && ctx.clinicId && (
          <BranchSwitcher
            clinicName={ctx.clinicName ?? 'Clinic'}
            currentBranchId={ctx.branchId}
            currentBranchName={ctx.branchName}
            branches={branches}
            canSwitch={canSwitchBranch && branches.length > 1}
            onSelect={async (b) => {
              try {
                const res = await apiPost<{ accessToken: string; branchId: string }>(
                  ctx,
                  '/auth/switch-branch',
                  { branchId: b._id },
                );
                setCtx({
                  ...ctx,
                  accessToken: res.accessToken ?? ctx.accessToken,
                  branchId: res.branchId,
                  branchName: b.name,
                });
              } catch {
                // Dev-header fallback (no JWT): the middleware reads
                // x-branch-id from the header instead, so just update
                // ctx locally and let the next request carry the new
                // header.
                setCtx({ ...ctx, branchId: b._id, branchName: b.name });
              }
            }}
          />
        )}

        {/* Primary nav */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visibleNav.map((item) => <NavItemBtn key={item.id} item={item} />)}
          {visibleAdmin.length > 0 && (
            <>
              {!collapsed && <div style={{ height: 1, background: 'var(--border)', margin: '8px 4px' }} />}
              {!collapsed && <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 8px 2px' }}>Admin</div>}
              {visibleAdmin.map((item) => <NavItemBtn key={item.id} item={item} />)}
            </>
          )}
        </nav>

        {/* Footer: user + logout */}
        <div style={{ borderTop: '1px solid var(--border)', padding: 8 }}>
          {collapsed && (
            <button onClick={() => setCollapsed(false)} title="Expand sidebar"
              style={{ width: '100%', height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 9, cursor: 'pointer', color: 'var(--text-subtle)', marginBottom: 8 }}>
              <Icon name="chevronRight" size={15} />
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: collapsed ? '4px 0' : '6px 6px', borderRadius: 9, justifyContent: collapsed ? 'center' : 'flex-start' }}>
            <Avatar name={userName} size={32} />
            {!collapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userName}</div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userEmail}</div>
              </div>
            )}
            {!collapsed && (
              <button onClick={() => { void logout(); }} title="Sign out"
                style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-subtle)', flexShrink: 0 }}>
                <Icon name="logOut" size={14} />
              </button>
            )}
          </div>
          {collapsed && (
            <button onClick={() => { void logout(); }} title="Sign out"
              style={{ width: '100%', height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid transparent', borderRadius: 9, cursor: 'pointer', color: 'var(--text-subtle)', marginTop: 4 }}>
              <Icon name="logOut" size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Topbar */}
        <div style={{ height: 48, flexShrink: 0, background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10 }}>
          <button onClick={() => setCmdOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-subtle)', fontSize: 12, cursor: 'pointer', flex: '0 0 200px' }}>
            <Icon name="search" size={13} />
            <span>Search…</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
              <kbd style={{ padding: '1px 5px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 10 }}>⌘</kbd>
              <kbd style={{ padding: '1px 5px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 10 }}>K</kbd>
            </span>
          </button>

          <DatePickerChip value={selectedDate} onChange={setSelectedDate} />

          <div style={{ flex: 1 }} />

          {canCreatePatient && (
            <button onClick={() => setScreen('patients')}
              style={{ display: 'flex', alignItems: 'center', gap: 5, height: 30, padding: '0 12px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'background 120ms, transform 120ms' }}
              onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
              onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}>
              <Icon name="plus" size={13} strokeWidth={2.5} />
              New
            </button>
          )}

          <button onClick={() => setScreen('notifications')}
            style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Icon name="bell" size={14} />
          </button>
          <button onClick={toggleTheme} className="press-scale" title="Toggle theme"
            style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={14} />
          </button>
          <button onClick={() => setHelpOpen(true)} className="press-scale" title="Keyboard shortcuts (⌘/)"
            style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Icon name="help" size={14} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
          <div key={screen} style={{ animation: 'slideUp 200ms var(--ease-out)', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {children}
          </div>
        </div>
      </div>

      {cmdOpen && <CommandPalette commands={visibleCmd} onNavigate={setScreen} onClose={() => setCmdOpen(false)} />}
      {helpOpen && <ShortcutsCheatsheet onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function BranchSwitcher({
  clinicName,
  currentBranchId,
  currentBranchName,
  branches,
  canSwitch,
  onSelect,
}: {
  clinicName: string;
  currentBranchId?: string;
  currentBranchName?: string;
  branches: { _id: string; name: string }[];
  canSwitch: boolean;
  onSelect: (b: { _id: string; name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const branchLabel = currentBranchName ?? (currentBranchId ? currentBranchId.slice(-6) : 'No branch');

  // Static chip — same visual as before, no popover when the user
  // can't switch (single-branch clinic or no branch:read perm).
  if (!canSwitch) {
    return (
      <div style={{ margin: '12px 12px 4px', padding: '8px 12px', background: 'var(--surface-muted)', borderRadius: 10, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {clinicName}
        </div>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {branchLabel}
        </span>
      </div>
    );
  }

  return (
    <div ref={ref} style={{ position: 'relative', margin: '12px 12px 4px' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch branch"
        style={{
          width: '100%',
          padding: '8px 12px',
          background: open ? 'var(--brand-50)' : 'var(--surface-muted)',
          borderRadius: 10,
          border: `1px solid ${open ? 'var(--brand-500)' : 'var(--border)'}`,
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)',
        }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {clinicName}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: open ? 'var(--brand-600)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {branchLabel}
          </span>
          <Icon name="chevronDown" size={12} style={{
            color: open ? 'var(--brand-600)' : 'var(--text-subtle)',
            flexShrink: 0,
            transition: 'transform var(--dur-fast) var(--ease-out)',
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
          }} />
        </div>
      </button>

      {open && (
        <div role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: 'var(--e3)',
            zIndex: 50,
            padding: 4,
            maxHeight: 280,
            overflowY: 'auto',
            animation: 'pickerIn var(--dur-base) var(--ease-out)',
          }}>
          <div style={{ padding: '6px 10px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Switch branch
          </div>
          {branches.map((b) => {
            const isSelected = b._id === currentBranchId;
            return (
              <button
                key={b._id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => { onSelect(b); setOpen(false); }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  border: 'none',
                  borderRadius: 7,
                  background: 'transparent',
                  color: isSelected ? 'var(--brand-600)' : 'var(--text)',
                  fontSize: 12,
                  fontWeight: isSelected ? 700 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background var(--dur-fast) var(--ease-out)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--brand-bg-soft)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <Icon name="mapPin" size={12} style={{ color: isSelected ? 'var(--brand-500)' : 'var(--text-subtle)' }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                {isSelected && <Icon name="check" size={12} style={{ color: 'var(--brand-600)' }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ShortcutsCheatsheet({ onClose }: { onClose: () => void }) {
  const groups: { title: string; rows: { keys: string[]; label: string }[] }[] = [
    {
      title: 'Navigation',
      rows: [
        { keys: ['⌘', 'K'], label: 'Open command palette' },
        { keys: ['⌘', '/'], label: 'Show shortcuts' },
        { keys: ['Esc'], label: 'Close modals & sheets' },
      ],
    },
    {
      title: 'Actions',
      rows: [
        { keys: ['+ New'], label: 'Register a new patient (header button)' },
        { keys: ['Enter'], label: 'Submit forms / pick highlighted result' },
        { keys: ['↑ ↓'], label: 'Navigate the command palette' },
      ],
    },
  ];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)', animation: 'fadeIn 150ms ease-out' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', overflow: 'hidden', animation: 'slideUp 200ms ease-out' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Keyboard shortcuts</div>
          <button onClick={onClose} className="press-scale"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ padding: '14px 22px 22px' }}>
          {groups.map((g) => (
            <div key={g.title} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{g.title}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {g.rows.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{r.label}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {r.keys.map((k) => (
                        <kbd key={k} style={{ padding: '2px 8px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', fontWeight: 600 }}>{k}</kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
