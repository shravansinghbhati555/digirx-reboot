/**
 * Provisional receipt — printed entirely on the device, for a bill issued
 * offline. The real invoice PDF is rendered server-side, so during an outage
 * it does not exist yet; and when the device ran out of leased invoice
 * numbers, the bill has no number until it syncs.
 *
 * The receipt says so plainly. It records the cash taken against a reference
 * the clinic can look up later (the bill id), and is never presented as the
 * tax invoice.
 */

export type ProvisionalReceiptInput = {
  clinicName: string;
  branchName?: string;
  patientName?: string | null;
  billId: string;
  /** Leased invoice number, when the device had one. */
  billNo?: string;
  currency: string;
  items: Array<{ label: string; quantity: number; amount: number }>;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payments: Array<{ method: string; amount: number; paidAt: string }>;
  formatMoney: (n: number, currency: string) => string;
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function printProvisionalReceipt(r: ProvisionalReceiptInput): boolean {
  const w = window.open('', '_blank', 'width=480,height=640');
  if (!w) return false;
  const money = (n: number) => esc(r.formatMoney(n, r.currency));
  const paid = r.payments.reduce((s, p) => s + p.amount, 0);
  const ref = r.billNo ? esc(r.billNo) : `Pending — ref ${esc(r.billId.slice(-8).toUpperCase())}`;

  const rows = r.items
    .map(
      (i) =>
        `<tr><td>${esc(i.label)}${i.quantity > 1 ? ` × ${i.quantity}` : ''}</td><td class="r">${money(i.amount)}</td></tr>`,
    )
    .join('');
  const payRows = r.payments
    .map(
      (p) =>
        `<tr><td>${esc(p.method)} · ${esc(new Date(p.paidAt).toLocaleString())}</td><td class="r">${money(p.amount)}</td></tr>`,
    )
    .join('');

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Provisional receipt</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;padding:20px;color:#111;font-size:13px}
  h1{font-size:16px;margin:0}
  .muted{color:#555}
  .banner{border:2px dashed #b45309;color:#92400e;padding:8px 10px;margin:12px 0;font-weight:600;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  td{padding:4px 0;vertical-align:top}
  .r{text-align:right;white-space:nowrap}
  .tot td{border-top:1px solid #ccc;font-weight:700}
  h2{font-size:13px;margin:14px 0 0}
</style></head><body>
<h1>${esc(r.clinicName)}</h1>
${r.branchName ? `<div class="muted">${esc(r.branchName)}</div>` : ''}
<div class="banner">PROVISIONAL RECEIPT — not a tax invoice. The final invoice${r.billNo ? '' : ' number'} is issued when this clinic’s system reconnects.</div>
<div><strong>Invoice:</strong> ${ref}</div>
${r.patientName ? `<div><strong>Patient:</strong> ${esc(r.patientName)}</div>` : ''}
<div><strong>Date:</strong> ${esc(new Date().toLocaleString())}</div>
<table>${rows}
<tr><td class="muted">Subtotal</td><td class="r">${money(r.subtotal)}</td></tr>
${r.discount ? `<tr><td class="muted">Discount</td><td class="r">−${money(r.discount)}</td></tr>` : ''}
${r.tax ? `<tr><td class="muted">Tax</td><td class="r">${money(r.tax)}</td></tr>` : ''}
<tr class="tot"><td>Total</td><td class="r">${money(r.total)}</td></tr>
</table>
${r.payments.length ? `<h2>Payments</h2><table>${payRows}<tr class="tot"><td>Paid</td><td class="r">${money(paid)}</td></tr><tr><td class="muted">Balance</td><td class="r">${money(Math.max(0, r.total - paid))}</td></tr></table>` : ''}
</body></html>`);
  w.document.close();
  w.focus();
  w.print();
  return true;
}
