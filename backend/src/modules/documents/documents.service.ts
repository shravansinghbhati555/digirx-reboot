import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, QueryFilter } from 'mongoose';
import { randomBytes } from 'crypto';
import { RetentionService } from '../../common/retention/retention.service';
import {
  Document,
  DocumentAccess,
  DocumentCategory,
  DocumentOwnerType,
  DocumentStatus,
} from './schemas/document.schema';
import { DocumentShare } from './schemas/document-share.schema';
import { StorageService } from '../storage/storage.service';
import {
  DocumentAccessAction,
  DocumentAccessLog,
} from './schemas/document-access-log.schema';

const DEFAULT_SHARE_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

export type AccessTrace = {
  actorUserId?: Types.ObjectId;
  ip?: string;
  userAgent?: string;
};

@Injectable()
export class DocumentsService {
  constructor(
    @InjectModel(Document.name) private readonly docModel: Model<Document>,
    @InjectModel(DocumentShare.name)
    private readonly shareModel: Model<DocumentShare>,
    private readonly storageService: StorageService,
    @InjectModel(DocumentAccessLog.name)
    private readonly accessLogModel: Model<DocumentAccessLog>,
    private readonly retention: RetentionService,
  ) { }

  async createForOwner(input: {
    clinicId: Types.ObjectId;
    ownerType: DocumentOwnerType;
    ownerId: Types.ObjectId;
    category?: DocumentCategory;
    ownerName?: string;
    mimeType: string;
    fileName: string;
    sizeBytes: number;
    storageKey: string;
    access?: DocumentAccess;
    createdBy?: Types.ObjectId;
  }) {
    return await this.docModel.create({
      ...input,
      access: input.access ?? DocumentAccess.InternalOnly,
      status: DocumentStatus.Uploading,
    });
  }

  async confirmUpload(clinicId: Types.ObjectId, id: string) {
    const doc = await this.docModel.findOneAndUpdate(
      { _id: id, clinicId },
      { $set: { status: DocumentStatus.Available } },
      { new: true }
    ).exec();
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async listDocuments(
    clinicId: Types.ObjectId,
    filters?: { ownerType?: DocumentOwnerType; ownerId?: string; query?: string },
  ) {
    const query: QueryFilter<Document> = {
      clinicId,
      status: DocumentStatus.Available,
      deletedAt: null,
    };
    if (filters?.ownerType) query.ownerType = filters.ownerType;
    if (filters?.ownerId) query.ownerId = new Types.ObjectId(filters.ownerId);

    if (filters?.query) {
      const regex = { $regex: filters.query, $options: 'i' };
      query.$or = [{ fileName: regex }, { ownerName: regex }];
    }

    return await this.docModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();
  }

  async deleteDocument(clinicId: Types.ObjectId, id: string) {
    const doc = await this.docModel.findOne({ _id: id, clinicId }).exec();
    if (!doc) throw new NotFoundException('Document not found');

    // Delete from storage first
    try {
      await this.storageService.deleteObject({ key: doc.storageKey });
    } catch (e) {
      console.error(`Failed to delete object from storage: ${doc.storageKey}`, e);
    }

    // Delete from DB
    await this.docModel.deleteOne({ _id: doc._id }).exec();
    return { success: true };
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Document not found');
    }
    const doc = await this.docModel
      .findOne({ _id: id, clinicId, deletedAt: null })
      .exec();
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  /**
   * Soft-delete: stamps `deletedAt` + `deletedBy`, leaves the row in place
   * so audit / access-log / billing references that hold the documentId
   * still resolve (with the doc marked deleted). Idempotent — calling it
   * on an already-deleted doc returns 404 just like a missing doc.
   *
   * Active share tokens are revoked at the same time so a public link
   * doesn't keep working after the operator deletes the underlying file.
   */
  async softDelete(
    clinicId: Types.ObjectId,
    id: string,
    actorUserId?: Types.ObjectId,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Document not found');
    }
    const updated = await this.docModel.findOneAndUpdate(
      { _id: id, clinicId, deletedAt: null },
      { $set: { deletedAt: new Date(), deletedBy: actorUserId } },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Document not found');

    // Revoke any active public shares so the link stops working immediately.
    await this.shareModel.updateMany(
      {
        clinicId,
        documentId: updated._id,
        revokedAt: null,
      },
      { $set: { revokedAt: new Date() } },
    );

    return { ok: true as const, deletedAt: updated.deletedAt };
  }

  async createShare(input: {
    clinicId: Types.ObjectId;
    documentId: string;
    expiresInSeconds?: number;
    maxViews?: number;
    createdBy?: Types.ObjectId;
    trace?: AccessTrace;
  }) {
    const doc = await this.docModel
      .findOne({
        _id: input.documentId,
        clinicId: input.clinicId,
        deletedAt: null,
      })
      .exec();
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.access === DocumentAccess.InternalOnly) {
      throw new BadRequestException(
        'INTERNAL_ONLY documents cannot be shared',
      );
    }

    const token = randomBytes(24).toString('hex');
    const seconds =
      input.expiresInSeconds && input.expiresInSeconds > 0
        ? input.expiresInSeconds
        : DEFAULT_SHARE_EXPIRY_SECONDS;
    const expiresAt = new Date(Date.now() + seconds * 1000);

    const share = await this.shareModel.create({
      clinicId: input.clinicId,
      documentId: doc._id,
      token,
      expiresAt,
      maxViews: input.maxViews,
      viewCount: 0,
      createdBy: input.createdBy,
    });

    void this.recordAccess(input.clinicId, doc._id, {
      action: DocumentAccessAction.ShareCreate,
      actorUserId: input.createdBy,
      shareTokenSuffix: tail(token),
      ip: input.trace?.ip,
      userAgent: input.trace?.userAgent,
    });

    return { _id: share._id, token, expiresAt, maxViews: input.maxViews };
  }

