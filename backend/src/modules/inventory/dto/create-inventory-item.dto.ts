import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  InventoryPackUnit,
  InventoryUnit,
} from '../schemas/inventory-item.schema';

export class CreateInventoryItemDto {
  @IsMongoId()
  branchId!: string;

  @IsOptional()
  @IsMongoId()
  medicineCatalogItemId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  /**
   * Optional SKU — printable letters, digits, hyphens, underscores. We
   * skip whitespace + special chars deliberately so SKUs can be scanned
   * from a label without surprises.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,40}$/, {
    message: 'SKU must be 1-40 alphanumerics, hyphens or underscores',
  })
  sku?: string;

  @IsEnum(InventoryUnit)
  unit!: InventoryUnit;

  /**
   * Optional packaging unit (e.g. STRIP). When provided, `packSize`
   * must also be provided. The combined fields are advisory display
   * metadata for receive screens — the BE still stores all quantities
   * in `unit`.
   */
  @IsOptional()
  @IsEnum(InventoryPackUnit)
  packUnit?: InventoryPackUnit;

  @IsOptional()
  @IsInt()
  @Min(1)
  packSize?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderLevel?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
