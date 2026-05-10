import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ReceiveStockDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  batchNumber!: string;

  @IsDateString()
  expiryDate!: string;

  @IsInt()
  @Min(1)
  quantityReceived!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplier?: string;
}
