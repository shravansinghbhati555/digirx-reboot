# Workstream 0.2 — Enforce DTO validation globally

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **Commit discipline:** Per user preference, never run `git commit` without explicit approval. Each task's final step stages the files and proposes a commit message; wait for user confirmation.

**Goal:** DTO decorators (already written and shipped) become enforcement, not decoration. A global `ValidationPipe` rejects any request with bad body shape at 400 before the handler runs. Every DTO under `backend/src/modules/*/dto/` gets concrete `class-validator` decorators. Local `ValidationPipe` usages in the two controllers that currently have them are removed so there's one enforcement point.

**Architecture:** Keep it simple. The global `ValidationPipe` is wired **last** (Task 7). Decorators on all 12 DTOs land first (Tasks 2-6), so turning on the pipe with `whitelist: true, forbidNonWhitelisted: true, transform: true` doesn't silently strip fields from endpoints that haven't been decorated yet. Each intermediate commit leaves the backend functional — the local pipes in tenancy/availability stay in place until Task 7 removes them atomically with the global upgrade.

For per-DTO correctness tests, use `class-transformer`'s `plainToInstance` + `class-validator`'s `validate` directly — no HTTP layer needed, no NestJS app boot, no Mongo. A tiny shared helper under `backend/src/common/test/dto-validator.ts` keeps individual specs short. The 3 DTOs that are already validated (`patch-clinic-settings.dto.ts`, `upsert-rules.dto.ts`, `upsert-override.dto.ts`) serve as the pattern — match their style.

**Tech Stack:** `class-validator` 0.15, `class-transformer` 0.5 (both already dependencies). Jest 30.

**Exit bar for this workstream:**
- Global `ValidationPipe` registered in `main.ts` before `app.listen`.
- Every DTO under `backend/src/modules/*/dto/` has `class-validator` decorators on every field.
- No controller instantiates its own `ValidationPipe` anymore.
- One DTO-level spec per module assertions at least one field rejection.
- Full test suite green.

---

## Current state (audit, 2026-04-23)

