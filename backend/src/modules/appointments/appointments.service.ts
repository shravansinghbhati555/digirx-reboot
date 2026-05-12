import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import {
  Appointment,
  AppointmentSource,
  AppointmentStatus,
  AppointmentType,
} from './schemas/appointment.schema';
import { QueueCounter } from './schemas/queue-counter.schema';
import { AvailabilityService } from '../availability/availability.service';
import { DateTime } from 'luxon';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { User } from '../authz/schemas/user.schema';
import { Patient } from '../patients/schemas/patient.schema';
import { computeClinicDayRange } from '../../common/clinic-time';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationChannel } from '../notifications/schemas/notification-template.schema';

// Statuses that hold a TIME slot and therefore block another appointment
// from being created over the same window. CANCELLED and NO_SHOW are
// excluded — those states free the slot up.
//
// DONE is included on purpose: even though the visit is over, the slot
// it occupied is consumed and another patient cannot retroactively be
// booked into it. Excluding DONE was the original bug that let the seed
// (and any direct DB writes) create same-time pairs at past times.
const ACTIVE_TIME_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.Booked,
  AppointmentStatus.CheckedIn,
  AppointmentStatus.InProgress,
  AppointmentStatus.Done,
];

export type EnrichedSlot =
  | { startAt: string; endAt: string; status: 'available' }
  | { startAt: string; endAt: string; status: 'past' }
  | {
      startAt: string;
      endAt: string;
      status: 'booked';
      bookedBy: { apptId: string; patientName: string | null; status: string };
    };

const CANCELLABLE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.Booked,
  AppointmentStatus.CheckedIn,
  AppointmentStatus.InProgress,
];

const ALLOWED_STATUS_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  [AppointmentStatus.Booked]: [
    AppointmentStatus.CheckedIn,
    AppointmentStatus.Cancelled,
    AppointmentStatus.NoShow,
  ],
  [AppointmentStatus.CheckedIn]: [
    AppointmentStatus.InProgress,
    AppointmentStatus.Cancelled,
    AppointmentStatus.NoShow,
  ],
  [AppointmentStatus.InProgress]: [
    AppointmentStatus.Done,
    AppointmentStatus.Cancelled,
  ],
  [AppointmentStatus.Done]: [],
  [AppointmentStatus.Cancelled]: [],
  [AppointmentStatus.NoShow]: [],
};

function assertAllowedTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
) {
  if (from === to) return;
  const allowed = ALLOWED_STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new BadRequestException(
      `Cannot transition appointment from ${from} to ${to}`,
    );
  }
}

