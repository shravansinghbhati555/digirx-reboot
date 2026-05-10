import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { Public } from '../../common/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { StorageService } from '../storage/storage.service';
import { CreateShareDto } from './dto/create-share.dto';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { DocumentsService } from './documents.service';
import { Types } from 'mongoose';
import { DocumentOwnerType } from './schemas/document.schema';

@Controller()
export class DocumentsController {
  constructor(
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
  ) { }

  @Get('documents')
  @RequirePermissions(Permission.DocumentRead)
  async listDocuments(
    @Req() req: AppRequest,
    @Query('ownerType') ownerType?: DocumentOwnerType,
    @Query('ownerId') ownerId?: string,
    @Query('query') query?: string,
  ) {
    const docs = await this.documents.listDocuments(req.context!.clinicId, {
      ownerType,
      ownerId,
      query,
    });
    return docs;
  }

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
      category: dto.category,
      ownerName: dto.ownerName,
      mimeType: dto.mimeType,
      fileName: dto.fileName,
      sizeBytes: dto.sizeBytes,
      storageKey: key,
      access: dto.access,
      createdBy: req.context!.actorUserId,
    });

    return { documentId: doc._id, storageKey: key, uploadUrl, expiresInSeconds: 300 };
  }

  @Post('documents/:id/confirm')
  @RequirePermissions(Permission.DocumentWrite)
  async confirmUpload(@Req() req: AppRequest, @Param('id') id: string) {
    const doc = await this.documents.confirmUpload(req.context!.clinicId, id);
    return { success: true, documentId: doc._id };
  }


  @Get('documents/:id/download')
  @RequirePermissions(Permission.DocumentRead)
  async download(@Req() req: AppRequest, @Param('id') id: string) {
    const doc = await this.documents.getById(req.context!.clinicId, id);
    const url = await this.storage.presignGet({ key: doc.storageKey });
    // Fire-and-forget per-document audit so a logging blip can't sink the
    // download. Trace fields are best-effort — `req.ip` requires `trust
    // proxy` in production for accurate values.
    void this.documents.recordDownload(req.context!.clinicId, doc._id, {
      actorUserId: req.context!.actorUserId,
      ip: req.ip,
      userAgent: req.header('user-agent') ?? undefined,
    });
    return { url, expiresInSeconds: 300 };
  }

  @Post('documents/:id/share')
  @RequirePermissions(Permission.DocumentWrite)
  async share(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() body: CreateShareDto,
  ) {
    const out = await this.documents.createShare({
      clinicId: req.context!.clinicId,
      documentId: id,
      expiresInSeconds: body.expiresInSeconds,
      maxViews: body.maxViews,
      createdBy: req.context!.actorUserId,
      trace: {
        actorUserId: req.context!.actorUserId,
        ip: req.ip,
        userAgent: req.header('user-agent') ?? undefined,
      },
    });
    return { token: out.token, expiresAt: out.expiresAt, maxViews: out.maxViews };
  }

  @Post('documents/:id/share/revoke')
  @RequirePermissions(Permission.DocumentWrite)
  async revoke(@Req() req: AppRequest, @Param('id') id: string) {
    const out = await this.documents.revokeShare(req.context!.clinicId, id, {
      actorUserId: req.context!.actorUserId,
      ip: req.ip,
      userAgent: req.header('user-agent') ?? undefined,
    });
    return { revokedAt: out.revokedAt };
  }

  @Delete('documents/:id')
  @RequirePermissions(Permission.DocumentWrite)
  async softDelete(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.documents.softDelete(
      req.context!.clinicId,
      id,
      req.context!.actorUserId,
    );
  }

  /**
   * Per-document audit trail. Same permission gate as download — anyone
   * who can read the doc can see who else has touched it.
   */
  @Get('documents/:id/access-log')
  @RequirePermissions(Permission.DocumentRead)
  async accessLog(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Query('limit') limitRaw?: string,
    @Query('before') before?: string,
  ) {
    const limit = Number(limitRaw ?? 50) || 50;
    return await this.documents.listAccessLog(req.context!.clinicId, id, {
      limit,
      before,
    });
  }

  @Get('share/:token')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async shareDownload(
    @Req() req: AppRequest,
    @Param('token') token: string,
    @Query('inline') inline?: string,
  ) {
    const share = await this.documents.shareDownload(token, {
      ip: req.ip,
      userAgent: req.header('user-agent') ?? undefined,
    });
    const doc = await this.documents.getById(share.clinicId, share.documentId.toHexString());
    const url = await this.storage.presignGet({ key: doc.storageKey });
    return { url, expiresInSeconds: 300, inline: inline === 'true' };
  }
}
