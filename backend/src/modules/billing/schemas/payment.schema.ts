import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PaymentDocument = HydratedDocument<Payment>;

export enum PaymentMethod {
  Cash = 'CASH',
  Upi = 'UPI',
  Card = 'CARD',
  Online = 'ONLINE',
  BankTransfer = 'BANK_TRANSFER',
}

@Schema({ timestamps: true })
export class Payment {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  billId!: Types.ObjectId;

  @Prop({ required: true, enum: PaymentMethod })
  method!: PaymentMethod;

  @Prop({ required: true, min: 0 })
  amount!: number;

  @Prop({ trim: true })
  providerRef?: string;

  @Prop({ type: Date, required: true })
  paidAt!: Date;

  @Prop({ type: Types.ObjectId })
  receivedBy?: Types.ObjectId;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

PaymentSchema.index({ clinicId: 1, billId: 1, paidAt: -1 }, { name: 'payment_bill_paidAt_idx' });

