import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import {
  Document,
  DocumentAccess,
  DocumentOwnerType,
} from './schemas/document.schema';
import { DocumentShare } from './schemas/document-share.schema';

const DEFAULT_SHARE_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class DocumentsService {
  constructor(
    @InjectModel(Document.name) private readonly docModel: Model<Document>,
    @InjectModel(DocumentShare.name)
    private readonly shareModel: Model<DocumentShare>,
  ) {}

  async createForOwner(input: {
    clinicId: Types.ObjectId;
    ownerType: DocumentOwnerType;
    ownerId: Types.ObjectId;
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
    });
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    const doc = await this.docModel.findOne({ _id: id, clinicId }).exec();
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async createShare(input: {
    clinicId: Types.ObjectId;
    documentId: string;
    expiresInSeconds?: number;
    maxViews?: number;
    createdBy?: Types.ObjectId;
  }) {
    const doc = await this.docModel
      .findOne({ _id: input.documentId, clinicId: input.clinicId })
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

    return { _id: share._id, token, expiresAt, maxViews: input.maxViews };
  }

  /**
   * Atomically validate + increment viewCount. Returns the share doc on success.
   * Throws NotFoundException for invalid / revoked / expired tokens.
   * Throws GoneException when maxViews is set and already reached.
   */
  async shareDownload(token: string) {
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

    if (share) return share;

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

  async revokeShare(clinicId: Types.ObjectId, documentId: string) {
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
    return share;
  }
}
