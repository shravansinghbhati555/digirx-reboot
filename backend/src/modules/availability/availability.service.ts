import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model, Types } from 'mongoose';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { mergeClinicSettings } from '../tenancy/clinic-settings.types';
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
  constructor(
    @InjectModel(DoctorAvailabilityRule.name)
    private readonly ruleModel: Model<DoctorAvailabilityRule>,
    @InjectModel(DoctorAvailabilityOverride.name)
    private readonly overrideModel: Model<DoctorAvailabilityOverride>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    private readonly authz: AuthzService,
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
      input.type === 'CUSTOM_WINDOWS' || input.type === 'ADDITIONAL_WINDOWS'
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
    return doc;
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
    let windows: { startMinutes: number; endMinutes: number }[];
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
    } else {
      windows = baseWindows;
    }

    const slotDuration = input.duration ?? slotMinutes;
    const slots: { startAt: string; endAt: string }[] = [];
    const windowsUtc: { startAt: string; endAt: string }[] = [];
    for (const w of windows) {
      windowsUtc.push({
        startAt: day.startOf('day').plus({ minutes: w.startMinutes }).toUTC().toISO()!,
        endAt: day.startOf('day').plus({ minutes: w.endMinutes }).toUTC().toISO()!,
      });
      for (
        let m = w.startMinutes;
        m + slotDuration <= w.endMinutes;
        m += slotMinutes
      ) {
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
