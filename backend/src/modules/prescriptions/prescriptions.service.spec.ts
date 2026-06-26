import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PrescriptionsService } from './prescriptions.service';

describe('PrescriptionsService share flow', () => {
  let rxModel: any;
  let encounters: any;
  let service: PrescriptionsService;

  beforeEach(() => {
    rxModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    encounters = { getById: jest.fn() };
    // Constructor expanded with patient/user/clinic models, the medicines
    // catalog assertion service, notifications, and the prescription
    // numbering service for the human-readable `RX-000123` numbers.
    // None are exercised by the share-flow tests, so empty stubs are
    // sufficient — `numbering.mint` returns a fixed value when called.
    const patientModel: any = {};
    const userModel: any = {};
    const clinicModel: any = {};
    const medicines: any = { assertExists: jest.fn() };
    const notifications: any = {};
    const numbering: any = { mint: jest.fn().mockResolvedValue('RX-000001') };
    service = new (PrescriptionsService as any)(
      rxModel,
      patientModel,
      userModel,
      clinicModel,
      encounters,
      medicines,
      notifications,
      numbering,
    );
  });

  function makeRx(overrides: any = {}) {
    return {
      _id: new Types.ObjectId(),
      clinicId: new Types.ObjectId(),
      shareToken: undefined as string | undefined,
      shareTokenExpiresAt: undefined as Date | undefined,
      shareTokenRevokedAt: undefined as Date | undefined,
      save: jest.fn().mockImplementation(async function (this: any) {
        return this;
      }),
      ...overrides,
    };
  }

  describe('share', () => {
    it('sets a token and a default 7-day expiry on first share', async () => {
      const rx = makeRx();
      rxModel.findOne.mockReturnValue({ exec: async () => rx });

      const out = await service.share(rx.clinicId, rx._id.toHexString());
      expect(out.shareToken).toMatch(/^[a-f0-9]{48}$/);
      expect(rx.shareToken).toBe(out.shareToken);
      expect(rx.shareTokenExpiresAt).toBeInstanceOf(Date);
      expect(rx.shareTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600_000);
      expect(rx.shareTokenExpiresAt!.getTime()).toBeLessThan(Date.now() + 8 * 24 * 3600_000);
      expect(rx.save).toHaveBeenCalled();
    });

    it('reissues token and extends expiry on subsequent share calls', async () => {
      const oldExpiry = new Date(Date.now() + 100_000);
      const rx = makeRx({ shareToken: 'old', shareTokenExpiresAt: oldExpiry });
      rxModel.findOne.mockReturnValue({ exec: async () => rx });

      const out = await service.share(rx.clinicId, rx._id.toHexString());
      expect(out.shareToken).not.toBe('old');
      expect(rx.shareTokenExpiresAt!.getTime()).toBeGreaterThan(oldExpiry.getTime());
      expect(rx.shareTokenRevokedAt).toBeUndefined();
    });
  });

  describe('getByShareToken', () => {
    it('returns the prescription for a valid, unexpired, non-revoked token', async () => {
      const rx = makeRx({
        shareToken: 'good',
        shareTokenExpiresAt: new Date(Date.now() + 3600_000),
      });
      rxModel.findOne.mockReturnValue({ exec: async () => rx });

      const got = await service.getByShareToken('good');
      expect(got).toBe(rx);
    });

    it('throws NotFoundException for an unknown token', async () => {
      rxModel.findOne.mockReturnValue({ exec: async () => null });
      await expect(service.getByShareToken('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for an expired token', async () => {
      const rx = makeRx({
        shareToken: 'exp',
        shareTokenExpiresAt: new Date(Date.now() - 1000),
      });
      rxModel.findOne.mockReturnValue({ exec: async () => rx });

      await expect(service.getByShareToken('exp')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for a revoked token', async () => {
      const rx = makeRx({
        shareToken: 'rev',
        shareTokenExpiresAt: new Date(Date.now() + 3600_000),
        shareTokenRevokedAt: new Date(Date.now() - 500),
      });
      rxModel.findOne.mockReturnValue({ exec: async () => rx });

      await expect(service.getByShareToken('rev')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('revokeShare', () => {
    it('sets shareTokenRevokedAt and returns the prescription', async () => {
      const clinicId = new Types.ObjectId();
      const rxId = new Types.ObjectId();
      const rx = {
        _id: rxId,
        clinicId,
        shareToken: 't',
        shareTokenRevokedAt: new Date(),
      };
      rxModel.findOneAndUpdate.mockResolvedValue(rx);

      const out = await service.revokeShare(clinicId, rxId.toHexString());
      expect(out).toBe(rx);
      expect(rxModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: rxId.toHexString(), clinicId, shareToken: { $ne: null }, shareTokenRevokedAt: null },
        expect.objectContaining({ $set: expect.objectContaining({ shareTokenRevokedAt: expect.any(Date) }) }),
        { new: true },
      );
    });

    it('throws NotFoundException when prescription has no active share', async () => {
      const clinicId = new Types.ObjectId();
      const rxId = new Types.ObjectId();
      rxModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(service.revokeShare(clinicId, rxId.toHexString()))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
