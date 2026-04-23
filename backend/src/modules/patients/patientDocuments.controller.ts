import { Controller, Param, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { DocumentsService } from '../documents/documents.service';
import { DocumentOwnerType } from '../documents/schemas/document.schema';
import { PatientsService } from './patients.service';

@Controller('patients/:id/documents')
export class PatientDocumentsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly documents: DocumentsService,
  ) {}

  @Post()
  @RequirePermissions(Permission.DocumentWrite)
  @UseInterceptors(FileInterceptor('file'))
  async upload(@Req() req: AppRequest, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    const clinicId = req.context!.clinicId;
    await this.patients.getById(clinicId, id);

    if (!file) {
      throw new Error('file is required');
    }

    // Storage integration (S3/MinIO) comes next; for now we generate a deterministic key
    // and store metadata. The actual bytes are not persisted yet.
    const storageKey = `clinic/${clinicId.toHexString()}/patient/${id}/${randomUUID()}-${file.originalname}`;

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

