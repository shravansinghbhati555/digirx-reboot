import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../../app/api';
import { useApp } from '../../app/AppContext';
import { useIsMobile } from '../../app/useIsMobile';
import { Perm, usePerm } from '../../app/permissions';
import { EmptyState, Spinner, useToast, getCurrencySymbol } from '../shared/primitives';
import { DatePickerChip } from '../shared/DatePickerChip';
import { Icon } from '../shared/Icon';
import { Skeleton } from '../shared/Skeleton';

// -- Types mirroring the backend shapes -----------------------------------

const UNITS = [
  'TABLET', 'CAPSULE', 'BOTTLE', 'VIAL', 'STRIP', 'SACHET', 'ML', 'GRAM', 'UNIT',
] as const;
type InventoryUnit = typeof UNITS[number];

const PACK_UNITS = ['STRIP', 'BOX', 'BOTTLE', 'PACK', 'CARTON'] as const;
type InventoryPackUnit = typeof PACK_UNITS[number];

type InventoryItem = {
  _id: string;
  branchId: string;
  name: string;
  sku?: string;
  unit: InventoryUnit;
  packUnit?: InventoryPackUnit;
  packSize?: number;
  reorderLevel: number;
  active: boolean;
  // Server-supplied roll-up of sum(quantityRemaining across non-expired
  // batches). Read-only on the FE.
  onHand?: number;
};

type InventoryBatch = {
  _id: string;
  inventoryItemId: string;
  batchNumber: string;
  expiryDate: string;
  quantityReceived: number;
  quantityRemaining: number;
  unitCost?: number;
  supplier?: string;
  receivedAt: string;
};

type StockMovement = {
  _id: string;
  inventoryItemId: string;
  batchId?: string;
  kind: 'RECEIVE' | 'DISPENSE' | 'ADJUST' | 'EXPIRE';
  quantity: number;
  reason?: string;
  reference?: string;
  createdAt: string;
};

type Branch = { _id: string; name: string; active?: boolean };

// -- Top-level screen ------------------------------------------------------

