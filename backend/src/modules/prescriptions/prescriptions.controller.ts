import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AppRequest } from '../../common/types';
import { Public } from '../../common/public.decorator';
import { THROTTLE_SHARE } from '../../common/throttler.config';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { PrescriptionsService } from './prescriptions.service';
import { PdfService } from '../pdf/pdf.service';
import { StorageService } from '../storage/storage.service';
import { DocumentsService } from '../documents/documents.service';
import { DocumentOwnerType } from '../documents/schemas/document.schema';

@Controller()
export class PrescriptionsController {
  constructor(
    private readonly prescriptions: PrescriptionsService,
    private readonly pdfService: PdfService,
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
  ) {}

  @Post('encounters/:id/prescriptions')
  @RequirePermissions(Permission.PatientWrite)
  async createForEncounter(
    @Req() req: AppRequest,
    @Param('id') encounterId: string,
    @Body() dto: CreatePrescriptionDto,
  ) {
    return await this.prescriptions.createForEncounter(
      req.context!.clinicId,
      encounterId,
      dto,
    );
  }

  @Get('prescriptions/:id')
  @RequirePermissions(Permission.PatientRead)
  async get(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.prescriptions.getById(req.context!.clinicId, id);
  }

  @Post('prescriptions/:id/share')
  @RequirePermissions(Permission.PatientRead)
  async share(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.prescriptions.share(req.context!.clinicId, id);
  }

  @Get('share/prescriptions/:token')
  @Public()
  @Throttle({ [THROTTLE_SHARE]: { limit: 10, ttl: 60_000 } })
  async getShared(@Param('token') token: string) {
    // Public read endpoint (token-based). Rate limiting + expiry comes next.
    return await this.prescriptions.getByShareToken(token);
  }

  @Get('prescriptions/:id/pdf')
  @RequirePermissions(Permission.PatientRead)
  async pdfUrl(@Req() req: AppRequest, @Param('id') id: string) {
    const rx = await this.prescriptions.getById(req.context!.clinicId, id);
    if (!rx.pdfDocumentId) {
      const bytes = await this.pdfService.prescriptionPdf({
        clinicName: 'DigiRx Clinic',
        patientName: rx.patientId.toHexString(),
        doctorName: rx.doctorId.toHexString(),
        createdAtIso:
          (rx as any).createdAt?.toISOString?.() ?? new Date().toISOString(),
        items: (rx.items ?? []).map((it: any) => ({
          name:
            it.customName ??
            it.medicineCatalogItemId?.toHexString?.() ??
            'Medicine',
          dosage: it.dosage,
          frequency: it.frequency,
          duration: it.duration,
          instructions: it.instructions,
        })),
      });

      const key = `clinic/${req.context!.clinicId.toHexString()}/prescription/${rx._id.toHexString()}/prescription.pdf`;
      await this.storage.putObject({
        key,
        body: bytes,
        contentType: 'application/pdf',
      });
      const doc = await this.documents.createForOwner({
        clinicId: req.context!.clinicId,
        ownerType: DocumentOwnerType.Prescription,
        ownerId: rx._id,
        mimeType: 'application/pdf',
        fileName: `prescription-${rx._id.toHexString().slice(-6)}.pdf`,
        sizeBytes: bytes.length,
        storageKey: key,
        createdBy: req.context!.actorUserId,
      });
      await (rx as any).updateOne({ $set: { pdfDocumentId: doc._id } });
      (rx as any).pdfDocumentId = doc._id;
    }

    const pdfDocumentId = rx.pdfDocumentId;
    if (!pdfDocumentId) throw new Error('pdfDocumentId missing');
    const doc = await this.documents.getById(
      req.context!.clinicId,
      pdfDocumentId.toHexString(),
    );
    const url = await this.storage.presignGet({ key: doc.storageKey });
    return { url, expiresInSeconds: 300, documentId: doc._id };
  }
}