  /**
   * Atomically validate + increment viewCount. Returns the share doc on success.
   * Throws NotFoundException for invalid / revoked / expired tokens.
   * Throws GoneException when maxViews is set and already reached.
   */
  async shareDownload(token: string, trace?: AccessTrace) {
    const now = new Date();

    const share = await this.shareModel.findOneAndUpdate(
      {
        token,
        revokedAt: null,
        $and: [
          {
            $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
          },
          {
            $or: [
              { maxViews: { $exists: false } },
              { maxViews: null },
              {
                $expr: {
                  $lt: [{ $ifNull: ['$viewCount', 0] }, '$maxViews'],
                },
              },
            ],
          },
        ],
      },
      { $inc: { viewCount: 1 } },
      { new: true },
    );

    if (share) {
      // Defence-in-depth: if the underlying Document was soft-deleted after
      // the share was created (and before our revoke ran for some race-y
      // reason), block the download.
      const live = await this.docModel.exists({
        _id: share.documentId,
        clinicId: share.clinicId,
        deletedAt: null,
      });
      if (!live) throw new NotFoundException('Invalid token');

      void this.recordAccess(share.clinicId, share.documentId, {
        action: DocumentAccessAction.ShareView,
        shareTokenSuffix: tail(token),
        ip: trace?.ip,
        userAgent: trace?.userAgent,
      });
      return share;
    }

    // Disambiguate between 404 and 410.
    const raw = await this.shareModel.findOne({ token }).exec();
    if (!raw) throw new NotFoundException('Invalid token');
    if (raw.revokedAt) throw new NotFoundException('Invalid token');
    if (raw.expiresAt && raw.expiresAt.getTime() <= now.getTime()) {
      throw new NotFoundException('Invalid token');
    }
    if (raw.maxViews != null && (raw.viewCount ?? 0) >= raw.maxViews) {
      throw new GoneException('Share view limit exceeded');
    }
    // Unreachable in normal operation; treat as 404.
    throw new NotFoundException('Invalid token');
  }

  async revokeShare(
    clinicId: Types.ObjectId,
    documentId: string,
    trace?: AccessTrace,
  ) {
    const share = await this.shareModel.findOneAndUpdate(
      {
        clinicId,
        documentId: new Types.ObjectId(documentId),
        revokedAt: null,
      },
      { $set: { revokedAt: new Date() } },
      { new: true },
    );
    if (!share) throw new NotFoundException('Active share not found');

    void this.recordAccess(clinicId, share.documentId, {
      action: DocumentAccessAction.ShareRevoke,
      actorUserId: trace?.actorUserId,
      shareTokenSuffix: share.token ? tail(share.token) : undefined,
      ip: trace?.ip,
      userAgent: trace?.userAgent,
    });

    return share;
  }

  /**
   * Records a download against the per-document trail. Called from the
   * `/documents/:id/download` controller after the presigned URL is minted
   * — failure to log must not break the download itself, so the call is
   * fire-and-forget at the controller layer.
   */
  async recordDownload(
    clinicId: Types.ObjectId,
    documentId: Types.ObjectId,
    trace: AccessTrace,
  ) {
    return await this.recordAccess(clinicId, documentId, {
      action: DocumentAccessAction.Download,
      actorUserId: trace.actorUserId,
      ip: trace.ip,
      userAgent: trace.userAgent,
    });
  }

  /** List the per-document audit rows for a single document. */
  async listAccessLog(
    clinicId: Types.ObjectId,
    documentId: string,
    opts: { limit?: number; before?: string } = {},
  ) {
    if (!Types.ObjectId.isValid(documentId)) {
      throw new NotFoundException('Document not found');
    }
    const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
    const filter: Record<string, unknown> = {
      clinicId,
      documentId: new Types.ObjectId(documentId),
    };
    if (opts.before) {
      const d = new Date(opts.before);
      if (!isNaN(d.getTime())) filter.createdAt = { $lt: d };
    }
    const rows = await this.accessLogModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit);
    const last = rows.length ? rows[rows.length - 1] : undefined;
    const nextBefore =
      last && (last as any).createdAt instanceof Date
        ? ((last as any).createdAt as Date).toISOString()
        : undefined;
    return { rows, nextBefore };
  }

  // --- internal -----------------------------------------------------------

  private async recordAccess(
    clinicId: Types.ObjectId,
    documentId: Types.ObjectId,
    payload: {
      action: DocumentAccessAction;
      actorUserId?: Types.ObjectId;
      shareTokenSuffix?: string;
      ip?: string;
      userAgent?: string;
    },
  ) {
    try {
      const expiresAt = await this.retention.expiresAt(clinicId);
      await this.accessLogModel.create({
        clinicId,
        documentId,
        ...payload,
        expiresAt,
      });
    } catch {
      // Never let audit failure surface to the caller. The retention cache
      // shields the hot path from clinic-lookup blips; if even that fails,
      // we silently drop the row rather than 500 a download.
    }
  }
}

function tail(token: string): string {
  return token.length > 8 ? token.slice(-8) : token;
}
