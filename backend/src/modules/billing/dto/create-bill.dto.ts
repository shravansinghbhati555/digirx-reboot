import { ArrayMinSize, IsArray, IsMongoId, IsNumber, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BillItemDto } from './bill-item.dto';

export class CreateBillDto {
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
}
