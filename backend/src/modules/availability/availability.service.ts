import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model, Types } from 'mongoose';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { mergeClinicSettings } from '../tenancy/clinic-settings.types';
import { AppointmentsService } from '../appointments/appointments.service';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permissions';
import { DoctorAvailabilityRule } from './schemas/doctor-availability-rule.schema';
import {
  DoctorAvailabilityOverride,
  OverrideType,
} from './schemas/doctor-availability-override.schema';

function normalizeWindows(
  windows: { startMinutes: number; endMinutes: number }[],
) {
  for (const w of windows) {
    if (!Number.isFinite(w.startMinutes) || !Number.isFinite(w.endMinutes)) {
      throw new BadRequestException('Invalid availability window');
    }
    if (
      w.startMinutes < 0 ||
      w.endMinutes > 24 * 60 ||
      w.endMinutes <= w.startMinutes
    ) {
      throw new BadRequestException('Invalid availability window range');
    }
  }
  return windows.slice().sort((a, b) => a.startMinutes - b.startMinutes);
}

@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(
    @InjectModel(DoctorAvailabilityRule.name)
    private readonly ruleModel: Model<DoctorAvailabilityRule>,
    @InjectModel(DoctorAvailabilityOverride.name)
    private readonly overrideModel: Model<DoctorAvailabilityOverride>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    private readonly authz: AuthzService,
    // forwardRef matches the circular dependency declared at the module
    // level. AppointmentsService is injected at runtime, not at class
    // construction, so Nest resolves both halves of the cycle cleanly.
    @Inject(forwardRef(() => AppointmentsService))
    private readonly appointments: AppointmentsService,
  ) {}

  /**
   * Allow if the actor is editing their OWN availability, or if the actor has
   * `clinic:write` (admin path). Otherwise 403.
   */
  private async assertCanWriteForDoctor(input: {
    clinicId: Types.ObjectId;
    actorUserId?: Types.ObjectId;
    doctorUserId: Types.ObjectId;
  }) {
    if (!input.actorUserId) {
      throw new ForbiddenException('Missing actor identity');
    }
    if (input.actorUserId.equals(input.doctorUserId)) {
      return; // owner — always allowed to edit themselves
    }
    const actor = await this.authz.getActor({
      clinicId: input.clinicId,
      actorUserId: input.actorUserId,
    });
    if (!actor.permissions.includes(Permission.ClinicWrite)) {
      throw new ForbiddenException(
        "You can only edit your own availability",
      );
    }
  }

  async replaceWeeklyRules(input: {
    clinicId: Types.ObjectId;
    actorUserId?: Types.ObjectId;
    branchId: Types.ObjectId;
    doctorUserId: Types.ObjectId;
    rules: {
      weekday: number;
      windows: { startMinutes: number; endMinutes: number }[];
      slotMinutes?: number;
      active?: boolean;
    }[];
  }) {
    await this.assertCanWriteForDoctor({
      clinicId: input.clinicId,
      actorUserId: input.actorUserId,
      doctorUserId: input.doctorUserId,
    });

    const weekdays = new Set(input.rules.map((r) => r.weekday));
    if (weekdays.size !== input.rules.length)
      throw new BadRequestException('Duplicate weekday rules');

    const ops = input.rules.map((r) => ({
      updateOne: {
        filter: {
          clinicId: input.clinicId,
          branchId: input.branchId,
          doctorUserId: input.doctorUserId,
          weekday: r.weekday,
        },
        update: {
          $set: {
            clinicId: input.clinicId,
            branchId: input.branchId,
            doctorUserId: input.doctorUserId,
            weekday: r.weekday,
            windows: normalizeWindows(r.windows),
            slotMinutes: r.slotMinutes,
            active: r.active ?? true,
          },
        },
        upsert: true,
      },
    }));

    await this.ruleModel.bulkWrite(ops, { ordered: true });
    return await this.ruleModel
      .find({
        clinicId: input.clinicId,
        branchId: input.branchId,
        doctorUserId: input.doctorUserId,
      })
      .sort({ weekday: 1 });
  }

  async listRules(input: {
    clinicId: Types.ObjectId;
    branchId: Types.ObjectId;
    doctorUserId: Types.ObjectId;
  }) {
    return await this.ruleModel
      .find({
        clinicId: input.clinicId,
        branchId: input.branchId,
        doctorUserId: input.doctorUserId,
      })
      .sort({ weekday: 1 });
  }

  async listOverrides(input: {
    clinicId: Types.ObjectId;
    branchId: Types.ObjectId;
    doctorUserId: Types.ObjectId;
    from?: string;
    to?: string;
  }) {
    const filter: Record<string, unknown> = {
      clinicId: input.clinicId,
      branchId: input.branchId,
      doctorUserId: input.doctorUserId,
    };
    if (input.from || input.to) {
      const range: Record<string, string> = {};
      if (input.from) range.$gte = input.from;
      if (input.to) range.$lte = input.to;
      filter.date = range;
    }
    return await this.overrideModel.find(filter).sort({ date: 1 });
  }

  async upsertOverride(input: {
    clinicId: Types.ObjectId;
    actorUserId?: Types.ObjectId;
    branchId: Types.ObjectId;
    doctorUserId: Types.ObjectId;
    date: string;
    type: OverrideType;
    windows?: { startMinutes: number; endMinutes: number }[];
    note?: string;
  }) {
    await this.assertCanWriteForDoctor({
      clinicId: input.clinicId,
      actorUserId: input.actorUserId,
      doctorUserId: input.doctorUserId,
    });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date))
      throw new BadRequestException('date must be YYYY-MM-DD');
    const windows =
      input.type === 'CUSTOM_WINDOWS' ||
      input.type === 'ADDITIONAL_WINDOWS' ||
      input.type === 'BLOCKED_WINDOWS'
        ? normalizeWindows(input.windows ?? [])
        : [];

    const doc = await this.overrideModel.findOneAndUpdate(
      {
        clinicId: input.clinicId,
        branchId: input.branchId,
        doctorUserId: input.doctorUserId,
        date: input.date,
      },
      { $set: { type: input.type, windows, note: input.note } },
      { upsert: true, new: true },
    );

    // Emergency-unavailable cascade. After ANY override save we ask the
    // appointments service to re-validate each booked TIME appointment
    // on `date` against the fresh rules + override state and move any
    // that no longer fit (closed day, narrowed windows, etc.) to the
    // doctor's next free slot — with WhatsApp + email notifications.
    // Previously gated on type === 'CLOSED' only; that missed
    // CUSTOM_WINDOWS overrides that punch a hole in the day and left
    // mid-day "emergency" overrides cascading nothing.
    //
    // Wrapped in try/catch so a reschedule failure can never roll back
    // the override itself — the doctor still needs to be marked
    // unavailable even if a single notification fails. The result is
    // returned to the caller as `_rescheduled` so the FE can render a
    // confirmation summary.
    let cascade:
      | Awaited<ReturnType<AppointmentsService['rescheduleConflictsForDay']>>
      | undefined;
    this.logger.log(
      `[override] Saved ${input.type} for doctor=${input.doctorUserId.toHexString()} date=${input.date} — running cascade`,
    );
    try {
      cascade = await this.appointments.rescheduleConflictsForDay({
        clinicId: input.clinicId,
        branchId: input.branchId,
        doctorUserId: input.doctorUserId,
        affectedDate: input.date,
      });
    } catch (e) {
      this.logger.warn(
        `[override] Cascade failed for ${input.date}: ${e instanceof Error ? e.message : e}`,
      );
    }

    return Object.assign(doc.toObject(), cascade ? { _rescheduled: cascade } : {});
  }

  /**
   * Remove an override for a single date. The day reverts to the doctor's
   * weekly rules. Returns `{ ok: true, deleted: true | false }` so the FE
   * knows whether the row existed; missing-row delete is intentionally
   * non-fatal so a stale list refresh doesn't 404.
   *
   * Important: previously-cascaded reschedules are not undone. A CLOSED
   * override might have moved a patient to next Tuesday; removing the
   * override here doesn't yank them back to the original date. The
   * notification already went out — reversing it silently would surprise
   * the patient.
   */
  async deleteOverride(input: {
    clinicId: Types.ObjectId;
    actorUserId?: Types.ObjectId;
    branchId: Types.ObjectId;
    doctorUserId: Types.ObjectId;
    date: string;
  }) {
    await this.assertCanWriteForDoctor({
      clinicId: input.clinicId,
      actorUserId: input.actorUserId,
      doctorUserId: input.doctorUserId,
    });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const res = await this.overrideModel.deleteOne({
      clinicId: input.clinicId,
      branchId: input.branchId,
      doctorUserId: input.doctorUserId,
      date: input.date,
    });
    return { ok: true, deleted: res.deletedCount > 0 };
  }

  async getDaySlots(input: {
    clinicId: Types.ObjectId;
    branchId: Types.ObjectId;
    doctorUserId: Types.ObjectId;
    date: string;
    duration?: number;
  }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date))
      throw new BadRequestException('date must be YYYY-MM-DD');

    const clinic = await this.clinicModel.findById(input.clinicId);
    if (!clinic) throw new NotFoundException('Clinic not found');
    const tz = clinic.timezone || 'UTC';
    const settings = mergeClinicSettings(clinic.settings);
    const defaultSlotMinutes = settings.appointments.slotMinutesDefault;

    const day = DateTime.fromISO(input.date, { zone: tz });
    if (!day.isValid) throw new BadRequestException('Invalid date');

    const override = await this.overrideModel.findOne({
      clinicId: input.clinicId,
      branchId: input.branchId,
      doctorUserId: input.doctorUserId,
      date: input.date,
    });

    if (override?.type === 'CLOSED') {
      return {
        timezone: tz,
        date: input.date,
        slotMinutes: defaultSlotMinutes,
        slots: [] as { startAt: string; endAt: string }[],
        windows: [] as { startAt: string; endAt: string }[],
      };
    }

    const luxonWeekday = day.weekday; // 1..7
    const weekday = luxonWeekday % 7; // 0..6 where 0=Sun

    const rule = await this.ruleModel.findOne({
      clinicId: input.clinicId,
      branchId: input.branchId,
      doctorUserId: input.doctorUserId,
      weekday,
      active: true,
    });

    const slotMinutes = rule?.slotMinutes ?? defaultSlotMinutes;
    const baseWindows = rule?.windows ?? [];
    // `windows` drives slot-grid generation. `blockedWindows` filters
    // individual slots out *after* the grid is generated — this preserves
    // the doctor's normal :00 / :15 / :30 / :45 alignment when a small
    // range is blocked. (If we subtracted the block from the window edge
    // first, slot iteration would restart from the post-block edge and
    // every subsequent slot would drift by the block size — see the bug
    // report screenshots: a 5-min block at 15:59 shifted 16:15 onward to
    // 16:04 / 16:19 / 16:34, hiding every aligned slot.)
    let windows: { startMinutes: number; endMinutes: number }[];
    let blockedWindows: { startMinutes: number; endMinutes: number }[] = [];
    if (override?.type === 'CUSTOM_WINDOWS') {
      windows = override.windows ?? [];
    } else if (override?.type === 'ADDITIONAL_WINDOWS') {
      // Union the override's extra windows on top of the weekly rule.
      // Keep them sorted; if any overlap, normalizeWindows would catch it on
      // write — at read time we just merge and let downstream slot iteration
      // produce overlapping slots if they exist (caller bears the ambiguity).
      windows = [...baseWindows, ...(override.windows ?? [])].slice().sort(
        (a, b) => a.startMinutes - b.startMinutes,
      );
    } else if (override?.type === 'BLOCKED_WINDOWS') {
      // Use the base windows for slot generation (keeps the slot grid
      // aligned to the doctor's normal schedule), and remember the
      // blocked ranges so we drop overlapping slots below.
      windows = baseWindows;
      blockedWindows = override.windows ?? [];
    } else {
      windows = baseWindows;
    }

    const slotDuration = input.duration ?? slotMinutes;
    const slots: { startAt: string; endAt: string }[] = [];
    // windowsUtc is what assertTimeSlotAllowed uses for its
    // "appointment fits inside a window" check. For BLOCKED_WINDOWS we
    // return the subtracted windows here so a free-form duration that
    // spans the block fails the window check; the slot-existence check
    // already catches the aligned case.
    const reportedWindows =
      override?.type === 'BLOCKED_WINDOWS'
        ? subtractWindows(baseWindows, blockedWindows)
        : windows;
    const windowsUtc: { startAt: string; endAt: string }[] = reportedWindows.map(
      (w) => ({
        startAt: day.startOf('day').plus({ minutes: w.startMinutes }).toUTC().toISO()!,
        endAt: day.startOf('day').plus({ minutes: w.endMinutes }).toUTC().toISO()!,
      }),
    );
    for (const w of windows) {
      for (
        let m = w.startMinutes;
        m + slotDuration <= w.endMinutes;
        m += slotMinutes
      ) {
        // Drop any slot that intersects a blocked range. Back-to-back
        // edges (slot ends exactly when block starts, or starts exactly
        // when block ends) are treated as non-overlapping so the
        // adjacent slots survive.
        if (blockedWindows.length) {
          const slotEnd = m + slotDuration;
          const overlapsBlock = blockedWindows.some(
            (b) => m < b.endMinutes && slotEnd > b.startMinutes,
          );
          if (overlapsBlock) continue;
        }
        const start = day.startOf('day').plus({ minutes: m });
        const end = start.plus({ minutes: slotDuration });
        slots.push({
          startAt: start.toUTC().toISO()!,
          endAt: end.toUTC().toISO()!,
        });
      }
    }

    return { timezone: tz, date: input.date, slotMinutes, slots, windows: windowsUtc };
  }

  async assertTimeSlotAllowed(input: {
    clinicId: Types.ObjectId;
    branchId: Types.ObjectId;
    doctorUserId: Types.ObjectId;
    startAt: Date;
    endAt: Date;
  }) {
    // Convert UTC instant -> clinic local date
    const clinic = await this.clinicModel.findById(input.clinicId);
    if (!clinic) throw new NotFoundException('Clinic not found');
    const tz = clinic.timezone || 'UTC';
    const start = DateTime.fromJSDate(input.startAt, { zone: 'utc' }).setZone(
      tz,
    );
    const end = DateTime.fromJSDate(input.endAt, { zone: 'utc' }).setZone(tz);
    if (!start.isValid || !end.isValid)
      throw new BadRequestException('Invalid start/end');
    if (!start.hasSame(end, 'day'))
      throw new BadRequestException('Appointment must be within one local day');

    const date = start.toISODate();
    const daySlots = await this.getDaySlots({
      clinicId: input.clinicId,
      branchId: input.branchId,
      doctorUserId: input.doctorUserId,
      date,
    });

    const wantedStartUtc = DateTime.fromJSDate(input.startAt, {
      zone: 'utc',
    }).toISO();
    const wantedEndUtc = DateTime.fromJSDate(input.endAt, {
      zone: 'utc',
    }).toISO();

    // Booking is valid when:
    // 1) start aligns with a slot boundary (preserves the slot grid), and
    // 2) [start, end] fits inside one of the doctor's availability windows.
    // This lets the duration vary (e.g. 15-min consult on a 60-min slot).
    const startsAtSlot = daySlots.slots.some((s) => s.startAt === wantedStartUtc);
    if (!startsAtSlot) {
      throw new BadRequestException(
        'Doctor not available at the requested start time',
      );
    }
    const fitsWindow = daySlots.windows.some(
      (w) =>
        wantedStartUtc !== null &&
        wantedEndUtc !== null &&
        w.startAt <= wantedStartUtc &&
        wantedEndUtc <= w.endAt,
    );
    if (!fitsWindow) {
      throw new BadRequestException(
        'Appointment exceeds doctor available hours',
      );
    }
  }
}

