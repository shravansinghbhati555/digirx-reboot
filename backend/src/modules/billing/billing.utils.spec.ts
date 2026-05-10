import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { computeTotals } from './billing.utils';
import { BillLineItem } from './schemas/bill.schema';

function item(overrides: Partial<BillLineItem> = {}): BillLineItem {
  return {
    serviceCatalogItemId: new Types.ObjectId(),
    customName: 'Consultation',
    quantity: 1,
    unitPrice: 100,
    amount: 0,
    ...overrides,
  };
}

describe('computeTotals', () => {
  it('returns zero subtotal/total for an empty item list', () => {
    const out = computeTotals({ items: [] });
    expect(out).toEqual({ subtotal: 0, discount: 0, tax: 0, total: 0 });
  });

  it('sums quantity * unitPrice and back-fills each item.amount', () => {
    const items = [
      item({ quantity: 2, unitPrice: 250 }),
      item({ quantity: 1, unitPrice: 80 }),
    ];
    const out = computeTotals({ items });
    expect(out.subtotal).toBe(580);
    expect(items[0].amount).toBe(500);
    expect(items[1].amount).toBe(80);
  });

  it('applies discount before tax: total = (subtotal - discount) + tax', () => {
    const out = computeTotals({
      items: [item({ quantity: 1, unitPrice: 1000 })],
      discount: 100,
      tax: 50,
    });
    expect(out).toEqual({ subtotal: 1000, discount: 100, tax: 50, total: 950 });
  });

  it('rounds to 2 decimals consistently for fractional inputs', () => {
    // 3 * 33.335 = 100.005 → rounds to 100.01
    const out = computeTotals({
      items: [item({ quantity: 3, unitPrice: 33.335 })],
      discount: 10.005, // → 10.01
      tax: 5.004, // → 5
    });
    expect(out.subtotal).toBe(100.01);
    expect(out.discount).toBe(10.01);
    expect(out.tax).toBe(5);
    // total = round2((100.01 - 10.01) + 5) = 95
    expect(out.total).toBe(95);
  });

  it('clamps a discount larger than subtotal to zero (not negative)', () => {
    // Documented current behaviour: Math.max(0, subtotal - discount) + tax.
    // The roadmap calls for rejecting negative totals; revisit when that lands.
    const out = computeTotals({
      items: [item({ quantity: 1, unitPrice: 100 })],
      discount: 200,
      tax: 0,
    });
    expect(out.total).toBe(0);
  });

  it('still adds tax even when discount fully wipes the subtotal', () => {
    const out = computeTotals({
      items: [item({ quantity: 1, unitPrice: 100 })],
      discount: 200,
      tax: 18,
    });
    expect(out.total).toBe(18);
  });

  it('treats undefined discount and tax as zero', () => {
    const out = computeTotals({
      items: [item({ quantity: 1, unitPrice: 250 })],
    });
    expect(out).toEqual({ subtotal: 250, discount: 0, tax: 0, total: 250 });
  });

  it('rejects items with non-positive quantity', () => {
    expect(() =>
      computeTotals({ items: [item({ quantity: 0, unitPrice: 100 })] }),
    ).toThrow(BadRequestException);
    expect(() =>
      computeTotals({ items: [item({ quantity: -1, unitPrice: 100 })] }),
    ).toThrow(BadRequestException);
  });

  it('rejects items with NaN quantity', () => {
    expect(() =>
      computeTotals({ items: [item({ quantity: Number.NaN, unitPrice: 100 })] }),
    ).toThrow(BadRequestException);
  });

  it('rejects items with negative unitPrice', () => {
    expect(() =>
      computeTotals({ items: [item({ quantity: 1, unitPrice: -1 })] }),
    ).toThrow(BadRequestException);
  });

  it('rejects items with non-finite unitPrice', () => {
    expect(() =>
      computeTotals({
        items: [item({ quantity: 1, unitPrice: Number.POSITIVE_INFINITY })],
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts zero unitPrice (free line item) without error', () => {
    const out = computeTotals({
      items: [item({ quantity: 1, unitPrice: 0 })],
    });
    expect(out.subtotal).toBe(0);
    expect(out.total).toBe(0);
  });
});
