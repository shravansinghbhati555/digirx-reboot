import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useApp } from '../../app/AppContext';
import {
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  PinError,
  VAULT_CHANGED_EVENT,
  canResetDevice,
  changePin,
  hasPendingRecoveryUpload,
  hasPin,
  isLocked,
  isVaultOpen,
  lock,
  recoverDevice,
  resetDevice,
  setupDevicePin,
  touchActivity,
  validatePin,
  verifyPin,
} from '../../offline';
import { GhostButton, PrimaryButton, Checkbox, labelStyle, useToast } from './primitives';

/**
 * Device PIN gate — tickets A4 + P6.
 *
 * Three states, decided per render:
 *   - no PIN on this device yet → mandatory setup, nothing else renders
 *   - PIN set, key not in memory (fresh launch) → unlock, nothing else renders;
 *     the screens would only fail trying to read the encrypted cache
 *   - PIN set, key in memory, idle too long → unlock **over** the app. The app
 *     stays mounted underneath (inert and covered) so a half-written
 *     consultation survives the lock.
 */
export function DeviceLockGate({ children }: { children: ReactNode }) {
  const { loggedIn } = useApp();
  const state = useDeviceLockState(loggedIn);
  // Held here, not in the setup/forgot screens: setting a PIN opens the vault,
  // which flips `state` to open and would unmount those screens before the
  // user had a chance to write the code down.
  const [pendingCode, setPendingCode] = useState<{ code: string; intro: string } | null>(null);
  const showCode = useCallback((code: string, intro: string) => setPendingCode({ code, intro }), []);

  if (!loggedIn) return <>{children}</>;

  if (pendingCode) {
    const appReady = state === 'open' || state === 'idle-locked';
    return (
      <>
        {appReady && (
          <div inert aria-hidden style={{ display: 'contents' }}>
            {children}
          </div>
        )}
        <RecoveryCodeScreen
          overlay
          code={pendingCode.code}
          intro={pendingCode.intro}
          onDone={() => {
            setPendingCode(null);
            // Setup and recovery open the vault silently; this is the moment
            // the app is allowed to resume.
            window.dispatchEvent(new Event(VAULT_CHANGED_EVENT));
          }}
        />
      </>
    );
  }

  if (state === 'setup') return <PinSetupScreen onCode={showCode} />;
  if (state === 'cold-locked') return <PinUnlockScreen onCode={showCode} />;

  const idleLocked = state === 'idle-locked';
  return (
    <>
      <div inert={idleLocked} aria-hidden={idleLocked || undefined} style={{ display: 'contents' }}>
        {children}
      </div>
      {idleLocked && <PinUnlockScreen overlay onCode={showCode} />}
    </>
  );
}

type ShowCode = (code: string, intro: string) => void;

type LockState = 'setup' | 'cold-locked' | 'idle-locked' | 'open';

function readState(): LockState {
  if (!hasPin()) return 'setup';
  if (!isVaultOpen()) return 'cold-locked';
  return isLocked() ? 'idle-locked' : 'open';
}

function useDeviceLockState(active: boolean): LockState {
  const [state, setState] = useState<LockState>(() => readState());

  useEffect(() => {
    if (!active) return;
    const refresh = () => setState(readState());
    refresh();
    // The idle transition happens with the passage of time, not an event.
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener(VAULT_CHANGED_EVENT, refresh);
    document.addEventListener('visibilitychange', refresh);
    // Real activity pushes the idle timer out (throttled inside pin.ts).
    const onActivity = () => touchActivity();
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(VAULT_CHANGED_EVENT, refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, [active]);

  return state;
}

// --------------------------------------------------------------- layout

function LockLayout({ children, overlay }: { children: ReactNode; overlay?: boolean }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: overlay ? 'fixed' : 'relative',
        inset: overlay ? 0 : undefined,
        zIndex: overlay ? 10_000 : undefined,
        minHeight: '100dvh',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        boxSizing: 'border-box',
        fontFamily: "'Inter',sans-serif",
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--e3)',
          padding: 24,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {children}
      </div>
    </div>
  );
}

const titleStyle: CSSProperties = { margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' };
const bodyStyle: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' };
const errorStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--danger-text)',
  background: 'var(--danger-bg)',
  borderRadius: 8,
  padding: '8px 10px',
};
const linkStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--text-muted)',
  fontSize: 12,
  textDecoration: 'underline',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

