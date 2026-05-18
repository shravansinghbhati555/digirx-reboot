import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiGet, apiPatch, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Perm, type PermName } from '../../app/permissions';
import { Spinner, useToast } from '../shared/primitives';
import { Icon } from '../shared/Icon';

type Role = {
  _id: string;
  name: string;
  permissions: string[];
  immutable: boolean;
};

type PermRow = { perm: PermName; label: string };
type PermGroup = { title: string; rows: PermRow[] };

const PERMISSION_GROUPS: PermGroup[] = [
  {
    title: 'Dashboard',
    rows: [
      { perm: Perm.DashboardRead, label: 'View the Dashboard tab' },
    ],
  },
  {
    title: 'Patients',
    rows: [
      { perm: Perm.PatientRead, label: 'View patients' },
      { perm: Perm.PatientWrite, label: 'Manage patients' },
    ],
  },
  {
    title: 'Appointments',
    rows: [
      { perm: Perm.AppointmentRead, label: 'View appointments' },
      { perm: Perm.AppointmentWrite, label: 'Manage appointments' },
    ],
  },
  {
    title: 'Billing',
    rows: [
      { perm: Perm.BillingRead, label: 'View bills' },
      { perm: Perm.BillingWrite, label: 'Manage bills & payments' },
    ],
  },
  {
    title: 'Documents',
    rows: [
      { perm: Perm.DocumentRead, label: 'View documents' },
      { perm: Perm.DocumentWrite, label: 'Upload & share documents' },
    ],
  },
  {
    title: 'Inventory',
    rows: [
      { perm: Perm.InventoryRead, label: 'View inventory & stock' },
      { perm: Perm.InventoryWrite, label: 'Receive, dispense & manage items' },
    ],
  },
  {
    title: 'Notifications',
    rows: [
      { perm: Perm.NotificationRead, label: 'View notifications' },
      { perm: Perm.NotificationWrite, label: 'Send notifications' },
    ],
  },
  {
    title: 'Reports',
    rows: [
      { perm: Perm.ReportsRead, label: 'View reports' },
      { perm: Perm.ReportsWrite, label: 'Export reports' },
    ],
  },
  {
    title: 'Settings tabs',
    rows: [
      { perm: Perm.SettingsClinicRead, label: 'Settings → Clinic' },
      { perm: Perm.SettingsBranchesRead, label: 'Settings → Branches' },
      { perm: Perm.SettingsAvailabilityRead, label: 'Settings → Availability' },
      { perm: Perm.SettingsNotificationsRead, label: 'Settings → Quiet hours' },
      { perm: Perm.SettingsAuditRead, label: 'Settings → Audit log' },
    ],
  },
  {
    title: 'Clinic admin',
    rows: [
      { perm: Perm.ClinicRead, label: 'View clinic settings' },
      { perm: Perm.ClinicWrite, label: 'Manage clinic settings' },
      { perm: Perm.BranchRead, label: 'View branches' },
      { perm: Perm.BranchWrite, label: 'Manage branches' },
      { perm: Perm.UserRead, label: 'View users & roles' },
      { perm: Perm.UserWrite, label: 'Manage users & roles' },
    ],
  },
  {
    title: 'Face recognition',
    rows: [
      { perm: Perm.FaceEnroll, label: 'Enroll a patient’s face' },
      { perm: Perm.FaceRecognize, label: 'Identify a patient by face scan' },
    ],
  },
];

const ALL_PERMS: PermName[] = PERMISSION_GROUPS.flatMap((g) =>
  g.rows.map((r) => r.perm),
);

