import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { BillingService } from './billing.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { PdfService } from '../pdf/pdf.service';
import { StorageService } from '../storage/storage.service';
import { DocumentsService } from '../documents/documents.service';
import { DocumentOwnerType } from '../documents/schemas/document.schema';

@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
  ) {}

  @Post('bills')
  @RequirePermissions(Permission.BillingWrite)
  async createBill(@Req() req: AppRequest, @Body() dto: CreateBillDto) {
    return await this.billing.createBill(req.context!.clinicId, req.context!.actorUserId, dto);
  }

  @Patch('bills/:id')
  @RequirePermissions(Permission.BillingWrite)
  async updateBill(@Req() req: AppRequest, @Param('id') id: string, @Body() dto: UpdateBillDto) {
    return await this.billing.updateBill(req.context!.clinicId, id, dto);
  }

  @Post('bills/:id/issue')
  @RequirePermissions(Permission.BillingWrite)
  async issue(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.billing.issueBill(req.context!.clinicId, id);
  }

  @Get('bills/:id')
  @RequirePermissions(Permission.BillingRead)
  async getBill(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.billing.getBill(req.context!.clinicId, id);
  }

  @Post('bills/:id/payments')
  @RequirePermissions(Permission.BillingWrite)
  async addPayment(@Req() req: AppRequest, @Param('id') billId: string, @Body() dto: CreatePaymentDto) {
    return await this.billing.addPayment(req.context!.clinicId, req.context!.actorUserId, billId, dto);
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
    if (!bill.pdfDocumentId) {
      const bytes = await this.pdf.billPdf({
        clinicName: 'DigiRx Clinic',
        billNo: bill.billNo,
        patientName: bill.patientId.toHexString(),
        issuedAtIso: bill.issuedAt?.toISOString?.() ?? '',
        currency: bill.currency,
        items: (bill.items ?? []).map((it: any) => ({
          name: it.customName ?? it.serviceCatalogItemId?.toHexString?.() ?? 'Service',
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          amount: it.amount,
        })),
        subtotal: bill.subtotal,
        discount: bill.discount,
        tax: bill.tax,
        total: bill.total,
      });

      const key = `clinic/${req.context!.clinicId.toHexString()}/bill/${bill._id.toHexString()}/bill.pdf`;
      await this.storage.putObject({ key, body: bytes, contentType: 'application/pdf' });
      const doc = await this.documents.createForOwner({
        clinicId: req.context!.clinicId,
        ownerType: DocumentOwnerType.Bill,
        ownerId: bill._id,
        mimeType: 'application/pdf',
        fileName: `bill-${bill.billNo ?? bill._id.toHexString().slice(-6)}.pdf`,
        sizeBytes: bytes.length,
        storageKey: key,
        createdBy: req.context!.actorUserId,
      });
      await bill.updateOne({ $set: { pdfDocumentId: doc._id } });
      bill.pdfDocumentId = doc._id;
    }

    const doc = await this.documents.getById(req.context!.clinicId, bill.pdfDocumentId.toHexString());
    const url = await this.storage.presignGet({ key: doc.storageKey });
    return { url, expiresInSeconds: 300, documentId: doc._id };
  }

  @Get('catalog/services')
  @RequirePermissions(Permission.BillingRead)
  async listServices(@Req() req: AppRequest) {
    return await this.billing.listServices(req.context!.clinicId);
  }

  @Post('catalog/services')
  @RequirePermissions(Permission.BillingWrite)
  async createService(@Req() req: AppRequest, @Body() body: { name: string; defaultPrice: number }) {
    return await this.billing.createService(req.context!.clinicId, body.name, body.defaultPrice);
  }

  @Get('reports/revenue')
  async revenueStub(@Query('from') from?: string, @Query('to') to?: string) {
    return { status: 'NOT_IMPLEMENTED', from, to };
  }
}

