import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiGet, apiPost, apiPostMultipart } from '../../app/api';
import type { DevContext } from '../../app/context';
import { useApp } from '../../app/AppContext';
import { useIsMobile } from '../../app/useIsMobile';
import { Icon } from '../shared/Icon';
import { Spinner, useToast, labelStyle } from '../shared/primitives';
import { FaceScanModal } from '../shared/FaceScanModal';

type ClinicResult = { id: string; name: string; countryCode?: string; timezone?: string };
type BranchAddress = { street?: string; city?: string; state?: string; zip?: string; country?: string };
type BranchResult = { id: string; name: string; address?: BranchAddress | string | null };

function formatAddress(addr: BranchResult['address']): string {
  if (!addr) return '';
  if (typeof addr === 'string') return addr;
  const parts = [addr.street, addr.city, addr.state, addr.zip, addr.country].filter(Boolean);
  return parts.join(', ');
}


type SignupResponse = {
  accessToken: string;
  userId: string;
  clinicId: string;
  branchId: string;
  clinicName: string;
  branchName: string;
};

type PendingAuth = {
  clinic: ClinicResult;
  accessToken: string;
  userId: string;
  email: string;
  roles?: string[];
};

export function LoginScreen() {
  const { ctx, setCtx } = useApp();
  const toast = useToast();
  const isMobile = useIsMobile();
  const location = useLocation();
  // `state.reason === 'session-expired'` is set by AppContext when a
  // 401 (after a failed refresh) boots the user back here. We surface a
  // one-line banner + a one-shot toast so they know it was an expiry,
  // not a credential problem.
  const expiredReason = (location.state as { reason?: string } | null)?.reason === 'session-expired';
  const sessionExpiredToastedRef = useRef(false);
  useEffect(() => {
    if (expiredReason && !sessionExpiredToastedRef.current) {
      sessionExpiredToastedRef.current = true;
      toast('Your session has expired. Please sign in again.', 'error');
    }
  }, [expiredReason, toast]);

  // 'signin' uses the 3-step wizard (sign in → pick branch → welcome).
  // 'signup' uses a single bootstrap form that creates the clinic + admin
  // + default branch in one shot, then jumps straight to welcome (step 2).
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [apiBaseUrl] = useState(ctx.apiBaseUrl);
  const [pendingAuth, setPendingAuth] = useState<PendingAuth | null>(null);
  const [pendingBranch, setPendingBranch] = useState<BranchResult | null>(null);

  // Sign-in is now single-step (SignInStep handles login + setCtx
  // directly via /auth/login-by-email). The signup flow still uses
  // the 3-step wizard so finishSignup / branch picker stay below.
  const finishBranch = (branch: BranchResult | null) => { setPendingBranch(branch); setStep(2); };

  // Signup short-circuits the branch picker — the freshly created clinic
  // has exactly one branch and the BE already returned it, so we set
  // both pendingAuth and pendingBranch in one move and jump to step 2.
  const finishSignup = (auth: PendingAuth, branch: BranchResult) => {
    setPendingAuth(auth);
    setPendingBranch(branch);
    setStep(2);
  };

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
      timezone: pendingAuth.clinic.timezone,
    });
    toast(mode === 'signup' ? 'Account created' : 'Signed in', 'success');
  };

  const back = () => setStep((s) => (s > 0 ? ((s - 1) as 0 | 1 | 2) : s));

  return (
    <div style={{ display: 'flex', height: '100vh', minHeight: 600 }}>
      {!isMobile && <BrandPanel />}

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, overflowY: 'auto', position: 'relative' }}>
        <div style={{ width: '100%', maxWidth: 420, animation: 'slideUp 320ms var(--ease-out)' }}>
          {/* On mobile the brand hero is hidden, so surface the DigiRx logo
              above the form (shown for both sign-in and sign-up). */}
          {isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8, marginBottom: 28 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--brand-500)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="cross" size={17} style={{ color: 'var(--brand-text)' }} strokeWidth={2.5} />
              </div>
              <span style={{ fontFamily: "'Manrope',sans-serif", fontSize: 22, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.4px' }}>
                Digi<span style={{ color: 'var(--brand-500)' }}>Rx</span>
              </span>
            </div>
          )}
          {/* Signin is single-step now — only show the step dots for
              the signup wizard (which still has Create / Welcome). */}
          {mode === 'signup' && <StepDots current={step} total={3} />}

          {expiredReason && step === 0 && (
            <div
              role="status"
              style={{
                marginTop: 12,
                marginBottom: 16,
                padding: '10px 14px',
                background: 'var(--warning-bg-soft)',
                border: '1px solid var(--warning-border-soft)',
                borderRadius: 10,
                fontSize: 12,
                color: 'var(--warning-text)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
              }}
            >
              <Icon name="alertTriangle" size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Your session has expired. Please sign in again to continue.</span>
            </div>
          )}

          {step === 0 && mode === 'signin' && (
            <SignInStep
              apiBaseUrl={apiBaseUrl}
              onSwitchToSignup={() => setMode('signup')}
            />
          )}

          {step === 0 && mode === 'signup' && (
            <SignUpStep
              apiBaseUrl={apiBaseUrl}
              onSuccess={finishSignup}
              onSwitchToSignin={() => setMode('signin')}
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

/* ── Step 0: Sign In (single-step, email + password) ───────── */

type LoginByEmailResponse = {
  accessToken: string;
  userId: string;
  clinicId: string;
  branchId: string | null;
  roles?: string[];
};

function SignInStep({
  apiBaseUrl, onSwitchToSignup,
}: {
  apiBaseUrl: string;
  onSwitchToSignup: () => void;
}) {
  const { ctx, setCtx } = useApp();
  const toast = useToast();
  const [email, setEmail] = useState('admin@digirx.local');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({});
  const [btnState, setBtnState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [forgotOpen, setForgotOpen] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [faceOpen, setFaceOpen] = useState(false);

  function validate() {
    const e: typeof errors = {};
    if (!email || !/\S+@\S+\.\S+/.test(email)) e.email = 'Enter a valid email address.';
    if (!password || password.length < 6) e.password = 'Password must be at least 6 characters.';
    return e;
  }

  // Face login. The scanner captures a frame; we POST it to
  // /auth/login-by-face. The BE identifies the staff member (cross-
  // clinic scan, anti-spoof in face-svc) and issues a session. Throws
  // on no-match so the FaceScanModal shows the error inline and the
  // user can retry or fall back to email + password.
  async function handleFaceLogin(blob: Blob, opts?: { preDetected?: boolean }) {
    const form = new FormData();
    form.append('image', blob, 'login.jpg');
    if (opts?.preDetected) form.append('pre_detected', 'true');
    const res = await apiPostMultipart<LoginByEmailResponse>(
      { ...ctx, apiBaseUrl } as DevContext,
      '/auth/login-by-face',
      form,
    );
    setFaceOpen(false);
    setCtx({
      ...ctx,
      apiBaseUrl,
      userId: res.userId,
      clinicId: res.clinicId,
      branchId: res.branchId ?? undefined,
      accessToken: res.accessToken,
    });
    toast('Signed in with face', 'success');
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); setShakeKey((k) => k + 1); return; }
    setErrors({});
    setBtnState('loading');
    try {
      // Single-step login. The BE resolves clinic + branch from the
      // user's record (clinicId is required; defaultBranchId is set
      // by the Add User form for non-admin roles). The Users-screen
      // form enforces that branch is set so this rarely errors with
      // the "not fully set up" message.
      const res = await apiPost<LoginByEmailResponse>(
        { ...ctx, apiBaseUrl } as DevContext,
        '/auth/login-by-email',
        { email, password },
      );
      setBtnState('success');
      // Set context directly — clinicName, branchName, timezone, etc.
      // get filled in shortly after via refreshMe() in AppContext.
      setTimeout(() => {
        setCtx({
          ...ctx,
          apiBaseUrl,
          userId: res.userId,
          clinicId: res.clinicId,
          branchId: res.branchId ?? undefined,
          accessToken: res.accessToken,
          email,
        });
        toast('Signed in', 'success');
      }, 400);
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
          <button type="button" onClick={() => {
            if (!email || !/\S+@\S+\.\S+/.test(email)) {
              toast('Enter your email first', 'info');
              return;
            }
            setForgotOpen(true);
          }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--brand-500)', padding: 0 }}>
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

      {/* Divider + face login. The "or" rule mirrors common SSO login
          patterns; face login is an alternative to email + password
          for staff who've enrolled their face. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>or</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>
      <button type="button" onClick={() => setFaceOpen(true)}
        disabled={faceOpen}
        style={{
          width: '100%', height: 46, background: 'var(--surface-muted)',
          border: '1.5px solid var(--border)', borderRadius: 12,
          fontSize: 14, fontWeight: 600, color: 'var(--text)',
          cursor: faceOpen ? 'not-allowed' : 'pointer',
          opacity: faceOpen ? 0.55 : 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          transition: 'opacity 200ms',
        }}>
        <Icon name="camera" size={16} strokeWidth={2.2} /> {faceOpen ? 'Scanning…' : 'Sign in with face'}
      </button>

      <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
        Don't have an account?{' '}
        <button type="button" onClick={onSwitchToSignup}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--brand-500)', padding: 0 }}>
          Create one
        </button>
      </div>

      {faceOpen && (
        <FaceScanModal
          title="Sign in with face"
          hint="Look at the camera. Make sure your face is well-lit and centered."
          captureLabel="Scan & sign in"
          onCancel={() => setFaceOpen(false)}
          onCapture={handleFaceLogin}
          fullFrame
        />
      )}

      {forgotOpen && (
        <ForgotPasswordModal
          apiBaseUrl={apiBaseUrl}
          initialEmail={email}
          onClose={() => setForgotOpen(false)}
        />
      )}
    </div>
  );
}

/* ── Forgot Password Modal (admin-only) ────────────────────── */

function ForgotPasswordModal({
  apiBaseUrl, clinic, initialEmail, onClose,
}: {
  apiBaseUrl: string;
  clinic?: ClinicResult; // optional after single-step signin landed
  initialEmail: string;
  onClose: () => void;
}) {
  const { ctx } = useApp();
  const toast = useToast();
  // Stage 1: request a reset token; stage 2: enter the token + new password.
  // The BE returns 200 regardless of whether the email is registered (no
  // enumeration), so we always move to stage 2 after the request goes
  // through and let the user paste whatever token they received.
  const [stage, setStage] = useState<'request' | 'confirm' | 'done'>('request');
  const [email, setEmail] = useState(initialEmail);
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleRequest(ev: React.FormEvent) {
    ev.preventDefault();
    setErr(null);
    if (!/\S+@\S+\.\S+/.test(email)) { setErr('Enter a valid email address.'); return; }
    if (!clinic) {
      setErr('Password reset from the login screen needs a clinic context. Ask your clinic admin to reset it for you, or sign in via the signup-flow path that picks the clinic first.');
      return;
    }
    setSubmitting(true);
    try {
      await apiPost<{ ok: boolean }>({ ...ctx, apiBaseUrl } as DevContext, '/auth/forgot-password', {
        clinicId: clinic.id,
        email,
      });
      setStage('confirm');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm(ev: React.FormEvent) {
    ev.preventDefault();
    setErr(null);
    if (token.trim().length < 20) { setErr('Paste the full reset token.'); return; }
    if (newPassword.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    setSubmitting(true);
    try {
      if (!clinic) {
        setErr('Reset requires a clinic — ask your admin instead.');
        setSubmitting(false);
        return;
      }
      await apiPost<{ ok: boolean }>({ ...ctx, apiBaseUrl } as DevContext, '/auth/reset-password', {
        clinicId: clinic.id,
        email,
        token: token.trim(),
        newPassword,
      });
      setStage('done');
      toast('Password updated', 'success');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)', animation: 'fadeIn 150ms ease-out' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 440, background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', overflow: 'hidden', animation: 'slideUp 200ms ease-out' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: "'Manrope',sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            {stage === 'done' ? 'Password updated' : 'Reset admin password'}
          </div>
          <button onClick={onClose} className="press-scale"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', padding: 6 }}
            aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ padding: '18px 22px 22px' }}>
          {err && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, marginBottom: 14, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger-500)', fontSize: 13 }}>
              <Icon name="alertTriangle" size={16} style={{ flexShrink: 0 }} />
              <span>{err}</span>
            </div>
          )}

          {stage === 'request' && (
            <form onSubmit={handleRequest}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 16 }}>
                Only admin accounts can reset their password this way.{clinic ? <> We'll generate a one-time reset token for <b>{clinic.name}</b>.</> : ' For non-admin users, ask your clinic admin to issue a reset on your behalf.'}
              </p>
              <FormGroup label="Admin email">
                <InputWrap icon="mail">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus
                    style={inputStyle(false)} />
                </InputWrap>
              </FormGroup>
              <button type="submit" disabled={submitting}
                style={{
                  width: '100%', height: 44, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10,
                  fontSize: 14, fontWeight: 600, cursor: submitting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                {submitting && <Spinner size={16} />}
                {submitting ? 'Requesting…' : 'Send reset token'}
              </button>
            </form>
          )}

          {stage === 'confirm' && (
            <form onSubmit={handleConfirm}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 14 }}>
                If <b>{email}</b> is an admin on this clinic, a reset token was issued (check your email, or the dev console while email delivery is being set up). The token expires in 30 minutes.
              </p>
              <FormGroup label="Reset token">
                <input type="text" value={token} onChange={(e) => setToken(e.target.value)} autoFocus
                  placeholder="Paste the token here"
                  style={{ ...inputStyle(false), paddingLeft: 14, fontFamily: 'monospace', fontSize: 12 }} />
              </FormGroup>
              <FormGroup label="New password">
                <InputWrap icon="lock">
                  <input type={showPw ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password"
                    placeholder="At least 8 characters"
                    style={{ ...inputStyle(false), paddingRight: 44 }} />
                  <button type="button" onClick={() => setShowPw((v) => !v)}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 6, borderRadius: 6, display: 'flex' }}
                    aria-label={showPw ? 'Hide password' : 'Show password'}>
                    <Icon name="eye" size={16} />
                  </button>
                </InputWrap>
              </FormGroup>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setStage('request')}
                  style={{ flex: '0 0 auto', height: 44, padding: '0 16px', background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
                  Back
                </button>
                <button type="submit" disabled={submitting}
                  style={{
                    flex: 1, height: 44, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10,
                    fontSize: 14, fontWeight: 600, cursor: submitting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}>
                  {submitting && <Spinner size={16} />}
                  {submitting ? 'Updating…' : 'Set new password'}
                </button>
              </div>
            </form>
          )}

          {stage === 'done' && (
            <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(16,185,129,0.1)', border: '2px solid var(--success-500)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Icon name="check" size={26} style={{ color: 'var(--success-500)' }} strokeWidth={2.5} />
              </div>
              <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.5, marginBottom: 20 }}>
                Password updated. Sign in with your new password.
              </p>
              <button onClick={onClose}
                style={{ width: '100%', height: 44, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Back to sign in
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Step 0 (alt): Sign Up ────────────────────────────────── */

function SignUpStep({
  apiBaseUrl, onSuccess, onSwitchToSignin,
}: {
  apiBaseUrl: string;
  onSuccess: (auth: PendingAuth, branch: BranchResult) => void;
  onSwitchToSignin: () => void;
}) {
  const { ctx } = useApp();
  const [clinicName, setClinicName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<{ clinicName?: string; adminName?: string; email?: string; password?: string; general?: string }>({});
  const [btnState, setBtnState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [shakeKey, setShakeKey] = useState(0);

  function validate() {
    const e: typeof errors = {};
    if (!clinicName.trim() || clinicName.trim().length < 2) e.clinicName = 'Clinic name must be at least 2 characters.';
    if (!adminName.trim()) e.adminName = 'Enter your full name.';
    if (!email || !/\S+@\S+\.\S+/.test(email)) e.email = 'Enter a valid email address.';
    if (!password || password.length < 8) e.password = 'Password must be at least 8 characters.';
    return e;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); setShakeKey((k) => k + 1); return; }
    setErrors({});
    setBtnState('loading');
    try {
      const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
      const tzToCurrency: Record<string, string> = {
        'Asia/Kolkata': 'INR',
        'Asia/Calcutta': 'INR',
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
      };
      const localCurrency = tzToCurrency[localTimezone] || 'INR';

      const tzToCountry: Record<string, string> = {
        'Asia/Kolkata': 'IN',
        'Asia/Calcutta': 'IN',
        'Asia/Colombo': 'LK',
        'Asia/Karachi': 'PK',
        'Asia/Dhaka': 'BD',
        'Asia/Kathmandu': 'NP',
        'Asia/Dubai': 'AE',
        'Asia/Riyadh': 'SA',
        'Asia/Qatar': 'QA',
        'Asia/Singapore': 'SG',
        'Asia/Tokyo': 'JP',
        'Asia/Seoul': 'KR',
        'Asia/Shanghai': 'CN',
        'Asia/Hong_Kong': 'HK',
        'Asia/Bangkok': 'TH',
        'Asia/Jakarta': 'ID',
        'Asia/Manila': 'PH',
        'Asia/Kuala_Lumpur': 'MY',
        'Europe/London': 'GB',
        'Europe/Berlin': 'DE',
        'Europe/Paris': 'FR',
        'Europe/Madrid': 'ES',
        'Europe/Rome': 'IT',
        'Europe/Amsterdam': 'NL',
        'Europe/Dublin': 'IE',
        'Europe/Zurich': 'CH',
        'Europe/Stockholm': 'SE',
        'Europe/Oslo': 'NO',
        'Europe/Moscow': 'RU',
        'Europe/Istanbul': 'TR',
        'America/New_York': 'US',
        'America/Chicago': 'US',
        'America/Los_Angeles': 'US',
        'America/Toronto': 'CA',
        'America/Vancouver': 'CA',
        'America/Mexico_City': 'MX',
        'America/Sao_Paulo': 'BR',
        'America/Buenos_Aires': 'AR',
        'Africa/Cairo': 'EG',
        'Africa/Johannesburg': 'ZA',
        'Africa/Nairobi': 'KE',
        'Africa/Lagos': 'NG',
        'Australia/Sydney': 'AU',
        'Australia/Melbourne': 'AU',
        'Pacific/Auckland': 'NZ',
      };
      const localCountry = tzToCountry[localTimezone] || 'IN';

      const res = await apiPost<SignupResponse>({ ...ctx, apiBaseUrl } as DevContext, '/auth/signup', {
        clinicName: clinicName.trim(),
        adminName: adminName.trim(),
        adminEmail: email,
        password,
        timezone: localTimezone,
        currency: localCurrency,
        countryCode: localCountry,
      });
      setBtnState('success');
      setTimeout(() => onSuccess(
        {
          clinic: { id: res.clinicId, name: res.clinicName },
          accessToken: res.accessToken,
          userId: res.userId,
          email,
        },
        { id: res.branchId, name: res.branchName },
      ), 600);
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
        Create your clinic
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 24 }}>
        Set up a new DigiRx workspace. You'll be the admin.
      </p>

      {errors.general && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 8, marginBottom: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger-500)', fontSize: 13 }}>
          <Icon name="alertTriangle" size={16} style={{ flexShrink: 0 }} />
          <span>{errors.general}</span>
        </div>
      )}

      <form key={shakeKey} onSubmit={handleSubmit} noValidate
        style={shakeKey ? { animation: 'shakeX 240ms var(--ease-out)' } : undefined}>
        <FormGroup label="Clinic name">
          <InputWrap icon="building">
            <input type="text" placeholder="Acme Clinic" value={clinicName} onChange={(e) => setClinicName(e.target.value)} autoComplete="organization"
              style={inputStyle(!!errors.clinicName)} />
          </InputWrap>
          {errors.clinicName && <FieldError>{errors.clinicName}</FieldError>}
        </FormGroup>

        <FormGroup label="Your full name">
          <InputWrap icon="mail">
            <input type="text" placeholder="Jane Doe" value={adminName} onChange={(e) => setAdminName(e.target.value)} autoComplete="name"
              style={inputStyle(!!errors.adminName)} />
          </InputWrap>
          {errors.adminName && <FieldError>{errors.adminName}</FieldError>}
        </FormGroup>

        <FormGroup label="Email address">
          <InputWrap icon="mail">
            <input type="email" placeholder="you@clinic.in" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
              style={inputStyle(!!errors.email)} />
          </InputWrap>
          {errors.email && <FieldError>{errors.email}</FieldError>}
        </FormGroup>

        <FormGroup label="Password">
          <InputWrap icon="lock">
            <input type={showPw ? 'text' : 'password'} placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
              style={{ ...inputStyle(!!errors.password), paddingRight: 44 }} />
            <button type="button" onClick={() => setShowPw((v) => !v)}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 6, borderRadius: 6, display: 'flex' }}
              aria-label={showPw ? 'Hide password' : 'Show password'}>
              <Icon name="eye" size={16} />
            </button>
          </InputWrap>
          {errors.password && <FieldError>{errors.password}</FieldError>}
        </FormGroup>

        <button type="submit" disabled={btnState === 'loading' || btnState === 'success'}
          style={{
            width: '100%', height: 48,
            background: btnState === 'success' ? 'var(--success-500)' : 'var(--brand-500)',
            color: 'var(--brand-text)', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600,
            cursor: btnState === 'loading' || btnState === 'success' ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: btnState === 'loading' ? 0.85 : 1, transition: 'background 200ms',
            marginTop: 4,
          }}>
          {btnState === 'loading' && <Spinner size={18} />}
          {btnState === 'idle' && 'Create account'}
          {btnState === 'loading' && 'Creating…'}
          {btnState === 'success' && 'Account created'}
          {btnState === 'error' && 'Try again'}
        </button>
      </form>

      <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
        Already have an account?{' '}
        <button type="button" onClick={onSwitchToSignin}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--brand-500)', padding: 0 }}>
          Sign in
        </button>
      </div>
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
// Kept around for potential future MULTIPLE_CLINICS fallback (when
// the same email is registered with more than one clinic) — the
// /auth/login-by-email 409 response shape includes a candidate
// clinic list and we'd reuse this widget to disambiguate. Currently
// no callsite, so we re-export it under an unused-friendly name to
// keep the function in the bundle without tripping noUnusedLocals.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function _UnusedClinicCombobox(props: {
  apiBaseUrl: string;
  value: ClinicResult | null;
  onChange: (c: ClinicResult | null) => void;
  error: boolean;
}) { return ClinicCombobox(props); }

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

  // Debounced search. `cancelled` keeps a slower previous-query response
  // from overwriting the newer one's results — without it the dropdown
  // can momentarily flash older matches mid-typing.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await apiGet<ClinicResult[]>({ ...ctx, apiBaseUrl } as DevContext, `/clinic/search?q=${encodeURIComponent(query.trim())}`);
        if (cancelled) return;
        setResults(data);
        setHighlighted(data.length ? 0 : -1);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
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