// Write permissions imply their matching read. Editing the matrix should
// keep this invariant — checking write auto-checks read, and unchecking
// read auto-unchecks write.
const WRITE_TO_READ: Partial<Record<PermName, PermName>> = {
  [Perm.PatientWrite]: Perm.PatientRead,
  [Perm.AppointmentWrite]: Perm.AppointmentRead,
  [Perm.BillingWrite]: Perm.BillingRead,
  [Perm.DocumentWrite]: Perm.DocumentRead,
  [Perm.InventoryWrite]: Perm.InventoryRead,
  [Perm.NotificationWrite]: Perm.NotificationRead,
  [Perm.ClinicWrite]: Perm.ClinicRead,
  [Perm.BranchWrite]: Perm.BranchRead,
  [Perm.UserWrite]: Perm.UserRead,
  [Perm.ReportsWrite]: Perm.ReportsRead,
};
const READ_TO_WRITE: Partial<Record<PermName, PermName>> = Object.fromEntries(
  Object.entries(WRITE_TO_READ).map(([w, r]) => [r as PermName, w as PermName]),
) as Partial<Record<PermName, PermName>>;

export function RolesScreen() {
  const { ctx, refreshMe } = useApp();
  const toast = useToast();
  const [roles, setRoles] = useState<Role[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  // Map<roleId, Set<perm>> — current (possibly edited) state.
  const [edited, setEdited] = useState<Map<string, Set<string>>>(new Map());
  // Snapshot of the saved state, for diffing on Save.
  const [original, setOriginal] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await apiGet<Role[]>(ctx, '/roles');
      setRoles(data);
      const e = new Map<string, Set<string>>();
      const o = new Map<string, Set<string>>();
      for (const r of data) {
        e.set(r._id, new Set(r.permissions));
        o.set(r._id, new Set(r.permissions));
      }
      setEdited(e);
      setOriginal(o);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.clinicId, ctx.accessToken]);

  function isChecked(roleId: string, perm: string): boolean {
    return edited.get(roleId)?.has(perm) ?? false;
  }

  function toggle(role: Role, perm: string) {
    if (role.immutable) return;
    setEdited((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(role._id) ?? []);
      const hasIt = set.has(perm);

      if (hasIt) {
        set.delete(perm);
        // Removing a read also removes the matching write (you can't write
        // what you can't read).
        const implied = READ_TO_WRITE[perm as PermName];
        if (implied) set.delete(implied);
      } else {
        set.add(perm);
        // Adding a write also adds the matching read.
        const implied = WRITE_TO_READ[perm as PermName];
        if (implied) set.add(implied);
      }

      next.set(role._id, set);
      return next;
    });
  }

  function toggleAllForRole(role: Role) {
    if (role.immutable) return;
    setEdited((prev) => {
      const next = new Map(prev);
      const cur = next.get(role._id) ?? new Set<string>();
      // If all are checked → clear; otherwise → check all.
      const all = ALL_PERMS.every((p) => cur.has(p));
      next.set(role._id, all ? new Set() : new Set(ALL_PERMS));
      return next;
    });
  }

  const dirtyRoleIds = useMemo(() => {
    const out: string[] = [];
    for (const r of roles) {
      if (r.immutable) continue;
      const a = edited.get(r._id) ?? new Set();
      const b = original.get(r._id) ?? new Set();
      if (a.size !== b.size || ![...a].every((p) => b.has(p))) {
        out.push(r._id);
      }
    }
    return out;
  }, [roles, edited, original]);

  async function save() {
    if (dirtyRoleIds.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      for (const id of dirtyRoleIds) {
        const perms = Array.from(edited.get(id) ?? []);
        await apiPatch(ctx, `/roles/${id}`, { permissions: perms });
      }
      toast(`Saved ${dirtyRoleIds.length} role(s)`, 'success');
      await load(true);
      // Refresh the current user's permissions in case the admin changed
      // their own role (e.g. through a non-Admin role they belong to).
      void refreshMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 60, display: 'flex', justifyContent: 'center' }}>
        <Spinner />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div style={{ padding: '24px 40px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px', margin: 0 }}>
              Roles &amp; Permissions
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              Click a column header to toggle all. Super Admin role is immutable.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setShowCreate(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 16px',
                background: 'none', color: 'var(--text)', border: '1px solid var(--border)',
                borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>
              <Icon name="plus" size={14} strokeWidth={2.5} /> New role
            </button>
            <button onClick={save} disabled={saving || dirtyRoleIds.length === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 18px',
                background: dirtyRoleIds.length === 0 ? 'rgba(99,102,241,0.4)' : 'var(--brand-500)',
                color: 'var(--brand-text)', border: 'none', borderRadius: 10,
                fontSize: 13, fontWeight: 600,
                cursor: saving ? 'wait' : (dirtyRoleIds.length === 0 ? 'not-allowed' : 'pointer'),
              }}>
              {saving ? <Spinner /> : <><Icon name="check" size={14} strokeWidth={2.5} /> Save permissions</>}
            </button>
          </div>
        </div>
      </div>

      <div className="scroll-y" style={{ flex: 1, padding: '0 40px 40px' }}>
        {showCreate && (
          <CreateRoleSheet
            existingNames={new Set(roles.map((r) => r.name.toLowerCase()))}
            onClose={() => setShowCreate(false)}
            onCreated={async () => {
              setShowCreate(false);
              await load();
              toast('Role created', 'success');
            }}
          />
        )}

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--danger-500)', margin: '16px 0' }}>
            {error}
          </div>
        )}

        {roles.length === 0 ? (
          <div style={{ padding: 40, marginTop: 24, textAlign: 'center', color: 'var(--text-subtle)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 }}>
            No roles found. Run the seed to create the standard roles.
          </div>
        ) : (
          <div style={{ borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr style={{ background: 'var(--surface-muted)' }}>
                <th style={{ ...thStyle, textAlign: 'left', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.06em', color: 'var(--text-subtle)' }}>Permission</th>
                {roles.map((r) => {
                  const dirty = dirtyRoleIds.includes(r._id);
                  return (
                    <th key={r._id} style={{ 
                      ...thStyle, 
                      textAlign: 'center', 
                      cursor: r.immutable ? 'default' : 'pointer', 
                      color: dirty ? 'var(--brand-500)' : 'var(--text)', 
                      userSelect: 'none',
                      minWidth: 100 
                    }}
                      onClick={() => toggleAllForRole(r)}
                      title={r.immutable ? 'Super Admin role is immutable' : 'Click to toggle all'}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{r.name}</span>
                        {r.immutable && <Icon name="lock" size={11} style={{ color: 'var(--text-subtle)' }} />}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((group) => (
                <PermGroupRows
                  key={group.title}
                  group={group}
                  roles={roles}
                  isChecked={isChecked}
                  onToggle={toggle}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  );
}

function PermGroupRows({
  group, roles, isChecked, onToggle,
}: {
  group: PermGroup;
  roles: Role[];
  isChecked: (roleId: string, perm: string) => boolean;
  onToggle: (role: Role, perm: string) => void;
}) {
  return (
    <>
      <tr style={{ background: 'var(--surface-muted)', borderTop: '1px solid var(--border)', position: 'sticky', top: 49, zIndex: 9 }}>
        <td colSpan={1 + roles.length} style={{ padding: '12px 20px', fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--border)' }}>
          {group.title}
        </td>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.perm} className="row-hover">
          <td style={{ padding: '12px 20px', color: 'var(--text)', fontWeight: 500, borderBottom: '1px solid var(--border)', width: '30%' }}>{row.label}</td>
          {roles.map((r) => {
            const checked = isChecked(r._id, row.perm);
            // If this is a read perm and the matching write is also checked,
            // it's implied — lock it so the user understands why.
            const matchingWrite = READ_TO_WRITE[row.perm];
            const impliedByWrite =
              !r.immutable && !!matchingWrite && isChecked(r._id, matchingWrite);
            return (
              <td key={r._id} style={{ padding: '8px 0', textAlign: 'center', borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <PermCheckbox
                    checked={checked}
                    disabled={r.immutable || impliedByWrite}
                    title={impliedByWrite ? 'Required because write access is granted' : undefined}
                    onClick={() => onToggle(r, row.perm)}
                  />
                </div>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function PermCheckbox({ checked, disabled, title, onClick }: { checked: boolean; disabled?: boolean; title?: string; onClick: () => void }) {
  return (
    <button onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-pressed={checked}
      title={title}
      style={{
        width: 22, height: 22, borderRadius: 5,
        background: checked ? 'var(--brand-500)' : 'var(--surface)',
        border: `1.5px solid ${checked ? 'var(--brand-500)' : 'var(--border)'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 100ms, border 100ms',
        padding: 0,
      }}>
      {checked && <Icon name="check" size={13} strokeWidth={3} style={{ color: 'var(--brand-text)' }} />}
    </button>
  );
}

const thStyle: React.CSSProperties = {
  padding: '16px 20px',
  fontWeight: 600,
  borderBottom: '2px solid var(--border)',
  borderLeft: '1px solid var(--border)',
};

// ---------------------------------------------------------------------------
// CreateRoleSheet — REFERENCE PATTERN for react-hook-form + zod across the
// app. New forms should follow this shape:
//   1. Define a `z.object({...})` schema next to the component.
//   2. Derive the form type via `z.infer<typeof Schema>`.
//   3. `useForm({ resolver: zodResolver(Schema), defaultValues })`.
//   4. Reach into `register(...)` for inputs, `formState.errors` for messages,
//      and `handleSubmit(onSubmit)` to gate submit on validation.
//   5. Server-side rejections (E11000, business rules) are surfaced via
//      `setError('root.serverError', { message })` so the same error UI
//      shows whether validation came from zod or from the backend.
// ---------------------------------------------------------------------------

const ROLE_NAME_RE = /^[A-Za-z0-9 _-]{1,80}$/;

function buildCreateRoleSchema(existingNames: Set<string>) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(80, 'Name is too long')
      .regex(ROLE_NAME_RE, 'Use letters, digits, spaces, hyphens or underscores')
      .refine(
        (n) => !existingNames.has(n.toLowerCase()),
        'A role with this name already exists',
      )
      .refine(
        (n) => {
          const lower = n.toLowerCase();
          // 'admin' covered for clinics seeded before the rename.
          return lower !== 'super admin' && lower !== 'admin';
        },
        'Super Admin is reserved',
      ),
  });
}

type CreateRoleForm = z.infer<ReturnType<typeof buildCreateRoleSchema>>;

function CreateRoleSheet({
  existingNames,
  onClose,
  onCreated,
}: {
  existingNames: Set<string>;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const { ctx } = useApp();
  const schema = useMemo(
    () => buildCreateRoleSchema(existingNames),
    [existingNames],
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<CreateRoleForm>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  async function onSubmit(values: CreateRoleForm) {
    try {
      await apiPost(ctx, '/roles', {
        name: values.name.trim(),
        // Permissions left empty on create; operator configures via the
        // matrix afterward. Backend validates the array against the enum
        // when populated.
        permissions: [],
      });
      await onCreated();
    } catch (e) {
      setError('root.serverError', {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const rootError = errors.root?.serverError?.message;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <form onSubmit={handleSubmit(onSubmit)}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)',
          width: '100%', maxWidth: 420, overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(15,23,42,0.2)',
        }}>
        <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>New role</div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
            Configure permissions in the matrix once it's created.
          </div>
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Name
            </span>
            <input
              {...register('name')}
              autoFocus
              placeholder="e.g. Front desk"
              aria-invalid={errors.name ? 'true' : 'false'}
              style={{
                width: '100%', height: 38, padding: '0 12px',
                background: 'var(--surface-muted)',
                border: `1.5px solid ${errors.name ? 'var(--danger-500)' : 'var(--border)'}`,
                borderRadius: 9, fontSize: 13, color: 'var(--text)',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
            {errors.name && (
              <span style={{ fontSize: 11, color: 'var(--danger-500)' }}>
                {errors.name.message}
              </span>
            )}
          </label>

          {rootError && (
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: 'var(--danger-500)' }}>
              {rootError}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={isSubmitting}
            style={{ height: 36, padding: '0 14px', background: 'none', border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={isSubmitting}
            style={{ height: 36, padding: '0 16px', background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: isSubmitting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            {isSubmitting ? <Spinner /> : <><Icon name="check" size={13} strokeWidth={2.5} /> Create role</>}
          </button>
        </div>
      </form>
    </div>
  );
}
