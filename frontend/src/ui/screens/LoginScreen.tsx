import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../app/api';
import type { DevContext } from '../../app/context';
import { useApp } from '../../app/AppContext';
import { Icon } from '../shared/Icon';
import { Spinner, useToast, labelStyle } from '../shared/primitives';

type ClinicResult = { id: string; name: string; countryCode?: string; timezone?: string };
type BranchAddress = { street?: string; city?: string; state?: string; zip?: string; country?: string };
type BranchResult = { id: string; name: string; address?: BranchAddress | string | null };

function formatAddress(addr: BranchResult['address']): string {
  if (!addr) return '';
  if (typeof addr === 'string') return addr;
  const parts = [addr.street, addr.city, addr.state, addr.zip, addr.country].filter(Boolean);
  return parts.join(', ');
}

type LoginResponse = {
  accessToken: string;
  userId: string;
  clinicId: string;
  branchId: string | null;
};

type PendingAuth = {
  clinic: ClinicResult;
  accessToken: string;
  userId: string;
  email: string;
};

export function LoginScreen() {
  const { ctx, setCtx } = useApp();
  const toast = useToast();

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [apiBaseUrl, setApiBaseUrl] = useState(ctx.apiBaseUrl);
  const [pendingAuth, setPendingAuth] = useState<PendingAuth | null>(null);
  const [pendingBranch, setPendingBranch] = useState<BranchResult | null>(null);

  const goNext = (auth: PendingAuth) => { setPendingAuth(auth); setStep(1); };
  const finishBranch = (branch: BranchResult | null) => { setPendingBranch(branch); setStep(2); };

  const finalize = () => {
    if (!pendingAuth) return;
    setCtx({
      ...ctx,
      apiBaseUrl,
      userId: pendingAuth.userId,
      clinicId: pendingAuth.clinic.id,
      clinicName: pendingAuth.clinic.name,
      branchId: pendingBranch?.id,
      branchName: pendingBranch?.name,
      accessToken: pendingAuth.accessToken,
      email: pendingAuth.email,
    });
    toast('Signed in', 'success');
  };

  const back = () => setStep((s) => (s > 0 ? ((s - 1) as 0 | 1 | 2) : s));

  return (
    <div style={{ display: 'flex', height: '100vh', minHeight: 600 }}>
      <BrandPanel />

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, overflowY: 'auto', position: 'relative' }}>
        <div style={{ width: '100%', maxWidth: 420, animation: 'slideUp 320ms var(--ease-out)' }}>
          <StepDots current={step} total={3} />

          {step === 0 && (
            <SignInStep
              apiBaseUrl={apiBaseUrl}
              setApiBaseUrl={setApiBaseUrl}
              onSuccess={goNext}
            />
          )}

          {step === 1 && pendingAuth && (
            <BranchPickerStep
              apiBaseUrl={apiBaseUrl}
              auth={pendingAuth}
              onBack={back}
              onSuccess={finishBranch}
            />
          )}

          {step === 2 && pendingAuth && (
            <WelcomeStep
              auth={pendingAuth}
              branch={pendingBranch}
              onFinish={finalize}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function BrandPanel() {
  return (
    <div style={{
      flex: '0 0 45%',
      background: 'linear-gradient(155deg, var(--brand-700) 0%, var(--brand-600) 45%, var(--brand-500) 100%)',
      display: 'flex', flexDirection: 'column', padding: 48, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, animation: 'fadeIn 320ms var(--ease-out)' }}>
        <div style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.18)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="cross" size={18} style={{ color: 'var(--brand-text)' }} strokeWidth={2.5} />
        </div>
        <span style={{ fontFamily: "'Manrope',sans-serif", fontSize: 22, fontWeight: 800, color: 'var(--brand-text)', letterSpacing: '-0.5px' }}>
          Digi<span style={{ opacity: 0.7, fontWeight: 600 }}>Rx</span>
        </span>
      </div>

      <div style={{ marginTop: 'auto', animation: 'slideUp 400ms var(--ease-out) 100ms both' }}>
        <h2 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 32, fontWeight: 700, color: 'var(--brand-text)', lineHeight: 1.25, letterSpacing: '-0.5px', marginBottom: 12 }}>
          Healthcare,<br />simplified.
        </h2>
        <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6, maxWidth: 320 }}>
          A focused clinical platform for doctors, front-desk, and billing — all in one place.
        </p>
      </div>

      <div style={{ marginTop: 40, display: 'flex', gap: 24, animation: 'fadeIn 500ms var(--ease-out) 200ms both' }}>
        {[
          { icon: 'shield' as const, label: 'PHI protected' },
          { icon: 'users' as const, label: 'Multi-tenant' },
          { icon: 'activity' as const, label: 'Audit logged' },
        ].map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 500 }}>
            <Icon name={s.icon} size={14} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div role="progressbar" aria-valuenow={current + 1} aria-valuemax={total}
      style={{ display: 'flex', gap: 6, marginBottom: 32 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i}
          style={{
            height: 4,
            borderRadius: 2,
            width: i === current ? 24 : 8,
            background: i < current ? 'var(--success-500)' : i === current ? 'var(--brand-500)' : 'var(--border)',
            transition: 'width 320ms var(--ease-out), background 200ms var(--ease-out)',
          }}
        />
      ))}
    </div>
  );
}

