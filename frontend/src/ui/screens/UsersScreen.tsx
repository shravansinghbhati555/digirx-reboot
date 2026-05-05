import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { Perm, usePerm } from '../../app/permissions';
import { Avatar, Spinner, useToast } from '../shared/primitives';
import { Icon } from '../shared/Icon';

type UserRow = {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  status: string;
  roleIds: string[];
  roles: { _id: string; name: string }[];
};

type RoleOption = { _id: string; name: string; immutable: boolean };

export function UsersScreen() {
  const { ctx } = useApp();
  const { has } = usePerm();
  const canEdit = has(Perm.UserWrite);
  const toast = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [u, r] = await Promise.all([
        apiGet<UserRow[]>(ctx, '/users'),
        apiGet<RoleOption[]>(ctx, '/roles'),
      ]);
      setUsers(u);
      setRoles(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.clinicId, ctx.accessToken]);

  const selected = useMemo(
    () => users.find((u) => u._id === selectedId) ?? null,
    [users, selectedId],
  );

  async function saveUserRoles(userId: string, roleIds: string[]) {
    try {
      const updated = await apiPatch<UserRow>(ctx, `/users/${userId}/roles`, {
        roleIds,
      });
      setUsers((prev) =>
        prev.map((u) => (u._id === userId ? updated : u)),
      );
      toast(`Updated roles for ${updated.name}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to update roles', 'error');
      throw e;
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
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px', margin: 0 }}>
            Users
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Click a user to assign roles. {canEdit ? '' : '(read-only — you lack user:write permission)'}
          </p>
        </div>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--danger-500)', marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          {users.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-subtle)' }}>
              No users in this clinic.
            </div>
          ) : (
            users.map((u, i) => {
              const active = u._id === selectedId;
              return (
                <button key={u._id} onClick={() => setSelectedId(u._id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px', textAlign: 'left',
                    background: active ? 'var(--brand-50)' : 'transparent',
                    border: 'none',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                    cursor: 'pointer',
                  }}>
                  <Avatar name={u.name} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: active ? 'var(--brand-700)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.email ?? '—'}{u.phone ? ` · ${u.phone}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 280 }}>
                    {u.roles.length === 0 && (
                      <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontStyle: 'italic' }}>No roles</span>
                    )}
                    {u.roles.map((r) => (
                      <span key={r._id} style={{ padding: '3px 9px', borderRadius: 100, background: 'var(--surface-muted)', border: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                        {r.name}
                      </span>
                    ))}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 100, background: u.status === 'ACTIVE' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)', color: u.status === 'ACTIVE' ? 'var(--success-500)' : 'var(--danger-500)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {u.status}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {selected && (
        <UserRolePanel
          key={selected._id}
          user={selected}
          allRoles={roles}
          canEdit={canEdit}
          onClose={() => setSelectedId(undefined)}
          onSave={(roleIds) => saveUserRoles(selected._id, roleIds)}
        />
      )}
    </div>
  );
}

function UserRolePanel({
  user, allRoles, canEdit, onClose, onSave,
}: {
  user: UserRow;
  allRoles: RoleOption[];
  canEdit: boolean;
  onClose: () => void;
  onSave: (roleIds: string[]) => Promise<void>;
}) {
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(
    () => new Set(user.roleIds),
  );
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    const original = new Set(user.roleIds);
    if (original.size !== selectedRoleIds.size) return true;
    for (const id of original) if (!selectedRoleIds.has(id)) return true;
    return false;
  }, [user.roleIds, selectedRoleIds]);

  function toggle(roleId: string) {
    if (!canEdit) return;
    setSelectedRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(Array.from(selectedRoleIds));
    } catch {
      // error toasted by caller
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ width: 380, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Avatar name={user.name} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{user.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user.email ?? '—'}
          </div>
          {user.phone && (
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>
              {user.phone}
            </div>
          )}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 4, display: 'flex' }}>
          <Icon name="x" size={18} />
        </button>
      </div>

      <div style={{ padding: '16px 20px', flex: 1, overflowY: 'auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Roles assigned
        </div>
        {allRoles.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>No roles defined.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {allRoles.map((role) => {
              const checked = selectedRoleIds.has(role._id);
              return (
                <button key={role._id} onClick={() => toggle(role._id)}
                  disabled={!canEdit}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 12px', borderRadius: 10,
                    background: checked ? 'var(--brand-50)' : 'var(--surface-muted)',
                    border: `1.5px solid ${checked ? 'var(--brand-500)' : 'var(--border)'}`,
                    cursor: canEdit ? 'pointer' : 'not-allowed',
                    opacity: canEdit ? 1 : 0.6,
                    textAlign: 'left',
                  }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 5,
                    background: checked ? 'var(--brand-500)' : 'var(--surface)',
                    border: `1.5px solid ${checked ? 'var(--brand-500)' : 'var(--border)'}`,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {checked && <Icon name="check" size={12} strokeWidth={3} style={{ color: 'var(--brand-text)' }} />}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: checked ? 'var(--brand-700)' : 'var(--text)' }}>
                    {role.name}
                  </span>
                  {role.immutable && (
                    <Icon name="lock" size={11} style={{ marginLeft: 'auto', color: 'var(--text-subtle)' }} />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {canEdit && (
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
          <button onClick={onClose}
            style={{ flex: 1, height: 40, background: 'none', border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={!dirty || saving}
            style={{
              flex: 2, height: 40, border: 'none', borderRadius: 10,
              background: !dirty || saving ? 'rgba(99,102,241,0.4)' : 'var(--brand-500)',
              color: 'var(--brand-text)', fontSize: 13, fontWeight: 600,
              cursor: saving ? 'wait' : (!dirty ? 'not-allowed' : 'pointer'),
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
            {saving ? <Spinner /> : <><Icon name="check" size={14} strokeWidth={2.5} /> Save changes</>}
          </button>
        </div>
      )}
    </div>
  );
}
