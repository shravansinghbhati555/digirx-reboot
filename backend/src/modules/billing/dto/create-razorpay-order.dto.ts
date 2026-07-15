import { IsNumber, IsString, IsOptional, Min } from 'class-validator';

export class CreateRazorpayOrderDto {
  @IsNumber()
  @Min(100, { message: 'amount must be at least 100 paise' })
  amount!: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsString()
  @IsOptional()
  receipt?: string;
}
