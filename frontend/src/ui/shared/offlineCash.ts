import { apiPostQueued, type QueuedResult } from '../../app/api';
import type { DevContext } from '../../app/context';
import { newObjectId } from '../../offline/ids';
import { patchCachedRecord } from '../../offline/working-set';

/**
 * Take a cash payment against a bill so it survives being offline, and make
 * the device's copy of the bill reflect it.
 *
 * Used wherever the consultation fee is collected — at booking, at check-in,
 * and from Billing. Queued **before** the check-in it pays for, so on replay
 * the server sees booking → payment → check-in, in that order, and the
 * pre-payment gate passes.
 */
export async function recordCashPayment(
  ctx: DevContext,
  input: {
    billId: string;
    amount: number;
    /** Bill total, to tell whether this payment settles it. */
    total?: number;
    /** Already paid before this payment. */
    alreadyPaid?: number;
    idempotencyKey?: string;
    providerRef?: string;
    label: string;
  },
): Promise<QueuedResult<unknown>> {
  const paidAt = new Date().toISOString();
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const result = await apiPostQueued(
    ctx,
    `/bills/${input.billId}/payments`,
    {
      method: 'CASH',
      amount: input.amount,
      providerRef: input.providerRef || undefined,
      idempotencyKey,
    },
    {
      label: input.label,
      // CreatePaymentDto takes no `_id`; replay keys on idempotencyKey.
      mintId: false,
      // Stamp the time it was taken, not the time it syncs — the day-end
      // cash count depends on it.
      // `collectedOffline` tags it on the server, so Billing can show it was
      // taken without a connection and synced later.
      enrichOnQueue: async () => ({ paidAt, collectedOffline: true }),
      // Cache-only: a local id so the payment shows on the bill offline.
      localRecord: { _id: newObjectId(), billId: input.billId, paidAt },
    },
  );

  if (result.queued && input.total != null) {
    const settled = paiseOf((input.alreadyPaid ?? 0) + input.amount) >= paiseOf(input.total);
    if (settled) {
      await patchCachedRecord(ctx.clinicId, 'bills', input.billId, { status: 'PAID' });
    }
  }
  return result;
}

function paiseOf(n: number): number {
  return Math.round(n * 100);
}
