import type { DevContext } from '../../app/context';
import { saveContext } from '../../app/context';
import { apiPost } from '../../app/api';
import { useState } from 'react';
import { Card, Field, PrimaryButton, ScreenTitle, SecondaryButton } from '../components/ui';

export function HomeScreen({ ctx, onChange }: { ctx: DevContext; onChange: (next: DevContext) => void }) {
  const [email, setEmail] = useState('admin@digirx.local');
  const [password, setPassword] = useState('Admin@123');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login() {
    setError(null);
    setBusy(true);
    try {
      const res = await apiPost<{ accessToken: string; userId: string; clinicId: string; branchId: string | null }>(
        ctx,
        '/auth/login',
        {
          clinicId: ctx.clinicId,
          branchId: ctx.branchId,
          email,
          password,
        },
      );
      onChange({
        ...ctx,
        userId: res.userId,
        clinicId: res.clinicId,
        branchId: res.branchId ?? undefined,
        accessToken: res.accessToken,
      });
      saveContext({
        ...ctx,
        userId: res.userId,
        clinicId: res.clinicId,
        branchId: res.branchId ?? undefined,
        accessToken: res.accessToken,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <ScreenTitle title="Setup" subtitle="API URL, clinic context, and JWT login." />

      <Card>
        <div className="space-y-3">
          <Field label="API base URL" value={ctx.apiBaseUrl} onChange={(v) => set(ctx, onChange, { apiBaseUrl: v })} />
          <Field label="Clinic ID" value={ctx.clinicId} onChange={(v) => set(ctx, onChange, { clinicId: v })} />
          <Field
            label="Branch ID (optional)"
            value={ctx.branchId ?? ''}
            onChange={(v) => set(ctx, onChange, { branchId: v || undefined })}
          />
          <Field label="User ID (dev fallback)" value={ctx.userId} onChange={(v) => set(ctx, onChange, { userId: v })} />
          <Field
            label="Access token (JWT)"
            value={ctx.accessToken ?? ''}
            onChange={(v) => set(ctx, onChange, { accessToken: v || undefined })}
          />
          <SecondaryButton onClick={() => saveContext(ctx)}>Save to browser</SecondaryButton>
        </div>
      </Card>

      <Card title="Login">
        <div className="space-y-3">
          <Field label="Email" value={email} onChange={setEmail} />
          <Field label="Password" value={password} onChange={setPassword} type="password" />
          {error ? <div className="text-xs font-medium text-rose-600">{error}</div> : null}
          <PrimaryButton disabled={busy || !ctx.clinicId} onClick={() => void login()}>
            {busy ? 'Logging in…' : 'Login & save JWT'}
          </PrimaryButton>
        </div>
      </Card>
    </section>
  );
}

function set(ctx: DevContext, onChange: (n: DevContext) => void, patch: Partial<DevContext>) {
  onChange({ ...ctx, ...patch });
}
