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
    /** The row as it stood before approve() updated it. */
    before?: Record<string, unknown> | null;
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

    // Every status change reads the row first: to refuse the platform's own
    // workspace, and to tell a real activation from a repeat click.
    const before =
      overrides.before === undefined
        ? {
            status: ClinicStatus.Pending,
            requestedByName: 'Dr. Laura Bennett',
            requestedByEmail: 'laura@westside.example',
          }
        : overrides.before;
    const findById = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(before) }),
    });

    const aggregate = jest.fn().mockResolvedValue(overrides.aggregate ?? []);
    const find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      }),
    });

    const clinicModel = {
      findByIdAndUpdate,
      findById,
      aggregate,
      find,
    } as unknown as ConstructorParameters<typeof PlatformService>[0];

    const branchModel = { aggregate: jest.fn().mockResolvedValue([]) } as never;
    const userModel = { aggregate: jest.fn().mockResolvedValue([]) } as never;
    const sessionModel = { updateMany } as never;
    const sendClinicActivatedEmail = jest.fn().mockResolvedValue(true);

    const service = new PlatformService(clinicModel, branchModel, userModel, sessionModel, {
      sendClinicActivatedEmail,
    } as never);
    return {
      service,
      updateMany,
      findByIdAndUpdate,
      sendClinicActivatedEmail,
      aggregate,
      find,
    };
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

    it('emails the applicant that their clinic is live', async () => {
      const { service, sendClinicActivatedEmail } = makeService();

      await service.approve(new Types.ObjectId().toHexString(), actorId);

      expect(sendClinicActivatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicName: 'Westside Clinic',
          adminEmail: 'laura@westside.example',
          adminName: 'Dr. Laura Bennett',
        }),
      );
    });

    it('does not re-send the activation mail when the clinic is already active', async () => {
      const { service, sendClinicActivatedEmail } = makeService({
        before: { status: ClinicStatus.Active, requestedByEmail: 'laura@westside.example' },
      });

      await service.approve(new Types.ObjectId().toHexString(), actorId);

      expect(sendClinicActivatedEmail).not.toHaveBeenCalled();
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

  /**
   * The DigiRx workspace lives in `clinics` because platform admins need a
   * clinic to belong to, but it is not a tenant. It was showing up in the
   * queue, where one click suspended the workspace its own admins sign in
   * through — locking them out of the console that could undo it.
   */
  describe('the platform workspace', () => {
    const platformRow = {
      status: ClinicStatus.Active,
      isPlatformClinic: true,
    };

    it('is left out of the queue listing', async () => {
      const { service, find } = makeService();

      await service.list({});

      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({ isPlatformClinic: { $ne: true } }),
      );
    });

    it('is left out of the tab counts', async () => {
      const { service, aggregate } = makeService();

      await service.summary();

      expect(aggregate.mock.calls[0][0][0]).toEqual({
        $match: { isPlatformClinic: { $ne: true } },
      });
    });

    it.each([
      ['suspend', (s: PlatformService, id: string) => s.suspend(id, actorId, 'oops')],
      ['reject', (s: PlatformService, id: string) => s.reject(id, actorId, 'oops')],
      ['approve', (s: PlatformService, id: string) => s.approve(id, actorId)],
    ])('refuses %s, even if the request reaches the API', async (_name, call) => {
      const { service, findByIdAndUpdate } = makeService({ before: platformRow });

      await expect(call(service, new Types.ObjectId().toHexString())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(findByIdAndUpdate).not.toHaveBeenCalled();
    });
  });
});