/**
 * Window-subtraction for BLOCKED_WINDOWS overrides. Treats each base
 * window as a closed interval and removes any overlap with a blocked
 * range. A blocked range that straddles two base windows correctly
 * trims both; one that's entirely outside has no effect. The output is
 * sorted by start time and contains no zero-or-negative-length pieces.
 *
 * Example:
 *   base    = [09:00–18:00]      (540–1080)
 *   blocked = [15:15–15:30]      (915–930)
 *   result  = [09:00–15:15, 15:30–18:00]
 *
 * Used by getDaySlots when an override has type=BLOCKED_WINDOWS.
 */
function subtractWindows(
  base: { startMinutes: number; endMinutes: number }[],
  blocked: { startMinutes: number; endMinutes: number }[],
): { startMinutes: number; endMinutes: number }[] {
  let result = [...base];
  for (const k of blocked) {
    const next: { startMinutes: number; endMinutes: number }[] = [];
    for (const b of result) {
      // No overlap — keep the base window as-is.
      if (k.endMinutes <= b.startMinutes || k.startMinutes >= b.endMinutes) {
        next.push(b);
        continue;
      }
      // Left segment survives if the block starts after the window begins.
      if (b.startMinutes < k.startMinutes) {
        next.push({ startMinutes: b.startMinutes, endMinutes: k.startMinutes });
      }
      // Right segment survives if the block ends before the window does.
      if (k.endMinutes < b.endMinutes) {
        next.push({ startMinutes: k.endMinutes, endMinutes: b.endMinutes });
      }
    }
    result = next;
  }
  return result.sort((a, b) => a.startMinutes - b.startMinutes);
}