**DTOs with existing decorators (pattern reference — don't touch):**
- `backend/src/modules/availability/dto/upsert-rules.dto.ts`
- `backend/src/modules/availability/dto/upsert-override.dto.ts`
- `backend/src/modules/tenancy/dto/patch-clinic-settings.dto.ts`

**DTOs to decorate (12):**

| Module | File | Notes |
|---|---|---|
| appointments | `create-appointment.dto.ts` | enum + 3 mongo IDs + ISO dates + YYYY-MM-DD |
| appointments | `update-appointment.dto.ts` | enum + ISO dates |
| billing | `bill-item.dto.ts` | **currently a type alias — must convert to class** |
| billing | `create-bill.dto.ts` | depends on `BillItemDto` class conversion |
| billing | `create-payment.dto.ts` | enum + number |
| billing | `update-bill.dto.ts` | depends on `BillItemDto` |
| documents | `create-upload-url.dto.ts` | 2 enums + mongo ID + filename |
| encounters | `create-encounter.dto.ts` | 3 mongo IDs + ISO |
| encounters | `update-encounter.dto.ts` | ISO + generic object vitals |
| notifications | `test-notification.dto.ts` | enum + string phone |
| patients | `create-patient.dto.ts` | enum + ISO + arrays |
| prescriptions | `create-prescription.dto.ts` | **`CreatePrescriptionItemDto` is a type alias — must convert to class** |

**Local `ValidationPipe` usages to remove:**
- `backend/src/modules/tenancy/tenancy.controller.ts` — `new ValidationPipe({ whitelist: true, ... })` wrapped around `@Body()`
- `backend/src/modules/availability/availability.controller.ts` — same

---

## File Structure

**Create:**
- `backend/src/common/test/dto-validator.ts` — shared `expectInvalid` / `expectValid` helpers
- `backend/src/modules/appointments/dto/create-appointment.dto.spec.ts`
- `backend/src/modules/billing/dto/create-bill.dto.spec.ts`
- `backend/src/modules/encounters/dto/create-encounter.dto.spec.ts`
- `backend/src/modules/documents/dto/create-upload-url.dto.spec.ts`
- `backend/src/modules/notifications/dto/test-notification.dto.spec.ts`
- `backend/src/modules/patients/dto/create-patient.dto.spec.ts`
- `backend/src/modules/prescriptions/dto/create-prescription.dto.spec.ts`

**Modify (DTOs — add validators):**
- `backend/src/modules/appointments/dto/create-appointment.dto.ts`
- `backend/src/modules/appointments/dto/update-appointment.dto.ts`
- `backend/src/modules/billing/dto/bill-item.dto.ts` (type → class)
- `backend/src/modules/billing/dto/create-bill.dto.ts`
- `backend/src/modules/billing/dto/create-payment.dto.ts`
- `backend/src/modules/billing/dto/update-bill.dto.ts`
- `backend/src/modules/documents/dto/create-upload-url.dto.ts`
- `backend/src/modules/encounters/dto/create-encounter.dto.ts`
- `backend/src/modules/encounters/dto/update-encounter.dto.ts`
- `backend/src/modules/notifications/dto/test-notification.dto.ts`
- `backend/src/modules/patients/dto/create-patient.dto.ts`
- `backend/src/modules/prescriptions/dto/create-prescription.dto.ts` (inner type → class)

**Modify (wiring):**
- `backend/src/main.ts` — `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))`
- `backend/src/modules/tenancy/tenancy.controller.ts` — drop local `ValidationPipe`
- `backend/src/modules/availability/availability.controller.ts` — drop local `ValidationPipe`

---

## Task 1 — DTO test helper

**Files:**
- Create: `backend/src/common/test/dto-validator.ts`

> **Why first:** Tasks 2-6 each add a `*.dto.spec.ts` that imports `expectInvalid` / `expectValid` from this helper. The helper must exist before they run.

### Step 1.1 — Baseline the full test suite

Run: `cd backend && pnpm test`

Expected: 21/21 green. Record the baseline.

### Step 1.2 — Create the DTO test helper

Create `backend/src/common/test/dto-validator.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

type Ctor<T> = new (...args: any[]) => T;

/**
 * Assert the given plain object fails class-validator validation when cast to Cls,
 * with at least one error on `onProperty`. Returns the full error array for further
 * assertions if needed.
 */
export async function expectInvalid<T extends object>(
  Cls: Ctor<T>,
  plain: unknown,
  onProperty: keyof T,
): Promise<ValidationError[]> {
  const instance = plainToInstance(Cls, plain);
  const errors = await validate(instance as object);
  const matching = findErrorByProperty(errors, String(onProperty));
  if (!matching) {
    throw new Error(
      `Expected a validation error on property "${String(onProperty)}", got: ${JSON.stringify(
        errors,
        null,
        2,
      )}`,
    );
  }
  return errors;
}

export async function expectValid<T extends object>(
  Cls: Ctor<T>,
  plain: unknown,
): Promise<void> {
  const instance = plainToInstance(Cls, plain);
  const errors = await validate(instance as object);
  if (errors.length > 0) {
    throw new Error(
      `Expected no validation errors, got: ${JSON.stringify(errors, null, 2)}`,
    );
  }
}

function findErrorByProperty(errors: ValidationError[], property: string): ValidationError | undefined {
  for (const e of errors) {
    if (e.property === property) return e;
    if (e.children && e.children.length > 0) {
      const nested = findErrorByProperty(e.children, property);
      if (nested) return nested;
    }
  }
  return undefined;
}
```

### Step 1.3 — Sanity: full suite still green

Run: `cd backend && pnpm test`

Expected: 21/21 still green. The helper has no runtime effect on the app — it's only imported from `*.spec.ts` files that don't exist yet.

### Step 1.4 — Stage for commit (DO NOT COMMIT)

Stage:
```bash
git add backend/src/common/test/dto-validator.ts
```

Proposed commit message:
```
test: add expectInvalid/expectValid helpers for DTO specs

A thin wrapper around class-transformer's plainToInstance and
class-validator's validate() so per-DTO specs can assert bad inputs
are rejected on a specific property with readable failure messages.
Used by the DTO specs in workstream 0.2 Tasks 2-6.
```

---

## Task 2 — Decorate appointments DTOs + specs

**Files:**
- Modify: `backend/src/modules/appointments/dto/create-appointment.dto.ts`
- Modify: `backend/src/modules/appointments/dto/update-appointment.dto.ts`
- Create: `backend/src/modules/appointments/dto/create-appointment.dto.spec.ts`

### Step 2.1 — Write the failing `CreateAppointmentDto` spec

Create `backend/src/modules/appointments/dto/create-appointment.dto.spec.ts`:

```ts
import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { CreateAppointmentDto } from './create-appointment.dto';

const ID = '507f1f77bcf86cd799439011';

describe('CreateAppointmentDto', () => {
  it('accepts a valid TIME appointment', async () => {
    await expectValid(CreateAppointmentDto, {
      type: 'TIME',
      branchId: ID,
      doctorId: ID,
      patientId: ID,
      startAt: '2026-05-01T10:00:00.000Z',
      endAt: '2026-05-01T10:15:00.000Z',
    });
  });

  it('accepts a valid QUEUE appointment', async () => {
    await expectValid(CreateAppointmentDto, {
      type: 'QUEUE',
      branchId: ID,
      doctorId: ID,
      patientId: ID,
      queueDate: '2026-05-01',
    });
  });

  it('rejects an unknown type', async () => {
    await expectInvalid(
      CreateAppointmentDto,
      { type: 'BOGUS', branchId: ID, doctorId: ID, patientId: ID },
      'type',
    );
  });

  it('rejects non-mongo branchId', async () => {
    await expectInvalid(
      CreateAppointmentDto,
      { type: 'TIME', branchId: 'not-an-id', doctorId: ID, patientId: ID },
      'branchId',
    );
  });

  it('rejects non-ISO startAt', async () => {
    await expectInvalid(
      CreateAppointmentDto,
      {
        type: 'TIME',
        branchId: ID,
        doctorId: ID,
        patientId: ID,
        startAt: 'yesterday',
        endAt: '2026-05-01T10:15:00.000Z',
      },
      'startAt',
    );
  });

  it('rejects malformed queueDate', async () => {
    await expectInvalid(
      CreateAppointmentDto,
      { type: 'QUEUE', branchId: ID, doctorId: ID, patientId: ID, queueDate: '05/01/2026' },
      'queueDate',
    );
  });
});
```

### Step 2.2 — Run the spec — expect failures

Run: `cd backend && pnpm test -- create-appointment.dto.spec.ts`

Expected: every test fails because no decorators exist on the DTO yet.

### Step 2.3 — Decorate `CreateAppointmentDto`

Replace the full contents of `backend/src/modules/appointments/dto/create-appointment.dto.ts`:

```ts
import { IsEnum, IsISO8601, IsMongoId, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
  AppointmentSource,
  AppointmentType,
} from '../schemas/appointment.schema';

export class CreateAppointmentDto {
  @IsEnum(AppointmentType)
  type!: AppointmentType;

  @IsMongoId()
  branchId!: string;

  @IsMongoId()
  doctorId!: string;

  @IsMongoId()
  patientId!: string;

  // TIME
  @IsOptional()
  @IsISO8601()
  startAt?: string;

  @IsOptional()
  @IsISO8601()
  endAt?: string;

  // QUEUE (YYYY-MM-DD)
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'queueDate must be YYYY-MM-DD' })
  queueDate?: string;

  @IsOptional()
  @IsEnum(AppointmentSource)
  source?: AppointmentSource;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
```

### Step 2.4 — Decorate `UpdateAppointmentDto`

Replace the full contents of `backend/src/modules/appointments/dto/update-appointment.dto.ts`:

```ts
import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { AppointmentStatus } from '../schemas/appointment.schema';

export class UpdateAppointmentDto {
  @IsOptional()
  @IsISO8601()
  startAt?: string;

  @IsOptional()
  @IsISO8601()
  endAt?: string;

  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
```

### Step 2.5 — Run the spec — expect pass

Run: `pnpm test -- create-appointment.dto.spec.ts`

Expected: 6/6 pass.

### Step 2.6 — Run full suite

Run: `pnpm test`

Expected: 21 previous + 6 new = 27 green.

### Step 2.7 — Stage for commit

Stage:
```bash
git add backend/src/modules/appointments/dto/create-appointment.dto.ts backend/src/modules/appointments/dto/update-appointment.dto.ts backend/src/modules/appointments/dto/create-appointment.dto.spec.ts
```

Proposed commit message:
```
feat(appointments): validate Create/Update DTOs

Adds class-validator decorators — enum type + source + status, IsMongoId
for branch/doctor/patient IDs, IsISO8601 for timestamps, a YYYY-MM-DD
regex for queueDate, and length caps on free-text notes.
```

---

## Task 3 — Decorate billing DTOs + spec

**Files:**
- Modify: `backend/src/modules/billing/dto/bill-item.dto.ts` (type alias → class)
- Modify: `backend/src/modules/billing/dto/create-bill.dto.ts`
- Modify: `backend/src/modules/billing/dto/create-payment.dto.ts`
- Modify: `backend/src/modules/billing/dto/update-bill.dto.ts`
- Create: `backend/src/modules/billing/dto/create-bill.dto.spec.ts`

### Step 3.1 — Write the failing `CreateBillDto` spec

Create `backend/src/modules/billing/dto/create-bill.dto.spec.ts`:

```ts
import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { CreateBillDto } from './create-bill.dto';

const ID = '507f1f77bcf86cd799439011';

const validItem = {
  customName: 'Consultation',
  quantity: 1,
  unitPrice: 500,
};

describe('CreateBillDto', () => {
  it('accepts a valid bill', async () => {
    await expectValid(CreateBillDto, {
      branchId: ID,
      patientId: ID,
      items: [validItem],
    });
  });

  it('rejects non-mongo branchId', async () => {
    await expectInvalid(
      CreateBillDto,
      { branchId: 'x', patientId: ID, items: [validItem] },
      'branchId',
    );
  });

  it('rejects empty items array', async () => {
    await expectInvalid(
      CreateBillDto,
      { branchId: ID, patientId: ID, items: [] },
      'items',
    );
  });

  it('rejects non-positive quantity in item', async () => {
    await expectInvalid(
      CreateBillDto,
      { branchId: ID, patientId: ID, items: [{ ...validItem, quantity: 0 }] },
      'quantity',
    );
  });

  it('rejects negative unitPrice in item', async () => {
    await expectInvalid(
      CreateBillDto,
      { branchId: ID, patientId: ID, items: [{ ...validItem, unitPrice: -1 }] },
      'unitPrice',
    );
  });

  it('rejects non-mongo appointmentId when provided', async () => {
    await expectInvalid(
      CreateBillDto,
      { branchId: ID, patientId: ID, appointmentId: 'x', items: [validItem] },
      'appointmentId',
    );
  });
});
```

### Step 3.2 — Run the spec — expect failures

Run: `cd backend && pnpm test -- create-bill.dto.spec.ts`

Expected: every test fails — no decorators yet.

### Step 3.3 — Convert `BillItemDto` from type to class

Replace the full contents of `backend/src/modules/billing/dto/bill-item.dto.ts`:

```ts
import { IsInt, IsMongoId, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class BillItemDto {
  @IsOptional()
  @IsMongoId()
  serviceCatalogItemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customName?: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsInt()
  @Min(0)
  unitPrice!: number;
}
```

### Step 3.4 — Decorate `CreateBillDto`

Replace the full contents of `backend/src/modules/billing/dto/create-bill.dto.ts`:

```ts
import { ArrayMinSize, IsArray, IsMongoId, IsNumber, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BillItemDto } from './bill-item.dto';

export class CreateBillDto {
  @IsMongoId()
  branchId!: string;

  @IsMongoId()
  patientId!: string;

  @IsOptional()
  @IsMongoId()
  appointmentId?: string;

  @IsOptional()
  @IsMongoId()
  encounterId?: string;

  @IsOptional()
  @IsString()
  @Length(3, 8)
  currency?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BillItemDto)
  items!: BillItemDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tax?: number;
}
```

### Step 3.5 — Decorate `CreatePaymentDto`

Replace the full contents of `backend/src/modules/billing/dto/create-payment.dto.ts`:

```ts
import { IsEnum, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
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
}
```

### Step 3.6 — Decorate `UpdateBillDto`

Replace the full contents of `backend/src/modules/billing/dto/update-bill.dto.ts`:

```ts
import { IsArray, IsEnum, IsNumber, IsOptional, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BillItemDto } from './bill-item.dto';
import { BillStatus } from '../schemas/bill.schema';

export class UpdateBillDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BillItemDto)
  items?: BillItemDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tax?: number;

  @IsOptional()
  @IsEnum(BillStatus)
  status?: BillStatus;
}
```

### Step 3.7 — Run the spec — expect pass

Run: `pnpm test -- create-bill.dto.spec.ts`

Expected: 6/6 pass.

### Step 3.8 — Full suite

Run: `pnpm test`

Expected: 33 green (21 + 6 + 6).

### Step 3.9 — Stage for commit

Stage:
```bash
git add backend/src/modules/billing/dto/
```

Proposed commit message:
```
feat(billing): validate bill, payment, bill-item DTOs

Converts BillItemDto from a type alias to a class so class-validator
nested validation works via @ValidateNested + @Type. Adds validators
on CreateBillDto, UpdateBillDto, CreatePaymentDto — IsMongoId for IDs,
IsArray + ArrayMinSize for items, Min constraints on amounts.
```

---

## Task 4 — Decorate encounters DTOs + spec

**Files:**
- Modify: `backend/src/modules/encounters/dto/create-encounter.dto.ts`
- Modify: `backend/src/modules/encounters/dto/update-encounter.dto.ts`
- Create: `backend/src/modules/encounters/dto/create-encounter.dto.spec.ts`

### Step 4.1 — Write the failing `CreateEncounterDto` spec

Create `backend/src/modules/encounters/dto/create-encounter.dto.spec.ts`:

```ts
import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { CreateEncounterDto } from './create-encounter.dto';

const ID = '507f1f77bcf86cd799439011';

describe('CreateEncounterDto', () => {
  it('accepts a minimally valid encounter', async () => {
    await expectValid(CreateEncounterDto, {
      branchId: ID,
      doctorId: ID,
      patientId: ID,
    });
  });

  it('rejects non-mongo branchId', async () => {
    await expectInvalid(
      CreateEncounterDto,
      { branchId: 'x', doctorId: ID, patientId: ID },
      'branchId',
    );
  });

  it('rejects non-ISO visitedAt', async () => {
    await expectInvalid(
      CreateEncounterDto,
      { branchId: ID, doctorId: ID, patientId: ID, visitedAt: 'now' },
      'visitedAt',
    );
  });

  it('rejects non-mongo appointmentId when provided', async () => {
    await expectInvalid(
      CreateEncounterDto,
      { branchId: ID, doctorId: ID, patientId: ID, appointmentId: 'x' },
      'appointmentId',
    );
  });
});
```

### Step 4.2 — Run — expect failures

`pnpm test -- create-encounter.dto.spec.ts` → all fail.

### Step 4.3 — Decorate `CreateEncounterDto`

Replace the full contents of `backend/src/modules/encounters/dto/create-encounter.dto.ts`:

```ts
import { IsISO8601, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEncounterDto {
  @IsMongoId()
  branchId!: string;

  @IsMongoId()
  doctorId!: string;

  @IsMongoId()
  patientId!: string;

  @IsOptional()
  @IsMongoId()
  appointmentId?: string;

  @IsOptional()
  @IsISO8601()
  visitedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  chiefComplaint?: string;
}
```

### Step 4.4 — Decorate `UpdateEncounterDto`

Replace the full contents of `backend/src/modules/encounters/dto/update-encounter.dto.ts`:

```ts
import { IsISO8601, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateEncounterDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  chiefComplaint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  diagnosis?: string;

  @IsOptional()
  @IsObject()
  vitals?: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  followUpAt?: string;
}
```

### Step 4.5 — Run — expect pass

`pnpm test -- create-encounter.dto.spec.ts` → 4/4 pass.

### Step 4.6 — Full suite

`pnpm test` → 37 green (33 + 4).

### Step 4.7 — Stage

```bash
git add backend/src/modules/encounters/dto/
```

Proposed commit message:
```
feat(encounters): validate Create/Update DTOs

IsMongoId for branch/doctor/patient/appointment IDs, IsISO8601 for
visitedAt and followUpAt, length caps on free-text chief complaint /
notes / diagnosis, IsObject for the vitals map.
```

---

## Task 5 — Decorate single-DTO modules (documents, notifications, patients) + specs

**Files:**
- Modify: `backend/src/modules/documents/dto/create-upload-url.dto.ts`
- Modify: `backend/src/modules/notifications/dto/test-notification.dto.ts`
- Modify: `backend/src/modules/patients/dto/create-patient.dto.ts`
- Create: `backend/src/modules/documents/dto/create-upload-url.dto.spec.ts`
- Create: `backend/src/modules/notifications/dto/test-notification.dto.spec.ts`
- Create: `backend/src/modules/patients/dto/create-patient.dto.spec.ts`

### Step 5.1 — Documents spec (failing)

Create `backend/src/modules/documents/dto/create-upload-url.dto.spec.ts`:

```ts
import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { CreateUploadUrlDto } from './create-upload-url.dto';

const ID = '507f1f77bcf86cd799439011';

describe('CreateUploadUrlDto', () => {
  it('accepts a valid upload request', async () => {
    await expectValid(CreateUploadUrlDto, {
      ownerType: 'PATIENT',
      ownerId: ID,
      fileName: 'scan.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
  });

  it('rejects unknown ownerType', async () => {
    await expectInvalid(
      CreateUploadUrlDto,
      { ownerType: 'BOGUS', ownerId: ID, fileName: 'x', mimeType: 'x', sizeBytes: 1 },
      'ownerType',
    );
  });

  it('rejects non-mongo ownerId', async () => {
    await expectInvalid(
      CreateUploadUrlDto,
      { ownerType: 'PATIENT', ownerId: 'x', fileName: 'x', mimeType: 'x', sizeBytes: 1 },
      'ownerId',
    );
  });

  it('rejects zero or negative sizeBytes', async () => {
    await expectInvalid(
      CreateUploadUrlDto,
      { ownerType: 'PATIENT', ownerId: ID, fileName: 'x', mimeType: 'x', sizeBytes: 0 },
      'sizeBytes',
    );
  });
});
```

### Step 5.2 — Notifications spec (failing)

Create `backend/src/modules/notifications/dto/test-notification.dto.spec.ts`:

```ts
import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { TestNotificationDto } from './test-notification.dto';

describe('TestNotificationDto', () => {
  it('accepts a valid SMS test', async () => {
    await expectValid(TestNotificationDto, {
      channel: 'SMS',
      to: '+911234567890',
      body: 'hello',
    });
  });

  it('rejects unknown channel', async () => {
    await expectInvalid(
      TestNotificationDto,
      { channel: 'PIGEON', to: '+911234567890', body: 'hello' },
      'channel',
    );
  });

  it('rejects empty body', async () => {
    await expectInvalid(
      TestNotificationDto,
      { channel: 'SMS', to: '+911234567890', body: '' },
      'body',
    );
  });
});
```

### Step 5.3 — Patients spec (failing)

Create `backend/src/modules/patients/dto/create-patient.dto.spec.ts`:

```ts
import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { CreatePatientDto } from './create-patient.dto';

const ID = '507f1f77bcf86cd799439011';

describe('CreatePatientDto', () => {
  it('accepts a minimal valid patient', async () => {
    await expectValid(CreatePatientDto, { fullName: 'Ada Lovelace' });
  });

  it('accepts a full patient', async () => {
    await expectValid(CreatePatientDto, {
      fullName: 'Ada Lovelace',
      gender: 'FEMALE',
      dob: '1815-12-10',
      phones: ['+911234567890'],
      emails: ['ada@example.com'],
      primaryBranchId: ID,
      tags: ['vip'],
      notes: 'Long-term patient',
    });
  });

  it('rejects empty fullName', async () => {
    await expectInvalid(CreatePatientDto, { fullName: '' }, 'fullName');
  });

  it('rejects unknown gender', async () => {
    await expectInvalid(
      CreatePatientDto,
      { fullName: 'Ada', gender: 'DRAGON' },
      'gender',
    );
  });

  it('rejects malformed email in emails[]', async () => {
    await expectInvalid(
      CreatePatientDto,
      { fullName: 'Ada', emails: ['not-an-email'] },
      'emails',
    );
  });

  it('rejects non-mongo primaryBranchId', async () => {
    await expectInvalid(
      CreatePatientDto,
      { fullName: 'Ada', primaryBranchId: 'x' },
      'primaryBranchId',
    );
  });
});
```

### Step 5.4 — Run all three specs — expect failures

```bash
cd backend && pnpm test -- "dto/create-upload-url.dto.spec.ts|dto/test-notification.dto.spec.ts|dto/create-patient.dto.spec.ts"
```

Expected: all three suites fail (no decorators yet).

### Step 5.5 — Decorate `CreateUploadUrlDto`

Replace the full contents of `backend/src/modules/documents/dto/create-upload-url.dto.ts`:

```ts
import { IsEnum, IsInt, IsMongoId, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { DocumentAccess, DocumentOwnerType } from '../schemas/document.schema';

export class CreateUploadUrlDto {
  @IsEnum(DocumentOwnerType)
  ownerType!: DocumentOwnerType;

  @IsMongoId()
  ownerId!: string;

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(255)
  mimeType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsEnum(DocumentAccess)
  access?: DocumentAccess;
}
```

### Step 5.6 — Decorate `TestNotificationDto`

Replace the full contents of `backend/src/modules/notifications/dto/test-notification.dto.ts`:

```ts
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { NotificationChannel } from '../schemas/notification-template.schema';

export class TestNotificationDto {
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  to!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1600)
  body!: string;
}
```

### Step 5.7 — Decorate `CreatePatientDto`

Replace the full contents of `backend/src/modules/patients/dto/create-patient.dto.ts`:

```ts
import { IsArray, IsEmail, IsEnum, IsISO8601, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PatientGender } from '../schemas/patient.schema';

export class CreatePatientDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @IsOptional()
  @IsEnum(PatientGender)
  gender?: PatientGender;

  @IsOptional()
  @IsISO8601()
  dob?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  phones?: string[];

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  emails?: string[];

  @IsOptional()
  @IsMongoId()
  primaryBranchId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
```

### Step 5.8 — Run the three specs — expect pass

```bash
pnpm test -- "dto/create-upload-url.dto.spec.ts|dto/test-notification.dto.spec.ts|dto/create-patient.dto.spec.ts"
```

Expected: all three suites green.

### Step 5.9 — Full suite

`pnpm test` → 50 green (37 + 4 + 3 + 6).

### Step 5.10 — Stage

```bash
git add backend/src/modules/documents/dto/ backend/src/modules/notifications/dto/ backend/src/modules/patients/dto/
```

Proposed commit message:
```
feat: validate documents/notifications/patients DTOs

- CreateUploadUrlDto: IsEnum on ownerType/access, IsMongoId on ownerId,
  length caps on fileName/mimeType, Min 1 on sizeBytes.
- TestNotificationDto: IsEnum channel, bounded-length to + body.
- CreatePatientDto: length-bounded fullName, IsEnum gender, IsISO8601
  dob, IsEmail on each email, IsMongoId primaryBranchId.
```

---

## Task 6 — Decorate prescriptions DTO + spec

**Files:**
- Modify: `backend/src/modules/prescriptions/dto/create-prescription.dto.ts` (convert inner type to class)
- Create: `backend/src/modules/prescriptions/dto/create-prescription.dto.spec.ts`

### Step 6.1 — Write the failing `CreatePrescriptionDto` spec

Create `backend/src/modules/prescriptions/dto/create-prescription.dto.spec.ts`:

```ts
import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { CreatePrescriptionDto } from './create-prescription.dto';

describe('CreatePrescriptionDto', () => {
  it('accepts a valid prescription with one custom-name item', async () => {
    await expectValid(CreatePrescriptionDto, {
      items: [{ customName: 'Amoxicillin 500mg', dosage: '1 tab', frequency: 'TID', duration: '5d' }],
    });
  });

  it('rejects empty items', async () => {
    await expectInvalid(CreatePrescriptionDto, { items: [] }, 'items');
  });

  it('rejects item with neither customName nor medicineCatalogItemId on any field', async () => {
    // Nested validation: at minimum, one of the two must be provided, but class-validator alone
    // can't express that without a custom validator. For this spec, assert that a non-string
    // customName still surfaces a 'customName' error.
    await expectInvalid(
      CreatePrescriptionDto,
      { items: [{ customName: 123 as unknown as string }] },
      'customName',
    );
  });

  it('rejects non-mongo medicineCatalogItemId in item', async () => {
    await expectInvalid(
      CreatePrescriptionDto,
      { items: [{ medicineCatalogItemId: 'x', customName: 'X' }] },
      'medicineCatalogItemId',
    );
  });
});
```

### Step 6.2 — Run — expect failures

`pnpm test -- create-prescription.dto.spec.ts` → all fail.

### Step 6.3 — Decorate the DTO

Replace the full contents of `backend/src/modules/prescriptions/dto/create-prescription.dto.ts`:

```ts
import { ArrayMinSize, IsArray, IsMongoId, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePrescriptionItemDto {
  @IsOptional()
  @IsMongoId()
  medicineCatalogItemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  dosage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  frequency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  duration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;
}

export class CreatePrescriptionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePrescriptionItemDto)
  items!: CreatePrescriptionItemDto[];
}
```

Note: the type alias `CreatePrescriptionItemDto` becomes a class, and the export stays the same name — consumers don't need to change.

### Step 6.4 — Run the spec — expect pass

`pnpm test -- create-prescription.dto.spec.ts` → 4/4 green.

### Step 6.5 — Full suite

`pnpm test` → 54 green (50 + 4).

### Step 6.6 — Stage

```bash
git add backend/src/modules/prescriptions/dto/
```

Proposed commit message:
```
feat(prescriptions): validate CreatePrescriptionDto

Converts the inner CreatePrescriptionItemDto from a type alias to a
class so @ValidateNested + @Type works. Adds IsMongoId on the optional
catalog item ID, length caps on every free-text field.
```

---

## Task 7 — Wire global `ValidationPipe` + remove local + final verification

**Files:**
- Modify: `backend/src/main.ts`
- Modify: `backend/src/modules/tenancy/tenancy.controller.ts`
- Modify: `backend/src/modules/availability/availability.controller.ts`
- Modify: `CLAUDE.md`

> **Why last:** All 12 DTOs are decorated after Tasks 2-6. Turning on `whitelist: true` + `forbidNonWhitelisted: true` now would strip fields from them earlier — doing it last means the global pipe turns on with every DTO already protected.

### Step 7.1 — Full suite before wiring

Run: `cd backend && pnpm test`

Expected: 54/54 green (21 baseline + 33 from Tasks 2-6).

### Step 7.2 — Wire the global `ValidationPipe`

Replace the full contents of `backend/src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { validateEnv } from './common/config';

async function bootstrap() {
  dotenv.config();
  validateEnv();

  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const allowedOrigins = new Set<string>([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  if (process.env.FRONTEND_ORIGIN) allowedOrigins.add(process.env.FRONTEND_ORIGIN);
  if (process.env.CORS_ORIGINS) {
    for (const o of process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)) {
      allowedOrigins.add(o);
    }
  }

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  });

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
```

### Step 7.3 — Remove local `ValidationPipe` from `TenancyController`

Open `backend/src/modules/tenancy/tenancy.controller.ts`:
1. Remove `ValidationPipe` from the `@nestjs/common` import list.
2. Replace `@Body(new ValidationPipe({ whitelist: true, ... })) body: PatchClinicSettingsDto` with `@Body() body: PatchClinicSettingsDto`.
3. Do not touch handler bodies or other decorators.

### Step 7.4 — Remove local `ValidationPipe` from `AvailabilityController`

Open `backend/src/modules/availability/availability.controller.ts`:
1. Remove `ValidationPipe` from the `@nestjs/common` import list.
2. For each `@Body(new ValidationPipe({...})) body: XDto`, replace with `@Body() body: XDto` (there are two in this file).
3. Do not touch handler bodies.

### Step 7.5 — Full suite after wiring

`pnpm test`

Expected: 54/54 still green. The pipe is a no-op during unit tests (no HTTP requests).

### Step 7.6 — Build

`pnpm build` → exit 0.

### Step 7.7 — Manual end-to-end smoke

With backend running (`pnpm start:dev` + Mongo + `ALLOW_DEV_AUTH_HEADERS=true`), verify each of these returns 400 (not 500, not 200):

```bash
H='-H Content-Type:application/json -H x-clinic-id:507f1f77bcf86cd799439011 -H x-user-id:507f1f77bcf86cd799439011'

# appointments
curl -s -o /dev/null -w 'appts=%{http_code}\n' -X POST $H http://localhost:4000/appointments -d '{"type":"BOGUS","branchId":"x","doctorId":"x","patientId":"x"}'

# bills
curl -s -o /dev/null -w 'bills=%{http_code}\n' -X POST $H http://localhost:4000/bills -d '{"branchId":"x","patientId":"x","items":[]}'

# patients
curl -s -o /dev/null -w 'patients=%{http_code}\n' -X POST $H http://localhost:4000/patients -d '{}'

# documents upload-url
curl -s -o /dev/null -w 'docs=%{http_code}\n' -X POST $H http://localhost:4000/documents/upload-url -d '{"ownerType":"PATIENT","ownerId":"x"}'

# clinic settings (previously protected by local pipe, now by global)
curl -s -o /dev/null -w 'settings=%{http_code}\n' -X PATCH $H http://localhost:4000/clinic/settings -d '{"appointments":{"mode":"BOGUS"}}'

# forbidNonWhitelisted sanity: extra fields now rejected
curl -s -o /dev/null -w 'extra=%{http_code}\n' -X POST $H http://localhost:4000/patients -d '{"fullName":"Ada","bogusField":"x"}'
```

Expected: every line prints `=400`. If any prints `500`, a DTO-to-service call is crashing before the pipe ran; investigate. If any prints `201`/`200`, a decorator is missing from the corresponding DTO.

If the server isn't reachable for the live smoke, note why and skip.

### Step 7.8 — Update CLAUDE.md

In `/mnt/Dev/Vidhema/DigiRx/CLAUDE.md`, find the "Conventions" section near the end (there's a bullet that starts with "DTOs live under `modules/<x>/dto/`"). Replace that entire bullet:

**Old:**
> DTOs live under `modules/<x>/dto/` and use `class-validator` decorators; they are not yet wired to a global `ValidationPipe` — services still validate defensively.

**New:**
> DTOs live under `modules/<x>/dto/` and use `class-validator` decorators. A global `ValidationPipe` in `main.ts` enforces them with `whitelist: true, forbidNonWhitelisted: true, transform: true`; bad bodies are rejected with 400 before the handler runs. Per-DTO specs under `*.dto.spec.ts` assert both the happy path and at least one rejection case; use the `expectInvalid` / `expectValid` helpers in `backend/src/common/test/dto-validator.ts`.

### Step 7.9 — Stage for commit (DO NOT COMMIT)

Stage exactly these four files:
```bash
git add backend/src/main.ts backend/src/modules/tenancy/tenancy.controller.ts backend/src/modules/availability/availability.controller.ts CLAUDE.md
```

Proposed commit message:
```
feat: wire global ValidationPipe; drop local pipe instances

Adds app.useGlobalPipes(new ValidationPipe({ whitelist, forbidNonWhitelisted,
transform })) in main.ts and removes the local ValidationPipe wrappers
from tenancy and availability controllers. Every DTO is already
decorated (Tasks 2-6), so turning the pipe on strips nothing unexpected
and forbids nothing that shouldn't be forbidden. CLAUDE.md is updated
to document the new convention and the expectInvalid/expectValid helper.
```

### Step 7.10 — Workstream exit-bar checklist

Confirm each roadmap §Phase 0.2 criterion, citing evidence:

- [ ] `app.useGlobalPipes(new ValidationPipe(...))` added in `main.ts`.
- [ ] Every DTO under `backend/src/modules/*/dto/` has `class-validator` decorators on every field (spot-check with `grep -L class-validator backend/src/modules/*/dto/*.ts` — should return empty).
- [ ] Body-posting 400 tests exist for at least one DTO per module (one `.dto.spec.ts` per module with untouched DTOs in Tasks 2–6).
- [ ] No controller instantiates its own `ValidationPipe` (grep: `grep -rn 'new ValidationPipe' backend/src` — should be empty).

---

## Notes for the executing engineer

- **`class-validator` + `class-transformer` are already installed** — no `pnpm add` needed.
- `plainToInstance` from `class-transformer` is the correct API in v0.5+. If you see examples online using `plainToClass`, that's the old name.
- `@IsISO8601()` accepts timestamps with or without milliseconds and with `Z` or `±HH:MM` offsets. It does NOT accept YYYY-MM-DD alone — for that, use `@Matches(/^\d{4}-\d{2}-\d{2}$/)`.
- The `whitelist: true` pipe option **strips** unknown fields from the DTO silently. `forbidNonWhitelisted: true` **rejects** them with 400. Keep both.
- `transform: true` converts strings in query/body to their declared types (e.g., `"5"` → `5` for `@IsInt()`). That's why `@IsInt()` works on query-string params too, if you use DTOs for them.
- Don't add nullable/`@IsOptional()` to required fields. A missing required field must 400.
- If any existing service code relies on extra fields being passed through (e.g., `dto.foo` where `foo` isn't declared on the DTO), `forbidNonWhitelisted` will start rejecting those. That's a **bug** to surface, not a reason to turn off the whitelist — fix the DTO or fix the caller.
- For tests: prefer the `expectInvalid(Cls, plain, 'property')` helper over hand-rolling; it gives readable failures when expectations don't match.