export function InventoryScreen() {
  const { ctx } = useApp();
  const { has } = usePerm();
  const canRead = has(Perm.InventoryRead);
  const canWrite = has(Perm.InventoryWrite);
  const toast = useToast();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>(ctx.branchId ?? '');
  // When the sidebar branch switcher changes the active branch in ctx,
  // realign the in-screen filter so the dropdown UI doesn't show a
  // stale selection while the table refetches against the new branch.
  useEffect(() => { setBranchFilter(ctx.branchId ?? ''); }, [ctx.branchId]);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const [showCreate, setShowCreate] = useState(false);

  // (The module-enabled gate used to live here. Removed at the user's
  // request: managing stock is the inventory page, so we don't gate it
  // behind a settings toggle anymore. The BE feature guard is also off
  // — see Step 3 below.)

  // Branch list for the filter chip. Falls back silently — clinic admins
  // without branch:read will just see the active-context branch.
  useEffect(() => {
    // The branches list lives under the clinic resource — there is no
    // top-level /branches route. Falling back silently means a non-admin
    // (no branch:read) just gets "All branches" + nothing else, which is
    // fine because the BE will still scope to their context's branch.
    apiGet<Branch[]>(ctx, `/clinics/${ctx.clinicId}/branches`)
      .then(setBranches)
      .catch(() => setBranches([]));
  }, [ctx.clinicId, ctx.accessToken]);

  const [statusFilter, setStatusFilter] = useState<'all' | 'in-stock' | 'low-stock' | 'out-of-stock'>('all');

  // Item list reload — debounced so typing doesn't fire a request per keystroke.
  // `cancelled` guards against a stale response overwriting newer results when
  // the user keeps typing.
  useEffect(() => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    let cancelled = false;
    const t = setTimeout(() => {
      const qs = new URLSearchParams();
      if (branchFilter) qs.set('branchId', branchFilter);
      if (query.trim()) qs.set('query', query.trim());
      // The BE doesn't have a direct 'status' query param for stock level yet,
      // so we filter the resulting list on the FE for now.
      // (Optimized for typically < 1000 items).
      qs.set('limit', '500');
      apiGet<InventoryItem[]>(ctx, `/inventory/items?${qs.toString()}`)
        .then((r) => { if (!cancelled) setItems(r); })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [ctx, branchFilter, query, canRead]);

  const filteredItems = useMemo(() => {
    if (statusFilter === 'all') return items;
    return items.filter(it => {
      const onHand = it.onHand ?? 0;
      if (statusFilter === 'out-of-stock') return onHand === 0;
      if (statusFilter === 'low-stock') return onHand > 0 && it.reorderLevel > 0 && onHand <= it.reorderLevel;
      if (statusFilter === 'in-stock') return onHand > it.reorderLevel || it.reorderLevel === 0;
      return true;
    });
  }, [items, statusFilter]);

  function reloadList() {
    // Force-refetch by tweaking the query (cheap; same effect).
    setQuery((q) => q);
    if (!canRead) return;
    const qs = new URLSearchParams();
    if (branchFilter) qs.set('branchId', branchFilter);
    if (query.trim()) qs.set('query', query.trim());
    qs.set('limit', '100');
    apiGet<InventoryItem[]>(ctx, `/inventory/items?${qs.toString()}`)
      .then(setItems)
      .catch(() => undefined);
  }

  if (!canRead) {
    return (
      <div style={{ padding: 32 }}>
        <EmptyState icon="lock" title="Inventory access required"
          hint="You need inventory:read to see this screen. Ask an admin to grant the role." />
      </div>
    );
  }

  const selected = selectedId ? items.find((i) => i._id === selectedId) ?? null : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--surface-muted)', borderRadius: 100, padding: 4, border: '1px solid var(--border)' }}>
          {([
            { id: 'all', label: 'All' },
            { id: 'in-stock', label: 'In Stock' },
            { id: 'low-stock', label: 'Low Stock' },
            { id: 'out-of-stock', label: 'Out of Stock' },
          ] as const).map((f) => (
            <button key={f.id} onClick={() => setStatusFilter(f.id)}
              style={{ padding: '6px 14px', borderRadius: 100, border: 'none', background: statusFilter === f.id ? 'var(--brand-100)' : 'transparent', color: statusFilter === f.id ? 'var(--text)' : 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
              {f.label}
            </button>
          ))}
        </div>

        {branches.length > 1 && (
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface-muted)', borderRadius: 100, padding: 4, border: '1px solid var(--border)' }}>
            <button onClick={() => setBranchFilter('')}
              style={{ padding: '6px 14px', borderRadius: 100, border: 'none', background: branchFilter === '' ? 'var(--brand-100)' : 'transparent', color: branchFilter === '' ? 'var(--text)' : 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
              All Branches
            </button>
            {branches.map((b) => (
              <button key={b._id} onClick={() => setBranchFilter(b._id)}
                style={{ padding: '6px 14px', borderRadius: 100, border: 'none', background: branchFilter === b._id ? 'var(--brand-100)' : 'transparent', color: branchFilter === b._id ? 'var(--text)' : 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s', whiteSpace: 'nowrap' }}>
                {b.name}
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative', width: 260 }}>
            <Icon name="search" size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items…"
              style={{ width: '100%', height: 36, padding: '0 14px 0 34px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <button onClick={() => { setSelectedId(null); reloadList(); }}
            title="Refresh"
            style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Icon name="arrowUp" size={14} />
          </button>
        </div>

        <button onClick={() => canWrite && setShowCreate(true)}
          disabled={!canWrite}
          style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 18px', background: canWrite ? 'var(--brand-600)' : 'var(--surface-muted)', color: canWrite ? 'var(--brand-text)' : 'var(--text-subtle)', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: canWrite ? 'pointer' : 'not-allowed', boxShadow: canWrite ? '0 4px 12px rgba(37,99,235,0.2)' : 'none' }}>
          <Icon name="plus" size={14} strokeWidth={3} /> New item
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 24px', background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid var(--border)', color: 'var(--danger-500)', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Items list — mirrors the BillingScreen table chrome: sticky
            header, --bg page body, real <table> markup, row-hover class. */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg)', display: (isMobile && selected) ? 'none' : 'block' }}>
          {loading && items.length === 0 ? (
            <div style={{ padding: 12 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 4px', borderBottom: '1px solid var(--border)' }}>
                  <Skeleton width="22%" height={12} />
                  <Skeleton width={70} height={11} />
                  <Skeleton width={120} height={11} />
                  <Skeleton width="18%" height={11} style={{ marginLeft: 'auto' }} />
                  <Skeleton width={56} height={11} />
                  <Skeleton width={64} height={18} radius={9} />
                </div>
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <EmptyState icon="folder" title={query || statusFilter !== 'all' ? 'No items match your filters' : 'No inventory items yet'}
              hint="Adjust your search or filters to see more items." />
          ) : (
            <ItemsTable
              items={filteredItems}
              branches={branches}
              selectedId={selectedId}
              onSelect={setSelectedId}
              // Only show the Branch column when the user is looking
              // across multiple branches (an admin "All branches"
              // view). When scoped to a specific branch the column is
              // redundant — every row would carry the same value.
              showBranch={branchFilter === ''}
            />
          )}
        </div>

        {/* Detail drawer */}
        {selected && (
          <ItemDetail
            key={selected._id}
            item={selected}
            canWrite={canWrite}
            onClose={() => setSelectedId(null)}
            onChanged={() => { reloadList(); }}
            onDeleted={() => { setSelectedId(null); reloadList(); toast('Item deactivated', 'success'); }}
          />
        )}
      </div>

      {showCreate && (
        <ItemEditor
          mode="create"
          branches={branches}
          defaultBranchId={branchFilter || ctx.branchId}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); reloadList(); toast('Item created', 'success'); }}
        />
      )}
    </div>
  );
}

// -- Items table -----------------------------------------------------------

function ItemsTable({
  items, branches, selectedId, onSelect, showBranch,
}: {
  items: InventoryItem[];
  branches: Branch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showBranch: boolean;
}) {
  const branchById = useMemo(() => new Map(branches.map((b) => [b._id, b.name])), [branches]);

  const columns: Array<{ label: string; align: 'left' | 'right' }> = [
    { label: 'Item', align: 'left' },
    { label: 'SKU', align: 'left' },
    { label: 'Pack', align: 'left' },
    ...(showBranch ? [{ label: 'Branch', align: 'left' as const }] : []),
    { label: 'On hand', align: 'right' },
    { label: 'Reorder', align: 'right' },
    { label: 'Status', align: 'left' },
  ];

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
        <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          {columns.map((h) => (
            <th
              key={h.label}
              style={{
                padding: '12px 20px',
                textAlign: h.align,
                fontSize: 10,
                fontWeight: 800,
                color: 'var(--text-subtle)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}
            >
              {h.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const isSelected = it._id === selectedId;
          const onHand = it.onHand ?? 0;
          const tracked = it.reorderLevel > 0;
          const outOfStock = onHand === 0;
          const lowStock = !outOfStock && tracked && onHand <= it.reorderLevel;
          return (
            <tr
              key={it._id}
              onClick={() => onSelect(it._id)}
              className="row-hover"
              style={{
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                background: isSelected ? 'var(--brand-50)' : 'transparent',
              }}
            >
              <td style={{ padding: '14px 20px', minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {it.name}
                  {!it.active && (
                    <span style={{ marginLeft: 8, fontSize: 9, color: 'var(--text-subtle)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Inactive
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                  Dispensed in {it.unit.toLowerCase()}
                </div>
              </td>
              <td style={{ padding: '14px 20px', fontSize: 12, color: 'var(--brand-600)', fontFamily: 'monospace', fontWeight: 600 }}>
                {it.sku ?? '—'}
              </td>
              <td style={{ padding: '14px 20px', fontSize: 12, color: 'var(--text-muted)' }}>
                {it.packUnit && it.packSize
                  ? `${it.packSize} ${it.unit.toLowerCase()} / ${it.packUnit.toLowerCase()}`
                  : <span style={{ opacity: 0.4 }}>—</span>}
              </td>
              {showBranch && (
                <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {branchById.get(it.branchId) ?? `#${it.branchId.slice(-6).toUpperCase()}`}
                </td>
              )}
              <td style={{ padding: '14px 20px', fontSize: 14, fontWeight: 700, color: outOfStock ? 'var(--danger-500)' : lowStock ? 'var(--warning-text)' : 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {onHand}
              </td>
              <td style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text-subtle)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                {it.reorderLevel || <span style={{ opacity: 0.4 }}>—</span>}
              </td>
              <td style={{ padding: '14px 20px' }}>
                <StockPill outOfStock={outOfStock} lowStock={lowStock} tracked={tracked} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Mirrors the KindChip pattern in BillingScreen — pill, uppercase, small,
 * three palette variants. Keeps the receipt-table look consistent across
 * Inventory / Pharmacy / Billing.
 */
function StockPill({
  outOfStock, lowStock, tracked,
}: { outOfStock: boolean; lowStock: boolean; tracked: boolean }) {
  let label = 'In stock';
  let bg = 'var(--success-bg)';
  let fg = 'var(--success-text)';
  let border = 'rgba(34,197,94,0.3)';

  if (outOfStock) {
    label = 'Out of stock';
    bg = 'rgba(239,68,68,0.08)';
    fg = 'var(--danger-500)';
    border = 'rgba(239,68,68,0.3)';
  } else if (lowStock) {
    label = 'Low stock';
    bg = 'var(--warning-bg)';
    fg = 'var(--warning-text)';
    border = 'rgba(245,158,11,0.35)';
  } else if (!tracked) {
    label = 'Stocked';
    bg = 'var(--surface-muted)';
    fg = 'var(--text-muted)';
    border = 'var(--border)';
  }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 100,
      background: bg, color: fg, border: `1px solid ${border}`,
      whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      {label}
    </span>
  );
}

// -- Detail drawer ---------------------------------------------------------

function ItemDetail({
  item, canWrite, onClose, onChanged, onDeleted,
}: {
  item: InventoryItem;
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { ctx } = useApp();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [tab, setTab] = useState<'batches' | 'movements'>('batches');
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showDispense, setShowDispense] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  function loadBatches() {
    setLoading(true);
    apiGet<InventoryBatch[]>(ctx, `/inventory/items/${item._id}/batches`)
      .then(setBatches)
      .catch(() => setBatches([]))
      .finally(() => setLoading(false));
  }

  function loadMovements() {
    setLoading(true);
    apiGet<StockMovement[]>(ctx, `/inventory/items/${item._id}/movements?limit=50`)
      .then(setMovements)
      .catch(() => setMovements([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (tab === 'batches') loadBatches();
    else loadMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, item._id]);

  async function deactivate() {
    if (!confirm(`Deactivate "${item.name}"? It will stop appearing in dispense lookups but historical records are preserved.`)) return;
    try {
      await apiPatch(ctx, `/inventory/items/${item._id}`, { active: false });
      onDeleted();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to deactivate', 'error');
    }
  }

  return (
    <div style={isMobile
      ? { width: '100%', flex: 1, background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
      : { width: 460, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Item</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2, fontFamily: 'monospace' }}>
            {item.sku ?? `#${item._id.slice(-6)}`}
            {' · '}{item.unit.toLowerCase()}
            {item.packUnit && item.packSize ? ` · ${item.packSize}/${item.packUnit.toLowerCase()}` : ''}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 4 }}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6 }}>
        {canWrite && (
          <>
            <button onClick={() => setShowReceive(true)}
              style={{ flex: 1, height: 34, background: 'var(--brand-500)', color: 'var(--brand-text)', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <Icon name="plus" size={12} strokeWidth={2.5} /> Receive
            </button>
            <button onClick={() => setShowDispense(true)}
              style={{ flex: 1, height: 34, background: 'var(--surface-muted)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <Icon name="arrowUp" size={12} /> Dispense
            </button>
            <button onClick={() => setShowEdit(true)} title="Edit item"
              style={{ width: 34, height: 34, background: 'var(--surface-muted)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="edit" size={13} />
            </button>
            {item.active && (
              <button onClick={deactivate} title="Deactivate"
                style={{ width: 34, height: 34, background: 'var(--surface-muted)', color: 'var(--danger-500)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="trash" size={13} />
              </button>
            )}
          </>
        )}
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        {(['batches', 'movements'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              flex: 1, height: 36, background: 'none',
              border: 'none', borderBottom: tab === t ? '2px solid var(--brand-500)' : '2px solid transparent',
              fontSize: 12, fontWeight: 600,
              color: tab === t ? 'var(--brand-600)' : 'var(--text-muted)',
              cursor: 'pointer', textTransform: 'capitalize',
            }}>
            {t}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center' }}><Spinner /></div>
        ) : tab === 'batches' ? (
          batches.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-subtle)' }}>
              No batches yet. {canWrite ? 'Click Receive to add stock.' : ''}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {batches.map((b) => <BatchCard key={b._id} batch={b} unit={item.unit} />)}
            </div>
          )
        ) : (
          movements.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-subtle)' }}>
              No stock movements recorded yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {movements.map((m) => <MovementRow key={m._id} m={m} unit={item.unit} />)}
            </div>
          )
        )}
      </div>

      {showReceive && (
        <ReceiveSheet
          item={item}
          onClose={() => setShowReceive(false)}
          onReceived={() => { setShowReceive(false); loadBatches(); onChanged(); toast('Stock received', 'success'); }}
        />
      )}
      {showDispense && (
        <DispenseSheet
          item={item}
          onClose={() => setShowDispense(false)}
          onDispensed={() => { setShowDispense(false); loadBatches(); onChanged(); toast('Stock dispensed', 'success'); }}
        />
      )}
      {showEdit && (
        <ItemEditor
          mode="edit"
          existing={item}
          branches={[]}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); onChanged(); toast('Item updated', 'success'); }}
        />
      )}
    </div>
  );
}

function BatchCard({ batch, unit }: { batch: InventoryBatch; unit: InventoryUnit }) {
  const expired = new Date(batch.expiryDate).getTime() < Date.now();
  const expSoon = !expired && new Date(batch.expiryDate).getTime() < Date.now() + 30 * 86400_000;
  return (
    <div style={{ padding: '10px 12px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
            Batch <span style={{ fontFamily: 'monospace' }}>{batch.batchNumber}</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2 }}>
            Expires {new Date(batch.expiryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            {expired && <span style={{ marginLeft: 6, color: 'var(--danger-500)', fontWeight: 700 }}>EXPIRED</span>}
            {expSoon && <span style={{ marginLeft: 6, color: 'var(--warning-text)', fontWeight: 700 }}>≤ 30 days</span>}
          </div>
          {batch.supplier && <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 1 }}>{batch.supplier}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
            {batch.quantityRemaining}
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            of {batch.quantityReceived} {unit.toLowerCase()}
          </div>
        </div>
      </div>
    </div>
  );
}

function MovementRow({ m, unit }: { m: StockMovement; unit: InventoryUnit }) {
  const tone = m.kind === 'RECEIVE' ? 'success' : m.kind === 'DISPENSE' ? 'brand' : 'warning';
  const sign = m.kind === 'RECEIVE' ? '+' : '−';
  const palette: Record<string, { fg: string; bg: string }> = {
    success: { fg: 'var(--success-text)', bg: 'var(--success-bg)' },
    brand: { fg: 'var(--brand-600)', bg: 'var(--brand-50)' },
    warning: { fg: 'var(--warning-text)', bg: 'var(--warning-bg)' },
  };
  const c = palette[tone];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
      <span style={{ padding: '2px 8px', borderRadius: 100, fontSize: 10, fontWeight: 700, background: c.bg, color: c.fg }}>{m.kind}</span>
      <span style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {m.reason || m.reference || '—'}
      </span>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
        {sign}{m.quantity} <span style={{ fontSize: 9, color: 'var(--text-subtle)', fontWeight: 500 }}>{unit.toLowerCase()}</span>
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>
        {new Date(m.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
      </span>
    </div>
  );
}

// -- Item editor (create/edit) --------------------------------------------

function ItemEditor({
  mode, existing, branches, defaultBranchId, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  existing?: InventoryItem;
  branches: Branch[];
  defaultBranchId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { ctx } = useApp();
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? '');
  const [sku, setSku] = useState(existing?.sku ?? '');
  const [unit, setUnit] = useState<InventoryUnit>(existing?.unit ?? 'TABLET');
  const [hasPack, setHasPack] = useState(!!existing?.packUnit);
  const [packUnit, setPackUnit] = useState<InventoryPackUnit>(existing?.packUnit ?? 'STRIP');
  const [packSize, setPackSize] = useState<string>(existing?.packSize ? String(existing.packSize) : '10');
  const [reorderLevel, setReorderLevel] = useState<string>(String(existing?.reorderLevel ?? 0));
  const [branchId, setBranchId] = useState(existing?.branchId ?? defaultBranchId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError('Name is required.'); return; }
    if (mode === 'create' && !branchId) { setError('Branch is required.'); return; }
    if (hasPack) {
      const ps = Number(packSize);
      if (!Number.isInteger(ps) || ps < 1) { setError('Pack size must be a positive whole number.'); return; }
    }
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        unit,
        reorderLevel: Number(reorderLevel) || 0,
      };
      if (sku.trim()) body.sku = sku.trim();
      if (hasPack) {
        body.packUnit = packUnit;
        body.packSize = Number(packSize);
      }
      if (mode === 'create') {
        body.branchId = branchId;
        await apiPost(ctx, '/inventory/items', body);
      } else if (existing) {
        await apiPatch(ctx, `/inventory/items/${existing._id}`, body);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={mode === 'create' ? 'New inventory item' : `Edit ${existing?.name ?? 'item'}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {mode === 'create' && branches.length > 0 && (
          <Field label="Branch">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={selectStyle}>
              <option value="">Select branch…</option>
              {branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
            </select>
          </Field>
        )}

        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Crocin 500mg" style={inputStyle} />
        </Field>

        <Field label="SKU (optional)">
          <input value={sku} onChange={(e) => setSku(e.target.value)}
            placeholder="e.g. CR500-MUM" style={{ ...inputStyle, fontFamily: 'monospace' }} />
        </Field>

        <Field label="Smallest dispensable unit">
          <select value={unit} onChange={(e) => setUnit(e.target.value as InventoryUnit)} style={selectStyle}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 4 }}>
            All stock is counted in this unit. Pick the smallest you'd ever dispense — typically TABLET.
          </div>
        </Field>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          <input type="checkbox" checked={hasPack} onChange={(e) => setHasPack(e.target.checked)} style={{ width: 14, height: 14 }} />
          Stock arrives in a pack (e.g. strips of 10 tablets)
        </label>

        {hasPack && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '10px 12px', background: 'var(--brand-50)', border: '1px solid var(--brand-100)', borderRadius: 10 }}>
            <Field label="Pack format">
              <select value={packUnit} onChange={(e) => setPackUnit(e.target.value as InventoryPackUnit)} style={selectStyle}>
                {PACK_UNITS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label={`${unit.toLowerCase()}s per ${packUnit.toLowerCase()}`}>
              <input type="number" min={1} value={packSize} onChange={(e) => setPackSize(e.target.value)} style={inputStyle} />
            </Field>
            <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--brand-700)' }}>
              You'll receive in {packUnit.toLowerCase()}s, but every dispense is counted in {unit.toLowerCase()}s. Stored as {packSize || '?'} {unit.toLowerCase()}s per {packUnit.toLowerCase()}.
            </div>
          </div>
        )}

        <Field label="Reorder level (in dispensable units)">
          <input type="number" min={0} value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} style={inputStyle} />
          <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 4 }}>
            When on-hand quantity falls to this number, the item shows up in low-stock alerts. Set to 0 to disable the alert.
          </div>
        </Field>

        {error && (
          <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
          <button onClick={onClose} disabled={saving} style={btnGhostStyle}>Cancel</button>
          <button onClick={save} disabled={saving} style={btnPrimaryStyle}>
            {saving ? <Spinner /> : mode === 'create' ? 'Create item' : 'Save changes'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// -- Receive batch sheet ---------------------------------------------------

function ReceiveSheet({
  item, onClose, onReceived,
}: {
  item: InventoryItem;
  onClose: () => void;
  onReceived: () => void;
}) {
  const { ctx } = useApp();
  const toast = useToast();
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [usingPack, setUsingPack] = useState(!!item.packUnit && !!item.packSize);
  const [qty, setQty] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const packSize = item.packSize ?? 1;
  const totalUnits = usingPack ? Number(qty) * packSize : Number(qty);

  async function submit() {
    if (!batchNumber.trim()) { setError('Batch number is required.'); return; }
    if (!expiryDate) { setError('Expiry date is required.'); return; }
    const totalQty = Number(qty);
    if (!Number.isFinite(totalQty) || totalQty <= 0) { setError('Quantity must be > 0.'); return; }

    setSaving(true); setError(null);
    try {
      await apiPost(ctx, `/inventory/items/${item._id}/batches`, {
        batchNumber: batchNumber.trim(),
        expiryDate,
        // Always send in the smallest dispensable unit so the BE never
        // has to know about pack/unit conversion. The toggle is purely UX.
        quantityReceived: usingPack ? totalQty * packSize : totalQty,
        unitCost: unitCost ? Number(unitCost) : undefined,
        supplier: supplier.trim() || undefined,
      });
      onReceived();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast(e instanceof Error ? e.message : 'Receive failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Receive stock — ${item.name}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Batch number">
          <input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)}
            placeholder="From the supplier's lot label" style={{ ...inputStyle, fontFamily: 'monospace' }} />
        </Field>

        <Field label="Expiry date">
          <DatePickerChip value={expiryDate} onChange={setExpiryDate} fullWidth placeholder="Pick expiry date" />
        </Field>

        {item.packUnit && item.packSize && (
          <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <button onClick={() => setUsingPack(true)}
              style={{
                flex: 1, height: 32, border: 'none', borderRadius: 8, cursor: 'pointer',
                background: usingPack ? 'var(--surface)' : 'transparent',
                color: usingPack ? 'var(--text)' : 'var(--text-muted)',
                fontSize: 12, fontWeight: usingPack ? 700 : 500,
              }}>
              In {item.packUnit.toLowerCase()}s
            </button>
            <button onClick={() => setUsingPack(false)}
              style={{
                flex: 1, height: 32, border: 'none', borderRadius: 8, cursor: 'pointer',
                background: !usingPack ? 'var(--surface)' : 'transparent',
                color: !usingPack ? 'var(--text)' : 'var(--text-muted)',
                fontSize: 12, fontWeight: !usingPack ? 700 : 500,
              }}>
              In {item.unit.toLowerCase()}s
            </button>
          </div>
        )}

        <Field label={`Quantity${usingPack && item.packUnit ? ` (in ${item.packUnit.toLowerCase()}s)` : ` (in ${item.unit.toLowerCase()}s)`}`}>
          <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} />
          {usingPack && item.packUnit && Number.isFinite(totalUnits) && totalUnits > 0 && (
            <div style={{ fontSize: 11, color: 'var(--brand-600)', marginTop: 4 }}>
              = {totalUnits} {item.unit.toLowerCase()}s in stock
            </div>
          )}
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Unit cost (optional)">
            <input type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)}
              placeholder={`${getCurrencySymbol()}/unit`} style={inputStyle} />
          </Field>
          <Field label="Supplier (optional)">
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} style={inputStyle} />
          </Field>
        </div>

        {error && (
          <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={onClose} disabled={saving} style={btnGhostStyle}>Cancel</button>
          <button onClick={submit} disabled={saving} style={btnPrimaryStyle}>
            {saving ? <Spinner /> : 'Receive stock'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// -- Manual dispense sheet -------------------------------------------------

function DispenseSheet({
  item, onClose, onDispensed,
}: {
  item: InventoryItem;
  onClose: () => void;
  onDispensed: () => void;
}) {
  const { ctx } = useApp();
  const toast = useToast();
  const [usingPack, setUsingPack] = useState(false);
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const packSize = item.packSize ?? 1;
  const totalUnits = usingPack ? Number(qty) * packSize : Number(qty);

  async function submit() {
    const parsed = Number(qty);
    if (!Number.isFinite(parsed) || parsed <= 0) { setError('Quantity must be > 0.'); return; }
    setSaving(true); setError(null);
    try {
      await apiPost(ctx, `/inventory/items/${item._id}/dispense`, {
        quantity: usingPack ? parsed * packSize : parsed,
        reason: reason.trim() || 'Manual dispense',
      });
      onDispensed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast(e instanceof Error ? e.message : 'Dispense failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Dispense — ${item.name}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {item.packUnit && item.packSize && (
          <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <button onClick={() => setUsingPack(false)}
              style={{
                flex: 1, height: 32, border: 'none', borderRadius: 8, cursor: 'pointer',
                background: !usingPack ? 'var(--surface)' : 'transparent',
                color: !usingPack ? 'var(--text)' : 'var(--text-muted)',
                fontSize: 12, fontWeight: !usingPack ? 700 : 500,
              }}>
              In {item.unit.toLowerCase()}s
            </button>
            <button onClick={() => setUsingPack(true)}
              style={{
                flex: 1, height: 32, border: 'none', borderRadius: 8, cursor: 'pointer',
                background: usingPack ? 'var(--surface)' : 'transparent',
                color: usingPack ? 'var(--text)' : 'var(--text-muted)',
                fontSize: 12, fontWeight: usingPack ? 700 : 500,
              }}>
              In {item.packUnit.toLowerCase()}s
            </button>
          </div>
        )}

        <Field label={`Quantity${usingPack && item.packUnit ? ` (in ${item.packUnit.toLowerCase()}s)` : ` (in ${item.unit.toLowerCase()}s)`}`}>
          <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} />
          {usingPack && item.packUnit && Number.isFinite(totalUnits) && totalUnits > 0 && (
            <div style={{ fontSize: 11, color: 'var(--brand-600)', marginTop: 4 }}>
              Will deduct {totalUnits} {item.unit.toLowerCase()}s from stock
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
            On-hand: {item.onHand ?? '—'} {item.unit.toLowerCase()}s. FIFO will pull from the oldest non-expired batch first.
          </div>
        </Field>

        <Field label="Reason (optional)">
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Damaged stock, sample, manual adjustment…" style={inputStyle} />
        </Field>

        {error && (
          <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--danger-500)' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={onClose} disabled={saving} style={btnGhostStyle}>Cancel</button>
          <button onClick={submit} disabled={saving} style={btnPrimaryStyle}>
            {saving ? <Spinner /> : 'Dispense'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// -- Shared chrome ---------------------------------------------------------

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', width: '100%', maxWidth: 480, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 4 }}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 38, padding: '0 12px',
  background: 'var(--surface-muted)', border: '1.5px solid var(--border)', borderRadius: 9,
  fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = { ...inputStyle };

const btnGhostStyle: React.CSSProperties = {
  height: 38, padding: '0 16px',
  background: 'none', color: 'var(--text-muted)',
  border: '1.5px solid var(--border)', borderRadius: 9,
  fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

const btnPrimaryStyle: React.CSSProperties = {
  height: 38, padding: '0 18px',
  background: 'var(--brand-500)', color: 'var(--brand-text)',
  border: 'none', borderRadius: 9,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
};
