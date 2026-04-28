import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { Public } from '../../common/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_SHARE } from '../../common/throttler.config';
import { StorageService } from '../storage/storage.service';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { DocumentsService } from './documents.service';
import { Types } from 'mongoose';

@Controller()
export class DocumentsController {
  constructor(
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
  ) {}

  @Post('documents/upload-url')
  @RequirePermissions(Permission.DocumentWrite)
  async createUploadUrl(@Req() req: AppRequest, @Body() dto: CreateUploadUrlDto) {
    const clinicId = req.context!.clinicId;
    const ownerId = new Types.ObjectId(dto.ownerId);
    const safeName = dto.fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const key = `clinic/${clinicId.toHexString()}/${dto.ownerType.toLowerCase()}/${ownerId.toHexString()}/${Date.now()}-${safeName}`;

    const uploadUrl = await this.storage.presignPut({ key, contentType: dto.mimeType });

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
  async share(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() body: { expiresInSeconds?: number; maxViews?: number },
  ) {
    const out = await this.documents.createShare({
      clinicId: req.context!.clinicId,
      documentId: id,
      expiresInSeconds: body.expiresInSeconds,
      maxViews: body.maxViews,
      createdBy: req.context!.actorUserId,
    });
    return { token: out.token, expiresAt: out.expiresAt, maxViews: out.maxViews };
  }

  @Post('documents/:id/share/revoke')
  @RequirePermissions(Permission.DocumentWrite)
  async revoke(@Req() req: AppRequest, @Param('id') id: string) {
    const out = await this.documents.revokeShare(req.context!.clinicId, id);
    return { revokedAt: out.revokedAt };
  }

  @Get('share/:token')
  @Public()
  @Throttle({ [THROTTLE_SHARE]: { limit: 10, ttl: 60_000 } })
  async shareDownload(@Param('token') token: string, @Query('inline') inline?: string) {
    const share = await this.documents.shareDownload(token);
    const doc = await this.documents.getById(share.clinicId, share.documentId.toHexString());
    const url = await this.storage.presignGet({ key: doc.storageKey });
    return { url, expiresInSeconds: 300, inline: inline === 'true' };
  }
}
