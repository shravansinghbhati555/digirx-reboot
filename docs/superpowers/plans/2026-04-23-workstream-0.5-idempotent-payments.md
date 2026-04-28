# Workstream 0.5 — Idempotent payments

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **Commit discipline:** Per user preference, never run `git commit` without explicit approval. Each task stages and proposes a commit message; wait for user confirmation.

**Goal:** Make `POST /bills/:id/payments` safe to retry. Today a flaky network or a double-clicked "Add payment" button creates two `Payment` rows for the same logical payment, breaking reconciliation. After this workstream, every payment carries a client-generated `idempotencyKey`, the database enforces uniqueness within `(clinicId, billId, idempotencyKey)`, and a duplicate POST returns the **original** row (200 + `X-Idempotent-Replay: true` header) instead of inserting again.

**Architecture:** Field-level idempotency, not table-level. The unique index is partial — scoped by `(clinicId, billId, idempotencyKey)` — so the same key on a different bill is independent. The service tries `paymentModel.create(...)`; on Mongo `E11000` it falls back to a `findOne` for the matching key and returns it flagged as a replay. The controller reads the replay flag and sets the response header. The frontend generates a UUIDv4 once per "Add payment" sheet open (not per submit), so the user re-trying the same intent reuses the same key.

**Tech Stack:** NestJS 11 (`@Header` decorator or `@Res({ passthrough: true })`), Mongoose 9 (`createIndex` with `partialFilterExpression`, error code `11000`), class-validator (`@IsString`, `@MinLength`), Jest. Frontend: `crypto.randomUUID()` (available in all evergreen browsers; fallback for old Safari already exists in the API helper if needed).

**Exit bar:**
- `POST /bills/:id/payments` rejects 400 if `idempotencyKey` is missing or shorter than 8 chars.
- A repeat POST with the same `idempotencyKey` on the same bill returns the original `Payment` document (same `_id`) with HTTP 200 and header `X-Idempotent-Replay: true`. Body shape unchanged.
- Two concurrent POSTs with the same key (simulated via duplicate-key error) result in one row, two identical bodies, second response carrying the replay header.
- Different keys on the same bill create different rows (no false collisions).
- Schema gains a partial unique index `(clinicId, billId, idempotencyKey)`; existing payments without the field do not collide (partial filter excludes them).
- Frontend `BillingScreen` generates a UUIDv4 when the "Add payment" sheet opens and reuses it across retries until the sheet closes.
- Tests green; build clean.

---

## Current state (audit, 2026-04-23)

**`backend/src/modules/billing/dto/create-payment.dto.ts`:**
```ts
export class CreatePaymentDto {
  @IsEnum(PaymentMethod) method!: PaymentMethod;
  @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsString() @MaxLength(200) providerRef?: string;
  @IsOptional() @IsISO8601() paidAt?: string;
}
```
Missing `idempotencyKey`.

**`backend/src/modules/billing/schemas/payment.schema.ts`:**
- No `idempotencyKey` field.
- Single index: `(clinicId, billId, paidAt)` — non-unique, fine for queries, irrelevant for idempotency.

**`backend/src/modules/billing/billing.service.ts:111-143` (`addPayment`):**
- Validates bill is `Issued`, validates amount/paidAt, calls `paymentModel.create(...)` directly. No retry-safety.

**`backend/src/modules/billing/billing.controller.ts:64-77` (`addPayment`):**
- Thin pass-through. Returns the service result directly. No header logic.

**`frontend/src/ui/screens/BillingScreen.tsx:399-420` (Add Payment sheet):**
- Holds `method`, `amount`, `providerRef` in component state.
- Submits via `apiPost(ctx, /bills/${bill._id}/payments, { method, amount, providerRef })`.
- No idempotency key.

---

## File Structure

**Modify:**
- `backend/src/modules/billing/dto/create-payment.dto.ts` — add `idempotencyKey`.
- `backend/src/modules/billing/schemas/payment.schema.ts` — add `idempotencyKey` + partial unique index.
- `backend/src/modules/billing/billing.service.ts` — refactor `addPayment` for idempotent insert + replay return.
- `backend/src/modules/billing/billing.controller.ts` — set `X-Idempotent-Replay` header on replay.
- `frontend/src/ui/screens/BillingScreen.tsx` — generate + reuse UUIDv4 per Add-Payment sheet.

