# Workstream 0.3 — Clinic-timezone correctness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **Commit discipline:** Per user preference, never run `git commit` without explicit approval. Each task stages files and proposes a commit message; wait for user confirmation.

**Goal:** Eliminate the UTC-vs-clinic-TZ drift in `AppointmentsService.listByDate` and `ReportsService` so daily schedules and revenue ranges attribute records to the correct local day. Also tidy two leftover empty `finally {}` blocks in `AppointmentsService.create()`.

**Architecture:** Extract the Luxon pattern that `AvailabilityService.getDaySlots()` already uses into a pure helper `computeClinicDayRange(date, tz) → { startUtc, endUtc }`. That function is trivially unit-testable; it becomes the single place TZ date-range math lives. Then swap it into `listByDate` and the Reports service, the latter gaining a `Clinic` model injection so it can look up the clinic's stored timezone.

The existing `AvailabilityService.getDaySlots` and `AppointmentsService.availableSlots` stay as they are — they already do this correctly inline. Refactoring them to use the helper is in scope for *later* workstreams; this one does not touch working code.

**Tech Stack:** Luxon (already a dep), `class-validator` for the YYYY-MM-DD shape, Jest.

**Exit bar for this workstream:**
- `computeClinicDayRange('2026-05-02', 'Asia/Kolkata')` returns `startUtc = 2026-05-01T18:30:00.000Z`, `endUtc = 2026-05-02T18:29:59.999Z` (unit-tested).
- `AppointmentsService.listByDate` uses the clinic's stored timezone (not UTC).
- `ReportsService` (`revenueSummary`, `dailySchedule`, `pendingPayments` range filters if any) uses the clinic's stored timezone for date parsing.
- Empty `finally {}` blocks removed from `appointments.service.ts`.
- Full test suite green.

---

## Current state (audit, 2026-04-23)

**Files with UTC-only date parsing that must switch to clinic TZ:**
- `backend/src/modules/appointments/appointments.service.ts` — `listByDate` (lines ~236-263); also empty `finally {}` blocks at lines ~155-156 and ~229-230
- `backend/src/modules/reports/reports.service.ts` — `parseDateOnly` (line 8), `parseRange` (line 16), used by `revenueSummary` and `dailySchedule`

