import { IsInt, IsMongoId, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class BillItemDto {
  @IsOptional()
  @IsMongoId()
  serviceCatalogItemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customName?: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsInt()
  @Min(0)
  unitPrice!: number;
}
