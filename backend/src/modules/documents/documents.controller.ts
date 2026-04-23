import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { Public } from '../../common/public.decorator';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { StorageService } from '../storage/storage.service';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { DocumentsService } from './documents.service';
import { randomBytes } from 'crypto';
import { Types } from 'mongoose';
import { DocumentShare } from './schemas/document-share.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Controller()
export class DocumentsController {
  constructor(
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
    @InjectModel(DocumentShare.name) private readonly shareModel: Model<DocumentShare>,
  ) {}

  @Post('documents/upload-url')
  @RequirePermissions(Permission.DocumentWrite)
  async createUploadUrl(@Req() req: AppRequest, @Body() dto: CreateUploadUrlDto) {
    const clinicId = req.context!.clinicId;
    const ownerId = new Types.ObjectId(dto.ownerId);
    const safeName = dto.fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const key = `clinic/${clinicId.toHexString()}/${dto.ownerType.toLowerCase()}/${ownerId.toHexString()}/${Date.now()}-${safeName}`;

    const uploadUrl = await this.storage.presignPut({ key, contentType: dto.mimeType });

    // Create doc record immediately; client uploads bytes using uploadUrl.
    const doc = await this.documents.createForOwner({
      clinicId,
      ownerType: dto.ownerType,
      ownerId,
      mimeType: dto.mimeType,
      fileName: dto.fileName,
      sizeBytes: dto.sizeBytes,
      storageKey: key,
      access: dto.access,
      createdBy: req.context!.actorUserId,
    });

    return { documentId: doc._id, storageKey: key, uploadUrl, expiresInSeconds: 300 };
  }

  @Get('documents/:id/download')
  @RequirePermissions(Permission.DocumentRead)
  async download(@Req() req: AppRequest, @Param('id') id: string) {
    const doc = await this.documents.getById(req.context!.clinicId, id);
    const url = await this.storage.presignGet({ key: doc.storageKey });
    return { url, expiresInSeconds: 300 };
  }

  @Post('documents/:id/share')
  @RequirePermissions(Permission.DocumentWrite)
  async share(@Req() req: AppRequest, @Param('id') id: string, @Body() body: { expiresInSeconds?: number }) {
    const doc = await this.documents.getById(req.context!.clinicId, id);

    const token = randomBytes(24).toString('hex');
    const expiresAt =
      body.expiresInSeconds && body.expiresInSeconds > 0
        ? new Date(Date.now() + body.expiresInSeconds * 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.shareModel.create({
      clinicId: doc.clinicId,
      documentId: doc._id,
      token,
      expiresAt,
      createdBy: req.context!.actorUserId,
    });

    return { token, expiresAt };
  }

  @Get('share/:token')
  @Public()
  async shareDownload(@Param('token') token: string, @Query('inline') inline?: string) {
    const share = await this.shareModel.findOne({ token, revokedAt: { $exists: false } });
    if (!share) return { message: 'Invalid token' };
    if (share.expiresAt && share.expiresAt.getTime() < Date.now()) return { message: 'Expired' };

    // For share links, return a short-lived signed download URL.
    // RBAC is bypassed intentionally; token is the authorization.
    const doc = await this.documents.getById(share.clinicId, share.documentId.toHexString());
    const url = await this.storage.presignGet({ key: doc.storageKey });
    return { url, expiresInSeconds: 300, inline: inline === 'true' };
  }
}