**Files already correct (don't touch):**
- `backend/src/modules/availability/availability.service.ts` — `getDaySlots` and `assertTimeSlotAllowed` already use Luxon + clinic TZ
- `backend/src/modules/appointments/appointments.service.ts` — `availableSlots` (already uses Luxon + clinic TZ)
- `backend/src/modules/notifications/notifications.scheduler.ts` — uses absolute `Date.now()` + offsets, TZ-independent ✓ (verified)

**Module wiring:**
- `ReportsModule` currently imports only `Appointment`, `Bill`, `Payment` Mongoose features. Needs `Clinic` added.
- `AppointmentsModule` already has `Clinic` imported (used by `availableSlots`). No change needed.

---

## File Structure

**Create:**
- `backend/src/common/clinic-time.ts` — pure `computeClinicDayRange` helper
- `backend/src/common/clinic-time.spec.ts` — unit tests for the helper

**Modify:**
- `backend/src/modules/appointments/appointments.service.ts` — use helper in `listByDate`; remove two empty `finally {}` blocks
- `backend/src/modules/reports/reports.service.ts` — inject `Clinic` model; replace `parseDateOnly` and `parseRange` with clinic-TZ-aware logic using the helper
- `backend/src/modules/reports/reports.module.ts` — register `Clinic` Mongoose feature

---

## Task 1 — `computeClinicDayRange` helper + spec

**Files:**
- Create: `backend/src/common/clinic-time.ts`
- Create: `backend/src/common/clinic-time.spec.ts`

### Step 1.1 — Write the failing spec

Create `backend/src/common/clinic-time.spec.ts`:

```ts
import { computeClinicDayRange } from './clinic-time';

describe('computeClinicDayRange', () => {
  it('computes UTC bounds for an Asia/Kolkata day', () => {
    const { startUtc, endUtc } = computeClinicDayRange('2026-05-02', 'Asia/Kolkata');
    expect(startUtc.toISOString()).toBe('2026-05-01T18:30:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-05-02T18:29:59.999Z');
  });

  it('computes UTC bounds for a UTC day', () => {
    const { startUtc, endUtc } = computeClinicDayRange('2026-05-02', 'UTC');
    expect(startUtc.toISOString()).toBe('2026-05-02T00:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-05-02T23:59:59.999Z');
  });

  it('computes UTC bounds for America/New_York (EDT -04:00 on this date)', () => {
    const { startUtc, endUtc } = computeClinicDayRange('2026-05-02', 'America/New_York');
    expect(startUtc.toISOString()).toBe('2026-05-02T04:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-05-03T03:59:59.999Z');
  });

  it('places an instant in the correct local day', () => {
    // 2026-05-01T19:30:00Z is 2026-05-02 01:00 IST — should fall in the 05-02 IST range.
    const { startUtc, endUtc } = computeClinicDayRange('2026-05-02', 'Asia/Kolkata');
    const instant = new Date('2026-05-01T19:30:00.000Z');
    expect(instant >= startUtc).toBe(true);
    expect(instant <= endUtc).toBe(true);
  });

  it('throws on malformed date', () => {
    expect(() => computeClinicDayRange('05/02/2026', 'UTC')).toThrow(/Invalid/);
    expect(() => computeClinicDayRange('2026-13-02', 'UTC')).toThrow(/Invalid/);
  });

  it('throws on unknown timezone', () => {
    expect(() => computeClinicDayRange('2026-05-02', 'Middle/Earth')).toThrow(/Invalid/);
  });
});
```

### Step 1.2 — Run the spec — expect failures

Run: `cd backend && pnpm test -- clinic-time.spec.ts`

Expected: every test fails because `backend/src/common/clinic-time.ts` does not exist yet. Module-not-found errors, not behavior mismatches. Confirm.

### Step 1.3 — Create the helper

Create `backend/src/common/clinic-time.ts`:

```ts
import { DateTime } from 'luxon';

/**
 * Compute the UTC bounds of a calendar day in the given IANA timezone.
 *
 * @param date       A YYYY-MM-DD string representing the local calendar day.
 * @param timezone   An IANA zone identifier (e.g., "Asia/Kolkata"). "UTC" is accepted.
 * @returns          { startUtc, endUtc } — the first and last instant of that
 *                   local day, as UTC `Date`s. Use with Mongo `$gte` / `$lte`.
 * @throws           Error if the date or timezone is not parseable.
 */
export function computeClinicDayRange(
  date: string,
  timezone: string,
): { startUtc: Date; endUtc: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date "${date}": expected YYYY-MM-DD`);
  }
  const day = DateTime.fromISO(date, { zone: timezone });
  if (!day.isValid) {
    throw new Error(
      `Invalid date "${date}" for timezone "${timezone}": ${day.invalidReason ?? 'unknown'}`,
    );
  }
  return {
    startUtc: day.startOf('day').toUTC().toJSDate(),
    endUtc: day.endOf('day').toUTC().toJSDate(),
  };
}
```

### Step 1.4 — Run the spec — expect pass

Run: `pnpm test -- clinic-time.spec.ts`

Expected: 6/6 pass.

### Step 1.5 — Full suite

Run: `pnpm test`

Expected: 60 green (54 prior + 6 new).

### Step 1.6 — Stage for commit (DO NOT COMMIT)

Stage:
```bash
git add backend/src/common/clinic-time.ts backend/src/common/clinic-time.spec.ts
```

Proposed commit message:
```
feat(common): add computeClinicDayRange(date, tz) helper

