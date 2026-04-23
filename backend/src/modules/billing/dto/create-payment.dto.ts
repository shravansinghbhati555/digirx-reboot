import { PaymentMethod } from '../schemas/payment.schema';

export class CreatePaymentDto {
  method!: PaymentMethod;
  amount!: number;
  providerRef?: string;
  paidAt?: string; // ISO (defaults now)
}
