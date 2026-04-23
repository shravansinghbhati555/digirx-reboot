import { BadRequestException } from '@nestjs/common';
import { BillLineItem } from './schemas/bill.schema';

export function computeTotals(input: {
  items: BillLineItem[];
  discount?: number;
  tax?: number;
}) {
  const subtotal = round2(
    (input.items ?? []).reduce((sum, it) => {
      if (!Number.isFinite(it.quantity) || it.quantity <= 0)
        throw new BadRequestException('Invalid quantity');
      if (!Number.isFinite(it.unitPrice) || it.unitPrice < 0)
        throw new BadRequestException('Invalid unitPrice');
      const amount = round2(it.quantity * it.unitPrice);
      it.amount = amount;
      return sum + amount;
    }, 0),
  );

  const discount = round2(input.discount ?? 0);
  const tax = round2(input.tax ?? 0);
  const total = round2(Math.max(0, subtotal - discount) + tax);

  return { subtotal, discount, tax, total };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