Pure helper that returns the UTC bounds of a local calendar day given
an IANA timezone. Centralizes the Luxon pattern that AvailabilityService
already uses inline, so AppointmentsService.listByDate and ReportsService
can switch off UTC-day bucketing in the next tasks.
```

---

## Task 2 — TZ-correct `listByDate` + remove empty `finally {}` blocks

**Files:**
- Modify: `backend/src/modules/appointments/appointments.service.ts`

### Step 2.1 — Read the current `listByDate`

Before editing, confirm the current state. The target method starts near line 236 and looks like:

```ts
async listByDate(
  clinicId: Types.ObjectId,
  branchId: string,
  date: string,
  doctorId?: string,
) {
  const bId = new Types.ObjectId(branchId);
  const dId = doctorId ? new Types.ObjectId(doctorId) : undefined;

  // TIME: match by startAt date range UTC day (placeholder); later: clinic timezone range.
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);

  return await this.apptModel
    .find({
      clinicId,
      branchId: bId,
      ...(dId ? { doctorId: dId } : {}),
      $or: [
        {
          type: AppointmentType.Time,
          startAt: { $gte: dayStart, $lte: dayEnd },
        },
        { type: AppointmentType.Queue, queueDate: date },
      ],
    })
    .sort({ startAt: 1, queueNumber: 1 });
}
```

Also confirm two empty `finally {}` blocks exist in `create()`:
- Around line 155-156 at the end of the TIME branch: `} finally {\n      }` with nothing inside.
- Around line 229-230 at the end of the QUEUE branch: same shape.

If either differs materially from this description, stop and ask before proceeding.

### Step 2.2 — Replace `listByDate` body

In `backend/src/modules/appointments/appointments.service.ts`, find the `listByDate` method and replace its body with the clinic-TZ-aware version:

```ts
async listByDate(
  clinicId: Types.ObjectId,
  branchId: string,
  date: string,
  doctorId?: string,
) {
  const bId = new Types.ObjectId(branchId);
  const dId = doctorId ? new Types.ObjectId(doctorId) : undefined;

  const clinic = await this.clinicModel.findById(clinicId);
  const tz = clinic?.timezone || 'UTC';
  const { startUtc, endUtc } = computeClinicDayRange(date, tz);

  return await this.apptModel
    .find({
      clinicId,
      branchId: bId,
      ...(dId ? { doctorId: dId } : {}),
      $or: [
        {
          type: AppointmentType.Time,
          startAt: { $gte: startUtc, $lte: endUtc },
        },
        { type: AppointmentType.Queue, queueDate: date },
      ],
    })
    .sort({ startAt: 1, queueNumber: 1 });
}
```

Note: the `QUEUE` branch still matches on the local-date string — that's correct because `queueDate` is already stored as a local YYYY-MM-DD.

### Step 2.3 — Add the helper import

At the top of `backend/src/modules/appointments/appointments.service.ts`, in the existing imports block, add:

```ts
import { computeClinicDayRange } from '../../common/clinic-time';
```

Place it grouped with other `common/` imports if any, or alphabetically near the Luxon import.

### Step 2.4 — Remove the two empty `finally {}` blocks

Find and remove the two leftover empty `finally {}` wrappers in `create()`. Each looks like:

```ts
try {
  // ... body ...
} finally {
}
```

where the `finally {}` has nothing inside. For **each occurrence**, replace the whole construct by its body, i.e. remove the `try {` opener and the `} finally {\n}` closer. Indentation of the surrounding code should be corrected accordingly.

There are exactly two such blocks (one in the TIME branch around lines 155-156, one in the QUEUE branch around lines 229-230). Do **not** touch the inner `try { ... } catch { ... } finally { await session.endSession(); }` blocks — those are load-bearing and must stay intact.

### Step 2.5 — Verify build

Run: `pnpm build`

Expected: exit 0. If TS complains about unreachable code or unterminated try blocks, your de-indent missed a bracket — re-check.

### Step 2.6 — Full suite

Run: `pnpm test`

Expected: 60 green. No new spec added in this task, but the change must not regress any existing test.

### Step 2.7 — Stage for commit

Stage:
```bash
git add backend/src/modules/appointments/appointments.service.ts
```

Proposed commit message:
```
fix(appointments): compute listByDate range in clinic timezone

listByDate previously bucketed TIME appointments by UTC day, so an
appointment at 19:30Z (which is next-day 01:00 IST) showed up in the
wrong local day for Asia/Kolkata clinics. Now uses the clinic's stored
timezone via computeClinicDayRange(). QUEUE matching is unchanged —
queueDate is already a local YYYY-MM-DD string.

