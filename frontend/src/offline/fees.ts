/**
 * Is a bill paid, as far as this device knows?
 *
 * The server refuses check-in until the appointment's consultation bill is
 * settled. Offline the device has to apply the same rule itself — otherwise
 * the check-in is accepted locally, refused on sync, and everything queued
 * behind it (the consultation, the prescription, the signature) fails too.
 *
 * Answers from the cached bill and its cached payments, which include the
 * cash recorded on this device and still waiting to sync.
 */
import { getRecord, listRecords } from './db';

export type Settlement =
  | { known: false }
  | {
      known: true;
      total: number;
      paid: number;
      outstanding: number;
      currency: string;
    };

function idOf(v: unknown): string {
  if (v && typeof v === 'object') return String((v as { _id?: unknown })._id ?? '');
  return v == null ? '' : String(v);
}

export async function billSettlement(clinicId: string, billId: string): Promise<Settlement> {
  const rec = await getRecord(clinicId, 'bills', billId);
  const bill = rec?.doc as
    | { total?: number; status?: string; currency?: string }
    | undefined;
  if (!bill) return { known: false };

  const total = Number(bill.total ?? 0);
  const currency = bill.currency ?? 'INR';
  if (String(bill.status ?? '').toUpperCase() === 'PAID') {
    return { known: true, total, paid: total, outstanding: 0, currency };
  }

  // A payment taken offline is cached under a local id; once it syncs, the
  // server's copy (different id, same idempotency key) can be cached too.
  // Count each payment once.
  const seen = new Set<string>();
  let paise = 0;
  for (const row of await listRecords(clinicId, 'payments')) {
    const p = row.doc as { billId?: unknown; amount?: number; idempotencyKey?: string; _id?: string };
    if (idOf(p.billId) !== billId || typeof p.amount !== 'number') continue;
    const key = p.idempotencyKey ?? p._id ?? row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    paise += Math.round(p.amount * 100);
  }
  const paid = paise / 100;
  return {
    known: true,
    total,
    paid,
    outstanding: Math.max(0, Math.round((total - paid) * 100) / 100),
    currency,
  };
}
