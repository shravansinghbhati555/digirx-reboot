import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { DateTime } from 'luxon';
import { AppointmentsService } from './appointments.service';
import {
  AppointmentStatus,
  AppointmentType,
} from './schemas/appointment.schema';

const TZ = 'Asia/Kolkata';

function utcDate(local: string): Date {
  return new Date(DateTime.fromISO(local, { zone: TZ }).toUTC().toISO()!);
}

/**
 * Always-future date helper. Anchored on `Date.now() + 30 days` and snapped
 * to the requested HH:MM in clinic-local time. Lets every spec keep using
 * the same human-readable HH:MM literals (10:00, 10:30, …) without baking
 * in a calendar date that becomes "past" the day the spec is run — the
 * past-time guard in `create()` rejects past startAt values.
 */
function futureDateAt(localTime: string): Date {
  const [h, m] = localTime.split(':').map(Number);
  return new Date(
    DateTime.now()
      .setZone(TZ)
      .plus({ days: 30 })
      .set({ hour: h, minute: m, second: 0, millisecond: 0 })
      .toUTC()
      .toISO()!,
  );
}

function chainable<T>(value: T) {
  // Mongoose .findOne(...).session(s) returns a thenable. Mimic that here so
  // both call shapes — direct await and `.session(s)` then await — resolve to
  // the same value.
  const promise: any = Promise.resolve(value);
  promise.session = jest.fn().mockResolvedValue(value);
  return promise;
}