/* ── Step 0: Sign In ──────────────────────────────────────── */

function SignInStep({
  apiBaseUrl, setApiBaseUrl, onSuccess,
}: {
  apiBaseUrl: string;
  setApiBaseUrl: (v: string) => void;
  onSuccess: (auth: PendingAuth) => void;
}) {
  const { ctx, setCtx } = useApp();
  const toast = useToast();
  const [clinic, setClinic] = useState<ClinicResult | null>(null);
  const [email, setEmail] = useState('admin@digirx.local');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<{ clinic?: string; email?: string; password?: string; general?: string }>({});
  const [btnState, setBtnState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [shakeKey, setShakeKey] = useState(0);

  function validate() {
    const e: typeof errors = {};
    if (!clinic) e.clinic = 'Please select a clinic.';
    if (!email || !/\S+@\S+\.\S+/.test(email)) e.email = 'Enter a valid email address.';
    if (!password || password.length < 6) e.password = 'Password must be at least 6 characters.';
    return e;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); setShakeKey((k) => k + 1); return; }
    setErrors({});
    setBtnState('loading');
    try {
      const res = await apiPost<LoginResponse>({ ...ctx, apiBaseUrl } as DevContext, '/auth/login', {
        clinicId: clinic!.id,
        email,
        password,
      });
      setBtnState('success');
      setTimeout(() => onSuccess({ clinic: clinic!, accessToken: res.accessToken, userId: res.userId, email }), 600);
    } catch (err) {
      setBtnState('error');
      setShakeKey((k) => k + 1);
      setTimeout(() => setBtnState('idle'), 600);
      setErrors({ general: err instanceof Error ? err.message : String(err) });
    }
  }


  return (
    <div style={{ animation: 'slideUp 200ms var(--ease-out) both' }}>
      <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 26, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.4px', marginBottom: 6 }}>
        Welcome back
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 24 }}>
        Sign in to your DigiRx account.
      </p>

      {errors.general && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 8, marginBottom: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger-500)', fontSize: 13 }}>
          <Icon name="alertTriangle" size={16} style={{ flexShrink: 0 }} />
          <span>{errors.general}</span>
        </div>
      )}

      <form key={shakeKey} onSubmit={handleSubmit} noValidate
        style={shakeKey ? { animation: 'shakeX 240ms var(--ease-out)' } : undefined}>
        <FormGroup label="Clinic">
          <ClinicCombobox apiBaseUrl={apiBaseUrl} value={clinic} onChange={(c) => { setClinic(c); setErrors((prev) => ({ ...prev, clinic: undefined })); }} error={!!errors.clinic} />
          {errors.clinic && <FieldError>{errors.clinic}</FieldError>}
        </FormGroup>

        <FormGroup label="Email address">
          <InputWrap icon="mail">
            <input type="email" placeholder="you@clinic.in" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
              className="form-input" style={inputStyle(!!errors.email)} />
          </InputWrap>
          {errors.email && <FieldError>{errors.email}</FieldError>}
        </FormGroup>

        <FormGroup label="Password">
          <InputWrap icon="lock">
            <input type={showPw ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
              style={{ ...inputStyle(!!errors.password), paddingRight: 44 }} />
            <button type="button" onClick={() => setShowPw((v) => !v)}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 6, borderRadius: 6, display: 'flex' }}
              aria-label={showPw ? 'Hide password' : 'Show password'}>
              <Icon name="eye" size={16} />
            </button>
          </InputWrap>
          {errors.password && <FieldError>{errors.password}</FieldError>}
        </FormGroup>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -10, marginBottom: 20 }}>
          <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--brand-500)', padding: 0 }}>
            Forgot password?
          </button>
        </div>

        <button type="submit" disabled={btnState === 'loading' || btnState === 'success'}
          style={{
            width: '100%', height: 48,
            background: btnState === 'success' ? 'var(--success-500)' : 'var(--brand-500)',
            color: 'var(--brand-text)', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600,
            cursor: btnState === 'loading' || btnState === 'success' ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: btnState === 'loading' ? 0.85 : 1, transition: 'background 200ms',
          }}>
          {btnState === 'loading' && <Spinner size={18} />}
          {btnState === 'success' && (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" strokeDasharray="24" strokeDashoffset="0" style={{ animation: 'checkDraw 280ms var(--ease-out) forwards' }} />
            </svg>
          )}
          {btnState === 'idle' && 'Sign in'}
          {btnState === 'loading' && 'Signing in…'}
          {btnState === 'success' && 'Signed in'}
          {btnState === 'error' && 'Try again'}
        </button>
      </form>

    </div>
  );
}

