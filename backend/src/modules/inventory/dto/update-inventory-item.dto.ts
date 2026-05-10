import {
  IsBoolean,
  IsEnum,
  IsInt,
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

export class UpdateInventoryItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,40}$/)
  sku?: string;

  @IsOptional()
  @IsEnum(InventoryUnit)
  unit?: InventoryUnit;

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
