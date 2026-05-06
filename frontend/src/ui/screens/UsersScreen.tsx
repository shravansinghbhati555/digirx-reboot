import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../../app/api';
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
  registrationNumber?: string;
  qualifications?: string;
  branchIds?: string[];
};

type RoleOption = { _id: string; name: string; immutable: boolean };
type BranchOption = { _id: string; name: string };

export function UsersScreen() {
  const { ctx } = useApp();
  const { has } = usePerm();
  const canEdit = has(Perm.UserWrite);
  const toast = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [u, r, b] = await Promise.all([
        apiGet<UserRow[]>(ctx, '/users'),
        apiGet<RoleOption[]>(ctx, '/roles'),
        apiGet<BranchOption[]>(ctx, `/clinics/${ctx.clinicId}/branches`),
      ]);
      setUsers(u);
      setRoles(r);
      setBranches(b);
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

  async function handleAddUser(data: any) {
    try {
      const newUser = await apiPost<UserRow>(ctx, '/users', data);
      setUsers((prev) => [...prev, newUser].sort((a, b) => a.name.localeCompare(b.name)));
      setShowAddModal(false);
      toast(`User ${newUser.name} added successfully`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to add user', 'error');
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
        <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px', margin: 0 }}>
              Users
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              Click a user to assign roles. {canEdit ? '' : '(read-only — you lack user:write permission)'}
            </p>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowAddModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 12,
                background: 'var(--brand-500)', color: 'var(--brand-text)',
                border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.25)',
                transition: 'transform 0.2s, background 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-1px)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
            >
              <Icon name="plus" size={18} strokeWidth={2.5} />
              Add User
            </button>
          )}
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
                      {u.registrationNumber && <span style={{ marginLeft: 8, color: 'var(--brand-500)', fontWeight: 600 }}>({u.registrationNumber})</span>}
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

      {showAddModal && (
        <AddUserModal
          roles={roles}
          branches={branches}
          onClose={() => setShowAddModal(false)}
          onSave={handleAddUser}
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

function AddUserModal({ roles, branches, onClose, onSave }: { roles: RoleOption[], branches: BranchOption[], onClose: () => void, onSave: (data: any) => Promise<void> }) {
  const [data, setData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    registrationNumber: '',
    qualifications: '',
    roleIds: [] as string[],
    branchIds: [] as string[]
  });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data.name) return;
    setLoading(true);
    try {
      await onSave(data);
    } finally {
      setLoading(false);
    }
  }

  function toggleRole(id: string) {
    setData(prev => ({
      ...prev,
      roleIds: prev.roleIds.includes(id) 
        ? prev.roleIds.filter(r => r !== id) 
        : [...prev.roleIds, id]
    }));
  }

  function toggleBranch(id: string) {
    setData(prev => ({
      ...prev,
      branchIds: prev.branchIds.includes(id)
        ? prev.branchIds.filter(b => b !== id)
        : [...prev.branchIds, id]
    }));
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
      <div style={{ background: 'var(--surface)', width: '100%', maxWidth: 500, borderRadius: 20, boxShadow: '0 20px 50px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
        <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Add New User</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)' }}><Icon name="x" size={20} /></button>
        </div>
        
        <div style={{ maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
          <form onSubmit={handleSubmit} style={{ padding: '32px' }}>
            <div style={{ display: 'grid', gap: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Full Name *</label>
                  <input required value={data.name} onChange={e => setData({...data, name: e.target.value})} style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-muted)' }} placeholder="e.g. Dr. John Doe" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Email</label>
                  <input type="email" value={data.email} onChange={e => setData({...data, email: e.target.value})} style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-muted)' }} placeholder="john@example.com" />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Phone</label>
                  <input value={data.phone} onChange={e => setData({...data, phone: e.target.value})} style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-muted)' }} placeholder="+91 9876543210" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Password</label>
                  <input type="password" value={data.password} onChange={e => setData({...data, password: e.target.value})} style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-muted)' }} placeholder="••••••••" />
                </div>
              </div>

              <div style={{ background: 'var(--brand-50)', padding: 16, borderRadius: 12, border: '1px solid var(--brand-100)', display: 'grid', gap: 16 }}>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--brand-600)', textTransform: 'uppercase' }}>Professional Details (for Prescription)</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--brand-700)', marginBottom: 4 }}>Reg No.</label>
                    <input value={data.registrationNumber} onChange={e => setData({...data, registrationNumber: e.target.value})} style={{ width: '100%', height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--brand-200)', background: '#fff', fontSize: 13 }} placeholder="MCI-2019-..." />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--brand-700)', marginBottom: 4 }}>Qualifications</label>
                    <input value={data.qualifications} onChange={e => setData({...data, qualifications: e.target.value})} style={{ width: '100%', height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--brand-200)', background: '#fff', fontSize: 13 }} placeholder="MBBS, MD" />
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>Select Branches</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {branches.map(b => (
                    <button type="button" key={b._id} onClick={() => toggleBranch(b._id)} style={{
                      padding: '6px 14px', borderRadius: 100, fontSize: 12, fontWeight: 600,
                      background: data.branchIds.includes(b._id) ? 'rgba(16,185,129,0.1)' : 'var(--surface-muted)',
                      color: data.branchIds.includes(b._id) ? 'var(--success-600)' : 'var(--text-muted)',
                      border: `1px solid ${data.branchIds.includes(b._id) ? 'var(--success-500)' : 'var(--border)'}`,
                      cursor: 'pointer'
                    }}>{b.name}</button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>Assign Roles</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {roles.map(r => (
                    <button type="button" key={r._id} onClick={() => toggleRole(r._id)} style={{
                      padding: '6px 14px', borderRadius: 100, fontSize: 12, fontWeight: 600,
                      background: data.roleIds.includes(r._id) ? 'var(--brand-500)' : 'var(--surface-muted)',
                      color: data.roleIds.includes(r._id) ? 'var(--brand-text)' : 'var(--text-muted)',
                      border: '1px solid var(--border)', cursor: 'pointer'
                    }}>{r.name}</button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 40, display: 'flex', gap: 12 }}>
              <button type="button" onClick={onClose} style={{ flex: 1, height: 44, borderRadius: 12, border: '1.5px solid var(--border)', background: 'none', fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={loading} style={{ flex: 2, height: 44, borderRadius: 12, border: 'none', background: 'var(--brand-500)', fontWeight: 600, color: 'var(--brand-text)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {loading ? <Spinner /> : 'Create User'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
