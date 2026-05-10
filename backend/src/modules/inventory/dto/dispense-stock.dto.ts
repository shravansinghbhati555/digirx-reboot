import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class DispenseStockDto {
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /** Outbound references — captured on every StockMovement for traceability. */
  @IsOptional()
  @IsMongoId()
  prescriptionId?: string;

  @IsOptional()
  @IsMongoId()
  billId?: string;
}