**Create:**
- `backend/src/modules/billing/billing.service.spec.ts` — unit tests for `addPayment` idempotency.
- `backend/src/modules/billing/dto/create-payment.dto.spec.ts` — validator tests for `idempotencyKey`.

---

## Task 1 — Backend: schema, DTO, service, controller

**Files:**
- Modify: `backend/src/modules/billing/dto/create-payment.dto.ts`
- Modify: `backend/src/modules/billing/schemas/payment.schema.ts`
- Modify: `backend/src/modules/billing/billing.service.ts`
- Modify: `backend/src/modules/billing/billing.controller.ts`
- Create: `backend/src/modules/billing/dto/create-payment.dto.spec.ts`
- Create: `backend/src/modules/billing/billing.service.spec.ts`

### Step 1.1 — Extend the DTO

Replace the full contents of `backend/src/modules/billing/dto/create-payment.dto.ts`:

```ts
import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaymentMethod } from '../schemas/payment.schema';

export class CreatePaymentDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerRef?: string;

  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  idempotencyKey!: string;
}
```

### Step 1.2 — DTO validator spec

Create `backend/src/modules/billing/dto/create-payment.dto.spec.ts`:

```ts
import { CreatePaymentDto } from './create-payment.dto';
import { PaymentMethod } from '../schemas/payment.schema';
import { expectInvalid, expectValid } from '../../../common/test/dto-validator';

describe('CreatePaymentDto', () => {
  const base = {
    method: PaymentMethod.Cash,
    amount: 100,
    idempotencyKey: 'abcdefgh',
  };

  it('accepts a minimal valid body', async () => {
    await expectValid(CreatePaymentDto, base);
  });

  it('rejects missing idempotencyKey', async () => {
    const { idempotencyKey: _, ...rest } = base;
    await expectInvalid(CreatePaymentDto, rest, 'idempotencyKey');
  });

  it('rejects idempotencyKey shorter than 8 chars', async () => {
    await expectInvalid(
      CreatePaymentDto,
      { ...base, idempotencyKey: 'short' },
      'idempotencyKey',
    );
  });

  it('rejects idempotencyKey longer than 64 chars', async () => {
    await expectInvalid(
      CreatePaymentDto,
      { ...base, idempotencyKey: 'x'.repeat(65) },
      'idempotencyKey',
    );
  });

  it('accepts a UUIDv4 as idempotencyKey', async () => {
    await expectValid(CreatePaymentDto, {
      ...base,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    });
  });
});
```

Verify the helpers exist: `backend/src/common/test/dto-validator.ts` exports `expectValid` / `expectInvalid` (used by other DTO specs in the repo, e.g. `create-bill.dto.spec.ts`).

### Step 1.3 — Run DTO spec — expect failure

Run: `cd backend && pnpm test -- create-payment.dto.spec.ts`

