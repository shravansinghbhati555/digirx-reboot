import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch } from '../../app/api';
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
    title: 'Notifications',
    rows: [
      { perm: Perm.NotificationRead, label: 'View notifications' },
      { perm: Perm.NotificationWrite, label: 'Send notifications' },
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
  [Perm.NotificationWrite]: Perm.NotificationRead,
  [Perm.ClinicWrite]: Perm.ClinicRead,
  [Perm.BranchWrite]: Perm.BranchRead,
  [Perm.UserWrite]: Perm.UserRead,
};
const READ_TO_WRITE: Partial<Record<PermName, PermName>> = Object.fromEntries(
  Object.entries(WRITE_TO_READ).map(([w, r]) => [r as PermName, w as PermName]),
) as Partial<Record<PermName, PermName>>;

export function RolesScreen() {
  const { ctx, refreshMe } = useApp();
  const toast = useToast();
  const [roles, setRoles] = useState<Role[]>([]);
  // Map<roleId, Set<perm>> — current (possibly edited) state.
  const [edited, setEdited] = useState<Map<string, Set<string>>>(new Map());
  // Snapshot of the saved state, for diffing on Save.
  const [original, setOriginal] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
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
      await load();
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
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px', margin: 0 }}>
            Roles &amp; Permissions
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Click a column header to toggle all. Admin role is immutable.
          </p>
        </div>
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

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--danger-500)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {roles.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-subtle)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 }}>
          No roles found. Run the seed to create the standard roles.
        </div>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-muted)' }}>
                <th style={{ ...thStyle, textAlign: 'left', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.06em' }}>Permission</th>
                {roles.map((r) => {
                  const dirty = dirtyRoleIds.includes(r._id);
                  return (
                    <th key={r._id} style={{ ...thStyle, textAlign: 'center', cursor: r.immutable ? 'default' : 'pointer', color: dirty ? 'var(--brand-500)' : 'var(--text)', userSelect: 'none' }}
                      onClick={() => toggleAllForRole(r)}
                      title={r.immutable ? 'Admin role is immutable' : 'Click to toggle all'}>
                      {r.name}
                      {r.immutable && <Icon name="lock" size={11} style={{ marginLeft: 4, verticalAlign: '-1px', color: 'var(--text-subtle)' }} />}
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
      <tr style={{ background: 'var(--surface-muted)' }}>
        <td colSpan={1 + roles.length} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {group.title}
        </td>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.perm} style={{ borderTop: '1px solid var(--border)' }}>
          <td style={{ padding: '10px 16px', color: 'var(--text)', whiteSpace: 'nowrap' }}>{row.label}</td>
          {roles.map((r) => {
            const checked = isChecked(r._id, row.perm);
            // If this is a read perm and the matching write is also checked,
            // it's implied — lock it so the user understands why.
            const matchingWrite = READ_TO_WRITE[row.perm];
            const impliedByWrite =
              !r.immutable && !!matchingWrite && isChecked(r._id, matchingWrite);
            return (
              <td key={r._id} style={{ padding: '8px 0', textAlign: 'center', borderLeft: '1px solid var(--border)' }}>
                <PermCheckbox
                  checked={checked}
                  disabled={r.immutable || impliedByWrite}
                  title={impliedByWrite ? 'Required because write access is granted' : undefined}
                  onClick={() => onToggle(r, row.perm)}
                />
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
  padding: '12px 16px',
  fontWeight: 600,
  borderBottom: '1px solid var(--border)',
  borderLeft: '1px solid var(--border)',
};
