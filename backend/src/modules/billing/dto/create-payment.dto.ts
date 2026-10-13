import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaymentMethod } from '../schemas/payment.schema';

export class CreatePaymentDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerRef?: string;

  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  idempotencyKey!: string;

  /** Set by the offline queue on payments taken without a connection. */
  @IsOptional()
  @IsBoolean()
  collectedOffline?: boolean;
}
