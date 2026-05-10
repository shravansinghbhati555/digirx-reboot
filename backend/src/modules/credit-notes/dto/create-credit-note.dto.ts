import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BillItemDto } from '../../billing/dto/bill-item.dto';

export class CreateCreditNoteDto {
  /** Snapshot of credited line items. Caller can credit a subset of the bill. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BillItemDto)
  items!: BillItemDto[];

  /**
   * Total amount credited. Service enforces:
   *   - amount > 0
   *   - sum of (this CN + active CNs on the bill) <= bill.total
   */
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
