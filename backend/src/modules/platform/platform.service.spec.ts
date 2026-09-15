import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PlatformService } from './platform.service';
import { ClinicStatus } from '../tenancy/schemas/clinic.schema';

/**
 * The approval queue is the only cross-tenant surface in the API, so these
 * tests pin the behaviour that keeps it safe and correct: the legacy
 * no-status rows counting as active, and revoking sessions when access is
 * taken away.
 */
describe('PlatformService', () => {
  const actorId = new Types.ObjectId();

  const makeService = (overrides: {
    clinic?: Record<string, unknown>;
    aggregate?: unknown[];
  } = {}) => {
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 2 });
    const findByIdAndUpdate = jest.fn().mockImplementation(async () => {
      if (overrides.clinic === null) return null;
      return {
        _id: new Types.ObjectId(),
        name: 'Westside Clinic',
        status: ClinicStatus.Active,
        statusReason: null,
        statusChangedAt: new Date(),
        ...(overrides.clinic ?? {}),
      };
    });

    const clinicModel = {
      findByIdAndUpdate,
      aggregate: jest.fn().mockResolvedValue(overrides.aggregate ?? []),
      find: jest.fn(),
    } as unknown as ConstructorParameters<typeof PlatformService>[0];

    const branchModel = { aggregate: jest.fn().mockResolvedValue([]) } as never;
    const userModel = { aggregate: jest.fn().mockResolvedValue([]) } as never;
    const sessionModel = { updateMany } as never;

    const service = new PlatformService(clinicModel, branchModel, userModel, sessionModel);
    return { service, updateMany, findByIdAndUpdate };
  };

  describe('summary', () => {
    it('counts clinics with no status as active', async () => {
      const { service } = makeService({
        aggregate: [
          { _id: null, count: 3 },
          { _id: ClinicStatus.Pending, count: 2 },
        ],
      });

      const out = await service.summary();

      expect(out.counts[ClinicStatus.Active]).toBe(3);
      expect(out.counts[ClinicStatus.Pending]).toBe(2);
      expect(out.total).toBe(5);
    });
  });

  describe('approve', () => {
    it('clears any earlier rejection reason', async () => {
      const { service, findByIdAndUpdate } = makeService();

      await service.approve(new Types.ObjectId().toHexString(), actorId);

      const update = findByIdAndUpdate.mock.calls[0][1].$set;
      expect(update.status).toBe(ClinicStatus.Active);
      expect(update.statusReason).toBeNull();
      expect(update.statusChangedByUserId).toBe(actorId);
    });

    it('leaves live sessions alone', async () => {
      const { service, updateMany } = makeService();

      await service.approve(new Types.ObjectId().toHexString(), actorId);

      expect(updateMany).not.toHaveBeenCalled();
    });

    it('rejects a malformed clinic id before touching the database', async () => {
      const { service, findByIdAndUpdate } = makeService();

      await expect(service.approve('not-an-id', actorId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('404s when the clinic is gone', async () => {
      const { service } = makeService({ clinic: null as never });

      await expect(
        service.approve(new Types.ObjectId().toHexString(), actorId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('suspend', () => {
    it('records the reason and revokes live sessions', async () => {
      const { service, updateMany, findByIdAndUpdate } = makeService({
        clinic: { status: ClinicStatus.Suspended, statusReason: 'Non-payment' },
      });

      await service.suspend(new Types.ObjectId().toHexString(), actorId, 'Non-payment');

      expect(findByIdAndUpdate.mock.calls[0][1].$set.statusReason).toBe('Non-payment');
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: null }),
        { $set: { revokedAt: expect.any(Date) } },
      );
    });
  });

  describe('reject', () => {
    it('revokes live sessions too', async () => {
      const { service, updateMany } = makeService({
        clinic: { status: ClinicStatus.Rejected },
      });

      await service.reject(new Types.ObjectId().toHexString(), actorId, 'Duplicate signup');

      expect(updateMany).toHaveBeenCalled();
    });
  });
});
