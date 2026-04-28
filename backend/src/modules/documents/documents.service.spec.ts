import { GoneException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentsService } from './documents.service';

describe('DocumentsService share flow', () => {
  let docModel: any;
  let shareModel: any;
  let service: DocumentsService;

  beforeEach(() => {
    docModel = {
      create: jest.fn(),
      findOne: jest.fn(),
    };
    shareModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    service = new DocumentsService(docModel, shareModel);
  });

  describe('createShare', () => {
    it('creates a share with default 7-day expiry when none provided', async () => {
      const doc = {
        _id: new Types.ObjectId(),
        clinicId: new Types.ObjectId(),
        storageKey: 'k',
      };
      docModel.findOne.mockReturnValue({ exec: async () => doc });
      shareModel.create.mockImplementation(async (input: any) => ({
        ...input,
        _id: new Types.ObjectId(),
      }));

      const result = await service.createShare({
        clinicId: doc.clinicId,
        documentId: doc._id.toHexString(),
        createdBy: new Types.ObjectId(),
      });

      expect(result.token).toMatch(/^[a-f0-9]{48}$/);
      expect(result.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 6 * 24 * 3600_000,
      );
      expect(result.expiresAt.getTime()).toBeLessThan(
        Date.now() + 8 * 24 * 3600_000,
      );
    });

    it('respects a custom expiresInSeconds', async () => {
      const doc = {
        _id: new Types.ObjectId(),
        clinicId: new Types.ObjectId(),
        storageKey: 'k',
      };
      docModel.findOne.mockReturnValue({ exec: async () => doc });
      shareModel.create.mockImplementation(async (input: any) => ({
        ...input,
        _id: new Types.ObjectId(),
      }));

      const result = await service.createShare({
        clinicId: doc.clinicId,
        documentId: doc._id.toHexString(),
        expiresInSeconds: 3600,
      });

      expect(result.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 3500_000,
      );
      expect(result.expiresAt.getTime()).toBeLessThan(
        Date.now() + 3700_000,
      );
    });
  });

  describe('shareDownload', () => {
    it('returns the share when atomic guard matches', async () => {
      const share = {
        _id: new Types.ObjectId(),
        clinicId: new Types.ObjectId(),
        documentId: new Types.ObjectId(),
        token: 'good',
        viewCount: 1,
      };
      shareModel.findOneAndUpdate.mockResolvedValue(share);

      const got = await service.shareDownload('good');
      expect(got).toBe(share);
      expect(shareModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(shareModel.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown token', async () => {
      shareModel.findOneAndUpdate.mockResolvedValue(null);
      shareModel.findOne.mockReturnValue({ exec: async () => null });

      await expect(service.shareDownload('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException for a revoked token', async () => {
      shareModel.findOneAndUpdate.mockResolvedValue(null);
      shareModel.findOne.mockReturnValue({
        exec: async () => ({ token: 't', revokedAt: new Date(), viewCount: 0 }),
      });

      await expect(service.shareDownload('t')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException for an expired token', async () => {
      shareModel.findOneAndUpdate.mockResolvedValue(null);
      shareModel.findOne.mockReturnValue({
        exec: async () => ({
          token: 't',
          expiresAt: new Date(Date.now() - 1000),
          viewCount: 0,
        }),
      });

      await expect(service.shareDownload('t')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws GoneException when maxViews exceeded', async () => {
      shareModel.findOneAndUpdate.mockResolvedValue(null);
      shareModel.findOne.mockReturnValue({
        exec: async () => ({ token: 't', maxViews: 2, viewCount: 2 }),
      });

      await expect(service.shareDownload('t')).rejects.toBeInstanceOf(
        GoneException,
      );
    });
  });

  describe('revokeShare', () => {
    it('sets revokedAt atomically when the share exists and is not revoked', async () => {
      const clinicId = new Types.ObjectId();
      const documentId = new Types.ObjectId();
      const share = {
        _id: new Types.ObjectId(),
        clinicId,
        documentId,
        revokedAt: new Date(),
      };
      shareModel.findOneAndUpdate.mockResolvedValue(share);

      const result = await service.revokeShare(
        clinicId,
        documentId.toHexString(),
      );
      expect(result).toBe(share);
      expect(shareModel.findOneAndUpdate).toHaveBeenCalledWith(
        { clinicId, documentId, revokedAt: null },
        expect.objectContaining({
          $set: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
        { new: true },
      );
    });

    it('throws NotFoundException when no active share exists', async () => {
      const clinicId = new Types.ObjectId();
      const documentId = new Types.ObjectId();
      shareModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(
        service.revokeShare(clinicId, documentId.toHexString()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
