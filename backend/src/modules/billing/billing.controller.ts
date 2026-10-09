import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { BillingService } from './billing.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { VoidBillDto } from './dto/void-bill.dto';
import { PdfService } from '../pdf/pdf.service';
import { StorageService } from '../storage/storage.service';
import { DocumentsService } from '../documents/documents.service';
import { DocumentOwnerType, DocumentStatus } from '../documents/schemas/document.schema';
import { Patient } from '../patients/schemas/patient.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { Branch } from '../tenancy/schemas/branch.schema';
import { BillStatus } from './schemas/bill.schema';
import { IssueBillDto } from './dto/issue-bill.dto';

@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
  ) { }

  @Post('bills')
  @RequirePermissions(Permission.BillingWrite)
  async createBill(@Req() req: AppRequest, @Body() dto: CreateBillDto) {
    return await this.billing.createBill(
      req.context!.clinicId,
      req.context!.actorUserId,
      dto,
    );
  }

  /**
   * Draft a kind=MEDICINE bill from a prescription. Idempotent — a second
   * call returns the existing draft for the same encounter. The receptionist
   * adjusts unit prices in the draft, then issues + collects payment via
   * the existing PATCH/issue/payments endpoints. Auto-inventory-deduct lands
   * on the payment that fully settles the bill (Slice 5).
   */
  @Post('bills/from-prescription/:prescriptionId')
  @RequirePermissions(Permission.BillingWrite)
  async createFromPrescription(
    @Req() req: AppRequest,
    @Param('prescriptionId') prescriptionId: string,
  ) {
    return await this.billing.createBillFromPrescription(
      req.context!.clinicId,
      req.context!.actorUserId,
      prescriptionId,
    );
  }

  @Patch('bills/:id')
  @RequirePermissions(Permission.BillingWrite)
  async updateBill(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: UpdateBillDto,
  ) {
    return await this.billing.updateBill(req.context!.clinicId, id, dto);
  }

  @Post('bills/:id/issue')
  @RequirePermissions(Permission.BillingWrite)
  async issue(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: IssueBillDto = {},
  ) {
    return await this.billing.issueBill(
      req.context!.clinicId,
      id,
      req.context!.actorUserId,
      { billSeq: dto.billSeq, deviceId: req.context!.deviceId },
    );
  }

  @Post('bills/:id/void')
  @RequirePermissions(Permission.BillingWrite)
  async void(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() body: VoidBillDto,
  ) {
    return await this.billing.voidBill(
      req.context!.clinicId,
      req.context!.actorUserId,
      id,
      body.reason,
    );
  }

  @Get('bills')
  @RequirePermissions(Permission.BillingRead)
  async listBills(
    @Req() req: AppRequest,
    @Query('branchId') branchId?: string,
    @Query('patientId') patientId?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('date') date?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Number(limitRaw ?? 100) || 100;
    return await this.billing.listBills(req.context!.clinicId, {
      branchId,
      patientId,
      status,
      kind,
      date,
      limit,
    });
  }

  // Lookup-by-billNo. Declared BEFORE the `:id` route so the `/by-no`
  // segment isn't swallowed as an ObjectId. `billNo` values like
  // `MAIN/2026-27/000005` contain slashes, so we accept it as a query
  // param rather than a path segment.
  @Get('bills/by-no')
  @RequirePermissions(Permission.BillingRead)
  async getBillByNo(@Req() req: AppRequest, @Query('billNo') billNo?: string) {
    return await this.billing.getBillByNo(
      req.context!.clinicId,
      billNo ?? '',
    );
  }

  @Get('bills/:id')
  @RequirePermissions(Permission.BillingRead)
  async getBill(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.billing.getBill(req.context!.clinicId, id);
  }

  @Get('bills/context/find')
  @RequirePermissions(Permission.BillingRead)
  async getBillByContext(
    @Req() req: AppRequest,
    @Query('encounterId') encounterId?: string,
    @Query('appointmentId') appointmentId?: string,
  ) {
    return await this.billing.findByContext(req.context!.clinicId, {
      encounterId,
      appointmentId,
    });
  }

  @Post('bills/:id/payments')
  @RequirePermissions(Permission.BillingWrite)
  async addPayment(
    @Req() req: AppRequest,
    @Param('id') billId: string,
    @Body() dto: CreatePaymentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.billing.addPayment(
      req.context!.clinicId,
      req.context!.actorUserId,
      billId,
      dto,
    );
    if (result.replayed) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    return result.payment;
  }

  @Get('bills/:id/payments')
  @RequirePermissions(Permission.BillingRead)
  async listPayments(@Req() req: AppRequest, @Param('id') billId: string) {
    return await this.billing.listPayments(req.context!.clinicId, billId);
  }

  @Get('bills/:id/pdf')
  @RequirePermissions(Permission.BillingRead)
  async billPdf(@Req() req: AppRequest, @Param('id') id: string) {
    const docId = await this.billing.ensurePdfGenerated(
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

  // Mint a public, token-protected link to the invoice PDF so staff can
  // send it to the patient over WhatsApp / SMS / email. Reuses the
  // document-share infra: the bill PDF (a Document) is made shareable and
  // a 60-day DocumentShare token is created; the public, unauthenticated
  // GET /share/:token endpoint then serves the PDF.
  @Post('bills/:id/share')
  @RequirePermissions(Permission.BillingRead)
  async shareBill(@Req() req: AppRequest, @Param('id') id: string) {
    const docId = await this.billing.ensurePdfGenerated(
      req.context!.clinicId,
      id,
      req.context!.actorUserId,
    );
    await this.documents.makeShareable(req.context!.clinicId, docId!.toHexString());
    const share = await this.documents.createShare({
      clinicId: req.context!.clinicId,
      documentId: docId!.toHexString(),
      expiresInSeconds: 60 * 24 * 60 * 60, // 60 days, same as prescription shares
      createdBy: req.context!.actorUserId,
    });
    return { token: share.token, expiresAt: share.expiresAt };
  }

  @Get('catalog/services')
  @RequirePermissions(Permission.BillingRead)
  async listServices(
    @Req() req: AppRequest,
    @Query('query') query?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Number(limitRaw ?? 200) || 200;
    return await this.billing.listServices(req.context!.clinicId, {
      query,
      limit,
    });
  }

  @Post('catalog/services')
  @RequirePermissions(Permission.BillingWrite)
  async createService(
    @Req() req: AppRequest,
    @Body() body: CreateServiceDto,
  ) {
    return await this.billing.createService(
      req.context!.clinicId,
      body.name,
      body.defaultPrice,
    );
  }
}
