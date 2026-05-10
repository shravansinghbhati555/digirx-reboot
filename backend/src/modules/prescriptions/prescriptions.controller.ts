import { Body, Controller, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
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
import { ScreenshotService } from '../pdf/screenshot.service';
import { StorageService } from '../storage/storage.service';
import { DocumentsService } from '../documents/documents.service';
import { DocumentOwnerType } from '../documents/schemas/document.schema';
import { Patient } from '../patients/schemas/patient.schema';
import { User } from '../authz/schemas/user.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { Branch } from '../tenancy/schemas/branch.schema';
import { Encounter } from '../encounters/schemas/encounter.schema';
import { Prescription } from './schemas/prescription.schema';

@Controller()
export class PrescriptionsController {
  constructor(
    private readonly prescriptions: PrescriptionsService,
    private readonly pdfService: PdfService,
    private readonly screenshotService: ScreenshotService,
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    @InjectModel(Encounter.name) private readonly encounterModel: Model<Encounter>,
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

  @Get('encounters/:id/prescriptions')
  @RequirePermissions(Permission.PatientRead)
  async getForEncounter(
    @Req() req: AppRequest,
    @Param('id') encounterId: string,
  ) {
    const rx = await this.prescriptions.getByEncounter(
      req.context!.clinicId,
      encounterId,
    );
    return rx ?? null;
  }

  @Patch('encounters/:id/prescriptions')
  @RequirePermissions(Permission.PatientWrite)
  async upsertForEncounter(
    @Req() req: AppRequest,
    @Param('id') encounterId: string,
    @Body() dto: CreatePrescriptionDto,
  ) {
    return await this.prescriptions.upsertForEncounter(
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
    console.log(`[PrescriptionsController] Public request for token: ${token}`);
    const rx = await this.prescriptions.getByShareToken(token);
    const [clinic, branch, patient, doctor, encounter] = await Promise.all([
      this.clinicModel.findById(rx.clinicId),
      this.branchModel.findById(rx.branchId),
      this.patientModel.findOne({ _id: rx.patientId, clinicId: rx.clinicId }),
      this.userModel.findOne({ _id: rx.doctorId, clinicId: rx.clinicId }),
      this.encounterModel.findById(rx.encounterId),
    ]);

    // Calculate age
    let age = '';
    if (patient?.dob) {
      const birth = new Date(patient.dob);
      const now = new Date();
      let a = now.getFullYear() - birth.getFullYear();
      if (
        now.getMonth() < birth.getMonth() ||
        (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
      )
        a--;
      age = String(a);
    }

    return {
      _id: rx._id,
      createdAt: (rx as any).createdAt,
      clinicName: clinic?.name,
      branchName: branch?.name,
      branchAddress: branch?.addressLine,
      patientName: patient?.fullName,
      patientAge: age || undefined,
      patientGender: patient?.gender,
      patientPhone: patient?.phones?.[0],
      doctorName: doctor?.name,
      vitals: encounter?.vitals,
      diagnosis: encounter?.diagnosis,
      notes: encounter?.notes,
      followUpAt: encounter?.followUpAt,
      chiefComplaint: encounter?.chiefComplaint,
      branchPhone: branch?.phone,
      doctorReg: (doctor as any)?.registrationNumber,
      doctorQuals: (doctor as any)?.qualifications,
      items: (rx.items ?? []).map((it: any) => ({
        customName:
          it.customName ??
          it.medicineCatalogItemId?.toHexString?.() ??
          'Medicine',
        dosage: it.dosage,
        frequency: it.frequency,
        duration: it.duration,
        instructions: it.instructions,
      })),
    };
  }

  @Get('prescriptions/:id/pdf')
  @RequirePermissions(Permission.PatientRead)
  async pdfUrl(@Req() req: AppRequest, @Param('id') id: string) {
    const rx = await this.prescriptions.getById(req.context!.clinicId, id);
    if (!rx.pdfDocumentId) {
      const bytes = await this.generatePdfBytes(rx, req.context!.clinicId);

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

  @Get('share/prescriptions/:token/pdf')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async getSharedPdf(@Param('token') token: string, @Res() res: Response) {
    const rx = await this.prescriptions.getByShareToken(token);
    if (!rx.pdfDocumentId) {
      // Use screenshot for public sharing as requested
      const bytes = await this.screenshotService.capturePrescriptionAsPdf(token);
      const key = `clinic/${rx.clinicId.toHexString()}/prescription/${rx._id.toHexString()}/prescription.pdf`;
      await this.storage.putObject({
        key,
        body: bytes,
        contentType: 'application/pdf',
      });
      const doc = await this.documents.createForOwner({
        clinicId: rx.clinicId,
        ownerType: DocumentOwnerType.Prescription,
        ownerId: rx._id,
        mimeType: 'application/pdf',
        fileName: `prescription-${rx._id.toHexString().slice(-6)}.pdf`,
        sizeBytes: bytes.length,
        storageKey: key,
        createdBy: rx.doctorId,
      });
      await (rx as any).updateOne({ $set: { pdfDocumentId: doc._id } });
      (rx as any).pdfDocumentId = doc._id;
    }

    const pdfDocumentId = rx.pdfDocumentId;
    if (!pdfDocumentId) throw new Error('pdfDocumentId missing');
    const doc = await this.documents.getById(
      rx.clinicId,
      pdfDocumentId.toHexString(),
    );
    const url = await this.storage.presignGet({ key: doc.storageKey });
    return res.redirect(url);
  }

  private async generatePdfBytes(rx: Prescription, clinicId: any): Promise<Uint8Array> {
    const [clinic, branch, patient, doctor, encounter] = await Promise.all([
      this.clinicModel.findById(clinicId),
      this.branchModel.findById(rx.branchId),
      this.patientModel.findOne({ _id: rx.patientId, clinicId }),
      this.userModel.findOne({ _id: rx.doctorId, clinicId }),
      this.encounterModel.findOne({ _id: rx.encounterId, clinicId }),
    ]);

    // Calculate age
    let age = '';
    if (patient?.dob) {
      const birth = new Date(patient.dob);
      const now = new Date();
      let a = now.getFullYear() - birth.getFullYear();
      if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) a--;
      age = String(a);
    }

    return await this.pdfService.prescriptionPdf({
      clinicName: clinic?.name ?? 'Clinic',
      clinicAddress: branch?.addressLine,
      clinicPhone: branch?.phone,
      patientName: patient?.fullName ?? 'Patient',
      patientAge: age || undefined,
      patientGender: patient?.gender,
      doctorName: doctor?.name ?? 'Doctor',
      createdAtIso: (rx as any).createdAt?.toISOString?.() ?? new Date().toISOString(),
      diagnosis: encounter?.diagnosis,
      vitals: encounter?.vitals as Record<string, string> | undefined,
      items: (rx.items ?? []).map((it: any) => ({
        name: it.customName ?? it.medicineCatalogItemId?.toHexString?.() ?? 'Medicine',
        dosage: it.dosage,
        frequency: it.frequency,
        duration: it.duration,
        instructions: it.instructions,
      })),
    });
  }
}