/* ── Step 1: Branch Picker ────────────────────────────────── */

function BranchPickerStep({
  apiBaseUrl, auth, onBack, onSuccess,
}: {
  apiBaseUrl: string;
  auth: PendingAuth;
  onBack: () => void;
  onSuccess: (branch: BranchResult | null) => void;
}) {
  const { ctx } = useApp();
  const [branches, setBranches] = useState<BranchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BranchResult | null>(null);
  const [continuing, setContinuing] = useState(false);

  useEffect(() => {
    apiGet<BranchResult[]>({ ...ctx, apiBaseUrl } as DevContext, `/clinic/${auth.clinic.id}/branches`)
      .then((data) => {
        setBranches(data);
        if (data.length === 1) setSelected(data[0]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [apiBaseUrl, auth.clinic.id, ctx]);

  function handleContinue() {
    if (branches && branches.length > 0 && !selected) return;
    setContinuing(true);
    setTimeout(() => onSuccess(selected), 400);
  }

  return (
    <div style={{ animation: 'slideUp 200ms var(--ease-out) both' }}>
      <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 26, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.4px', marginBottom: 6 }}>
        Pick a branch
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 24 }}>
        Select the branch you are operating from today.
      </p>

      {error && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 8, marginBottom: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger-500)', fontSize: 13 }}>
          <Icon name="alertTriangle" size={16} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {!branches && !error && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>Loading branches…</div>
      )}

      {branches && branches.length === 0 && (
        <div style={{ padding: '20px 16px', textAlign: 'center', background: 'var(--surface-muted)', border: '1px dashed var(--border)', borderRadius: 12, color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
          This clinic has no branches configured. You can continue without one.
        </div>
      )}

      {branches && branches.length > 0 && (
        <div role="radiogroup" aria-label="Branches" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {branches.map((b, i) => {
            const isSel = selected?.id === b.id;
            return (
              <div key={b.id} role="radio" aria-checked={isSel} tabIndex={0}
                onClick={() => setSelected(b)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelected(b); }}
                style={{
                  padding: 16, border: `1.5px solid ${isSel ? 'var(--brand-500)' : 'var(--border)'}`,
                  borderRadius: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 14,
                  background: isSel ? 'var(--brand-50)' : 'var(--surface)',
                  boxShadow: isSel ? '0 0 0 3px rgba(59,130,246,0.12)' : 'none',
                  transition: 'all 200ms var(--ease-out)',
                  animation: `slideUp 200ms var(--ease-out) ${i * 50}ms both`,
                }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand-100)', color: 'var(--brand-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="mapPin" size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{b.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {formatAddress(b.address) || <span style={{ fontFamily: 'monospace' }}>{b.id.slice(-12)}</span>}
                  </div>
                </div>
                <div style={{ color: 'var(--brand-500)', opacity: isSel ? 1 : 0, transform: isSel ? 'scale(1)' : 'scale(0.8)', transition: 'opacity 200ms, transform 200ms var(--ease-out)' }}>
                  <Icon name="check" size={18} strokeWidth={2.5} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button onClick={handleContinue} disabled={continuing || (branches !== null && branches.length > 0 && !selected)}
        style={{
          width: '100%', height: 48, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none',
          borderRadius: 12, fontSize: 15, fontWeight: 600,
          cursor: continuing ? 'wait' : (branches && branches.length > 0 && !selected ? 'not-allowed' : 'pointer'),
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          opacity: (branches && branches.length > 0 && !selected) ? 0.6 : 1,
        }}>
        {continuing ? <Spinner size={18} /> : null}
        {continuing ? 'Loading…' : 'Continue'}
        {!continuing && <Icon name="chevronRight" size={16} />}
      </button>

      <button onClick={onBack} type="button"
        style={{
          width: '100%', height: 44, background: 'none', border: '1.5px solid var(--border)', borderRadius: 12,
          fontSize: 14, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer', marginTop: 10,
        }}>
        ← Back
      </button>
    </div>
  );
}

/* ── Step 2: Welcome ──────────────────────────────────────── */

function WelcomeStep({ auth, branch, onFinish }: { auth: PendingAuth; branch: BranchResult | null; onFinish: () => void }) {
  const firstName = (auth.email.split('@')[0].split('.')[0] || 'there').replace(/[^a-zA-Z]/g, '');
  const name = firstName ? firstName[0].toUpperCase() + firstName.slice(1) : 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div style={{ textAlign: 'center', animation: 'slideInRight 320ms var(--ease-out)' }}>
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: 'rgba(16,185,129,0.1)', border: '2px solid var(--success-500)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px',
        animation: 'slideUp 300ms var(--ease-out)',
      }}>
        <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="var(--success-500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" strokeDasharray="24" strokeDashoffset="0" style={{ animation: 'checkDraw 280ms var(--ease-out) forwards' }} />
        </svg>
      </div>

      <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 26, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.4px', marginBottom: 6 }}>
        {greeting}, {name}
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 0 }}>
        You're signed in and ready to go.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, margin: '16px 0 32px', flexWrap: 'wrap' }}>
        <span style={{ padding: '4px 12px', borderRadius: 100, fontSize: 12, fontWeight: 600, background: 'var(--brand-50)', color: 'var(--brand-600)', border: '1px solid var(--brand-100)' }}>
          {auth.clinic.name}
        </span>
        {branch && (
          <span style={{ padding: '4px 12px', borderRadius: 100, fontSize: 12, fontWeight: 500, background: 'var(--surface-muted)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            {branch.name}
          </span>
        )}
        <span style={{ padding: '4px 12px', borderRadius: 100, fontSize: 12, fontWeight: 500, background: 'var(--surface-muted)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
          {auth.email}
        </span>
      </div>

      <button onClick={onFinish}
        style={{
          width: '100%', height: 48, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none',
          borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          animation: 'slideUp 200ms var(--ease-out) 100ms both',
        }}>
        Go to dashboard
        <Icon name="chevronRight" size={16} />
      </button>
    </div>
  );
}

/* ── Clinic Combobox ──────────────────────────────────────── */

function ClinicCombobox({
  apiBaseUrl, value, onChange, error,
}: {
  apiBaseUrl: string;
  value: ClinicResult | null;
  onChange: (c: ClinicResult | null) => void;
  error: boolean;
}) {
  const { ctx } = useApp();
  const [query, setQuery] = useState(value?.name ?? '');
  const [results, setResults] = useState<ClinicResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await apiGet<ClinicResult[]>({ ...ctx, apiBaseUrl } as DevContext, `/clinic/search?q=${encodeURIComponent(query.trim())}`);
        setResults(data);
        setHighlighted(data.length ? 0 : -1);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, apiBaseUrl, open, ctx]);

  // Close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function select(c: ClinicResult) {
    onChange(c);
    setQuery(c.name);
    setOpen(false);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (!open) { if (e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Enter' && highlighted >= 0 && results[highlighted]) { e.preventDefault(); select(results[highlighted]); }
    if (e.key === 'Escape') setOpen(false);
  }

  function badge(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <InputWrap icon="building">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); onChange(null); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder="Search clinic by name"
          autoComplete="off"
          aria-expanded={open}
          aria-autocomplete="list"
          style={inputStyle(error)}
        />
      </InputWrap>
      {open && (results.length > 0 || loading) && (
        <div role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
            boxShadow: '0 12px 32px rgba(15,23,42,0.10)', overflow: 'hidden', zIndex: 10,
            animation: 'slideUp 150ms var(--ease-out)',
            maxHeight: 240, overflowY: 'auto',
          }}>
          {loading && results.length === 0 && (
            <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-subtle)' }}>Searching…</div>
          )}
          {results.map((c, i) => (
            <div key={c.id} role="option" aria-selected={value?.id === c.id}
              onMouseDown={() => select(c)}
              onMouseEnter={() => setHighlighted(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', cursor: 'pointer',
                background: i === highlighted ? 'var(--brand-50)' : 'transparent',
                fontSize: 14, color: 'var(--text)',
              }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-100)', color: 'var(--brand-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Manrope',sans-serif", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {badge(c.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 1, fontFamily: 'monospace' }}>{c.id.slice(-12)}</div>
              </div>
              {value?.id === c.id && <Icon name="check" size={16} style={{ color: 'var(--brand-500)' }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Tiny helpers ─────────────────────────────────────────── */

function FormGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--danger-500)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
      <Icon name="alertTriangle" size={12} />
      {children}
    </div>
  );
}

function InputWrap({ icon, children }: { icon: 'mail' | 'lock' | 'building'; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)', pointerEvents: 'none', display: 'flex' }}>
        {icon === 'building'
          ? (<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18M3 9h18M3 15h18" /></svg>)
          : <Icon name={icon} size={16} />}
      </span>
      {children}
    </div>
  );
}

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    width: '100%', height: 44, padding: '0 14px 0 40px',
    fontSize: 14, color: 'var(--text)', background: 'var(--surface-muted)',
    border: `1.5px solid ${hasError ? 'var(--danger-500)' : 'var(--border)'}`,
    borderRadius: 12, outline: 'none', boxSizing: 'border-box',
    transition: 'border-color 200ms, background 200ms, box-shadow 200ms',
  };
}

function SmallField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', height: 36, padding: '0 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text)', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }} />
    </div>
  );
}
