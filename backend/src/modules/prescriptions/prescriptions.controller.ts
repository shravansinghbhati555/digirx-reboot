import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AppRequest } from '../../common/types';
import { Public } from '../../common/public.decorator';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { SharePrescriptionDto } from './dto/share-prescription.dto';
import { PrescriptionsService } from './prescriptions.service';
import { PdfService } from '../pdf/pdf.service';
import { StorageService } from '../storage/storage.service';
import { DocumentsService } from '../documents/documents.service';
import { DocumentOwnerType } from '../documents/schemas/document.schema';
import { Patient } from '../patients/schemas/patient.schema';
import { User } from '../authz/schemas/user.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';

@Controller()
export class PrescriptionsController {
  constructor(
    private readonly prescriptions: PrescriptionsService,
    private readonly pdfService: PdfService,
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
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
  async share(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() body: SharePrescriptionDto,
  ) {
    return await this.prescriptions.share(
      req.context!.clinicId,
      id,
      body.expiresInSeconds,
    );
  }

  @Post('prescriptions/:id/share/revoke')
  @RequirePermissions(Permission.PatientWrite)
  async revokeShare(@Req() req: AppRequest, @Param('id') id: string) {
    const out = await this.prescriptions.revokeShare(req.context!.clinicId, id);
    return { shareTokenRevokedAt: out.shareTokenRevokedAt };
  }

  @Get('share/prescriptions/:token')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async getShared(@Param('token') token: string) {
    // Public read endpoint (token-based). Rate limiting + expiry comes next.
    return await this.prescriptions.getByShareToken(token);
  }

  @Get('prescriptions/:id/pdf')
  @RequirePermissions(Permission.PatientRead)
  async pdfUrl(@Req() req: AppRequest, @Param('id') id: string) {
    const rx = await this.prescriptions.getById(req.context!.clinicId, id);
    if (!rx.pdfDocumentId) {
      const [clinic, patient, doctor] = await Promise.all([
        this.clinicModel.findById(req.context!.clinicId),
        this.patientModel.findOne({
          _id: rx.patientId,
          clinicId: req.context!.clinicId,
        }),
        this.userModel.findOne({
          _id: rx.doctorId,
          clinicId: req.context!.clinicId,
        }),
      ]);

      const bytes = await this.pdfService.prescriptionPdf({
        clinicName: clinic?.name ?? 'Clinic',
        patientName: patient?.fullName ?? 'Patient',
        doctorName: doctor?.name ?? 'Doctor',
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
