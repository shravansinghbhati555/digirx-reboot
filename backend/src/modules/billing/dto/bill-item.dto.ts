import { IsInt, IsMongoId, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class BillItemDto {
  @IsOptional()
  @IsMongoId()
  serviceCatalogItemId?: string;

  /**
   * Set on MEDICINE-bill line items so the dispense path (Slice 5) can
   * resolve the stock row directly. Optional — SERVICE-bill lines won't
   * carry this.
   */
  @IsOptional()
  @IsMongoId()
  inventoryItemId?: string;

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