function PinField({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={MAX_PIN_LENGTH}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        style={{
          width: '100%',
          height: 44,
          padding: '0 12px',
          background: 'var(--surface-muted)',
          border: '1.5px solid var(--border)',
          borderRadius: 8,
          fontSize: 20,
          letterSpacing: 6,
          color: 'var(--text)',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  mono,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          height: 40,
          padding: '0 12px',
          background: 'var(--surface-muted)',
          border: '1.5px solid var(--border)',
          borderRadius: 8,
          fontSize: mono ? 16 : 13,
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
          letterSpacing: mono ? 1 : undefined,
          textTransform: mono ? 'uppercase' : undefined,
          color: 'var(--text)',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function pinProblem(pin: string, confirm: string): string | null {
  try {
    validatePin(pin);
  } catch (e) {
    return e instanceof PinError ? e.message : 'Invalid PIN.';
  }
  if (pin !== confirm) return 'The two PINs do not match.';
  return null;
}

// ---------------------------------------------------------------- setup

function PinSetupScreen({ onCode }: { onCode: ShowCode }) {
  const { ctx } = useApp();
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [label, setLabel] = useState(() => (ctx.fullName ? `${ctx.fullName}'s tablet` : ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = pinProblem(pin, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const code = await setupDevicePin(pin, label.trim() || undefined);
      onCode(
        code,
        'Your PIN is set. This is the unlock code for this tablet. If the PIN is ever forgotten, it is the only way back in without losing unsynced work.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the PIN.');
      setBusy(false);
    }
  }

  return (
    <LockLayout>
      <h1 style={titleStyle}>Set a PIN for this device</h1>
      <p style={bodyStyle}>
        Patient records saved on this device for offline use are encrypted with this PIN. You will
        need it each time the app opens and after 15 minutes without use.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PinField label={`PIN (${MIN_PIN_LENGTH}–${MAX_PIN_LENGTH} digits)`} value={pin} onChange={setPinValue} autoFocus />
        <PinField label="Confirm PIN" value={confirm} onChange={setConfirm} />
        <TextField
          label="Device name (shown to your clinic admin)"
          value={label}
          onChange={setLabel}
          placeholder="e.g. Front desk tablet"
        />
        {error && <p style={errorStyle}>{error}</p>}
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? 'Encrypting…' : 'Set PIN'}
        </PrimaryButton>
      </form>
    </LockLayout>
  );
}

// ---------------------------------------------------------------- unlock

function PinUnlockScreen({ overlay, onCode }: { overlay?: boolean; onCode: ShowCode }) {
  const { logout, ctx } = useApp();
  const [mode, setMode] = useState<'pin' | 'forgot'>('pin');
  const [pin, setPinValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [busy, setBusy] = useState(false);
  const now = useNow(blockedUntil > Date.now());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pin) return;
    setBusy(true);
    setError(null);
    try {
      const res = await verifyPin(pin);
      if (res.ok) {
        setPinValue('');
        window.dispatchEvent(new Event(VAULT_CHANGED_EVENT));
      } else {
        setError(res.reason);
        setPinValue('');
        if (res.blockedForMs) setBlockedUntil(Date.now() + res.blockedForMs);
      }
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'forgot') {
    return <ForgotPinScreen overlay={overlay} onCode={onCode} onBack={() => setMode('pin')} />;
  }

  const waitS = Math.max(0, Math.ceil((blockedUntil - now) / 1000));

  return (
    <LockLayout overlay={overlay}>
      <h1 style={titleStyle}>Device locked</h1>
      <p style={bodyStyle}>
        {ctx.fullName ? `Signed in as ${ctx.fullName}. ` : ''}Enter this device’s PIN to continue.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PinField label="PIN" value={pin} onChange={setPinValue} autoFocus />
        {error && <p style={errorStyle}>{waitS > 0 ? `${error} (${waitS}s)` : error}</p>}
        <PrimaryButton type="submit" disabled={busy || waitS > 0 || !pin}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </PrimaryButton>
      </form>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button type="button" style={linkStyle} onClick={() => setMode('forgot')}>
          Forgot PIN?
        </button>
        <button type="button" style={linkStyle} onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </LockLayout>
  );
}

function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [ticking]);
  return now;
}

// ---------------------------------------------------------------- forgot

function ForgotPinScreen({
  overlay,
  onBack,
  onCode,
}: {
  overlay?: boolean;
  onBack: () => void;
  onCode: ShowCode;
}) {
  const { logout } = useApp();
  const [code, setCode] = useState('');
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resettable, setResettable] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    void canResetDevice().then(setResettable);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = pinProblem(pin, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await recoverDevice(code, pin);
      if (res.ok) {
        onCode(
          res.recoveryCode,
          'Your new PIN is set. The code you just used no longer works — this is the new unlock code for this tablet.',
        );
        return;
      }
      setError(res.reason);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the PIN.');
    }
    setBusy(false);
  }

  async function reset() {
    setBusy(true);
    try {
      await resetDevice();
      await logout();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset this device.');
      setBusy(false);
    }
  }

  return (
    <LockLayout overlay={overlay}>
      <h1 style={titleStyle}>Forgot PIN</h1>
      <p style={bodyStyle}>
        Ask your clinic admin for this tablet’s unlock code. They can find it in{' '}
        <strong>Settings → Devices</strong>, or on the paper it was written down on when the PIN
        was first set. Nothing saved on this device is lost.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <TextField label="Unlock code" value={code} onChange={setCode} placeholder="XXXX-XXXX-XXXX-XXXX" mono autoFocus />
        <PinField label="New PIN" value={pin} onChange={setPinValue} />
        <PinField label="Confirm new PIN" value={confirm} onChange={setConfirm} />
        {error && <p style={errorStyle}>{error}</p>}
        <PrimaryButton type="submit" disabled={busy || !code}>
          {busy ? 'Checking…' : 'Set new PIN'}
        </PrimaryButton>
      </form>
      <button type="button" style={linkStyle} onClick={onBack}>
        Back
      </button>
      {resettable && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ ...bodyStyle, fontSize: 12 }}>
            No unlock code? Everything on this device has already synced, so it can be reset safely.
            You will sign in again and set a new PIN.
          </p>
          {confirmReset ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <GhostButton onClick={() => setConfirmReset(false)} disabled={busy}>Cancel</GhostButton>
              <PrimaryButton onClick={() => void reset()} disabled={busy}>Reset this device</PrimaryButton>
            </div>
          ) : (
            <GhostButton onClick={() => setConfirmReset(true)}>Reset this device…</GhostButton>
          )}
        </div>
      )}
    </LockLayout>
  );
}