Expected: failures on the missing/short/long cases (the field doesn't exist yet, but the helper will report `idempotencyKey` as failing the new constraints once Step 1.1 lands — actually, since Step 1.1 already added the field, the tests should pass here. **If Steps 1.1 and 1.2 are done together, run Step 1.3 right after to confirm the validators behave correctly, not to confirm a TDD red phase.** The TDD red phase is on the service in Step 1.6.

### Step 1.4 — Extend the schema

Replace the full contents of `backend/src/modules/billing/schemas/payment.schema.ts`:

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PaymentDocument = HydratedDocument<Payment>;

export enum PaymentMethod {
  Cash = 'CASH',
  Upi = 'UPI',
  Card = 'CARD',
  Online = 'ONLINE',
  BankTransfer = 'BANK_TRANSFER',
}

@Schema({ timestamps: true })
export class Payment {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  billId!: Types.ObjectId;

  @Prop({ required: true, enum: PaymentMethod })
  method!: PaymentMethod;

  @Prop({ required: true, min: 0 })
  amount!: number;

  @Prop({ trim: true })
  providerRef?: string;

  @Prop({ type: Date, required: true })
  paidAt!: Date;

  @Prop({ type: Types.ObjectId })
  receivedBy?: Types.ObjectId;

  @Prop({ trim: true })
  idempotencyKey?: string;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

PaymentSchema.index(
  { clinicId: 1, billId: 1, paidAt: -1 },
  { name: 'payment_bill_paidAt_idx' },
);

PaymentSchema.index(
  { clinicId: 1, billId: 1, idempotencyKey: 1 },
  {
    unique: true,
    name: 'payment_idempotency_unique_idx',
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);
```

Notes:
- `idempotencyKey` is **schema-optional** (no `required: true`). The DTO enforces required at the API boundary. This keeps existing rows without the field readable, and the partial filter on `{ idempotencyKey: { $type: 'string' } }` makes the unique index ignore them.
- The application code will always set `idempotencyKey` on new inserts via the service.

### Step 1.5 — Service spec (TDD red)

Create `backend/src/modules/billing/billing.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BillingService } from './billing.service';
import { BillStatus } from './schemas/bill.schema';
import { PaymentMethod } from './schemas/payment.schema';

describe('BillingService.addPayment idempotency', () => {
  let billModel: any;
  let paymentModel: any;
  let serviceModel: any;
  let service: BillingService;

  function makeIssuedBill(overrides: any = {}) {
    return {
      _id: new Types.ObjectId(),
      clinicId: new Types.ObjectId(),
      branchId: new Types.ObjectId(),
      status: BillStatus.Issued,
      ...overrides,
    };
  }

  beforeEach(() => {
    billModel = {
      findOne: jest.fn(),
    };
    paymentModel = {
      create: jest.fn(),
      findOne: jest.fn(),
    };
    serviceModel = {};
    service = new BillingService(billModel, paymentModel, serviceModel);
  });

  it('inserts a fresh payment when no row exists for the key', async () => {
    const bill = makeIssuedBill();
    billModel.findOne.mockResolvedValue(bill);
    const inserted = {
      _id: new Types.ObjectId(),
      billId: bill._id,
      idempotencyKey: 'k-12345678',
      amount: 100,
    };
    paymentModel.create.mockResolvedValue(inserted);

    const out = await service.addPayment(
      bill.clinicId,
      undefined,
      bill._id.toHexString(),
      {
        method: PaymentMethod.Cash,
        amount: 100,
        idempotencyKey: 'k-12345678',
      },
    );

    expect(out.payment).toBe(inserted);
    expect(out.replayed).toBe(false);
    expect(paymentModel.create).toHaveBeenCalledTimes(1);
    expect(paymentModel.findOne).not.toHaveBeenCalled();
  });

  it('returns the original payment with replayed=true on duplicate-key error', async () => {
    const bill = makeIssuedBill();
    billModel.findOne.mockResolvedValue(bill);

    const dupErr: any = new Error('E11000 duplicate key error');
    dupErr.code = 11000;
    paymentModel.create.mockRejectedValue(dupErr);

    const original = {
      _id: new Types.ObjectId(),
      billId: bill._id,
      idempotencyKey: 'k-12345678',
      amount: 100,
    };
    paymentModel.findOne.mockResolvedValue(original);

    const out = await service.addPayment(
      bill.clinicId,
      undefined,
      bill._id.toHexString(),
      {
        method: PaymentMethod.Cash,
        amount: 100,
        idempotencyKey: 'k-12345678',
      },
    );

    expect(out.payment).toBe(original);
    expect(out.replayed).toBe(true);
    expect(paymentModel.findOne).toHaveBeenCalledWith({
      clinicId: bill.clinicId,
      billId: bill._id,
      idempotencyKey: 'k-12345678',
    });
  });

  it('rethrows non-duplicate errors unchanged', async () => {
    const bill = makeIssuedBill();
    billModel.findOne.mockResolvedValue(bill);

    const otherErr: any = new Error('connection lost');
    otherErr.code = 'ECONNRESET';
    paymentModel.create.mockRejectedValue(otherErr);

    await expect(
      service.addPayment(bill.clinicId, undefined, bill._id.toHexString(), {
        method: PaymentMethod.Cash,
        amount: 100,
        idempotencyKey: 'k-12345678',
      }),
    ).rejects.toBe(otherErr);
  });

  it('rejects payments on a non-issued bill before touching paymentModel', async () => {
    const bill = makeIssuedBill({ status: BillStatus.Draft });
    billModel.findOne.mockResolvedValue(bill);

    await expect(
      service.addPayment(bill.clinicId, undefined, bill._id.toHexString(), {
        method: PaymentMethod.Cash,
        amount: 100,
        idempotencyKey: 'k-12345678',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(paymentModel.create).not.toHaveBeenCalled();
  });

  it('rejects invalid amount before touching paymentModel', async () => {
    const bill = makeIssuedBill();
    billModel.findOne.mockResolvedValue(bill);

    await expect(
      service.addPayment(bill.clinicId, undefined, bill._id.toHexString(), {
        method: PaymentMethod.Cash,
        amount: 0,
        idempotencyKey: 'k-12345678',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(paymentModel.create).not.toHaveBeenCalled();
  });
});
```

### Step 1.6 — Run service spec — expect failure

Run: `pnpm test -- billing.service.spec.ts`

Expected: all 5 cases fail. Either the property `replayed` doesn't exist on the return shape, or the duplicate-key error path bubbles out as a 500 instead of being caught. Confirm the failure mode before continuing.

### Step 1.7 — Update `BillingService.addPayment`

Edit `backend/src/modules/billing/billing.service.ts`. Replace the `addPayment` method only (lines ~111-143). The new shape returns `{ payment, replayed }`.

```ts
async addPayment(
  clinicId: Types.ObjectId,
  actorUserId: Types.ObjectId | undefined,
  billId: string,
  dto: CreatePaymentDto,
): Promise<{ payment: Payment; replayed: boolean }> {
  const bill = await this.getBill(clinicId, billId);
  if (bill.status !== BillStatus.Issued)
    throw new BadRequestException(
      'Payments can be added only to issued bills',
    );

  const amount = Number(dto.amount);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new BadRequestException('Invalid amount');

  const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
  if (isNaN(paidAt.getTime()))
    throw new BadRequestException('Invalid paidAt');

  try {
    const payment = await this.paymentModel.create({
      clinicId,
      branchId: bill.branchId,
      billId: bill._id,
      method: dto.method,
      amount,
      providerRef: dto.providerRef,
      paidAt,
      receivedBy: actorUserId,
      idempotencyKey: dto.idempotencyKey,
    });
    return { payment, replayed: false };
  } catch (err: any) {
    if (err && err.code === 11000) {
      const original = await this.paymentModel.findOne({
        clinicId,
        billId: bill._id,
        idempotencyKey: dto.idempotencyKey,
      });
      if (original) return { payment: original, replayed: true };
    }
    throw err;
  }
}
```

`getBill` already throws `NotFoundException` for missing/cross-tenant ids — preserved.

### Step 1.8 — Run service spec — expect pass

Run: `pnpm test -- billing.service.spec.ts`

Expected: 5/5 green.

### Step 1.9 — Update controller to surface the replay header

Edit `backend/src/modules/billing/billing.controller.ts`. The `addPayment` handler (around line 64-77) needs to read `replayed` and set the header. Use `@Res({ passthrough: true })` so Nest still serializes the return value:

```ts
import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';

// ... existing imports ...

@Post('bills/:id/payments')
@RequirePermissions(Permission.BillingWrite)
async addPayment(
  @Req() req: AppRequest,
  @Param('id') billId: string,
  @Body() dto: CreatePaymentDto,
  @Res({ passthrough: true }) res: Response,
) {
  const result = await this.billing.addPayment(
    req.context!.clinicId,
    req.context!.actorUserId,
    billId,
    dto,
  );
  if (result.replayed) {
    res.setHeader('X-Idempotent-Replay', 'true');
  }
  return result.payment;
}
```

The response body shape stays unchanged for callers. Only the new header signals replay.

### Step 1.10 — Run full suite

Run: `pnpm test`

Expected: all green. Existing billing tests should be unaffected — they don't touch `addPayment` directly.

### Step 1.11 — Build

Run: `pnpm build` → exit 0.

### Step 1.12 — Manual smoke (best effort, skip if unreachable)

```bash
H='-H Content-Type:application/json -H x-clinic-id:507f1f77bcf86cd799439011 -H x-user-id:507f1f77bcf86cd799439011'

# Missing idempotencyKey → 400
curl -s -o /dev/null -w 'no-key=%{http_code}\n' -X POST $H \
  -d '{"method":"CASH","amount":100}' \
  http://localhost:4000/bills/000000000000000000000000/payments

# Short idempotencyKey → 400
curl -s -o /dev/null -w 'short-key=%{http_code}\n' -X POST $H \
  -d '{"method":"CASH","amount":100,"idempotencyKey":"abc"}' \
  http://localhost:4000/bills/000000000000000000000000/payments
```

Expected: both `=400`. If unreachable, skip with a note.

### Step 1.13 — Stage for commit

Stage:
```bash
git add backend/src/modules/billing/
```

Verify `git diff --name-only --cached` lists exactly:
- `backend/src/modules/billing/billing.controller.ts`
- `backend/src/modules/billing/billing.service.spec.ts`
- `backend/src/modules/billing/billing.service.ts`
- `backend/src/modules/billing/dto/create-payment.dto.spec.ts`
- `backend/src/modules/billing/dto/create-payment.dto.ts`
- `backend/src/modules/billing/schemas/payment.schema.ts`

Proposed commit message (do NOT apply):

```
feat(billing): make payment creation idempotent

POST /bills/:id/payments now requires idempotencyKey (8-64 chars).
A repeat POST with the same key on the same bill returns the
original Payment with header X-Idempotent-Replay: true instead of
inserting a duplicate row. Enforced by a partial unique index on
(clinicId, billId, idempotencyKey); existing rows without the
field are excluded by the partial filter.

Service returns { payment, replayed } so the controller can set
the header without leaking HTTP concerns into the service layer.
```

---

## Task 2 — Frontend: generate + reuse UUID per Add-Payment

**Files:**
- Modify: `frontend/src/ui/screens/BillingScreen.tsx`

### Step 2.1 — Locate the AddPaymentSheet

Find the component holding `method`/`amount`/`providerRef` state and the `apiPost(ctx, /bills/${bill._id}/payments, ...)` call (around `BillingScreen.tsx:399-420`).

### Step 2.2 — Generate UUID on mount, persist across retries

Add a `useState` initialized via `crypto.randomUUID()` so the key is stable across re-renders and retries within a single sheet open. Reset implicitly when the sheet remounts (i.e., user closes and reopens — that's a new logical payment).

Sketch:

```tsx
const [idempotencyKey] = useState(() => crypto.randomUUID());
```

Place this alongside the existing `useState` calls in the sheet component. `crypto.randomUUID()` is available in all evergreen browsers and Node 14.17+; no polyfill needed for this project's targets.

### Step 2.3 — Send the key with the body

Update the `apiPost` call to include `idempotencyKey`:

```tsx
await apiPost(ctx, `/bills/${bill._id}/payments`, {
  method,
  amount: Number(amount),
  providerRef: providerRef || undefined,
  idempotencyKey,
});
```

(Adapt to existing variable names. If `providerRef` is already conditionally appended, keep that style.)

### Step 2.4 — Verify the build

Run: `cd frontend && pnpm build`

Expected: `tsc && vite build` exit 0. Strict TS will catch any typos in `idempotencyKey`.

### Step 2.5 — Manual smoke (best effort)

If a backend + frontend pair is reachable: open BillingScreen, issue a bill, click "Add payment", submit, then submit again with the SAME sheet open (without closing). Browser DevTools Network tab on the second submit should show response header `X-Idempotent-Replay: true` and the body should match the first response. Close + reopen sheet, submit → fresh row, no header.

If unreachable, note "Smoke skipped: [reason]" in the report.

### Step 2.6 — Stage for commit

Stage:
```bash
git add frontend/src/ui/screens/BillingScreen.tsx
```

Proposed commit message:

```
feat(billing/ui): send idempotencyKey with each payment submit

Generates a UUIDv4 once per Add-Payment sheet open and reuses it
across submit retries. Closing and reopening the sheet starts a
fresh logical payment with a new key.
```

---

## Task 3 — Final verification + CLAUDE.md note

**Files:**
- Modify: `/mnt/Dev/Vidhema/DigiRx/CLAUDE.md`

### Step 3.1 — Backend full suite

Run: `cd backend && pnpm test` → all green. Record the count.

### Step 3.2 — Backend build

Run: `pnpm build` → exit 0.

### Step 3.3 — Frontend build

Run: `cd frontend && pnpm build` → exit 0.

### Step 3.4 — Manual smoke (best effort)

If reachable, repeat Step 1.12 plus a happy-path replay using the same key twice on a real issued bill:

```bash
KEY=$(uuidgen)
H='-H Content-Type:application/json -H x-clinic-id:<real-id> -H x-user-id:<real-id>'

# First POST → 200, no replay header
curl -s -D - -X POST $H -d "{\"method\":\"CASH\",\"amount\":100,\"idempotencyKey\":\"$KEY\"}" \
  http://localhost:4000/bills/<issued-bill-id>/payments

# Second POST same key → 200, X-Idempotent-Replay: true, same _id in body
curl -s -D - -X POST $H -d "{\"method\":\"CASH\",\"amount\":100,\"idempotencyKey\":\"$KEY\"}" \
  http://localhost:4000/bills/<issued-bill-id>/payments
```

If unreachable, skip with reason.

### Step 3.5 — Update CLAUDE.md

In `/mnt/Dev/Vidhema/DigiRx/CLAUDE.md`, find the "Billing" section. Add a short paragraph at the end of that section:

> `POST /bills/:id/payments` requires a client-generated `idempotencyKey` (8–64 chars; UUIDv4 in the FE). A repeat POST with the same key on the same bill returns the original payment with `X-Idempotent-Replay: true`, enforced by a partial unique index on `(clinicId, billId, idempotencyKey)`.

### Step 3.6 — Stage CLAUDE.md

```bash
git add CLAUDE.md
```

Proposed commit message:
```
docs: note payment idempotency in CLAUDE.md
```

### Step 3.7 — Workstream exit-bar checklist

Confirm each criterion with concrete evidence:

- [ ] DTO rejects missing/short `idempotencyKey` (cite the spec cases).
- [ ] Service returns `{ payment, replayed }` and the duplicate-key path returns the original (cite the spec case).
- [ ] Controller sets `X-Idempotent-Replay: true` on replay (cite the controller line).
- [ ] Partial unique index on `(clinicId, billId, idempotencyKey)` declared (cite the schema line).
- [ ] Frontend generates UUIDv4 per sheet open and includes it in the submit body (cite the BillingScreen line).

## Report

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Test + build output (backend + frontend)
- Manual smoke result (or reason skipped)
- Exit-bar checklist with evidence
- Files staged
- Proposed commit message
- Anything surprising

Under 500 words.

---

## Notes for the executing engineer

- **Why `replayed` in the service return shape, not on the document?** The replay flag is a per-request concern, not a stored attribute. Adding it to the schema would invite confusion (it would be `false` forever after the first response). A small wrapper object keeps the boundary clean.
- **Why a partial unique index, not a regular unique index?** Existing rows in dev/staging databases have no `idempotencyKey`. A regular unique index on a missing field treats them all as `null` and collides. `partialFilterExpression: { idempotencyKey: { $type: 'string' } }` makes the index ignore those rows entirely.
- **Why `min: 8` on the DTO instead of validating UUID format?** Allows ad-hoc keys for non-browser callers (CLI scripts, server-to-server) while still preventing trivial collisions like `"1"` or empty strings. The frontend always sends a UUIDv4 anyway.
- **Race condition coverage:** The service spec simulates the race by stubbing `paymentModel.create` to reject with `code: 11000`. In a real concurrent run, Mongo enforces uniqueness at the storage layer; the second writer gets `E11000`, the catch block resolves it. No application-level locking needed.
- **Don't** add a separate idempotency table or middleware. The roadmap's scope is field-level on the payment row, which is sufficient and avoids cross-cutting machinery.
- **Don't** change the response body shape on replay. Only the header signals it. Existing callers that parse the body keep working.
- **Don't** strip `idempotencyKey` from the response — it's harmless to include (the client already knows it) and useful for debugging.
