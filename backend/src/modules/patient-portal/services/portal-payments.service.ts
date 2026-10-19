import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillingService } from '../../billing/billing.service';
import { RazorpayService } from '../../billing/razorpay.service';
import { BillStatus } from '../../billing/schemas/bill.schema';
import { Payment, PaymentMethod } from '../../billing/schemas/payment.schema';
import { AuditAction } from '../../audit/schemas/audit-log.schema';
import {
  PortalPaymentOrder,
  PortalPaymentOrderStatus,
} from '../schemas/portal-payment-order.schema';
import { PortalRecordsService } from './portal-records.service';
import { PortalAuditService } from './portal-audit.service';
import { touch, type PortalCtx } from '../portal.context';

/**
 * Online payment of a clinic bill. Money is recorded through the clinic's
 * own `BillingService.addPayment`, idempotent on the Razorpay order id, so a
 * retried verification can never record a payment twice.
 */
@Injectable()
export class PortalPaymentsService {
  constructor(
    @InjectModel(PortalPaymentOrder.name)
    private readonly orderModel: Model<PortalPaymentOrder>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    private readonly billing: BillingService,
    private readonly razorpay: RazorpayService,
    private readonly records: PortalRecordsService,
    private readonly audit: PortalAuditService,
  ) {}

  async createOrder(ctx: PortalCtx, billId: string) {
    if (!this.razorpay.isConfigured()) {
      throw new ServiceUnavailableException(
        'Online payment is not available yet. Please pay at the clinic.',
      );
    }
    const { bill } = await this.records.ownedBill(ctx, billId);
    if (bill.status !== BillStatus.Issued)
      throw new BadRequestException('This bill has nothing left to pay');
    const paidAgg = await this.paymentModel.aggregate<{ total: number }>([
      { $match: { clinicId: bill.clinicId, billId: bill._id } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const outstanding =
      Math.round(Math.max(0, bill.total - (paidAgg[0]?.total ?? 0)) * 100) /
      100;
    if (outstanding <= 0)
      throw new BadRequestException('This bill has nothing left to pay');

    const order = await this.razorpay.createOrder({
      amount: Math.round(outstanding * 100),
      currency: bill.currency || 'INR',
      receipt: `portal_${String(bill._id).slice(-12)}_${Date.now().toString(36)}`,
    });
    await this.orderModel.create({
      accountId: ctx.accountId,
      clinicId: bill.clinicId,
      billId: bill._id,
      orderId: order.orderId,
      amount: outstanding,
      currency: order.currency,
    });
    touch(ctx, bill.clinicId);
    return {
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    };
  }

  async verify(
    ctx: PortalCtx,
    billId: string,
    input: {
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    },
  ) {
    if (!Types.ObjectId.isValid(billId))
      throw new NotFoundException('Bill not found');
    const order = await this.orderModel.findOne({
      orderId: input.razorpay_order_id,
      accountId: ctx.accountId,
      billId: new Types.ObjectId(billId),
    });
    if (!order) throw new NotFoundException('Payment order not found');
    this.razorpay.verifySignature(input);

    const result = await this.billing.addPayment(
      order.clinicId,
      undefined,
      billId,
      {
        method: PaymentMethod.Online,
        amount: order.amount,
        providerRef: input.razorpay_payment_id,
        idempotencyKey: `rzp_${order.orderId}`.slice(0, 64),
      } as any,
    );
    if (order.status !== PortalPaymentOrderStatus.Paid) {
      order.status = PortalPaymentOrderStatus.Paid;
      order.paymentId = input.razorpay_payment_id;
      await order.save();
      this.audit.record(ctx, {
        clinicId: order.clinicId,
        action: AuditAction.Create,
        entityType: '/portal/bills/:id/payments',
        entityId: billId,
        meta: { amount: order.amount, providerRef: input.razorpay_payment_id },
      });
    }
    touch(ctx, order.clinicId);
    return { ok: true, replayed: result.replayed };
  }
}
