import { IsEnum, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
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
}