// ---------------------------------------------------------- recovery code

function RecoveryCodeScreen({
  code,
  intro,
  onDone,
  overlay,
}: {
  code: string;
  intro: string;
  onDone: () => void;
  overlay?: boolean;
}) {
  const [saved, setSaved] = useState(false);

  const print = useCallback(() => {
    const w = window.open('', '_blank', 'width=420,height=320');
    if (!w) return;
    w.document.write(
      `<!doctype html><title>Unlock code</title><body style="font-family:sans-serif;padding:24px">` +
        `<h2 style="margin:0 0 8px">DigiRx tablet unlock code</h2>` +
        `<p style="margin:0 0 16px;color:#555">Keep this somewhere safe. It unlocks this tablet if its PIN is forgotten.</p>` +
        `<p style="font:600 26px monospace;letter-spacing:2px;margin:0">${code}</p>` +
        `<p style="margin:16px 0 0;color:#555;font-size:12px">Created ${new Date().toLocaleString()}</p></body>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }, [code]);

  return (
    <LockLayout overlay={overlay}>
      <h1 style={titleStyle}>Save the unlock code</h1>
      <p style={bodyStyle}>{intro}</p>
      <div
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: 2,
          textAlign: 'center',
          padding: '14px 8px',
          background: 'var(--surface-muted)',
          border: '1.5px dashed var(--border-strong)',
          borderRadius: 8,
          color: 'var(--text)',
          userSelect: 'all',
          wordBreak: 'break-all',
        }}
      >
        {code}
      </div>
      <p style={{ ...bodyStyle, fontSize: 12 }}>
        Your clinic admin can also see it in <strong>Settings → Devices</strong> once this tablet is
        next online. This screen will not show it again.
      </p>
      <GhostButton onClick={print}>Print</GhostButton>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text)' }}>
        <Checkbox checked={saved} onChange={setSaved} />
        I have written down or printed this code
      </label>
      <PrimaryButton disabled={!saved} onClick={onDone}>
        Continue
      </PrimaryButton>
    </LockLayout>
  );
}

/** Lock the screen right now. */
export function lockNow(): void {
  lock();
  window.dispatchEvent(new Event(VAULT_CHANGED_EVENT));
}

/**
 * Profile → "This device": lock now, change the PIN, and a warning while the
 * unlock code has not reached the clinic admin yet.
 */
export function DeviceSecurityCard() {
  const toast = useToast();
  const [codePending, setCodePending] = useState(false);
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const check = () => void hasPendingRecoveryUpload().then(setCodePending);
    check();
    const t = window.setInterval(check, 30_000);
    return () => window.clearInterval(t);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = pinProblem(next, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePin(current, next);
      toast('PIN changed', 'success');
      setChanging(false);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the PIN.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>This device</div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
          Patient records saved here for offline use are encrypted with this device’s PIN. It locks
          after 15 minutes without use.
        </div>
      </div>
      {codePending && (
        <div style={{ fontSize: 12, color: 'var(--warning-text)', background: 'var(--warning-bg)', borderRadius: 8, padding: '8px 10px' }}>
          This tablet’s unlock code has not reached your clinic admin yet. It will be sent the next
          time the device is online — until then, keep the written copy safe.
        </div>
      )}
      {changing ? (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320 }}>
          <PinField label="Current PIN" value={current} onChange={setCurrent} autoFocus />
          <PinField label="New PIN" value={next} onChange={setNext} />
          <PinField label="Confirm new PIN" value={confirm} onChange={setConfirm} />
          {error && <p style={errorStyle}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <GhostButton onClick={() => setChanging(false)} disabled={busy}>Cancel</GhostButton>
            <PrimaryButton type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change PIN'}</PrimaryButton>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <PrimaryButton onClick={lockNow}>Lock now</PrimaryButton>
          <GhostButton onClick={() => setChanging(true)}>Change PIN</GhostButton>
        </div>
      )}
    </div>
  );
}