describe('AppointmentsService.create', () => {
  let apptModel: any;
  let counterModel: any;
  let clinicModel: any;
  let userModel: any;
  let patientModel: any;
  let connection: any;
  let availability: any;
  let service: AppointmentsService;

  const clinicId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const doctorId = new Types.ObjectId();
  const patientId = new Types.ObjectId();
  const actorUserId = new Types.ObjectId();

  beforeEach(() => {
    apptModel = {
      findOne: jest.fn(),
      create: jest.fn(),
    };
    counterModel = {
      findOneAndUpdate: jest.fn(),
    };
    clinicModel = {
      findById: jest.fn().mockResolvedValue({
        _id: clinicId,
        timezone: TZ,
      }),
    };
    // Membership-assert mocks. Tests that want the asserts to fail override
    // these per-case.
    userModel = {
      findOne: jest.fn().mockResolvedValue({
        _id: doctorId,
        clinicId,
        branchIds: [branchId],
      }),
    };
    patientModel = {
      exists: jest.fn().mockResolvedValue({ _id: patientId }),
    };
    // Default to the "no replica set" branch — `connection.startSession()`
    // resolves to null (the service's `.catch(() => null)` would do the same
    // on rejection). Tests that need the transactional branch override this.
    connection = {
      startSession: jest.fn().mockResolvedValue(null),
    };
    availability = {
      assertTimeSlotAllowed: jest.fn().mockResolvedValue(undefined),
    };
    // NotificationsService is only exercised by the close-day cascade,
    // which has its own dedicated tests / wiring. The existing specs
    // don't go through that path, so a no-op mock keeps them green
    // without exercising the notification queue.
    const notifications = {
      enqueueSend: jest.fn().mockResolvedValue(undefined),
      isChannelEnabled: jest.fn().mockResolvedValue(true),
    } as any;
    service = new AppointmentsService(
      apptModel,
      counterModel,
      clinicModel,
      userModel,
      patientModel,
      connection,
      availability,
      notifications,
    );
  });

  describe('TIME appointments', () => {
    function timeDto(overrides: Record<string, unknown> = {}) {
      return {
        type: AppointmentType.Time,
        branchId: branchId.toHexString(),
        doctorId: doctorId.toHexString(),
        patientId: patientId.toHexString(),
        startAt: futureDateAt('10:00').toISOString(),
        endAt: futureDateAt('10:30').toISOString(),
        ...overrides,
      };
    }

    it('rejects missing startAt or endAt', async () => {
      await expect(
        service.create(clinicId, actorUserId, timeDto({ startAt: undefined })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects endAt <= startAt', async () => {
      const startAt = futureDateAt('10:00').toISOString();
      await expect(
        service.create(
          clinicId,
          actorUserId,
          timeDto({ startAt, endAt: startAt }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects startAt in the past (no backdating)', async () => {
      // 5 minutes ago in clinic-local time. Anchored on now() so this is
      // genuinely "past" regardless of when the spec runs.
      const startAt = new Date(Date.now() - 5 * 60_000).toISOString();
      const endAt = new Date(Date.now() + 25 * 60_000).toISOString();
      await expect(
        service.create(clinicId, actorUserId, timeDto({ startAt, endAt })),
      ).rejects.toThrow(/past/i);
    });

    it('calls availability.assertTimeSlotAllowed before checking for overlaps', async () => {
      apptModel.findOne.mockResolvedValue(null);
      apptModel.create.mockResolvedValue({ _id: new Types.ObjectId() });

      await service.create(clinicId, actorUserId, timeDto());

      expect(availability.assertTimeSlotAllowed).toHaveBeenCalledTimes(1);
      const callArgs = availability.assertTimeSlotAllowed.mock.calls[0][0];
      expect(callArgs.clinicId).toBe(clinicId);
      expect(callArgs.branchId).toEqual(branchId);
      expect(callArgs.doctorId ?? callArgs.doctorUserId).toEqual(doctorId);
    });

    it('returns 409 ConflictException when an overlapping booking exists (standalone fallback)', async () => {
      apptModel.findOne.mockResolvedValue({ _id: new Types.ObjectId() });
      await expect(
        service.create(clinicId, actorUserId, timeDto()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(apptModel.create).not.toHaveBeenCalled();
    });

    it('creates the appointment when no overlap is found (standalone fallback)', async () => {
      apptModel.findOne.mockResolvedValue(null);
      const created = { _id: new Types.ObjectId() };
      apptModel.create.mockResolvedValue(created);

      const out = await service.create(clinicId, actorUserId, timeDto());

      expect(out).toBe(created);
      expect(apptModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId,
          branchId,
          doctorId,
          patientId,
          type: AppointmentType.Time,
          status: AppointmentStatus.Booked,
          createdBy: actorUserId,
        }),
      );
    });

    it('treats back-to-back bookings (start = previous end) as non-overlapping', async () => {
      // The query is `startAt: { $lt: endAt }, endAt: { $gt: startAt }` — for an
      // existing 10:00–10:30 booking and a new 10:30–11:00 booking the index lookup
      // returns nothing. Simulate that.
      apptModel.findOne.mockResolvedValue(null);
      apptModel.create.mockResolvedValue({ _id: new Types.ObjectId() });

      const dto = {
        type: AppointmentType.Time,
        branchId: branchId.toHexString(),
        doctorId: doctorId.toHexString(),
        patientId: patientId.toHexString(),
        startAt: futureDateAt('10:30').toISOString(),
        endAt: futureDateAt('11:00').toISOString(),
      };

      await expect(
        service.create(clinicId, actorUserId, dto),
      ).resolves.toBeDefined();

      // The query must use strict inequalities, not $lte/$gte.
      const filter = apptModel.findOne.mock.calls[0][0];
      expect(filter.startAt).toEqual({ $lt: new Date(dto.endAt) });
      expect(filter.endAt).toEqual({ $gt: new Date(dto.startAt) });
    });

    it('uses ACTIVE statuses (Booked/CheckedIn/InProgress/Done) when looking for overlaps', async () => {
      apptModel.findOne.mockResolvedValue(null);
      apptModel.create.mockResolvedValue({ _id: new Types.ObjectId() });

      await service.create(clinicId, actorUserId, timeDto());

      const filter = apptModel.findOne.mock.calls[0][0];
      // Done is intentionally included — a past visit's slot is still
      // consumed and can't be retroactively double-booked. See the
      // comment on ACTIVE_TIME_STATUSES in appointments.service.ts.
      expect(filter.status).toEqual({
        $in: [
          AppointmentStatus.Booked,
          AppointmentStatus.CheckedIn,
          AppointmentStatus.InProgress,
          AppointmentStatus.Done,
        ],
      });
    });

    it('runs the overlap check inside a Mongo transaction when a session is available', async () => {
      const session = {
        withTransaction: jest.fn(async (cb: any) => cb()),
        endSession: jest.fn().mockResolvedValue(undefined),
      };
      connection.startSession.mockResolvedValue(session);
      apptModel.findOne.mockReturnValue(chainable(null));
      apptModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.create(clinicId, actorUserId, timeDto());

      expect(session.withTransaction).toHaveBeenCalledTimes(1);
      expect(session.endSession).toHaveBeenCalledTimes(1);
      // Within the transaction we must scope the read to the session.
      const findOneReturn = apptModel.findOne.mock.results[0].value;
      expect(findOneReturn.session).toHaveBeenCalledWith(session);
    });

    it('falls back to a non-transactional check when the deployment is standalone', async () => {
      // Real `withTransaction` rejects before invoking the callback when the
      // server refuses to start a transaction, so the in-tx findOne never
      // runs — only the fallback findOne fires.
      const txError: any = new Error(
        'Transaction numbers are only allowed on a replica set member or mongos',
      );
      const session = {
        withTransaction: jest.fn().mockRejectedValue(txError),
        endSession: jest.fn().mockResolvedValue(undefined),
      };
      connection.startSession.mockResolvedValue(session);

      apptModel.findOne.mockResolvedValue(null); // fallback path
      const created = { _id: new Types.ObjectId() };
      apptModel.create.mockResolvedValue(created);

      const out = await service.create(clinicId, actorUserId, timeDto());

      expect(out).toBe(created);
      expect(session.endSession).toHaveBeenCalledTimes(1);
      // Only the fallback overlap query — the tx callback never executed.
      expect(apptModel.findOne).toHaveBeenCalledTimes(1);
    });

    it('does not swallow non-transaction errors when the transaction throws', async () => {
      const otherError = new Error('database is on fire');
      const session = {
        withTransaction: jest.fn().mockRejectedValue(otherError),
        endSession: jest.fn().mockResolvedValue(undefined),
      };
      connection.startSession.mockResolvedValue(session);

      await expect(
        service.create(clinicId, actorUserId, timeDto()),
      ).rejects.toBe(otherError);
      expect(session.endSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('QUEUE appointments', () => {
    function queueDto(overrides: Record<string, unknown> = {}) {
      // toISODate() returns string | null per Luxon's typings; clinic
      // timezone is always valid here so the non-null assertion is safe
      // and keeps the DTO's `queueDate: string | undefined` shape happy.
      const today = DateTime.now().setZone(TZ).toISODate()!;
      return {
        type: AppointmentType.Queue,
        branchId: branchId.toHexString(),
        doctorId: doctorId.toHexString(),
        patientId: patientId.toHexString(),
        queueDate: today,
        ...overrides,
      };
    }

    it('rejects when the clinic is missing', async () => {
      clinicModel.findById.mockResolvedValue(null);
      await expect(
        service.create(clinicId, actorUserId, queueDto()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a malformed queueDate', async () => {
      await expect(
        service.create(clinicId, actorUserId, queueDto({ queueDate: '05-2026-01' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a queueDate in the past (clinic timezone)', async () => {
      // 1 Jan 2020 in IST is unambiguously past.
      await expect(
        service.create(
          clinicId,
          actorUserId,
          queueDto({ queueDate: '2020-01-01' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a queueDate >365d in the future', async () => {
      const farFuture = DateTime.now()
        .setZone(TZ)
        .plus({ days: 400 })
        .toISODate();
      await expect(
        service.create(clinicId, actorUserId, queueDto({ queueDate: farFuture })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('atomically increments the queue counter and stores the returned number', async () => {
      counterModel.findOneAndUpdate.mockResolvedValue({ lastNumber: 7 });
      const created = { _id: new Types.ObjectId() };
      apptModel.create.mockResolvedValue(created);

      const today = DateTime.now().setZone(TZ).toISODate()!;
      const out = await service.create(
        clinicId,
        actorUserId,
        queueDto({ queueDate: today }),
      );

      expect(out).toBe(created);
      expect(counterModel.findOneAndUpdate).toHaveBeenCalledWith(
        { clinicId, branchId, doctorId, queueDate: today },
        { $inc: { lastNumber: 1 } },
        { upsert: true, new: true },
      );
      expect(apptModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: AppointmentType.Queue,
          queueDate: today,
          queueNumber: 7,
          status: AppointmentStatus.Booked,
        }),
      );
    });

    it('returns sequential queue numbers across simulated concurrent bookings', async () => {
      // Mongo's $inc + upsert is atomic; mirror that with a closure counter so
      // we exercise the service's plumbing under a parallel Promise.all.
      let n = 0;
      counterModel.findOneAndUpdate.mockImplementation(async () => ({
        lastNumber: ++n,
      }));
      apptModel.create.mockImplementation(async (doc: any) => ({
        _id: new Types.ObjectId(),
        ...doc,
      }));

      const today = DateTime.now().setZone(TZ).toISODate()!;
      const dtos = Array.from({ length: 20 }, () =>
        queueDto({ queueDate: today }),
      );
      const created = await Promise.all(
        dtos.map((d) => service.create(clinicId, actorUserId, d)),
      );

      const numbers = created
        .map((a: any) => a.queueNumber)
        .sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });
  });

  it('rejects an unsupported appointment type', async () => {
    await expect(
      service.create(clinicId, actorUserId, {
        type: 'WALK_IN' as any,
        branchId: branchId.toHexString(),
        doctorId: doctorId.toHexString(),
        patientId: patientId.toHexString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