function assertCanCheckIn(appt: Appointment, clinic: Clinic) {
  const tz = clinic.timezone || 'UTC';
  const today = DateTime.now().setZone(tz).toISODate();
  if (!today) throw new BadRequestException('Invalid clinic timezone');

  let apptDate: string | null = null;
  if (appt.type === AppointmentType.Queue) {
    apptDate = appt.queueDate ?? null;
  } else if (appt.type === AppointmentType.Time && appt.startAt) {
    apptDate = DateTime.fromJSDate(appt.startAt).setZone(tz).toISODate();
  }
  if (!apptDate) {
    throw new BadRequestException('Appointment has no scheduled date');
  }

  if (apptDate > today) {
    throw new BadRequestException(
      `Cannot check in before the appointment date (${apptDate})`,
    );
  }
  if (apptDate < today) {
    throw new BadRequestException(
      `Cannot check in after the appointment date (${apptDate}); mark as no-show instead`,
    );
  }
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    @InjectModel(Appointment.name)
    private readonly apptModel: Model<Appointment>,
    @InjectModel(QueueCounter.name)
    private readonly counterModel: Model<QueueCounter>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
    @InjectConnection() private readonly connection: Connection,
    private readonly availability: AvailabilityService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    dto: CreateAppointmentDto,
  ) {
    const branchId = new Types.ObjectId(dto.branchId);
    const doctorId = new Types.ObjectId(dto.doctorId);
    const patientId = new Types.ObjectId(dto.patientId);
    const source = dto.source ?? AppointmentSource.FrontDesk;

    // Membership asserts run before any availability/queue work — they're
    // cheap two-field lookups and fail fast on misuse.
    await this.assertDoctorAtBranch(clinicId, doctorId, branchId);
    await this.assertPatientInClinic(clinicId, patientId);

    if (dto.type === AppointmentType.Time) {
      if (!dto.startAt || !dto.endAt)
        throw new BadRequestException(
          'startAt and endAt are required for TIME',
        );
      const startAt = new Date(dto.startAt);
      const endAt = new Date(dto.endAt);
      if (!(startAt instanceof Date) || isNaN(startAt.getTime()))
        throw new BadRequestException('Invalid startAt');
      if (!(endAt instanceof Date) || isNaN(endAt.getTime()))
        throw new BadRequestException('Invalid endAt');
      if (endAt <= startAt)
        throw new BadRequestException('endAt must be after startAt');
      // No backdating. The booking calendar already disables past slots
      // in the UI; this guard is the server-side fence so a stale modal
      // (open across midnight, or a malicious client) can't slip an
      // appointment into yesterday.
      if (startAt.getTime() < Date.now()) {
        throw new BadRequestException(
          'Cannot book an appointment in the past',
        );
      }

      // Enforce doctor availability (branch + clinic timezone)
      await this.availability.assertTimeSlotAllowed({
        clinicId,
        branchId,
        doctorUserId: doctorId,
        startAt,
        endAt,
      });

      // Conflict prevention for MongoDB: transactional overlap check.
      // Transactions require MongoDB replica set. If unavailable, fallback to non-transactional check.
      const session = await this.connection
        .startSession()
        .catch(() => null as any);
      if (session) {
        try {
          let created: Appointment | null = null;
          await session.withTransaction(async () => {
            const overlap = await this.apptModel
              .findOne({
                clinicId,
                branchId,
                doctorId,
                type: AppointmentType.Time,
                status: { $in: ACTIVE_TIME_STATUSES },
                startAt: { $lt: endAt },
                endAt: { $gt: startAt },
              })
              .session(session);

            if (overlap) {
              throw await this.buildOverlapConflict({
                clinicId,
                branchId,
                doctorId,
                requestedStartAt: startAt,
              });
            }

            created = await this.apptModel
              .create(
                [
                  {
                    clinicId,
                    branchId,
                    doctorId,
                    patientId,
                    type: AppointmentType.Time,
                    startAt,
                    endAt,
                    status: AppointmentStatus.Booked,
                    source,
                    notes: dto.notes,
                    createdBy: actorUserId,
                  },
                ],
                { session },
              )
              .then((docs) => docs[0]);
          });
          if (!created) throw new Error('Appointment not created');
          return created;
        } catch (e: any) {
          // fall back when transactions are not supported
          const msg = String(e?.message ?? '');
          if (!msg.includes('Transaction numbers are only allowed')) throw e;
        } finally {
          await session.endSession();
        }
      }

      const overlap = await this.apptModel.findOne({
        clinicId,
        branchId,
        doctorId,
        type: AppointmentType.Time,
        status: { $in: ACTIVE_TIME_STATUSES },
        startAt: { $lt: endAt },
        endAt: { $gt: startAt },
      });
      if (overlap) {
        throw await this.buildOverlapConflict({
          clinicId,
          branchId,
          doctorId,
          requestedStartAt: startAt,
        });
      }

      return await this.apptModel.create({
        clinicId,
        branchId,
        doctorId,
        patientId,
        type: AppointmentType.Time,
        startAt,
        endAt,
        status: AppointmentStatus.Booked,
        source,
        notes: dto.notes,
        createdBy: actorUserId,
      });
    }

    if (dto.type === AppointmentType.Queue) {
      const queueDate = (dto.queueDate ?? '').trim();
      if (!queueDate)
        throw new BadRequestException('queueDate is required for QUEUE');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(queueDate))
        throw new BadRequestException('queueDate must be YYYY-MM-DD');

      // Reject dates that aren't valid in the clinic's timezone, are in the past,
      // or are absurdly far in the future. We trust the client to derive the
      // local date but defend against typos and tampered payloads.
      const clinic = await this.clinicModel.findById(clinicId);
      if (!clinic) throw new NotFoundException('Clinic not found');
      const tz = clinic.timezone || 'UTC';
      const requested = DateTime.fromISO(queueDate, { zone: tz });
      if (!requested.isValid) {
        throw new BadRequestException(
          `Invalid queueDate "${queueDate}" for clinic timezone`,
        );
      }
      const today = DateTime.now().setZone(tz).startOf('day');
      const requestedStart = requested.startOf('day');
      if (requestedStart < today) {
        throw new BadRequestException('queueDate cannot be in the past');
      }
      if (requestedStart.diff(today, 'days').days > 365) {
        throw new BadRequestException('queueDate is too far in the future');
      }

      const session = await this.connection
        .startSession()
        .catch(() => null as any);
      if (session) {
        try {
          let created: Appointment | null = null;
          await session.withTransaction(async () => {
            const counter = await this.counterModel.findOneAndUpdate(
              { clinicId, branchId, doctorId, queueDate },
              { $inc: { lastNumber: 1 } },
              { upsert: true, new: true, session },
            );

            const queueNumber = counter.lastNumber;
            created = await this.apptModel
              .create(
                [
                  {
                    clinicId,
                    branchId,
                    doctorId,
                    patientId,
                    type: AppointmentType.Queue,
                    queueDate,
                    queueNumber,
                    status: AppointmentStatus.Booked,
                    source,
                    notes: dto.notes,
                    createdBy: actorUserId,
                  },
                ],
                { session },
              )
              .then((docs) => docs[0]);
          });
          if (!created) throw new Error('Appointment not created');
          return created;
        } catch (e: any) {
          const msg = String(e?.message ?? '');
          if (!msg.includes('Transaction numbers are only allowed')) throw e;
        } finally {
          await session.endSession();
        }
      }

      const counter = await this.counterModel.findOneAndUpdate(
        { clinicId, branchId, doctorId, queueDate },
        { $inc: { lastNumber: 1 } },
        { upsert: true, new: true },
      );
      const queueNumber = counter.lastNumber;
      return await this.apptModel.create({
        clinicId,
        branchId,
        doctorId,
        patientId,
        type: AppointmentType.Queue,
        queueDate,
        queueNumber,
        status: AppointmentStatus.Booked,
        source,
        notes: dto.notes,
        createdBy: actorUserId,
      });
    }

    throw new BadRequestException('Unsupported appointment type');
  }

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

  /**
   * Returns every slot for the doctor's day with its real status. The
   * front-desk needs to *see* booked slots (so they can read the doctor's
   * day at a glance) — they're not filtered out, just marked.
   *
   * Slot status:
   *   - `past`      — slot's startAt is before now. Cannot be booked.
   *   - `booked`    — an active TIME appointment overlaps this slot.
   *   - `available` — open. Default.
   *
   * `booked` slots include a `bookedBy` ref so the UI can surface a
   * patient-name tooltip without a second fetch. `populate('patientId')`
   * with a `fullName` projection avoids leaking PHI we don't need.
   */
  async availableSlots(input: {
    clinicId: Types.ObjectId;
    branchId: string;
    doctorId: string;
    date: string;
    duration?: number;
  }) {
    const branchObjId = new Types.ObjectId(input.branchId);
    const doctorObjId = new Types.ObjectId(input.doctorId);

    const daySlots = await this.availability.getDaySlots({
      clinicId: input.clinicId,
      branchId: branchObjId,
      doctorUserId: doctorObjId,
      date: input.date,
      duration: input.duration,
    });

    if (!daySlots.slots.length) {
      return { ...daySlots, slots: [] as EnrichedSlot[] };
    }

    const clinic = await this.clinicModel.findById(input.clinicId);
    const tz = clinic?.timezone || daySlots.timezone || 'UTC';
    const day = DateTime.fromISO(input.date, { zone: tz });
    const dayStartUtc = day.startOf('day').toUTC().toJSDate();
    const dayEndUtc = day.endOf('day').toUTC().toJSDate();

    const booked = await this.apptModel
      .find({
        clinicId: input.clinicId,
        branchId: branchObjId,
        doctorId: doctorObjId,
        type: AppointmentType.Time,
        status: { $in: ACTIVE_TIME_STATUSES },
        startAt: { $gte: dayStartUtc, $lte: dayEndUtc },
      })
      .populate({ path: 'patientId', select: 'fullName' });

    // Build a lookup keyed on `startAt|endAt` so a slot match is O(1).
    // Two booked appts at the same exact slot is structurally impossible
    // (the partial unique index in the schema enforces that), so the
    // map is safe to be 1:1.
    const bookedByKey = new Map<
      string,
      { apptId: string; patientName: string | null; status: string }
    >();
    for (const a of booked) {
      if (!a.startAt || !a.endAt) continue;
      const key = `${a.startAt.toISOString()}|${a.endAt.toISOString()}`;
      const populatedPatient = a.patientId as unknown as
        | { fullName?: string }
        | null;
      bookedByKey.set(key, {
        apptId: a._id.toHexString(),
        patientName: populatedPatient?.fullName ?? null,
        status: a.status,
      });
    }

    // Use Luxon for "now" so the comparison is in the same timezone context
    // as slot generation — both anchored to the clinic's IANA zone.
    // A 30-second grace window prevents a slot from flickering to "past"
    // while the receptionist is mid-click.
    const nowDt = DateTime.now().setZone(tz).minus({ seconds: 30 });
    const slots: EnrichedSlot[] = daySlots.slots.map((s) => {
      const key = `${s.startAt}|${s.endAt}`;
      const slotStartDt = DateTime.fromISO(s.startAt, { zone: 'utc' }).setZone(tz);
      const conflict = bookedByKey.get(key);
      if (conflict) {
        return {
          startAt: s.startAt,
          endAt: s.endAt,
          status: 'booked' as const,
          bookedBy: conflict,
        };
      }
      if (slotStartDt.isValid && slotStartDt < nowDt) {
        return {
          startAt: s.startAt,
          endAt: s.endAt,
          status: 'past' as const,
        };
      }
      return {
        startAt: s.startAt,
        endAt: s.endAt,
        status: 'available' as const,
      };
    });

    return { ...daySlots, slots };
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Appointment not found');
    }
    const appt = await this.apptModel.findOne({ _id: id, clinicId });
    if (!appt) throw new NotFoundException('Appointment not found');
    return appt;
  }

  async update(
    clinicId: Types.ObjectId,
    id: string,
    dto: UpdateAppointmentDto,
  ) {
    const appt = await this.apptModel.findOne({ _id: id, clinicId });
    if (!appt) throw new NotFoundException('Appointment not found');

    // Reschedule TIME with conflict check
    if ((dto.startAt || dto.endAt) && appt.type !== AppointmentType.Time) {
      throw new BadRequestException(
        'Only TIME appointments can be rescheduled by startAt/endAt',
      );
    }

    if (appt.type === AppointmentType.Time && (dto.startAt || dto.endAt)) {
      const startAt = dto.startAt ? new Date(dto.startAt) : appt.startAt!;
      const endAt = dto.endAt ? new Date(dto.endAt) : appt.endAt!;
      if (endAt <= startAt)
        throw new BadRequestException('endAt must be after startAt');

      const overlap = await this.apptModel.findOne({
        _id: { $ne: appt._id },
        clinicId,
        branchId: appt.branchId,
        doctorId: appt.doctorId,
        type: AppointmentType.Time,
        status: { $in: ACTIVE_TIME_STATUSES },
        startAt: { $lt: endAt },
        endAt: { $gt: startAt },
      });
      if (overlap) {
        throw await this.buildOverlapConflict({
          clinicId,
          branchId: appt.branchId,
          doctorId: appt.doctorId,
          requestedStartAt: startAt,
        });
      }

      appt.startAt = startAt;
      appt.endAt = endAt;
    }

    if (dto.status) {
      if (dto.status === AppointmentStatus.CheckedIn) {
        const clinic = await this.clinicModel.findById(clinicId);
        if (!clinic) throw new NotFoundException('Clinic not found');
        assertCanCheckIn(appt, clinic);
      }
      assertAllowedTransition(appt.status, dto.status);
      appt.status = dto.status;
    }
    if (dto.notes !== undefined) {
      appt.notes = dto.notes;
    }

    await appt.save();
    return appt;
  }

  async checkin(clinicId: Types.ObjectId, id: string) {
    const appt = await this.apptModel.findOne({ _id: id, clinicId });
    if (!appt) throw new NotFoundException('Appointment not found');
    const clinic = await this.clinicModel.findById(clinicId);
    if (!clinic) throw new NotFoundException('Clinic not found');
    assertCanCheckIn(appt, clinic);
    assertAllowedTransition(appt.status, AppointmentStatus.CheckedIn);
    appt.status = AppointmentStatus.CheckedIn;
    await appt.save();
    return appt;
  }

  async cancel(
    clinicId: Types.ObjectId,
    id: string,
    actorUserId: Types.ObjectId | undefined,
    reason: string,
  ) {
    const appt = await this.apptModel.findOne({ _id: id, clinicId });
    if (!appt) throw new NotFoundException('Appointment not found');

    if (!CANCELLABLE_STATUSES.includes(appt.status)) {
      throw new BadRequestException(
        `Cannot cancel appointment in status ${appt.status}`,
      );
    }
    assertAllowedTransition(appt.status, AppointmentStatus.Cancelled);

    appt.status = AppointmentStatus.Cancelled;
    appt.cancellationReason = reason.trim();
    appt.cancelledAt = new Date();
    appt.cancelledBy = actorUserId;
    await appt.save();
    return appt;
  }

  // --- internals ----------------------------------------------------------

  private async assertDoctorAtBranch(
    clinicId: Types.ObjectId,
    doctorId: Types.ObjectId,
    branchId: Types.ObjectId,
  ) {
    const doctor = await this.userModel.findOne({
      _id: doctorId,
      clinicId,
    });
    if (!doctor) {
      // 400 (not 404) so the front-desk gets a clear "this doctor doesn't
      // belong to this clinic" message rather than a generic not-found.
      throw new BadRequestException('Doctor not found in this clinic');
    }
    const branchIds = (doctor.branchIds ?? []).map((b) => String(b));
    if (!branchIds.includes(String(branchId))) {
      throw new BadRequestException(
        'Doctor is not assigned to this branch',
      );
    }
  }

  private async assertPatientInClinic(
    clinicId: Types.ObjectId,
    patientId: Types.ObjectId,
  ) {
    const exists = await this.patientModel.exists({
      _id: patientId,
      clinicId,
    });
    if (!exists) {
      throw new BadRequestException('Patient not found in this clinic');
    }
  }

  /**
   * Produce a 409 with a `alternatives` payload containing the next 3 free
   * slots for this doctor on the requested local day. The FE can offer
   * one-click rebooking into any of them.
   */
  private async buildOverlapConflict(input: {
    clinicId: Types.ObjectId;
    branchId: Types.ObjectId;
    doctorId: Types.ObjectId;
    requestedStartAt: Date;
  }): Promise<ConflictException> {
    const clinic = await this.clinicModel.findById(input.clinicId);
    const tz = clinic?.timezone || 'UTC';
    const date = DateTime.fromJSDate(input.requestedStartAt, { zone: 'utc' })
      .setZone(tz)
      .toISODate();

    let alternatives: { startAt: string; endAt: string }[] = [];
    if (date) {
      try {
        const day = await this.availableSlots({
          clinicId: input.clinicId,
          branchId: input.branchId.toHexString(),
          doctorId: input.doctorId.toHexString(),
          date,
        });
        const requestedIso = DateTime.fromJSDate(input.requestedStartAt, {
          zone: 'utc',
        }).toISO();
        // Prefer slots starting at-or-after the requested time so the front
        // desk can offer "the next slot," not slots earlier in the day.
        alternatives = day.slots
          .filter((s) => !requestedIso || s.startAt >= requestedIso)
          .slice(0, 3);
        if (alternatives.length < 3) {
          // Pad with any earlier free slots so we always offer up to 3.
          const filler = day.slots
            .filter(
              (s) =>
                !alternatives.some(
                  (a) => a.startAt === s.startAt && a.endAt === s.endAt,
                ),
            )
            .slice(0, 3 - alternatives.length);
          alternatives = [...alternatives, ...filler];
        }
      } catch {
        // Availability lookup is best-effort — never let it mask the 409.
      }
    }

    return new ConflictException({
      statusCode: 409,
      message: 'Time slot is already booked',
      alternatives,
    });
  }

  /**
   * Cascade-reschedule any appointments that no longer fit the doctor's
   * availability after rules or overrides changed.
   *
   * Called from AvailabilityService.upsertOverride after every override
   * save — CLOSED, CUSTOM_WINDOWS, ADDITIONAL_WINDOWS. We don't gate on
   * type because a CUSTOM_WINDOWS override can punch a hole in the day
   * just as effectively as a full CLOSED, and ADDITIONAL_WINDOWS never
   * invalidates an existing appointment so the inner check is a no-op.
   *
   * For each booked TIME appointment on `affectedDate`:
   *  1) Re-run availability.assertTimeSlotAllowed against the updated
   *     rules+overrides. If it passes, the appointment still fits — keep.
   *  2) If it throws, the appointment now collides with the new state —
   *     walk forward day-by-day, find the next free slot of the same
   *     duration, move it there, and notify the patient (WhatsApp + email
   *     when available).
   *
   * "Next free slot" means the earliest slot the doctor has on any
   * subsequent day within a 30-day window — we don't insist on the same
   * hour. DONE appointments are skipped (visit already happened).
   * Notification failures never revert the move.
   */
  async rescheduleConflictsForDay(input: {
    clinicId: Types.ObjectId;
    branchId: Types.ObjectId;
    doctorUserId: Types.ObjectId;
    affectedDate: string; // YYYY-MM-DD in clinic timezone
  }): Promise<{
    rescheduled: Array<{
      appointmentId: string;
      patientName: string;
      originalStartAt: string;
      newStartAt: string;
      newEndAt: string;
    }>;
    failed: Array<{ appointmentId: string; reason: string }>;
  }> {
    const clinic = await this.clinicModel.findById(input.clinicId);
    if (!clinic) throw new NotFoundException('Clinic not found');
    const tz = clinic.timezone || 'UTC';
    const clinicName = clinic.name;

    const { startUtc: dayStart, endUtc: dayEnd } = computeClinicDayRange(
      input.affectedDate,
      tz,
    );

    // Only move slots that are still actionable. DONE = visit already
    // happened; CANCELLED / NO_SHOW already released their slot.
    const MOVABLE_STATUSES: AppointmentStatus[] = [
      AppointmentStatus.Booked,
      AppointmentStatus.CheckedIn,
      AppointmentStatus.InProgress,
    ];

    const candidates = await this.apptModel
      .find({
        clinicId: input.clinicId,
        branchId: input.branchId,
        doctorId: input.doctorUserId,
        type: AppointmentType.Time,
        status: { $in: MOVABLE_STATUSES },
        startAt: { $gte: dayStart, $lte: dayEnd },
      })
      .sort({ startAt: 1 });

    this.logger.log(
      `[cascade] Evaluating ${candidates.length} appointment(s) on ${input.affectedDate} for doctor ${input.doctorUserId.toHexString()}`,
    );

    // First pass: split candidates into still-valid and now-invalid.
    // assertTimeSlotAllowed reads the FRESH rules+override state, so by
    // the time this runs the saved override is already in play.
    const conflicting: typeof candidates = [];
    for (const appt of candidates) {
      if (!appt.startAt || !appt.endAt) {
        // Defensive: schema requires both, but a malformed historical
        // row shouldn't crash the cascade.
        this.logger.warn(
          `[cascade] Appointment ${appt._id.toHexString()} missing startAt/endAt — skipping`,
        );
        continue;
      }
      try {
        await this.availability.assertTimeSlotAllowed({
          clinicId: input.clinicId,
          branchId: input.branchId,
          doctorUserId: input.doctorUserId,
          startAt: appt.startAt,
          endAt: appt.endAt,
        });
        // Still valid — no move.
      } catch {
        conflicting.push(appt);
      }
    }

    if (conflicting.length === 0) {
      this.logger.log(
        `[cascade] No conflicts on ${input.affectedDate} — nothing to reschedule`,
      );
      return { rescheduled: [], failed: [] };
    }

    this.logger.log(
      `[cascade] ${conflicting.length} appointment(s) conflict — finding next free slots`,
    );

    // Pre-load the doctor + patients in one batch to avoid N+1 fetches.
    const doctor = await this.userModel.findById(input.doctorUserId);
    const doctorName = doctor?.name ?? 'your doctor';
    const patientIds = Array.from(new Set(conflicting.map((a) => a.patientId.toString())));
    const patients = patientIds.length
      ? await this.patientModel.find({
          _id: { $in: patientIds.map((id) => new Types.ObjectId(id)) },
          clinicId: input.clinicId,
        })
      : [];
    const patientById = new Map(patients.map((p) => [p._id.toString(), p]));

    const rescheduled: Array<{
      appointmentId: string;
      patientName: string;
      originalStartAt: string;
      newStartAt: string;
      newEndAt: string;
    }> = [];
    const failed: Array<{ appointmentId: string; reason: string }> = [];

    // Sequential — each iteration commits to DB so the next finder sees
    // the prior move's slot as occupied (prevents the batch from picking
    // the same slot twice).
    for (const appt of conflicting) {
      if (!appt.startAt || !appt.endAt) {
        failed.push({ appointmentId: appt._id.toHexString(), reason: 'Missing start/end' });
        continue;
      }
      const durationMin = Math.max(
        5,
        Math.round((appt.endAt.getTime() - appt.startAt.getTime()) / 60000),
      );
      const slot = await this.findNextFreeSlot({
        clinicId: input.clinicId,
        branchId: input.branchId,
        doctorUserId: input.doctorUserId,
        fromDate: input.affectedDate,
        durationMin,
        tz,
      });
      if (!slot) {
        this.logger.warn(
          `[reschedule] No free slot within 30 days for appointment ${appt._id.toHexString()} (duration=${durationMin}min) — left in place`,
        );
        failed.push({
          appointmentId: appt._id.toHexString(),
          reason: 'No free slot found within the next 30 days',
        });
        continue;
      }
      const originalStartAt = appt.startAt.toISOString();
      appt.startAt = slot.startAt;
      appt.endAt = slot.endAt;
      // Reset to BOOKED — a patient who was CheckedIn / InProgress on
      // the closed day clearly hasn't arrived for the new appointment.
      appt.status = AppointmentStatus.Booked;
      await appt.save();

      const patient = patientById.get(appt.patientId.toString());
      const patientName = patient?.fullName ?? 'there';
      this.logger.log(
        `[reschedule] Moved appointment ${appt._id.toHexString()} (${patientName}) from ${originalStartAt} → ${slot.startAt.toISOString()}`,
      );
      rescheduled.push({
        appointmentId: appt._id.toHexString(),
        patientName,
        originalStartAt,
        newStartAt: slot.startAt.toISOString(),
        newEndAt: slot.endAt.toISOString(),
      });

      // Fire-and-forget notifications. Each channel is wrapped so a
      // failure on one (e.g. clinic has WhatsApp disabled) doesn't
      // block the others.
      await this.sendRescheduleNotifications({
        clinicId: input.clinicId,
        branchId: input.branchId,
        patient,
        patientName,
        doctorName,
        clinicName,
        tz,
        oldStartAtIso: originalStartAt,
        newStartAt: slot.startAt,
      }).catch((e) => {
        this.logger.warn(
          `[reschedule] Notification dispatch failed for appointment ${appt._id.toHexString()}: ${e instanceof Error ? e.message : e}`,
        );
      });
    }

    this.logger.log(
      `[cascade] Done on ${input.affectedDate}: ${rescheduled.length} moved, ${failed.length} failed`,
    );
    return { rescheduled, failed };
  }

  private async findNextFreeSlot(input: {
    clinicId: Types.ObjectId;
    branchId: Types.ObjectId;
    doctorUserId: Types.ObjectId;
    fromDate: string; // closed day; we start searching the day AFTER
    durationMin: number;
    tz: string;
  }): Promise<{ startAt: Date; endAt: Date } | null> {
    const MAX_DAYS = 30;
    let cursor = DateTime.fromISO(input.fromDate, { zone: input.tz }).plus({ days: 1 });
    const now = Date.now();

    for (let i = 0; i < MAX_DAYS; i++) {
      const dateStr = cursor.toISODate();
      if (!dateStr) {
        cursor = cursor.plus({ days: 1 });
        continue;
      }
      let daySlots;
      try {
        daySlots = await this.availability.getDaySlots({
          clinicId: input.clinicId,
          branchId: input.branchId,
          doctorUserId: input.doctorUserId,
          date: dateStr,
          duration: input.durationMin,
        });
      } catch {
        // A bad date / missing rule on a day shouldn't kill the search.
        cursor = cursor.plus({ days: 1 });
        continue;
      }

      for (const slot of daySlots.slots) {
        const slotStart = new Date(slot.startAt);
        const slotEnd = new Date(slot.endAt);
        if (slotStart.getTime() <= now) continue; // never reschedule into the past

        const overlap = await this.apptModel.findOne({
          clinicId: input.clinicId,
          branchId: input.branchId,
          doctorId: input.doctorUserId,
          type: AppointmentType.Time,
          status: { $in: ACTIVE_TIME_STATUSES },
          startAt: { $lt: slotEnd },
          endAt: { $gt: slotStart },
        });
        if (!overlap) {
          return { startAt: slotStart, endAt: slotEnd };
        }
      }
      cursor = cursor.plus({ days: 1 });
    }
    return null;
  }

  private async sendRescheduleNotifications(input: {
    clinicId: Types.ObjectId;
    branchId: Types.ObjectId;
    patient: Patient | undefined;
    patientName: string;
    doctorName: string;
    clinicName: string;
    tz: string;
    oldStartAtIso: string;
    newStartAt: Date;
  }) {
    const fmtDateTime = (d: Date) =>
      DateTime.fromJSDate(d, { zone: 'utc' })
        .setZone(input.tz)
        .toFormat("d LLL yyyy 'at' h:mm a");

    const oldLabel = fmtDateTime(new Date(input.oldStartAtIso));
    const newLabel = fmtDateTime(input.newStartAt);

    const body =
      `Hi ${input.patientName}, due to an emergency, Dr. ${input.doctorName} is unavailable on the original date. ` +
      `Your appointment with ${input.clinicName} has been rescheduled from ${oldLabel} to ${newLabel}. ` +
      `Reply or call us to make changes.`;

    const phone = input.patient?.phones?.[0]?.trim();
    const email = input.patient?.emails?.[0]?.trim();

    const tasks: Promise<unknown>[] = [];
    if (phone) {
      tasks.push(
        this.notifications.enqueueSend({
          clinicId: input.clinicId,
          branchId: input.branchId,
          channel: NotificationChannel.WhatsApp,
          to: phone,
          body,
          templateKey: 'appointment_rescheduled',
        }),
      );
    }
    if (email) {
      tasks.push(
        this.notifications.enqueueSend({
          clinicId: input.clinicId,
          branchId: input.branchId,
          channel: NotificationChannel.Email,
          to: email,
          body,
          templateKey: 'appointment_rescheduled',
        }),
      );
    }

    await Promise.allSettled(tasks);
  }
}
