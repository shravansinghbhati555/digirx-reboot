import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PortalPaymentOrderDocument = HydratedDocument<PortalPaymentOrder>;

export enum PortalPaymentOrderStatus {
  Created = 'CREATED',
  Paid = 'PAID',
}

/**
 * A Razorpay order the portal created for a bill. The amount is fixed on the
 * server when the order is made, so a client cannot choose what it pays;
 * verification looks the order up here rather than trusting the client.
 */
@Schema({ timestamps: true })
export class PortalPaymentOrder {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  accountId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  billId!: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  orderId!: string;

  /** In the bill's currency (rupees), as passed to BillingService.addPayment. */
  @Prop({ type: Number, required: true })
  amount!: number;

  @Prop({ type: String, required: true })
  currency!: string;

  @Prop({
    required: true,
    enum: PortalPaymentOrderStatus,
    default: PortalPaymentOrderStatus.Created,
  })
  status!: PortalPaymentOrderStatus;

  @Prop({ type: String })
  paymentId?: string;
}

export const PortalPaymentOrderSchema =
  SchemaFactory.createForClass(PortalPaymentOrder);
