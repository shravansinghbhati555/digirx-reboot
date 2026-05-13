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
import { DocumentCategory, DocumentOwnerType, DocumentStatus } from '../documents/schemas/document.schema';
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
  ) { }

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
    return await this.prescriptions.share(req.context!.clinicId, id, {
      expiresInSeconds: body.expiresInSeconds,
      sendVia: body.sendVia,
      to: body.to,
    });
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
    const { rx, clinic, branch, patient, doctor, encounter, age } =
      await this.prescriptions.getShareData(token);

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
    const docId = await this.prescriptions.ensurePdfGenerated(
      req.context!.clinicId,
      id,
      req.context!.actorUserId,
    );
    const doc = await this.documents.getById(
      req.context!.clinicId,
      docId!.toHexString(),
    );
    const url = await this.storage.presignGet({ key: doc.storageKey });
    return { url, expiresInSeconds: 300, documentId: doc._id };
  }

  @Get('share/prescriptions/:token/pdf')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async getSharedPdf(@Param('token') token: string, @Res() res: Response) {
    const rx = await this.prescriptions.getByShareToken(token);
    const docId = await this.prescriptions.ensurePdfGenerated(rx.clinicId, rx._id.toHexString());
    const doc = await this.documents.getById(
      rx.clinicId,
      docId!.toHexString(),
    );
    const url = await this.storage.presignGet({ key: doc.storageKey });
    return res.redirect(url);
  }
}
