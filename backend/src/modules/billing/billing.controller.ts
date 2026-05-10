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
import { DocumentOwnerType } from '../documents/schemas/document.schema';
import { Patient } from '../patients/schemas/patient.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { Branch } from '../tenancy/schemas/branch.schema';
import { BillStatus } from './schemas/bill.schema';

@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
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
  async issue(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.billing.issueBill(req.context!.clinicId, id);
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
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Number(limitRaw ?? 100) || 100;
    return await this.billing.listBills(req.context!.clinicId, {
      branchId,
      patientId,
      status,
      limit,
    });
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
    const bill: any = await this.billing.getBill(req.context!.clinicId, id);

    // Regenerate the PDF when the bill is freshly Paid so the PAID stamp shows.
    const isPaid = bill.status === BillStatus.Paid;
    const cachedDocId = bill.pdfDocumentId;

    if (!cachedDocId || isPaid) {
      const [clinic, patient, branch] = await Promise.all([
        this.clinicModel.findById(req.context!.clinicId),
        this.patientModel.findOne({
          _id: bill.patientId,
          clinicId: req.context!.clinicId,
        }),
        this.branchModel.findOne({
          _id: bill.branchId,
          clinicId: req.context!.clinicId,
        }),
      ]);

      const bytes = await this.pdf.billPdf({
        clinicName: clinic?.name || 'Clinic',
        branchName: branch?.name,
        clinicAddress: branch?.addressLine,
        clinicPhone: branch?.phone,
        billNo: bill.billNo,
        patientName: patient?.fullName ?? 'Patient',
        patientAge: patient?.dob ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / 31557600000) : undefined,
        patientGender: patient?.gender,
        issuedAtIso: bill.issuedAt?.toISOString?.() ?? '',
        currency: bill.currency,
        items: (bill.items ?? []).map((it: any) => ({
          name:
            it.customName ??
            it.serviceCatalogItemId?.toHexString?.() ??
            'Service',
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          amount: it.amount,
        })),
        subtotal: bill.subtotal,
        discount: bill.discount,
        tax: bill.tax,
        total: bill.total,
        paid: isPaid,
        paidAtIso: bill.paidAt?.toISOString?.() ?? undefined,
      });

      const suffix = isPaid ? '/bill-paid.pdf' : '/bill.pdf';
      const key = `clinic/${req.context!.clinicId.toHexString()}/bill/${bill._id.toHexString()}${suffix}`;
      await this.storage.putObject({
        key,
        body: bytes,
        contentType: 'application/pdf',
      });
      const doc = await this.documents.createForOwner({
        clinicId: req.context!.clinicId,
        ownerType: DocumentOwnerType.Bill,
        ownerId: bill._id,
        mimeType: 'application/pdf',
        fileName: `bill-${bill.billNo ?? bill._id.toHexString().slice(-6)}${isPaid ? '-paid' : ''}.pdf`,
        sizeBytes: bytes.length,
        storageKey: key,
        createdBy: req.context!.actorUserId,
      });
      await bill.updateOne({ $set: { pdfDocumentId: doc._id } });
      bill.pdfDocumentId = doc._id;
    }

    const doc = await this.documents.getById(
      req.context!.clinicId,
      bill.pdfDocumentId.toHexString(),
    );
    const url = await this.storage.presignGet({ key: doc.storageKey });
    return { url, expiresInSeconds: 300, documentId: doc._id };
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
