import {
  BadRequestException,
  Controller,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { DocumentsService } from '../documents/documents.service';
import { DocumentOwnerType } from '../documents/schemas/document.schema';
import { StorageService } from '../storage/storage.service';
import { PatientsService } from './patients.service';

@Controller('patients/:id/documents')
export class PatientDocumentsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly documents: DocumentsService,
    private readonly storage: StorageService,
  ) {}

  @Post()
  @RequirePermissions(Permission.DocumentWrite)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const clinicId = req.context!.clinicId;
    await this.patients.getById(clinicId, id);

    if (!file) {
      throw new BadRequestException('file is required');
    }

    const safeName = file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const storageKey = `clinic/${clinicId.toHexString()}/patient/${id}/${randomUUID()}-${safeName}`;

    await this.storage.putObject({
      key: storageKey,
      body: file.buffer,
      contentType: file.mimetype,
    });

    return await this.documents.createForOwner({
      clinicId,
      ownerType: DocumentOwnerType.Patient,
      ownerId: new Types.ObjectId(id),
      mimeType: file.mimetype,
      fileName: file.originalname,
      sizeBytes: file.size,
      storageKey,
      createdBy: req.context!.actorUserId,
    });
  }
}
