import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { computeTotals } from './billing.utils';
import { CreateBillDto } from './dto/create-bill.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { Bill, BillLineItem, BillStatus } from './schemas/bill.schema';
import { Payment } from './schemas/payment.schema';
import { ServiceCatalogItem } from './schemas/service-catalog-item.schema';

@Injectable()
export class BillingService {
  constructor(
    @InjectModel(Bill.name) private readonly billModel: Model<Bill>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(ServiceCatalogItem.name)
    private readonly serviceModel: Model<ServiceCatalogItem>,
  ) {}

  async createBill(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    dto: CreateBillDto,
  ) {
    const branchId = new Types.ObjectId(dto.branchId);
    const patientId = new Types.ObjectId(dto.patientId);
    const appointmentId = dto.appointmentId
      ? new Types.ObjectId(dto.appointmentId)
      : undefined;
    const encounterId = dto.encounterId
      ? new Types.ObjectId(dto.encounterId)
      : undefined;

    const items = await this.mapItems(clinicId, dto.items);
    const { subtotal, discount, tax, total } = computeTotals({
      items,
      discount: dto.discount,
      tax: dto.tax,
    });

    const currency = (dto.currency ?? 'INR').trim();
    if (!currency) throw new BadRequestException('currency is required');

    return await this.billModel.create({
      clinicId,
      branchId,
      patientId,
      appointmentId,
      encounterId,
      currency,
      items,
      subtotal,
      discount,
      tax,
      total,
      status: BillStatus.Draft,
      createdBy: actorUserId,
    });
  }

  async updateBill(clinicId: Types.ObjectId, id: string, dto: UpdateBillDto) {
    const bill = await this.getBill(clinicId, id);
    if (bill.status === BillStatus.Issued)
      throw new BadRequestException('Cannot edit an issued bill');

    if (dto.status === BillStatus.Void) {
      bill.status = BillStatus.Void;
      await bill.save();
      return bill;
    }

    if (dto.items) bill.items = await this.mapItems(clinicId, dto.items);
    if (dto.discount !== undefined) bill.discount = dto.discount;
    if (dto.tax !== undefined) bill.tax = dto.tax;

    const totals = computeTotals({
      items: bill.items,
      discount: bill.discount,
      tax: bill.tax,
    });
    bill.subtotal = totals.subtotal;
    bill.discount = totals.discount;
    bill.tax = totals.tax;
    bill.total = totals.total;

    await bill.save();
    return bill;
  }

  async issueBill(clinicId: Types.ObjectId, id: string) {
    const bill = await this.getBill(clinicId, id);
    if (bill.status !== BillStatus.Draft)
      throw new BadRequestException('Only draft bills can be issued');

    // Basic billNo generation: BRANCHID-YYYYMMDD-<shortId>. Replace with configurable rules later.
    const d = new Date();
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    bill.billNo = `${bill.branchId.toHexString().slice(-6).toUpperCase()}-${ymd}-${bill._id.toHexString().slice(-6).toUpperCase()}`;
    bill.status = BillStatus.Issued;
    bill.issuedAt = new Date();

    await bill.save();
    return bill;
  }

  async addPayment(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    billId: string,
    dto: CreatePaymentDto,
  ) {
    const bill = await this.getBill(clinicId, billId);
    if (bill.status !== BillStatus.Issued)
      throw new BadRequestException(
        'Payments can be added only to issued bills',
      );

    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new BadRequestException('Invalid amount');

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (isNaN(paidAt.getTime()))
      throw new BadRequestException('Invalid paidAt');

    const payment = await this.paymentModel.create({
      clinicId,
      branchId: bill.branchId,
      billId: bill._id,
      method: dto.method,
      amount,
      providerRef: dto.providerRef,
      paidAt,
      receivedBy: actorUserId,
    });

    return payment;
  }

  async getBill(clinicId: Types.ObjectId, id: string) {
    const bill = await this.billModel.findOne({ _id: id, clinicId });
    if (!bill) throw new NotFoundException('Bill not found');
    return bill;
  }

  async listPayments(clinicId: Types.ObjectId, billId: string) {
    return await this.paymentModel
      .find({ clinicId, billId: new Types.ObjectId(billId) })
      .sort({ paidAt: -1 });
  }

  async createService(
    clinicId: Types.ObjectId,
    name: string,
    defaultPrice: number,
  ) {
    return await this.serviceModel.create({
      clinicId,
      name: name.trim(),
      defaultPrice,
      active: true,
    });
  }

  async listServices(clinicId: Types.ObjectId) {
    return await this.serviceModel
      .find({ clinicId, active: true })
      .sort({ name: 1 })
      .limit(200);
  }

  private async mapItems(
    clinicId: Types.ObjectId,
    items: Array<{
      serviceCatalogItemId?: string;
      customName?: string;
      quantity: number;
      unitPrice: number;
    }>,
  ) {
    if (!Array.isArray(items) || items.length === 0)
      throw new BadRequestException('items is required');

    const catalogIds = items
      .map((i) => i.serviceCatalogItemId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map((id) => new Types.ObjectId(id));

    const catalogById = new Map<string, ServiceCatalogItem>();
    if (catalogIds.length) {
      const found = await this.serviceModel.find({
        clinicId,
        _id: { $in: catalogIds },
      });
      for (const s of found) catalogById.set(s._id.toHexString(), s);
    }

    const mapped: BillLineItem[] = items.map((i) => {
      const qty = Number(i.quantity);
      const unitPrice = Number(i.unitPrice);

      const hasCatalog =
        typeof i.serviceCatalogItemId === 'string' &&
        i.serviceCatalogItemId.length > 0;
      const hasCustom =
        typeof i.customName === 'string' && i.customName.trim().length > 0;
      if (!hasCatalog && !hasCustom)
        throw new BadRequestException(
          'Each item must have serviceCatalogItemId or customName',
        );

      const service = hasCatalog
        ? catalogById.get(i.serviceCatalogItemId!)
        : undefined;
      if (hasCatalog && !service)
        throw new BadRequestException('Invalid serviceCatalogItemId');

      return {
        serviceCatalogItemId: hasCatalog
          ? new Types.ObjectId(i.serviceCatalogItemId)
          : undefined,
        customName: hasCustom ? i.customName!.trim() : service?.name,
        quantity: qty,
        unitPrice,
        amount: 0,
      };
    });

    // computeTotals will fill amount and validate numeric fields
    computeTotals({ items: mapped });
    return mapped;
  }
}