Also drops two leftover empty `finally {}` wrappers left from an earlier
refactor; inner session.endSession() finally blocks are preserved.
```

---

## Task 3 — TZ-correct reports

**Files:**
- Modify: `backend/src/modules/reports/reports.service.ts`
- Modify: `backend/src/modules/reports/reports.module.ts`

### Step 3.1 — Register `Clinic` in `ReportsModule`

Replace the full contents of `backend/src/modules/reports/reports.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/schemas/appointment.schema';
import { Bill, BillSchema } from '../billing/schemas/bill.schema';
import { Payment, PaymentSchema } from '../billing/schemas/payment.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Bill.name, schema: BillSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Clinic.name, schema: ClinicSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
```

### Step 3.2 — Rewrite `reports.service.ts`

Replace the full contents of `backend/src/modules/reports/reports.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Appointment } from '../appointments/schemas/appointment.schema';
import { Bill, BillStatus } from '../billing/schemas/bill.schema';
import { Payment } from '../billing/schemas/payment.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { computeClinicDayRange } from '../../common/clinic-time';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly apptModel: Model<Appointment>,
    @InjectModel(Bill.name) private readonly billModel: Model<Bill>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
  ) {}

  private async resolveTimezone(clinicId: Types.ObjectId): Promise<string> {
    const clinic = await this.clinicModel.findById(clinicId);
    return clinic?.timezone || 'UTC';
  }

  private async resolveDay(
    clinicId: Types.ObjectId,
    date: string,
  ): Promise<{ dayStart: Date; dayEnd: Date; tz: string }> {
    const tz = await this.resolveTimezone(clinicId);
    try {
      const { startUtc, endUtc } = computeClinicDayRange(date, tz);
      return { dayStart: startUtc, dayEnd: endUtc, tz };
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Invalid date',
      );
    }
  }

  private async resolveRange(
    clinicId: Types.ObjectId,
    from?: string,
    to?: string,
  ): Promise<{ start: Date; end: Date; tz: string }> {
    if (!from || !to) {
      throw new BadRequestException('from and to are required (YYYY-MM-DD)');
    }
    const tz = await this.resolveTimezone(clinicId);
    let startRange: { startUtc: Date };
    let endRange: { endUtc: Date };
    try {
      startRange = computeClinicDayRange(from, tz);
      endRange = computeClinicDayRange(to, tz);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Invalid date range',
      );
    }
    if (endRange.endUtc < startRange.startUtc) {
      throw new BadRequestException('to must be >= from');
    }
    return { start: startRange.startUtc, end: endRange.endUtc, tz };
  }

  async revenueSummary(
    clinicId: Types.ObjectId,
    from?: string,
    to?: string,
    branchId?: string,
  ) {
    const { start, end, tz } = await this.resolveRange(clinicId, from, to);
    const branchFilter = branchId
      ? { branchId: new Types.ObjectId(branchId) }
      : {};

    const issuedBills = await this.billModel.aggregate([
      {
        $match: {
          clinicId,
          ...branchFilter,
          status: BillStatus.Issued,
          issuedAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalBilled: { $sum: '$total' },
        },
      },
    ]);

    const payments = await this.paymentModel.aggregate([
      {
        $match: {
          clinicId,
          ...(branchId ? { branchId: new Types.ObjectId(branchId) } : {}),
          paidAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalPaid: { $sum: '$amount' },
        },
      },
    ]);

    const billed = issuedBills[0] ?? { count: 0, totalBilled: 0 };
    const paid = payments[0] ?? { count: 0, totalPaid: 0 };

    return {
      from,
      to,
      timezone: tz,
      branchId: branchId ?? null,
      issuedBills: {
        count: billed.count,
        totalBilled: billed.totalBilled ?? 0,
      },
      payments: { count: paid.count, totalPaid: paid.totalPaid ?? 0 },
    };
  }

  async dailySchedule(
    clinicId: Types.ObjectId,
    date: string,
    branchId: string,
  ) {
    const { dayStart, dayEnd, tz } = await this.resolveDay(clinicId, date);
    const bId = new Types.ObjectId(branchId);

    const items = await this.apptModel
      .find({
        clinicId,
        branchId: bId,
        $or: [
          { type: 'TIME', startAt: { $gte: dayStart, $lte: dayEnd } },
          { type: 'QUEUE', queueDate: date },
        ],
      })
      .sort({ doctorId: 1, startAt: 1, queueNumber: 1 });

    const byDoctor: Record<
      string,
      {
        total: number;
        byStatus: Record<string, number>;
        byType: Record<string, number>;
      }
    > = {};

    for (const a of items) {
      const d = a.doctorId.toHexString();
      if (!byDoctor[d]) byDoctor[d] = { total: 0, byStatus: {}, byType: {} };
      byDoctor[d].total += 1;
      byDoctor[d].byStatus[a.status] =
        (byDoctor[d].byStatus[a.status] ?? 0) + 1;
      byDoctor[d].byType[a.type] = (byDoctor[d].byType[a.type] ?? 0) + 1;
    }

    return { date, timezone: tz, branchId, total: items.length, byDoctor, items };
  }

  async pendingPayments(
    clinicId: Types.ObjectId,
    branchId?: string,
    limit = 50,
  ) {
    const bFilter = branchId ? { branchId: new Types.ObjectId(branchId) } : {};

    const rows = await this.billModel.aggregate([
      {
        $match: {
          clinicId,
          ...bFilter,
          status: BillStatus.Issued,
        },
      },
      {
        $lookup: {
          from: 'payments',
          localField: '_id',
          foreignField: 'billId',
          as: 'payments',
        },
      },
      {
        $addFields: {
          totalPaid: { $sum: '$payments.amount' },
        },
      },
      {
        $addFields: {
          outstanding: { $max: [0, { $subtract: ['$total', '$totalPaid'] }] },
        },
      },
      { $match: { outstanding: { $gt: 0 } } },
      { $sort: { outstanding: -1, issuedAt: -1 } },
      { $limit: Math.max(1, Math.min(200, limit)) },
      {
        $project: {
          payments: 0,
        },
      },
    ]);

    return { branchId: branchId ?? null, count: rows.length, rows };
  }
}
```

Key changes vs the previous file:
- Drops the module-level `parseDateOnly` and `parseRange` helpers (they were UTC-bound).
- Injects `Clinic` model.
- New private `resolveTimezone`, `resolveDay`, `resolveRange` helpers use `computeClinicDayRange`.
- `revenueSummary` and `dailySchedule` return `timezone` alongside the rest, so API callers know what TZ the bounds were computed in.
- `pendingPayments` stays as-is (no date-range filter, so no TZ concern).

### Step 3.3 — Full suite

Run: `pnpm test`

Expected: 60 green (no new tests in this task; no regressions from prior tasks).

### Step 3.4 — Build

Run: `pnpm build`

Expected: exit 0. If TS complains about `Clinic` not being registered, you forgot Step 3.1.

### Step 3.5 — Stage for commit

Stage:
```bash
git add backend/src/modules/reports/
```

Proposed commit message:
```
fix(reports): compute revenue/schedule ranges in clinic timezone

