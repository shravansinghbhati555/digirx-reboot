import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaymentMethod } from '../../billing/schemas/payment.schema';

export class RefundCreditNoteDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  /**
   * Required client-generated key. A retry of the same refund (network blip,
   * double-click) replays without doubling the refund.
   */
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  providerRef?: string;

  @IsOptional()
  @IsISO8601()
  refundedAt?: string;
}
