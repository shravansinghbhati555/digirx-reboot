import { ArrayMinSize, IsArray, IsEnum, IsMongoId, IsNumber, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BillItemDto } from './bill-item.dto';
import { BillKind } from '../schemas/bill.schema';
import { ClientIdDto } from '../../offline/dto/client-id.dto';

export class CreateBillDto extends ClientIdDto {
  @IsMongoId()
  branchId!: string;

  @IsMongoId()
  patientId!: string;

  @IsOptional()
  @IsMongoId()
  appointmentId?: string;

  @IsOptional()
  @IsMongoId()
  encounterId?: string;

  /**
   * Defaults to SERVICE on the schema, so existing callers don't need to
   * send this. The pharmacy flow (Slice 4) sets MEDICINE explicitly.
   */
  @IsOptional()
  @IsEnum(BillKind)
  kind?: BillKind;

  @IsOptional()
  @IsString()
  @Length(3, 8)
  currency?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BillItemDto)
  items!: BillItemDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tax?: number;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}