ReportsService used UTC day boundaries for `from`/`to`/`date` query
parameters, attributing records to the wrong local day for non-UTC
clinics (e.g., a payment at 20:00Z on May 1 was counted on May 1 but
a front-desk user in Asia/Kolkata would see it as May 2 at 01:30).
Now injects the Clinic model, reads `clinic.timezone`, and passes both
bounds through computeClinicDayRange. Responses include the resolved
timezone so callers see what frame was applied.
```

---

## Task 4 — Final verification

**Files:** none modified (verification only).

### Step 4.1 — Full suite

Run: `cd backend && pnpm test`

Expected: 60 green across 12 suites.

### Step 4.2 — Build

Run: `pnpm build` → exit 0.

### Step 4.3 — Manual smoke (optional)

If Mongo is running and the backend boots locally (port 4000 free), start it and hit:

```bash
H='-H Content-Type:application/json -H x-clinic-id:507f1f77bcf86cd799439011 -H x-user-id:507f1f77bcf86cd799439011'

# daily schedule now returns a timezone field
curl -s "http://localhost:4000/reports/schedule/daily?date=2026-05-02&branchId=507f1f77bcf86cd799439011" $H | head

# revenue summary now returns a timezone field
curl -s "http://localhost:4000/reports/revenue?from=2026-05-01&to=2026-05-02&branchId=507f1f77bcf86cd799439011" $H | head
```

Expected: both responses include a `"timezone": "..."` field reflecting the clinic's stored timezone. If the server is not reachable (port conflict, no Mongo, auth 401), skip this step and note why.

### Step 4.4 — Workstream exit-bar checklist

Confirm each roadmap §Phase 0.3 criterion with concrete evidence (file:line or test name):

- [ ] `computeClinicDayRange('2026-05-02', 'Asia/Kolkata')` → expected UTC bounds (cite `clinic-time.spec.ts` test name).
- [ ] `AppointmentsService.listByDate` uses clinic timezone (cite file:line of `computeClinicDayRange` call).
- [ ] `ReportsService` uses clinic timezone for `revenueSummary` and `dailySchedule` (cite the two call sites).
- [ ] Empty `finally {}` blocks removed from `appointments.service.ts` (grep: `grep -n 'finally {$' backend/src/modules/appointments/appointments.service.ts` should only return lines where a body follows).

### Step 4.5 — No stage, no commit for this task

Task 4 is verification-only. Report back with the checklist above.

## Report

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Test / build output
- Manual smoke (or reason skipped)
- Exit-bar checklist with ✅/❌
- Anything surprising

---

## Notes for the executing engineer

- **Do not refactor** `AvailabilityService.getDaySlots` or `AppointmentsService.availableSlots` to use the new helper, even though they could. They already work correctly; changing them is out of scope and dilutes this workstream's diff.
- **Do not touch** `NotificationsScheduler`. It operates on absolute instants (`Date.now()` + offsets) and is TZ-independent. This has been verified.
- `computeClinicDayRange` must be pure (no Mongoose, no `process.env`). That's what makes it unit-testable without any test infrastructure setup.
- When `clinic?.timezone` is missing (fresh test clinic, bad seed), fall back to `'UTC'` — don't throw. Services should degrade gracefully if a clinic document lacks a timezone.
- The `timezone` field now in report responses is additive — no breaking change for callers who ignore it.
