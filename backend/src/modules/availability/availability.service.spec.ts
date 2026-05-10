import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DateTime } from 'luxon';
import { AvailabilityService } from './availability.service';

type Mocked<T> = { [K in keyof T]: jest.Mock };

function utcIso(local: string, tz: string): string {
  return DateTime.fromISO(local, { zone: tz }).toUTC().toISO()!;
}

describe('AvailabilityService', () => {
  let ruleModel: any;
  let overrideModel: any;
  let clinicModel: any;
  let authz: Mocked<{ getActor: any }>;
  let service: AvailabilityService;

  const clinicId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const doctorUserId = new Types.ObjectId();
  const adminUserId = new Types.ObjectId();

  const TZ = 'Asia/Kolkata';

  beforeEach(() => {
    ruleModel = {
      findOne: jest.fn(),
      find: jest.fn(),
      bulkWrite: jest.fn().mockResolvedValue({ ok: 1 }),
    };
    overrideModel = {
      findOne: jest.fn(),
      find: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    clinicModel = {
      findById: jest.fn().mockResolvedValue({
        _id: clinicId,
        timezone: TZ,
        settings: {},
      }),
    };
    authz = { getActor: jest.fn() };
    service = new AvailabilityService(
      ruleModel,
      overrideModel,
      clinicModel,
      authz as any,
    );
  });

  describe('getDaySlots', () => {
    it('rejects a malformed date string', async () => {
      await expect(
        service.getDaySlots({
          clinicId,
          branchId,
          doctorUserId,
          date: 'not-a-date',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns no slots when the override is CLOSED', async () => {
      overrideModel.findOne.mockResolvedValue({ type: 'CLOSED', windows: [] });
      ruleModel.findOne.mockResolvedValue({
        windows: [{ startMinutes: 9 * 60, endMinutes: 12 * 60 }],
        slotMinutes: 30,
      });

      const out = await service.getDaySlots({
        clinicId,
        branchId,
        doctorUserId,
        date: '2026-05-01',
      });

      expect(out.slots).toEqual([]);
      expect(out.windows).toEqual([]);
      expect(out.timezone).toBe(TZ);
    });

    it('CUSTOM_WINDOWS replaces the weekly rule windows entirely', async () => {
      // Weekly rule says 09:00–12:00, but the override narrows to 10:00–11:00.
      overrideModel.findOne.mockResolvedValue({
        type: 'CUSTOM_WINDOWS',
        windows: [{ startMinutes: 10 * 60, endMinutes: 11 * 60 }],
      });
      ruleModel.findOne.mockResolvedValue({
        windows: [{ startMinutes: 9 * 60, endMinutes: 12 * 60 }],
        slotMinutes: 30,
      });

      const out = await service.getDaySlots({
        clinicId,
        branchId,
        doctorUserId,
        date: '2026-05-01',
      });

      // 10:00–11:00 IST at 30-min slots → exactly two slots (10:00–10:30, 10:30–11:00).
      expect(out.slots).toHaveLength(2);
      expect(out.slots[0].startAt).toBe(utcIso('2026-05-01T10:00', TZ));
      expect(out.slots[0].endAt).toBe(utcIso('2026-05-01T10:30', TZ));
      expect(out.slots[1].endAt).toBe(utcIso('2026-05-01T11:00', TZ));
    });

    it('ADDITIONAL_WINDOWS unions the override windows on top of the weekly rule', async () => {
      overrideModel.findOne.mockResolvedValue({
        type: 'ADDITIONAL_WINDOWS',
        windows: [{ startMinutes: 18 * 60, endMinutes: 19 * 60 }],
      });
      ruleModel.findOne.mockResolvedValue({
        windows: [{ startMinutes: 9 * 60, endMinutes: 10 * 60 }],
        slotMinutes: 60,
      });

      const out = await service.getDaySlots({
        clinicId,
        branchId,
        doctorUserId,
        date: '2026-05-01',
      });

      expect(out.windows).toHaveLength(2);
      // Sorted by start; rule-window first.
      expect(out.windows[0].startAt).toBe(utcIso('2026-05-01T09:00', TZ));
      expect(out.windows[1].startAt).toBe(utcIso('2026-05-01T18:00', TZ));
      expect(out.slots).toHaveLength(2);
    });

    it('falls back to clinic.settings slotMinutesDefault when the rule has no slotMinutes', async () => {
      overrideModel.findOne.mockResolvedValue(null);
      ruleModel.findOne.mockResolvedValue({
        windows: [{ startMinutes: 9 * 60, endMinutes: 10 * 60 }],
      });
      clinicModel.findById.mockResolvedValue({
        _id: clinicId,
        timezone: TZ,
        settings: { appointments: { slotMinutesDefault: 20 } },
      });

      const out = await service.getDaySlots({
        clinicId,
        branchId,
        doctorUserId,
        date: '2026-05-01',
      });

      expect(out.slotMinutes).toBe(20);
      // 60 minutes / 20 → 3 slots.
      expect(out.slots).toHaveLength(3);
    });

    it('handles a window that ends at midnight local time without rolling over', async () => {
      overrideModel.findOne.mockResolvedValue(null);
      ruleModel.findOne.mockResolvedValue({
        windows: [{ startMinutes: 23 * 60, endMinutes: 24 * 60 }],
        slotMinutes: 30,
      });

      const out = await service.getDaySlots({
        clinicId,
        branchId,
        doctorUserId,
        date: '2026-05-01',
      });

      expect(out.slots).toHaveLength(2);
      expect(out.slots[0].startAt).toBe(utcIso('2026-05-01T23:00', TZ));
      expect(out.slots[1].endAt).toBe(utcIso('2026-05-02T00:00', TZ));
      expect(out.windows[0].endAt).toBe(utcIso('2026-05-02T00:00', TZ));
    });

    it('returns an empty slot list when no override and no weekly rule exists', async () => {
      overrideModel.findOne.mockResolvedValue(null);
      ruleModel.findOne.mockResolvedValue(null);

      const out = await service.getDaySlots({
        clinicId,
        branchId,
        doctorUserId,
        date: '2026-05-01',
      });

      expect(out.slots).toEqual([]);
      expect(out.windows).toEqual([]);
    });
  });

  describe('assertTimeSlotAllowed', () => {
    beforeEach(() => {
      overrideModel.findOne.mockResolvedValue(null);
      ruleModel.findOne.mockResolvedValue({
        windows: [{ startMinutes: 10 * 60, endMinutes: 11 * 60 }],
        slotMinutes: 30,
      });
    });

    it('accepts a request that starts on a slot boundary and fits inside the window', async () => {
      const startAt = new Date(utcIso('2026-05-01T10:00', TZ));
      const endAt = new Date(utcIso('2026-05-01T10:30', TZ));
      await expect(
        service.assertTimeSlotAllowed({
          clinicId,
          branchId,
          doctorUserId,
          startAt,
          endAt,
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects a request that does not align with any slot start', async () => {
      const startAt = new Date(utcIso('2026-05-01T10:15', TZ));
      const endAt = new Date(utcIso('2026-05-01T10:45', TZ));
      await expect(
        service.assertTimeSlotAllowed({
          clinicId,
          branchId,
          doctorUserId,
          startAt,
          endAt,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a request that runs past the end of the window', async () => {
      const startAt = new Date(utcIso('2026-05-01T10:30', TZ));
      const endAt = new Date(utcIso('2026-05-01T11:30', TZ));
      await expect(
        service.assertTimeSlotAllowed({
          clinicId,
          branchId,
          doctorUserId,
          startAt,
          endAt,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a request that crosses the local-day boundary', async () => {
      const startAt = new Date(utcIso('2026-05-01T23:30', TZ));
      const endAt = new Date(utcIso('2026-05-02T00:30', TZ));
      await expect(
        service.assertTimeSlotAllowed({
          clinicId,
          branchId,
          doctorUserId,
          startAt,
          endAt,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('assertCanWriteForDoctor (via replaceWeeklyRules)', () => {
    function mockBulkWriteOk() {
      ruleModel.bulkWrite.mockResolvedValue({ ok: 1 });
      ruleModel.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([]),
      });
    }

    it('throws ForbiddenException when no actor is provided', async () => {
      await expect(
        service.replaceWeeklyRules({
          clinicId,
          branchId,
          doctorUserId,
          rules: [{ weekday: 1, windows: [] }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a doctor to edit their own availability without checking permissions', async () => {
      mockBulkWriteOk();
      await expect(
        service.replaceWeeklyRules({
          clinicId,
          actorUserId: doctorUserId,
          branchId,
          doctorUserId,
          rules: [
            { weekday: 1, windows: [{ startMinutes: 540, endMinutes: 660 }] },
          ],
        }),
      ).resolves.toBeDefined();
      expect(authz.getActor).not.toHaveBeenCalled();
    });

    it('lets an admin (clinic:write) edit another doctor', async () => {
      authz.getActor.mockResolvedValue({ permissions: ['clinic:write'] });
      mockBulkWriteOk();
      await expect(
        service.replaceWeeklyRules({
          clinicId,
          actorUserId: adminUserId,
          branchId,
          doctorUserId,
          rules: [
            { weekday: 1, windows: [{ startMinutes: 540, endMinutes: 660 }] },
          ],
        }),
      ).resolves.toBeDefined();
      expect(authz.getActor).toHaveBeenCalledWith({
        clinicId,
        actorUserId: adminUserId,
      });
    });

    it('forbids a non-admin from editing another doctor', async () => {
      authz.getActor.mockResolvedValue({ permissions: ['patient:read'] });
      await expect(
        service.replaceWeeklyRules({
          clinicId,
          actorUserId: adminUserId,
          branchId,
          doctorUserId,
          rules: [{ weekday: 1, windows: [] }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects rules with duplicate weekdays', async () => {
      await expect(
        service.replaceWeeklyRules({
          clinicId,
          actorUserId: doctorUserId,
          branchId,
          doctorUserId,
          rules: [
            { weekday: 1, windows: [] },
            { weekday: 1, windows: [] },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects windows with start >= end', async () => {
      await expect(
        service.replaceWeeklyRules({
          clinicId,
          actorUserId: doctorUserId,
          branchId,
          doctorUserId,
          rules: [
            { weekday: 1, windows: [{ startMinutes: 600, endMinutes: 600 }] },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects windows that exceed 24h', async () => {
      await expect(
        service.replaceWeeklyRules({
          clinicId,
          actorUserId: doctorUserId,
          branchId,
          doctorUserId,
          rules: [
            {
              weekday: 1,
              windows: [{ startMinutes: 0, endMinutes: 24 * 60 + 1 }],
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
